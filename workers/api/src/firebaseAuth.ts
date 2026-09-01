// Shared Firebase access layer: service-account OAuth token minting (for admin-level Firestore
// REST access in production), Firebase ID token verification (for the browser auth bridge), and
// emulator-aware URL/credential helpers so every Firestore/Identity-Toolkit call in this codebase
// can transparently target either the real Firebase project or a local emulator suite.
//
// EMULATOR DETECTION: gated entirely behind the standard Firebase env vars
// (FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST) that every official Firebase Admin SDK
// already uses for exactly this purpose — a real production deployment never has these set, so
// there is no code path here that weakens production security "by accident". When neither is
// set, every function in this module behaves exactly as it did before local-review support
// existed: real OAuth tokens, real JWKS signature verification, real Google endpoints.

export interface FirebaseServiceAccountEnv {
  FIREBASE_CLIENT_EMAIL?: string
  FIREBASE_PRIVATE_KEY?: string
  FIREBASE_PROJECT_ID?: string
  FIREBASE_API_KEY?: string
  /** Standard Firebase emulator env var, e.g. "127.0.0.1:8180". Enables Firestore emulator mode. */
  FIRESTORE_EMULATOR_HOST?: string
  /** Standard Firebase emulator env var, e.g. "127.0.0.1:9099". Enables Auth emulator mode (unsigned ID tokens, local Identity Toolkit). */
  FIREBASE_AUTH_EMULATOR_HOST?: string
}

interface FirebaseServiceAccountToken {
  access_token?: string
  expires_in?: number
  token_type?: string
}

const textEncoder = new TextEncoder()

const base64UrlEncode = (value: string | ArrayBuffer): string => {
  const bytes = typeof value === 'string' ? textEncoder.encode(value) : new Uint8Array(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
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

const normalizePrivateKey = (privateKey: string): string =>
  privateKey.replace(/\\n/g, '\n').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '')

const privateKeyToArrayBuffer = (privateKey: string): ArrayBuffer => {
  const binary = atob(normalizePrivateKey(privateKey))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function isEmulated(env: FirebaseServiceAccountEnv): boolean {
  return !!env.FIRESTORE_EMULATOR_HOST
}

function isAuthEmulated(env: FirebaseServiceAccountEnv): boolean {
  return !!env.FIREBASE_AUTH_EMULATOR_HOST
}

/**
 * Mints a real Google OAuth access token from a service-account key (RS256-signed JWT bearer
 * grant). NEVER called in emulator mode — the emulator's magic "owner" bearer token
 * (see firestoreAuthHeader) does the equivalent job with no real credentials needed.
 */
export async function getFirebaseAccessToken(env: FirebaseServiceAccountEnv): Promise<string | null> {
  if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    console.error('Firestore service access unavailable: Firebase service account secrets are missing')
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claim = {
    iss: env.FIREBASE_CLIENT_EMAIL,
    // Both scopes on one minted token: Firestore admin access, and Identity Platform admin
    // access (needed for resolveUidByEmail's accounts:lookup call in organizations.ts — that
    // endpoint requires real admin OAuth auth, not just the Web API key, in production exactly
    // as much as it does against the emulator).
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }
  const unsignedJwt = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claim))}`
  const key = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyToArrayBuffer(env.FIREBASE_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, textEncoder.encode(unsignedJwt))
  const assertion = `${unsignedJwt}.${base64UrlEncode(signature)}`

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!tokenRes.ok) {
    console.error('Firestore service access unavailable: OAuth token request failed', tokenRes.status, await tokenRes.text())
    return null
  }
  const token = await tokenRes.json() as FirebaseServiceAccountToken
  return token.access_token ?? null
}

/** The bare Firestore resource path — `projects/{project}/databases/(default)/documents` — with NO protocol, host, or `v1/` API-version segment. This is the exact shape a `:commit`/`:runQuery` write's `name` field must use (those reference documents by resource name, not by request URL), so build it from this helper rather than by string-stripping firestoreBaseUrl()'s result. */
export function firestoreResourcePath(env: FirebaseServiceAccountEnv): string {
  const projectId = env.FIREBASE_PROJECT_ID ?? 'agentverify-26e26'
  return `projects/${projectId}/databases/(default)/documents`
}

/** Base URL for Firestore REST document/query operations — production Google endpoint, or the local emulator when FIRESTORE_EMULATOR_HOST is set. Never includes a trailing slash. */
export function firestoreBaseUrl(env: FirebaseServiceAccountEnv): string {
  const resourcePath = firestoreResourcePath(env)
  if (isEmulated(env)) {
    return `http://${env.FIRESTORE_EMULATOR_HOST}/v1/${resourcePath}`
  }
  return `https://firestore.googleapis.com/v1/${resourcePath}`
}

/**
 * Admin-level auth header — used for BOTH Firestore REST calls and Identity Toolkit admin calls
 * (e.g. accounts:lookup by email in organizations.ts's resolveUidByEmail, which requires real
 * admin auth in production just as much as Firestore does, never just the Web API key): a real
 * OAuth Bearer token (now requesting both the datastore and identitytoolkit scopes — see
 * getFirebaseAccessToken) in production, or the emulator's well-known "owner" magic token locally
 * (documented Firestore/Auth emulator behavior — the same mechanism the Firebase Admin SDK and
 * `withSecurityRulesDisabled` test helpers use, and it works against both local emulators, not
 * just Firestore's). Returns null if a real token was needed but couldn't be minted.
 */
export async function firestoreAdminAuthHeader(env: FirebaseServiceAccountEnv): Promise<Record<string, string> | null> {
  if (isEmulated(env)) return { Authorization: 'Bearer owner' }
  const token = await getFirebaseAccessToken(env)
  if (!token) return null
  return { Authorization: `Bearer ${token}` }
}

/** Base URL for Identity Toolkit (Firebase Auth) REST calls — production or local Auth emulator. */
export function identityToolkitBaseUrl(env: FirebaseServiceAccountEnv): string {
  if (isAuthEmulated(env)) return `http://${env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`
  return 'https://identitytoolkit.googleapis.com/v1'
}

/** The `?key=` value for unauthenticated-style Firestore/Identity-Toolkit REST calls. The emulator ignores its value entirely, so any placeholder works there. */
export function apiKeyQueryParam(env: FirebaseServiceAccountEnv): string {
  return isEmulated(env) || isAuthEmulated(env) ? (env.FIREBASE_API_KEY || 'emulator-placeholder-key') : (env.FIREBASE_API_KEY ?? '')
}

interface FirebaseJwk extends JsonWebKey {
  kid?: string
}

const parseJwt = (token: string): { header: Record<string, unknown>; payload: Record<string, unknown>; signed: string; signature: Uint8Array } | null => {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    return {
      header: JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0]))) as Record<string, unknown>,
      payload: JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1]))) as Record<string, unknown>,
      signed: `${parts[0]}.${parts[1]}`,
      signature: parts[2] ? base64UrlToBytes(parts[2]) : new Uint8Array(0),
    }
  } catch {
    return null
  }
}

export interface FirebaseUser {
  uid: string
  email?: string
}

/**
 * Verifies a Firebase ID token presented by the BROWSER — this is the auth-bridge primitive: it
 * proves "this request really comes from the Firebase-authenticated uid it claims", the same way
 * validateApiKey proves an API key belongs to a uid. Two verification paths:
 *
 * - PRODUCTION (no FIREBASE_AUTH_EMULATOR_HOST): full RS256 signature verification against
 *   Google's published JWKS for the Identity Toolkit signing service, plus issuer/audience/
 *   expiry/subject claim checks. This is the only path that can ever run against a real user.
 * - EMULATOR (FIREBASE_AUTH_EMULATOR_HOST set): the Auth emulator issues intentionally UNSIGNED
 *   tokens (`alg: "none"`, empty signature) — this is documented emulator behavior, not a
 *   weakness introduced here. Signature verification is skipped ONLY in this explicitly-gated
 *   mode, but claim validation (issuer format, audience === projectId, expiry, subject present)
 *   still runs in full, and a token that claims any algorithm OTHER than "none" is rejected
 *   outright even in emulator mode, so a real, improperly-verified token can never slip through
 *   by accident.
 */
export async function verifyFirebaseIdToken(token: string | null | undefined, env: FirebaseServiceAccountEnv): Promise<FirebaseUser | null> {
  if (!token || !env.FIREBASE_PROJECT_ID) return null

  const parsed = parseJwt(token)
  if (!parsed) return null

  const issuer = `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`
  const now = Math.floor(Date.now() / 1000)
  if (
    parsed.payload.aud !== env.FIREBASE_PROJECT_ID ||
    parsed.payload.iss !== issuer ||
    typeof parsed.payload.sub !== 'string' || !parsed.payload.sub ||
    typeof parsed.payload.exp !== 'number' || parsed.payload.exp <= now
  ) {
    return null
  }

  if (isAuthEmulated(env)) {
    if (parsed.header.alg !== 'none') return null // reject anything claiming a real algorithm while in emulator mode — never partially trust it
    return { uid: parsed.payload.sub, email: typeof parsed.payload.email === 'string' ? parsed.payload.email : undefined }
  }

  const kid = typeof parsed.header.kid === 'string' ? parsed.header.kid : ''
  if (!kid || parsed.header.alg !== 'RS256') return null
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
