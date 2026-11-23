// Company rules for the coding-agent guard: validation, owner-only saving, Team members inherit the owner's rules,
// and only a signed-in person (not an API key) can change them.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import worker from '../dist/worker.mjs'
import { validatePolicy, getGuardPolicy, putGuardPolicy } from '../dist/guardPolicy.mjs'
import { addMember } from '../dist/team.mjs'

const TEAM_PRICE = 'price_team_test'
const b64url = s => Buffer.from(s).toString('base64url')

function makeDb() {
  const db = new DatabaseSync(':memory:')
  for (const f of ['billing.sql', 'team.sql', 'guard.sql']) db.exec(readFileSync(new URL(`../schema/${f}`, import.meta.url), 'utf8'))
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

const baseEnv = db => ({ BILLING_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec_test', STRIPE_PRO_PRICE_ID: 'price_pro', STRIPE_TEAM_PRICE_ID: TEAM_PRICE, BILLING_SUCCESS_URL: 'https://x/s', BILLING_CANCEL_URL: 'https://x/c', FIREBASE_PROJECT_ID: 'agentverify-test', BILLING_DB: db })

async function stripeSignature(payload, secret = 'whsec_test') {
  const t = Math.floor(Date.now() / 1000)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`))
  return `t=${t},v1=${Buffer.from(digest).toString('hex')}`
}

async function makeTeam(env) {
  const payload = JSON.stringify({
    id: 'evt_1', type: 'customer.subscription.updated', created: 1_800_000_001,
    data: { object: { object: 'subscription', id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { uid: 'owner' }, current_period_end: 1_900_000_000, items: { data: [{ price: { id: TEAM_PRICE }, quantity: 3 }] } } },
  })
  const res = await worker.fetch(new Request('https://api.test/v1/billing/webhook', { method: 'POST', headers: { 'Stripe-Signature': await stripeSignature(payload) }, body: payload }), env)
  assert.equal(res.status, 200)
  assert.equal((await addMember('owner', { email: 'a@x.test' }, env, { resolveUid: async () => 'member-a' })).status, 200)
}

async function firebaseToken(uid, email) {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  Object.assign(jwk, { kid: 'k', alg: 'RS256', use: 'sig' })
  const now = Math.floor(Date.now() / 1000)
  const signed = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k' }))}.${b64url(JSON.stringify({ aud: 'agentverify-test', iss: 'https://securetoken.google.com/agentverify-test', sub: uid, email, iat: now, exp: now + 3600 }))}`
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(signed))
  return { token: `${signed}.${Buffer.from(sig).toString('base64url')}`, jwk }
}

const GOOD = {
  disable: ['install-package'],
  rules: [{ id: 'no-prod-db', kind: 'shell', pattern: 'psql .*prod', decision: 'deny', reason: 'connects to the production database' }],
  allow: ['^npm test$'],
  whenUnattended: 'block',
  projectsCanRelax: false,
}

test('validation: accepts good rules, explains bad ones in plain English', () => {
  const ok = validatePolicy(GOOD)
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.policy, GOOD)
  const bad = [
    [{ rules: [{ id: 'x', kind: 'shell', pattern: '(', decision: 'deny' }] }, /pattern/],
    [{ rules: [{ id: 'x', kind: 'nope', pattern: 'a', decision: 'deny' }] }, /type/],
    [{ rules: [{ id: 'x', kind: 'shell', pattern: 'a', decision: 'maybe' }] }, /decision/],
    [{ rules: [{ id: 'has space', kind: 'shell', pattern: 'a', decision: 'deny' }] }, /ID/],
    [{ rules: [{ id: 'a', kind: 'shell', pattern: 'a', decision: 'deny' }, { id: 'a', kind: 'read', pattern: 'b', decision: 'ask' }] }, /Two rules/],
    [{ disable: ['guard-config'] }, /cannot be turned off/],
    [{ allow: ['['] }, /not a valid pattern/],
    [{ whenUnattended: 'sometimes' }, /block/],
    [[], /object/],
    [{ allow: Array.from({ length: 101 }, (_, i) => `a${i}`) }, /up to 100/],
  ]
  for (const [input, msg] of bad) {
    const r = validatePolicy(input)
    assert.equal(r.ok, false, JSON.stringify(input).slice(0, 60))
    assert.match(r.error, msg)
  }
  // Missing fields get safe defaults.
  assert.deepEqual(validatePolicy({}).policy, { disable: [], rules: [], allow: [], whenUnattended: 'block', projectsCanRelax: false })
})

test('an account saves its own rules; a Team member gets the owner\'s rules and cannot change them', async () => {
  const db = makeDb()
  const env = baseEnv(db)
  const none = await getGuardPolicy(env, 'solo', { canEdit: true })
  assert.deepEqual(none.body, { policy: null, updatedAt: null, source: 'own', canEdit: true, teamWide: false })
  assert.equal((await putGuardPolicy(env, 'solo', { policy: GOOD }, 1_000)).status, 200)
  const own = await getGuardPolicy(env, 'solo', { canEdit: true })
  assert.deepEqual(own.body.policy, GOOD)
  assert.equal((await putGuardPolicy(env, 'solo', { policy: { rules: 'x' } })).status, 400)

  await makeTeam(env)
  assert.equal((await putGuardPolicy(env, 'owner', { policy: { ...GOOD, disable: [] } }, 2_000)).status, 200)
  assert.equal((await getGuardPolicy(env, 'owner', { canEdit: true })).body.teamWide, true, 'a Team owner reaches the whole team')
  const member = await getGuardPolicy(env, 'member-a', { canEdit: true })
  assert.equal(member.body.teamWide, true)
  assert.equal(member.body.source, 'team')
  assert.equal(member.body.canEdit, false)
  assert.deepEqual(member.body.policy.disable, [], 'the member sees the owner\'s rules')
  const denied = await putGuardPolicy(env, 'member-a', { policy: GOOD })
  assert.equal(denied.status, 403)
  // An API key can read the rules but the dashboard flag says it can't edit them.
  assert.equal((await getGuardPolicy(env, 'owner', { canEdit: false })).body.canEdit, false)
})

test('route: needs sign-in; a signed-in person saves; bad JSON and other methods are refused', async () => {
  const db = makeDb()
  const env = baseEnv(db)
  const { token, jwk } = await firebaseToken('solo', 'solo@x.test')
  const original = globalThis.fetch
  globalThis.fetch = async url => (String(url).includes('securetoken@system.gserviceaccount.com') ? new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('{}', { status: 404 }))
  const call = (method, body, auth = true) => worker.fetch(new Request('https://api.test/v1/guard/policy', { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body } : {}) }), env)
  try {
    assert.equal((await call('GET', undefined, false)).status, 401)
    assert.equal((await call('POST', JSON.stringify({ policy: GOOD }))).status, 200)
    const got = await (await call('GET')).json()
    assert.deepEqual(got.policy, GOOD)
    assert.equal(got.canEdit, true)
    assert.equal((await call('POST', '{not json')).status, 400)
    assert.equal((await call('DELETE')).status, 404)
  } finally {
    globalThis.fetch = original
  }
})
