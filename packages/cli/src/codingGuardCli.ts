/**
 * `agentverify hook <claude-code|cursor>` — called by the coding agent before each action; reads the action
 * from stdin and prints the decision. Must be fast and must never break the developer's session: anything it
 * cannot understand is let through to the agent's own permission prompts.
 *
 * `agentverify protect [claude-code|cursor] [--global]` — one-time setup that installs those hooks.
 *
 * `agentverify log [--all] [-n N] [--json] [--path]` — shows the guard's recent decisions, saved on this computer.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync, unlinkSync, renameSync } from 'fs'
import { createHash } from 'crypto'
import { spawnSync } from 'child_process'
import { homedir, hostname } from 'os'
import { dirname, join, resolve, basename } from 'path'
import { CURSOR_WRITE_TOOLS, wantsRemoteApproval, buildPolicy, claudeCodeResponse, combine, cursorResponse, evaluate, forUnattended, fromClaudeCode, fromCursor, previewAction, type AgentAction, type CompanyPolicyFile, type PolicyFile, type Verdict } from './codingGuard'

export type HookTarget = 'claude-code' | 'cursor'
const API_BASE = (process.env.AGENTVERIFY_API_URL ?? 'https://agentverify-api.agentverify.workers.dev').replace(/\/v1\/scan$/, '')
const HOME_DIR = join(homedir(), '.agentverify')
const QUEUE = join(HOME_DIR, 'activity-queue.jsonl')
const FLUSH_AT = 25

// ------------------------------------------------------------------------------------------------
// Local log: every decision is kept on this computer, account or not. Read it with `agentverify log`.
// ------------------------------------------------------------------------------------------------

/** One guard decision, as saved locally and as sent to the dashboard. argsPreview is already masked. */
export interface GuardLogEvent { agent: string; tool: string; decision: string; reason: string; argsPreview: string; at: string }

export const LOCAL_LOG = join(HOME_DIR, 'guard-log.jsonl')
/** When the log passes this size it becomes guard-log.old.jsonl (replacing any older one) and a new log starts. */
export const LOCAL_LOG_MAX_BYTES = 1_000_000
const oldLogPath = (path: string) => path.replace(/\.jsonl$/, '') + '.old.jsonl'

/** Adds decisions to the local log. Never throws: the log must never block or slow down the agent. */
export function appendLocalLog(events: GuardLogEvent[], opts: { path?: string; maxBytes?: number } = {}): void {
  if (process.env.AGENTVERIFY_LOCAL_LOG === 'off' || !events.length) return
  const path = opts.path ?? LOCAL_LOG
  try {
    mkdirSync(dirname(path), { recursive: true })
    if (existsSync(path) && statSync(path).size > (opts.maxBytes ?? LOCAL_LOG_MAX_BYTES)) renameSync(path, oldLogPath(path))
    appendFileSync(path, events.map(e => JSON.stringify(e)).join('\n') + '\n')
  } catch { /* best effort */ }
}

/** Reads the local log, oldest first (the rotated file, then the current one). Damaged lines are skipped. */
export function readLocalLog(path: string = LOCAL_LOG): GuardLogEvent[] {
  const out: GuardLogEvent[] = []
  for (const p of [oldLogPath(path), path]) {
    if (!existsSync(p)) continue
    let text = ''
    try { text = readFileSync(p, 'utf8') } catch { continue }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const e = JSON.parse(line)
        if (e && typeof e.decision === 'string' && typeof e.at === 'string') out.push(e)
      } catch { /* skip a damaged line */ }
    }
  }
  return out
}

const DECISION_LABEL: Record<string, string> = { blocked: 'Blocked', asked: 'Asked you', allowed: 'Allowed', approved: 'Approved by a person', rejected: 'Denied by a person' }

/** Plain-English lines for `agentverify log`: newest first, allowed actions only with --all. */
export function formatLocalLog(events: GuardLogEvent[], opts: { all?: boolean; limit?: number; logPath?: string; time?: (iso: string) => string } = {}): string[] {
  const time = opts.time ?? (iso => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  })
  const limit = opts.limit ?? 20
  const where = opts.logPath ?? LOCAL_LOG
  if (!events.length) {
    return [
      'No guard decisions saved on this computer yet.',
      'Run "npx agentverify@latest protect" in a project, then use Claude Code or Cursor as usual.',
    ]
  }
  const shown = events.filter(e => opts.all || e.decision !== 'allowed')
  const recent = shown.slice(-limit).reverse()
  const counts = events.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.decision]: (acc[e.decision] ?? 0) + 1 }), {})
  const summary = ['blocked', 'asked', 'rejected', 'approved', 'allowed'].filter(k => counts[k]).map(k => `${counts[k]} ${k}`).join(' · ')
  const lines = [`Agent Verify guard log (${summary}) — ${where}`, '']
  if (!recent.length) {
    lines.push('Nothing was blocked or asked about. Everything was allowed.', 'Show allowed actions too: agentverify log --all')
    return lines
  }
  for (const e of recent) {
    lines.push(`${time(e.at)}  ${DECISION_LABEL[e.decision] ?? e.decision}  ${e.agent}`)
    if (e.argsPreview) lines.push(`    ${e.argsPreview}`)
    if (e.reason) lines.push(`    ${e.reason}`)
    lines.push('')
  }
  const hidden = shown.length - recent.length
  if (hidden > 0) lines.push(`${hidden} older ${hidden === 1 ? 'entry' : 'entries'} not shown. Show more: agentverify log -n ${Math.min(shown.length, 500)}`)
  if (!opts.all && counts.allowed) lines.push(`Show allowed actions too: agentverify log --all`)
  return lines
}

/** `agentverify log`: print the local guard log. */
export function runLog(argv: string[], print: (s: string) => void, opts: { path?: string } = {}): number {
  const path = opts.path ?? LOCAL_LOG
  let all = false, json = false, limit = 20
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--all' || a === '-a') all = true
    else if (a === '--json') json = true
    else if (a === '--path') { print(path); return 0 }
    else if (a === '-n' || a === '--limit') {
      const n = Number(argv[++i])
      if (!Number.isInteger(n) || n < 1) { print('Usage: agentverify log [--all] [-n <number>] [--json] [--path]'); return 1 }
      limit = Math.min(n, 5000)
    } else if (a === '--help' || a === '-h') {
      print('Usage: agentverify log [--all] [-n <number>] [--json] [--path]')
      print('  Shows what the guard blocked or asked about on this computer, newest first.')
      print('  --all      include allowed actions     -n <number>  how many to show (default 20)')
      print('  --json     one JSON object per line     --path       print where the log is saved')
      print('  The log never leaves this computer. Turn it off with AGENTVERIFY_LOCAL_LOG=off.')
      return 0
    } else { print(`Unknown option: ${a}`); print('Usage: agentverify log [--all] [-n <number>] [--json] [--path]'); return 1 }
  }
  const events = readLocalLog(path)
  if (json) {
    for (const e of events.filter(e => all || e.decision !== 'allowed').slice(-limit)) print(JSON.stringify(e))
    return 0
  }
  for (const line of formatLocalLog(events, { all, limit, logPath: path })) print(line)
  return 0
}

async function readStdin(timeoutMs = 3000): Promise<string> {
  return new Promise(resolveRead => {
    let data = ''
    const done = () => resolveRead(data)
    const timer = setTimeout(done, timeoutMs)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => { data += chunk; if (data.length > 1_000_000) { clearTimeout(timer); done() } })
    process.stdin.on('end', () => { clearTimeout(timer); done() })
    process.stdin.on('error', () => { clearTimeout(timer); done() })
  })
}

/** The team policy: `.agentverify/policy.json` in the project (searched upward), else `~/.agentverify/policy.json`. */
export function loadPolicyFile(startDir: string): { file: PolicyFile | null; path: string | null; problems: string[] } {
  const candidates: string[] = []
  let dir = resolve(startDir)
  for (let i = 0; i < 25; i++) {
    candidates.push(join(dir, '.agentverify', 'policy.json'))
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  candidates.push(join(HOME_DIR, 'policy.json'))
  for (const p of candidates) {
    if (!existsSync(p)) continue
    try { return { file: JSON.parse(readFileSync(p, 'utf8')) as PolicyFile, path: p, problems: [] } } catch (e) {
      return { file: null, path: p, problems: [`${p} is not valid JSON, so only the built-in rules apply`] }
    }
  }
  return { file: null, path: null, problems: [] }
}

const COMPANY_CACHE = join(HOME_DIR, 'company-rules.json')
const COMPANY_TTL_MS = 5 * 60_000

/**
 * The company's rules from the dashboard, downloaded with the developer's API key and cached for 5 minutes so the
 * hook stays fast. If the download fails, the last copy for this key is used; with no copy, the built-in and
 * project rules still apply.
 */
export async function loadCompanyPolicy(opts: { now?: number; fetchImpl?: typeof fetch; cachePath?: string } = {}): Promise<{ policy: CompanyPolicyFile | null; problems: string[]; from: 'none' | 'cache' | 'download' | 'stale-cache' }> {
  const key = process.env.AGENTVERIFY_API_KEY
  if (!key) return { policy: null, problems: [], from: 'none' }
  const now = opts.now ?? Date.now()
  const cachePath = opts.cachePath ?? COMPANY_CACHE
  const keyId = createHash('sha256').update(key).digest('hex').slice(0, 16)
  let cached: { keyId?: string; fetchedAt?: number; policy?: CompanyPolicyFile | null } | null = null
  try { cached = JSON.parse(readFileSync(cachePath, 'utf8')) } catch { /* no cache yet */ }
  const mine = cached && cached.keyId === keyId ? cached : null
  if (mine && typeof mine.fetchedAt === 'number' && now - mine.fetchedAt >= 0 && now - mine.fetchedAt < COMPANY_TTL_MS) return { policy: mine.policy ?? null, problems: [], from: 'cache' }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 1500)
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${API_BASE}/v1/guard/policy`, { signal: ctrl.signal, headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'agentverify-coding-guard/2.1.5' } })
    if (res.ok) {
      const body = (await res.json()) as { policy?: CompanyPolicyFile | null }
      const policy = body && typeof body.policy === 'object' ? body.policy ?? null : null
      try {
        mkdirSync(dirname(cachePath), { recursive: true })
        const tmp = `${cachePath}.${process.pid}.tmp`
        writeFileSync(tmp, JSON.stringify({ keyId, fetchedAt: now, policy }))
        renameSync(tmp, cachePath)
      } catch { /* a read-only home folder just means no cache */ }
      return { policy, problems: [], from: 'download' }
    }
    if (res.status === 401 || res.status === 403) return { policy: null, problems: ['AGENTVERIFY_API_KEY was not accepted, so company rules were not loaded'], from: 'none' }
  } catch { /* offline or slow: fall back below */ } finally { clearTimeout(timer) }
  if (mine) return { policy: mine.policy ?? null, problems: ['could not reach Agent Verify; using the last saved company rules'], from: 'stale-cache' }
  return { policy: null, problems: ['could not reach Agent Verify to load company rules'], from: 'none' }
}

export const APPROVAL_WAIT_SECONDS = 120

/**
 * Asks a person on the Agent Verify dashboard and waits for Approve or Deny (Slack/email ping goes out too).
 * Anything other than a clear "approved" (denied, timed out, offline, no key) means the action is blocked.
 */
export async function requestRemoteApproval(req: { agent: string; tool: string; preview: string; reason: string; rule: string | null }, opts: { fetchImpl?: typeof fetch; pollMs?: number; waitSeconds?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {}): Promise<'approved' | 'denied' | 'expired' | 'unavailable'> {
  const key = process.env.AGENTVERIFY_API_KEY
  if (!key) return 'unavailable'
  const f = opts.fetchImpl ?? fetch
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? (ms => new Promise(r => setTimeout(r, ms)))
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'User-Agent': 'agentverify-coding-guard/2.1.5' }
  const call = async (path: string, init: RequestInit = {}) => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 5000)
    try { return await f(`${API_BASE}${path}`, { ...init, headers, signal: ctrl.signal }) } finally { clearTimeout(t) }
  }
  const wait = opts.waitSeconds ?? APPROVAL_WAIT_SECONDS
  let id: string
  try {
    const res = await call('/v1/guard/approvals', { method: 'POST', body: JSON.stringify({ ...req, rule: req.rule ?? '', waitSeconds: wait }) })
    if (!res.ok) return 'unavailable'
    id = String(((await res.json()) as { id?: string }).id ?? '')
    if (!id) return 'unavailable'
  } catch { return 'unavailable' }
  process.stderr.write(`Agent Verify: waiting up to ${Math.round(wait / 60)} min for a person to approve this on the dashboard…\n`)
  const deadline = now() + (wait + 5) * 1000
  while (now() < deadline) {
    await sleep(opts.pollMs ?? 2000)
    try {
      const res = await call(`/v1/guard/approvals/${encodeURIComponent(id)}`)
      if (!res.ok) continue
      const status = ((await res.json()) as { status?: string }).status
      if (status === 'approved' || status === 'denied' || status === 'expired') return status
    } catch { /* keep waiting until the deadline */ }
  }
  return 'expired'
}

const LOG_DECISION: Record<Verdict['decision'], string> = { allow: 'allowed', deny: 'blocked', ask: 'asked' }

/** Activity goes to the Agent Guard dashboard when an API key is set. Allowed actions are batched to stay fast. */
/** Which coding agent this hook is running for. Cursor also runs Claude Code's hooks, so check the input, not only the target. */
let startedByCursor = false
function agentApp(target: HookTarget): string {
  return target === 'cursor' || startedByCursor ? 'Cursor' : 'Claude Code'
}

async function logActivity(target: HookTarget, actions: AgentAction[], verdict: Verdict, project: string, decisionOverride?: string): Promise<void> {
  const agent = `${agentApp(target)} · ${project} · ${hostname().slice(0, 40)}`
  // A write and its contents are one action in the log.
  const events: GuardLogEvent[] = actions.filter(a => a.kind !== 'code' || actions.length === 1).map(a => ({ agent, tool: a.agentTool ?? a.kind, decision: decisionOverride ?? LOG_DECISION[verdict.decision], reason: verdict.rule ? `${verdict.reason} (rule ${verdict.rule})` : verdict.reason, argsPreview: previewAction(a), at: new Date().toISOString() }))
  // Always kept on this computer (no account needed); `agentverify log` reads it.
  appendLocalLog(events)
  const key = process.env.AGENTVERIFY_API_KEY
  if (!key || process.env.AGENTVERIFY_GUARD_LOG === 'off') return
  let batch: GuardLogEvent[] = events
  try {
    mkdirSync(HOME_DIR, { recursive: true })
    if (verdict.decision === 'allow') {
      appendFileSync(QUEUE, events.map(e => JSON.stringify(e)).join('\n') + '\n')
      const lines = readFileSync(QUEUE, 'utf8').split('\n').filter(Boolean)
      if (lines.length < FLUSH_AT) return
      batch = lines.map(l => JSON.parse(l))
    } else if (existsSync(QUEUE) && statSync(QUEUE).size > 0) {
      batch = [...readFileSync(QUEUE, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)), ...events]
    }
  } catch { /* the log is best effort; never block the agent over it */ }
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 1500)
    const res = await fetch(`${API_BASE}/v1/guard/events`, { method: 'POST', signal: ctrl.signal, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'User-Agent': 'agentverify-coding-guard/2.1.5' }, body: JSON.stringify({ events: batch.slice(-100) }) })
    clearTimeout(t)
    if (res.ok && existsSync(QUEUE)) unlinkSync(QUEUE)
  } catch { /* offline: the queue is kept and sent next time */ }
}

export async function runHook(target: string | undefined): Promise<number> {
  if (target !== 'claude-code' && target !== 'cursor') {
    process.stderr.write('Usage: agentverify hook <claude-code|cursor>   (called by the coding agent; reads the action on stdin)\n')
    return 1
  }
  let input: Record<string, unknown>
  try { input = JSON.parse(await readStdin()) } catch {
    // Cursor treats a missing answer as a block, so answer "allow" like an unguarded run would.
    if (target === 'cursor') process.stdout.write(JSON.stringify({ permission: 'allow' }))
    return 0
  }
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd()
  startedByCursor = typeof input.cursor_version === 'string'
  const { file } = loadPolicyFile(cwd)
  const company = await loadCompanyPolicy()
  const { policy } = buildPolicy(file, company.policy)
  const actions = target === 'cursor' ? fromCursor(input) : fromClaudeCode(input)
  if (!actions.length) {
    if (target === 'cursor') process.stdout.write(cursorResponse({ decision: 'allow', rule: null, reason: '' }, String(input.hook_event_name ?? '')))
    return 0
  }
  let verdict = combine(actions.map(a => evaluate(a, policy)))
  const permissionMode = typeof input.permission_mode === 'string' ? input.permission_mode : undefined
  const event = String(input.hook_event_name ?? '')
  const agentLabel = `${agentApp(target)} · ${basename(cwd)} · ${hostname().slice(0, 40)}`
  // Nobody at the screen, and the rules say a person decides on the dashboard: ask there and wait.
  if (wantsRemoteApproval(verdict, policy, { target, permissionMode, event })) {
    const main = actions.find(a => a.kind !== 'code') ?? actions[0]
    const outcome = await requestRemoteApproval({ agent: agentLabel, tool: main.agentTool ?? main.kind, preview: previewAction(main), reason: verdict.reason, rule: verdict.rule })
    const base = `Agent Verify: ${verdict.reason}${verdict.rule ? ` (rule ${verdict.rule})` : ''}.`
    const approved = outcome === 'approved'
    const why = approved ? `${base} A person approved this on the Agent Verify dashboard.`
      : outcome === 'denied' ? `${base} A person denied this on the Agent Verify dashboard. Do not try another way to do this.`
      : outcome === 'expired' ? `${base} Nobody approved it in time, so it was blocked. Ask the user.`
      : `${base} It needs a person's OK and the Agent Verify dashboard could not be reached, so it was blocked. Ask the user.`
    if (target === 'cursor') process.stdout.write(JSON.stringify(event === 'beforeReadFile' ? { permission: approved ? 'allow' : 'deny', ...(approved ? {} : { user_message: why }) } : { permission: approved ? 'allow' : 'deny', user_message: why, agent_message: why }))
    else process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: approved ? 'allow' : 'deny', permissionDecisionReason: why } }))
    if (!(target === 'claude-code' && approved && insideCursorWithItsOwnHooks(input, cwd))) {
      await logActivity(target, actions, { decision: approved ? 'allow' : 'deny', rule: verdict.rule, reason: why.replace(/^Agent Verify: /, '') }, basename(cwd), approved ? 'approved' : outcome === 'denied' ? 'rejected' : 'blocked')
    }
    return 0
  }
  if (target === 'claude-code') verdict = forUnattended(verdict, permissionMode, policy)
  const isCursorAfterEvent = target === 'cursor' && String(input.hook_event_name).startsWith('after')
  if (target === 'cursor') {
    if (!isCursorAfterEvent) process.stdout.write(cursorResponse(verdict, String(input.hook_event_name ?? '')))
  } else {
    const out = claudeCodeResponse(verdict)
    if (out) process.stdout.write(out)
  }
  // Cursor also runs Claude Code's project hooks. When Cursor's own hooks are installed too, they record what they see,
  // so this hook stays quiet to avoid recording an action twice. But a block here stops the action before Cursor's
  // own read/shell hooks run, so this hook must record its own blocks (file edits excepted: Cursor's preToolUse hook
  // checks those too and records its blocks). The answer above still counts: the strictest one wins.
  if (target === 'claude-code' && insideCursorWithItsOwnHooks(input, cwd) && (verdict.decision !== 'deny' || actions.some(a => a.kind === 'write'))) return 0
  // A Cursor edit is recorded once, by afterFileEdit; preToolUse only records the edits it stopped.
  if (target === 'cursor' && input.hook_event_name === 'preToolUse' && verdict.decision !== 'deny') return 0
  await logActivity(target, actions, verdict, basename(cwd))
  return 0
}

// ------------------------------------------------------------------------------------------------
// protect: install the hooks
// ------------------------------------------------------------------------------------------------

function readJson(path: string): Record<string, any> {
  if (!existsSync(path)) return {}
  const text = readFileSync(path, 'utf8').trim()
  if (!text) return {}
  return JSON.parse(text)
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
}

/** True when an `agentverify` command is on the PATH (a global install). */
export function hasGlobalInstall(pathEnv = process.env.PATH ?? ''): boolean {
  const names = process.platform === 'win32' ? ['agentverify.cmd', 'agentverify.exe', 'agentverify.ps1', 'agentverify'] : ['agentverify']
  return pathEnv.split(process.platform === 'win32' ? ';' : ':').some(dir => dir && names.some(n => existsSync(join(dir, n))))
}

/** The version the `agentverify` found on the PATH reports, or null (none, or it didn't answer in time). */
export function installedVersion(run: (cmd: string) => string | null = cmd => {
  const r = spawnSync(`${cmd} --version`, { shell: true, timeout: 5000, encoding: 'utf8', windowsHide: true })
  return r.status === 0 ? `${r.stdout ?? ''}` : null
}): string | null {
  const out = run('agentverify')
  const m = out?.match(/(\d+\.\d+\.\d+)/)
  return m ? m[1] : null
}

/**
 * The command the hooks run. A missing or old command would make the coding agent skip the check silently (an
 * old global install has no "hook" command), so it is the installed CLI only when it is this exact version;
 * otherwise a version-pinned npx call.
 */
export function hookCommand(version: string, installed: () => string | null = installedVersion): string {
  const pinned = `npx -y agentverify@${version}`
  if (process.env.AGENTVERIFY_HOOK_NPX === '1') return pinned
  const runningFromNpx = /[\\/]_npx[\\/]/.test(process.argv[1] ?? '')
  if (runningFromNpx || !hasGlobalInstall()) return pinned
  return installed() === version ? 'agentverify' : pinned
}

/** Long enough for a person to answer an approval (the guard itself waits 120 seconds at most). */
export const HOOK_TIMEOUT_SECONDS = 180

export function installClaudeCode(root: string, cmd: string): { path: string; changed: boolean } {
  const path = join(root, '.claude', 'settings.json')
  const settings = readJson(path)
  settings.hooks ??= {}
  settings.hooks.PreToolUse ??= []
  const full = `${cmd} hook claude-code`
  const already = JSON.stringify(settings.hooks.PreToolUse).includes('hook claude-code')
  let changed = !already
  if (!already) settings.hooks.PreToolUse.push({ matcher: '*', hooks: [{ type: 'command', command: full, timeout: HOOK_TIMEOUT_SECONDS }] })
  // Older setups used a 10-second limit; approvals need time for a person to answer.
  for (const group of settings.hooks.PreToolUse) for (const h of group?.hooks ?? []) {
    if (typeof h?.command === 'string' && h.command.includes('hook claude-code') && h.timeout !== HOOK_TIMEOUT_SECONDS) { h.timeout = HOOK_TIMEOUT_SECONDS; changed = true }
  }
  writeJson(path, settings)
  return { path, changed }
}

/** True when Agent Verify's Cursor hooks are set up for this folder (or a parent) or for the whole machine. */
/** This Claude Code hook was started by Cursor (Cursor runs Claude Code's project hooks too) and Cursor's own hooks are set up. */
function insideCursorWithItsOwnHooks(input: Record<string, unknown>, cwd: string): boolean {
  return typeof input.cursor_version === 'string' && cursorHooksInstalled(cwd)
}

export function cursorHooksInstalled(cwd: string): boolean {
  const has = (p: string) => { try { return readFileSync(p, 'utf8').includes('hook cursor') } catch { return false } }
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (has(join(dir, '.cursor', 'hooks.json'))) return true
    if (dirname(dir) === dir) break
  }
  return has(join(homedir(), '.cursor', 'hooks.json'))
}

export function installCursor(root: string, cmd: string): { path: string; changed: boolean } {
  const path = join(root, '.cursor', 'hooks.json')
  const config = readJson(path)
  config.version ??= 1
  config.hooks ??= {}
  const full = `${cmd} hook cursor`
  let changed = false
  const events: Array<[string, Record<string, unknown>]> = [
    ['beforeShellExecution', {}], ['beforeReadFile', {}], ['beforeMCPExecution', {}],
    // Cursor has no beforeFileEdit; preToolUse lets the guard stop an edit before it happens.
    ['preToolUse', { matcher: CURSOR_WRITE_TOOLS.source }],
    ['afterFileEdit', {}],
  ]
  for (const [ev, extra] of events) {
    config.hooks[ev] ??= []
    if (!JSON.stringify(config.hooks[ev]).includes('hook cursor')) { config.hooks[ev].push({ command: full, timeout: HOOK_TIMEOUT_SECONDS, ...extra }); changed = true }
    for (const h of config.hooks[ev]) if (typeof h?.command === 'string' && h.command.includes('hook cursor') && h.timeout !== HOOK_TIMEOUT_SECONDS) { h.timeout = HOOK_TIMEOUT_SECONDS; changed = true }
  }
  writeJson(path, config)
  return { path, changed }
}

const STARTER_POLICY: PolicyFile & { $comment: string } = {
  $comment: 'Agent Verify coding-agent rules for this project. See https://aimodularity.com/agentverify/docs/#coding-agents',
  disable: [],
  rules: [],
  allow: [],
  whenUnattended: 'block',
}

export async function runProtect(argv: string[], version: string, print: (s: string) => void): Promise<number> {
  const global = argv.includes('--global')
  const which = argv.find(a => a === 'claude-code' || a === 'cursor')
  const root = global ? homedir() : process.cwd()
  const cmd = hookCommand(version)
  // An old global install would otherwise go unnoticed (and makes "npx agentverify" run it instead of the latest).
  const found = cmd === 'agentverify' || !hasGlobalInstall() ? null : installedVersion()
  const oldGlobal = found && found !== version ? found : null
  const done: string[] = []
  try {
    if (!which || which === 'claude-code') { const r = installClaudeCode(root, cmd); done.push(`${r.changed ? 'Added' : 'Already set up'}: Claude Code  (${r.path})`) }
    if (!which || which === 'cursor') { const r = installCursor(root, cmd); done.push(`${r.changed ? 'Added' : 'Already set up'}: Cursor       (${r.path})`) }
    const policyPath = join(global ? HOME_DIR : join(root, '.agentverify'), 'policy.json')
    if (!existsSync(policyPath)) { writeJson(policyPath, STARTER_POLICY); done.push(`Created team rules file: ${policyPath}`) }
  } catch (e) {
    print(`Could not finish setup: ${e instanceof Error ? e.message : e}`)
    return 1
  }
  print([
    '',
    'Agent Verify is now checking what your AI coding agent does before it happens.',
    '',
    ...done.map(d => `  ✓ ${d}`),
    '',
    'Blocked: deleting whole folders, reading .env and SSH keys, sending secrets out, piping downloads into a shell,',
    'force-pushing to main, and the agent changing these settings. Asks you first: installing packages, deploys,',
    'pushing to main, CI edits, and MCP tools that delete, pay or send.',
    '',
    `Try it:  echo '{"tool_name":"Bash","tool_input":{"command":"cat .env"}}' | ${cmd} hook claude-code`,
    `See what was blocked:  ${cmd === 'agentverify' ? 'agentverify' : 'npx agentverify@latest'} log   (saved on this computer)`,
    process.env.AGENTVERIFY_API_KEY ? 'Activity is also sent to your Agent Guard dashboard.' : 'Set AGENTVERIFY_API_KEY to also see every action in your Agent Guard dashboard.',
    cmd === 'agentverify' ? '' : oldGlobal
      ? `Note: an older Agent Verify (${oldGlobal}) is installed on this computer. The hooks use ${version} instead. To update it: npm install -g agentverify@latest`
      : 'Tip: run "npm install -g agentverify" so each check starts faster, then run protect again.',
    '',
  ].join('\n'))
  return 0
}
