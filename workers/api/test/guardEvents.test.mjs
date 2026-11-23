// Agent Guard events: validation, server-side secret masking, clock clamping, retention, per-account isolation.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { storeGuardEvents, listGuardEvents, MAX_EVENTS_PER_REQUEST } from '../dist/guardEvents.mjs'
import worker from '../dist/worker.mjs'

function makeDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync(new URL('../schema/guard.sql', import.meta.url), 'utf8'))
  return { raw: db, prepare(q) { const s = db.prepare(q); let v = []; const api = { bind(...x) { v = x; return api }, async first() { return s.get(...v) ?? null }, async run() { const r = s.run(...v); return { success: true, meta: { changes: Number(r.changes) } } }, async all() { return { results: s.all(...v) } } }; return api } }
}
const NOW = Date.parse('2026-10-30T12:00:00Z')
const ev = (o = {}) => ({ agent: 'bot', tool: 'send_email', decision: 'blocked', reason: 'not allowed', argsPreview: '{"to":"x"}', at: '2026-10-30T11:59:00Z', ...o })

test('stores valid events; skips junk; caps request size', async () => {
  const db = makeDb()
  const res = await storeGuardEvents(db, 'u1', { events: [ev(), ev({ decision: 'nonsense' }), ev({ tool: '' }), 'x', null] }, NOW)
  assert.deepEqual(res.body, { stored: 1 })
  assert.equal((await storeGuardEvents(db, 'u1', { events: 'no' }, NOW)).status, 400)
  assert.equal((await storeGuardEvents(db, 'u1', { events: Array.from({ length: MAX_EVENTS_PER_REQUEST + 1 }, () => ev()) }, NOW)).status, 413)
})

test('secrets are masked again on the server; text is clipped', async () => {
  const db = makeDb()
  await storeGuardEvents(db, 'u1', { events: [ev({ argsPreview: 'key sk-proj-abcdefghijklmnopqrstuvwxyz -----BEGIN RSA PRIVATE KEY-----abc', reason: 'r'.repeat(1000) })] }, NOW)
  const row = db.raw.prepare('SELECT args_preview, reason FROM guard_events').get()
  assert.doesNotMatch(row.args_preview, /abcdefghijklmnop|BEGIN RSA/)
  assert.equal(row.reason.length, 300)
})

test('client clocks are clamped; old events expire; accounts only see their own', async () => {
  const db = makeDb()
  await storeGuardEvents(db, 'u1', { events: [ev({ at: '2099-01-01T00:00:00Z' }), ev({ at: 'garbage' })] }, NOW)
  assert.ok(db.raw.prepare('SELECT MAX(at_ms) AS m FROM guard_events').get().m <= NOW, 'future timestamps are clamped')
  db.raw.prepare("INSERT INTO guard_events (uid, agent, tool, decision, reason, args_preview, at_ms, received_ms) VALUES ('u1','bot','t','allowed','r','{}',?,0)").run(NOW - 40 * 86400_000)
  await storeGuardEvents(db, 'u2', { events: [ev({ decision: 'approved' })] }, NOW)
  await storeGuardEvents(db, 'u1', { events: [ev({ decision: 'allowed' })] }, NOW)
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM guard_events WHERE uid = 'u1' AND at_ms < ?").get(NOW - 30 * 86400_000).n, 0, 'older than 30 days removed')
  const list = await listGuardEvents(db, 'u1', {}, NOW)
  assert.equal(list.events.length, 3)
  assert.ok(list.events.every(e => e.agent === 'bot'))
  assert.equal(list.last7Days.blocked, 2)
  assert.equal(list.last7Days.approved, 0, 'u2’s events are not counted')
  assert.equal((await listGuardEvents(db, 'u1', { decision: 'allowed' }, NOW)).events.length, 1)
})

test('route requires authentication', async () => {
  assert.equal((await worker.fetch(new Request('https://api.test/v1/guard/events', { method: 'POST', body: '{}' }), {})).status, 401)
  assert.equal((await worker.fetch(new Request('https://api.test/v1/guard/events'), {})).status, 401)
})

test('coding-agent guard: "asked a person" decisions are stored and counted', async () => {
  const db = makeDb()
  const res = await storeGuardEvents(db, 'u1', { events: [ev({ decision: 'asked', agent: 'Claude Code · app · laptop', tool: 'Bash', argsPreview: 'shell: npm install left-pad' })] }, NOW)
  assert.equal(res.body.stored, 1)
  const list = await listGuardEvents(db, 'u1', {}, NOW)
  assert.equal(list.last7Days.asked, 1)
  assert.equal(list.events[0].decision, 'asked')
})

// Live activity for teams: the Team owner sees everyone on the team; members see only their own and are told
// the owner can see it; nobody can peek at someone outside their team with the person filter.
test('team activity: owner sees the whole team, labelled by person; members see their own', async () => {
  const { activityScope } = await import('../dist/guardEvents.mjs')
  const { addMember } = await import('../dist/team.mjs')
  const raw = new DatabaseSync(':memory:')
  for (const f of ['billing.sql', 'team.sql', 'guard.sql']) raw.exec(readFileSync(new URL(`../schema/${f}`, import.meta.url), 'utf8'))
  const db = { prepare(q) { const s = raw.prepare(q); let v = []; const api = { bind(...x) { v = x.map(y => (y === undefined ? null : typeof y === 'boolean' ? Number(y) : y)); return api }, async first() { return s.get(...v) ?? null }, async run() { const r = s.run(...v); return { success: true, meta: { changes: Number(r.changes) } } }, async all() { return { results: s.all(...v) } } }; return api } }
  const env = { BILLING_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec_test', STRIPE_PRO_PRICE_ID: 'price_pro', STRIPE_TEAM_PRICE_ID: 'price_team_test', BILLING_SUCCESS_URL: 'https://x/s', BILLING_CANCEL_URL: 'https://x/c', FIREBASE_PROJECT_ID: 'agentverify-test', BILLING_DB: db }
  const payload = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated', created: 1_800_000_001, data: { object: { object: 'subscription', id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { uid: 'owner' }, current_period_end: 1_900_000_000, items: { data: [{ price: { id: 'price_team_test' }, quantity: 3 }] } } } })
  const t = Math.floor(Date.now() / 1000)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('whsec_test'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`))
  assert.equal((await worker.fetch(new Request('https://api.test/v1/billing/webhook', { method: 'POST', headers: { 'Stripe-Signature': `t=${t},v1=${Buffer.from(digest).toString('hex')}` }, body: payload }), env)).status, 200)
  await addMember('owner', { email: 'dev-a@company.test' }, env, { resolveUid: async () => 'member-a' })

  await storeGuardEvents(db, 'owner', { events: [ev({ agent: 'Claude Code · api · owner-laptop', decision: 'allowed' })] }, NOW)
  await storeGuardEvents(db, 'member-a', { events: [ev({ agent: 'Cursor · web · a-laptop', decision: 'blocked' }), ev({ agent: 'Cursor · web · a-laptop', decision: 'asked' })] }, NOW)
  await storeGuardEvents(db, 'outsider', { events: [ev({ agent: 'secret project', decision: 'blocked' })] }, NOW)

  const ownerScope = await activityScope(env, 'owner')
  assert.equal(ownerScope.scope, 'team')
  const all = await listGuardEvents(db, ownerScope, {}, NOW)
  assert.equal(all.events.length, 3, 'owner + member, never the outsider')
  assert.deepEqual(new Set(all.events.map(e => e.person)), new Set(['You', 'dev-a@company.test']))
  assert.equal(all.last7Days.blocked, 1)
  const a = all.people.find(p => p.label === 'dev-a@company.test')
  assert.deepEqual(a.today, { total: 2, blocked: 1, asked: 1 })
  assert.equal((await listGuardEvents(db, ownerScope, { person: 'member-a' }, NOW)).events.length, 2)
  assert.equal((await listGuardEvents(db, ownerScope, { person: 'outsider' }, NOW)).events.length, 3, 'a person outside the team is ignored, not shown')

  const memberScope = await activityScope(env, 'member-a')
  assert.equal(memberScope.visibleToOwner, true)
  const mine = await listGuardEvents(db, memberScope, { person: 'owner' }, NOW)
  assert.equal(mine.events.length, 2, 'a member never sees the owner or other members')
  assert.deepEqual(mine.people, [])
  assert.equal((await activityScope(env, 'solo')).scope, 'own')
})
