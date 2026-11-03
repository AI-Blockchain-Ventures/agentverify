import type { Principal } from './authz'
import { getPriceInfo, TEAM_MAX_SEATS, TEAM_MIN_SEATS, type BillingEnv } from './billing'
import { firestoreAdminAuthHeader, identityToolkitBaseUrl, apiKeyQueryParam } from './firebaseAuth'

/**
 * Admin panel API (only for the emails in the ADMIN_EMAILS secret, and only when Firebase says that
 * email is verified). Lets the owner see every account, who pays and how, and give a plan to a partner
 * without Stripe.
 */
export interface AdminEnv extends BillingEnv {
  /** Comma-separated admin emails. A secret, so it is never in the public repo. */
  ADMIN_EMAILS?: string
}

type Result = { status: number; body: unknown }
const nowSec = () => Math.floor(Date.now() / 1000)

export function isAdmin(principal: Principal | null, env: AdminEnv): boolean {
  if (!principal || principal.type !== 'USER' || principal.emailVerified !== true || !principal.email) return false
  const admins = (env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  return admins.includes(principal.email.toLowerCase())
}

export type PaidVia = 'stripe' | 'granted' | 'team-seat' | 'referral' | 'none'

export interface AdminUser {
  uid: string
  email: string | null
  name: string | null
  company: string | null
  role: string | null
  teamSize: string | null
  building: string[]
  heardFrom: string | null
  referredBy: string | null
  createdAt: number | null
  lastSeenAt: number | null
  plan: 'free' | 'pro' | 'team'
  paidVia: PaidVia
  seats: number | null
  /** when a grant or referral bonus ends (unix seconds), or Stripe's current period end */
  until: number | null
  stripeStatus: string | null
  grantNote: string | null
  teamOwnerEmail: string | null
  scansThisMonth: number
}

interface Row {
  uid: string; email: string | null; name: string | null; company: string | null; role: string | null; team_size: string | null
  building: string | null; heard_from: string | null; created_at: number | null; last_seen_at: number | null
  sub_plan: string | null; sub_status: string | null; stripe_subscription_id: string | null; current_period_end: number | null
  grant_plan: string | null; grant_seats: number | null; grant_until: number | null; grant_note: string | null
  bonus_until: number | null; team_seats: number | null; scan_count: number | null; referrer_email: string | null; team_owner_email: string | null
}

async function loadAllUsers(env: AdminEnv, now = nowSec()): Promise<AdminUser[]> {
  const db = env.BILLING_DB!
  const month = new Date(now * 1000).toISOString().slice(0, 7)
  const rows = (await db.prepare(`
    WITH ids AS (SELECT uid FROM user_profiles UNION SELECT uid FROM subscriptions UNION SELECT uid FROM plan_grants)
    SELECT ids.uid AS uid, p.email AS email, p.name AS name, p.company AS company, p.role AS role, p.team_size AS team_size,
      p.building AS building, p.heard_from AS heard_from, p.created_at AS created_at, p.last_seen_at AS last_seen_at,
      s.plan AS sub_plan, s.status AS sub_status, s.stripe_subscription_id AS stripe_subscription_id, s.current_period_end AS current_period_end,
      g.plan AS grant_plan, g.seats AS grant_seats, g.until AS grant_until, g.note AS grant_note,
      b.until AS bonus_until, ts.seats AS team_seats, u.scan_count AS scan_count,
      rp.email AS referrer_email,
      (SELECT op.email FROM team_members tm LEFT JOIN user_profiles op ON op.uid = tm.owner_uid WHERE tm.member_uid = ids.uid LIMIT 1) AS team_owner_email
    FROM ids
    LEFT JOIN user_profiles p ON p.uid = ids.uid
    LEFT JOIN subscriptions s ON s.uid = ids.uid
    LEFT JOIN plan_grants g ON g.uid = ids.uid
    LEFT JOIN bonus_pro b ON b.uid = ids.uid
    LEFT JOIN team_seats ts ON ts.owner_uid = ids.uid
    LEFT JOIN usage_monthly u ON u.uid = ids.uid AND u.month = ?
    LEFT JOIN referrals r ON r.referred_uid = ids.uid
    LEFT JOIN user_profiles rp ON rp.uid = r.referrer_uid
  `).bind(month).all<Row>()).results ?? []

  return rows.map(r => {
    let building: string[] = []
    try { building = r.building ? JSON.parse(r.building) : [] } catch { building = [] }
    const stripePaid = (r.sub_plan === 'pro' || r.sub_plan === 'team') && (r.sub_status === 'active' || r.sub_status === 'trialing') && Boolean(r.stripe_subscription_id)
    const grantActive = (r.grant_plan === 'pro' || r.grant_plan === 'team') && (r.grant_until === null || r.grant_until > now)
    const bonusActive = typeof r.bonus_until === 'number' && r.bonus_until > now
    let plan: AdminUser['plan'] = 'free'
    let paidVia: PaidVia = 'none'
    let until: number | null = null
    let seats: number | null = null
    if (stripePaid) {
      plan = r.sub_plan as 'pro' | 'team'; paidVia = 'stripe'; until = r.current_period_end; seats = plan === 'team' ? r.team_seats : null
    } else if (grantActive) {
      plan = r.grant_plan as 'pro' | 'team'; paidVia = 'granted'; until = r.grant_until; seats = plan === 'team' ? (r.grant_seats ?? r.team_seats) : null
    } else if (r.team_owner_email) {
      plan = 'team'; paidVia = 'team-seat'
    } else if (bonusActive) {
      plan = 'pro'; paidVia = 'referral'; until = r.bonus_until
    }
    return {
      uid: r.uid, email: r.email, name: r.name, company: r.company, role: r.role, teamSize: r.team_size, building, heardFrom: r.heard_from,
      referredBy: r.referrer_email, createdAt: r.created_at, lastSeenAt: r.last_seen_at, plan, paidVia, seats, until,
      stripeStatus: r.sub_status, grantNote: grantActive ? r.grant_note : null, teamOwnerEmail: r.team_owner_email, scansThisMonth: r.scan_count ?? 0,
    }
  }).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
}

/** GET /v1/admin/overview */
export async function adminOverview(env: AdminEnv, now = nowSec()): Promise<Result> {
  if (!env.BILLING_DB) return { status: 503, body: { error: 'Database not available' } }
  const users = await loadAllUsers(env, now)
  const stripe = users.filter(u => u.paidVia === 'stripe')
  const pro = stripe.filter(u => u.plan === 'pro').length
  const teamUsers = stripe.filter(u => u.plan === 'team')
  const [proPrice, teamPrice] = await Promise.all([getPriceInfo(env, env.STRIPE_PRO_PRICE_ID), getPriceInfo(env, env.STRIPE_TEAM_PRICE_ID)])
  const monthly = (p: { unitAmount: number; interval: string } | null) => (p ? (p.interval === 'year' ? p.unitAmount / 12 : p.unitAmount) : null)
  const proMonthly = monthly(proPrice)
  const teamMonthly = monthly(teamPrice)
  const mrrCents = proMonthly === null && teamMonthly === null ? null
    : Math.round(pro * (proMonthly ?? 0) + teamUsers.reduce((sum, u) => sum + (u.seats ?? TEAM_MIN_SEATS) * (teamMonthly ?? 0), 0))
  const weekAgo = now - 7 * 86400
  return {
    status: 200,
    body: {
      totalUsers: users.length,
      newThisWeek: users.filter(u => (u.createdAt ?? 0) >= weekAgo).length,
      paying: stripe.length,
      payingPro: pro,
      payingTeam: teamUsers.length,
      granted: users.filter(u => u.paidVia === 'granted').length,
      referral: users.filter(u => u.paidVia === 'referral').length,
      mrrCents,
      currency: proPrice?.currency ?? teamPrice?.currency ?? 'usd',
    },
  }
}

export const ADMIN_FILTERS = ['all', 'paying', 'granted', 'new', 'teams', 'free'] as const

/** GET /v1/admin/users?filter=&q=&limit=&offset= */
export async function adminUsers(env: AdminEnv, params: { filter?: string | null; q?: string | null; limit?: number; offset?: number }, now = nowSec()): Promise<Result> {
  if (!env.BILLING_DB) return { status: 503, body: { error: 'Database not available' } }
  let users = await loadAllUsers(env, now)
  const filter = (ADMIN_FILTERS as readonly string[]).includes(params.filter ?? '') ? params.filter : 'all'
  if (filter === 'paying') users = users.filter(u => u.paidVia === 'stripe')
  if (filter === 'granted') users = users.filter(u => u.paidVia === 'granted')
  if (filter === 'new') users = users.filter(u => (u.createdAt ?? 0) >= now - 7 * 86400)
  if (filter === 'teams') users = users.filter(u => u.plan === 'team')
  if (filter === 'free') users = users.filter(u => u.plan === 'free')
  const q = (params.q ?? '').trim().toLowerCase()
  if (q) users = users.filter(u => [u.email, u.name, u.company, u.uid].some(v => v?.toLowerCase().includes(q)))
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 1000)
  const offset = Math.max(params.offset ?? 0, 0)
  return { status: 200, body: { total: users.length, users: users.slice(offset, offset + limit) } }
}

/**
 * POST /v1/admin/grants { uid? | email?, plan: 'pro' | 'team' | 'none', seats?, until?: unix seconds | null, note? }
 * Gives (or removes, with plan 'none') a free plan. Takes effect on the user's next page load.
 */
export type AccountLookup = (query: { uid?: string; email?: string }) => Promise<{ uid: string; emailVerified: boolean } | null>

export async function adminGrant(env: AdminEnv, adminEmail: string, body: Record<string, unknown>, lookupAccount: AccountLookup, now = nowSec()): Promise<Result> {
  const db = env.BILLING_DB
  if (!db) return { status: 503, body: { error: 'Database not available' } }
  const plan = body.plan
  if (plan !== 'pro' && plan !== 'team' && plan !== 'none') return { status: 400, body: { error: 'Plan must be pro, team or none' } }

  let uid = typeof body.uid === 'string' ? body.uid.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!uid && !email) return { status: 400, body: { error: 'Choose a user' } }
  if (uid.length > 128) return { status: 400, body: { error: 'Choose a user' } }

  if (plan === 'none') {
    if (!uid) {
      const known = await db.prepare('SELECT uid FROM user_profiles WHERE lower(email) = ? LIMIT 1').bind(email).first<{ uid: string }>()
      uid = known?.uid ?? (await lookupAccount({ email }))?.uid ?? ''
      if (!uid) return { status: 404, body: { error: 'No Agent Verify account uses that email.' } }
    }
    await db.prepare('DELETE FROM plan_grants WHERE uid = ?').bind(uid).run()
    return { status: 200, body: { ok: true, uid, plan: 'none' } }
  }

  // Giving a plan away: confirm with Firebase (never our own profile table) that the account exists
  // and its email is verified, so an impostor who signed up first with someone's address can't get it.
  const account = await lookupAccount(uid ? { uid } : { email })
  if (!account) return { status: email && !uid ? 404 : 503, body: { error: email && !uid ? 'No Agent Verify account uses that email yet. Ask them to sign up first.' : 'Could not confirm that account with Firebase. Try again.' } }
  if (!account.emailVerified) return { status: 409, body: { error: 'That account has not verified its email yet. Ask them to click the verification email (or sign in with Google), then try again.' } }
  uid = account.uid

  let until: number | null = null
  if (body.until !== null && body.until !== undefined) {
    until = Number(body.until)
    if (!Number.isFinite(until) || until <= now) return { status: 400, body: { error: 'The end date must be in the future' } }
    until = Math.floor(until)
  }
  let seats: number | null = null
  if (plan === 'team') {
    seats = Math.floor(Number(body.seats))
    if (!Number.isFinite(seats) || seats < TEAM_MIN_SEATS || seats > TEAM_MAX_SEATS) return { status: 400, body: { error: `Team seats must be ${TEAM_MIN_SEATS}–${TEAM_MAX_SEATS}` } }
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) || null : null

  await db.prepare(`INSERT INTO plan_grants (uid, plan, seats, until, note, granted_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(uid) DO UPDATE SET plan = excluded.plan, seats = excluded.seats, until = excluded.until, note = excluded.note, granted_by = excluded.granted_by, updated_at = excluded.updated_at`)
    .bind(uid, plan, seats, until, note, adminEmail, now, now).run()
  if (plan === 'team' && seats) {
    // The Team screen and seat checks read seats from team_seats, same as a paid Team plan.
    await db.prepare(`INSERT INTO team_seats (owner_uid, seats, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(owner_uid) DO UPDATE SET seats = excluded.seats, updated_at = excluded.updated_at`).bind(uid, seats, now).run()
  }
  return { status: 200, body: { ok: true, uid, plan, seats, until } }
}

/**
 * POST /v1/admin/import — copies every Firebase sign-in account into user_profiles, so accounts that
 * have not opened the dashboard since 2.0 still show up. Safe to run any time; never overwrites details.
 */
export async function adminImportFirebaseUsers(env: AdminEnv, fetchFn: typeof fetch = fetch): Promise<Result> {
  const db = env.BILLING_DB
  if (!db) return { status: 503, body: { error: 'Database not available' } }
  const headers = await firestoreAdminAuthHeader(env)
  if (!headers || !env.FIREBASE_PROJECT_ID) return { status: 503, body: { error: 'Firebase admin access is not configured' } }
  let pageToken = ''
  let imported = 0
  for (let page = 0; page < 50; page++) {
    const url = `${identityToolkitBaseUrl(env)}/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/accounts:batchGet?maxResults=500&key=${apiKeyQueryParam(env)}${pageToken ? `&nextPageToken=${encodeURIComponent(pageToken)}` : ''}`
    const res = await fetchFn(url, { headers })
    if (!res.ok) return { status: 502, body: { error: 'Could not read users from Firebase', imported } }
    const data = await res.json() as { users?: Array<{ localId?: string; email?: string; createdAt?: string; lastLoginAt?: string }>; nextPageToken?: string }
    for (const u of data.users ?? []) {
      if (!u.localId) continue
      const created = Math.floor(Number(u.createdAt ?? 0) / 1000) || nowSec()
      const lastLogin = Math.floor(Number(u.lastLoginAt ?? 0) / 1000) || null
      await db.prepare(`INSERT INTO user_profiles (uid, email, created_at, last_seen_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(uid) DO UPDATE SET email = COALESCE(user_profiles.email, excluded.email),
          created_at = MIN(user_profiles.created_at, excluded.created_at),
          last_seen_at = MAX(COALESCE(user_profiles.last_seen_at, 0), COALESCE(excluded.last_seen_at, 0))`)
        .bind(u.localId, u.email ?? null, created, lastLogin).run()
      imported++
    }
    if (!data.nextPageToken) break
    pageToken = data.nextPageToken
  }
  return { status: 200, body: { ok: true, imported } }
}
