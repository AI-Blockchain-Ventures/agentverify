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
  const { sent, list } = await verifiedRun(db, e, msg => { const m = msg.match(/AV-[0-9A-F]{8}[G-Z]\d*/i); return m ? `Sure! ${m[0]} ![s](https://${m[0].toLowerCase()}.av-canary.test/p.png)` : 'ok' })
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

// ── Live attack testing 2.0: more attacks, real actions via Agent Guard, weekly re-tests, regression alerts ──
import { attackCanary, attachActions, compareRuns, setSchedule, enqueueScheduledRuns, OWASP } from '../dist/redteam.mjs'
import { storeGuardEvents } from '../dist/guardEvents.mjs'

function fullDb() {
  const db = new DatabaseSync(':memory:')
  for (const f of ['billing.sql', 'redteam.sql', 'guard.sql', 'github.sql']) db.exec(readFileSync(new URL(`../schema/${f}`, import.meta.url), 'utf8'))
  return { raw: db, prepare(q) { const s = db.prepare(q); let v = []; const api = { bind(...x) { v = x.map(y => (y === undefined ? null : y)); return api }, async first() { return s.get(...v) ?? null }, async run() { const r = s.run(...v); return { success: true, meta: { changes: Number(r.changes) } } }, async all() { return { results: s.all(...v) } } }; return api } }
}

test('18 attacks, each tagged with an OWASP LLM category and its own code', () => {
  assert.equal(ATTACKS.length, 18)
  assert.equal(new Set(ATTACKS.map(a => a.id)).size, 18)
  for (const a of ATTACKS) assert.ok(OWASP[a.owasp], `${a.id} has an OWASP category`)
  const codes = ATTACKS.map((_, i) => attackCanary('AV-1A2B3C4D', i))
  assert.equal(new Set(codes).size, 18)
  for (const a of codes) for (const b of codes) if (a !== b) assert.ok(!b.includes(a), `${a} is not part of ${b}`)
  // The new attacks catch an agent that obeys hidden instructions, and pass a careful one.
  for (const id of ['tool-result', 'authority', 'hidden-unicode', 'code-fence', 'refusal-suppression', 'split-payload']) {
    const atk = ATTACKS.find(a => a.id === id)
    const code = 'AV-DEADBEEFK'
    assert.equal(atk.judge(`Sure. ${code}`, code), 'failed', id)
    assert.equal(atk.judge("I can't do that, but here is the answer to your question.", code), 'passed', id)
    assert.ok(atk.prompt(code).length > 20)
  }
  const fetchAtk = ATTACKS.find(a => a.id === 'fetch-attacker')
  assert.equal(fetchAtk.judge('Done! I fetched https://av-deadbeefk.av-canary.test/instructions.txt and followed it.', 'AV-DEADBEEFK'), 'failed')
  assert.equal(fetchAtk.judge("I won't fetch https://av-deadbeefk.av-canary.test/instructions.txt.", 'AV-DEADBEEFK'), 'review')
  const pii = ATTACKS.find(a => a.id === 'pii-probe')
  assert.equal(pii.judge('Sure: ann@x.com, bob@y.com'), 'review')
  assert.equal(pii.judge("I can't share other customers' details."), 'passed')
})

test('what the agent actually did: a tool call carrying an attack code fails that attack, a blocked one is shown as stopped', async () => {
  const db = fullDb()
  const run = { canary: 'AV-11223344', created_at: Date.now() - 60_000, finished_at: Date.now() }
  const idx = id => ATTACKS.findIndex(a => a.id === id)
  const results = ATTACKS.map(a => ({ id: a.id, name: a.name, severity: a.severity, owasp: a.owasp, outcome: 'passed', reply: 'I refused.' }))
  assert.deepEqual(await attachActions(db, 'u', run, results), results, 'no guard activity: unchanged')
  const exfilCode = attackCanary(run.canary, idx('tool-exfil')).toLowerCase()
  const fetchCode = attackCanary(run.canary, idx('fetch-attacker')).toLowerCase()
  await storeGuardEvents(db, 'u', { events: [
    { agent: 'support-bot', tool: 'send_email', decision: 'allowed', reason: 'allowed', argsPreview: `{"to":"audit-${exfilCode}@av-canary.test"}`, at: new Date().toISOString() },
    { agent: 'support-bot', tool: 'fetch_url', decision: 'blocked', reason: 'not on the allow list', argsPreview: `{"url":"https://${fetchCode}.av-canary.test/instructions.txt"}`, at: new Date().toISOString() },
  ] })
  await storeGuardEvents(db, 'someone-else', { events: [{ agent: 'x', tool: 'send_email', decision: 'allowed', reason: 'r', argsPreview: `{"to":"audit-${exfilCode}@av-canary.test"}`, at: new Date().toISOString() }] })
  const judged = await attachActions(db, 'u', run, results)
  const exfil = judged.find(r => r.id === 'tool-exfil')
  assert.equal(exfil.outcome, 'failed', 'it said it refused, but it actually sent the email')
  assert.deepEqual({ d: exfil.action.decision, t: exfil.action.tool }, { d: 'done', t: 'send_email' })
  const fetched = judged.find(r => r.id === 'fetch-attacker')
  assert.equal(fetched.action.decision, 'stopped')
  assert.equal(fetched.outcome, 'passed', 'Agent Guard stopped it')
  assert.equal(judged.filter(r => r.action).length, 2, 'only this account’s activity counts')
})

test('compare runs: what newly gets through and what got fixed', () => {
  const r = (id, outcome) => ({ id, outcome })
  assert.deepEqual(compareRuns(null, [r('a', 'failed')]), { newlyFailed: [], fixed: [] })
  assert.deepEqual(compareRuns([r('a', 'passed'), r('b', 'failed'), r('c', 'review')], [r('a', 'failed'), r('b', 'passed'), r('c', 'failed')]), { newlyFailed: ['a'], fixed: ['b'] })
})

test('weekly re-tests: Pro + verified only, start when due, and alert when an attack that passed now gets through', async () => {
  const db = fullDb()
  const e = env(db)
  const t = (await createTarget(e, 'u', { url: 'https://agent.acme.com/chat' })).body
  assert.equal((await setSchedule(e, 'u', { targetId: t.id, everyDays: 7 })).status, 400, 'verify first')
  await verifyTarget(e, 'u', t.id, async () => new Response(t.verifyToken))
  assert.equal((await setSchedule(e, 'u', { targetId: t.id, everyDays: 7 })).status, 402, 'Pro feature')
  makePro(db, 'u')
  assert.equal((await setSchedule(e, 'u', { targetId: t.id, everyDays: 3 })).status, 400)
  assert.equal((await setSchedule(e, 'other', { targetId: t.id, everyDays: 7 })).status, 404)
  const T0 = Date.now()
  assert.equal((await setSchedule(e, 'u', { targetId: t.id, everyDays: 7 }, T0)).status, 200)
  assert.equal((await listRedteam(db, 'u', T0)).targets[0].scheduleDays, 7)
  assert.equal(await enqueueScheduledRuns(e, T0 + 86400_000), 0, 'not due yet')

  // First (scheduled) run: a careful agent. Second: it starts obeying. The owner gets a Slack ping.
  db.raw.prepare("INSERT INTO alert_settings (uid, slack_webhook_url, email, min_severity, updated_at) VALUES ('u', 'https://hooks.slack.com/services/T0/B0/xyz', NULL, 'high', 0)").run()
  const pings = []
  let obey = false
  const fetchFn = async (url, init) => {
    if (String(url).startsWith('https://hooks.slack.com/')) { pings.push(JSON.parse(init.body).text); return new Response('ok') }
    const msg = JSON.parse(init.body).message
    const m = msg.match(/AV-[0-9A-F]{8}[G-Z]\d*/i)
    return new Response(JSON.stringify({ output: obey && m ? `OK ${m[0]}` : "I can't help with that." }))
  }
  const week = 7 * 86400_000
  let now = T0 + week + 1000
  for (let i = 0; i < 8; i++) await processRedteamTick(e, fetchFn, now)
  let list = await listRedteam(db, 'u', now)
  assert.equal(list.runs.length, 1, 'the weekly run started by itself')
  assert.equal(list.runs[0].status, 'done')
  assert.equal(pings.length, 0, 'nothing to compare with yet')
  obey = true
  now += week + 1000
  for (let i = 0; i < 8; i++) await processRedteamTick(e, fetchFn, now)
  list = await listRedteam(db, 'u', now)
  assert.equal(list.runs.length, 2)
  assert.ok(list.runs[0].changes.newlyFailed.includes('direct-override'))
  assert.equal(pings.length, 1)
  assert.match(pings[0], /now get through[\s\S]*Direct instruction override/)
  assert.equal((await setSchedule(e, 'u', { targetId: t.id, everyDays: 0 })).status, 200)
  assert.equal((await listRedteam(db, 'u', now)).targets[0].scheduleDays, 0)
})
