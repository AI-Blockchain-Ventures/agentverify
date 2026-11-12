/**
 * Agent Verify GitHub App: scans pull requests (check run + one updated comment) and default-branch pushes
 * (repo monitoring: score history + alerts). Also the endpoints the dashboard uses to link an installation.
 */
import type { ScanInput, ScanResult } from '@agentverify/scanner'
import { applyRemediationEntitlement } from './entitlementView'
import { checkScanQuota, hasProFeatures, type BillingEnv, type D1Database } from './billing'
import { createScanResult } from './scanResponse'
import { githubRequest, installationToken, isGithubAppConfigured, userCanAccessInstallation, verifyWebhookSignature, GithubError, type FetchLike, type GithubAppEnv } from './githubApp'
import {
  CHECK_NAME, COMMENT_MARKER, MAX_FILE_BYTES, MAX_TOTAL_BYTES, buildCheckRun, buildComment, combineFiles, countBySeverity,
  looksLikeAgentCode, noAgentFilesCheck, unreadFilesCheck, withUnreadFiles, selectChangedFiles, isScannablePath, filePriority, MAX_FILES, type ChangedFile, type CheckOutput, type RepoFile,
} from './githubPr'
import { sendScanAlerts, type AlertEnv } from './alerts'
import { commentableLines, fixMarker, FIX_MARKER_PREFIX, suggestLineFix } from './autofix'
import { locateLine } from './githubPr'

export type GithubEnv = GithubAppEnv & BillingEnv & AlertEnv

export interface GithubDeps {
  fetchFn?: FetchLike
  scanFn?: (input: ScanInput) => ScanResult
  now?: () => number
}

/** PR/push scans per installation per month. Separate from (and much larger than) the account's own scan quota. */
export const GITHUB_SCANS_BY_PLAN = { unlinked: 50, free: 50, pro: 1000 } as const
const MAX_WEBHOOK_BYTES = 10 * 1024 * 1024
const SITE = 'https://aimodularity.com/agentverify'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' } })
const month = (now: number) => new Date(now).toISOString().slice(0, 7)

type Plan = 'pro' | 'free' | 'unlinked'

interface InstallationRow { installation_id: number; account_login: string; account_type: string; linked_uid: string | null; suspended: number }

async function upsertInstallation(db: D1Database, id: number, login: string, type: string, now: number) {
  await db.prepare(`INSERT INTO github_installations (installation_id, account_login, account_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(installation_id) DO UPDATE SET account_login = excluded.account_login, account_type = excluded.account_type, updated_at = excluded.updated_at`)
    .bind(id, login, type, now, now).run()
}

async function planFor(env: GithubEnv, row: InstallationRow | null): Promise<{ plan: Plan; uid: string | null }> {
  if (!row?.linked_uid) return { plan: 'unlinked', uid: null }
  const quota = await checkScanQuota(env, row.linked_uid)
  return { plan: hasProFeatures(quota.plan) ? 'pro' : 'free', uid: row.linked_uid }
}

/** Counts one scan against the installation's monthly allowance. Returns false when the allowance is used up. */
async function useAllowance(db: D1Database, installationId: number, plan: Plan, now: number): Promise<boolean> {
  const m = month(now)
  const row = await db.prepare('SELECT scan_count FROM github_usage WHERE installation_id = ? AND month = ?').bind(installationId, m).first<{ scan_count: number }>()
  if ((row?.scan_count ?? 0) >= GITHUB_SCANS_BY_PLAN[plan]) return false
  await db.prepare(`INSERT INTO github_usage (installation_id, month, scan_count, updated_at) VALUES (?, ?, 1, ?)
    ON CONFLICT(installation_id, month) DO UPDATE SET scan_count = scan_count + 1, updated_at = excluded.updated_at`).bind(installationId, m, now).run()
  return true
}

async function fetchFiles(token: string, repo: string, sha: string, paths: string[], fetchFn: FetchLike): Promise<{ files: RepoFile[]; notes: string[]; unread: number }> {
  const files: RepoFile[] = []
  let total = 0
  let skipped = 0
  // Download failures are counted apart from size limits: a file we could not read was never checked.
  let unread = 0
  for (const path of paths) {
    let content: string
    try {
      content = await githubRequest<string>(token, 'GET', `/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${sha}`, undefined, fetchFn, 'application/vnd.github.raw+json')
    } catch {
      unread++
      continue
    }
    const size = new TextEncoder().encode(content).length
    if (size > MAX_FILE_BYTES || content.includes('\u0000')) { skipped++; continue }
    if (total + size > MAX_TOTAL_BYTES) { skipped++; continue }
    files.push({ path, content })
    total += size
  }
  const notes = skipped ? [`${skipped} file(s) were skipped (too large, binary, or over the 5MB scan limit).`] : []
  if (unread) notes.push(`${unread} file(s) could not be downloaded from GitHub and were not checked.`)
  return { files, notes, unread }
}

function scanFiles(files: RepoFile[], label: string, plan: Plan, deps: GithubDeps): ScanResult {
  const content = combineFiles(files)
  const run = deps.scanFn ?? createScanResult
  return applyRemediationEntitlement(run({ content, fileName: label, fileSize: content.length, platform: 'GitHub' }), plan === 'pro' ? 'pro' : 'free')
}

async function postCheck(token: string, repo: string, sha: string, out: CheckOutput, fetchFn: FetchLike, detailsUrl?: string) {
  await githubRequest(token, 'POST', `/repos/${repo}/check-runs`, {
    name: CHECK_NAME,
    head_sha: sha,
    status: 'completed',
    conclusion: out.conclusion,
    completed_at: new Date().toISOString(),
    details_url: detailsUrl ?? `${SITE}/developers/`,
    output: { title: out.title, summary: out.summary, annotations: out.annotations },
  }, fetchFn)
}

/** Update our one comment on the PR, or create it. Never creates a new comment when there is nothing to say. */
async function upsertComment(token: string, repo: string, pr: number, body: string, createIfMissing: boolean, fetchFn: FetchLike) {
  let existing: { id: number } | undefined
  for (let page = 1; page <= 5 && !existing; page++) {
    const list = await githubRequest<Array<{ id: number; body?: string; user?: { type?: string } }>>(token, 'GET', `/repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`, undefined, fetchFn)
    existing = list.find(c => c.user?.type === 'Bot' && c.body?.includes(COMMENT_MARKER))
    if (list.length < 100) break
  }
  if (existing) await githubRequest(token, 'PATCH', `/repos/${repo}/issues/comments/${existing.id}`, { body }, fetchFn)
  else if (createIfMissing) await githubRequest(token, 'POST', `/repos/${repo}/issues/${pr}/comments`, { body }, fetchFn)
}

async function recordRepoScan(db: D1Database, row: { installationId: number; repo: string; sha: string; branch: string; trigger: string; pr: number | null; result: ScanResult; fileCount: number; now: number }) {
  const c = countBySeverity(row.result.findings ?? [])
  const codes = [...new Set((row.result.findings ?? []).map(f => f.code))].sort().join(',')
  await db.prepare(`INSERT INTO repo_scans (installation_id, repo_full_name, commit_sha, branch, trigger, pr_number, score, verdict, critical_count, high_count, medium_count, low_count, finding_codes, file_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(row.installationId, row.repo, row.sha, row.branch, row.trigger, row.pr, row.result.riskScore, row.result.verdict, c.critical, c.high, c.medium, c.low, codes, row.fileCount, row.now).run()
}

interface PrPayload {
  action: string
  installation?: { id: number; account?: { login: string; type: string } }
  repository: { full_name: string; owner: { login: string; type: string } }
  pull_request: { number: number; draft?: boolean; head: { sha: string; ref: string } }
}

export async function processPullRequest(payload: PrPayload, env: GithubEnv, deps: GithubDeps = {}): Promise<string> {
  const fetchFn = deps.fetchFn ?? fetch
  const now = (deps.now ?? Date.now)()
  const db = env.BILLING_DB
  const installationId = payload.installation?.id
  if (!db || !installationId) return 'skipped: no database or installation'
  const repo = payload.repository.full_name
  const pr = payload.pull_request.number
  const sha = payload.pull_request.head.sha

  let row = await db.prepare('SELECT * FROM github_installations WHERE installation_id = ?').bind(installationId).first<InstallationRow>()
  if (!row) {
    await upsertInstallation(db, installationId, payload.installation?.account?.login ?? payload.repository.owner.login, payload.installation?.account?.type ?? payload.repository.owner.type, now)
    row = { installation_id: installationId, account_login: payload.repository.owner.login, account_type: payload.repository.owner.type, linked_uid: null, suspended: 0 }
  }
  const { plan } = await planFor(env, row)
  const token = await installationToken(env, installationId, fetchFn)

  const changed: ChangedFile[] = []
  for (let page = 1; page <= 3; page++) {
    const list = await githubRequest<ChangedFile[]>(token, 'GET', `/repos/${repo}/pulls/${pr}/files?per_page=100&page=${page}`, undefined, fetchFn)
    changed.push(...list)
    if (list.length < 100) break
  }
  const paths = selectChangedFiles(changed)
  if (paths.length === 0) {
    await postCheck(token, repo, sha, noAgentFilesCheck(), fetchFn)
    return 'no scannable files'
  }
  const { files, notes, unread } = await fetchFiles(token, repo, sha, paths, fetchFn)
  if (files.length === 0 || !looksLikeAgentCode(files)) {
    // Nothing readable looked like agent code. If some files could not be downloaded, we cannot say that.
    await postCheck(token, repo, sha, unread ? unreadFilesCheck(unread) : noAgentFilesCheck(), fetchFn)
    return unread ? 'files unreadable' : 'no agent files'
  }
  if (!(await useAllowance(db, installationId, plan, now))) {
    await postCheck(token, repo, sha, {
      conclusion: 'neutral',
      title: 'Monthly PR scan limit reached',
      summary: plan === 'pro'
        ? 'This installation used its monthly PR scans. Contact hello@aiblockchainventures.com to raise the limit.'
        : `This installation used its ${GITHUB_SCANS_BY_PLAN[plan]} free PR scans this month. Agent Verify Pro includes ${GITHUB_SCANS_BY_PLAN.pro}: ${SITE}/pricing/`,
      annotations: [],
    }, fetchFn)
    return 'over limit'
  }
  const result = scanFiles(files, `${repo}#${pr}`, plan, deps)
  await recordRepoScan(db, { installationId, repo, sha, branch: payload.pull_request.head.ref, trigger: 'pull_request', pr, result, fileCount: files.length, now })
  await postCheck(token, repo, sha, withUnreadFiles(buildCheckRun(result, files), unread), fetchFn)
  const oneClickFixes = await postFixSuggestions(token, repo, pr, sha, result, files, changed, plan === 'pro', fetchFn)
  const linkUrl = `${SITE}/dashboard/?github_installation=${installationId}`
  const body = buildComment(result, { repo, sha, files, plan, notes, linkUrl, oneClickFixes })
  await upsertComment(token, repo, pr, body, (result.findings ?? []).length > 0, fetchFn)
  return `scanned ${files.length} file(s): score ${result.riskScore}`
}

/** Fixes that can be applied to the exact line, limited to lines this PR changed (GitHub only allows those). */
export function planFixSuggestions(result: ScanResult, files: RepoFile[], changed: ChangedFile[]) {
  const patches = new Map(changed.map(c => [c.filename, commentableLines(c.patch)]))
  const out: Array<{ path: string; line: number; code: string; title: string; body: string }> = []
  const seen = new Set<string>()
  for (const f of result.findings ?? []) {
    if (typeof f.line !== 'number' || f.line <= 0) continue
    const loc = locateLine(files, f.line)
    if (!loc || !patches.get(loc.path)?.has(loc.line)) continue
    const file = files.find(x => x.path === loc.path)
    const text = file?.content.split('\n')[loc.line - 1]
    if (text === undefined) continue
    const fix = suggestLineFix(f.code, text.replace(/\r$/, ''), loc.path, file!.content)
    const key = `${loc.path}:${loc.line}`
    if (!fix || seen.has(key)) continue
    seen.add(key)
    const fence = '```'
    out.push({
      path: loc.path,
      line: loc.line,
      code: f.code,
      title: f.title,
      body: `${fixMarker(f.code, loc.path, loc.line)}\n**Agent Verify: ${f.title}.** ${fix.note}\n\n${fence}suggestion\n${fix.replacement}\n${fence}`,
    })
    if (out.length >= 20) break
  }
  return out
}

async function postFixSuggestions(token: string, repo: string, pr: number, sha: string, result: ScanResult, files: RepoFile[], changed: ChangedFile[], isPro: boolean, fetchFn: FetchLike): Promise<{ posted: number; available: number }> {
  const planned = planFixSuggestions(result, files, changed)
  if (!isPro || planned.length === 0) return { posted: 0, available: planned.length }
  // Skip lines we already suggested on an earlier push.
  const existing = new Set<string>()
  for (let page = 1; page <= 3; page++) {
    const list = await githubRequest<Array<{ body?: string }>>(token, 'GET', `/repos/${repo}/pulls/${pr}/comments?per_page=100&page=${page}`, undefined, fetchFn)
    for (const c of list) {
      const i = c.body?.indexOf(FIX_MARKER_PREFIX) ?? -1
      if (i >= 0) existing.add(c.body!.slice(i, c.body!.indexOf('-->', i) + 3))
    }
    if (list.length < 100) break
  }
  const fresh = planned.filter(p => !existing.has(fixMarker(p.code, p.path, p.line)))
  if (fresh.length === 0) return { posted: 0, available: planned.length }
  try {
    await githubRequest(token, 'POST', `/repos/${repo}/pulls/${pr}/reviews`, {
      commit_id: sha,
      event: 'COMMENT',
      body: `Agent Verify found ${fresh.length} risk${fresh.length === 1 ? '' : 's'} it can fix in one click. Review each suggestion, then click **Commit suggestion**.`,
      comments: fresh.map(p => ({ path: p.path, line: p.line, side: 'RIGHT', body: p.body })),
    }, fetchFn)
    return { posted: fresh.length, available: planned.length }
  } catch (e) {
    console.error('Fix suggestions could not be posted:', e instanceof Error ? e.message : e)
    return { posted: 0, available: planned.length }
  }
}

interface PushPayload {
  ref: string
  after: string
  deleted?: boolean
  installation?: { id: number }
  repository: { full_name: string; default_branch: string; owner: { login: string; type: string } }
}

/** Monitoring: re-scan a repo's agent files when its default branch changes; alert on new serious findings. */
export async function processPush(payload: PushPayload, env: GithubEnv, deps: GithubDeps = {}): Promise<string> {
  const fetchFn = deps.fetchFn ?? fetch
  const now = (deps.now ?? Date.now)()
  const db = env.BILLING_DB
  const installationId = payload.installation?.id
  if (!db || !installationId) return 'skipped: no database or installation'
  if (payload.deleted || payload.ref !== `refs/heads/${payload.repository.default_branch}`) return 'not the default branch'
  const row = await db.prepare('SELECT * FROM github_installations WHERE installation_id = ?').bind(installationId).first<InstallationRow>()
  // Monitoring is an account feature: only installations linked to an Agent Verify account are re-scanned on push.
  if (!row?.linked_uid) return 'not linked'
  const { plan, uid } = await planFor(env, row)
  const repo = payload.repository.full_name
  const sha = payload.after
  const branch = payload.repository.default_branch
  const token = await installationToken(env, installationId, fetchFn)

  const tree = await githubRequest<{ tree: Array<{ path: string; type: string; size?: number }>; truncated?: boolean }>(token, 'GET', `/repos/${repo}/git/trees/${sha}?recursive=1`, undefined, fetchFn)
  const paths = tree.tree
    .filter(t => t.type === 'blob' && isScannablePath(t.path) && (t.size ?? 0) <= MAX_FILE_BYTES)
    .map(t => t.path)
    .sort((a, b) => filePriority(b) - filePriority(a) || a.localeCompare(b))
    .slice(0, MAX_FILES)
  if (paths.length === 0) return 'no scannable files'
  const { files } = await fetchFiles(token, repo, sha, paths, fetchFn)
  if (files.length === 0 || !looksLikeAgentCode(files)) return 'no agent files'
  if (!(await useAllowance(db, installationId, plan, now))) return 'over limit'

  const previous = await db.prepare(`SELECT score, finding_codes FROM repo_scans WHERE repo_full_name = ? AND branch = ? AND trigger = 'push' ORDER BY created_at DESC LIMIT 1`)
    .bind(repo, branch).first<{ score: number; finding_codes: string }>()
  const result = scanFiles(files, `${repo}@${branch}`, plan, deps)
  await recordRepoScan(db, { installationId, repo, sha, branch, trigger: 'push', pr: null, result, fileCount: files.length, now })
  if (uid) await sendScanAlerts(env, { uid, repo, sha, branch, result, previous: previous ?? null, files }, fetchFn)
  return `monitored ${files.length} file(s): score ${result.riskScore}`
}

/** POST /v1/github/webhook */
export async function handleGithubWebhook(request: Request, env: GithubEnv, ctx: { waitUntil(p: Promise<unknown>): void }, deps: GithubDeps = {}): Promise<Response> {
  if (!isGithubAppConfigured(env)) return json({ error: 'GitHub App is not configured' }, 503)
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_WEBHOOK_BYTES) return json({ error: 'Payload too large' }, 413)
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.length > MAX_WEBHOOK_BYTES) return json({ error: 'Payload too large' }, 413)
  if (!(await verifyWebhookSignature(env.GITHUB_WEBHOOK_SECRET!, bytes, request.headers.get('x-hub-signature-256')))) return json({ error: 'Invalid signature' }, 401)

  const event = request.headers.get('x-github-event') ?? ''
  let payload: Record<string, any>
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  const db = env.BILLING_DB
  const now = (deps.now ?? Date.now)()

  if (event === 'ping') return json({ ok: true })
  if (event === 'installation' && db && payload.installation?.id) {
    const inst = payload.installation
    if (payload.action === 'deleted') await db.prepare('DELETE FROM github_installations WHERE installation_id = ?').bind(inst.id).run()
    else {
      await upsertInstallation(db, inst.id, inst.account?.login ?? 'unknown', inst.account?.type ?? 'User', now)
      if (payload.action === 'suspend' || payload.action === 'unsuspend') {
        await db.prepare('UPDATE github_installations SET suspended = ?, updated_at = ? WHERE installation_id = ?').bind(payload.action === 'suspend' ? 1 : 0, now, inst.id).run()
      }
    }
    return json({ ok: true })
  }
  const run = (label: string, work: Promise<string>) => {
    ctx.waitUntil(work.then(r => console.log(`GitHub ${label}: ${r}`)).catch(e => console.error(`GitHub ${label} failed:`, e instanceof GithubError ? `${e.status} ${e.message}` : e instanceof Error ? e.message : e)))
    return json({ ok: true, queued: label }, 202)
  }
  if (event === 'pull_request' && ['opened', 'synchronize', 'reopened', 'ready_for_review'].includes(payload.action) && !payload.pull_request?.draft) {
    return run(`PR ${payload.repository?.full_name}#${payload.pull_request?.number}`, processPullRequest(payload as PrPayload, env, deps))
  }
  if (event === 'push') return run(`push ${payload.repository?.full_name}`, processPush(payload as PushPayload, env, deps))
  return json({ ok: true, ignored: event })
}

/** GET /v1/github/config — what the dashboard needs to show the "Install the GitHub App" button. */
export function githubConfig(env: GithubEnv) {
  const slug = env.GITHUB_APP_SLUG ?? 'agent-verify'
  // clientId is public (it appears in GitHub's own sign-in URL); the client secret never leaves the Worker.
  return { configured: isGithubAppConfigured(env), installUrl: `https://github.com/apps/${slug}/installations/new`, clientId: env.GITHUB_CLIENT_ID ?? null, scansPerMonth: GITHUB_SCANS_BY_PLAN }
}

/** POST /v1/github/link { installationId, code } — signed-in user claims an installation they can access on GitHub. */
export async function linkInstallation(uid: string, body: { installationId?: unknown; code?: unknown }, env: GithubEnv, deps: GithubDeps = {}): Promise<{ status: number; body: unknown }> {
  const db = env.BILLING_DB
  if (!db || !isGithubAppConfigured(env)) return { status: 503, body: { error: 'GitHub App is not configured' } }
  const id = Number(body.installationId)
  if (!Number.isInteger(id) || id <= 0) return { status: 400, body: { error: 'installationId is required' } }
  if (typeof body.code !== 'string' || !body.code) return { status: 400, body: { error: 'code is required (GitHub sign-in)' } }
  const fetchFn = deps.fetchFn ?? fetch
  if (!(await userCanAccessInstallation(env, body.code, id, fetchFn))) return { status: 403, body: { error: 'Your GitHub account cannot access that installation.' } }
  const now = (deps.now ?? Date.now)()
  const existing = await db.prepare('SELECT installation_id FROM github_installations WHERE installation_id = ?').bind(id).first()
  if (!existing) {
    // We may not have seen the install event yet: ask GitHub about it as the app.
    const { createAppJwt } = await import('./githubApp')
    const jwt = await createAppJwt(env.GITHUB_APP_ID!, env.GITHUB_APP_PRIVATE_KEY!)
    const inst = await githubRequest<{ account: { login: string; type: string } }>(jwt, 'GET', `/app/installations/${id}`, undefined, fetchFn)
    await upsertInstallation(db, id, inst.account.login, inst.account.type, now)
  }
  await db.prepare('UPDATE github_installations SET linked_uid = ?, updated_at = ? WHERE installation_id = ?').bind(uid, now, id).run()
  return { status: 200, body: { ok: true, installationId: id } }
}

/** GET /v1/github/installations — the signed-in user's linked installations, with each repo's latest score and history. */
export async function listInstallations(uid: string, env: GithubEnv): Promise<unknown> {
  const db = env.BILLING_DB
  if (!db) return { installations: [], repos: [] }
  const inst = await db.prepare('SELECT installation_id, account_login, account_type, suspended FROM github_installations WHERE linked_uid = ?').bind(uid).all<InstallationRow>()
  const ids = (inst.results ?? []).map(r => r.installation_id)
  if (ids.length === 0) return { installations: [], repos: [] }
  const scans = await db.prepare(`SELECT repo_full_name, branch, trigger, pr_number, commit_sha, score, verdict, critical_count, high_count, medium_count, low_count, created_at
    FROM repo_scans WHERE installation_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT 500`).bind(...ids).all<Record<string, unknown>>()
  const byRepo = new Map<string, Array<Record<string, unknown>>>()
  for (const s of scans.results ?? []) {
    const list = byRepo.get(String(s.repo_full_name)) ?? []
    list.push(s)
    byRepo.set(String(s.repo_full_name), list)
  }
  const m = month(Date.now())
  const usage = await db.prepare(`SELECT installation_id, scan_count FROM github_usage WHERE month = ? AND installation_id IN (${ids.map(() => '?').join(',')})`).bind(m, ...ids).all<{ installation_id: number; scan_count: number }>()
  return {
    installations: (inst.results ?? []).map(r => ({ ...r, scansThisMonth: usage.results?.find(u => u.installation_id === r.installation_id)?.scan_count ?? 0 })),
    repos: [...byRepo.entries()].map(([repo, list]) => ({
      repo,
      latest: list[0],
      history: list.filter(s => s.trigger === 'push').slice(0, 30).reverse().map(s => ({ score: s.score, at: s.created_at, sha: s.commit_sha })),
      recentPrs: list.filter(s => s.trigger === 'pull_request').slice(0, 5),
    })),
  }
}
