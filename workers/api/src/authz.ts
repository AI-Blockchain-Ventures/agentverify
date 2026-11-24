import { firestoreBaseUrl, apiKeyQueryParam, verifyFirebaseIdToken, type FirebaseServiceAccountEnv } from './firebaseAuth'
import { requirePermission as requirePermissionForOrg, type OrganizationsEnv } from './organizations'
import type { Permission, Role } from './rbac'

/**
 * Centralized authentication + authorization.
 *
 *   authenticateRequest()  — who is calling? (USER via Firebase ID token, or API_KEY)
 *   authorize(permission)  — may they do this, in this organization?
 *
 * This is the ONLY place request authentication happens for org/audit/webhook routes — no
 * route hand-rolls its own token check. Two principal types, one downstream authorization path:
 * once a uid is established (however it was established), membership/role lookup and permission
 * checking (organizations.ts's requirePermission) is identical — the CLI and the browser
 * dashboard end up going through the exact same RBAC gate.
 *
 * UI hiding a button is convenience only. This module — running server-side, reading role from
 * Firestore itself — is what's actually authoritative. Nothing here ever trusts a uid,
 * organizationId, or role supplied by the client; uid comes only from a verified token/key,
 * role comes only from a fresh Firestore read.
 */

export type Principal =
  | { type: 'USER'; uid: string; email?: string; emailVerified?: boolean }
  | { type: 'API_KEY'; uid: string; apiKey: string }
  | { type: 'SYSTEM' }

export type AuthzEnv = FirebaseServiceAccountEnv & OrganizationsEnv & {
  /**
   * ISO time. API keys created before it are refused (they were readable by others before the
   * 2026-11-24 Firestore rules fix). Keys with no createdAt count as before it. Unset = no cutoff.
   */
  API_KEYS_ISSUED_AFTER?: string
}

export const RETIRED_API_KEY_MESSAGE = "This API key was retired for security on November 24, 2026. Create a new key in your Agent Verify dashboard (API tab): https://aimodularity.com/agentverify/dashboard/?tab=api, then use the new key."

/** True when a key with this createdAt was made before the API_KEYS_ISSUED_AFTER cutoff. */
export function isRetiredKeyCreatedAt(createdAt: string | undefined, cutoff: string | undefined): boolean {
  if (!cutoff) return false
  const cut = Date.parse(cutoff)
  if (Number.isNaN(cut)) return false
  const made = createdAt ? Date.parse(createdAt) : NaN
  return Number.isNaN(made) || made < cut
}

function extractBearerToken(request: Request): string | null {
  const raw = request.headers.get('Authorization')?.trim() ?? ''
  const match = raw.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : null
}

const API_KEY_PATTERN = /^av_[a-zA-Z0-9_-]{20,}$/

interface ApiKeyIndexFields {
  uid?: { stringValue?: string }
  status?: { stringValue?: string }
  disabled?: { booleanValue?: boolean }
  revoked?: { booleanValue?: boolean }
  createdAt?: { stringValue?: string; timestampValue?: string }
}

type ApiKeyLookup = { state: 'ok'; uid: string } | { state: 'retired' } | { state: 'invalid' }

/** Reads one key from apiKeyIndex and says whether it is usable, retired by the cutoff, or not valid at all. */
async function lookupApiKey(apiKey: string, env: AuthzEnv): Promise<ApiKeyLookup> {
  try {
    const url = `${firestoreBaseUrl(env)}/apiKeyIndex/${encodeURIComponent(apiKey)}?key=${apiKeyQueryParam(env)}`
    const res = await fetch(url)
    if (!res.ok) return { state: 'invalid' }
    const data = await res.json() as { fields?: ApiKeyIndexFields }
    const fields = data.fields ?? {}
    const uid = fields.uid?.stringValue
    const status = fields.status?.stringValue?.toLowerCase()
    const disabled = fields.disabled?.booleanValue === true || fields.revoked?.booleanValue === true || status === 'disabled' || status === 'revoked'
    if (!uid || disabled) return { state: 'invalid' }
    const createdAt = fields.createdAt?.stringValue ?? fields.createdAt?.timestampValue
    if (isRetiredKeyCreatedAt(createdAt, env.API_KEYS_ISSUED_AFTER)) return { state: 'retired' }
    return { state: 'ok', uid }
  } catch {
    return { state: 'invalid' }
  }
}

/** True when the request carries an Agent Verify API key that exists but was retired by the cutoff (used to explain a 401). */
export async function requestUsesRetiredApiKey(request: Request, env: AuthzEnv): Promise<boolean> {
  if (!env.API_KEYS_ISSUED_AFTER) return false
  const token = extractBearerToken(request)
  if (!token || !API_KEY_PATTERN.test(token)) return false
  return (await lookupApiKey(token, env)).state === 'retired'
}

/** Resolves an Agent Verify API key to a uid — same apiKeyIndex lookup the CLI/API path has always used, now shared so both auth paths live in one file. */
async function resolveApiKey(apiKey: string, env: AuthzEnv): Promise<Principal | null> {
  const found = await lookupApiKey(apiKey, env)
  return found.state === 'ok' ? { type: 'API_KEY', uid: found.uid, apiKey } : null
}

/**
 * Resolves WHO is calling. Tries, in order: an Agent Verify API key (`av_...` — CLI/CI/server
 * integrations), then a Firebase ID token (browser dashboard sessions). Returns null if neither
 * validates — callers must treat null as fully unauthenticated, never fall back to a default
 * identity.
 */
export async function authenticateRequest(request: Request, env: AuthzEnv): Promise<Principal | null> {
  const token = extractBearerToken(request)
  if (!token) return null

  if (API_KEY_PATTERN.test(token)) {
    return resolveApiKey(token, env)
  }

  const user = await verifyFirebaseIdToken(token, env)
  if (user) return { type: 'USER', uid: user.uid, email: user.email, emailVerified: user.emailVerified }

  return null
}

/** A principal that has passed authorize() is always USER or API_KEY — SYSTEM is rejected before a permission check ever runs (see below), so callers on the ok branch can always read `.uid` directly. */
export type AuthenticatedPrincipal = Extract<Principal, { type: 'USER' | 'API_KEY' }>

export type PermissionCheck = { ok: true; role: Role; principal: AuthenticatedPrincipal } | { ok: false; status: number; error: string }

/**
 * The single authorization gate: authenticates the request, then checks the resolved uid's
 * actual stored membership/role in `orgId` against rbac.ts's permission matrix. A missing/invalid
 * token is a 401; a valid identity with the wrong role (or no membership at all) is a 403/404 —
 * see organizations.ts's requirePermission for why "no membership" and "wrong role" both map to
 * codes that never confirm an org's existence to someone outside it.
 */
export async function authorize(request: Request, orgId: string, permission: Permission, env: AuthzEnv): Promise<PermissionCheck> {
  const principal = await authenticateRequest(request, env)
  if (!principal || principal.type === 'SYSTEM') return { ok: false, status: 401, error: 'Authentication required' }

  const check = await requirePermissionForOrg(orgId, principal.uid, permission, env)
  if (!check.ok) return check
  return { ok: true, role: check.role, principal }
}
