// Admin panel: only verified admin emails get in; users list shows how each person pays;
// granted plans work like real plans (including Team seats) and can be removed; signup profile is saved safely.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { isAdmin, adminGrant, adminUsers, adminOverview, adminImportFirebaseUsers } from '../dist/admin.mjs'
import { checkScanQuota } from '../dist/billing.mjs'
import { saveUserProfile, getUserProfile, touchUserProfile } from '../dist/userProfiles.mjs'

function makeDb() {
  const db = new DatabaseSync(':memory:')
  for (const f of ['billing.sql', 'team.sql', 'growth.sql', 'admin.sql']) db.exec(readFileSync(new URL(`../schema/${f}`, import.meta.url), 'utf8'))
  return { raw: db, prepare(q) { const s = db.prepare(q); let v = []; const api = { bind(...x) { v = x.map(y => (y === undefined ? null : y)); return api }, async first() { return s.get(...v) ?? null }, async run() { const r = s.run(...v); return { success: true, meta: { changes: Number(r.changes) } } }, async all() { return { results: s.all(...v) } } }; return api } }
}
const now = Math.floor(Date.now() / 1000)
const env = db => ({ BILLING_DB: db, ADMIN_EMAILS: 'Owner@Example.com, second@example.com' })

test('only verified admin emails are admins', () => {
  const e = env(null)
  assert.equal(isAdmin({ type: 'USER', uid: 'a', email: 'owner@example.com', emailVerified: true }, e), true)
  assert.equal(isAdmin({ type: 'USER', uid: 'a', email: 'owner@example.com', emailVerified: false }, e), false, 'unverified email is not enough')
  assert.equal(isAdmin({ type: 'USER', uid: 'a', email: 'someone@example.com', emailVerified: true }, e), false)
  assert.equal(isAdmin({ type: 'API_KEY', uid: 'a', apiKey: 'x' }, e), false, 'API keys never reach the admin panel')
  assert.equal(isAdmin(null, e), false)
  assert.equal(isAdmin({ type: 'USER', uid: 'a', email: 'owner@example.com', emailVerified: true }, { ADMIN_EMAILS: '' }), false, 'no admins configured means nobody')
})

test('granting Pro turns Pro on without Stripe, and removing it turns it off', async () => {
  const db = makeDb()
  const e = env(db)
  await touchUserProfile(db, 'partner', 'partner@acme.com', now)
  assert.equal((await checkScanQuota(e, 'partner')).plan, 'free')
  const res = await adminGrant(e, 'owner@example.com', { email: 'Partner@Acme.com', plan: 'pro', until: now + 30 * 86400, note: 'Launch partner' }, async () => null, now)
  assert.equal(res.status, 200)
  assert.equal((await checkScanQuota(e, 'partner')).plan, 'pro')
  const list = (await adminUsers(e, { filter: 'granted' }, now)).body
  assert.equal(list.total, 1)
  assert.equal(list.users[0].paidVia, 'granted')
  assert.equal(list.users[0].grantNote, 'Launch partner')
  assert.equal((await adminGrant(e, 'owner@example.com', { uid: 'partner', plan: 'none' }, async () => null, now)).status, 200)
  assert.equal((await checkScanQuota(e, 'partner')).plan, 'free')
})

test('grants: validation, expiry, unknown emails', async () => {
  const db = makeDb()
  const e = env(db)
  assert.equal((await adminGrant(e, 'o', { uid: 'u', plan: 'enterprise' }, async () => null, now)).status, 400)
  assert.equal((await adminGrant(e, 'o', { uid: 'u', plan: 'pro', until: now - 10 }, async () => null, now)).status, 400, 'end date in the past')
  assert.equal((await adminGrant(e, 'o', { uid: 'u', plan: 'team', seats: 1 }, async () => null, now)).status, 400, 'team needs 2+ seats')
  assert.equal((await adminGrant(e, 'o', { email: 'nobody@x.com', plan: 'pro' }, async () => null, now)).status, 404)
  assert.equal((await adminGrant(e, 'o', { email: 'firebase-only@x.com', plan: 'pro' }, async () => 'fb-uid', now)).status, 200, 'falls back to a Firebase lookup')
  db.raw.prepare('UPDATE plan_grants SET until = ? WHERE uid = ?').run(now - 1, 'fb-uid')
  assert.equal((await checkScanQuota(e, 'fb-uid')).plan, 'free', 'expired grant ends')
})

test('a granted Team plan covers its seats, like a paid one', async () => {
  const db = makeDb()
  const e = env(db)
  assert.equal((await adminGrant(e, 'o', { uid: 'owner', plan: 'team', seats: 3 }, async () => null, now)).status, 200)
  assert.equal(db.raw.prepare('SELECT seats FROM team_seats WHERE owner_uid = ?').get('owner').seats, 3)
  for (const m of ['m1', 'm2', 'm3']) db.raw.prepare('INSERT INTO team_members (owner_uid, member_uid, email, added_at) VALUES (?, ?, ?, ?)').run('owner', m, `${m}@x.com`, now)
  assert.equal((await checkScanQuota(e, 'owner')).plan, 'team')
  assert.equal((await checkScanQuota(e, 'm2')).plan, 'team')
  assert.equal((await checkScanQuota(e, 'm3')).plan, 'free', 'beyond the seats')
})

test('users list and overview show how each person pays', async () => {
  const db = makeDb()
  const e = env(db)
  await touchUserProfile(db, 'payer', 'payer@x.com', now - 30 * 86400)
  db.raw.prepare("INSERT INTO subscriptions (uid, plan, status, stripe_subscription_id, current_period_end, updated_at) VALUES ('payer', 'pro', 'active', 'sub_1', ?, 0)").run(now + 86400)
  await touchUserProfile(db, 'friend', 'friend@x.com', now)
  db.raw.prepare('INSERT INTO bonus_pro (uid, until, rewards, updated_at) VALUES (?, ?, 0, ?)').run('friend', now + 86400, now)
  db.raw.prepare('INSERT INTO referrals (referred_uid, referrer_uid, created_at) VALUES (?, ?, ?)').run('friend', 'payer', now)
  await touchUserProfile(db, 'free1', 'free1@x.com', now)
  const { users } = (await adminUsers(e, {}, now)).body
  const by = Object.fromEntries(users.map(u => [u.uid, u]))
  assert.equal(by.payer.paidVia, 'stripe')
  assert.equal(by.friend.paidVia, 'referral')
  assert.equal(by.friend.referredBy, 'payer@x.com')
  assert.equal(by.free1.plan, 'free')
  assert.equal((await adminUsers(e, { q: 'FRIEND' }, now)).body.total, 1, 'search ignores case')
  const o = (await adminOverview(e, now)).body
  assert.equal(o.totalUsers, 3)
  assert.equal(o.paying, 1)
  assert.equal(o.newThisWeek, 2)
  assert.equal(o.mrrCents, null, 'no Stripe key in tests: revenue is unknown, not $0')
})

test('signup profile: only allowed values are stored; skip just marks it done', async () => {
  const db = makeDb()
  await saveUserProfile(db, 'u', 'u@x.com', { name: '  Jordan\u0000 Lee ', company: 'Acme', role: 'hacker', teamSize: '2-10', building: ['mcp', 'evil', 'mcp'], heardFrom: 'reddit-hn' }, now)
  const p = await getUserProfile(db, 'u')
  assert.equal(p.name, 'Jordan  Lee')
  assert.equal(p.role, null, 'unknown role dropped')
  assert.deepEqual(p.building, ['mcp'])
  assert.equal(p.onboarded, true)
  await saveUserProfile(db, 'v', 'v@x.com', { skip: true }, now)
  assert.equal((await getUserProfile(db, 'v')).onboarded, true)
})

test('Firebase import adds accounts without overwriting details', async () => {
  const db = makeDb()
  await saveUserProfile(db, 'known', 'known@x.com', { name: 'Kept' }, now)
  const pages = [
    { users: [{ localId: 'known', email: 'known@x.com', createdAt: String((now - 100 * 86400) * 1000) }, { localId: 'old', email: 'old@x.com', createdAt: String((now - 200 * 86400) * 1000) }], nextPageToken: 'p2' },
    { users: [{ localId: 'older', email: 'older@x.com', createdAt: '1000' }] },
  ]
  let call = 0
  const res = await adminImportFirebaseUsers({ ...env(db), FIREBASE_PROJECT_ID: 'p', FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099', FIRESTORE_EMULATOR_HOST: 'localhost:8080' }, async () => new Response(JSON.stringify(pages[call++])))
  assert.equal(res.status, 200)
  assert.equal(res.body.imported, 3)
  assert.equal((await getUserProfile(db, 'known')).name, 'Kept')
  assert.equal(db.raw.prepare('SELECT created_at FROM user_profiles WHERE uid = ?').get('known').created_at, now - 100 * 86400, 'real signup date kept')
})
