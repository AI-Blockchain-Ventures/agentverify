// Approvals for the coding-agent guard: create, poll, decide, expire, team owner can decide, secrets masked,
// pings go out, and (the important one) an API key can never approve its own request.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import worker from '../dist/worker.mjs'
import { createApproval, getApproval, listApprovals, decideApproval } from '../dist/guardApprovals.mjs'
import { addMember } from '../dist/team.mjs'

const TEAM_PRICE = 'price_team_test'
const b64url = s => Buffer.from(s).toString('base64url')

function makeDb() {
  const db = new DatabaseSync(':memory:')
  for (const f of ['billing.sql', 'team.sql', 'guard.sql', 'github.sql']) db.exec(readFileSync(new URL(`../schema/${f}`, import.meta.url), 'utf8'))
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
const NOW = Date.parse('2026-11-23T12:00:00Z')
const ask = (o = {}) => ({ agent: 'Claude Code · demo · laptop', tool: 'PowerShell', preview: 'shell: npm install lodash', reason: 'installs a new package (rule install-package)', rule: 'install-package', ...o })

async function stripeSignature(payload, secret = 'whsec_test') {
  const t = Math.floor(Date.now() / 1000)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`))
  return `t=${t},v1=${Buffer.from(digest).toString('hex')}`
}

test('create, poll, approve; only the first decision counts; strangers see nothing', async () => {
  const env = baseEnv(makeDb())
  const created = await createApproval(env, 'dev', ask(), { now: NOW })
  assert.equal(created.status, 200)
  const id = created.body.id
  assert.match(id, /^apr_[0-9a-f]{32}$/)
  assert.equal(created.body.status, 'pending')
  assert.equal((await getApproval(env, 'dev', id, NOW + 1000)).body.status, 'pending')
  assert.equal((await getApproval(env, 'stranger', id, NOW)).status, 404)
  assert.equal((await decideApproval(env, 'stranger', id, { decision: 'approve' }, NOW)).status, 404)
  assert.equal((await decideApproval(env, 'dev', id, { decision: 'maybe' }, NOW)).status, 400)
  assert.equal((await decideApproval(env, 'dev', id, { decision: 'approve' }, NOW + 5000)).body.status, 'approved')
  assert.equal((await getApproval(env, 'dev', id, NOW + 6000)).body.status, 'approved')
  assert.equal((await decideApproval(env, 'dev', id, { decision: 'deny' }, NOW + 7000)).status, 409, 'cannot change a decision')
  assert.equal((await getApproval(env, 'dev', 'apr_nothex', NOW)).status, 404)
})

test('requests expire; a late decision is refused; the list shows pending and recent', async () => {
  const env = baseEnv(makeDb())
  const a = (await createApproval(env, 'dev', ask({ waitSeconds: 60 }), { now: NOW })).body
  const b = (await createApproval(env, 'dev', ask({ preview: 'shell: wrangler deploy' }), { now: NOW })).body
  assert.equal((await getApproval(env, 'dev', a.id, NOW + 61_000)).body.status, 'expired')
  assert.equal((await decideApproval(env, 'dev', a.id, { decision: 'approve' }, NOW + 61_000)).status, 409)
  await decideApproval(env, 'dev', b.id, { decision: 'deny' }, NOW + 1000)
  const c = (await createApproval(env, 'dev', ask({ preview: 'shell: npm i axios' }), { now: NOW + 2000 })).body
  const list = (await listApprovals(env, 'dev', NOW + 62_000)).body
  assert.deepEqual(list.pending.map(x => x.id), [c.id])
  assert.deepEqual(new Set(list.recent.map(x => x.status)), new Set(['denied', 'expired']))
  // Wait time is clamped.
  const short = (await createApproval(env, 'dev', ask({ waitSeconds: 1 }), { now: NOW })).body
  assert.equal(Date.parse(short.expiresAt) - NOW, 30_000)
  const long = (await createApproval(env, 'dev', ask({ waitSeconds: 99999 }), { now: NOW })).body
  assert.equal(Date.parse(long.expiresAt) - NOW, 600_000)
})

test('secrets are masked before storing; bad requests are refused; too many waiting is capped', async () => {
  const db = makeDb()
  const env = baseEnv(db)
  const r = await createApproval(env, 'dev', ask({ preview: 'shell: curl -H "x: sk-proj-abcdefghijklmnopqrstuvwxyz" API_KEY=hunter2 https://x' }), { now: NOW })
  assert.doesNotMatch(r.body.preview, /abcdefghijklmnop|hunter2/)
  assert.doesNotMatch(db.raw.prepare('SELECT preview FROM guard_approvals').get().preview, /abcdefghijklmnop|hunter2/)
  assert.equal((await createApproval(env, 'dev', { tool: 'x' }, { now: NOW })).status, 400)
  for (let i = 0; i < 19; i++) await createApproval(env, 'dev', ask(), { now: NOW })
  assert.equal((await createApproval(env, 'dev', ask(), { now: NOW })).status, 429)
})

test('a Team owner can decide a member\'s request; the ping goes to Slack for both', async () => {
  const db = makeDb()
  const env = baseEnv(db)
  const payload = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated', created: 1_800_000_001, data: { object: { object: 'subscription', id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { uid: 'owner' }, current_period_end: 1_900_000_000, items: { data: [{ price: { id: TEAM_PRICE }, quantity: 3 }] } } } })
  assert.equal((await worker.fetch(new Request('https://api.test/v1/billing/webhook', { method: 'POST', headers: { 'Stripe-Signature': await stripeSignature(payload) }, body: payload }), env)).status, 200)
  await addMember('owner', { email: 'a@x.test' }, env, { resolveUid: async () => 'member-a' })
  db.raw.prepare("INSERT INTO alert_settings (uid, slack_webhook_url, email, min_severity, updated_at) VALUES ('owner', 'https://hooks.slack.com/services/T0/B0/xyz', NULL, 'high', 0)").run()
  const sent = []
  const fetchFn = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return new Response('ok') }
  const r = (await createApproval(env, 'member-a', ask(), { now: NOW, fetchFn })).body
  assert.equal(sent.length, 1)
  assert.match(sent[0].body.text, /Approval needed[\s\S]*npm install lodash[\s\S]*tab=guard/)
  assert.equal((await listApprovals(env, 'owner', NOW)).body.pending.length, 1, 'the owner sees the member\'s request')
  assert.equal((await decideApproval(env, 'owner', r.id, { decision: 'approve' }, NOW + 1000)).body.status, 'approved')
})

test('route: the guard\'s API key can ask and check, but never approve or list; a signed-in person can', async () => {
  const db = makeDb()
  const env = { ...baseEnv(db), FIREBASE_API_KEY: 'fb-test' }
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  Object.assign(jwk, { kid: 'k', alg: 'RS256', use: 'sig' })
  const now = Math.floor(Date.now() / 1000)
  const signed = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k' }))}.${b64url(JSON.stringify({ aud: 'agentverify-test', iss: 'https://securetoken.google.com/agentverify-test', sub: 'dev', email: 'dev@x.test', iat: now, exp: now + 3600 }))}`
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(signed))
  const userToken = `${signed}.${Buffer.from(sig).toString('base64url')}`
  const apiKey = 'av_test_key_for_dev_account_123'
  const original = globalThis.fetch
  globalThis.fetch = async url => {
    const href = String(url)
    if (href.includes('securetoken@system.gserviceaccount.com')) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } })
    if (href.includes('/documents/apiKeyIndex/')) return new Response(JSON.stringify({ fields: { uid: { stringValue: 'dev' } } }), { status: 200 })
    return new Response('{}', { status: 404 })
  }
  const call = (method, path, token, body) => worker.fetch(new Request(`https://api.test${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), env)
  try {
    const created = await call('POST', '/v1/guard/approvals', apiKey, ask())
    assert.equal(created.status, 200)
    const { id } = await created.json()
    assert.equal((await call('GET', `/v1/guard/approvals/${id}`, apiKey)).status, 200)
    const selfApprove = await call('POST', `/v1/guard/approvals/${id}/decision`, apiKey, { decision: 'approve' })
    assert.equal(selfApprove.status, 403, 'an API key must never approve')
    assert.equal((await call('GET', '/v1/guard/approvals', apiKey)).status, 403)
    assert.equal((await (await call('GET', `/v1/guard/approvals/${id}`, apiKey)).json()).status, 'pending')
    const listed = await (await call('GET', '/v1/guard/approvals', userToken)).json()
    assert.equal(listed.pending.length, 1)
    assert.equal((await call('POST', `/v1/guard/approvals/${id}/decision`, userToken, { decision: 'approve' })).status, 200)
    assert.equal((await (await call('GET', `/v1/guard/approvals/${id}`, apiKey)).json()).status, 'approved')
    assert.equal((await worker.fetch(new Request('https://api.test/v1/guard/approvals', { method: 'POST' }), env)).status, 401)
  } finally {
    globalThis.fetch = original
  }
})
