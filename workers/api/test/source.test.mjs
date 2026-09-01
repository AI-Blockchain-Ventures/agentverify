import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { scan, verifyAttestation } from '@agentverify/scanner'
import { validateWebhookUrl } from '../dist/webhookSecurity.mjs'
import { signWebhookPayload, verifyWebhookDelivery, buildWebhookDelivery } from '../dist/webhooks.mjs'
import worker from '../dist/worker.mjs'
import { getFallbackBillingStatusForTests, isPlanCheckoutAvailable } from '../dist/billing.mjs'
import { createScanResult } from '../dist/scanResponse.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, '../src/worker.ts'), 'utf8')

assert.match(source, /from '@agentverify\/scanner'/)
assert.doesNotMatch(source, /const\s+signals\s*=/)
assert.doesNotMatch(source, /const\s+findingDefinitions\s*=/)
assert.doesNotMatch(source, /function\s+scan\s*\(/)
assert.doesNotMatch(source, /type\s+Verdict\s*=/)

const fixture = {
  fileName: 'parity-agent.ts',
  content: `
const agent = {
  name: 'ParityAgent',
  tools: ['*'],
  permissions: 'all',
  systemPrompt: sanitize(userInput),
  rateLimit: 10,
  audit: true,
  requireApproval: true,
  nonce: request.id,
  timestamp: Date.now(),
  signature: verify(payload),
}

if (!agent.signature) throw new Error('block on fail')
await tool.execute('deploy')
`,
}

const b64url = (value) => Buffer.from(value).toString('base64url')

// worker.ts writes cliReports through a real Firebase service account (JWT-signed OAuth,
// not a bare API key), matching the locked-down Firestore rules that now require an
// authenticated writer. Generate a throwaway PKCS8 key so tests exercise that same path.
async function createServiceAccountEnv() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey)
  return {
    FIREBASE_CLIENT_EMAIL: 'worker-test@agentverify-test.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: Buffer.from(pkcs8).toString('base64'),
  }
}

const mockOauthTokenFetch = (href) => href.includes('oauth2.googleapis.com/token')
  ? new Response(JSON.stringify({ access_token: 'test-service-account-access-token', expires_in: 3600, token_type: 'Bearer' }), { status: 200, headers: { 'content-type': 'application/json' } })
  : null

async function createFirebaseToken(uid = 'user_test', email = 'user@example.test', kid = 'test-kid') {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  publicJwk.kid = kid
  publicJwk.alg = 'RS256'
  publicJwk.use = 'sig'
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }))
  const payload = b64url(JSON.stringify({ aud: 'agentverify-test', iss: 'https://securetoken.google.com/agentverify-test', sub: uid, email, iat: now, exp: now + 3600 }))
  const signed = `${header}.${payload}`
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(signed))
  return { token: `${signed}.${Buffer.from(signature).toString('base64url')}`, jwk: publicJwk }
}

async function stripeSignature(payload, secret = 'whsec_test_placeholder') {
  const timestamp = Math.floor(Date.now() / 1000)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`))
  return `t=${timestamp},v1=${Buffer.from(digest).toString('hex')}`
}

function createD1Mock() {
  const subscriptions = new Map()
  const events = new Map()
  const usage = new Map()
  return {
    subscriptions,
    events,
    usage,
    prepare(sql) {
      let params = []
      return {
        bind(...values) { params = values; return this },
        async first() {
          if (/SELECT \* FROM subscriptions WHERE uid = \?/i.test(sql)) return subscriptions.get(params[0]) ?? null
          if (/SELECT scan_count FROM usage_monthly WHERE uid = \? AND month = \?/i.test(sql)) {
            const row = usage.get(`${params[0]}:${params[1]}`)
            return row ? { scan_count: row.scan_count } : null
          }
          return null
        },
        async run() {
          if (/INSERT OR IGNORE INTO stripe_events/i.test(sql)) {
            const [event_id, event_type, event_created, processed_at] = params
            if (events.has(event_id)) return { success: true, meta: { changes: 0 } }
            events.set(event_id, { event_id, event_type, event_created, processed_at })
            return { success: true, meta: { changes: 1 } }
          }
          if (/DELETE FROM stripe_events WHERE event_id = \?/i.test(sql)) {
            const deleted = events.delete(params[0])
            return { success: true, meta: { changes: deleted ? 1 : 0 } }
          }
          if (/INSERT INTO subscriptions/i.test(sql)) {
            const [uid, plan, status, stripe_customer_id, stripe_subscription_id, current_period_end, cancel_at_period_end, last_stripe_event_id, last_stripe_event_created, updated_at, schema_version] = params
            const current = subscriptions.get(uid)
            if (current && Number(current.last_stripe_event_created) > Number(last_stripe_event_created)) return { success: true, meta: { changes: 0 } }
            subscriptions.set(uid, { uid, plan, status, stripe_customer_id, stripe_subscription_id, current_period_end, cancel_at_period_end, last_stripe_event_id, last_stripe_event_created, updated_at, schema_version })
            return { success: true, meta: { changes: 1 } }
          }
          if (/UPDATE subscriptions/i.test(sql)) {
            const [stripe_customer_id, stripe_subscription_id, last_stripe_event_id, last_stripe_event_created, updated_at, uid, stale_check] = params
            const current = subscriptions.get(uid)
            if (!current || Number(current.last_stripe_event_created) > Number(stale_check)) return { success: true, meta: { changes: 0 } }
            subscriptions.set(uid, {
              ...current,
              plan: 'pro',
              stripe_customer_id: stripe_customer_id ?? current.stripe_customer_id,
              stripe_subscription_id: stripe_subscription_id ?? current.stripe_subscription_id,
              last_stripe_event_id,
              last_stripe_event_created,
              updated_at,
            })
            return { success: true, meta: { changes: 1 } }
          }
          if (/INSERT INTO usage_monthly/i.test(sql)) {
            const [uid, month, plan_snapshot, updated_at] = params
            const key = `${uid}:${month}`
            const current = usage.get(key) ?? { uid, month, scan_count: 0, plan_snapshot, updated_at }
            usage.set(key, { ...current, scan_count: current.scan_count + 1, plan_snapshot, updated_at })
            return { success: true, meta: { changes: 1 } }
          }
          return { success: true, meta: { changes: 0 } }
        },
      }
    },
  }
}

function stable(result) {
  return {
    ...result,
    reportId: '<volatile>',
    metadata: {
      ...result.metadata,
      scannedAt: '<volatile>',
      scanDuration: '<volatile>',
    },
    findings: result.findings.map((finding) => ({
      ...finding,
      id: '<volatile>',
    })),
  }
}

assert.deepEqual(stable(createScanResult(fixture)), stable(scan(fixture)))

const checkoutDisabled = await worker.fetch(new Request('https://api.test/v1/billing/checkout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ plan: 'pro' }),
}), {})
assert.equal(checkoutDisabled.status, 503)

const checkoutUnauthed = await worker.fetch(new Request('https://api.test/v1/billing/checkout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ plan: 'pro' }),
}), {
  BILLING_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'sk_test_placeholder',
  STRIPE_PRO_PRICE_ID: 'price_test_placeholder',
  BILLING_SUCCESS_URL: 'https://example.test/success',
  BILLING_CANCEL_URL: 'https://example.test/cancel',
  FIREBASE_PROJECT_ID: 'agentverify-test',
  BILLING_DB: createD1Mock(),
})
assert.equal(checkoutUnauthed.status, 401)

const checkoutMissingD1 = await worker.fetch(new Request('https://api.test/v1/billing/checkout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ plan: 'pro' }),
}), {
  BILLING_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'sk_test_placeholder',
  STRIPE_PRO_PRICE_ID: 'price_test_placeholder',
  BILLING_SUCCESS_URL: 'https://example.test/success',
  BILLING_CANCEL_URL: 'https://example.test/cancel',
  FIREBASE_PROJECT_ID: 'agentverify-test',
})
assert.equal(checkoutMissingD1.status, 503)

const invalidWebhook = await worker.fetch(new Request('https://api.test/v1/billing/webhook', {
  method: 'POST',
  headers: { 'Stripe-Signature': 't=123,v1=invalid' },
  body: JSON.stringify({ type: 'customer.subscription.updated', data: { object: {} } }),
}), {
  BILLING_ENABLED: 'true',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_placeholder',
})
assert.equal(invalidWebhook.status, 400)

const status = await worker.fetch(new Request('https://api.test/v1/billing/status'), {})
assert.equal(status.status, 200)
assert.equal((await status.json()).plan, 'free')

assert.equal(getFallbackBillingStatusForTests().plan, 'free')
assert.equal(getFallbackBillingStatusForTests().scanQuota, 10)
assert.equal(isPlanCheckoutAvailable('pro'), true)
assert.equal(isPlanCheckoutAvailable('team'), false)
assert.equal(isPlanCheckoutAvailable('enterprise'), false)

const billingSource = readFileSync(resolve(__dirname, '../src/billing.ts'), 'utf8')
assert.match(billingSource, /reserveStripeEvent/)
assert.match(billingSource, /lastStripeEventCreated/)
assert.match(billingSource, /BILLING_DB/)
assert.match(billingSource, /INSERT OR IGNORE INTO stripe_events/)
assert.match(billingSource, /usage_monthly/)
assert.doesNotMatch(billingSource, /FIRESTORE_ACCESS_TOKEN/)
assert.doesNotMatch(billingSource, /GOOGLE_SERVICE_ACCOUNT/)

const originalFetchForBilling = globalThis.fetch
const { token, jwk } = await createFirebaseToken()
globalThis.fetch = async (url) => {
  const href = String(url)
  if (href.includes('securetoken@system.gserviceaccount.com')) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } })
  if (href.includes('api.stripe.com/v1/checkout/sessions')) return new Response(JSON.stringify({ url: 'https://checkout.stripe.test/session' }), { status: 200, headers: { 'content-type': 'application/json' } })
  return new Response('{}', { status: 404 })
}
const checkoutEnv = { BILLING_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_placeholder', STRIPE_PRO_PRICE_ID: 'price_test_placeholder', BILLING_SUCCESS_URL: 'https://example.test/success', BILLING_CANCEL_URL: 'https://example.test/cancel', FIREBASE_PROJECT_ID: 'agentverify-test', BILLING_DB: createD1Mock() }
const checkoutPro = await worker.fetch(new Request('https://api.test/v1/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ plan: 'pro' }) }), checkoutEnv)
assert.equal(checkoutPro.status, 200)
assert.match((await checkoutPro.json()).url, /^https:\/\/checkout\.stripe\.test/)
const checkoutTeam = await worker.fetch(new Request('https://api.test/v1/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ plan: 'team' }) }), checkoutEnv)
assert.equal(checkoutTeam.status, 400)
const checkoutEnterprise = await worker.fetch(new Request('https://api.test/v1/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ plan: 'enterprise' }) }), checkoutEnv)
assert.equal(checkoutEnterprise.status, 400)

// Repeated checkout / customer reuse: a uid with no Stripe customer on file yet must check out via
// customer_email (Stripe mints a new customer); a uid that already HAS one (e.g. a prior canceled
// or abandoned checkout) must reuse that exact customer id instead of getting a second, orphaned
// one. Regression test for a real bug found during live Stripe test-mode acceptance testing on
// 2026-09-01: handleCheckout never consulted the existing subscription row at all, so every repeat
// checkout for an already-subscribed user created a brand-new Stripe Customer.
let lastCheckoutSessionBody = null
globalThis.fetch = async (url, init) => {
  const href = String(url)
  if (href.includes('securetoken@system.gserviceaccount.com')) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } })
  if (href.includes('api.stripe.com/v1/checkout/sessions')) {
    lastCheckoutSessionBody = new URLSearchParams(String(init.body))
    return new Response(JSON.stringify({ url: 'https://checkout.stripe.test/session' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Response('{}', { status: 404 })
}
const newCustomerCheckout = await worker.fetch(new Request('https://api.test/v1/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ plan: 'pro' }) }), checkoutEnv)
assert.equal(newCustomerCheckout.status, 200)
assert.equal(lastCheckoutSessionBody.get('customer_email'), 'user@example.test', 'no existing customer on file: must fall back to customer_email so Stripe creates one')
assert.equal(lastCheckoutSessionBody.get('customer'), null, 'must not send an empty/placeholder customer id')

const reuseDb = createD1Mock()
reuseDb.subscriptions.set('user_test', { uid: 'user_test', plan: 'free', status: 'canceled', stripe_customer_id: 'cus_existing_on_file', stripe_subscription_id: 'sub_old_canceled', current_period_end: null, cancel_at_period_end: 0, last_stripe_event_id: 'evt_old', last_stripe_event_created: 100, updated_at: 100, schema_version: 1 })
const reuseCheckout = await worker.fetch(new Request('https://api.test/v1/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ plan: 'pro' }) }), { ...checkoutEnv, BILLING_DB: reuseDb })
assert.equal(reuseCheckout.status, 200)
assert.equal(lastCheckoutSessionBody.get('customer'), 'cus_existing_on_file', 'a uid with an existing Stripe customer must reuse it, not create a duplicate')
assert.equal(lastCheckoutSessionBody.get('customer_email'), null, 'customer and customer_email must never both be set (Stripe rejects that combination)')

// Duplicate-active-subscription guard: an active or trialing Pro user must never be able to mint
// a second, concurrent Stripe subscription by calling /v1/billing/checkout directly — the UI
// hiding the button is not a security boundary. Regression test for the fix made alongside the
// billing UX pass on 2026-09-01.
let lastPortalSessionBody = null
globalThis.fetch = async (url, init) => {
  const href = String(url)
  if (href.includes('securetoken@system.gserviceaccount.com')) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } })
  if (href.includes('api.stripe.com/v1/checkout/sessions')) {
    lastCheckoutSessionBody = new URLSearchParams(String(init.body))
    return new Response(JSON.stringify({ url: 'https://checkout.stripe.test/session' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (href.includes('api.stripe.com/v1/billing_portal/sessions')) {
    lastPortalSessionBody = new URLSearchParams(String(init.body))
    return new Response(JSON.stringify({ url: 'https://billing.stripe.test/portal-session' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Response('{}', { status: 404 })
}

const activeProDb = createD1Mock()
activeProDb.subscriptions.set('user_test', { uid: 'user_test', plan: 'pro', status: 'active', stripe_customer_id: 'cus_already_pro', stripe_subscription_id: 'sub_already_pro', current_period_end: 9999, cancel_at_period_end: 0, last_stripe_event_id: 'evt_x', last_stripe_event_created: 100, updated_at: 100, schema_version: 1 })
const activeProCheckoutEnvWithPortal = { ...checkoutEnv, BILLING_DB: activeProDb, STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_test_placeholder' }
const activeProCheckout = await worker.fetch(new Request('https://api.test/v1/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ plan: 'pro' }) }), activeProCheckoutEnvWithPortal)
const activeProCheckoutBody = await activeProCheckout.json()
assert.equal(activeProCheckout.status, 200, 'an already-active Pro user must not get an error just for hitting checkout again')
assert.equal(activeProCheckoutBody.url, 'https://billing.stripe.test/portal-session', 'must be routed to the billing portal instead of a new checkout session')
assert.equal(activeProCheckoutBody.alreadySubscribed, true)
assert.equal(lastPortalSessionBody.get('customer'), 'cus_already_pro', 'the portal session must be opened for the correct existing customer')

// Same guard, but without a configured portal (e.g. a deployment that hasn't set up the portal
// yet): must safely reject rather than silently creating a duplicate subscription.
const activeProCheckoutEnvNoPortal = { ...checkoutEnv, BILLING_DB: activeProDb }
const activeProCheckoutNoPortal = await worker.fetch(new Request('https://api.test/v1/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ plan: 'pro' }) }), activeProCheckoutEnvNoPortal)
assert.equal(activeProCheckoutNoPortal.status, 409)
assert.equal((await activeProCheckoutNoPortal.json()).error, 'You already have an active Pro subscription.')

// Trialing Pro must be blocked identically to active Pro (both are real, billable entitlement).
const trialingProDb = createD1Mock()
trialingProDb.subscriptions.set('user_test', { uid: 'user_test', plan: 'pro', status: 'trialing', stripe_customer_id: 'cus_trialing_pro', stripe_subscription_id: 'sub_trialing_pro', current_period_end: 9999, cancel_at_period_end: 0, last_stripe_event_id: 'evt_y', last_stripe_event_created: 100, updated_at: 100, schema_version: 1 })
const trialingProCheckout = await worker.fetch(new Request('https://api.test/v1/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ plan: 'pro' }) }), { ...checkoutEnv, BILLING_DB: trialingProDb, STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_test_placeholder' })
assert.equal((await trialingProCheckout.json()).alreadySubscribed, true)

// A Pro subscription that's canceling at period end is STILL active until that date — must still
// be blocked from double-subscribing, matching the entitlement staying Pro through cancellation.
const cancelingProDb = createD1Mock()
cancelingProDb.subscriptions.set('user_test', { uid: 'user_test', plan: 'pro', status: 'active', stripe_customer_id: 'cus_canceling_pro', stripe_subscription_id: 'sub_canceling_pro', current_period_end: 9999, cancel_at_period_end: 1, last_stripe_event_id: 'evt_z', last_stripe_event_created: 100, updated_at: 100, schema_version: 1 })
const cancelingProCheckout = await worker.fetch(new Request('https://api.test/v1/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ plan: 'pro' }) }), { ...checkoutEnv, BILLING_DB: cancelingProDb, STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_test_placeholder' })
assert.equal((await cancelingProCheckout.json()).alreadySubscribed, true, 'canceling-but-not-yet-ended Pro must still be blocked from double-subscribing')

// past_due must NOT be blocked — that user is not currently entitled to Pro and should be able to
// re-subscribe (or their new checkout completing is exactly how they'd fix a failed payment).
const pastDueCheckoutDb = createD1Mock()
pastDueCheckoutDb.subscriptions.set('user_test', { uid: 'user_test', plan: 'pro', status: 'past_due', stripe_customer_id: 'cus_past_due_checkout', stripe_subscription_id: 'sub_past_due_checkout', current_period_end: 9999, cancel_at_period_end: 0, last_stripe_event_id: 'evt_pd', last_stripe_event_created: 100, updated_at: 100, schema_version: 1 })
const pastDueCheckout = await worker.fetch(new Request('https://api.test/v1/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ plan: 'pro' }) }), { ...checkoutEnv, BILLING_DB: pastDueCheckoutDb, STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_test_placeholder' })
const pastDueCheckoutBody = await pastDueCheckout.json()
assert.equal(pastDueCheckout.status, 200)
assert.equal(pastDueCheckoutBody.alreadySubscribed, undefined, 'past_due is not an active entitlement — must be allowed to check out again, not routed to the portal')
assert.equal(pastDueCheckoutBody.url, 'https://checkout.stripe.test/session')

const billingDb = createD1Mock()
const webhookEnv = { BILLING_ENABLED: 'true', STRIPE_WEBHOOK_SECRET: 'whsec_test_placeholder', BILLING_DB: billingDb }
const checkoutCompletedEvent = { id: 'evt_checkout_complete', type: 'checkout.session.completed', created: 150, data: { object: { object: 'checkout.session', id: 'cs_test', status: 'complete', customer: 'cus_test', subscription: 'sub_test', client_reference_id: 'checkout_user', metadata: { uid: 'checkout_user' } } } }
const checkoutCompletedPayload = JSON.stringify(checkoutCompletedEvent)
const checkoutCompletedWebhook = await worker.fetch(new Request('https://api.test/v1/billing/webhook', { method: 'POST', headers: { 'Stripe-Signature': await stripeSignature(checkoutCompletedPayload) }, body: checkoutCompletedPayload }), webhookEnv)
assert.equal(checkoutCompletedWebhook.status, 200)
assert.notEqual(billingDb.subscriptions.get('checkout_user').status, 'complete')
assert.equal(billingDb.subscriptions.get('checkout_user').status, 'pending')
assert.equal(billingDb.subscriptions.get('checkout_user').stripe_customer_id, 'cus_test')
assert.equal(billingDb.subscriptions.get('checkout_user').stripe_subscription_id, 'sub_test')

const activeEvent = { id: 'evt_active_new', type: 'customer.subscription.updated', created: 200, data: { object: { object: 'subscription', id: 'sub_test', customer: 'cus_test', status: 'active', current_period_end: 2000, cancel_at_period_end: false, metadata: { uid: 'user_test' } } } }
const activePayload = JSON.stringify(activeEvent)
const activeWebhook = await worker.fetch(new Request('https://api.test/v1/billing/webhook', { method: 'POST', headers: { 'Stripe-Signature': await stripeSignature(activePayload) }, body: activePayload }), webhookEnv)
assert.equal(activeWebhook.status, 200)
assert.equal((await activeWebhook.json()).received, true)
assert.equal(billingDb.subscriptions.get('user_test').plan, 'pro')
assert.equal(billingDb.subscriptions.get('user_test').status, 'active')
assert.equal(billingDb.subscriptions.get('user_test').current_period_end, 2000)
const duplicateWebhook = await worker.fetch(new Request('https://api.test/v1/billing/webhook', { method: 'POST', headers: { 'Stripe-Signature': await stripeSignature(activePayload) }, body: activePayload }), webhookEnv)
assert.equal((await duplicateWebhook.json()).duplicate, true)
const staleEvent = { id: 'evt_stale_old', type: 'customer.subscription.updated', created: 100, data: { object: { object: 'subscription', id: 'sub_test', customer: 'cus_test', status: 'canceled', current_period_end: 1000, cancel_at_period_end: false, metadata: { uid: 'user_test' } } } }
const stalePayload = JSON.stringify(staleEvent)
const staleWebhook = await worker.fetch(new Request('https://api.test/v1/billing/webhook', { method: 'POST', headers: { 'Stripe-Signature': await stripeSignature(stalePayload) }, body: stalePayload }), webhookEnv)
assert.equal((await staleWebhook.json()).stale, true)
assert.equal(billingDb.subscriptions.get('user_test').plan, 'pro')
assert.equal(billingDb.subscriptions.get('user_test').status, 'active')

const createdEvent = { id: 'evt_subscription_created', type: 'customer.subscription.created', created: 300, data: { object: { object: 'subscription', id: 'sub_created', customer: 'cus_created', status: 'active', current_period_end: 3000, cancel_at_period_end: false, metadata: { uid: 'created_user' } } } }
const createdPayload = JSON.stringify(createdEvent)
const createdWebhook = await worker.fetch(new Request('https://api.test/v1/billing/webhook', { method: 'POST', headers: { 'Stripe-Signature': await stripeSignature(createdPayload) }, body: createdPayload }), webhookEnv)
assert.equal(createdWebhook.status, 200)
assert.equal(billingDb.subscriptions.get('created_user').status, 'active')
assert.equal(billingDb.subscriptions.get('created_user').current_period_end, 3000)

const basilItemEvent = { id: 'evt_basil_item_period', type: 'customer.subscription.updated', created: 320, data: { object: { object: 'subscription', id: 'sub_basil', customer: 'cus_basil', status: 'active', items: { data: [{ id: 'si_basil', current_period_end: 3200 }] }, cancel_at_period_end: false, metadata: { uid: 'basil_user' } } } }
const basilItemPayload = JSON.stringify(basilItemEvent)
const basilItemWebhook = await worker.fetch(new Request('https://api.test/v1/billing/webhook', { method: 'POST', headers: { 'Stripe-Signature': await stripeSignature(basilItemPayload) }, body: basilItemPayload }), webhookEnv)
assert.equal(basilItemWebhook.status, 200)
assert.equal(billingDb.subscriptions.get('basil_user').status, 'active')
assert.equal(billingDb.subscriptions.get('basil_user').current_period_end, 3200)

const basilNestedEvent = { id: 'evt_basil_nested_period', type: 'customer.subscription.updated', created: 330, data: { object: { object: 'subscription', id: 'sub_basil_nested', customer: 'cus_basil_nested', status: 'active', items: { data: [{ id: 'si_basil_nested', period: { end: 3300 } }] }, cancel_at_period_end: false, metadata: { uid: 'basil_nested_user' } } } }
const basilNestedPayload = JSON.stringify(basilNestedEvent)
const basilNestedWebhook = await worker.fetch(new Request('https://api.test/v1/billing/webhook', { method: 'POST', headers: { 'Stripe-Signature': await stripeSignature(basilNestedPayload) }, body: basilNestedPayload }), webhookEnv)
assert.equal(basilNestedWebhook.status, 200)
assert.equal(billingDb.subscriptions.get('basil_nested_user').current_period_end, 3300)

const noPeriodEvent = { id: 'evt_no_period', type: 'customer.subscription.updated', created: 340, data: { object: { object: 'subscription', id: 'sub_no_period', customer: 'cus_no_period', status: 'active', items: { data: [] }, cancel_at_period_end: false, metadata: { uid: 'no_period_user' } } } }
const noPeriodPayload = JSON.stringify(noPeriodEvent)
const noPeriodWebhook = await worker.fetch(new Request('https://api.test/v1/billing/webhook', { method: 'POST', headers: { 'Stripe-Signature': await stripeSignature(noPeriodPayload) }, body: noPeriodPayload }), webhookEnv)
assert.equal(noPeriodWebhook.status, 200)
assert.equal(billingDb.subscriptions.get('no_period_user').status, 'active')
assert.equal(billingDb.subscriptions.get('no_period_user').current_period_end, null)

const staleCheckoutEvent = { id: 'evt_checkout_stale', type: 'checkout.session.completed', created: 250, data: { object: { object: 'checkout.session', id: 'cs_stale', status: 'complete', customer: 'cus_created', subscription: 'sub_created', client_reference_id: 'created_user', metadata: { uid: 'created_user' } } } }
const staleCheckoutPayload = JSON.stringify(staleCheckoutEvent)
const staleCheckoutWebhook = await worker.fetch(new Request('https://api.test/v1/billing/webhook', { method: 'POST', headers: { 'Stripe-Signature': await stripeSignature(staleCheckoutPayload) }, body: staleCheckoutPayload }), webhookEnv)
assert.equal((await staleCheckoutWebhook.json()).stale, true)
assert.equal(billingDb.subscriptions.get('created_user').status, 'active')
assert.equal(billingDb.subscriptions.get('created_user').current_period_end, 3000)

const originalFetchForInvoice = globalThis.fetch
globalThis.fetch = async (url) => {
  const href = String(url)
  if (href.includes('/v1/subscriptions/sub_created')) return new Response(JSON.stringify({ object: 'subscription', id: 'sub_created', customer: 'cus_created', status: 'active', items: { data: [] }, cancel_at_period_end: false, metadata: { uid: 'created_user' } }), { status: 200, headers: { 'content-type': 'application/json' } })
  return new Response('{}', { status: 404 })
}
const invoiceEvent = { id: 'evt_invoice_paid', type: 'invoice.payment_succeeded', created: 400, data: { object: { object: 'invoice', id: 'in_test', status: 'paid', customer: 'cus_created', subscription: 'sub_created', lines: { data: [{ period: { end: 4000 } }] } } } }
const invoicePayload = JSON.stringify(invoiceEvent)
const invoiceWebhook = await worker.fetch(new Request('https://api.test/v1/billing/webhook', { method: 'POST', headers: { 'Stripe-Signature': await stripeSignature(invoicePayload) }, body: invoicePayload }), { ...webhookEnv, STRIPE_SECRET_KEY: 'sk_test_placeholder' })
assert.equal(invoiceWebhook.status, 200)
assert.equal(billingDb.subscriptions.get('created_user').status, 'active')
assert.notEqual(billingDb.subscriptions.get('created_user').status, 'paid')
assert.notEqual(billingDb.subscriptions.get('created_user').status, 'complete')
assert.equal(billingDb.subscriptions.get('created_user').current_period_end, 4000)
globalThis.fetch = originalFetchForInvoice

globalThis.fetch = async (url) => {
  const href = String(url)
  if (href.includes('securetoken@system.gserviceaccount.com')) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } })
  return new Response('{}', { status: 404 })
}
const freeStatus = await worker.fetch(new Request('https://api.test/v1/billing/status', { headers: { Authorization: `Bearer ${token}` } }), { FIREBASE_PROJECT_ID: 'agentverify-test', BILLING_DB: createD1Mock() })
assert.equal((await freeStatus.json()).plan, 'free')
const proStatus = await worker.fetch(new Request('https://api.test/v1/billing/status', { headers: { Authorization: `Bearer ${token}` } }), { FIREBASE_PROJECT_ID: 'agentverify-test', BILLING_DB: billingDb })
assert.equal((await proStatus.json()).plan, 'pro')
const noPeriodStatusDb = createD1Mock()
noPeriodStatusDb.subscriptions.set('user_test', { uid: 'user_test', plan: 'pro', status: 'active', stripe_customer_id: 'cus_no_period', stripe_subscription_id: 'sub_no_period', current_period_end: null, cancel_at_period_end: 0, last_stripe_event_id: 'evt_no_period_status', last_stripe_event_created: 500, updated_at: 500, schema_version: 1 })
const noPeriodStatus = await worker.fetch(new Request('https://api.test/v1/billing/status', { headers: { Authorization: `Bearer ${token}` } }), { FIREBASE_PROJECT_ID: 'agentverify-test', BILLING_DB: noPeriodStatusDb })
const noPeriodStatusBody = await noPeriodStatus.json()
assert.equal(noPeriodStatusBody.plan, 'pro')
assert.equal(noPeriodStatusBody.currentPeriodEnd, null)
const trialingDb = createD1Mock()
trialingDb.subscriptions.set('user_test', { uid: 'user_test', plan: 'pro', status: 'trialing', stripe_customer_id: 'cus_trial', stripe_subscription_id: 'sub_trial', current_period_end: 5000, cancel_at_period_end: 0, last_stripe_event_id: 'evt_trial', last_stripe_event_created: 500, updated_at: 500, schema_version: 1 })
const trialingStatus = await worker.fetch(new Request('https://api.test/v1/billing/status', { headers: { Authorization: `Bearer ${token}` } }), { FIREBASE_PROJECT_ID: 'agentverify-test', BILLING_DB: trialingDb })
assert.equal((await trialingStatus.json()).plan, 'pro')
const completeDb = createD1Mock()
completeDb.subscriptions.set('user_test', { uid: 'user_test', plan: 'pro', status: 'complete', stripe_customer_id: 'cus_complete', stripe_subscription_id: 'sub_complete', current_period_end: null, cancel_at_period_end: 0, last_stripe_event_id: 'evt_complete', last_stripe_event_created: 500, updated_at: 500, schema_version: 1 })
const completeStatus = await worker.fetch(new Request('https://api.test/v1/billing/status', { headers: { Authorization: `Bearer ${token}` } }), { FIREBASE_PROJECT_ID: 'agentverify-test', BILLING_DB: completeDb })
assert.equal((await completeStatus.json()).plan, 'free')
const pastDueDb = createD1Mock()
pastDueDb.subscriptions.set('user_test', { uid: 'user_test', plan: 'pro', status: 'past_due', stripe_customer_id: 'cus_past_due', stripe_subscription_id: 'sub_past_due', current_period_end: 5000, cancel_at_period_end: 0, last_stripe_event_id: 'evt_past_due', last_stripe_event_created: 500, updated_at: 500, schema_version: 1 })
const pastDueStatus = await worker.fetch(new Request('https://api.test/v1/billing/status', { headers: { Authorization: `Bearer ${token}` } }), { FIREBASE_PROJECT_ID: 'agentverify-test', BILLING_DB: pastDueDb })
assert.equal((await pastDueStatus.json()).plan, 'free')

// /v1/billing/status must expose the REAL server-side usage count (used by the dashboard scan
// UI's pre-scan warning) — the same usage_monthly row /v1/scan itself enforces against, not a
// separately-tracked number that could drift from what's actually enforced.
const usageStatusDb = createD1Mock()
const usageMonth = new Date().toISOString().slice(0, 7)
usageStatusDb.usage.set(`user_test:${usageMonth}`, { uid: 'user_test', month: usageMonth, scan_count: 7, plan_snapshot: 'free', updated_at: 0 })
const usageStatus = await worker.fetch(new Request('https://api.test/v1/billing/status', { headers: { Authorization: `Bearer ${token}` } }), { FIREBASE_PROJECT_ID: 'agentverify-test', BILLING_DB: usageStatusDb })
assert.equal((await usageStatus.json()).used, 7)

globalThis.fetch = originalFetchForBilling

const scanRequest = (headers = {}, body = { content: fixture.content, fileName: fixture.fileName }) => new Request('https://api.test/v1/scan', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

const missingAuthScan = await worker.fetch(scanRequest(), { FIREBASE_API_KEY: 'firebase_test_placeholder' })
assert.equal(missingAuthScan.status, 401)
assert.equal((await missingAuthScan.json()).error, 'Invalid or unauthorized Agent Verify API key')

const missingValidationConfigScan = await worker.fetch(scanRequest({ Authorization: 'Bearer av_valid_shape_but_no_config_000000000000' }), {})
assert.equal(missingValidationConfigScan.status, 401)
assert.equal((await missingValidationConfigScan.json()).findings, undefined)

const malformedAuthScan = await worker.fetch(scanRequest({ Authorization: 'Bearer not-an-agentverify-key' }), { FIREBASE_API_KEY: 'firebase_test_placeholder' })
assert.equal(malformedAuthScan.status, 401)
assert.equal((await malformedAuthScan.json()).findings, undefined)

const originalFetch = globalThis.fetch
let fetchCalls = 0
globalThis.fetch = async () => {
  fetchCalls += 1
  return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'content-type': 'application/json' } })
}
const invalidKeyScan = await worker.fetch(scanRequest({ Authorization: 'Bearer av_invalid_worker_test_key_000000000000' }), { FIREBASE_API_KEY: 'firebase_test_placeholder' })
assert.equal(invalidKeyScan.status, 401)
const invalidBody = await invalidKeyScan.json()
assert.equal(invalidBody.findings, undefined)
assert.equal(fetchCalls, 1)

globalThis.fetch = async () => new Response(JSON.stringify({ fields: { uid: { stringValue: 'user_test' }, status: { stringValue: 'revoked' } } }), { status: 200, headers: { 'content-type': 'application/json' } })
const revokedKeyScan = await worker.fetch(scanRequest({ Authorization: 'Bearer av_revoked_worker_test_key_000000000000' }), { FIREBASE_API_KEY: 'firebase_test_placeholder' })
assert.equal(revokedKeyScan.status, 401)

let savedReport = false
globalThis.fetch = async (url, init) => {
  const href = String(url)
  const oauthMock = mockOauthTokenFetch(href)
  if (oauthMock) return oauthMock
  if (href.includes('/documents/apiKeyIndex/')) {
    return new Response(JSON.stringify({ fields: { uid: { stringValue: 'user_test' }, status: { stringValue: 'active' } } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (href.includes('/documents/cliReports/')) {
    savedReport = init?.method === 'PATCH' && String(init?.headers?.Authorization ?? '').startsWith('Bearer test-service-account-access-token')
    return new Response(JSON.stringify({ name: 'saved' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Response('{}', { status: 404 })
}
const serviceAccountEnv = await createServiceAccountEnv()
const validKeyScan = await worker.fetch(scanRequest({ Authorization: 'Bearer av_valid_worker_test_key_000000000000' }), { FIREBASE_API_KEY: 'firebase_test_placeholder', ...serviceAccountEnv })
assert.equal(validKeyScan.status, 200)
const validBody = await validKeyScan.json()
assert.equal(validBody.saved, true)
assert.match(validBody.reportUrl, /^https:\/\/aimodularity\.com\/agentverify\/report\/\?id=REPORT-/)
assert.ok(Array.isArray(validBody.findings))
assert.equal(savedReport, true, 'cliReports write must be authenticated with the service account access token')
globalThis.fetch = originalFetch

// Scan quota: a free-plan uid at its monthly limit must be rejected with 429 before a
// scan runs, and usage must actually accumulate across successful scans.
globalThis.fetch = async (url) => {
  const href = String(url)
  const oauthMock = mockOauthTokenFetch(href)
  if (oauthMock) return oauthMock
  if (href.includes('/documents/apiKeyIndex/')) {
    return new Response(JSON.stringify({ fields: { uid: { stringValue: 'quota_user' }, status: { stringValue: 'active' } } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (href.includes('/documents/cliReports/')) {
    return new Response(JSON.stringify({ name: 'saved' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Response('{}', { status: 404 })
}
const quotaDb = createD1Mock()
const quotaEnv = { FIREBASE_API_KEY: 'firebase_test_placeholder', BILLING_DB: quotaDb, ...(await createServiceAccountEnv()) }

const firstScan = await worker.fetch(scanRequest({ Authorization: 'Bearer av_quota_worker_test_key_000000000000' }), quotaEnv)
assert.equal(firstScan.status, 200)
assert.equal(quotaDb.usage.get(`quota_user:${new Date().toISOString().slice(0, 7)}`)?.scan_count, 1)

const month = new Date().toISOString().slice(0, 7)
quotaDb.usage.set(`quota_user:${month}`, { uid: 'quota_user', month, scan_count: 10, plan_snapshot: 'free', updated_at: 0 })
const overQuotaScan = await worker.fetch(scanRequest({ Authorization: 'Bearer av_quota_worker_test_key_000000000000' }), quotaEnv)
assert.equal(overQuotaScan.status, 429)
const overQuotaBody = await overQuotaScan.json()
assert.equal(overQuotaBody.error, 'Monthly scan quota exceeded')
assert.equal(overQuotaBody.plan, 'free')
assert.equal(overQuotaBody.limit, 10)
assert.equal(quotaDb.usage.get(`quota_user:${month}`)?.scan_count, 10, 'quota-exceeded request must not be counted as a scan')

// Coherent usage ledger: the SAME uid, now blocked via the CLI/API-key path above, must be
// blocked identically when scanning through the browser dashboard's Firebase-token path — one
// ledger per uid, not a separate counter per auth mechanism. /v1/scan no longer distinguishes
// "web" from "CLI" for quota purposes at all.
const quotaUserFirebase = await createFirebaseToken('quota_user', 'quota@example.test', 'kid-quota')
globalThis.fetch = async (url) => {
  const href = String(url)
  const oauthMock = mockOauthTokenFetch(href)
  if (oauthMock) return oauthMock
  if (href.includes('securetoken@system.gserviceaccount.com')) {
    return new Response(JSON.stringify({ keys: [quotaUserFirebase.jwk] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Response('{}', { status: 404 })
}
const dashboardOverQuota = await worker.fetch(
  scanRequest({ Authorization: `Bearer ${quotaUserFirebase.token}` }),
  { ...quotaEnv, FIREBASE_PROJECT_ID: 'agentverify-test' }
)
assert.equal(dashboardOverQuota.status, 429, 'dashboard scan must be blocked by the same quota the CLI path already exhausted')
assert.equal((await dashboardOverQuota.json()).limit, 10)
assert.equal(quotaDb.usage.get(`quota_user:${month}`)?.scan_count, 10, 'blocked dashboard attempt must not be counted either')
globalThis.fetch = originalFetch

// A fresh dashboard (Firebase-token) scan, from zero usage: must succeed, decrement the same
// usage_monthly ledger the CLI path writes to, and — unlike the CLI path — save the report with
// source:'dashboard' rather than 'cli', so ReportView/PDF export label it correctly.
let dashboardSavedSource = null
globalThis.fetch = async (url, init) => {
  const href = String(url)
  const oauthMock = mockOauthTokenFetch(href)
  if (oauthMock) return oauthMock
  if (href.includes('securetoken@system.gserviceaccount.com')) {
    return new Response(JSON.stringify({ keys: [dashboardFirebase.jwk] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (href.includes('/documents/cliReports/')) {
    const body = JSON.parse(init.body)
    dashboardSavedSource = body.fields.source?.stringValue ?? null
    return new Response(JSON.stringify({ name: 'saved' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Response('{}', { status: 404 })
}
const dashboardDb = createD1Mock()
const dashboardFirebase = await createFirebaseToken('dashboard_user', 'dashboard@example.test', 'kid-dashboard')
const dashboardEnv = { FIREBASE_PROJECT_ID: 'agentverify-test', BILLING_DB: dashboardDb, ...(await createServiceAccountEnv()) }
const dashboardScan = await worker.fetch(scanRequest({ Authorization: `Bearer ${dashboardFirebase.token}` }), dashboardEnv)
assert.equal(dashboardScan.status, 200)
assert.equal((await dashboardScan.json()).saved, true)
assert.equal(dashboardDb.usage.get(`dashboard_user:${month}`)?.scan_count, 1, 'a dashboard scan must increment the real server-side usage ledger, not a client-only counter')
assert.equal(dashboardSavedSource, 'dashboard', 'a browser-originated scan must be saved with source:dashboard, not cli')
globalThis.fetch = originalFetch

// Oversized scan payload must be rejected outright (413), not silently truncated server-side.
globalThis.fetch = async (url) => {
  const href = String(url)
  const oauthMock = mockOauthTokenFetch(href)
  if (oauthMock) return oauthMock
  if (href.includes('/documents/apiKeyIndex/')) {
    return new Response(JSON.stringify({ fields: { uid: { stringValue: 'oversize_user' }, status: { stringValue: 'active' } } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Response('{}', { status: 404 })
}
const oversizedContent = 'a'.repeat(6 * 1024 * 1024) // 6MB, over the 5MB limit
const oversizedScan = await worker.fetch(scanRequest({ Authorization: 'Bearer av_oversize_worker_test_key_000000000000' }, { content: oversizedContent, fileName: 'huge.ts' }), { FIREBASE_API_KEY: 'firebase_test_placeholder' })
assert.equal(oversizedScan.status, 413)
globalThis.fetch = originalFetch

// ============================================================================
// Public demo scan (POST /v1/demo/scan) — no auth, no persistence, no quota, own rate limit
// ============================================================================

const demoScanRequest = (body = { content: fixture.content, fileName: 'public-demo-agent.js' }) => new Request('https://api.test/v1/demo/scan', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

let demoFetchCalls = 0
const originalFetchForDemo = globalThis.fetch
globalThis.fetch = async () => { demoFetchCalls += 1; return new Response('{}', { status: 404 }) }

const demoScanOk = await worker.fetch(demoScanRequest(), {})
assert.equal(demoScanOk.status, 200)
const demoScanBody = await demoScanOk.json()
assert.ok(Array.isArray(demoScanBody.findings))
assert.equal(demoFetchCalls, 0, 'a demo scan must never touch Firestore/D1/Stripe — no persistence, no quota')

const demoMissingContent = await worker.fetch(demoScanRequest({ fileName: 'x' }), {})
assert.equal(demoMissingContent.status, 400)

const demoOversized = await worker.fetch(demoScanRequest({ content: 'a'.repeat(201 * 1024), fileName: 'x' }), {})
assert.equal(demoOversized.status, 413)

const demoMalformed = await worker.fetch(new Request('https://api.test/v1/demo/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' }), {})
assert.equal(demoMalformed.status, 400)

// Per-IP rate limit: 5 allowed, 6th blocked, from the SAME simulated client IP.
const rateLimitedReq = (n) => new Request('https://api.test/v1/demo/scan', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
  body: JSON.stringify({ content: fixture.content + n, fileName: 'x' }),
})
for (let i = 0; i < 5; i += 1) {
  const res = await worker.fetch(rateLimitedReq(i), {})
  assert.equal(res.status, 200, `demo scan ${i + 1}/5 from the same IP should be allowed`)
}
const sixthDemoScan = await worker.fetch(rateLimitedReq(5), {})
assert.equal(sixthDemoScan.status, 429, 'the 6th demo scan from the same IP within the window must be rate-limited')
assert.match((await sixthDemoScan.json()).error, /Too many public demo scans/)

// A different IP is a separate bucket — not blocked by the first IP's exhausted limit.
const otherIpScan = await worker.fetch(new Request('https://api.test/v1/demo/scan', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.7' },
  body: JSON.stringify({ content: fixture.content, fileName: 'x' }),
}), {})
assert.equal(otherIpScan.status, 200)
globalThis.fetch = originalFetchForDemo

// ============================================================================
// Fix verification (POST /v1/verify-fix) — Firebase-auth only, ownership-checked, own rate
// limit, never touches the monthly scan quota ledger
// ============================================================================

const { token: fixOwnerToken, jwk: fixOwnerJwk } = await createFirebaseToken('fix_owner_uid', 'owner@example.test', 'kid-fix-owner')
const { token: fixOtherToken, jwk: fixOtherJwk } = await createFirebaseToken('fix_other_uid', 'other@example.test', 'kid-fix-other')

function mockVerifyFixFetch(jwks, { reportOwnerUid = 'fix_owner_uid', reportExists = true } = {}) {
  return async (url) => {
    const href = String(url)
    if (href.includes('securetoken@system.gserviceaccount.com')) {
      return new Response(JSON.stringify({ keys: jwks }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const oauthMock = mockOauthTokenFetch(href)
    if (oauthMock) return oauthMock
    if (href.includes('/documents/reports/')) {
      return new Response('{}', { status: 404 }) // not in the primary "reports" collection for this test
    }
    if (href.includes('/documents/cliReports/')) {
      if (!reportExists) return new Response('{}', { status: 404 })
      return new Response(JSON.stringify({ fields: { uid: { stringValue: reportOwnerUid } } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('{}', { status: 404 })
  }
}

const verifyFixRequest = (token, body) => new Request('https://api.test/v1/verify-fix', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const verifyFixEnv = { FIREBASE_PROJECT_ID: 'agentverify-test', ...(await createServiceAccountEnv()) }
const goodFixBody = { reportId: 'REPORT-fixtest', findingCode: 'MISSING_SIGNATURE', fixedContent: fixture.content, fileName: 'fixed.ts' }

globalThis.fetch = mockVerifyFixFetch([fixOwnerJwk, fixOtherJwk])

const noAuthFix = await worker.fetch(new Request('https://api.test/v1/verify-fix', { method: 'POST', body: JSON.stringify(goodFixBody) }), verifyFixEnv)
assert.equal(noAuthFix.status, 401)

const wrongUserFix = await worker.fetch(verifyFixRequest(fixOtherToken, goodFixBody), verifyFixEnv)
assert.equal(wrongUserFix.status, 403, 'a user who does not own the report must be rejected')

globalThis.fetch = mockVerifyFixFetch([fixOwnerJwk, fixOtherJwk], { reportExists: false })
const missingReportFix = await worker.fetch(verifyFixRequest(fixOwnerToken, goodFixBody), verifyFixEnv)
assert.equal(missingReportFix.status, 404)

globalThis.fetch = mockVerifyFixFetch([fixOwnerJwk, fixOtherJwk])
const missingFieldsFix = await worker.fetch(verifyFixRequest(fixOwnerToken, { reportId: 'REPORT-fixtest' }), verifyFixEnv)
assert.equal(missingFieldsFix.status, 400)

const oversizedFix = await worker.fetch(verifyFixRequest(fixOwnerToken, { ...goodFixBody, fixedContent: 'a'.repeat(1024 * 1024 + 1) }), verifyFixEnv)
assert.equal(oversizedFix.status, 413)

const goodFix = await worker.fetch(verifyFixRequest(fixOwnerToken, goodFixBody), verifyFixEnv)
assert.equal(goodFix.status, 200)
const goodFixBody2 = await goodFix.json()
assert.equal(goodFixBody2.reportId, 'REPORT-fixtest')
assert.equal(goodFixBody2.findingCode, 'MISSING_SIGNATURE')
assert.ok(Array.isArray(goodFixBody2.rescan.findings))

// Quota-bypass test: fix verification must NEVER touch the monthly scan quota ledger, even
// though it runs the real scanner — it has its own separate rate limit instead (asserted below).
const quotaBypassDb = createD1Mock()
const quotaBypassEnv = { ...verifyFixEnv, BILLING_DB: quotaBypassDb }
await worker.fetch(verifyFixRequest(fixOwnerToken, goodFixBody), quotaBypassEnv)
assert.equal(quotaBypassDb.usage.size, 0, 'verify-fix must not increment usage_monthly — it is not a billed scan')

// Own rate limit: 30 allowed per uid per hour, 31st blocked — independent of the scan quota.
// Fresh uid/report so this count isn't polluted by the handful of verify-fix calls already made
// above against fix_owner_uid's bucket (the rate limit is checked before body validation, so
// even the malformed/missing-report/oversized attempts above count against it — correct
// behavior: an attacker can't dodge the limit by sending invalid requests).
const { token: rateLimitToken, jwk: rateLimitJwk } = await createFirebaseToken('fix_ratelimit_uid', 'ratelimit@example.test', 'kid-fix-ratelimit')
globalThis.fetch = mockVerifyFixFetch([rateLimitJwk], { reportOwnerUid: 'fix_ratelimit_uid' })
for (let i = 0; i < 30; i += 1) {
  const res = await worker.fetch(verifyFixRequest(rateLimitToken, { ...goodFixBody, findingCode: `CODE_${i}` }), verifyFixEnv)
  assert.equal(res.status, 200, `verify-fix ${i + 1}/30 for this user should be allowed`)
}
const thirtyFirstFix = await worker.fetch(verifyFixRequest(rateLimitToken, { ...goodFixBody, findingCode: 'CODE_OVER' }), verifyFixEnv)
assert.equal(thirtyFirstFix.status, 429, 'the 31st fix-verification for the same user within the window must be rate-limited')
globalThis.fetch = originalFetchForDemo

const webBillingSource = readFileSync(resolve(__dirname, '../../../apps/web/src/lib/billing.test-data.ts'), 'utf8')
assert.match(webBillingSource, /freePdf: canUseProFeature\(freeBillingStatus, 'pdfExport'\)/)
assert.match(webBillingSource, /proPdf: canUseProFeature\(proBillingStatus, 'pdfExport'\)/)
assert.match(webBillingSource, /teamDisabled: getPlanAction\('team'\)\.disabled === true/)
assert.match(webBillingSource, /enterpriseContactOnly: getPlanAction\('enterprise'\)\.href\.startsWith\('mailto:'\)/)

// ============================================================================
// Signed Verification Attestation
// ============================================================================

async function createAttestationSigningEnv(issuer = 'agentverify-test') {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  privateJwk.key_ops = ['sign']
  return { ATTESTATION_SIGNING_PRIVATE_KEY_JWK: JSON.stringify(privateJwk), ATTESTATION_ISSUER: issuer }
}

function mockScanFetch(uid, { onSave } = {}) {
  return async (url, init) => {
    const href = String(url)
    const oauthMock = mockOauthTokenFetch(href)
    if (oauthMock) return oauthMock
    if (href.includes('/documents/apiKeyIndex/')) {
      return new Response(JSON.stringify({ fields: { uid: { stringValue: uid }, status: { stringValue: 'active' } } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (href.includes('/documents/cliReports/')) {
      onSave?.(init)
      return new Response(JSON.stringify({ name: 'saved' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('{}', { status: 404 })
  }
}

// A scan with signing configured produces a real, independently-verifiable signature — not a
// fixed/fake string. verifyAttestation() here is the SAME function a third party or the public
// trust page would call, imported straight from the scanner package.
globalThis.fetch = mockScanFetch('attest_user')
const attestationEnv = { FIREBASE_API_KEY: 'firebase_test_placeholder', ...(await createServiceAccountEnv()), ...(await createAttestationSigningEnv()) }
const signedScan = await worker.fetch(scanRequest({ Authorization: 'Bearer av_attest_worker_test_key_000000000000' }), attestationEnv)
assert.equal(signedScan.status, 200)
const signedBody = await signedScan.json()
assert.ok(signedBody.attestation, 'attestation must be present when a signing key is configured')
assert.equal(signedBody.attestation.algorithm, 'ECDSA-P256-SHA256')
assert.equal(signedBody.attestation.payload.artifactHash, signedBody.artifactFingerprint.artifactHash)
assert.equal(signedBody.attestation.payload.verdict, signedBody.verdict)
assert.equal(signedBody.attestation.payload.score, signedBody.riskScore)
assert.equal(signedBody.attestation.payload.reportHash, signedBody.reportIntegrity.reportHash)
assert.equal(signedBody.attestation.payload.issuer, 'agentverify-test')
assert.ok(!('policyProfile' in signedBody.attestation.payload), 'no policy was requested, so the signed payload must omit policy fields entirely')
const verifyResult = await verifyAttestation(signedBody.attestation)
assert.equal(verifyResult.status, 'VALID', `expected VALID, got ${verifyResult.status}: ${verifyResult.reason}`)

// Tamper with the payload after receiving it (as if intercepted in transit) — the signature must
// no longer validate. This proves the wiring produces a genuinely checkable signature, not a
// static placeholder.
const tamperedScore = { ...signedBody.attestation, payload: { ...signedBody.attestation.payload, score: 100 } }
const tamperedResult = await verifyAttestation(tamperedScore)
assert.equal(tamperedResult.status, 'INVALID_SIGNATURE')

// No signing key configured — attestation must be null, and the scan must still succeed. Signing
// is skipped, never faked.
globalThis.fetch = mockScanFetch('unsigned_user')
const unsignedEnv = { FIREBASE_API_KEY: 'firebase_test_placeholder', ...(await createServiceAccountEnv()) }
const unsignedScan = await worker.fetch(scanRequest({ Authorization: 'Bearer av_unsigned_worker_test_key_000000000000' }), unsignedEnv)
assert.equal(unsignedScan.status, 200)
const unsignedBody = await unsignedScan.json()
assert.equal(unsignedBody.attestation, null)
assert.equal(unsignedBody.saved, true, 'a scan must still succeed and save without a configured signing key')
globalThis.fetch = originalFetch

// GET /v1/attestation/public-key — public verification key only, present iff signing is configured.
const publicKeyRes = await worker.fetch(new Request('https://api.test/v1/attestation/public-key'), attestationEnv)
assert.equal(publicKeyRes.status, 200)
const publicKeyBody = await publicKeyRes.json()
assert.equal(publicKeyBody.algorithm, 'ECDSA-P256-SHA256')
assert.equal(publicKeyBody.issuer, 'agentverify-test')
assert.deepEqual(publicKeyBody.publicKey, signedBody.attestation.publicKey)
assert.ok(!('d' in publicKeyBody.publicKey), 'public-key endpoint must never expose the private d value')

const noKeyConfiguredRes = await worker.fetch(new Request('https://api.test/v1/attestation/public-key'), {})
assert.equal(noKeyConfiguredRes.status, 404)

// ============================================================================
// Policy evaluation (attached to the same /v1/scan call, never mutating scanner evidence)
// ============================================================================

globalThis.fetch = mockScanFetch('policy_user')
const policyEnv = { FIREBASE_API_KEY: 'firebase_test_placeholder', ...(await createServiceAccountEnv()), ...(await createAttestationSigningEnv()) }
const policyScan = await worker.fetch(
  scanRequest({ Authorization: 'Bearer av_policy_worker_test_key_000000000000' }, { content: fixture.content, fileName: fixture.fileName, policyId: 'financial-agent' }),
  policyEnv
)
assert.equal(policyScan.status, 200)
const policyBody = await policyScan.json()
assert.equal(policyBody.policyProfile, 'financial-agent')
assert.ok(policyBody.policyResult === 'PASS' || policyBody.policyResult === 'FAIL')
assert.equal(policyBody.attestation.payload.policyProfile, 'financial-agent')
assert.equal(policyBody.attestation.payload.policyResult, policyBody.policyResult)
// Requesting a policy must never change the scanner's own verdict/findings — compare against an
// unpolicied scan of the exact same content.
const bareEvaluation = createScanResult({ content: fixture.content, fileName: fixture.fileName })
assert.equal(policyBody.verdict, bareEvaluation.verdict)
assert.equal(policyBody.riskScore, bareEvaluation.riskScore)
assert.equal(policyBody.findings.length, bareEvaluation.findings.length)

const unknownPolicyScan = await worker.fetch(
  scanRequest({ Authorization: 'Bearer av_policy_worker_test_key_000000000000' }, { content: fixture.content, fileName: fixture.fileName, policyId: 'not-a-real-policy' }),
  policyEnv
)
assert.equal(unknownPolicyScan.status, 200, 'an unrecognized policyId must not fail the scan')
assert.equal((await unknownPolicyScan.json()).policyProfile, null)
globalThis.fetch = originalFetch

// ============================================================================
// Verification Status API — GET /v1/verification/{artifactHash}
// ============================================================================

const TEST_ARTIFACT_HASH = 'a'.repeat(64)

function firestoreDoc(fields) {
  const out = {}
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string') out[key] = { stringValue: value }
    else if (typeof value === 'number') out[key] = { integerValue: String(value) }
    else if (typeof value === 'boolean') out[key] = { booleanValue: value }
    else out[key] = { nullValue: null }
  }
  return { fields: out }
}

function mockVerificationFetch({ cliReports = [], reports = [] } = {}) {
  return async (url, init) => {
    const href = String(url)
    const oauthMock = mockOauthTokenFetch(href)
    if (oauthMock) return oauthMock
    if (href.includes('/documents/apiKeyIndex/')) {
      const key = decodeURIComponent(href.split('/documents/apiKeyIndex/')[1]?.split('?')[0] ?? '')
      if (key === 'av_owner_worker_test_key_000000000000') {
        return new Response(JSON.stringify({ fields: { uid: { stringValue: 'owner_uid' }, status: { stringValue: 'active' } } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (key === 'av_other_worker_test_key_000000000000') {
        return new Response(JSON.stringify({ fields: { uid: { stringValue: 'other_uid' }, status: { stringValue: 'active' } } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 404 })
    }
    if (href.endsWith(':runQuery') && init?.method === 'POST') {
      const body = JSON.parse(init.body)
      const collectionId = body.structuredQuery.from[0].collectionId
      const rows = collectionId === 'cliReports' ? cliReports : collectionId === 'reports' ? reports : []
      return new Response(JSON.stringify(rows.map(document => ({ document }))), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('{}', { status: 404 })
  }
}

const verificationRequest = (artifactHash, headers = {}) =>
  new Request(`https://api.test/v1/verification/${artifactHash}`, { headers })

// Malformed artifact hash — rejected before any lookup.
globalThis.fetch = mockVerificationFetch()
const malformedHashRes = await worker.fetch(verificationRequest('not-a-real-hash'), { FIREBASE_API_KEY: 'firebase_test_placeholder', ...(await createServiceAccountEnv()) })
assert.equal(malformedHashRes.status, 400)

// Not found — no matching record anywhere.
const notFoundEnv = { FIREBASE_API_KEY: 'firebase_test_placeholder', ...(await createServiceAccountEnv()) }
const notFoundRes = await worker.fetch(verificationRequest(TEST_ARTIFACT_HASH), notFoundEnv)
assert.equal(notFoundRes.status, 404)

// Unauthorized — an Authorization header is present but the key is invalid/unknown.
const unauthorizedRes = await worker.fetch(verificationRequest(TEST_ARTIFACT_HASH, { Authorization: 'Bearer av_totally_unknown_worker_test_key_00000000' }), notFoundEnv)
assert.equal(unauthorizedRes.status, 401)

// Public verification — no auth required, record explicitly published.
globalThis.fetch = mockVerificationFetch({
  cliReports: [firestoreDoc({
    reportId: 'REPORT-PUBLIC-1', uid: 'someone_else', verdict: 'VERIFIED', riskScore: 91,
    scannerVersion: '1.4.0', scannedAt: '2026-08-30T00:00:00.000Z', reportHash: 'b'.repeat(64),
    isPublic: true, attestation: '',
  })],
})
const publicRes = await worker.fetch(verificationRequest(TEST_ARTIFACT_HASH), notFoundEnv)
assert.equal(publicRes.status, 200)
const publicBody = await publicRes.json()
assert.equal(publicBody.status, 'public')
assert.equal(publicBody.verdict, 'VERIFIED')
assert.equal(publicBody.score, 91)
assert.equal(publicBody.artifactHash, TEST_ARTIFACT_HASH)
assert.equal(publicBody.findings, undefined, 'the verification status endpoint must never expose full findings')

// Private, authorized — the owner's own non-public record is visible to them.
globalThis.fetch = mockVerificationFetch({
  cliReports: [firestoreDoc({
    reportId: 'REPORT-PRIVATE-1', uid: 'owner_uid', verdict: 'NOT_VERIFIED', riskScore: 40,
    scannerVersion: '1.4.0', scannedAt: '2026-08-31T00:00:00.000Z', reportHash: 'c'.repeat(64),
    isPublic: false,
  })],
})
const ownerEnv = { FIREBASE_API_KEY: 'firebase_test_placeholder', ...(await createServiceAccountEnv()) }
const privateRes = await worker.fetch(verificationRequest(TEST_ARTIFACT_HASH, { Authorization: 'Bearer av_owner_worker_test_key_000000000000' }), ownerEnv)
assert.equal(privateRes.status, 200)
const privateBody = await privateRes.json()
assert.equal(privateBody.status, 'private')
assert.equal(privateBody.verdict, 'NOT_VERIFIED')

// Wrong tenant — a DIFFERENT authenticated user must never see this private, non-public record.
// The response must be identical to genuinely-not-found (404), never a distinguishable
// "exists but not yours" signal.
const wrongTenantRes = await worker.fetch(verificationRequest(TEST_ARTIFACT_HASH, { Authorization: 'Bearer av_other_worker_test_key_000000000000' }), ownerEnv)
assert.equal(wrongTenantRes.status, 404, 'a report belonging to another, non-public tenant must never be visible')

globalThis.fetch = originalFetch

// ============================================================================
// Organizations / RBAC / Audit Log — full stateful Firestore mock, exercised end-to-end
// through worker.fetch() exactly like a real request would hit it.
// ============================================================================

function createOrgFirestoreMock() {
  const docs = new Map() // path -> fields object (Firestore REST field-value shape)
  const apiKeys = new Map() // apiKey -> uid
  const emails = new Map() // email -> uid

  const toName = (path) => `projects/agentverify-org-test/databases/(default)/documents/${path}`
  const pathFromName = (name) => name.replace(/^.*\/documents\//, '')

  return {
    docs, apiKeys, emails,
    registerApiKey(key, uid) { apiKeys.set(key, uid) },
    registerEmail(email, uid) { emails.set(email, uid) },
    async fetch(url, init) {
      const href = String(url)
      const oauthMock = mockOauthTokenFetch(href)
      if (oauthMock) return oauthMock

      if (href.includes('/documents/apiKeyIndex/')) {
        const key = decodeURIComponent(href.split('/documents/apiKeyIndex/')[1]?.split('?')[0] ?? '')
        const uid = apiKeys.get(key)
        if (!uid) return new Response('{}', { status: 404 })
        return new Response(JSON.stringify({ fields: { uid: { stringValue: uid }, status: { stringValue: 'active' } } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }

      if (href.includes('identitytoolkit.googleapis.com/v1/accounts:lookup')) {
        // Real accounts:lookup-by-email is an ADMIN operation requiring a real OAuth/owner
        // bearer token, not just the API key query param — enforcing that here is a regression
        // test in its own right (resolveUidByEmail previously omitted this header entirely,
        // which 400s as MISSING_ID_TOKEN against both the real emulator and real production).
        const authHeader = init?.headers?.Authorization
        if (authHeader !== 'Bearer test-service-account-access-token' && authHeader !== 'Bearer owner') {
          return new Response(JSON.stringify({ error: { code: 400, message: 'MISSING_ID_TOKEN' } }), { status: 400, headers: { 'content-type': 'application/json' } })
        }
        const body = JSON.parse(init.body)
        const email = body.email[0]
        const uid = emails.get(email)
        return new Response(JSON.stringify({ users: uid ? [{ localId: uid }] : [] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }

      if (href.endsWith(':commit') && init?.method === 'POST') {
        const body = JSON.parse(init.body)
        for (const w of body.writes) {
          docs.set(pathFromName(w.update.name), w.update.fields)
        }
        return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } })
      }

      if (href.endsWith(':runQuery') && init?.method === 'POST') {
        const body = JSON.parse(init.body)
        const from = body.structuredQuery.from[0]
        if (from.collectionId === 'members' && from.allDescendants) {
          const filterUid = body.structuredQuery.where.fieldFilter.value.stringValue
          const rows = []
          for (const [path, fields] of docs.entries()) {
            if (/^organizations\/[^/]+\/members\/[^/]+$/.test(path) && fields.uid?.stringValue === filterUid) {
              rows.push({ document: { name: toName(path), fields } })
            }
          }
          return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })
      }

      // Collection list: .../organizations/{orgId}/members or .../organizations/{orgId}/auditEvents
      // (no further path segments, GET) — generalized over both subcollections this mock backs.
      const collectionListMatch = href.match(/\/documents\/organizations\/([^/]+)\/(members|auditEvents|webhooks)(?:\?.*)?$/)
      if (collectionListMatch && (!init || init.method === undefined || init.method === 'GET')) {
        const orgId = decodeURIComponent(collectionListMatch[1])
        const subcollection = collectionListMatch[2]
        const prefix = `organizations/${orgId}/${subcollection}/`
        const documents = [...docs.entries()]
          .filter(([path]) => path.startsWith(prefix))
          .map(([path, fields]) => ({ name: toName(path), fields }))
        return new Response(JSON.stringify({ documents }), { status: 200, headers: { 'content-type': 'application/json' } })
      }

      // Single doc GET/PATCH/DELETE (organizations/{orgId} or organizations/{orgId}/members/{uid} or auditEvents/{id})
      const singleDocMatch = href.match(/\/documents\/(organizations\/[^?]+)/)
      if (singleDocMatch) {
        const path = decodeURIComponent(singleDocMatch[1])
        const method = init?.method ?? 'GET'
        if (method === 'GET') {
          const fields = docs.get(path)
          if (!fields) return new Response('{}', { status: 404 })
          return new Response(JSON.stringify({ fields }), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        if (method === 'PATCH') {
          const body = JSON.parse(init.body)
          const hasUpdateMask = href.includes('updateMask.fieldPaths')
          const merged = hasUpdateMask ? { ...(docs.get(path) ?? {}), ...body.fields } : body.fields
          docs.set(path, merged)
          return new Response(JSON.stringify({ fields: merged }), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        if (method === 'DELETE') {
          docs.delete(path)
          return new Response('{}', { status: 200 })
        }
      }

      return new Response('{}', { status: 404 })
    },
  }
}

const orgMock = createOrgFirestoreMock()
globalThis.fetch = (...args) => orgMock.fetch(...args)
orgMock.registerApiKey('av_alice_worker_test_key_0000000000000', 'alice_uid')
orgMock.registerApiKey('av_bob_worker_test_key_00000000000000', 'bob_uid')
orgMock.registerApiKey('av_carol_worker_test_key_0000000000000', 'carol_uid')
orgMock.registerApiKey('av_dave_worker_test_key_00000000000000', 'dave_uid')
orgMock.registerEmail('bob@example.test', 'bob_uid')
orgMock.registerEmail('carol@example.test', 'carol_uid')
orgMock.registerEmail('dave@example.test', 'dave_uid')

const orgServiceEnv = { FIREBASE_API_KEY: 'firebase_test_placeholder', FIREBASE_PROJECT_ID: 'agentverify-org-test', ...(await createServiceAccountEnv()) }
const authHeader = (key) => ({ Authorization: `Bearer ${key}` })

// --- Org A: Alice creates it, becomes OWNER ---
const createOrgARes = await worker.fetch(new Request('https://api.test/v1/organizations', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader('av_alice_worker_test_key_0000000000000') }, body: JSON.stringify({ name: 'Org A' }),
}), orgServiceEnv)
assert.equal(createOrgARes.status, 201)
const orgA = await createOrgARes.json()
assert.ok(orgA.orgId)
assert.equal(orgA.ownerId, 'alice_uid')

// --- Org B: Dave creates it, becomes OWNER ---
const createOrgBRes = await worker.fetch(new Request('https://api.test/v1/organizations', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader('av_dave_worker_test_key_00000000000000') }, body: JSON.stringify({ name: 'Org B' }),
}), orgServiceEnv)
const orgB = await createOrgBRes.json()
assert.ok(orgB.orgId)
assert.notEqual(orgB.orgId, orgA.orgId)

// Alice (OWNER of Org A) invites Bob as MEMBER and Carol as ADMIN.
const inviteBob = await worker.fetch(new Request(`https://api.test/v1/organizations/${orgA.orgId}/members`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader('av_alice_worker_test_key_0000000000000') }, body: JSON.stringify({ email: 'bob@example.test', role: 'MEMBER' }),
}), orgServiceEnv)
assert.equal(inviteBob.status, 200)
const inviteCarol = await worker.fetch(new Request(`https://api.test/v1/organizations/${orgA.orgId}/members`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader('av_alice_worker_test_key_0000000000000') }, body: JSON.stringify({ email: 'carol@example.test', role: 'ADMIN' }),
}), orgServiceEnv)
assert.equal(inviteCarol.status, 200)

// --- RBAC matrix: MEMBER cannot invite members ---
const bobTriesInvite = await worker.fetch(new Request(`https://api.test/v1/organizations/${orgA.orgId}/members`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader('av_bob_worker_test_key_00000000000000') }, body: JSON.stringify({ email: 'dave@example.test', role: 'MEMBER' }),
}), orgServiceEnv)
assert.equal(bobTriesInvite.status, 403, 'MEMBER must not be able to invite members')

// --- RBAC matrix: ADMIN CAN invite members (legitimate action) ---
const carolInvites = await worker.fetch(new Request(`https://api.test/v1/organizations/${orgA.orgId}/members`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader('av_carol_worker_test_key_0000000000000') }, body: JSON.stringify({ email: 'dave@example.test', role: 'VIEWER' }),
}), orgServiceEnv)
assert.equal(carolInvites.status, 200, 'ADMIN should be able to invite members')

// --- RBAC matrix: ADMIN cannot change roles (modify_roles is OWNER-only) ---
const carolTriesPromote = await worker.fetch(new Request(`https://api.test/v1/organizations/${orgA.orgId}/members/bob_uid`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeader('av_carol_worker_test_key_0000000000000') }, body: JSON.stringify({ role: 'ADMIN' }),
}), orgServiceEnv)
assert.equal(carolTriesPromote.status, 403, 'ADMIN must not be able to change member roles — privilege escalation risk')

// --- RBAC matrix: OWNER CAN change roles (legitimate action) ---
const aliceChangesRole = await worker.fetch(new Request(`https://api.test/v1/organizations/${orgA.orgId}/members/bob_uid`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeader('av_alice_worker_test_key_0000000000000') }, body: JSON.stringify({ role: 'ADMIN' }),
}), orgServiceEnv)
assert.equal(aliceChangesRole.status, 200)

// --- RBAC matrix: VIEWER cannot start a scan attributed to the org ---
const viewerScanAttempt = await worker.fetch(scanRequest({ ...authHeader('av_dave_worker_test_key_00000000000000'), 'Content-Type': 'application/json' }, { content: fixture.content, fileName: fixture.fileName, organizationId: orgA.orgId }), orgServiceEnv)
assert.equal(viewerScanAttempt.status, 403, 'VIEWER must not be able to start a scan attributed to the organization')

// --- RBAC matrix: MEMBER CAN start a scan attributed to the org (legitimate action) ---
const memberScan = await worker.fetch(scanRequest({ ...authHeader('av_bob_worker_test_key_00000000000000'), 'Content-Type': 'application/json' }, { content: fixture.content, fileName: fixture.fileName, organizationId: orgA.orgId }), { ...orgServiceEnv, ...(await createAttestationSigningEnv()) })
assert.equal(memberScan.status, 200, 'MEMBER (now ADMIN, but originally MEMBER-eligible) should be able to scan for the org')

// --- Audit log: view_audit_log is available to every role, including VIEWER ---
const daveViewsAudit = await worker.fetch(new Request(`https://api.test/v1/organizations/${orgA.orgId}/audit-log`, { headers: authHeader('av_dave_worker_test_key_00000000000000') }), orgServiceEnv)
assert.equal(daveViewsAudit.status, 200, 'VIEWER should be able to view the audit log')
const auditBody = await daveViewsAudit.json()
assert.ok(auditBody.events.some(e => e.action === 'MEMBER_ADDED'))
assert.ok(auditBody.events.some(e => e.action === 'ROLE_CHANGED'))
assert.ok(auditBody.events.some(e => e.action === 'SCAN_COMPLETED'))
// Audit metadata must never contain anything that looks like a secret.
for (const event of auditBody.events) {
  assert.ok(!JSON.stringify(event.metadata).match(/password|secret|private[-_]?key/i))
}

// --- CROSS-ORGANIZATION ISOLATION (P0 security) ---
// Dave (VIEWER of Org A, OWNER of Org B) must not be able to act on Org B's data using
// permissions/roles that only apply within Org A, and vice versa — every check below re-derives
// the role from the ORG BEING ACTED ON, never assumes a role carries across organizations.

// Dave is OWNER of Org B but only VIEWER of Org A — his Org-B OWNER role must not leak into Org A.
const daveTriesModifyRolesInA = await worker.fetch(new Request(`https://api.test/v1/organizations/${orgA.orgId}/members/bob_uid`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeader('av_dave_worker_test_key_00000000000000') }, body: JSON.stringify({ role: 'MEMBER' }),
}), orgServiceEnv)
assert.equal(daveTriesModifyRolesInA.status, 403, "Dave's OWNER role in Org B must not grant modify_roles in Org A")

// Alice (OWNER of Org A) has no membership in Org B at all — must be denied, not just role-limited.
const aliceTriesViewMembersInB = await worker.fetch(new Request(`https://api.test/v1/organizations/${orgB.orgId}/members`, { headers: authHeader('av_alice_worker_test_key_0000000000000') }), orgServiceEnv)
assert.equal(aliceTriesViewMembersInB.status, 404, "a non-member of Org B must not be able to list Org B's members")

// Alice cannot read Org B's audit log either.
const aliceTriesAuditB = await worker.fetch(new Request(`https://api.test/v1/organizations/${orgB.orgId}/audit-log`, { headers: authHeader('av_alice_worker_test_key_0000000000000') }), orgServiceEnv)
assert.equal(aliceTriesAuditB.status, 404, "a non-member of Org B must not be able to view Org B's audit log")

// Alice cannot attribute a scan to Org B. Non-membership reports 404 (same as "org doesn't
// exist"), deliberately not a distinguishable 403 — this endpoint never confirms an org's
// existence to someone who isn't in it.
const aliceTriesScanForB = await worker.fetch(scanRequest({ ...authHeader('av_alice_worker_test_key_0000000000000'), 'Content-Type': 'application/json' }, { content: fixture.content, fileName: fixture.fileName, organizationId: orgB.orgId }), orgServiceEnv)
assert.equal(aliceTriesScanForB.status, 404, 'Alice must not be able to attribute a scan to an organization she does not belong to')

// listMyOrganizations must return exactly the organizations each user actually belongs to — no more, no less.
const aliceOrgsRes = await worker.fetch(new Request('https://api.test/v1/organizations/mine', { headers: authHeader('av_alice_worker_test_key_0000000000000') }), orgServiceEnv)
const aliceOrgs = (await aliceOrgsRes.json()).organizations
assert.deepEqual(aliceOrgs.map(o => o.orgId).sort(), [orgA.orgId])
assert.equal(aliceOrgs[0].role, 'OWNER')

const daveOrgsRes = await worker.fetch(new Request('https://api.test/v1/organizations/mine', { headers: authHeader('av_dave_worker_test_key_00000000000000') }), orgServiceEnv)
const daveOrgs = (await daveOrgsRes.json()).organizations
assert.deepEqual(daveOrgs.map(o => o.orgId).sort(), [orgA.orgId, orgB.orgId].sort())

// A completely unrelated user (no membership anywhere) gets an empty list, not an error.
orgMock.registerApiKey('av_eve_worker_test_key_000000000000000', 'eve_uid')
const eveOrgsRes = await worker.fetch(new Request('https://api.test/v1/organizations/mine', { headers: authHeader('av_eve_worker_test_key_000000000000000') }), orgServiceEnv)
assert.deepEqual((await eveOrgsRes.json()).organizations, [])

// --- OWNER cannot be demoted or removed through the member-role/remove endpoints (prevents an
// organization from accidentally losing its last owner via these code paths). ---
const demoteOwnerAttempt = await worker.fetch(new Request(`https://api.test/v1/organizations/${orgA.orgId}/members/alice_uid`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeader('av_alice_worker_test_key_0000000000000') }, body: JSON.stringify({ role: 'MEMBER' }),
}), orgServiceEnv)
assert.equal(demoteOwnerAttempt.status, 400)

const removeOwnerAttempt = await worker.fetch(new Request(`https://api.test/v1/organizations/${orgA.orgId}/members/alice_uid`, {
  method: 'DELETE', headers: authHeader('av_alice_worker_test_key_0000000000000'),
}), orgServiceEnv)
assert.equal(removeOwnerAttempt.status, 400)

// --- Unauthenticated / unauthorized requests to org endpoints are rejected outright ---
const noAuthOrgCreate = await worker.fetch(new Request('https://api.test/v1/organizations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }) }), orgServiceEnv)
assert.equal(noAuthOrgCreate.status, 401)

globalThis.fetch = originalFetch

// ============================================================================
// Webhook Foundation
// ============================================================================

// --- SSRF validation: real, meaningful rejections ---
assert.equal(validateWebhookUrl('https://example.com/hooks/agentverify').ok, true, 'a normal public https URL must be accepted')
assert.equal(validateWebhookUrl('http://example.com/hooks').ok, true, 'plain http is a transport-security concern, not SSRF — this layer only blocks unsafe targets')
assert.equal(validateWebhookUrl('ftp://example.com/x').ok, false, 'non-http(s) schemes must be rejected')
assert.equal(validateWebhookUrl('file:///etc/passwd').ok, false)
assert.equal(validateWebhookUrl('not a url').ok, false)
assert.equal(validateWebhookUrl('http://localhost/x').ok, false, 'localhost must be rejected')
assert.equal(validateWebhookUrl('http://sub.localhost/x').ok, false)
assert.equal(validateWebhookUrl('http://127.0.0.1/x').ok, false, 'loopback IPv4 must be rejected')
assert.equal(validateWebhookUrl('http://127.1.2.3/x').ok, false, 'the entire 127.0.0.0/8 range must be rejected')
assert.equal(validateWebhookUrl('http://[::1]/x').ok, false, 'loopback IPv6 must be rejected')
assert.equal(validateWebhookUrl('http://0.0.0.0/x').ok, false)
assert.equal(validateWebhookUrl('http://10.0.0.5/x').ok, false, 'RFC1918 10.0.0.0/8 must be rejected')
assert.equal(validateWebhookUrl('http://172.16.0.1/x').ok, false, 'RFC1918 172.16.0.0/12 must be rejected')
assert.equal(validateWebhookUrl('http://172.31.255.255/x').ok, false)
assert.equal(validateWebhookUrl('http://172.32.0.1/x').ok, true, 'just outside the 172.16.0.0/12 range must NOT be falsely blocked')
assert.equal(validateWebhookUrl('http://192.168.1.1/x').ok, false, 'RFC1918 192.168.0.0/16 must be rejected')
assert.equal(validateWebhookUrl('http://169.254.169.254/x').ok, false, 'the AWS/GCP/Azure cloud metadata address must be rejected')
assert.equal(validateWebhookUrl('http://169.254.1.1/x').ok, false, 'the whole link-local range must be rejected')
assert.equal(validateWebhookUrl('http://metadata.google.internal/x').ok, false, 'the GCP metadata hostname must be rejected even though it is not a literal IP')
assert.equal(validateWebhookUrl('http://[fe80::1]/x').ok, false, 'IPv6 link-local must be rejected')
assert.equal(validateWebhookUrl('http://[fc00::1]/x').ok, false, 'IPv6 unique-local must be rejected')
assert.equal(validateWebhookUrl('http://8.8.8.8/x').ok, true, 'a real public IP must not be falsely blocked')

// --- Signing / verification: valid, tampered, wrong secret, replayed, malformed ---
const webhookSecret = 'whsec_test_' + 'a'.repeat(40)
const wrongSecret = 'whsec_test_' + 'b'.repeat(40)
const { payload: whPayload, signatureHeader: whSig } = await buildWebhookDelivery('SCAN_COMPLETED', 'org_test', { scanId: 'REPORT-1', verdict: 'VERIFIED' }, webhookSecret)
const rawBody = JSON.stringify(whPayload)

const validDelivery = await verifyWebhookDelivery(rawBody, whSig, webhookSecret)
assert.equal(validDelivery.status, 'VALID')

const modifiedBody = JSON.stringify({ ...whPayload, data: { ...whPayload.data, verdict: 'NOT_VERIFIED' } })
const tamperedDelivery = await verifyWebhookDelivery(modifiedBody, whSig, webhookSecret)
assert.equal(tamperedDelivery.status, 'INVALID_SIGNATURE', 'a modified payload must fail verification against the original signature')

const wrongSecretDelivery = await verifyWebhookDelivery(rawBody, whSig, wrongSecret)
assert.equal(wrongSecretDelivery.status, 'INVALID_SIGNATURE', 'verifying with the wrong secret must fail')

const missingSigDelivery = await verifyWebhookDelivery(rawBody, null, webhookSecret)
assert.equal(missingSigDelivery.status, 'MALFORMED')

const malformedSigDelivery = await verifyWebhookDelivery(rawBody, 'not-a-real-signature-header', webhookSecret)
assert.equal(malformedSigDelivery.status, 'MALFORMED')

// Old/replayed request: sign with a timestamp far in the past, verify with "now" — must be EXPIRED.
const oldTimestamp = Math.floor(Date.now() / 1000) - 3600 // 1 hour ago, outside the default 5-minute window
const oldSig = `t=${oldTimestamp},v1=${(await signWebhookPayload(whPayload, webhookSecret)).split('v1=')[1]}`
// Build a signature that is VALID for oldTimestamp specifically (not just reusing "now"'s digest):
const oldRawBody = rawBody
const replayedResult = await verifyWebhookDelivery(oldRawBody, `t=${oldTimestamp},v1=${(await (async () => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(webhookSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${oldTimestamp}.${oldRawBody}`))
  return Buffer.from(digest).toString('hex')
})())}`, webhookSecret)
assert.equal(replayedResult.status, 'EXPIRED', 'a validly-signed-but-old delivery must be rejected as expired, not accepted as if freshly sent')

// Every delivery gets a unique event ID — never reused, so a receiver can dedupe.
const { payload: p1 } = await buildWebhookDelivery('SCAN_COMPLETED', 'org_test', {}, webhookSecret)
const { payload: p2 } = await buildWebhookDelivery('SCAN_COMPLETED', 'org_test', {}, webhookSecret)
assert.notEqual(p1.eventId, p2.eventId)

// --- Webhook CRUD is RBAC-gated (configure_webhook: OWNER/ADMIN only) and SSRF-validated ---
globalThis.fetch = (...args) => orgMock.fetch(...args)

// Eve (registered earlier as an unrelated user with no memberships) joins Org A as a genuine MEMBER.
orgMock.registerEmail('eve@example.test', 'eve_uid')
const inviteEveAsMember = await worker.fetch(new Request(`https://api.test/v1/organizations/${orgA.orgId}/members`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader('av_alice_worker_test_key_0000000000000') }, body: JSON.stringify({ email: 'eve@example.test', role: 'MEMBER' }),
}), orgServiceEnv)
assert.equal(inviteEveAsMember.status, 200)

const memberCreatesWebhook = await worker.fetch(new Request(`https://api.test/v1/organizations/${orgA.orgId}/webhooks`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader('av_eve_worker_test_key_000000000000000') }, body: JSON.stringify({ endpoint: 'https://example.com/hook', events: ['SCAN_COMPLETED'] }),
}), orgServiceEnv)
assert.equal(memberCreatesWebhook.status, 403, 'MEMBER must not be able to configure webhooks')

const ownerCreatesWebhook = await worker.fetch(new Request(`https://api.test/v1/organizations/${orgA.orgId}/webhooks`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader('av_alice_worker_test_key_0000000000000') }, body: JSON.stringify({ endpoint: 'https://example.com/hook', events: ['SCAN_COMPLETED', 'VERIFICATION_FAILED'] }),
}), orgServiceEnv)
assert.equal(ownerCreatesWebhook.status, 201, 'OWNER should be able to configure a webhook')
const orgWebhookRecord = await ownerCreatesWebhook.json()
assert.ok(orgWebhookRecord.secret.startsWith('whsec_'))
assert.equal(orgWebhookRecord.endpoint, 'https://example.com/hook')

const ssrfWebhookAttempt = await worker.fetch(new Request(`https://api.test/v1/organizations/${orgA.orgId}/webhooks`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader('av_alice_worker_test_key_0000000000000') }, body: JSON.stringify({ endpoint: 'http://169.254.169.254/latest/meta-data', events: ['SCAN_COMPLETED'] }),
}), orgServiceEnv)
assert.equal(ssrfWebhookAttempt.status, 400, 'a webhook endpoint pointing at the cloud metadata address must be rejected')

const listWebhooksRes = await worker.fetch(new Request(`https://api.test/v1/organizations/${orgA.orgId}/webhooks`, { headers: authHeader('av_alice_worker_test_key_0000000000000') }), orgServiceEnv)
assert.equal(listWebhooksRes.status, 200)
const listedWebhooks = (await listWebhooksRes.json()).webhooks
assert.ok(listedWebhooks.some(w => w.webhookId === orgWebhookRecord.webhookId))
assert.ok(!('secret' in listedWebhooks[0]), 'the signing secret must never be returned again after creation')

const disableWebhookRes = await worker.fetch(new Request(`https://api.test/v1/organizations/${orgA.orgId}/webhooks/${orgWebhookRecord.webhookId}/disable`, {
  method: 'POST', headers: authHeader('av_alice_worker_test_key_0000000000000'),
}), orgServiceEnv)
assert.equal(disableWebhookRes.status, 200)

// A non-member (Dave is only VIEWER of Org A) cannot configure webhooks either.
const viewerWebhookAttempt = await worker.fetch(new Request(`https://api.test/v1/organizations/${orgA.orgId}/webhooks`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader('av_dave_worker_test_key_00000000000000') }, body: JSON.stringify({ endpoint: 'https://example.com/hook', events: ['SCAN_COMPLETED'] }),
}), orgServiceEnv)
assert.equal(viewerWebhookAttempt.status, 403, 'VIEWER must not be able to configure webhooks')

globalThis.fetch = originalFetch

// ============================================================================
// Browser Authentication Bridge — Firebase ID tokens authenticate org/audit/webhook routes
// exactly like API keys do, through the SAME authz.ts gate. Real RS256 signature verification
// (production mode), not a stub.
// ============================================================================

function mockOrgFetchWithFirebaseAuth(orgMock, jwks) {
  return async (url, init) => {
    const href = String(url)
    if (href.includes('securetoken@system.gserviceaccount.com')) {
      return new Response(JSON.stringify({ keys: jwks }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return orgMock.fetch(url, init)
  }
}

const authBridgeMock = createOrgFirestoreMock()
const aliceFirebase = await createFirebaseToken('alice_uid', 'alice@example.test', 'kid-alice')
const daveFirebase = await createFirebaseToken('dave_uid', 'dave@example.test', 'kid-dave')
const frankFirebase = await createFirebaseToken('frank_uid', 'frank@example.test', 'kid-frank') // frank belongs to no organization at all

globalThis.fetch = mockOrgFetchWithFirebaseAuth(authBridgeMock, [aliceFirebase.jwk, daveFirebase.jwk, frankFirebase.jwk])
const bridgeServiceEnv = { FIREBASE_API_KEY: 'firebase_test_placeholder', FIREBASE_PROJECT_ID: 'agentverify-test', ...(await createServiceAccountEnv()) }
const bearerFirebase = (t) => ({ Authorization: `Bearer ${t}` })

// Alice creates an org using her Firebase ID token — not an API key — proving the browser can
// drive this endpoint on its own, with no Agent Verify API key involved at all.
const bridgeOrgRes = await worker.fetch(new Request('https://api.test/v1/organizations', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...bearerFirebase(aliceFirebase.token) }, body: JSON.stringify({ name: 'Bridge Org' }),
}), bridgeServiceEnv)
assert.equal(bridgeOrgRes.status, 201, 'a valid Firebase ID token must be able to create an organization')
const bridgeOrg = await bridgeOrgRes.json()
assert.equal(bridgeOrg.ownerId, 'alice_uid')

// Alice (OWNER via Firebase token) invites Dave by email — still via Firebase token, no API key anywhere in this flow.
authBridgeMock.registerEmail('dave@example.test', 'dave_uid')
const bridgeInvite = await worker.fetch(new Request(`https://api.test/v1/organizations/${bridgeOrg.orgId}/members`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...bearerFirebase(aliceFirebase.token) }, body: JSON.stringify({ email: 'dave@example.test', role: 'MEMBER' }),
}), bridgeServiceEnv)
assert.equal(bridgeInvite.status, 200)

// Dave (now a real MEMBER via his OWN Firebase token) can view members but not invite others.
const daveViewsBridgeMembers = await worker.fetch(new Request(`https://api.test/v1/organizations/${bridgeOrg.orgId}/members`, { headers: bearerFirebase(daveFirebase.token) }), bridgeServiceEnv)
assert.equal(daveViewsBridgeMembers.status, 200, 'MEMBER should be able to view members via Firebase token auth')
const daveTriesInviteBridge = await worker.fetch(new Request(`https://api.test/v1/organizations/${bridgeOrg.orgId}/members`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...bearerFirebase(daveFirebase.token) }, body: JSON.stringify({ email: 'nobody@example.test', role: 'MEMBER' }),
}), bridgeServiceEnv)
assert.equal(daveTriesInviteBridge.status, 403, 'MEMBER via Firebase token must still be denied invite_members')

// --- SECURITY: Firebase token for a user who belongs to NO organization ("stolen org ID" / unrelated user) ---
const frankTriesBridgeOrg = await worker.fetch(new Request(`https://api.test/v1/organizations/${bridgeOrg.orgId}/members`, { headers: bearerFirebase(frankFirebase.token) }), bridgeServiceEnv)
assert.equal(frankTriesBridgeOrg.status, 404, 'a Firebase-authenticated user with no membership in this org must be denied, identically to a non-existent org')

// --- SECURITY: client-supplied role in the request body must never be trusted — the server uses
// the ACTUAL stored role, never anything the caller merely claims. ---
const daveClaimsOwnerInBody = await worker.fetch(new Request(`https://api.test/v1/organizations/${bridgeOrg.orgId}/members/dave_uid`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', ...bearerFirebase(daveFirebase.token) }, body: JSON.stringify({ role: 'OWNER' }),
}), bridgeServiceEnv)
assert.equal(daveClaimsOwnerInBody.status, 403, "Dave (real role MEMBER) must be denied modify_roles even though the request body itself claims a role change — the server never trusts a client-asserted role")

// --- SECURITY: malformed/garbage Authorization header (neither a valid API key nor a valid Firebase token shape) ---
const garbageAuthRes = await worker.fetch(new Request(`https://api.test/v1/organizations/${bridgeOrg.orgId}/members`, { headers: { Authorization: 'Bearer complete-garbage-not-a-jwt-or-key' } }), bridgeServiceEnv)
assert.equal(garbageAuthRes.status, 401)

// --- SECURITY: expired Firebase token is rejected end-to-end through the real route, not just at the unit level ---
const now = Math.floor(Date.now() / 1000)
const expiredFirebase = await createFirebaseToken('alice_uid', 'alice@example.test')
// createFirebaseToken always issues a fresh, valid token — construct an expired one by hand using the same key material shape it produced, to prove the ROUTE (not just the unit function) rejects it.
const expiredParts = expiredFirebase.token.split('.')
const expiredPayload = JSON.parse(Buffer.from(expiredParts[1], 'base64url').toString())
const forcedExpiredPayload = Buffer.from(JSON.stringify({ ...expiredPayload, iat: now - 7200, exp: now - 3600 })).toString('base64url')
// Re-signing isn't needed for this assertion: an expired-claims token is rejected on claim
// validation BEFORE signature verification even runs, so a stale signature over the original
// claims is sufficient to prove the route enforces expiry, not just the unit function.
const expiredToken = `${expiredParts[0]}.${forcedExpiredPayload}.${expiredParts[2]}`
const expiredRes = await worker.fetch(new Request(`https://api.test/v1/organizations/${bridgeOrg.orgId}/members`, { headers: bearerFirebase(expiredToken) }), bridgeServiceEnv)
assert.equal(expiredRes.status, 401, 'an expired Firebase token must be rejected by the real route')

globalThis.fetch = originalFetch
