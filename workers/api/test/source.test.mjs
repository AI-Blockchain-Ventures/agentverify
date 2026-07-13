import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { scan } from '@agentverify/scanner'
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

async function createFirebaseToken(uid = 'user_test', email = 'user@example.test') {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  publicJwk.kid = 'test-kid'
  publicJwk.alg = 'RS256'
  publicJwk.use = 'sig'
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-kid' }))
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
  if (href.includes('/documents/apiKeyIndex/')) {
    return new Response(JSON.stringify({ fields: { uid: { stringValue: 'user_test' }, status: { stringValue: 'active' } } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (href.includes('/documents/cliReports/')) {
    savedReport = init?.method === 'PATCH'
    return new Response(JSON.stringify({ name: 'saved' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Response('{}', { status: 404 })
}
const validKeyScan = await worker.fetch(scanRequest({ Authorization: 'Bearer av_valid_worker_test_key_000000000000' }), { FIREBASE_API_KEY: 'firebase_test_placeholder' })
assert.equal(validKeyScan.status, 200)
const validBody = await validKeyScan.json()
assert.equal(validBody.saved, true)
assert.match(validBody.reportUrl, /^https:\/\/aimodularity\.com\/agentverify\/report\/\?id=REPORT-/)
assert.ok(Array.isArray(validBody.findings))
assert.equal(savedReport, true)
globalThis.fetch = originalFetch

const webBillingSource = readFileSync(resolve(__dirname, '../../../apps/web/src/lib/billing.test-data.ts'), 'utf8')
assert.match(webBillingSource, /freePdf: canUseProFeature\(freeBillingStatus, 'pdfExport'\)/)
assert.match(webBillingSource, /proPdf: canUseProFeature\(proBillingStatus, 'pdfExport'\)/)
assert.match(webBillingSource, /teamDisabled: getPlanAction\('team'\)\.disabled === true/)
assert.match(webBillingSource, /enterpriseContactOnly: getPlanAction\('enterprise'\)\.href\.startsWith\('mailto:'\)/)
