// Real, end-to-end integration test for webhook delivery — the piece webhooks.ts's own comment
// (as of 2026-09-02) said explicitly did not exist: an actual outbound HTTP POST to a real
// endpoint. This test starts a REAL local HTTP server (node:http) and makes the delivery pipeline
// send REAL signed requests to it over a REAL socket — never a mocked fetch() standing in for the
// network call itself. Only Firestore (webhook config storage) and D1 (delivery state) are mocked,
// exactly like every other test in this suite already mocks Firestore/D1 — the actual delivery
// network hop is real.
import assert from 'node:assert/strict'
import http from 'node:http'
import { enqueueWebhookDeliveries, runDueDeliveries, attemptDelivery, listDeliveries, retryDelivery } from '../dist/webhookDelivery.mjs'
import { verifyWebhookDelivery } from '../dist/webhooks.mjs'
import { validateWebhookUrl } from '../dist/webhookSecurity.mjs'

const originalFetch = globalThis.fetch

// The real validateWebhookUrl correctly rejects 127.0.0.1 as loopback — exactly right for
// production, but this test's own receiver has to run somewhere reachable, which on this machine
// can only be loopback. This test-only validator delegates to the REAL one for everything except
// permitting 127.0.0.1, so every OTHER SSRF rule (the metadata address, RFC1918, etc. — see test 3
// below, which uses the real, unmodified validateWebhookUrl directly) stays genuinely enforced.
function testUrlValidator(rawUrl) {
  const real = validateWebhookUrl(rawUrl)
  if (real.ok) return real
  const isOnlyLoopback = new URL(rawUrl).hostname === '127.0.0.1'
  return isOnlyLoopback ? { ok: true } : real
}

// --- A real local HTTP server standing in for a customer's webhook receiver ---
function startReceiver() {
  const requests = []
  let behavior = () => ({ status: 200, body: 'ok' })
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      const record = { method: req.method, headers: req.headers, body }
      requests.push(record)
      const outcome = behavior(record)
      if (outcome === 'hang') return // never respond — exercises the real client-side timeout
      res.writeHead(outcome.status, { 'content-type': 'text/plain' })
      res.end(outcome.body)
    })
  })
  return new Promise(resolveServer => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolveServer({
        url: `http://127.0.0.1:${port}/hook`,
        requests,
        setBehavior(fn) { behavior = fn },
        close: () => new Promise(r => server.close(r)),
      })
    })
  })
}

// --- Firestore mock: just enough to back getWebhookForDelivery / listActiveWebhooksForEvent ---
function firestoreDoc(fields) {
  const out = {}
  for (const [k, v] of Object.entries(fields)) {
    if (v === null) out[k] = { nullValue: null }
    else if (typeof v === 'boolean') out[k] = { booleanValue: v }
    else if (Array.isArray(v)) out[k] = { arrayValue: { values: v.map(x => ({ stringValue: x })) } }
    else out[k] = { stringValue: String(v) }
  }
  return out
}

function createWebhookFirestoreMock() {
  const webhooks = new Map() // webhookId -> fields
  return {
    webhooks,
    setWebhook(webhookId, fields) { webhooks.set(webhookId, firestoreDoc(fields)) },
    disable(webhookId) { webhooks.get(webhookId).status = { stringValue: 'disabled' } },
    async fetch(url) {
      const href = String(url)
      if (href.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      const singleMatch = href.match(/\/documents\/organizations\/[^/]+\/webhooks\/([^/?]+)/)
      if (singleMatch) {
        const fields = webhooks.get(decodeURIComponent(singleMatch[1]))
        if (!fields) return new Response('{}', { status: 404 })
        return new Response(JSON.stringify({ fields }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (/\/documents\/organizations\/[^/]+\/webhooks(?:\?.*)?$/.test(href)) {
        const documents = [...webhooks.entries()].map(([id, fields]) => ({ name: `projects/x/databases/(default)/documents/organizations/org1/webhooks/${id}`, fields }))
        return new Response(JSON.stringify({ documents }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 404 })
    },
  }
}

// --- D1 mock for webhook_deliveries — same hand-rolled-per-query-shape convention as billing's
// createD1Mock() in source.test.mjs, just for the webhook_deliveries table instead. ---
function createDeliveriesD1Mock() {
  const rows = new Map() // delivery_id -> row
  return {
    rows,
    prepare(sql) {
      let params = []
      return {
        bind(...values) { params = values; return this },
        async run() {
          if (/^\s*INSERT INTO webhook_deliveries/i.test(sql)) {
            const [delivery_id, webhook_id, organization_id, event_id, event_type, endpoint, payload_json, signature_header, max_attempts, next_attempt_at, created_at] = params
            rows.set(delivery_id, {
              delivery_id, webhook_id, organization_id, event_id, event_type, endpoint, payload_json, signature_header,
              status: 'pending', attempt_count: 0, max_attempts, next_attempt_at, created_at,
              last_http_status: null, last_response_snippet: null, last_error: null, last_attempted_at: null, delivered_at: null,
            })
            return { success: true }
          }
          if (/^\s*UPDATE webhook_deliveries SET status = 'delivered'/i.test(sql)) {
            const [last_http_status, last_response_snippet, last_attempted_at, delivered_at, delivery_id] = params
            Object.assign(rows.get(delivery_id), { status: 'delivered', attempt_count: rows.get(delivery_id).attempt_count + 1, last_http_status, last_response_snippet, last_error: null, last_attempted_at, delivered_at })
            return { success: true }
          }
          if (/^\s*UPDATE webhook_deliveries SET status = 'dead_letter', attempt_count = \?/i.test(sql)) {
            const [attempt_count, last_http_status, last_response_snippet, last_error, last_attempted_at, delivery_id] = params
            Object.assign(rows.get(delivery_id), { status: 'dead_letter', attempt_count, last_http_status, last_response_snippet, last_error, last_attempted_at })
            return { success: true }
          }
          if (/^\s*UPDATE webhook_deliveries SET status = 'pending', attempt_count = \?, next_attempt_at = \?,/i.test(sql)) {
            const [attempt_count, next_attempt_at, last_http_status, last_response_snippet, last_error, last_attempted_at, delivery_id] = params
            Object.assign(rows.get(delivery_id), { status: 'pending', attempt_count, next_attempt_at, last_http_status, last_response_snippet, last_error, last_attempted_at })
            return { success: true }
          }
          if (/^\s*UPDATE webhook_deliveries SET status = 'dead_letter', last_error = 'Webhook disabled/i.test(sql)) {
            const [last_attempted_at, delivery_id] = params
            Object.assign(rows.get(delivery_id), { status: 'dead_letter', last_error: 'Webhook disabled or removed before delivery', last_attempted_at })
            return { success: true }
          }
          if (/^\s*UPDATE webhook_deliveries SET status = 'pending', attempt_count = 0/i.test(sql)) {
            const [next_attempt_at, delivery_id] = params
            Object.assign(rows.get(delivery_id), { status: 'pending', attempt_count: 0, next_attempt_at, last_error: null })
            return { success: true }
          }
          throw new Error('Unhandled D1 run(): ' + sql)
        },
        async first() {
          if (/^\s*SELECT \* FROM webhook_deliveries WHERE delivery_id = \? AND webhook_id = \?/i.test(sql)) {
            const row = rows.get(params[0])
            return row && row.webhook_id === params[1] ? row : null
          }
          throw new Error('Unhandled D1 first(): ' + sql)
        },
        async all() {
          if (/^\s*SELECT \* FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= \?/i.test(sql)) {
            const [now] = params
            const due = [...rows.values()].filter(r => r.status === 'pending' && r.next_attempt_at <= now).sort((a, b) => a.next_attempt_at - b.next_attempt_at)
            return { results: due }
          }
          if (/^\s*SELECT \* FROM webhook_deliveries WHERE webhook_id = \? ORDER BY created_at DESC/i.test(sql)) {
            const list = [...rows.values()].filter(r => r.webhook_id === params[0]).sort((a, b) => b.created_at - a.created_at)
            return { results: list }
          }
          throw new Error('Unhandled D1 all(): ' + sql)
        },
      }
    },
  }
}

// A real (test-only) service-account key — getFirebaseAccessToken signs a real JWT assertion with
// it before the (mocked) oauth2.googleapis.com/token exchange, so this must be real PKCS8 key
// material, not a placeholder string, even though the token exchange itself is mocked below.
async function createServiceAccountEnv() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey)
  return {
    FIREBASE_CLIENT_EMAIL: 'worker-test@agentverify-webhook-test.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: Buffer.from(pkcs8).toString('base64'),
  }
}

async function makeEnv(firestoreMock, d1Mock) {
  return {
    ...(await createServiceAccountEnv()),
    FIREBASE_PROJECT_ID: 'agentverify-webhook-test',
    BILLING_DB: d1Mock,
  }
}

const ORG = 'org1'

// ============================================================================
// 1. Successful delivery — real HTTP POST to a real local server, signed correctly.
// ============================================================================
{
  const receiver = await startReceiver()
  const firestoreMock = createWebhookFirestoreMock()
  firestoreMock.setWebhook('wh1', { webhookId: 'wh1', endpoint: receiver.url, enabledEvents: ['SCAN_COMPLETED'], status: 'active', secret: 'whsec_test_secret_1', createdAt: '2026-01-01', createdBy: 'u1' })
  const d1 = createDeliveriesD1Mock()
  const env = await makeEnv(firestoreMock, d1)
  globalThis.fetch = (url, init) => (String(url).startsWith(receiver.url.split('/hook')[0]) ? originalFetch(url, init) : firestoreMock.fetch(url, init))

  await enqueueWebhookDeliveries(ORG, 'SCAN_COMPLETED', { reportId: 'REPORT-1', verdict: 'VERIFIED' }, env)
  assert.equal(d1.rows.size, 1, 'exactly one delivery was enqueued for the one subscribed webhook')

  const result = await runDueDeliveries(env, 25, 2000, testUrlValidator)
  assert.equal(result.attempted, 1)
  assert.equal(result.delivered, 1)
  assert.equal(receiver.requests.length, 1, 'the real local server actually received exactly one HTTP request')

  const row = [...d1.rows.values()][0]
  assert.equal(row.status, 'delivered')
  assert.equal(row.last_http_status, 200)

  // Signature correctness: the REAL signature header the server received verifies against the
  // REAL body the server received, using the shared verification reference implementation.
  const received = receiver.requests[0]
  assert.equal(received.method, 'POST')
  assert.ok(received.headers['agent-verify-signature'], 'the signature header was actually sent')
  const verification = await verifyWebhookDelivery(received.body, received.headers['agent-verify-signature'], 'whsec_test_secret_1')
  assert.equal(verification.status, 'VALID', 'the delivered payload verifies against its own signature and the real secret')

  // Wrong secret must fail — proves this isn't a rubber-stamp "always VALID" check.
  const wrongSecret = await verifyWebhookDelivery(received.body, received.headers['agent-verify-signature'], 'whsec_totally_wrong')
  assert.equal(wrongSecret.status, 'INVALID_SIGNATURE')

  await receiver.close()
  console.log('✓ successful delivery, real HTTP, signature verified')
}

// ============================================================================
// 2. Replay/freshness — an old (but validly-signed-at-the-time) delivery is rejected as expired.
// ============================================================================
{
  const receiver = await startReceiver()
  const firestoreMock = createWebhookFirestoreMock()
  firestoreMock.setWebhook('wh1', { webhookId: 'wh1', endpoint: receiver.url, enabledEvents: ['SCAN_COMPLETED'], status: 'active', secret: 'whsec_replay_secret', createdAt: '2026-01-01', createdBy: 'u1' })
  const d1 = createDeliveriesD1Mock()
  const env = await makeEnv(firestoreMock, d1)
  globalThis.fetch = (url, init) => (String(url).startsWith(receiver.url.split('/hook')[0]) ? originalFetch(url, init) : firestoreMock.fetch(url, init))

  await enqueueWebhookDeliveries(ORG, 'SCAN_COMPLETED', { reportId: 'REPORT-2' }, env)
  await runDueDeliveries(env, 25, 2000, testUrlValidator)
  const received = receiver.requests[0]

  const freshCheck = await verifyWebhookDelivery(received.body, received.headers['agent-verify-signature'], 'whsec_replay_secret')
  assert.equal(freshCheck.status, 'VALID', 'a fresh delivery is valid')

  // Re-sign the exact same body with a timestamp 10 minutes in the past — simulates a captured
  // delivery replayed later. Same secret, same body, only the timestamp (and therefore signature) differ.
  const oldTimestamp = Math.floor(Date.now() / 1000) - 600
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('whsec_replay_secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${oldTimestamp}.${received.body}`))
  const staleHeader = `t=${oldTimestamp},v1=${Buffer.from(digest).toString('hex')}`
  const replayCheck = await verifyWebhookDelivery(received.body, staleHeader, 'whsec_replay_secret')
  assert.equal(replayCheck.status, 'EXPIRED', 'a 10-minute-old signature is rejected as a possible replay (5-minute tolerance)')
  assert.ok(replayCheck.ageSeconds >= 600)

  await receiver.close()
  console.log('✓ replay/freshness protection rejects a stale signature')
}

// ============================================================================
// 3. Invalid endpoint (SSRF re-check at delivery time) — never makes a real network call at all.
// ============================================================================
{
  const firestoreMock = createWebhookFirestoreMock()
  const d1 = createDeliveriesD1Mock()
  const env = await makeEnv(firestoreMock, d1)
  let realFetchCalls = 0
  globalThis.fetch = (url, init) => {
    if (String(url).includes('127.0.0.1') || String(url).includes('localhost')) { realFetchCalls += 1 }
    return firestoreMock.fetch(url, init)
  }
  const now = Math.floor(Date.now() / 1000)
  d1.rows.set('whd_bad', {
    delivery_id: 'whd_bad', webhook_id: 'wh_bad', organization_id: ORG, event_id: 'e1', event_type: 'SCAN_COMPLETED',
    endpoint: 'http://169.254.169.254/latest/meta-data/', payload_json: '{}', signature_header: 't=1,v1=x',
    status: 'pending', attempt_count: 0, max_attempts: 6, next_attempt_at: now, created_at: now,
    last_http_status: null, last_response_snippet: null, last_error: null, last_attempted_at: null, delivered_at: null,
  })
  const outcome = await attemptDelivery(d1.rows.get('whd_bad'), env)
  assert.equal(outcome, 'pending', 'a rejected URL still gets a normal retry/backoff cycle, not an immediate silent drop')
  const row = d1.rows.get('whd_bad')
  assert.match(row.last_error, /rejected at delivery time/)
  assert.equal(realFetchCalls, 0, 'a cloud-metadata SSRF endpoint must never actually be requested, even once')
  console.log('✓ invalid/SSRF endpoint rejected before any network call')
}

// ============================================================================
// 4. Timeout — the receiver never responds; the client-side timeout fires for real.
// ============================================================================
{
  const receiver = await startReceiver()
  receiver.setBehavior(() => 'hang')
  const firestoreMock = createWebhookFirestoreMock()
  firestoreMock.setWebhook('wh1', { webhookId: 'wh1', endpoint: receiver.url, enabledEvents: ['SCAN_COMPLETED'], status: 'active', secret: 'whsec_timeout', createdAt: '2026-01-01', createdBy: 'u1' })
  const d1 = createDeliveriesD1Mock()
  const env = await makeEnv(firestoreMock, d1)
  globalThis.fetch = (url, init) => (String(url).startsWith(receiver.url.split('/hook')[0]) ? originalFetch(url, init) : firestoreMock.fetch(url, init))

  await enqueueWebhookDeliveries(ORG, 'SCAN_COMPLETED', { reportId: 'REPORT-3' }, env)
  const result = await runDueDeliveries(env, 25, 300, testUrlValidator) // real 300ms timeout — fast test, real AbortSignal
  assert.equal(result.attempted, 1)
  assert.equal(result.delivered, 0)
  const row = [...d1.rows.values()][0]
  assert.equal(row.status, 'pending', 'a timeout schedules a retry, it does not immediately dead-letter')
  assert.match(row.last_error, /timed out/i)
  assert.ok(row.next_attempt_at > Math.floor(Date.now() / 1000), 'backoff was actually scheduled into the future')

  await receiver.close()
  console.log('✓ real timeout observed and recorded, retry scheduled')
}

// ============================================================================
// 5. 500 response, then retries, then eventual success.
// ============================================================================
{
  const receiver = await startReceiver()
  let call = 0
  receiver.setBehavior(() => { call += 1; return call < 3 ? { status: 500, body: 'server error' } : { status: 200, body: 'ok' } })
  const firestoreMock = createWebhookFirestoreMock()
  firestoreMock.setWebhook('wh1', { webhookId: 'wh1', endpoint: receiver.url, enabledEvents: ['SCAN_COMPLETED'], status: 'active', secret: 'whsec_retry', createdAt: '2026-01-01', createdBy: 'u1' })
  const d1 = createDeliveriesD1Mock()
  const env = await makeEnv(firestoreMock, d1)
  globalThis.fetch = (url, init) => (String(url).startsWith(receiver.url.split('/hook')[0]) ? originalFetch(url, init) : firestoreMock.fetch(url, init))

  await enqueueWebhookDeliveries(ORG, 'SCAN_COMPLETED', { reportId: 'REPORT-4' }, env)
  let r1 = await runDueDeliveries(env, 25, 2000, testUrlValidator)
  assert.equal(r1.attempted, 1)
  assert.equal(r1.delivered, 0)
  let row = [...d1.rows.values()][0]
  assert.equal(row.status, 'pending')
  assert.equal(row.attempt_count, 1)
  assert.equal(row.last_http_status, 500)

  // Force the scheduled retry to be "due now" instead of waiting out the real backoff window.
  row.next_attempt_at = Math.floor(Date.now() / 1000)
  const r2 = await runDueDeliveries(env, 25, 2000, testUrlValidator)
  assert.equal(r2.delivered, 0)
  row = [...d1.rows.values()][0]
  assert.equal(row.attempt_count, 2)

  row.next_attempt_at = Math.floor(Date.now() / 1000)
  const r3 = await runDueDeliveries(env, 25, 2000, testUrlValidator)
  assert.equal(r3.delivered, 1, 'the third real attempt succeeds once the receiver starts returning 200')
  row = [...d1.rows.values()][0]
  assert.equal(row.status, 'delivered')
  assert.equal(receiver.requests.length, 3, 'three real, distinct HTTP requests were made — not simulated')

  await receiver.close()
  console.log('✓ 500 response retried with backoff, eventually delivered')
}

// ============================================================================
// 6. Final failure — always fails, exhausts max_attempts, becomes dead_letter (no further retry scheduled).
// ============================================================================
{
  const receiver = await startReceiver()
  receiver.setBehavior(() => ({ status: 503, body: 'down' }))
  const firestoreMock = createWebhookFirestoreMock()
  firestoreMock.setWebhook('wh1', { webhookId: 'wh1', endpoint: receiver.url, enabledEvents: ['SCAN_COMPLETED'], status: 'active', secret: 'whsec_dead', createdAt: '2026-01-01', createdBy: 'u1' })
  const d1 = createDeliveriesD1Mock()
  const env = await makeEnv(firestoreMock, d1)
  globalThis.fetch = (url, init) => (String(url).startsWith(receiver.url.split('/hook')[0]) ? originalFetch(url, init) : firestoreMock.fetch(url, init))

  await enqueueWebhookDeliveries(ORG, 'SCAN_COMPLETED', { reportId: 'REPORT-5' }, env)
  const deliveryId = [...d1.rows.keys()][0]
  for (let i = 0; i < 6; i += 1) {
    d1.rows.get(deliveryId).next_attempt_at = Math.floor(Date.now() / 1000)
    await runDueDeliveries(env, 25, 2000, testUrlValidator)
  }
  const row = d1.rows.get(deliveryId)
  assert.equal(row.status, 'dead_letter', 'after 6 real failed attempts the delivery becomes a dead letter')
  assert.equal(row.attempt_count, 6)
  assert.equal(receiver.requests.length, 6, 'exactly 6 real requests were made — the cap is enforced, not exceeded')

  // A 7th sweep must not attempt it again — it's no longer 'pending'.
  const before = receiver.requests.length
  await runDueDeliveries(env, 25, 2000, testUrlValidator)
  assert.equal(receiver.requests.length, before, 'a dead-lettered delivery is never automatically retried again')

  // Manual retry: an operator's explicit action brings it back for a fresh attempt cycle.
  const retryResult = await retryDelivery('wh1', deliveryId, env)
  assert.equal(retryResult.ok, true)
  assert.equal(d1.rows.get(deliveryId).status, 'pending')
  assert.equal(d1.rows.get(deliveryId).attempt_count, 0, 'manual retry gives a full fresh attempt budget')
  receiver.setBehavior(() => ({ status: 200, body: 'ok' }))
  const afterManualRetry = await runDueDeliveries(env, 25, 2000, testUrlValidator)
  assert.equal(afterManualRetry.delivered, 1, 'the manually-retried delivery succeeds once the endpoint recovers')

  // Retrying something that is NOT dead_letter must be rejected.
  const rejectedRetry = await retryDelivery('wh1', deliveryId, env)
  assert.equal(rejectedRetry.ok, false)

  await receiver.close()
  console.log('✓ final failure reaches dead_letter, stops retrying, manual retry works')
}

// ============================================================================
// 7. Disabled webhook — its due delivery must be dead-lettered WITHOUT ever calling the endpoint.
// ============================================================================
{
  const receiver = await startReceiver()
  const firestoreMock = createWebhookFirestoreMock()
  firestoreMock.setWebhook('wh1', { webhookId: 'wh1', endpoint: receiver.url, enabledEvents: ['SCAN_COMPLETED'], status: 'active', secret: 'whsec_disabled', createdAt: '2026-01-01', createdBy: 'u1' })
  const d1 = createDeliveriesD1Mock()
  const env = await makeEnv(firestoreMock, d1)
  globalThis.fetch = (url, init) => (String(url).startsWith(receiver.url.split('/hook')[0]) ? originalFetch(url, init) : firestoreMock.fetch(url, init))

  await enqueueWebhookDeliveries(ORG, 'SCAN_COMPLETED', { reportId: 'REPORT-6' }, env)
  // Disabled AFTER enqueueing but BEFORE the sweep runs — proves disable is respected at delivery
  // time, not just at enqueue time.
  firestoreMock.disable('wh1')

  const result = await runDueDeliveries(env, 25, 2000, testUrlValidator)
  assert.equal(result.attempted, 0)
  assert.equal(result.skippedDisabled, 1)
  assert.equal(receiver.requests.length, 0, 'a disabled webhook must never receive a real request, even one already queued')
  const row = [...d1.rows.values()][0]
  assert.equal(row.status, 'dead_letter')
  assert.match(row.last_error, /disabled/i)

  await receiver.close()
  console.log('✓ disabling a webhook is respected immediately, before any queued delivery fires')
}

// ============================================================================
// 8. No webhook subscribed to an event → nothing is enqueued at all (no wasted rows, no noise).
// ============================================================================
{
  const firestoreMock = createWebhookFirestoreMock()
  firestoreMock.setWebhook('wh1', { webhookId: 'wh1', endpoint: 'http://127.0.0.1:1/unused', enabledEvents: ['ROLE_CHANGED'], status: 'active', secret: 'whsec_unused', createdAt: '2026-01-01', createdBy: 'u1' })
  const d1 = createDeliveriesD1Mock()
  const env = await makeEnv(firestoreMock, d1)
  globalThis.fetch = (url, init) => firestoreMock.fetch(url, init)
  await enqueueWebhookDeliveries(ORG, 'SCAN_COMPLETED', { reportId: 'REPORT-7' }, env)
  assert.equal(d1.rows.size, 0, 'an event with no subscribed webhook enqueues nothing')
  console.log('✓ non-subscribed event enqueues no delivery')
}

// ============================================================================
// 9. listDeliveries — the history the Workspace UI renders, never includes the secret or payload.
// ============================================================================
{
  const receiver = await startReceiver()
  const firestoreMock = createWebhookFirestoreMock()
  firestoreMock.setWebhook('wh1', { webhookId: 'wh1', endpoint: receiver.url, enabledEvents: ['SCAN_COMPLETED'], status: 'active', secret: 'whsec_history', createdAt: '2026-01-01', createdBy: 'u1' })
  const d1 = createDeliveriesD1Mock()
  const env = await makeEnv(firestoreMock, d1)
  globalThis.fetch = (url, init) => (String(url).startsWith(receiver.url.split('/hook')[0]) ? originalFetch(url, init) : firestoreMock.fetch(url, init))

  await enqueueWebhookDeliveries(ORG, 'SCAN_COMPLETED', { reportId: 'REPORT-8' }, env)
  await runDueDeliveries(env, 25, 2000, testUrlValidator)
  const history = await listDeliveries('wh1', env)
  assert.equal(history.length, 1)
  assert.equal(history[0].status, 'delivered')
  assert.equal(history[0].eventType, 'SCAN_COMPLETED')
  const serialized = JSON.stringify(history)
  assert.ok(!serialized.includes('whsec_history'), 'delivery history must never expose the webhook signing secret')
  assert.ok(!serialized.includes('REPORT-8'), 'delivery history is attempt/outcome metadata, not the event payload itself')

  await receiver.close()
  console.log('✓ delivery history exposes outcomes only, never the secret or payload')
}

globalThis.fetch = originalFetch
console.log('\nwebhookDelivery.test.mjs: all assertions passed')
