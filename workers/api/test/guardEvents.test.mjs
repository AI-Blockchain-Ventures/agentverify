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
