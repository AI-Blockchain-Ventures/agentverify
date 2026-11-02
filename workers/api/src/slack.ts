/**
 * Slack app: `/agentverify scan <public GitHub repo URL or pasted code>`, `/agentverify connect`, `/agentverify help`.
 * Slack needs an answer within 3 seconds, so the command replies "Scanning…" at once and posts the result to the
 * response_url when the scan is done.
 */
import type { ScanInput, ScanResult } from '@agentverify/scanner'
import { applyRemediationEntitlement } from './entitlementView'
import { checkScanQuota, hasProFeatures, type BillingEnv } from './billing'
import { createScanResult } from './scanResponse'
import { combineFiles, countBySeverity, filePriority, isScannablePath, looksLikeAgentCode, sortFindings, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, type RepoFile } from './githubPr'
import type { FetchLike } from './githubApp'

export interface SlackEnv extends BillingEnv {
  SLACK_SIGNING_SECRET?: string
  SLACK_CLIENT_ID?: string
  SLACK_CLIENT_SECRET?: string
  /** Optional GitHub token for reading public repos (raises GitHub's rate limit). */
  PUBLIC_GITHUB_TOKEN?: string
  PUBLIC_API_URL?: string
}

export const SLACK_FREE_SCANS = 20
const SITE = 'https://aimodularity.com/agentverify'
const enc = new TextEncoder()

export async function verifySlackSignature(secret: string, body: string, timestamp: string | null, signature: string | null, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!secret || !timestamp || !signature) return false
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > 300) return false
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`v0:${timestamp}:${body}`)))].map(b => b.toString(16).padStart(2, '0')).join('')
  const expected = `v0=${mac}`
  if (expected.length !== signature.length) return false
  let d = 0
  for (let i = 0; i < expected.length; i++) d |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  return d === 0
}

export function parseGithubRepo(text: string): { owner: string; repo: string; path: string } | null {
  const m = text.trim().replace(/^<|>$/g, '').match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})(?:\/tree\/[^/\s]+\/?([^\s]*))?\/?$/)
  if (!m) return null
  return { owner: m[1], repo: m[2].replace(/\.git$/, ''), path: (m[3] ?? '').replace(/\/+$/, '') }
}

/** Read a public GitHub repo's agent files (no clone; text only). */
export async function fetchPublicRepo(env: SlackEnv, owner: string, repo: string, subpath: string, fetchFn: FetchLike): Promise<RepoFile[]> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'agentverify-slack' }
  if (env.PUBLIC_GITHUB_TOKEN) headers.Authorization = `Bearer ${env.PUBLIC_GITHUB_TOKEN}`
  const info = await fetchFn(`https://api.github.com/repos/${owner}/${repo}`, { headers })
  if (!info.ok) throw new Error(info.status === 404 ? 'That repository was not found or is private.' : `GitHub said ${info.status}.`)
  const { default_branch: branch, private: isPrivate } = await info.json() as { default_branch: string; private: boolean }
  if (isPrivate) throw new Error('Private repositories need the GitHub App instead.')
  const treeRes = await fetchFn(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { headers })
  if (!treeRes.ok) throw new Error(`Could not list files (${treeRes.status}).`)
  const tree = (await treeRes.json() as { tree: Array<{ path: string; type: string; size?: number }> }).tree
  const prefix = subpath ? `${subpath}/` : ''
  const paths = tree
    .filter(t => t.type === 'blob' && t.path.startsWith(prefix) && isScannablePath(t.path) && (t.size ?? 0) <= MAX_FILE_BYTES)
    .map(t => t.path)
    .sort((a, b) => filePriority(b) - filePriority(a) || a.localeCompare(b))
    .slice(0, MAX_FILES)
  const files: RepoFile[] = []
  let total = 0
  for (const path of paths) {
    const res = await fetchFn(`https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}`)
    if (!res.ok) continue
    const text = await res.text()
    const size = enc.encode(text).length
    if (total + size > MAX_TOTAL_BYTES || text.includes('\u0000')) continue
    files.push({ path, content: text })
    total += size
  }
  return files
}

const SEV_EMOJI: Record<string, string> = { critical: ':red_circle:', high: ':large_orange_circle:', medium: ':large_yellow_circle:', low: ':white_circle:' }

export function slackResult(result: ScanResult, label: string, pro: boolean, linked: boolean): Record<string, unknown> {
  const findings = sortFindings(result.findings ?? [])
  const c = countBySeverity(findings)
  const verdict = result.verdict === 'VERIFIED' ? ':white_check_mark: VERIFIED' : result.verdict === 'NOT_ASSESSED' ? ':white_circle: NOT ASSESSED' : ':x: NOT VERIFIED'
  const lines = findings.slice(0, 8).map(f => `${SEV_EMOJI[f.severity] ?? ''} *${f.title}* — ${f.whatIsWrong}`.slice(0, 280))
  const more = findings.length > 8 ? `\n…and ${findings.length - 8} more.` : ''
  const locked = findings.filter(f => f.fixLocked).length
  const footer = linked
    ? (locked ? `Fixes for ${locked} finding(s) are in <${SITE}/pricing/|Agent Verify Pro>.` : pro ? 'Open the dashboard for step-by-step fixes.' : '')
    : `Run \`/agentverify connect\` to link this workspace to your Agent Verify account.`
  return {
    response_type: 'in_channel',
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `*Agent Verify — ${label}*\n${verdict} · security score *${result.riskScore}/100* · ${c.critical} critical, ${c.high} high, ${c.medium} medium` } },
      ...(lines.length ? [{ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') + more } }] : [{ type: 'section', text: { type: 'mrkdwn', text: 'No security findings. :tada:' } }]),
      { type: 'context', elements: [{ type: 'mrkdwn', text: `${footer} <${SITE}/|aimodularity.com/agentverify> · automated check, not a guarantee` }] },
    ],
  }
}

const HELP = {
  response_type: 'ephemeral',
  text: [
    '*Agent Verify* — check AI agents for security risks.',
    '• `/agentverify scan https://github.com/owner/repo` — scan a public repo (or a folder link)',
    '• `/agentverify scan <paste code>` — scan a snippet, tool definition or MCP config',
    '• `/agentverify connect` — link this workspace to your Agent Verify account',
    `• Before installing an MCP server: ${SITE}/mcp/`,
  ].join('\n'),
}

export interface SlackDeps { fetchFn?: FetchLike; scanFn?: (input: ScanInput) => ScanResult; now?: () => number }

async function postBack(url: string, body: unknown, fetchFn: FetchLike) {
  if (!/^https:\/\/hooks\.slack\.com\//.test(url)) return
  await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

export async function runSlackScan(env: SlackEnv, teamId: string, text: string, responseUrl: string, deps: SlackDeps = {}): Promise<string> {
  const db = env.BILLING_DB!
  const fetchFn = deps.fetchFn ?? fetch
  const team = await db.prepare('SELECT linked_uid FROM slack_teams WHERE team_id = ?').bind(teamId).first<{ linked_uid: string | null }>()
  const uid = team?.linked_uid ?? null
  let pro = false
  if (uid) pro = hasProFeatures((await checkScanQuota(env, uid)).plan)
  const month = new Date((deps.now ?? Date.now)()).toISOString().slice(0, 7)
  const limit = pro ? 1000 : SLACK_FREE_SCANS
  const used = (await db.prepare('SELECT scan_count FROM slack_usage WHERE team_id = ? AND month = ?').bind(teamId, month).first<{ scan_count: number }>())?.scan_count ?? 0
  if (used >= limit) {
    await postBack(responseUrl, { response_type: 'ephemeral', text: `This workspace used its ${limit} Slack scans this month. Agent Verify Pro includes 1,000: ${SITE}/pricing/` }, fetchFn)
    return 'over limit'
  }
  let files: RepoFile[]
  let label: string
  const repo = parseGithubRepo(text)
  try {
    if (repo) {
      files = await fetchPublicRepo(env, repo.owner, repo.repo, repo.path, fetchFn)
      label = `${repo.owner}/${repo.repo}${repo.path ? `/${repo.path}` : ''}`
      if (files.length === 0) throw new Error('No agent files were found there.')
    } else {
      const code = text.replace(/^```[a-z]*\n?|```$/g, '').trim()
      if (code.length < 20) throw new Error('Paste some agent code, or a public GitHub link.')
      files = [{ path: 'snippet', content: code.slice(0, MAX_TOTAL_BYTES) }]
      label = 'pasted code'
    }
  } catch (e) {
    await postBack(responseUrl, { response_type: 'ephemeral', text: `Could not scan: ${e instanceof Error ? e.message : 'unknown error'}` }, fetchFn)
    return 'fetch failed'
  }
  await db.prepare(`INSERT INTO slack_usage (team_id, month, scan_count) VALUES (?, ?, 1) ON CONFLICT(team_id, month) DO UPDATE SET scan_count = scan_count + 1`).bind(teamId, month).run()
  const content = combineFiles(files)
  const run = deps.scanFn ?? createScanResult
  const result = applyRemediationEntitlement(run({ content, fileName: label, fileSize: content.length, platform: 'Slack' }), pro ? 'pro' : 'free')
  const note = repo && !looksLikeAgentCode(files) ? { response_type: 'ephemeral', text: 'Heads up: this repository does not look like an AI agent, so the results may not mean much.' } : null
  await postBack(responseUrl, slackResult(result, label, pro, Boolean(uid)), fetchFn)
  if (note) await postBack(responseUrl, note, fetchFn)
  return `scanned ${files.length}: ${result.riskScore}`
}

/** POST /v1/slack/command */
export async function handleSlackCommand(request: Request, env: SlackEnv, ctx: { waitUntil(p: Promise<unknown>): void }, deps: SlackDeps = {}): Promise<Response> {
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } })
  if (!env.SLACK_SIGNING_SECRET || !env.BILLING_DB) return json({ error: 'Slack is not configured' }, 503)
  const body = await request.text()
  if (body.length > 40_000) return json({ error: 'Too large' }, 413)
  const ok = await verifySlackSignature(env.SLACK_SIGNING_SECRET, body, request.headers.get('x-slack-request-timestamp'), request.headers.get('x-slack-signature'), deps.now ? Math.floor(deps.now() / 1000) : undefined)
  if (!ok) return json({ error: 'Invalid signature' }, 401)
  const form = new URLSearchParams(body)
  const teamId = form.get('team_id') ?? ''
  const text = (form.get('text') ?? '').trim()
  const responseUrl = form.get('response_url') ?? ''
  if (!/^T[A-Z0-9]{4,20}$/.test(teamId)) return json(HELP)
  await env.BILLING_DB.prepare('INSERT OR IGNORE INTO slack_teams (team_id, team_name, created_at) VALUES (?, ?, ?)').bind(teamId, (form.get('team_domain') ?? teamId).slice(0, 100), Date.now()).run()
  const [cmd, ...rest] = text.split(/\s+/)
  if (!cmd || cmd === 'help') return json(HELP)
  if (cmd === 'connect') {
    const code = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('')
    await env.BILLING_DB.prepare('INSERT INTO slack_link_codes (code, team_id, expires_at) VALUES (?, ?, ?)').bind(code, teamId, Date.now() + 15 * 60_000).run()
    return json({ response_type: 'ephemeral', text: `Link this workspace to your Agent Verify account (expires in 15 minutes): ${SITE}/dashboard/?slack_link=${code}` })
  }
  if (cmd === 'scan') {
    const target = text.slice(cmd.length).trim()
    if (!target) return json({ response_type: 'ephemeral', text: 'Usage: `/agentverify scan https://github.com/owner/repo` or `/agentverify scan <paste code>`' })
    ctx.waitUntil(runSlackScan(env, teamId, target, responseUrl, deps).catch(e => console.error('Slack scan failed:', e instanceof Error ? e.message : e)))
    return json({ response_type: 'ephemeral', text: `:hourglass_flowing_sand: Scanning ${parseGithubRepo(target) ? target.replace(/^<|>$/g, '') : 'your code'}…` })
  }
  void rest
  return json(HELP)
}

/** POST /v1/slack/link { code } — the signed-in dashboard user links the Slack workspace that asked. */
export async function linkSlackTeam(env: SlackEnv, uid: string, code: unknown, now = Date.now()): Promise<{ status: number; body: unknown }> {
  const db = env.BILLING_DB
  if (!db) return { status: 503, body: { error: 'Not available' } }
  if (typeof code !== 'string' || !/^[0-9a-f]{32}$/.test(code)) return { status: 400, body: { error: 'Invalid link' } }
  const row = await db.prepare('SELECT team_id, expires_at FROM slack_link_codes WHERE code = ?').bind(code).first<{ team_id: string; expires_at: number }>()
  await db.prepare('DELETE FROM slack_link_codes WHERE code = ? OR expires_at < ?').bind(code, now).run()
  if (!row || row.expires_at < now) return { status: 410, body: { error: 'That link expired. Run /agentverify connect again.' } }
  await db.prepare('UPDATE slack_teams SET linked_uid = ? WHERE team_id = ?').bind(uid, row.team_id).run()
  const team = await db.prepare('SELECT team_name FROM slack_teams WHERE team_id = ?').bind(row.team_id).first<{ team_name: string }>()
  return { status: 200, body: { ok: true, team: team?.team_name ?? row.team_id } }
}

/** GET /v1/slack/install and /v1/slack/oauth — standard "Add to Slack" flow (no bot token is kept). */
export function slackInstallUrl(env: SlackEnv): string | null {
  if (!env.SLACK_CLIENT_ID) return null
  const redirect = `${env.PUBLIC_API_URL ?? 'https://agentverify-api.agentverify.workers.dev'}/v1/slack/oauth`
  return `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(env.SLACK_CLIENT_ID)}&scope=commands&redirect_uri=${encodeURIComponent(redirect)}`
}

export async function finishSlackOauth(env: SlackEnv, code: string | null, fetchFn: FetchLike = fetch): Promise<{ ok: boolean; team?: string }> {
  if (!code || !env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET || !env.BILLING_DB) return { ok: false }
  const redirect = `${env.PUBLIC_API_URL ?? 'https://agentverify-api.agentverify.workers.dev'}/v1/slack/oauth`
  const res = await fetchFn('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.SLACK_CLIENT_ID, client_secret: env.SLACK_CLIENT_SECRET, redirect_uri: redirect }),
  })
  const data = await res.json().catch(() => ({})) as { ok?: boolean; team?: { id?: string; name?: string } }
  if (!data.ok || !data.team?.id) return { ok: false }
  await env.BILLING_DB.prepare('INSERT INTO slack_teams (team_id, team_name, created_at) VALUES (?, ?, ?) ON CONFLICT(team_id) DO UPDATE SET team_name = excluded.team_name').bind(data.team.id, (data.team.name ?? data.team.id).slice(0, 100), Date.now()).run()
  return { ok: true, team: data.team.name }
}
