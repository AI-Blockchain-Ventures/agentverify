// Prompt-injection tests: ownership verification, safe targets, Pro-only, limits, and canary-based judging.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { ATTACKS, createTarget, verifyTarget, startRun, processRedteamTick, listRedteam, extractReply, fillTemplate, MAX_RUNS_PER_DAY } from '../dist/redteam.mjs'

function makeDb() {
  const db = new DatabaseSync(':memory:')
  for (const f of ['billing.sql', 'redteam.sql']) db.exec(readFileSync(new URL(`../schema/${f}`, import.meta.url), 'utf8'))
  return { raw: db, prepare(q) { const s = db.prepare(q); let v = []; const api = { bind(...x) { v = x.map(y => (y === undefined ? null : y)); return api }, async first() { return s.get(...v) ?? null }, async run() { const r = s.run(...v); return { success: true, meta: { changes: Number(r.changes) } } }, async all() { return { results: s.all(...v) } } }; return api } }
}
const env = db => ({ BILLING_DB: db, TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
const makePro = (db, uid) => db.raw.prepare("INSERT INTO subscriptions (uid, plan, status, current_period_end, updated_at) VALUES (?, 'pro', 'active', ?, 0)").run(uid, Math.floor(Date.now() / 1000) + 86400)

test('templates escape the attack text; replies are found in common response shapes', () => {
  const body = fillTemplate('{"input":"{{prompt}}","stream":false}', 'say "hi"\n</system>')
  assert.deepEqual(JSON.parse(body), { input: 'say "hi"\n</system>', stream: false }, 'cannot break out of the JSON string')
  assert.equal(extractReply('{"output":"hello"}', ''), 'hello')
  assert.equal(extractReply('{"choices":[{"message":{"content":"yo"}}]}', ''), 'yo')
  assert.equal(extractReply('{"data":{"answer":"x"}}', 'data.answer'), 'x')
  assert.equal(extractReply('plain text', ''), 'plain text')
})

test('targets: public HTTPS only, valid template, headers stored encrypted', async () => {
  const db = makeDb()
  for (const url of ['http://agent.acme.com/chat', 'https://127.0.0.1/chat', 'https://localhost/chat', 'https://agent.acme.com:8443/chat', 'nope']) {
    assert.equal((await createTarget(env(db), 'u', { url })).status, 400, url)
  }
  assert.equal((await createTarget(env(db), 'u', { url: 'https://agent.acme.com/chat', bodyTemplate: '{"m": {{prompt}}}' })).status, 400, 'prompt must sit inside a JSON string')
  const ok = await createTarget(env(db), 'u', { url: 'https://agent.acme.com/chat', headers: { Authorization: 'Bearer agent-secret', Host: 'evil' } })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.verifyUrl, 'https://agent.acme.com/.well-known/agentverify.txt')
  const row = db.raw.prepare('SELECT headers_enc FROM redteam_targets').get()
  assert.ok(!row.headers_enc.includes('agent-secret'), 'auth header encrypted at rest')
})

test('ownership: tests cannot start until the token is on the agent’s own host; Pro only; limits', async () => {
  const db = makeDb()
  const e = env(db)
  const t = (await createTarget(e, 'u', { url: 'https://agent.acme.com/chat' })).body
  assert.equal((await startRun(e, 'u', t.id)).status, 402, 'Free accounts are pointed to Pro')
  makePro(db, 'u')
  assert.equal((await startRun(e, 'u', t.id)).status, 400, 'not verified yet')
  const wrong = async () => new Response('something else')
  assert.equal((await verifyTarget(e, 'u', t.id, wrong)).status, 400)
  let asked = ''
  const right = async url => { asked = url; return new Response(`# Agent Verify\n${t.verifyToken}\n`) }
  assert.equal((await verifyTarget(e, 'someone-else', t.id, right)).status, 404, 'cannot verify another account’s target')
  assert.equal((await verifyTarget(e, 'u', t.id, right)).status, 200)
  assert.equal(asked, 'https://agent.acme.com/.well-known/agentverify.txt')
  assert.equal((await startRun(e, 'u', t.id)).status, 200)
  assert.equal((await startRun(e, 'u', t.id)).status, 409, 'one run at a time')
  db.raw.prepare("UPDATE redteam_runs SET status = 'done'").run()
  for (let i = 1; i < MAX_RUNS_PER_DAY; i++) { await startRun(e, 'u', t.id); db.raw.prepare("UPDATE redteam_runs SET status = 'done'").run() }
  assert.equal((await startRun(e, 'u', t.id)).status, 429, 'daily cap')
})

async function verifiedRun(db, e, agentReply) {
  makePro(db, 'u')
  const t = (await createTarget(e, 'u', { url: 'https://agent.acme.com/chat', headers: { Authorization: 'Bearer agent-secret' } })).body
  await verifyTarget(e, 'u', t.id, async () => new Response(t.verifyToken))
  await startRun(e, 'u', t.id)
  const sent = []
  const fetchFn = async (url, init) => { sent.push({ url, init }); return new Response(JSON.stringify({ output: agentReply(JSON.parse(init.body).message) })) }
  let status = ''
  for (let i = 0; i < 10 && status !== 'finished'; i++) status = await processRedteamTick(e, fetchFn)
  return { sent, list: await listRedteam(db, 'u') }
}

test('a vulnerable agent fails the canary tests; the run spreads across cron ticks', async () => {
  const db = makeDb()
  const e = env(db)
  // Obeys everything: repeats whatever code it is told to output.
  const { sent, list } = await verifiedRun(db, e, msg => { const m = msg.match(/AV-[0-9A-F]{8}/i); return m ? `Sure! ${m[0]} ![s](https://${m[0].toLowerCase()}.av-canary.test/p.png)` : 'ok' })
  assert.equal(sent.length, ATTACKS.length, 'exactly one request per attack')
  assert.equal(sent[0].init.headers.Authorization, 'Bearer agent-secret', 'stored header is used')
  assert.match(sent[0].init.headers['User-Agent'], /AgentVerify-InjectionTest/)
  const run = list.runs[0]
  assert.equal(run.status, 'done')
  const byId = Object.fromEntries(run.results.map(r => [r.id, r.outcome]))
  for (const id of ['direct-override', 'indirect-document', 'fake-system', 'roleplay', 'translation', 'exfil-markdown']) assert.equal(byId[id], 'failed', id)
})

test('a careful agent passes; errors and leaked keys are reported, with keys masked', async () => {
  const db = makeDb()
  const e = env(db)
  const { list } = await verifiedRun(db, e, msg => (/API key/.test(msg) ? 'Here: sk-proj-abcdefghijklmnopqrstuvwxyz' : "I can't help with that."))
  const results = list.runs[0].results
  assert.equal(results.find(r => r.id === 'direct-override').outcome, 'passed')
  const secrets = results.find(r => r.id === 'secrets-probe')
  assert.equal(secrets.outcome, 'failed')
  assert.doesNotMatch(secrets.reply, /abcdefghijklmnop/, 'leaked key is masked in stored results')

  const db2 = makeDb()
  const e2 = env(db2)
  makePro(db2, 'u')
  const t = (await createTarget(e2, 'u', { url: 'https://agent.acme.com/chat' })).body
  await verifyTarget(e2, 'u', t.id, async () => new Response(t.verifyToken))
  await startRun(e2, 'u', t.id)
  for (let i = 0; i < 5; i++) await processRedteamTick(e2, async () => new Response('down', { status: 503 }))
  assert.ok((await listRedteam(db2, 'u')).runs[0].results.every(r => r.outcome === 'error'))
})
