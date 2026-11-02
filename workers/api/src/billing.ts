import { bonusProUntil } from './growth'
import { activeGrant } from './grants'
import { touchUserProfile } from './userProfiles'
import { verifyFirebaseIdToken, type FirebaseServiceAccountEnv } from './firebaseAuth'

export type Plan = 'free' | 'pro' | 'team'

export interface D1Result<T = unknown> {
  results?: T[]
  success?: boolean
  meta?: { changes?: number }
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = unknown>(): Promise<T | null>
  run<T = unknown>(): Promise<D1Result<T>>
  all<T = unknown>(): Promise<D1Result<T>>
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch?<T = unknown>(statements: D1PreparedStatement[]): Promise<Array<D1Result<T>>>
}

export interface BillingEnv extends FirebaseServiceAccountEnv {
  BILLING_ENABLED?: string
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  STRIPE_PRO_PRICE_ID?: string
  /** Per-seat Team price. Team checkout stays off until this is set. */
  STRIPE_TEAM_PRICE_ID?: string
  STRIPE_PORTAL_CONFIGURATION_ID?: string
  BILLING_SUCCESS_URL?: string
  BILLING_CANCEL_URL?: string
  BILLING_DB?: D1Database
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
  /** Pro time earned from referrals (no Stripe subscription). */
  referralBonus?: boolean
  /** A plan the admin gave this account for free (no Stripe subscription). */
  granted?: boolean
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

const isEnabled = (env: BillingEnv): boolean => env.BILLING_ENABLED === 'true'

const hasD1 = (env: BillingEnv): boolean => !!env.BILLING_DB

// Same emulator-detection convention as firebaseAuth.ts's isAuthEmulated — true only under
// `npm run review` (see scripts/review.mjs's --var FIREBASE_AUTH_EMULATOR_HOST). Lets the 503
// responses below tell a reviewer "this is local review, not a real outage" instead of the
// generic message a real production misconfiguration would show.
const isReviewEnvironment = (env: BillingEnv): boolean => !!env.FIREBASE_AUTH_EMULATOR_HOST

const notConfiguredResponse = (env: BillingEnv, what: 'checkout' | 'billing portal'): Response =>
  billingJson(
    isReviewEnvironment(env)
      ? { error: `LOCAL REVIEW: ${what === 'checkout' ? 'Billing checkout' : 'The billing portal'} requires Stripe test configuration. See "Local Review Billing" in docs/billing-setup.md.`, reviewMode: true }
      : { error: `Billing is not configured` },
    503
  )

// Single source of truth for scan quotas on the Worker side (mirrors apps/web/src/lib/pricing.ts,
// which is canonical for the pricing page — the two can't share a module across deployables).
export const SCAN_QUOTA_BY_PLAN: Record<Plan, number> = { free: 10, pro: 100, team: 300 }

/** Team includes everything in Pro. Use this, never `plan === 'pro'`, to decide whether paid features apply. */
export const hasProFeatures = (plan: string): boolean => plan === 'pro' || plan === 'team'
export const TEAM_MIN_SEATS = 2
export const TEAM_MAX_SEATS = 100

const hasCheckoutConfig = (env: BillingEnv): boolean =>
  isEnabled(env) && !!env.STRIPE_SECRET_KEY && !!env.STRIPE_PRO_PRICE_ID && !!env.BILLING_SUCCESS_URL && !!env.BILLING_CANCEL_URL && !!env.FIREBASE_PROJECT_ID && hasD1(env)

const hasWebhookConfig = (env: BillingEnv): boolean =>
  isEnabled(env) && !!env.STRIPE_WEBHOOK_SECRET

/** Pro is always self-serve. Team is self-serve only once its per-seat Stripe price is configured. */
export const isPlanCheckoutAvailable = (plan: string, env?: Pick<BillingEnv, 'STRIPE_TEAM_PRICE_ID'>): boolean =>
  plan === 'pro' || (plan === 'team' && !!env?.STRIPE_TEAM_PRICE_ID)

const unixToIso = (value: number | null | undefined): string | null => typeof value === 'number' && value > 0 ? new Date(value * 1000).toISOString() : null

const planFromState = (state?: Partial<SubscriptionState> | null): Plan => {
  const paid = state?.plan === 'pro' || state?.plan === 'team'
  const active = paid && (state!.status === 'active' || state!.status === 'trialing')
  return active ? (state!.plan as Plan) : 'free'
}

const safeStatus = (state?: Partial<SubscriptionState> | null) => {
  const plan = planFromState(state)
  return {
    plan,
    status: state?.status ?? 'free',
    scanQuota: SCAN_QUOTA_BY_PLAN[plan],
    features: {
      fullRemediation: hasProFeatures(plan),
      correctedSnippets: hasProFeatures(plan),
      a2spaGuidance: hasProFeatures(plan),
      pdfExport: hasProFeatures(plan),
    },
    currentPeriodEnd: unixToIso(state?.currentPeriodEnd ?? null),
    cancelAtPeriodEnd: state?.cancelAtPeriodEnd === true,
    referralBonus: state?.referralBonus === true,
    granted: state?.granted === true,
  }
}

/** Thin wrapper around the shared verifyFirebaseIdToken — extracts the Bearer token from this request's Authorization header first. */
async function verifyFirebaseUser(request: Request, env: BillingEnv): Promise<{ uid: string; email?: string } | null> {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim()
  return verifyFirebaseIdToken(token, env)
}

const rowToState = (row: SubscriptionRow | null): SubscriptionState | null => row ? {
  plan: row.plan === 'team' ? 'team' : row.plan === 'pro' ? 'pro' : 'free',
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

/**
 * This account's own plan: a paid Stripe subscription wins; otherwise a plan the admin gave them (admin.ts).
 * A grant never touches Stripe — the Stripe ids are kept so the billing portal still works if they also pay.
 */
async function loadOwnPlan(env: BillingEnv, uid: string): Promise<SubscriptionState | null> {
  const own = await loadSubscription(env, uid)
  if (planFromState(own) !== 'free') return own
  const grant = await activeGrant(env.BILLING_DB, uid)
  if (!grant) return own
  return {
    plan: grant.plan, status: 'active', stripeCustomerId: own?.stripeCustomerId ?? null, stripeSubscriptionId: null,
    currentPeriodEnd: grant.until, cancelAtPeriodEnd: false, lastStripeEventId: null, lastStripeEventCreated: 0,
    updatedAt: Math.floor(Date.now() / 1000), schemaVersion: 1, granted: true,
  }
}

/**
 * The Team owner whose plan covers this member, if any. A member is covered while the owner's Team subscription is
 * active and the member is within the paid seats (seats include the owner; earliest-added members keep their seat).
 */
export async function loadTeamOwnerFor(env: BillingEnv, uid: string): Promise<string | null> {
  if (!env.BILLING_DB) return null
  let owners: Array<{ owner_uid: string }> = []
  try {
    owners = (await env.BILLING_DB.prepare('SELECT owner_uid FROM team_members WHERE member_uid = ?').bind(uid).all<{ owner_uid: string }>()).results ?? []
  } catch {
    return null // team tables not created yet
  }
  for (const { owner_uid } of owners) {
    const owner = await loadOwnPlan(env, owner_uid)
    if (planFromState(owner) !== 'team') continue
    const seatRow = await env.BILLING_DB.prepare('SELECT seats FROM team_seats WHERE owner_uid = ?').bind(owner_uid).first<{ seats: number }>()
    const memberSeats = Math.max(0, (seatRow?.seats ?? 0) - 1)
    const members = (await env.BILLING_DB.prepare('SELECT member_uid FROM team_members WHERE owner_uid = ? ORDER BY added_at ASC, member_uid ASC').bind(owner_uid).all<{ member_uid: string }>()).results ?? []
    const position = members.findIndex(m => m.member_uid === uid)
    if (position >= 0 && position < memberSeats) return owner_uid
  }
  return null
}

/** The subscription that decides this user's plan: their own if it is paid, otherwise a Team seat they hold. */
async function loadEffectiveSubscription(env: BillingEnv, uid: string): Promise<SubscriptionState | null> {
  const own = await loadOwnPlan(env, uid)
  if (planFromState(own) !== 'free') return own
  const ownerUid = await loadTeamOwnerFor(env, uid)
  if (ownerUid) {
    const owner = await loadOwnPlan(env, ownerUid)
    // A member never sees or controls the owner's Stripe customer/subscription.
    if (owner) return { ...owner, stripeCustomerId: null, stripeSubscriptionId: null, cancelAtPeriodEnd: false }
  }
  const bonusUntil = await bonusProUntil(env.BILLING_DB, uid)
  if (bonusUntil) {
    return {
      plan: 'pro', status: 'active', stripeCustomerId: own?.stripeCustomerId ?? null, stripeSubscriptionId: null,
      currentPeriodEnd: bonusUntil, cancelAtPeriodEnd: false, lastStripeEventId: null, lastStripeEventCreated: 0,
      updatedAt: Math.floor(Date.now() / 1000), schemaVersion: 1, referralBonus: true,
    }
  }
  return own
}

export interface ScanQuotaCheck {
  allowed: boolean
  plan: Plan
  used: number
  limit: number
  month: string
}

const currentUsageMonth = (): string => new Date().toISOString().slice(0, 7) // YYYY-MM

/**
 * Checks whether `uid` still has scan quota left for the current calendar month.
 * Fails open (allowed: true) when D1 isn't bound so a misconfigured environment degrades
 * to "unlimited" rather than locking every scan out — same fallback posture as the rest
 * of billing.ts (see loadSubscription/handleStatus).
 */
export async function checkScanQuota(env: BillingEnv, uid: string): Promise<ScanQuotaCheck> {
  const month = currentUsageMonth()
  if (!env.BILLING_DB) {
    return { allowed: true, plan: 'free', used: 0, limit: SCAN_QUOTA_BY_PLAN.free, month }
  }
  const [state, usageRow] = await Promise.all([
    loadEffectiveSubscription(env, uid),
    env.BILLING_DB.prepare('SELECT scan_count FROM usage_monthly WHERE uid = ? AND month = ?').bind(uid, month).first<{ scan_count: number }>(),
  ])
  const plan = planFromState(state)
  const limit = SCAN_QUOTA_BY_PLAN[plan]
  const used = usageRow?.scan_count ?? 0
  return { allowed: used < limit, plan, used, limit, month }
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
  if (!hasCheckoutConfig(env)) return notConfiguredResponse(env, 'checkout')
  const user = await verifyFirebaseUser(request, env)
  if (!user) return billingJson({ error: 'Authentication required' }, 401)

  let requestedPlan = 'pro'
  let requestedSeats: unknown = undefined
  try {
    const body = await request.json() as { plan?: string; seats?: unknown }
    requestedPlan = body.plan ?? 'pro'
    requestedSeats = body.seats
  } catch {
    requestedPlan = 'pro'
  }
  if (!isPlanCheckoutAvailable(requestedPlan, env)) return billingJson({ error: 'Checkout is unavailable for this plan' }, 400)
  const isTeam = requestedPlan === 'team'
  const seats = isTeam ? Number(requestedSeats ?? TEAM_MIN_SEATS) : 1
  if (isTeam && (!Number.isInteger(seats) || seats < TEAM_MIN_SEATS || seats > TEAM_MAX_SEATS)) {
    return billingJson({ error: `Team plans have ${TEAM_MIN_SEATS} to ${TEAM_MAX_SEATS} seats.` }, 400)
  }

  // Loaded once, used for two things below: (1) the duplicate-subscription guard, (2) reusing the
  // existing Stripe customer instead of minting a new one on repeat checkouts.
  const existingState = await loadSubscription(env, user.uid)

  // The UI already hides "Start Pro Checkout" once a user is active/trialing Pro, but that's a
  // presentation detail, not a security boundary — a stale tab, a replayed request, or someone
  // calling this endpoint directly must not be able to create a second, concurrent Stripe
  // subscription for a uid that already has one. Route straight to that subscription's management
  // portal instead (same {url} response shape the checkout caller already expects, so no special
  // frontend handling is required), falling back to a plain rejection if the portal itself isn't
  // configured.
  if (existingState?.stripeCustomerId && (existingState.plan === 'pro' || existingState.plan === 'team') && (existingState.status === 'active' || existingState.status === 'trialing')) {
    if (env.STRIPE_PORTAL_CONFIGURATION_ID && env.BILLING_CANCEL_URL) {
      const portalBody = new URLSearchParams({
        customer: existingState.stripeCustomerId,
        return_url: env.BILLING_CANCEL_URL,
        configuration: env.STRIPE_PORTAL_CONFIGURATION_ID,
      })
      const portalRes = await stripeRequest(env, '/v1/billing_portal/sessions', portalBody)
      const portalData = await portalRes.json() as { url?: string }
      if (portalRes.ok && portalData.url) return billingJson({ url: portalData.url, alreadySubscribed: true })
    }
    return billingJson({ error: 'You already have an active Pro subscription.', alreadySubscribed: true }, 409)
  }

  const body = new URLSearchParams({
    mode: 'subscription',
    success_url: env.BILLING_SUCCESS_URL!,
    cancel_url: env.BILLING_CANCEL_URL!,
    'line_items[0][price]': isTeam ? env.STRIPE_TEAM_PRICE_ID! : env.STRIPE_PRO_PRICE_ID!,
    'line_items[0][quantity]': String(seats),
    client_reference_id: user.uid,
    'metadata[uid]': user.uid,
    'subscription_data[metadata][uid]': user.uid,
  })
  if (isTeam) {
    body.set('metadata[plan]', 'team')
    body.set('subscription_data[metadata][plan]', 'team')
    // Let the buyer change the seat count on Stripe's page.
    body.set('line_items[0][adjustable_quantity][enabled]', 'true')
    body.set('line_items[0][adjustable_quantity][minimum]', String(TEAM_MIN_SEATS))
    body.set('line_items[0][adjustable_quantity][maximum]', String(TEAM_MAX_SEATS))
  }
  // Reuse the Stripe customer already on file for this uid (e.g. a prior canceled/abandoned
  // subscription) instead of always minting a new one. Without this, every repeat checkout
  // created a brand-new Stripe Customer object — orphaning the old one and, in the case of two
  // checkouts completed close together, risking two simultaneously-active subscriptions for the
  // same uid while D1 (one row per uid) only ever tracks the most recently-processed one.
  if (existingState?.stripeCustomerId) {
    body.set('customer', existingState.stripeCustomerId)
  } else if (user.email) {
    body.set('customer_email', user.email)
  }

  const stripeRes = await stripeRequest(env, '/v1/checkout/sessions', body)
  const data = await stripeRes.json() as { url?: string }
  if (!stripeRes.ok || !data.url) return billingJson({ error: 'Unable to create checkout session' }, 502)
  return billingJson({ url: data.url })
}

export async function handlePortal(request: Request, env: BillingEnv): Promise<Response> {
  if (!isEnabled(env) || !env.STRIPE_SECRET_KEY || !env.STRIPE_PORTAL_CONFIGURATION_ID || !env.BILLING_CANCEL_URL || !env.FIREBASE_PROJECT_ID || !hasD1(env)) {
    return notConfiguredResponse(env, 'billing portal')
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
  if (!user) {
    console.warn('Billing status fallback: Firebase user verification returned null')
  }
  if (!env.BILLING_DB) {
    console.warn('Billing status fallback: BILLING_DB is not bound')
  }
  if (!user || !env.BILLING_DB) return billingJson({ ...safeStatus(null), used: 0 })
  // Every dashboard visit loads billing status, so this is where an account first appears in the admin panel.
  await touchUserProfile(env.BILLING_DB, user.uid, user.email)
  const [state, quota] = await Promise.all([loadEffectiveSubscription(env, user.uid), checkScanQuota(env, user.uid)])
  // `used` reflects the SAME usage_monthly ledger checkScanQuota enforces against on every real
  // scan (web, CLI, and API alike) — this is real remaining-quota display, not a separate,
  // driftable counter.
  return billingJson({ ...safeStatus(state), used: quota.used })
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
    `).bind(uid, object.metadata?.plan === 'team' ? 'team' : 'pro', 'pending', customerId, subscriptionId, null, 0, eventId, eventCreated, now, 1).run()
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

const subscriptionObjectToState = (event: Record<string, any>, object: Record<string, any>, uidOverride?: string, fallbackObject?: Record<string, any>, teamPriceId?: string): { uid: string; state: SubscriptionState; seats: number | null } | null => {
  const uid = uidOverride || object.metadata?.uid
  if (typeof uid !== 'string' || !uid) return null
  const items: Array<Record<string, any>> = Array.isArray(object.items?.data) ? object.items.data : []
  const teamItem = teamPriceId ? items.find(item => item?.price?.id === teamPriceId) : undefined
  const isTeam = Boolean(teamItem) || object.metadata?.plan === 'team'
  const quantity = Number(teamItem?.quantity ?? items[0]?.quantity)

  const status = typeof object.status === 'string' ? object.status : 'unknown'
  const subscriptionId = typeof object.id === 'string' && object.object === 'subscription' ? object.id : null
  return {
    uid,
    seats: isTeam && Number.isInteger(quantity) && quantity > 0 ? quantity : null,
    state: {
      plan: isTeam ? 'team' : 'pro',
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

async function eventToState(event: Record<string, any>, env: BillingEnv): Promise<{ uid: string; state: SubscriptionState; seats: number | null } | null> {
  const object = event.data?.object ?? {}
  if (object.object === 'subscription') return subscriptionObjectToState(event, object, undefined, undefined, env.STRIPE_TEAM_PRICE_ID)

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
  return subscriptionObjectToState(event, subscription, uid, object, env.STRIPE_TEAM_PRICE_ID)
}

/** Keep the Team seat count in step with Stripe (the buyer can change it on Stripe's pages). */
async function saveTeamSeats(env: BillingEnv, uid: string, seats: number | null): Promise<void> {
  if (!env.BILLING_DB || !seats) return
  try {
    await env.BILLING_DB.prepare(`INSERT INTO team_seats (owner_uid, seats, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(owner_uid) DO UPDATE SET seats = excluded.seats, updated_at = excluded.updated_at`).bind(uid, seats, Math.floor(Date.now() / 1000)).run()
  } catch (e) {
    console.error('Team seats could not be saved:', e instanceof Error ? e.message : e)
  }
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
        if (next.state.plan === 'team') await saveTeamSeats(env, next.uid, next.seats)
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
  if (next.state.plan === 'team') await saveTeamSeats(env, next.uid, next.seats)
  return billingJson({ received: true })
}

let teamPriceCache: { id: string; at: number; value: { unitAmount: number; currency: string; interval: string } | null } | null = null

/** The Team per-seat price as set in Stripe (cached for an hour), so the pricing page always matches checkout. */
const priceCache = new Map<string, { at: number; value: { unitAmount: number; currency: string; interval: string } | null }>()

/** Unit price of any Stripe price id (cached 1h). Used by the admin panel's revenue estimate. */
export async function getPriceInfo(env: BillingEnv, priceId: string | undefined): Promise<{ unitAmount: number; currency: string; interval: string } | null> {
  if (!priceId || !env.STRIPE_SECRET_KEY) return null
  const hit = priceCache.get(priceId)
  if (hit && Date.now() - hit.at < 3600_000) return hit.value
  let value: { unitAmount: number; currency: string; interval: string } | null = null
  try {
    const res = await stripeGet(env, `/v1/prices/${encodeURIComponent(priceId)}`)
    const price = await res.json() as { unit_amount?: number; currency?: string; recurring?: { interval?: string } }
    if (res.ok && typeof price.unit_amount === 'number') value = { unitAmount: price.unit_amount, currency: price.currency ?? 'usd', interval: price.recurring?.interval ?? 'month' }
  } catch {
    value = null
  }
  priceCache.set(priceId, { at: Date.now(), value })
  return value
}

export async function getTeamSeatPrice(env: BillingEnv): Promise<{ unitAmount: number; currency: string; interval: string } | null> {
  if (!env.STRIPE_TEAM_PRICE_ID || !env.STRIPE_SECRET_KEY) return null
  if (teamPriceCache && teamPriceCache.id === env.STRIPE_TEAM_PRICE_ID && Date.now() - teamPriceCache.at < 3600_000) return teamPriceCache.value
  let value: { unitAmount: number; currency: string; interval: string } | null = null
  try {
    const res = await stripeGet(env, `/v1/prices/${encodeURIComponent(env.STRIPE_TEAM_PRICE_ID)}`)
    const price = await res.json() as { unit_amount?: number; currency?: string; recurring?: { interval?: string } }
    if (res.ok && typeof price.unit_amount === 'number') value = { unitAmount: price.unit_amount, currency: price.currency ?? 'usd', interval: price.recurring?.interval ?? 'month' }
  } catch {
    value = null
  }
  teamPriceCache = { id: env.STRIPE_TEAM_PRICE_ID, at: Date.now(), value }
  return value
}

export function getFallbackBillingStatusForTests() {
  return safeStatus(null)
}
