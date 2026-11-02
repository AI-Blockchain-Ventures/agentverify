// Slack: signed requests only, quick reply then result to response_url, free limit, workspace linking.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { verifySlackSignature, parseGithubRepo, handleSlackCommand, linkSlackTeam, SLACK_FREE_SCANS } from '../dist/slack.mjs'

const SECRET = 'slack-signing-secret'
function makeDb() {
  const db = new DatabaseSync(':memory:')
  for (const f of ['billing.sql', 'slack.sql']) db.exec(readFileSync(new URL(`../schema/${f}`, import.meta.url), 'utf8'))
  return { raw: db, prepare(q) { const s = db.prepare(q); let v = []; const api = { bind(...x) { v = x; return api }, async first() { return s.get(...v) ?? null }, async run() { const r = s.run(...v); return { success: true, meta: { changes: Number(r.changes) } } }, async all() { return { results: s.all(...v) } } }; return api } }
}
const NOW = 1_800_000_000
function slackRequest(params, { secret = SECRET, ts = NOW } = {}) {
  const body = new URLSearchParams({ team_id: 'T12345', team_domain: 'acme', response_url: 'https://hooks.slack.com/commands/T1/1/abc', ...params }).toString()
  const sig = 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex')
  return new Request('https://api.test/v1/slack/command', { method: 'POST', headers: { 'x-slack-request-timestamp': String(ts), 'x-slack-signature': sig, 'content-type': 'application/x-www-form-urlencoded' }, body })
}
const AGENT = "import { tool } from 'ai'\nconst tools = { send_email }\nconst agent = new Agent({ tools })\n"
function fakeFetch() {
  const posted = []
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url)
    if (u.hostname === 'hooks.slack.com') { posted.push(JSON.parse(init.body)); return new Response('ok') }
    if (u.pathname === '/repos/acme/bot') return new Response(JSON.stringify({ default_branch: 'main', private: false }))
    if (u.pathname === '/repos/acme/secret') return new Response('{}', { status: 404 })
    if (u.pathname.includes('/git/trees/')) return new Response(JSON.stringify({ tree: [{ path: 'src/agent.ts', type: 'blob', size: 50 }, { path: 'logo.png', type: 'blob', size: 5 }] }))
    if (u.hostname === 'raw.githubusercontent.com') return new Response(AGENT)
    return new Response('unexpected', { status: 500 })
  }
  return { fetchFn, posted }
}
const scanFn = () => ({ verdict: 'NOT_VERIFIED', riskScore: 45, findings: [{ id: 'a', code: 'X', title: 'Email to anyone', category: 'B', severity: 'high', whatIsWrong: 'no allowlist', whyItMatters: 'w', recommendedFix: 'Restrict recipients', fixLocked: false }] })
const env = db => ({ BILLING_DB: db, SLACK_SIGNING_SECRET: SECRET })

test('signature: valid, tampered, stale and missing', async () => {
  const body = 'a=1'
  const sig = 'v0=' + createHmac('sha256', SECRET).update(`v0:${NOW}:${body}`).digest('hex')
  assert.equal(await verifySlackSignature(SECRET, body, String(NOW), sig, NOW), true)
  assert.equal(await verifySlackSignature(SECRET, 'a=2', String(NOW), sig, NOW), false)
  assert.equal(await verifySlackSignature(SECRET, body, String(NOW - 600), sig, NOW), false, 'replays older than 5 minutes are refused')
  assert.equal(await verifySlackSignature(SECRET, body, null, sig, NOW), false)
})

test('GitHub links are parsed; anything else is treated as pasted code', () => {
  assert.deepEqual(parseGithubRepo('https://github.com/acme/bot'), { owner: 'acme', repo: 'bot', path: '' })
  assert.deepEqual(parseGithubRepo('<https://github.com/acme/bot/tree/main/agents/support>'), { owner: 'acme', repo: 'bot', path: 'agents/support' })
  assert.equal(parseGithubRepo('https://evil.com/acme/bot'), null)
  assert.equal(parseGithubRepo('const x = 1'), null)
})

test('scan: replies at once, then posts the result to Slack', async () => {
  const db = makeDb()
  const f = fakeFetch()
  const pending = []
  const res = await handleSlackCommand(slackRequest({ text: 'scan https://github.com/acme/bot' }), env(db), { waitUntil: p => pending.push(p) }, { fetchFn: f.fetchFn, scanFn, now: () => NOW * 1000 })
  assert.equal(res.status, 200)
  assert.match((await res.json()).text, /Scanning https:\/\/github\.com\/acme\/bot/)
  await Promise.all(pending)
  assert.equal(f.posted[0].response_type, 'in_channel')
  const text = JSON.stringify(f.posted[0].blocks)
  assert.match(text, /security score \*45\/100\*/)
  assert.match(text, /Email to anyone/)
  assert.match(text, /\/agentverify connect/, 'unlinked workspaces are told how to link')
})

test('errors and limits are told privately; bad signatures refused', async () => {
  const db = makeDb()
  const f = fakeFetch()
  const pending = []
  await handleSlackCommand(slackRequest({ text: 'scan https://github.com/acme/secret' }), env(db), { waitUntil: p => pending.push(p) }, { fetchFn: f.fetchFn, scanFn, now: () => NOW * 1000 })
  await Promise.all(pending)
  assert.equal(f.posted[0].response_type, 'ephemeral')
  assert.match(f.posted[0].text, /not found or is private/)
  db.raw.prepare("INSERT INTO slack_usage (team_id, month, scan_count) VALUES ('T12345', ?, ?)").run(new Date(NOW * 1000).toISOString().slice(0, 7), SLACK_FREE_SCANS)
  const f2 = fakeFetch()
  const p2 = []
  await handleSlackCommand(slackRequest({ text: 'scan https://github.com/acme/bot' }), env(db), { waitUntil: p => p2.push(p) }, { fetchFn: f2.fetchFn, scanFn, now: () => NOW * 1000 })
  await Promise.all(p2)
  assert.match(f2.posted[0].text, /used its 20 Slack scans/)
  assert.equal((await handleSlackCommand(slackRequest({ text: 'help' }, { secret: 'wrong' }), env(db), { waitUntil() {} }, { now: () => NOW * 1000 })).status, 401)
  assert.equal((await handleSlackCommand(slackRequest({ text: 'help' }), {}, { waitUntil() {} })).status, 503)
})

test('connect: one-time link code, 15 minutes, links the workspace to the signed-in account', async () => {
  const db = makeDb()
  const res = await handleSlackCommand(slackRequest({ text: 'connect' }), env(db), { waitUntil() {} }, { now: () => NOW * 1000 })
  const link = (await res.json()).text.match(/slack_link=([0-9a-f]{32})/)[1]
  assert.equal((await linkSlackTeam(env(db), 'u1', 'nothex')).status, 400)
  assert.equal((await linkSlackTeam(env(db), 'u1', link, Date.now())).status, 200)
  assert.equal(db.raw.prepare("SELECT linked_uid FROM slack_teams WHERE team_id = 'T12345'").get().linked_uid, 'u1')
  assert.equal((await linkSlackTeam(env(db), 'u2', link)).status, 410, 'a code works once')
})
