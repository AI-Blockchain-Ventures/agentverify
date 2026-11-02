/**
 * GitHub App plumbing for the PR bot: webhook signature check, app JWT, installation tokens, and a small REST client.
 * Uses only Web Crypto (no dependencies), so it runs on Cloudflare Workers.
 */

export interface GithubAppEnv {
  GITHUB_APP_ID?: string
  /** The .pem GitHub gives you ("BEGIN RSA PRIVATE KEY", PKCS#1) or a PKCS#8 key. Literal "\n" is accepted. */
  GITHUB_APP_PRIVATE_KEY?: string
  GITHUB_WEBHOOK_SECRET?: string
  /** OAuth client of the same app, used to prove which GitHub user is linking an installation. */
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  /** Public slug, e.g. "agent-verify", for install links. */
  GITHUB_APP_SLUG?: string
}

const API = 'https://api.github.com'
const UA = 'agentverify-github-app'
const enc = new TextEncoder()

export function isGithubAppConfigured(env: GithubAppEnv): boolean {
  return Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY && env.GITHUB_WEBHOOK_SECRET)
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Checks GitHub's X-Hub-Signature-256 header against the raw body. */
export async function verifyWebhookSignature(secret: string, body: Uint8Array, header: string | null): Promise<boolean> {
  if (!secret || !header || !header.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = hex(await crypto.subtle.sign('HMAC', key, body as BufferSource))
  return timingSafeEqual(`sha256=${mac}`, header)
}

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? enc.encode(data) : data
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function derLength(n: number): number[] {
  if (n < 0x80) return [n]
  const out: number[] = []
  while (n > 0) { out.unshift(n & 0xff); n >>= 8 }
  return [0x80 | out.length, ...out]
}

/** Wrap a PKCS#1 RSA key in a PKCS#8 envelope, which is what Web Crypto can import. */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const algId = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]
  const octet = [0x04, ...derLength(pkcs1.length)]
  const inner = [0x02, 0x01, 0x00, ...algId, ...octet]
  const total = inner.length + pkcs1.length
  const out = new Uint8Array([0x30, ...derLength(total), ...inner, ...pkcs1])
  return out
}

function pemToDer(pem: string): { der: Uint8Array; pkcs1: boolean } {
  const text = pem.replace(/\\n/g, '\n').trim()
  const pkcs1 = text.includes('BEGIN RSA PRIVATE KEY')
  const body = text.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const bin = atob(body)
  const der = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i)
  return { der, pkcs1 }
}

let cachedKey: { pem: string; key: CryptoKey } | null = null

async function signingKey(pem: string): Promise<CryptoKey> {
  if (cachedKey?.pem === pem) return cachedKey.key
  const { der, pkcs1 } = pemToDer(pem)
  const key = await crypto.subtle.importKey('pkcs8', (pkcs1 ? pkcs1ToPkcs8(der) : der) as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  cachedKey = { pem, key }
  return key
}

/** A short-lived JWT that authenticates as the GitHub App itself. */
export async function createAppJwt(appId: string, privateKeyPem: string, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }))
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey(privateKeyPem), enc.encode(`${header}.${payload}`))
  return `${header}.${payload}.${b64url(new Uint8Array(sig))}`
}

export class GithubError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export async function githubRequest<T>(token: string, method: string, path: string, body?: unknown, fetchFn: FetchLike = fetch, accept = 'application/vnd.github+json'): Promise<T> {
  const res = await fetchFn(path.startsWith('http') ? path : `${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      'User-Agent': UA,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new GithubError(res.status, `GitHub ${method} ${path} failed: ${res.status}`)
  if (accept.includes('raw')) return (await res.text()) as unknown as T
  return (res.status === 204 ? null : await res.json()) as T
}

/** An installation access token (valid ~1 hour) to act on the repos that installed the app. */
export async function installationToken(env: GithubAppEnv, installationId: number, fetchFn: FetchLike = fetch): Promise<string> {
  const jwt = await createAppJwt(env.GITHUB_APP_ID!, env.GITHUB_APP_PRIVATE_KEY!)
  const data = await githubRequest<{ token: string }>(jwt, 'POST', `/app/installations/${installationId}/access_tokens`, {}, fetchFn)
  return data.token
}

/**
 * Exchange the OAuth code GitHub hands back after install, and confirm the signed-in GitHub user can access that
 * installation. This is what proves an Agent Verify user may claim (link) an installation.
 */
export async function userCanAccessInstallation(env: GithubAppEnv, code: string, installationId: number, fetchFn: FetchLike = fetch): Promise<boolean> {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return false
  const res = await fetchFn('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code }),
  })
  const tok = (await res.json().catch(() => ({}))) as { access_token?: string }
  if (!tok.access_token) return false
  for (let page = 1; page <= 5; page++) {
    const data = await githubRequest<{ installations: Array<{ id: number }> }>(tok.access_token, 'GET', `/user/installations?per_page=100&page=${page}`, undefined, fetchFn)
    if (data.installations.some(i => i.id === installationId)) return true
    if (data.installations.length < 100) break
  }
  return false
}
