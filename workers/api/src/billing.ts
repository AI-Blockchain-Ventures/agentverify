export type Plan = 'free' | 'pro'

interface D1Result<T = unknown> {
  results?: T[]
  success?: boolean
  meta?: { changes?: number }
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = unknown>(): Promise<T | null>
  run<T = unknown>(): Promise<D1Result<T>>
}

interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch?<T = unknown>(statements: D1PreparedStatement[]): Promise<Array<D1Result<T>>>
}

export interface BillingEnv {
  BILLING_ENABLED?: string
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  STRIPE_PRO_PRICE_ID?: string
  STRIPE_PORTAL_CONFIGURATION_ID?: string
  BILLING_SUCCESS_URL?: string
  BILLING_CANCEL_URL?: string
  FIREBASE_PROJECT_ID?: string
  BILLING_DB?: D1Database
}

interface FirebaseUser {
  uid: string
  email?: string
}

interface SubscriptionState {
  plan: Plan
  status: string
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  currentPeriodEnd: number | null
  cancelAtPeriodEnd: boolean
  lastStripeEventId: string | null
  lastStripeEventCreated: number
  updatedAt: number
  schemaVersion: 1
}

interface SubscriptionRow {
  uid: string
  plan: string
  status: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  current_period_end: number | null
  cancel_at_period_end: number
  last_stripe_event_id: string | null
  last_stripe_event_created: number
  updated_at: number
  schema_version: number
}

const corsHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Stripe-Signature, User-Agent',
}

export const billingJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders })

const textEncoder = new TextEncoder()
type FirebaseJwk = JsonWebKey & { kid?: string }

const isEnabled = (env: BillingEnv): boolean => env.BILLING_ENABLED === 'true'

const hasD1 = (env: BillingEnv): boolean => !!env.BILLING_DB

const hasCheckoutConfig = (env: BillingEnv): boolean =>
  isEnabled(env) && !!env.STRIPE_SECRET_KEY && !!env.STRIPE_PRO_PRICE_ID && !!env.BILLING_SUCCESS_URL && !!env.BILLING_CANCEL_URL && !!env.FIREBASE_PROJECT_ID && hasD1(env)

const hasWebhookConfig = (env: BillingEnv): boolean =>
  isEnabled(env) && !!env.STRIPE_WEBHOOK_SECRET

export const isPlanCheckoutAvailable = (plan: string): boolean => plan === 'pro'

const unixToIso = (value: number | null | undefined): string | null => typeof value === 'number' && value > 0 ? new Date(value * 1000).toISOString() : null

const safeStatus = (state?: Partial<SubscriptionState> | null) => {
  const active = state?.plan === 'pro' && (state.status === 'active' || state.status === 'trialing')
  const plan: Plan = active ? 'pro' : 'free'
  return {
    plan,
    status: state?.status ?? 'free',
    scanQuota: plan === 'pro' ? 100 : 10,
    features: {
      fullRemediation: plan === 'pro',
      correctedSnippets: plan === 'pro',
      a2spaGuidance: plan === 'pro',
      pdfExport: plan === 'pro',
      reportSharing: plan === 'pro',
    },
    currentPeriodEnd: unixToIso(state?.currentPeriodEnd ?? null),
    cancelAtPeriodEnd: state?.cancelAtPeriodEnd === true,
  }
}

const base64UrlToBytes = (value: string): Uint8Array => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

const parseJwt = (token: string): { header: Record<string, unknown>; payload: Record<string, unknown>; signed: string; signature: Uint8Array } | null => {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    return {
      header: JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0]))) as Record<string, unknown>,
      payload: JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1]))) as Record<string, unknown>,
      signed: `${parts[0]}.${parts[1]}`,
      signature: base64UrlToBytes(parts[2]),
    }
  } catch {
    return null
  }
}

async function verifyFirebaseUser(request: Request, env: BillingEnv): Promise<FirebaseUser | null> {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!token || !env.FIREBASE_PROJECT_ID) return null

  const parsed = parseJwt(token)
  if (!parsed) return null

  const kid = typeof parsed.header.kid === 'string' ? parsed.header.kid : ''
  const issuer = `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`
  const now = Math.floor(Date.now() / 1000)
  if (parsed.payload.aud !== env.FIREBASE_PROJECT_ID || parsed.payload.iss !== issuer || typeof parsed.payload.sub !== 'string' || typeof parsed.payload.exp !== 'number' || parsed.payload.exp <= now) {
    return null
  }

  const certs = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
  if (!certs.ok) return null
  const jwks = await certs.json() as { keys?: FirebaseJwk[] }
  const jwk = jwks.keys?.find(key => key.kid === kid)
  if (!jwk) return null

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, toArrayBuffer(parsed.signature), textEncoder.encode(parsed.signed))
  if (!valid) return null

  return { uid: parsed.payload.sub, email: typeof parsed.payload.email === 'string' ? parsed.payload.email : undefined }
}

const rowToState = (row: SubscriptionRow | null): SubscriptionState | null => row ? {
  plan: row.plan === 'pro' ? 'pro' : 'free',
  status: row.status ?? 'free',
  stripeCustomerId: row.stripe_customer_id ?? null,
  stripeSubscriptionId: row.stripe_subscription_id ?? null,
  currentPeriodEnd: typeof row.current_period_end === 'number' ? row.current_period_end : null,
  cancelAtPeriodEnd: row.cancel_at_period_end === 1,
  lastStripeEventId: row.last_stripe_event_id ?? null,
  lastStripeEventCreated: Number(row.last_stripe_event_created ?? 0) || 0,
  updatedAt: Number(row.updated_at ?? 0) || 0,
  schemaVersion: 1,
} : null

async function loadSubscription(env: BillingEnv, uid: string): Promise<SubscriptionState | null> {
  if (!env.BILLING_DB) return null
  const row = await env.BILLING_DB.prepare('SELECT * FROM subscriptions WHERE uid = ?').bind(uid).first<SubscriptionRow>()
  return rowToState(row)
}

async function saveSubscription(env: BillingEnv, uid: string, state: SubscriptionState): Promise<'saved' | 'stale' | 'failed'> {
  if (!env.BILLING_DB) return 'failed'
  const result = await env.BILLING_DB.prepare(`
    INSERT INTO subscriptions (
      uid, plan, status, stripe_customer_id, stripe_subscription_id, current_period_end,
      cancel_at_period_end, last_stripe_event_id, last_stripe_event_created, updated_at, schema_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(uid) DO UPDATE SET
      plan = excluded.plan,
      status = excluded.status,
      stripe_customer_id = excluded.stripe_customer_id,
      stripe_subscription_id = excluded.stripe_subscription_id,
      current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end,
      last_stripe_event_id = excluded.last_stripe_event_id,
      last_stripe_event_created = excluded.last_stripe_event_created,
      updated_at = excluded.updated_at,
      schema_version = excluded.schema_version
    WHERE subscriptions.last_stripe_event_created <= excluded.last_stripe_event_created
  `).bind(
    uid,
    state.plan,
    state.status,
    state.stripeCustomerId,
    state.stripeSubscriptionId,
    state.currentPeriodEnd,
    state.cancelAtPeriodEnd ? 1 : 0,
    state.lastStripeEventId,
    state.lastStripeEventCreated,
    state.updatedAt,
    state.schemaVersion
  ).run()
  if (result.success === false) return 'failed'
  return (result.meta?.changes ?? 1) > 0 ? 'saved' : 'stale'
}

async function reserveStripeEvent(env: BillingEnv, event: { id: string; type: string; created: number }): Promise<'reserved' | 'duplicate' | 'unavailable'> {
  if (!env.BILLING_DB) return 'unavailable'
  const result = await env.BILLING_DB.prepare(`
    INSERT OR IGNORE INTO stripe_events (event_id, event_type, event_created, processed_at)
    VALUES (?, ?, ?, ?)
  `).bind(event.id, event.type, event.created, Math.floor(Date.now() / 1000)).run()
  if (result.success === false) return 'unavailable'
  return (result.meta?.changes ?? 1) > 0 ? 'reserved' : 'duplicate'
}

async function deleteStripeEvent(env: BillingEnv, eventId: string): Promise<void> {
  if (!env.BILLING_DB) return
  await env.BILLING_DB.prepare('DELETE FROM stripe_events WHERE event_id = ?').bind(eventId).run()
}

export async function recordMonthlyUsage(env: BillingEnv, uid: string, month: string, planSnapshot: Plan): Promise<boolean> {
  if (!env.BILLING_DB) return false
  const result = await env.BILLING_DB.prepare(`
    INSERT INTO usage_monthly (uid, month, scan_count, plan_snapshot, updated_at)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(uid, month) DO UPDATE SET
      scan_count = scan_count + 1,
      plan_snapshot = excluded.plan_snapshot,
      updated_at = excluded.updated_at
  `).bind(uid, month, planSnapshot, Math.floor(Date.now() / 1000)).run()
  return result.success !== false
}

const stripeRequest = async (env: BillingEnv, path: string, body: URLSearchParams) =>
  fetch(`https://api.stripe.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

const stripeGet = async (env: BillingEnv, path: string) =>
  fetch(`https://api.stripe.com${path}`, {
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    },
  })

export async function handleCheckout(request: Request, env: BillingEnv): Promise<Response> {
  if (!hasCheckoutConfig(env)) return billingJson({ error: 'Billing is not configured' }, 503)
  const user = await verifyFirebaseUser(request, env)
  if (!user) return billingJson({ error: 'Authentication required' }, 401)

  let requestedPlan = 'pro'
  try {
    const body = await request.json() as { plan?: string }
    requestedPlan = body.plan ?? 'pro'
  } catch {
    requestedPlan = 'pro'
  }
  if (!isPlanCheckoutAvailable(requestedPlan)) return billingJson({ error: 'Checkout is unavailable for this plan' }, 400)

  const body = new URLSearchParams({
    mode: 'subscription',
    success_url: env.BILLING_SUCCESS_URL!,
    cancel_url: env.BILLING_CANCEL_URL!,
    'line_items[0][price]': env.STRIPE_PRO_PRICE_ID!,
    'line_items[0][quantity]': '1',
    client_reference_id: user.uid,
    'metadata[uid]': user.uid,
    'subscription_data[metadata][uid]': user.uid,
  })
  if (user.email) body.set('customer_email', user.email)

  const stripeRes = await stripeRequest(env, '/v1/checkout/sessions', body)
  const data = await stripeRes.json() as { url?: string }
  if (!stripeRes.ok || !data.url) return billingJson({ error: 'Unable to create checkout session' }, 502)
  return billingJson({ url: data.url })
}

export async function handlePortal(request: Request, env: BillingEnv): Promise<Response> {
  if (!isEnabled(env) || !env.STRIPE_SECRET_KEY || !env.STRIPE_PORTAL_CONFIGURATION_ID || !env.BILLING_CANCEL_URL || !env.FIREBASE_PROJECT_ID || !hasD1(env)) {
    return billingJson({ error: 'Billing portal is not configured' }, 503)
  }
  const user = await verifyFirebaseUser(request, env)
  if (!user) return billingJson({ error: 'Authentication required' }, 401)
  const state = await loadSubscription(env, user.uid)
  if (!state?.stripeCustomerId) return billingJson({ error: 'No Stripe customer found' }, 404)

  const body = new URLSearchParams({
    customer: state.stripeCustomerId,
    return_url: env.BILLING_CANCEL_URL,
    configuration: env.STRIPE_PORTAL_CONFIGURATION_ID,
  })
  const stripeRes = await stripeRequest(env, '/v1/billing_portal/sessions', body)
  const data = await stripeRes.json() as { url?: string }
  if (!stripeRes.ok || !data.url) return billingJson({ error: 'Unable to create billing portal session' }, 502)
  return billingJson({ url: data.url })
}

export async function handleStatus(request: Request, env: BillingEnv): Promise<Response> {
  const user = await verifyFirebaseUser(request, env)
  if (!user || !env.BILLING_DB) return billingJson(safeStatus(null))
  return billingJson(safeStatus(await loadSubscription(env, user.uid)))
}

const parseStripeSignature = (header: string): { timestamp: string; signatures: string[] } => {
  const parts = header.split(',').map(part => part.trim())
  return {
    timestamp: parts.find(part => part.startsWith('t='))?.slice(2) ?? '',
    signatures: parts.filter(part => part.startsWith('v1=')).map(part => part.slice(3)),
  }
}

const toHex = (buffer: ArrayBuffer): string => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('')

export async function verifyStripeSignature(rawBody: string, signatureHeader: string | null, secret?: string): Promise<boolean> {
  if (!signatureHeader || !secret) return false
  const { timestamp, signatures } = parseStripeSignature(signatureHeader)
  if (!timestamp || signatures.length === 0) return false
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = toHex(await crypto.subtle.sign('HMAC', key, textEncoder.encode(`${timestamp}.${rawBody}`)))
  return signatures.includes(digest)
}

async function saveCheckoutAssociation(env: BillingEnv, event: Record<string, any>): Promise<'saved' | 'stale' | 'failed' | 'ignored'> {
  if (!env.BILLING_DB) return 'failed'
  const object = event.data?.object ?? {}
  const uid = object.metadata?.uid || object.client_reference_id || object.subscription_details?.metadata?.uid
  if (typeof uid !== 'string' || !uid) return 'ignored'
  const customerId = typeof object.customer === 'string' ? object.customer : null
  const subscriptionId = typeof object.subscription === 'string' ? object.subscription : null
  const eventId = typeof event.id === 'string' ? event.id : null
  const eventCreated = typeof event.created === 'number' ? event.created : 0
  const now = Math.floor(Date.now() / 1000)
  const existing = await loadSubscription(env, uid)
  if (existing && existing.lastStripeEventCreated > eventCreated) return 'stale'

  if (!existing) {
    const result = await env.BILLING_DB.prepare(`
      INSERT INTO subscriptions (
        uid, plan, status, stripe_customer_id, stripe_subscription_id, current_period_end,
        cancel_at_period_end, last_stripe_event_id, last_stripe_event_created, updated_at, schema_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(uid, 'pro', 'pending', customerId, subscriptionId, null, 0, eventId, eventCreated, now, 1).run()
    return result.success === false ? 'failed' : 'saved'
  }

  const result = await env.BILLING_DB.prepare(`
    UPDATE subscriptions
    SET plan = 'pro',
      stripe_customer_id = COALESCE(?, stripe_customer_id),
      stripe_subscription_id = COALESCE(?, stripe_subscription_id),
      last_stripe_event_id = ?,
      last_stripe_event_created = ?,
      updated_at = ?
    WHERE uid = ? AND last_stripe_event_created <= ?
  `).bind(customerId, subscriptionId, eventId, eventCreated, now, uid, eventCreated).run()
  if (result.success === false) return 'failed'
  return (result.meta?.changes ?? 1) > 0 ? 'saved' : 'stale'
}

async function retrieveStripeSubscription(env: BillingEnv, subscriptionId: string): Promise<Record<string, any> | null> {
  if (!env.STRIPE_SECRET_KEY || !subscriptionId) return null
  const res = await stripeGet(env, `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`)
  if (!res.ok) return null
  const subscription = await res.json() as Record<string, any>
  return subscription.object === 'subscription' ? subscription : null
}

const positiveUnix = (value: unknown): number | null => typeof value === 'number' && value > 0 ? value : null

const firstPeriodEnd = (...values: unknown[]): number | null => {
  for (const value of values) {
    const periodEnd = positiveUnix(value)
    if (periodEnd) return periodEnd
  }
  return null
}

function extractSubscriptionPeriodEnd(subscription: Record<string, any>, fallbackObject?: Record<string, any>): number | null {
  const topLevel = positiveUnix(subscription.current_period_end)
  if (topLevel) return topLevel

  const items = Array.isArray(subscription.items?.data) ? subscription.items.data : []
  for (const item of items) {
    const itemPeriodEnd = firstPeriodEnd(
      item?.current_period_end,
      item?.period?.end,
      item?.current_period?.end,
      item?.billing_period?.end
    )
    if (itemPeriodEnd) return itemPeriodEnd
  }

  const invoiceLines = Array.isArray(fallbackObject?.lines?.data) ? fallbackObject.lines.data : []
  for (const line of invoiceLines) {
    const linePeriodEnd = firstPeriodEnd(
      line?.period?.end,
      line?.current_period_end,
      line?.parent?.subscription_item_details?.period?.end
    )
    if (linePeriodEnd) return linePeriodEnd
  }

  return null
}

const subscriptionObjectToState = (event: Record<string, any>, object: Record<string, any>, uidOverride?: string, fallbackObject?: Record<string, any>): { uid: string; state: SubscriptionState } | null => {
  const uid = uidOverride || object.metadata?.uid
  if (typeof uid !== 'string' || !uid) return null

  const status = typeof object.status === 'string' ? object.status : 'unknown'
  const subscriptionId = typeof object.id === 'string' && object.object === 'subscription' ? object.id : null
  return {
    uid,
    state: {
      plan: 'pro',
      status,
      stripeCustomerId: typeof object.customer === 'string' ? object.customer : null,
      stripeSubscriptionId: subscriptionId,
      currentPeriodEnd: extractSubscriptionPeriodEnd(object, fallbackObject),
      cancelAtPeriodEnd: object.cancel_at_period_end === true,
      lastStripeEventId: typeof event.id === 'string' ? event.id : null,
      lastStripeEventCreated: typeof event.created === 'number' ? event.created : 0,
      updatedAt: Math.floor(Date.now() / 1000),
      schemaVersion: 1,
    },
  }
}

async function eventToState(event: Record<string, any>, env: BillingEnv): Promise<{ uid: string; state: SubscriptionState } | null> {
  const object = event.data?.object ?? {}
  if (object.object === 'subscription') return subscriptionObjectToState(event, object)

  const subscriptionId = typeof object.subscription === 'string' ? object.subscription : null
  if (!subscriptionId) return null

  const subscription = await retrieveStripeSubscription(env, subscriptionId)
  if (!subscription) return null
  const uid = typeof object.metadata?.uid === 'string'
    ? object.metadata.uid
    : typeof object.client_reference_id === 'string'
      ? object.client_reference_id
      : typeof object.subscription_details?.metadata?.uid === 'string'
        ? object.subscription_details.metadata.uid
        : undefined
  return subscriptionObjectToState(event, subscription, uid, object)
}

export async function handleWebhook(request: Request, env: BillingEnv): Promise<Response> {
  if (!hasWebhookConfig(env)) return billingJson({ error: 'Billing webhook is not configured' }, 503)
  const rawBody = await request.text()
  const valid = await verifyStripeSignature(rawBody, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET)
  if (!valid) return billingJson({ error: 'Invalid signature' }, 400)
  if (!env.BILLING_DB) return billingJson({ error: 'Billing database is not configured' }, 503)

  const event = JSON.parse(rawBody) as Record<string, any>
  const eventId = typeof event.id === 'string' ? event.id : ''
  const eventType = typeof event.type === 'string' ? event.type : ''
  const eventCreated = typeof event.created === 'number' ? event.created : 0
  if (!eventId || !eventType || eventCreated <= 0) return billingJson({ error: 'Invalid Stripe event' }, 400)

  const reservation = await reserveStripeEvent(env, { id: eventId, type: eventType, created: eventCreated })
  if (reservation === 'duplicate') return billingJson({ received: true, duplicate: true })
  if (reservation !== 'reserved') return billingJson({ error: 'Webhook event could not be reserved' }, 503)

  if (![
    'checkout.session.completed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.payment_failed',
    'invoice.payment_succeeded',
  ].includes(eventType)) {
    return billingJson({ received: true, ignored: true })
  }

  if (eventType === 'checkout.session.completed') {
    const object = event.data?.object ?? {}
    const subscriptionId = typeof object.subscription === 'string' ? object.subscription : null
    if (subscriptionId) {
      const next = await eventToState(event, env)
      if (next) {
        const saved = await saveSubscription(env, next.uid, next.state)
        if (saved === 'failed') {
          await deleteStripeEvent(env, eventId)
          return billingJson({ error: 'Subscription state could not be saved' }, 503)
        }
        if (saved === 'stale') return billingJson({ received: true, stale: true })
        return billingJson({ received: true })
      }
    }

    const saved = await saveCheckoutAssociation(env, event)
    if (saved === 'failed') {
      await deleteStripeEvent(env, eventId)
      return billingJson({ error: 'Checkout association could not be saved' }, 503)
    }
    if (saved === 'stale') return billingJson({ received: true, stale: true })
    return billingJson({ received: true, ignored: saved === 'ignored' })
  }

  const next = await eventToState(event, env)
  if (!next) return billingJson({ received: true, ignored: true })
  const saved = await saveSubscription(env, next.uid, next.state)
  if (saved === 'failed') {
    await deleteStripeEvent(env, eventId)
    return billingJson({ error: 'Subscription state could not be saved' }, 503)
  }
  if (saved === 'stale') return billingJson({ received: true, stale: true })
  return billingJson({ received: true })
}

export function getFallbackBillingStatusForTests() {
  return safeStatus(null)
}
