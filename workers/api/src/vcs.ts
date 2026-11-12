/**
 * GitLab and Bitbucket merge/pull request scanning. No app registration: a customer connects one project with an
 * access token (stored AES-GCM encrypted) and adds a webhook with the secret we give them. Each MR/PR that changes
 * agent code gets a pass/fail status and one updating comment — the same scan and output as the GitHub App.
 */
import type { ScanInput, ScanResult } from '@agentverify/scanner'
import { applyRemediationEntitlement } from './entitlementView'
import { checkScanQuota, hasProFeatures, type BillingEnv, type D1Database } from './billing'
import { createScanResult } from './scanResponse'
import { buildComment, checkConclusion, combineFiles, countBySeverity, isScannablePath, looksLikeAgentCode, selectChangedFiles, MAX_FILE_BYTES, MAX_TOTAL_BYTES, COMMENT_MARKER, type RepoFile } from './githubPr'
import type { FetchLike } from './githubApp'

export interface VcsEnv extends BillingEnv {
  /** base64 of 32 random bytes. Required to store tokens. */
  TOKEN_ENCRYPTION_KEY?: string
  PUBLIC_API_URL?: string
}

export type Provider = 'gitlab' | 'bitbucket'
export const VCS_SCANS_BY_PLAN = { free: 50, pro: 1000 } as const
const SITE = 'https://aimodularity.com/agentverify'
const enc = new TextEncoder()
const dec = new TextDecoder()

interface Connection { id: string; uid: string; provider: Provider; host: string; project: string; token_enc: string; webhook_secret: string }

// ── Token encryption (AES-GCM) ──

function b64(bytes: Uint8Array): string { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s) }
function unb64(s: string): Uint8Array { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out }

async function aesKey(env: VcsEnv): Promise<CryptoKey | null> {
  if (!env.TOKEN_ENCRYPTION_KEY) return null
  const raw = unb64(env.TOKEN_ENCRYPTION_KEY)
  if (raw.length !== 32) return null
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptToken(env: VcsEnv, token: string): Promise<string | null> {
  const key = await aesKey(env)
  if (!key) return null
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(token)))
  return `v1.${b64(iv)}.${b64(ct)}`
}

export async function decryptToken(env: VcsEnv, stored: string): Promise<string | null> {
  const key = await aesKey(env)
  const [v, iv, ct] = stored.split('.')
  if (!key || v !== 'v1' || !iv || !ct) return null
  try {
    return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) as BufferSource }, key, unb64(ct) as BufferSource))
  } catch {
    return null
  }
}

function randomId(bytes = 16): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

/** Public HTTPS hostnames only (self-hosted GitLab is allowed; IPs and internal names are not). */
export function isAllowedHost(host: string): boolean {
  const h = host.toLowerCase()
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) return false
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/.test(h)) return false
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return false
  return true
}

// ── Provider APIs ──

interface Adapter {
  changedFiles(prId: string): Promise<Array<{ filename: string; status: string }>>
  file(path: string, sha: string): Promise<string | null>
  upsertComment(prId: string, body: string, createIfMissing: boolean): Promise<void>
  setStatus(sha: string, state: 'success' | 'failure' | 'neutral', title: string, url: string): Promise<void>
  fileUrl(path: string, line: number, sha: string): string
}

async function call<T>(fetchFn: FetchLike, url: string, init: RequestInit & { headers: Record<string, string> }, expectText = false): Promise<T> {
  const res = await fetchFn(url, init)
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${new URL(url).pathname} failed: ${res.status}`)
  return (expectText ? await res.text() : res.status === 204 ? null : await res.json()) as T
}

function gitlab(conn: Connection, token: string, fetchFn: FetchLike): Adapter {
  const api = `https://${conn.host}/api/v4/projects/${encodeURIComponent(conn.project)}`
  const h = { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' }
  return {
    async changedFiles(iid) {
      const out: Array<{ filename: string; status: string }> = []
      for (let page = 1; page <= 3; page++) {
        const list = await call<Array<{ new_path: string; deleted_file: boolean }>>(fetchFn, `${api}/merge_requests/${iid}/diffs?per_page=100&page=${page}`, { headers: h })
        out.push(...list.map(d => ({ filename: d.new_path, status: d.deleted_file ? 'removed' : 'modified' })))
        if (list.length < 100) break
      }
      return out
    },
    async file(path, sha) {
      try { return await call<string>(fetchFn, `${api}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(sha)}`, { headers: h }, true) } catch { return null }
    },
    async upsertComment(iid, body, createIfMissing) {
      const notes = await call<Array<{ id: number; body: string; system: boolean }>>(fetchFn, `${api}/merge_requests/${iid}/notes?per_page=100&sort=asc`, { headers: h })
      const mine = notes.find(n => !n.system && n.body.includes(COMMENT_MARKER))
      if (mine) await call(fetchFn, `${api}/merge_requests/${iid}/notes/${mine.id}`, { method: 'PUT', headers: h, body: JSON.stringify({ body }) })
      else if (createIfMissing) await call(fetchFn, `${api}/merge_requests/${iid}/notes`, { method: 'POST', headers: h, body: JSON.stringify({ body }) })
    },
    async setStatus(sha, state, title, url) {
      // Neutral (not checked / not assessed) is GitLab's grey "skipped" state, never a green success.
      const gl = state === 'failure' ? 'failed' : state === 'neutral' ? 'skipped' : 'success'
      await call(fetchFn, `${api}/statuses/${sha}`, { method: 'POST', headers: h, body: JSON.stringify({ state: gl, name: 'Agent Verify', description: title.slice(0, 255), target_url: url }) })
    },
    fileUrl: (path, line, sha) => `https://${conn.host}/${conn.project}/-/blob/${sha}/${path.split('/').map(encodeURIComponent).join('/')}#L${line}`,
  }
}

function bitbucket(conn: Connection, token: string, fetchFn: FetchLike): Adapter {
  const api = `https://api.bitbucket.org/2.0/repositories/${conn.project}`
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  return {
    async changedFiles(id) {
      const out: Array<{ filename: string; status: string }> = []
      let url: string | undefined = `${api}/pullrequests/${id}/diffstat?pagelen=100`
      for (let i = 0; i < 3 && url; i++) {
        const page: { values: Array<{ status: string; new?: { path: string } | null }>; next?: string } = await call(fetchFn, url, { headers: h })
        for (const v of page.values) if (v.new?.path) out.push({ filename: v.new.path, status: v.status === 'removed' ? 'removed' : 'modified' })
        url = page.next
      }
      return out
    },
    async file(path, sha) {
      try { return await call<string>(fetchFn, `${api}/src/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`, { headers: h }, true) } catch { return null }
    },
    async upsertComment(id, body, createIfMissing) {
      const page = await call<{ values: Array<{ id: number; content: { raw: string }; deleted?: boolean }> }>(fetchFn, `${api}/pullrequests/${id}/comments?pagelen=100`, { headers: h })
      const mine = page.values.find(c => !c.deleted && c.content?.raw?.includes(COMMENT_MARKER))
      const payload = JSON.stringify({ content: { raw: body } })
      if (mine) await call(fetchFn, `${api}/pullrequests/${id}/comments/${mine.id}`, { method: 'PUT', headers: h, body: payload })
      else if (createIfMissing) await call(fetchFn, `${api}/pullrequests/${id}/comments`, { method: 'POST', headers: h, body: payload })
    },
    async setStatus(sha, state, title, url) {
      await call(fetchFn, `${api}/commit/${sha}/statuses/build`, { method: 'POST', headers: h, body: JSON.stringify({ key: 'agentverify', name: 'Agent Verify', state: state === 'failure' ? 'FAILED' : state === 'neutral' ? 'STOPPED' : 'SUCCESSFUL', description: title.slice(0, 255), url }) })
    },
    fileUrl: (path, line, sha) => `https://bitbucket.org/${conn.project}/src/${sha}/${path.split('/').map(encodeURIComponent).join('/')}#lines-${line}`,
  }
}

function adapterFor(conn: Connection, token: string, fetchFn: FetchLike): Adapter {
  return conn.provider === 'gitlab' ? gitlab(conn, token, fetchFn) : bitbucket(conn, token, fetchFn)
}

// ── Connections ──

export async function createConnection(env: VcsEnv, uid: string, body: { provider?: unknown; host?: unknown; project?: unknown; token?: unknown }, fetchFn: FetchLike = fetch): Promise<{ status: number; body: unknown }> {
  const db = env.BILLING_DB
  if (!db || !env.TOKEN_ENCRYPTION_KEY) return { status: 503, body: { error: 'GitLab and Bitbucket connections are not available yet.' } }
  const provider = body.provider === 'gitlab' || body.provider === 'bitbucket' ? body.provider : null
  if (!provider) return { status: 400, body: { error: 'provider must be gitlab or bitbucket' } }
  const host = provider === 'bitbucket' ? 'bitbucket.org' : (typeof body.host === 'string' && body.host.trim() ? body.host.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') : 'gitlab.com')
  if (!isAllowedHost(host)) return { status: 400, body: { error: 'Use the public HTTPS hostname of your GitLab server.' } }
  const project = typeof body.project === 'string' ? body.project.trim().replace(/^\/+|\/+$/g, '').replace(/\.git$/, '') : ''
  if (!/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+){1,5}$/.test(project) || (provider === 'bitbucket' && project.split('/').length !== 2)) {
    return { status: 400, body: { error: provider === 'bitbucket' ? 'Use workspace/repository.' : 'Use the project path, e.g. group/project.' } }
  }
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  if (token.length < 10 || token.length > 500) return { status: 400, body: { error: 'Paste the access token.' } }
  // Check the token can see the project before storing anything.
  const probe = provider === 'gitlab' ? `https://${host}/api/v4/projects/${encodeURIComponent(project)}` : `https://api.bitbucket.org/2.0/repositories/${project}`
  const headers: Record<string, string> = provider === 'gitlab' ? { 'PRIVATE-TOKEN': token } : { Authorization: `Bearer ${token}` }
  try {
    const res = await fetchFn(probe, { headers })
    if (!res.ok) return { status: 400, body: { error: `That token cannot open ${project} (${res.status}). Check the project path and the token's access.` } }
  } catch {
    return { status: 400, body: { error: `Could not reach ${host}.` } }
  }
  const tokenEnc = await encryptToken(env, token)
  if (!tokenEnc) return { status: 503, body: { error: 'Token storage is not configured.' } }
  const id = randomId(12)
  const secret = randomId(24)
  await db.prepare('INSERT INTO vcs_connections (id, uid, provider, host, project, token_enc, webhook_secret, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, uid, provider, host, project, tokenEnc, secret, Date.now()).run()
  const base = env.PUBLIC_API_URL ?? 'https://agentverify-api.agentverify.workers.dev'
  return { status: 200, body: { id, provider, host, project, webhookUrl: `${base}/v1/vcs/webhook/${id}`, webhookSecret: secret } }
}

export async function listConnections(db: D1Database, uid: string) {
  const rows = (await db.prepare('SELECT id, provider, host, project, created_at FROM vcs_connections WHERE uid = ? ORDER BY created_at DESC').bind(uid).all<Record<string, unknown>>()).results ?? []
  return { connections: rows }
}

export async function deleteConnection(db: D1Database, uid: string, id: string) {
  await db.prepare('DELETE FROM vcs_connections WHERE id = ? AND uid = ?').bind(id, uid).run()
  return { ok: true }
}

// ── Webhook ──

async function hmacHex(secret: string, body: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, body as BufferSource))].map(b => b.toString(16).padStart(2, '0')).join('')
}

export interface VcsDeps { fetchFn?: FetchLike; scanFn?: (input: ScanInput) => ScanResult; now?: () => number }

interface MrEvent { id: string; sha: string; title: string; url: string }

function parseEvent(provider: Provider, event: string, payload: Record<string, any>): MrEvent | null {
  if (provider === 'gitlab') {
    if (payload.object_kind !== 'merge_request') return null
    const a = payload.object_attributes ?? {}
    if (!['open', 'reopen', 'update'].includes(a.action) || a.draft || a.work_in_progress) return null
    if (a.action === 'update' && !a.oldrev) return null // title/label edits, not new commits
    return { id: String(a.iid), sha: String(a.last_commit?.id ?? ''), title: String(a.title ?? ''), url: String(a.url ?? '') }
  }
  if (!['pullrequest:created', 'pullrequest:updated'].includes(event)) return null
  const pr = payload.pullrequest ?? {}
  if (pr.draft) return null
  return { id: String(pr.id), sha: String(pr.source?.commit?.hash ?? ''), title: String(pr.title ?? ''), url: String(pr.links?.html?.href ?? '') }
}

export async function processMergeRequest(env: VcsEnv, conn: Connection, mr: MrEvent, deps: VcsDeps = {}): Promise<string> {
  const db = env.BILLING_DB!
  const fetchFn = deps.fetchFn ?? fetch
  const now = (deps.now ?? Date.now)()
  const token = await decryptToken(env, conn.token_enc)
  if (!token) return 'token unavailable'
  if (!/^[0-9a-f]{7,64}$/i.test(mr.sha)) return 'no commit'
  const a = adapterFor(conn, token, fetchFn)
  const quota = await checkScanQuota(env, conn.uid)
  const pro = hasProFeatures(quota.plan)
  const paths = selectChangedFiles(await a.changedFiles(mr.id))
  const files: RepoFile[] = []
  let total = 0
  // Files that could not be downloaded were never checked, so they must not end in a green status.
  let unread = 0
  for (const path of paths) {
    if (!isScannablePath(path)) continue
    const text = await a.file(path, mr.sha)
    if (text === null) { unread++; continue }
    const size = enc.encode(text).length
    if (size > MAX_FILE_BYTES || total + size > MAX_TOTAL_BYTES || text.includes('\u0000')) continue
    files.push({ path, content: text })
    total += size
  }
  const detailsUrl = `${SITE}/developers/`
  if (files.length === 0 || !looksLikeAgentCode(files)) {
    if (unread > 0) {
      await a.setStatus(mr.sha, 'neutral', `Not checked: ${unread} changed file(s) could not be read. Push again to retry.`, detailsUrl)
      return 'files unreadable'
    }
    await a.setStatus(mr.sha, 'success', 'No agent files changed', detailsUrl)
    return 'no agent files'
  }
  const month = new Date(now).toISOString().slice(0, 7)
  const used = (await db.prepare('SELECT scan_count FROM vcs_usage WHERE connection_id = ? AND month = ?').bind(conn.id, month).first<{ scan_count: number }>())?.scan_count ?? 0
  const limit = pro ? VCS_SCANS_BY_PLAN.pro : VCS_SCANS_BY_PLAN.free
  if (used >= limit) {
    await a.setStatus(mr.sha, 'neutral', `Not checked: monthly scan limit reached (${limit}). See ${SITE}/pricing/`, `${SITE}/pricing/`)
    return 'over limit'
  }
  await db.prepare(`INSERT INTO vcs_usage (connection_id, month, scan_count, updated_at) VALUES (?, ?, 1, ?)
    ON CONFLICT(connection_id, month) DO UPDATE SET scan_count = scan_count + 1, updated_at = excluded.updated_at`).bind(conn.id, month, now).run()
  const content = combineFiles(files)
  const run = deps.scanFn ?? createScanResult
  const result = applyRemediationEntitlement(run({ content, fileName: `${conn.project}!${mr.id}`, fileSize: content.length, platform: conn.provider === 'gitlab' ? 'GitLab' : 'Bitbucket' }), pro ? 'pro' : 'free')
  const c = countBySeverity(result.findings ?? [])
  const checked = checkConclusion(result)
  const conclusion = checked === 'success' && unread > 0 ? 'neutral' : checked
  const summary = checked === 'neutral'
    ? 'Not assessed: not enough agent code to check'
    : `${c.critical} critical, ${c.high} high, ${c.medium} medium · score ${result.riskScore}/100${unread ? ` · ${unread} file(s) not read` : ''}`
  await a.setStatus(mr.sha, conclusion, summary, detailsUrl)
  const body = buildComment(result, { repo: conn.project, sha: mr.sha, files, plan: pro ? 'pro' : 'free', fileUrl: (p, l) => a.fileUrl(p, l, mr.sha) })
  await a.upsertComment(mr.id, body, (result.findings ?? []).length > 0)
  return `scanned ${files.length} file(s): score ${result.riskScore}`
}

/** POST /v1/vcs/webhook/:id */
export async function handleVcsWebhook(request: Request, env: VcsEnv, id: string, ctx: { waitUntil(p: Promise<unknown>): void }, deps: VcsDeps = {}): Promise<Response> {
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } })
  if (!env.BILLING_DB || !/^[0-9a-f]{24}$/.test(id)) return json({ error: 'Not found' }, 404)
  const conn = await env.BILLING_DB.prepare('SELECT * FROM vcs_connections WHERE id = ?').bind(id).first<Connection>()
  if (!conn) return json({ error: 'Not found' }, 404)
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.length > 5 * 1024 * 1024) return json({ error: 'Payload too large' }, 413)
  let ok = false
  if (conn.provider === 'gitlab') ok = timingSafeEqual(request.headers.get('x-gitlab-token') ?? '', conn.webhook_secret)
  else {
    const sig = request.headers.get('x-hub-signature') ?? ''
    ok = sig.startsWith('sha256=') && timingSafeEqual(sig, `sha256=${await hmacHex(conn.webhook_secret, bytes)}`)
  }
  if (!ok) return json({ error: 'Invalid signature' }, 401)
  let payload: Record<string, any>
  try { payload = JSON.parse(dec.decode(bytes)) } catch { return json({ error: 'Invalid JSON' }, 400) }
  const event = request.headers.get('x-event-key') ?? request.headers.get('x-gitlab-event') ?? ''
  const mr = parseEvent(conn.provider, event, payload)
  if (!mr) return json({ ok: true, ignored: true })
  ctx.waitUntil(processMergeRequest(env, conn, mr, deps).then(r => console.log(`${conn.provider} ${conn.project}!${mr.id}: ${r}`)).catch(e => console.error(`${conn.provider} scan failed:`, e instanceof Error ? e.message : e)))
  return json({ ok: true, queued: true }, 202)
}
