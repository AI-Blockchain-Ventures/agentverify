// Referrals (free Pro time, abuse limits) and the opt-in weekly email.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { checkScanQuota } from '../dist/billing.mjs'
import { claimReferral, qualifyReferral, referralSummary, setDigest, getDigest, unsubscribe, buildDigest, sendDigestBatch, inDigestWindow, MAX_REWARDS_PER_YEAR } from '../dist/growth.mjs'

function makeDb() {
  const db = new DatabaseSync(':memory:')
  for (const f of ['billing.sql', 'github.sql', 'team.sql', 'growth.sql']) db.exec(readFileSync(new URL(`../schema/${f}`, import.meta.url), 'utf8'))
  return {
    raw: db,
    prepare(q) {
      const s = db.prepare(q)
      let v = []
      const api = {
        bind(...x) { v = x.map(y => (y === undefined ? null : y)); return api },
        async first() { return s.get(...v) ?? null },
        async run() { const r = s.run(...v); return { success: true, meta: { changes: Number(r.changes) } } },
        async all() { return { results: s.all(...v) } },
      }
      return api
    },
  }
}
const scanned = (db, uid) => db.raw.prepare("INSERT INTO usage_monthly (uid, month, scan_count, updated_at) VALUES (?, '2026-10', 1, 0)").run(uid)

test('referral link is stable per user', async () => {
  const db = makeDb()
  const a = await referralSummary(db, 'alice')
  const b = await referralSummary(db, 'alice')
  assert.equal(a.code, b.code)
  assert.match(a.link, /\?ref=[a-z0-9]{8}$/)
  assert.equal(a.invited, 0)
})

test('claim rules: valid code, not yourself, new accounts only, once', async () => {
  const db = makeDb()
  const { code } = await referralSummary(db, 'alice')
  assert.equal((await claimReferral(db, 'bob', 'nope!')).status, 400)
  assert.equal((await claimReferral(db, 'bob', 'zzzzzzzz')).status, 404)
  assert.equal((await claimReferral(db, 'alice', code)).status, 400, 'no self-referral')
  scanned(db, 'old-user')
  assert.equal((await claimReferral(db, 'old-user', code)).status, 409, 'existing users cannot claim')
  assert.equal((await claimReferral(db, 'bob', code)).status, 200)
  assert.equal((await claimReferral(db, 'bob', code)).status, 409, 'only once')
})

test('first scan rewards both: inviter +30 days Pro, friend +14 days; only once', async () => {
  const db = makeDb()
  const env = { BILLING_DB: db }
  const { code } = await referralSummary(db, 'alice')
  await claimReferral(db, 'bob', code)
  assert.equal((await checkScanQuota(env, 'alice')).plan, 'free')
  scanned(db, 'bob')
  assert.equal(await qualifyReferral(db, 'bob'), 'rewarded')
  assert.equal(await qualifyReferral(db, 'bob'), 'none', 'second scan does nothing')
  const alice = await checkScanQuota(env, 'alice')
  assert.equal(alice.plan, 'pro')
  assert.equal(alice.limit, 100)
  assert.equal((await checkScanQuota(env, 'bob')).plan, 'pro')
  const days = s => Math.round((db.raw.prepare('SELECT until FROM bonus_pro WHERE uid = ?').get(s).until - Date.now() / 1000) / 86400)
  assert.equal(days('alice'), 30)
  assert.equal(days('bob'), 14)
  const summary = await referralSummary(db, 'alice')
  assert.equal(summary.qualified, 1)
  assert.ok(summary.bonusUntil)
  assert.equal(await qualifyReferral(db, 'someone-not-invited'), 'none')
})

test(`rewards stack but are capped at ${MAX_REWARDS_PER_YEAR} a year`, async () => {
  const db = makeDb()
  const { code } = await referralSummary(db, 'alice')
  for (let i = 0; i < MAX_REWARDS_PER_YEAR + 3; i++) {
    await claimReferral(db, `f${i}`, code)
    await qualifyReferral(db, `f${i}`)
  }
  assert.equal(db.raw.prepare('SELECT rewards FROM bonus_pro WHERE uid = ?').get('alice').rewards, MAX_REWARDS_PER_YEAR)
})

test('weekly email: opt-in, unsubscribe by token, needs an email address', async () => {
  const db = makeDb()
  assert.equal((await setDigest(db, 'u', undefined, { enabled: true })).status, 400)
  await setDigest(db, 'u', 'u@example.test', { enabled: true })
  assert.deepEqual(await getDigest(db, 'u'), { enabled: true, email: 'u@example.test' })
  const token = db.raw.prepare('SELECT unsubscribe_token FROM digest_subscriptions').get().unsubscribe_token
  assert.equal(await unsubscribe(db, 'bad'), false)
  assert.equal(await unsubscribe(db, token), true)
  assert.equal((await getDigest(db, 'u')).enabled, false)
})

test('weekly email content and sending: once a week, with unsubscribe link', async () => {
  const content = buildDigest({
    repos: [{ repo: 'acme/bot', now: { repo_full_name: 'acme/bot', score: 60, created_at: 0, critical_count: 1, high_count: 0 }, before: { repo_full_name: 'acme/bot', score: 75, created_at: 0, critical_count: 0, high_count: 0 } }],
    referrals: { invited: 0, qualified: 0, link: 'https://x/?ref=abc' }, popularMcp: [{ name: 'm', url: 'https://x/mcp/m/', label: 'can change files' }], unsubscribeUrl: 'https://api/unsub?token=t',
  })
  assert.match(content.subject, /1 repo got riskier/)
  assert.match(content.text, /acme\/bot: 60\/100 \(-15 this week\) — 1 critical\/high to fix/)
  assert.match(content.html, /Unsubscribe/)
  assert.doesNotMatch(buildDigest({ repos: [], referrals: { invited: 0, qualified: 0, link: '<x>' }, popularMcp: [], unsubscribeUrl: 'u' }).html, /<x>/, 'html is escaped')

  const db = makeDb()
  await setDigest(db, 'u1', 'u1@example.test', { enabled: true })
  await setDigest(db, 'u2', 'u2@example.test', { enabled: false })
  const sent = []
  const fetchFn = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }) }
  const env = { BILLING_DB: db, RESEND_API_KEY: 're_x', ALERT_FROM_EMAIL: 'Agent Verify <hi@x.test>' }
  assert.equal(await sendDigestBatch(env, [], fetchFn), 1)
  assert.deepEqual(sent[0].to, ['u1@example.test'])
  assert.match(sent[0].headers['List-Unsubscribe'], /unsubscribe\?token=/)
  assert.equal(await sendDigestBatch(env, [], fetchFn), 0, 'not twice in a week')
  assert.equal(await sendDigestBatch({ BILLING_DB: db }, [], fetchFn), 0, 'off without an email service')
  assert.equal(inDigestWindow(new Date('2026-11-02T14:10:00Z')), true)
  assert.equal(inDigestWindow(new Date('2026-11-03T14:10:00Z')), false)
})
