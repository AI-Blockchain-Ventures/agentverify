/**
 * Agent Guard — runtime protection for AI agent tools.
 *
 *   import { createGuard } from 'agentverify/guard'
 *   const guard = createGuard({
 *     agent: 'support-bot',
 *     policy: {
 *       allow: ['lookup_order', 'send_email', 'refund'],
 *       requireApproval: ['refund'],
 *       args: { send_email: { to: { allowDomains: ['acme.com'] } } },
 *       rateLimit: { perMinute: 30 },
 *     },
 *     approve: async call => askOnSlack(call),          // human-in-the-loop for risky tools
 *     apiKey: process.env.AGENTVERIFY_API_KEY,           // optional: see every decision in the dashboard
 *   })
 *   const tools = guard.wrapAll({ lookup_order, send_email, refund })
 *
 * Every call to a wrapped tool is checked first. A blocked call throws GuardBlockedError (its message is safe to
 * show the model), so a tricked or confused agent cannot take actions you did not allow.
 */

export type ToolFn = (...args: any[]) => any

export interface ArgRule {
  /** Only these email domains / URL hosts are allowed in this argument (subdomains included). */
  allowDomains?: string[]
  /** Reject values longer than this (stops bulk data being pushed out through one argument). */
  maxLength?: number
  /** Reject values matching this pattern. */
  deny?: RegExp
}

export interface GuardPolicy {
  /** Tools the agent may call. When set, every other tool is blocked. Supports '*' wildcards. */
  allow?: Array<string | RegExp>
  /** Tools that are always blocked. Checked before allow. */
  deny?: Array<string | RegExp>
  /** Tools that need a human yes before they run. */
  requireApproval?: Array<string | RegExp>
  /** Per-tool argument rules, by argument name (for tools called with one object argument). */
  args?: Record<string, Record<string, ArgRule>>
  /** Calls allowed across all tools. */
  rateLimit?: { perMinute?: number; perRun?: number }
  /** Block calls whose arguments contain an API key, token, or private key (the usual data-exfiltration path). Default true. */
  blockSecrets?: boolean
  /** URL hosts any argument may point at. When set, URLs to other hosts are blocked. */
  allowHosts?: string[]
}

export interface ToolCall {
  tool: string
  args: unknown[]
  agent: string
}

export type Decision = 'allowed' | 'blocked' | 'approved' | 'rejected'

export interface GuardEvent {
  agent: string
  tool: string
  decision: Decision
  reason: string
  at: string
  /** Argument preview with secrets masked and long values cut short. Never the full arguments. */
  argsPreview: string
  durationMs?: number
}

export interface GuardOptions {
  agent?: string
  policy: GuardPolicy
  /** Called for tools in requireApproval. Return true to let the call run. If missing, those calls are blocked. */
  approve?: (call: ToolCall) => boolean | Promise<boolean>
  /** Called for every decision (e.g. to log locally). */
  onEvent?: (event: GuardEvent) => void
  /** Send decisions to your Agent Verify dashboard. */
  apiKey?: string
  apiUrl?: string
  /** Inject for tests. */
  fetchFn?: typeof fetch
  now?: () => number
}

export class GuardBlockedError extends Error {
  readonly tool: string
  readonly reason: string
  constructor(tool: string, reason: string) {
    super(`Blocked by Agent Verify Guard: "${tool}" — ${reason}. Do not retry this action; tell the user it needs permission.`)
    this.name = 'GuardBlockedError'
    this.tool = tool
    this.reason = reason
  }
}

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bhf_[A-Za-z0-9]{30,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
]

/**
 * RegExp.test() on a global (g) or sticky (y) pattern remembers where it stopped (lastIndex), so the same
 * input could match one call and not the next. Policy checks must give the same answer every time.
 */
function testPattern(re: RegExp, value: string): boolean {
  if (!re.global && !re.sticky) return re.test(value)
  re.lastIndex = 0
  try { return re.test(value) } finally { re.lastIndex = 0 }
}

function matches(name: string, patterns?: Array<string | RegExp>): boolean {
  return (patterns ?? []).some(p => {
    if (p instanceof RegExp) return testPattern(p, name)
    if (!p.includes('*')) return p === name
    const re = new RegExp(`^${p.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
    return re.test(name)
  })
}

function strings(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 6 || out.length > 200) return out
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const v of value) strings(v, out, depth + 1)
  else if (value && typeof value === 'object') for (const v of Object.values(value as Record<string, unknown>)) strings(v, out, depth + 1)
  return out
}

export function findSecret(value: unknown): string | null {
  for (const s of strings(value)) for (const re of SECRET_PATTERNS) if (re.test(s)) return re.source.slice(0, 24)
  return null
}

function hostAllowed(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase()
  return allowed.some(a => { const d = a.toLowerCase().replace(/^\*\./, ''); return h === d || h.endsWith(`.${d}`) })
}

function urlsIn(value: unknown): URL[] {
  const urls: URL[] = []
  for (const s of strings(value)) {
    for (const m of s.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
      try { urls.push(new URL(m[0])) } catch { /* not a URL */ }
    }
  }
  return urls
}

/** A short, safe preview of the arguments for logs: secrets masked, values cut to 120 characters. */
export function previewArgs(args: unknown[]): string {
  const mask = (v: unknown): unknown => {
    if (typeof v === 'string') {
      let s = v
      for (const re of SECRET_PATTERNS) s = s.replace(new RegExp(re.source, 'g'), m => `${m.slice(0, 4)}****`)
      return s.length > 120 ? `${s.slice(0, 120)}…` : s
    }
    if (Array.isArray(v)) return v.slice(0, 10).map(mask)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).slice(0, 20).map(([k, x]) => [k, mask(x)]))
    return v
  }
  try {
    const s = JSON.stringify(args.length === 1 ? mask(args[0]) : args.map(mask))
    return (s ?? '').slice(0, 600)
  } catch {
    return '[unserializable]'
  }
}

/** A stable snapshot of call arguments, to detect changes between the policy check and execution. */
function fingerprint(args: unknown[]): string {
  const seen = new WeakSet<object>()
  try {
    return JSON.stringify(args, (_k, v: unknown) => {
      if (typeof v === 'function') return `[fn ${(v as { name?: string }).name ?? ''}]`
      if (typeof v === 'bigint') return `${v}n`
      if (v && typeof v === 'object') {
        if (seen.has(v)) return '[circular]'
        seen.add(v)
        if (v instanceof Map) return { __map: [...v.entries()] }
        if (v instanceof Set) return { __set: [...v.values()] }
      }
      return v
    })
  } catch {
    return previewArgs(args)
  }
}

/** The policy decision for one call, before any human approval. Exported for testing and dry runs. */
export function checkCall(policy: GuardPolicy, tool: string, args: unknown[]): { ok: true; needsApproval: boolean } | { ok: false; reason: string } {
  if (matches(tool, policy.deny)) return { ok: false, reason: 'this tool is on the deny list' }
  if (policy.allow && !matches(tool, policy.allow)) return { ok: false, reason: 'this tool is not on the allow list' }
  if (policy.blockSecrets !== false) {
    const secret = findSecret(args)
    if (secret) return { ok: false, reason: 'its arguments contain what looks like an API key or private key' }
  }
  if (policy.allowHosts?.length) {
    const bad = urlsIn(args).find(u => !hostAllowed(u.hostname, policy.allowHosts!))
    if (bad) return { ok: false, reason: `${bad.hostname} is not an allowed host` }
  }
  const rules = policy.args?.[tool]
  const obj = args.length === 1 && args[0] && typeof args[0] === 'object' ? args[0] as Record<string, unknown> : null
  if (rules && obj) {
    for (const [name, rule] of Object.entries(rules)) {
      const values = strings(obj[name])
      for (const v of values) {
        if (rule.maxLength !== undefined && v.length > rule.maxLength) return { ok: false, reason: `"${name}" is longer than ${rule.maxLength} characters` }
        if (rule.deny && testPattern(rule.deny, v)) return { ok: false, reason: `"${name}" matches a blocked pattern` }
        if (rule.allowDomains?.length) {
          const domains: string[] = []
          for (const m of v.matchAll(/@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) domains.push(m[1])
          for (const u of urlsIn(v)) domains.push(u.hostname)
          if (domains.length === 0 && /@|:\/\//.test(v)) return { ok: false, reason: `"${name}" could not be checked against the allowed domains` }
          const off = domains.find(d => !hostAllowed(d, rule.allowDomains!))
          if (off) return { ok: false, reason: `"${name}" goes to ${off}, which is not an allowed domain` }
        }
      }
    }
  }
  return { ok: true, needsApproval: matches(tool, policy.requireApproval) }
}

export interface Guard {
  wrap<T extends ToolFn>(name: string, fn: T): T
  wrapAll<T extends Record<string, ToolFn>>(tools: T): T
  /** Send any queued events now (call before your process exits). */
  flush(): Promise<void>
  /** Start a new run: resets the per-run call budget. */
  newRun(): void
}

export function createGuard(options: GuardOptions): Guard {
  const agent = options.agent ?? 'agent'
  const now = options.now ?? Date.now
  const fetchFn = options.fetchFn ?? (typeof fetch === 'function' ? fetch : undefined)
  const apiUrl = (options.apiUrl ?? 'https://agentverify-api.agentverify.workers.dev').replace(/\/v1\/scan$/, '')
  const recent: number[] = []
  let runCalls = 0
  let queue: GuardEvent[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  const send = async () => {
    timer = null
    if (!queue.length || !options.apiKey || !fetchFn) { queue = []; return }
    const batch = queue.splice(0, 100)
    try {
      await fetchFn(`${apiUrl}/v1/guard/events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json', 'User-Agent': 'agentverify-guard/2.0.0' },
        body: JSON.stringify({ events: batch }),
      })
    } catch {
      // Reporting must never break the agent.
    }
    if (queue.length) await send()
  }

  const record = (event: Omit<GuardEvent, 'agent' | 'at'>) => {
    const full: GuardEvent = { agent, at: new Date(now()).toISOString(), ...event }
    try { options.onEvent?.(full) } catch { /* ignore */ }
    if (options.apiKey) {
      queue.push(full)
      if (queue.length >= 50) void send()
      else if (!timer) { timer = setTimeout(() => void send(), 2000); (timer as { unref?: () => void }).unref?.() }
    }
  }

  const overLimit = (): string | null => {
    const t = now()
    while (recent.length && recent[0] <= t - 60_000) recent.shift()
    const perMinute = options.policy.rateLimit?.perMinute
    if (perMinute !== undefined && recent.length >= perMinute) return `more than ${perMinute} tool calls in a minute`
    const perRun = options.policy.rateLimit?.perRun
    if (perRun !== undefined && runCalls >= perRun) return `more than ${perRun} tool calls in this run`
    return null
  }

  const wrap = <T extends ToolFn>(name: string, fn: T): T => {
    const guarded = async (...args: unknown[]) => {
      const preview = previewArgs(args)
      const limited = overLimit()
      if (limited) {
        record({ tool: name, decision: 'blocked', reason: limited, argsPreview: preview })
        throw new GuardBlockedError(name, limited)
      }
      const verdict = checkCall(options.policy, name, args)
      if (!verdict.ok) {
        record({ tool: name, decision: 'blocked', reason: verdict.reason, argsPreview: preview })
        throw new GuardBlockedError(name, verdict.reason)
      }
      let decision: Decision = 'allowed'
      if (verdict.needsApproval) {
        // What runs must be exactly what was checked and approved: fingerprint the arguments now and
        // compare after the (async) approval, so a change made while waiting cannot slip through.
        const before = fingerprint(args)
        let yes = false
        try { yes = options.approve ? await options.approve({ tool: name, args, agent }) === true : false } catch { yes = false }
        if (!yes) {
          const reason = options.approve ? 'a person did not approve it' : 'it needs human approval and no approver is set up'
          record({ tool: name, decision: 'rejected', reason, argsPreview: preview })
          throw new GuardBlockedError(name, reason)
        }
        const recheck = checkCall(options.policy, name, args)
        if (fingerprint(args) !== before || !recheck.ok) {
          const reason = 'its arguments changed while waiting for approval'
          record({ tool: name, decision: 'blocked', reason, argsPreview: previewArgs(args) })
          throw new GuardBlockedError(name, reason)
        }
        decision = 'approved'
      }
      recent.push(now())
      runCalls++
      const started = now()
      try {
        return await fn(...args)
      } finally {
        record({ tool: name, decision, reason: decision === 'approved' ? 'approved by a person' : 'allowed by policy', argsPreview: preview, durationMs: now() - started })
      }
    }
    Object.defineProperty(guarded, 'name', { value: fn.name || name })
    return guarded as unknown as T
  }

  return {
    wrap,
    wrapAll<T extends Record<string, ToolFn>>(tools: T): T {
      return Object.fromEntries(Object.entries(tools).map(([k, f]) => [k, wrap(k, f)])) as T
    },
    async flush() {
      if (timer) clearTimeout(timer)
      await send()
    },
    newRun() {
      runCalls = 0
    },
  }
}
