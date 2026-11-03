// 2.0 operations: error reports + admin alerts, feedback, signup funnel, welcome emails.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { bumpCounter, funnel, isNoise, listErrors, onboardingUnsubscribe, recordError, safePath, saveFeedback, sendOnboardingBatch } from '../dist/ops.mjs'

function makeDb() {
  const db = new DatabaseSync(':memory:')
  for (const f of ['billing.sql', 'admin.sql', 'github.sql', 'vcs.sql', 'ops.sql']) db.exec(readFileSync(new URL(`../schema/${f}`, import.meta.url), 'utf8'))
  return {
    raw: db,
    prepare(q) {
      const stmt = db.prepare(q)
      let vals = []
      const api = {
        bind(...v) { vals = v.map(x => (x === undefined ? null : typeof x === 'boolean' ? Number(x) : x)); return api },
        async first() { return stmt.get(...vals) ?? null },
        async run() { const r = stmt.run(...vals); return { success: true, meta: { changes: Number(r.changes) } } },
        async all() { return { results: stmt.all(...vals) } },
      }
      return api
    },
  }
}
const mailer = () => {
  const sent = []
  return { sent, fetch: async (url, init) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }) } }
}
const env = (db, extra = {}) => ({ BILLING_DB: db, ADMIN_EMAILS: 'owner@example.com', RESEND_API_KEY: 're_test', ALERT_FROM_EMAIL: 'Agent Verify <hi@example.com>', ...extra })
const now = 1_800_000_000
const DAY = 86400

test('errors: grouped by fingerprint, admin emailed once, noise and query strings dropped', async () => {
  const db = makeDb()
  const m = mailer()
  const report = { source: 'web', message: 'Cannot read properties of undefined (reading x)', stack: 'TypeError\n    at f (https://site/app.js:10:5)', path: '/dashboard/?slack_link=secret#x' }
  assert.equal(await recordError(env(db), report, m.fetch, now), 'recorded')
  assert.equal(await recordError(env(db), report, m.fetch, now + 5), 'recorded')
  const rows = await listErrors(db)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].count, 2)
  assert.equal(rows[0].path, '/dashboard/', 'query string and hash are stripped')
  assert.equal(m.sent.length, 1, 'only the first occurrence emails the admin')
  assert.deepEqual(m.sent[0].body.to, ['owner@example.com'])
  assert.equal(await recordError(env(db), { source: 'web', message: 'ResizeObserver loop completed with undelivered notifications.' }, m.fetch, now), 'ignored')
  assert.equal(isNoise('x', 'at chrome-extension://abc/content.js'), true)
  assert.equal(safePath('/a?b=1'), '/a')
})

test('errors: alert emails are capped at 10 an hour', async () => {
  const db = makeDb()
  const m = mailer()
  for (let i = 0; i < 15; i++) await recordError(env(db), { source: 'api', message: `Boom ${String.fromCharCode(65 + i)}`, stack: `at x${i} (w.js)` }, m.fetch, now)
  assert.equal(m.sent.length, 10)
})

test('feedback: saved, emailed with reply-to, and validated', async () => {
  const db = makeDb()
  const m = mailer()
  assert.equal((await saveFeedback(env(db), 'u1', 'user@x.com', { message: 'hi' }, m.fetch, now)).status, 400)
  const ok = await saveFeedback(env(db), 'u1', 'user@x.com', { kind: 'bug', message: 'The PDF button does nothing', page: '/dashboard/?tab=reports' }, m.fetch, now)
  assert.equal(ok.status, 200)
  const row = db.raw.prepare('SELECT * FROM feedback').get()
  assert.equal(row.kind, 'bug')
  assert.equal(row.page, '/dashboard/')
  assert.equal(m.sent[0].body.headers['Reply-To'], 'user@x.com')
  assert.match(m.sent[0].body.html, /The PDF button does nothing/)
  await saveFeedback(env(db), 'u1', 'user@x.com', { kind: 'nonsense', message: '<script>x</script>' }, m.fetch, now)
  assert.equal(db.raw.prepare("SELECT kind FROM feedback WHERE message LIKE '<script>%'").get().kind, 'other')
  assert.doesNotMatch(m.sent[1].body.html, /<script>/, 'message is HTML-escaped in the email')
})

test('funnel counts each step for accounts created in the window', async () => {
  const db = makeDb()
  for (let i = 0; i < 3; i++) await bumpCounter(db, 'demo_scan', (now - DAY) * 1000)
  const add = (uid, created, verified) => db.raw.prepare('INSERT INTO user_profiles (uid, email, email_verified, created_at) VALUES (?, ?, ?, ?)').run(uid, `${uid}@x.com`, verified, created)
  add('a', now - DAY, 1); add('b', now - 2 * DAY, 1); add('c', now - 3 * DAY, 0); add('old', now - 90 * DAY, 1)
  db.raw.prepare("INSERT INTO usage_monthly (uid, month, scan_count, updated_at) VALUES ('a', '2027-01', 3, 0), ('b', '2027-01', 1, 0), ('old', '2027-01', 9, 0)").run()
  db.raw.prepare("INSERT INTO github_installations (installation_id, account_login, account_type, linked_uid, created_at, updated_at) VALUES (1, 'acme', 'Organization', 'a', 0, 0)").run()
  db.raw.prepare("INSERT INTO subscriptions (uid, plan, status, updated_at) VALUES ('a', 'pro', 'active', 0)").run()
  const f = await funnel(db, 30, now)
  const by = Object.fromEntries(f.steps.map(s => [s.id, s.count]))
  assert.deepEqual(by, { demo: 3, signup: 3, verified: 2, scanned: 2, connected: 1, paying: 1 })
  assert.equal(f.daily.length, 30)
})

test('welcome emails: verified new accounts only, one step at a time, skips, opt-out, never twice', async () => {
  const db = makeDb()
  const m = mailer()
  const on = env(db, { ONBOARDING_EMAILS: 'true' })
  const add = (uid, created, verified) => db.raw.prepare('INSERT INTO user_profiles (uid, email, email_verified, created_at) VALUES (?, ?, ?, ?)').run(uid, `${uid}@x.com`, verified, created)
  add('new', now - 3600, 1)            // due for step 1
  add('fresh', now - 60, 1)            // too soon (10 minutes)
  add('unverified', now - 3600, 0)     // never emailed
  add('imported', now - 60 * DAY, 1)   // old account from "Sync from Firebase"
  assert.equal(await sendOnboardingBatch(env(db), m.fetch, now), 0, 'off unless ONBOARDING_EMAILS is "true"')
  assert.equal(await sendOnboardingBatch(on, m.fetch, now), 1)
  assert.deepEqual(m.sent.map(s => s.body.to[0]), ['new@x.com'])
  assert.match(m.sent[0].body.subject, /Welcome/)
  assert.match(m.sent[0].body.headers['List-Unsubscribe'], /onboarding\/unsubscribe\?token=[0-9a-f]{32}/)
  assert.equal(await sendOnboardingBatch(on, m.fetch, now + 60), 0, 'step 1 is not repeated')
  // Two days later 'new' has already connected a repo: step 2 is marked done without an email.
  db.raw.prepare("INSERT INTO github_installations (installation_id, account_login, account_type, linked_uid, created_at, updated_at) VALUES (9, 'x', 'User', 'new', 0, 0)").run()
  assert.equal(await sendOnboardingBatch(on, m.fetch, now + 2 * DAY), 1, 'only fresh gets an email (its step 1)')
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM onboarding_emails WHERE uid = 'new' AND step = 2").get().n, 1)
  // Opting out stops step 3.
  const token = db.raw.prepare("SELECT token FROM onboarding_optout WHERE uid = 'new'").get().token
  assert.equal(await onboardingUnsubscribe(db, token, now), true)
  assert.equal(await onboardingUnsubscribe(db, 'nope', now), false)
  const before = m.sent.length
  await sendOnboardingBatch(on, m.fetch, now + 6 * DAY)
  assert.ok(!m.sent.slice(before).some(s => s.body.to[0] === 'new@x.com'), 'opted-out account gets nothing more')
})

test('error reports older than 90 days are pruned', async () => {
  const { pruneErrors } = await import('../dist/ops.mjs')
  const db = makeDb()
  await recordError(env(db), { source: 'api', message: 'old one', stack: 'at a (w.js)' }, async () => new Response('{}'), now - 100 * DAY)
  await recordError(env(db), { source: 'api', message: 'recent one', stack: 'at b (w.js)' }, async () => new Response('{}'), now - DAY)
  await pruneErrors(db, now)
  assert.deepEqual((await listErrors(db)).map(e => e.message), ['recent one'])
})
