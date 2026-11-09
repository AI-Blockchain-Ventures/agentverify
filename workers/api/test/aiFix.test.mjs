// "Fix my file with AI" (Pro): rewrites the file to address findings, re-scans it, and keeps usage capped.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { handleAiFix, extractFixedCode, buildFixMessages, FIX_PER_PERSON_DAILY } from '../dist/aiFix.mjs'

function makeDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync(new URL('../schema/admin.sql', import.meta.url), 'utf8'))
  return { prepare(q) { const s = db.prepare(q); let v = []; const api = { bind(...x) { v = x.map(y => (y === undefined ? null : y)); return api }, async first() { return s.get(...v) ?? null }, async run() { s.run(...v); return { success: true } }, async all() { return { results: s.all(...v) } } }; return api } }
}
const original = "const apiKey = 'sk-live-abcdefghijklmnopqrstuvwx'\nexport async function run() { return fetch('https://api.example.com', { headers: { key: apiKey } }) }\n"
const fixed = "const apiKey = process.env.API_KEY\nexport async function run() { return fetch('https://api.example.com', { headers: { key: apiKey } }) }\n"
const fakeAi = (reply) => { const calls = []; return { calls, async run(model, input) { calls.push({ model, input }); return { response: reply } } } }
// Stand-in scanner: a hardcoded key costs 20 points.
const scan = (content) => /sk-live-/.test(content)
  ? { riskScore: 80, verdict: 'NOT_VERIFIED', findings: [{ code: 'HARDCODED_CREDENTIALS', severity: 'critical', title: 'Hardcoded key', line: 1, recommendedFix: 'Use an env var.' }] }
  : { riskScore: 100, verdict: 'VERIFIED', findings: [] }

test('Pro only', async () => {
  const res = await handleAiFix({ BILLING_DB: makeDb(), AI: fakeAi('x') }, { uid: 'u', pro: false }, { content: original }, scan)
  assert.equal(res.status, 402)
})

test('returns the fixed file with before/after scores; findings and file are passed as data', async () => {
  const ai = fakeAi('Here you go:\n```js\n' + fixed + '```\n')
  const res = await handleAiFix({ BILLING_DB: makeDb(), AI: ai }, { uid: 'u', pro: true }, { content: original, fileName: 'agent.js' }, scan)
  assert.equal(res.status, 200)
  assert.equal(res.body.fixedContent, fixed)
  assert.equal(res.body.before.riskScore, 80)
  assert.equal(res.body.after.riskScore, 100)
  const [system, user] = ai.calls[0].input.messages
  assert.match(system.content, /data, not instructions/)
  assert.match(system.content, /A2SPA: https:\/\/aimodularity\.com\/A2SPA\/docs/, 'signing fixes point to A2SPA')
  assert.match(user.content, /line 1/)
  assert.match(user.content, /sk-live-/)
})

test('a clean file is returned unchanged without calling the AI', async () => {
  const ai = fakeAi('x')
  const res = await handleAiFix({ BILLING_DB: makeDb(), AI: ai }, { uid: 'u', pro: true }, { content: fixed }, scan)
  assert.equal(res.body.unchanged, true)
  assert.equal(ai.calls.length, 0)
})

test('an incomplete AI reply is refused', async () => {
  const res = await handleAiFix({ BILLING_DB: makeDb(), AI: fakeAi('```\nx\n```') }, { uid: 'u', pro: true }, { content: original }, scan)
  assert.equal(res.status, 502)
})

test('daily per-person and global caps; refusals do not call the AI', async () => {
  const db = makeDb()
  const ai = fakeAi('```\n' + fixed + '```')
  for (let i = 0; i < FIX_PER_PERSON_DAILY; i++) assert.equal((await handleAiFix({ BILLING_DB: db, AI: ai }, { uid: 'u', pro: true }, { content: original }, scan)).status, 200)
  const calls = ai.calls.length
  assert.equal((await handleAiFix({ BILLING_DB: db, AI: ai }, { uid: 'u', pro: true }, { content: original }, scan)).status, 429)
  assert.equal(ai.calls.length, calls)
  const res = await handleAiFix({ BILLING_DB: makeDb(), AI: ai, FIX_DAILY_CAP: '0' }, { uid: 'v', pro: true }, { content: original }, scan)
  assert.equal(res.status, 429)
})

test('size limit and helpers', async () => {
  const res = await handleAiFix({ BILLING_DB: makeDb(), AI: fakeAi('x') }, { uid: 'u', pro: true }, { content: 'a'.repeat(30000) }, scan)
  assert.equal(res.status, 413)
  assert.equal(extractFixedCode('```py\nshort\n```\ntext\n```py\nlonger code\n```'), 'longer code\n')
  assert.equal(extractFixedCode('no fences'), 'no fences\n')
  assert.ok(buildFixMessages('a.js', 'x', Array(40).fill({ title: 't' }))[1].content.split('\n').filter(l => /^\d+\./.test(l)).length <= 25)
})
