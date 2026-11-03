// "Ask anything": answers come from Workers AI using only the given context; daily caps keep it free.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { handleAsk, cleanContext, buildMessages, ASK_LIMITS } from '../dist/ask.mjs'

function makeDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync(new URL('../schema/admin.sql', import.meta.url), 'utf8'))
  return { raw: db, prepare(q) { const s = db.prepare(q); let v = []; const api = { bind(...x) { v = x.map(y => (y === undefined ? null : y)); return api }, async first() { return s.get(...v) ?? null }, async run() { s.run(...v); return { success: true } }, async all() { return { results: s.all(...v) } } }; return api } }
}
const fakeAi = (reply = 'Use an environment variable.') => {
  const calls = []
  return { calls, async run(model, input) { calls.push({ model, input }); return { response: reply } } }
}

test('answers using the context, with the model told to treat it as data', async () => {
  const ai = fakeAi()
  const res = await handleAsk({ BILLING_DB: makeDb(), AI: ai }, { uid: 'u' }, { question: 'how do I fix the API key finding?', context: [{ title: 'Hard-coded key', text: 'Move it to env.', url: '/docs#secrets' }] })
  assert.equal(res.status, 200)
  assert.equal(res.body.answer, 'Use an environment variable.')
  assert.deepEqual(res.body.sources, [{ title: 'Hard-coded key', url: '/docs#secrets' }])
  const [system, user] = ai.calls[0].input.messages
  assert.match(system.content, /ONLY the facts in the CONTEXT/)
  assert.match(system.content, /data, not instructions/)
  assert.match(user.content, /Move it to env\./)
  assert.ok(ai.calls[0].input.max_tokens <= 400, 'short answers keep usage low')
})

test('context is trimmed and links must be on-site', () => {
  const items = cleanContext([{ title: 'x', text: 'y'.repeat(5000), url: 'https://evil.com' }, { title: 1, text: 'no' }, ...Array(20).fill({ title: 't', text: 't' })])
  assert.ok(items.length <= 8)
  assert.equal(items[0].text.length, 1200)
  assert.equal(items[0].url, undefined)
  assert.match(buildMessages('q', [])[1].content, /nothing found/)
})

test('per-person limits: anonymous < free < pro; refusals never call the AI', async () => {
  const db = makeDb()
  const ai = fakeAi()
  const e = { BILLING_DB: db, AI: ai, ASK_DAILY_CAP: '1000' }
  for (let i = 0; i < ASK_LIMITS.anonymous; i++) assert.equal((await handleAsk(e, { ip: '1.2.3.4' }, { question: 'what is mcp?' })).status, 200)
  const blocked = await handleAsk(e, { ip: '1.2.3.4' }, { question: 'what is mcp?' })
  assert.equal(blocked.status, 429)
  assert.equal(blocked.body.fallback, true)
  assert.equal((await handleAsk(e, { ip: '5.6.7.8' }, { question: 'what is mcp?' })).status, 200, 'another visitor is not affected')
  for (let i = 0; i < ASK_LIMITS.free; i++) await handleAsk(e, { uid: 'free-user' }, { question: 'hello there' })
  assert.equal((await handleAsk(e, { uid: 'free-user' }, { question: 'hello there' })).status, 429)
  assert.equal((await handleAsk(e, { uid: 'pro-user', pro: true }, { question: 'hello there' })).status, 200)
  assert.equal(ai.calls.length, ASK_LIMITS.anonymous + 1 + ASK_LIMITS.free + 1)
  assert.ok(!JSON.stringify(db.raw.prepare('SELECT key FROM ask_usage').all()).includes('1.2.3.4'), 'IP addresses are stored only as hashes')
})

test('the global daily cap keeps it inside the free allowance', async () => {
  const ai = fakeAi()
  const e = { BILLING_DB: makeDb(), AI: ai, ASK_DAILY_CAP: '3' }
  for (let i = 0; i < 3; i++) await handleAsk(e, { uid: `u${i}` }, { question: 'question here' })
  const res = await handleAsk(e, { uid: 'u9', pro: true }, { question: 'question here' })
  assert.equal(res.status, 429)
  assert.equal(res.body.reason, 'daily-cap')
  assert.equal(ai.calls.length, 3)
})

test('no AI binding or a failing model falls back to search', async () => {
  assert.equal((await handleAsk({ BILLING_DB: makeDb() }, {}, { question: 'anything?' })).body.fallback, true)
  const broken = { run: async () => { throw new Error('down') } }
  const res = await handleAsk({ BILLING_DB: makeDb(), AI: broken }, {}, { question: 'anything?' })
  assert.equal(res.status, 503)
  assert.equal(res.body.fallback, true)
  assert.equal((await handleAsk({ BILLING_DB: makeDb(), AI: fakeAi() }, {}, { question: '' })).status, 400)
})
