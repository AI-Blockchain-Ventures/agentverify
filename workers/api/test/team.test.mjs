// 2.0 Team plan: per-seat checkout, Stripe seat sync, members inherit the plan within paid seats, owner-only management.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import worker from '../dist/worker.mjs'
import { checkScanQuota, isPlanCheckoutAvailable, hasProFeatures } from '../dist/billing.mjs'
import { addMember, getTeam, removeMember } from '../dist/team.mjs'

const TEAM_PRICE = 'price_team_test'
const b64url = s => Buffer.from(s).toString('base64url')

function makeDb() {
  const db = new DatabaseSync(':memory:')
  for (const f of ['billing.sql', 'team.sql']) db.exec(readFileSync(new URL(`../schema/${f}`, import.meta.url), 'utf8'))
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

async function firebaseToken(uid = 'owner', email = 'owner@example.test') {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  Object.assign(jwk, { kid: 'k', alg: 'RS256', use: 'sig' })
  const now = Math.floor(Date.now() / 1000)
  const signed = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k' }))}.${b64url(JSON.stringify({ aud: 'agentverify-test', iss: 'https://securetoken.google.com/agentverify-test', sub: uid, email, iat: now, exp: now + 3600 }))}`
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(signed))
  return { token: `${signed}.${Buffer.from(sig).toString('base64url')}`, jwk }
}

async function stripeSignature(payload, secret = 'whsec_test') {
  const t = Math.floor(Date.now() / 1000)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`))
  return `t=${t},v1=${Buffer.from(digest).toString('hex')}`
}

const baseEnv = db => ({ BILLING_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec_test', STRIPE_PRO_PRICE_ID: 'price_pro', STRIPE_TEAM_PRICE_ID: TEAM_PRICE, BILLING_SUCCESS_URL: 'https://x/s', BILLING_CANCEL_URL: 'https://x/c', FIREBASE_PROJECT_ID: 'agentverify-test', BILLING_DB: db })

let eventSeq = 0
async function sendSubscription(env, { uid = 'owner', quantity = 3, status = 'active', price = TEAM_PRICE } = {}) {
  eventSeq++
  const payload = JSON.stringify({
    id: `evt_${eventSeq}`, type: 'customer.subscription.updated', created: 1_800_000_000 + eventSeq,
    data: { object: { object: 'subscription', id: 'sub_1', customer: 'cus_1', status, metadata: { uid }, current_period_end: 1_900_000_000, items: { data: [{ price: { id: price }, quantity }] } } },
  })
  const res = await worker.fetch(new Request('https://api.test/v1/billing/webhook', { method: 'POST', headers: { 'Stripe-Signature': await stripeSignature(payload) }, body: payload }), env)
  assert.equal(res.status, 200)
}

const lookup = { 'a@x.test': 'member-a', 'b@x.test': 'member-b', 'c@x.test': 'member-c', 'owner@example.test': 'owner' }
const deps = { resolveUid: async email => lookup[email] ?? null }

test('Team checkout is off until its Stripe price is set, and Team counts as Pro for features', () => {
  assert.equal(isPlanCheckoutAvailable('team'), false)
  assert.equal(isPlanCheckoutAvailable('team', { STRIPE_TEAM_PRICE_ID: TEAM_PRICE }), true)
  assert.equal(isPlanCheckoutAvailable('enterprise', { STRIPE_TEAM_PRICE_ID: TEAM_PRICE }), false)
  assert.equal(hasProFeatures('team'), true)
  assert.equal(hasProFeatures('free'), false)
})

test('Team checkout sends a per-seat quantity and validates the seat count', async () => {
  const db = makeDb()
  const { token, jwk } = await firebaseToken()
  const original = globalThis.fetch
  let sent = null
  globalThis.fetch = async (url, init) => {
    const href = String(url)
    if (href.includes('securetoken@system.gserviceaccount.com')) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } })
    if (href.includes('/v1/checkout/sessions')) { sent = new URLSearchParams(String(init.body)); return new Response(JSON.stringify({ url: 'https://checkout.stripe.test/s' }), { status: 200 }) }
    return new Response('{}', { status: 404 })
  }
  try {
    const checkout = seats => worker.fetch(new Request('https://api.test/v1/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ plan: 'team', seats }) }), baseEnv(db))
    const ok = await checkout(5)
    assert.equal(ok.status, 200)
    assert.equal(sent.get('line_items[0][price]'), TEAM_PRICE)
    assert.equal(sent.get('line_items[0][quantity]'), '5')
    assert.equal(sent.get('subscription_data[metadata][plan]'), 'team')
    assert.equal((await checkout(1)).status, 400, 'fewer than 2 seats is refused')
    assert.equal((await checkout(101)).status, 400)
    assert.equal((await checkout('3; drop')).status, 400)
    const noPrice = await worker.fetch(new Request('https://api.test/v1/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ plan: 'team', seats: 3 }) }), { ...baseEnv(db), STRIPE_TEAM_PRICE_ID: undefined })
    assert.equal(noPrice.status, 400, 'still off without the Team price')
  } finally {
    globalThis.fetch = original
  }
})

test('Stripe Team subscription: owner gets Team (300 scans), seat count is stored', async () => {
  const db = makeDb()
  const env = baseEnv(db)
  await sendSubscription(env, { quantity: 3 })
  const q = await checkScanQuota(env, 'owner')
  assert.equal(q.plan, 'team')
  assert.equal(q.limit, 300)
  assert.equal(db.raw.prepare('SELECT seats FROM team_seats WHERE owner_uid = ?').get('owner').seats, 3)
  await sendSubscription(env, { price: 'price_pro', quantity: 1, uid: 'solo' })
  assert.equal((await checkScanQuota(env, 'solo')).plan, 'pro', 'Pro subscriptions are unchanged')
})

test('members: added by email within seats, inherit Team, lose it when removed or the plan ends', async () => {
  const db = makeDb()
  const env = baseEnv(db)
  await sendSubscription(env, { quantity: 3 }) // owner + 2 members
  assert.equal((await addMember('owner', { email: 'a@x.test' }, env, { ...deps, now: () => 1 })).status, 200)
  assert.equal((await addMember('owner', { email: 'nobody@x.test' }, env, deps)).status, 404, 'needs an existing account')
  assert.equal((await addMember('owner', { email: 'b@x.test' }, env, { ...deps, now: () => 2 })).status, 200)
  const full = await addMember('owner', { email: 'c@x.test' }, env, deps)
  assert.equal(full.status, 409, 'cannot add beyond paid seats')
  assert.match(full.body.error, /3 seats/)
  assert.equal((await addMember('owner', { email: 'a@x.test' }, env, deps)).status, 409, 'no duplicates')
  assert.equal((await addMember('owner', { email: 'nope' }, env, deps)).status, 400)
  assert.equal((await checkScanQuota(env, 'member-a')).plan, 'team')
  assert.equal((await checkScanQuota(env, 'member-c')).plan, 'free', 'not on the team')

  const team = await getTeam('owner', env)
  assert.equal(team.body.role, 'owner')
  assert.equal(team.body.seatsUsed, 3)
  assert.equal((await getTeam('member-a', env)).body.role, 'member')
  assert.equal((await addMember('member-a', { email: 'c@x.test' }, env, deps)).status, 403, 'members cannot add people')

  // Seats reduced on Stripe to 2: only the earliest-added member keeps a seat.
  await sendSubscription(env, { quantity: 2 })
  assert.equal((await checkScanQuota(env, 'member-a')).plan, 'team')
  assert.equal((await checkScanQuota(env, 'member-b')).plan, 'free')

  assert.equal((await removeMember('owner', 'member-a', env)).status, 200)
  assert.equal((await checkScanQuota(env, 'member-a')).plan, 'free')
  assert.equal((await checkScanQuota(env, 'member-b')).plan, 'team', 'the freed seat goes to the next member')

  await sendSubscription(env, { quantity: 2, status: 'canceled' })
  assert.equal((await checkScanQuota(env, 'owner')).plan, 'free')
  assert.equal((await checkScanQuota(env, 'member-b')).plan, 'free', 'members lose Team when the plan ends')
})

test('team routes require a signed-in user', async () => {
  for (const [method, path] of [['GET', '/v1/team'], ['POST', '/v1/team/members'], ['DELETE', '/v1/team/members?uid=x']]) {
    const res = await worker.fetch(new Request(`https://api.test${path}`, { method }), {})
    assert.equal(res.status, 401, `${method} ${path}`)
  }
})
