/**
 * Company rules for the coding-agent guard (`agentverify protect`).
 *
 * The account owner (for a Team plan, the Team owner) sets the rules once on the dashboard. Every developer's
 * guard downloads them with its API key and applies them on top of the built-in rules. A project's own
 * .agentverify/policy.json can only add stricter rules unless the owner turns on `projectsCanRelax`.
 */
import { checkScanQuota, loadTeamOwnerFor, type BillingEnv, type D1Database } from './billing'

type Result = { status: number; body: unknown }

const KINDS = new Set(['shell', 'read', 'write', 'code', 'fetch', 'mcp'])
const DECISIONS = new Set(['allow', 'ask', 'deny'])
const MAX_JSON = 32 * 1024
const MAX_ITEMS = 100
const MAX_PATTERN = 500

export interface CompanyPolicy {
  disable: string[]
  rules: Array<{ id: string; kind: string | string[]; pattern: string; unless?: string; decision: string; reason?: string }>
  allow: string[]
  whenUnattended: 'block' | 'allow' | 'approve'
  projectsCanRelax: boolean
}

export const EMPTY_POLICY: CompanyPolicy = { disable: [], rules: [], allow: [], whenUnattended: 'block', projectsCanRelax: false }

function validPattern(p: unknown): p is string {
  if (typeof p !== 'string' || !p || p.length > MAX_PATTERN) return false
  try { new RegExp(p, 'i'); return true } catch { return false }
}

/** Checks a policy sent from the dashboard. Returns a clean copy, or a plain-English problem. */
export function validatePolicy(input: unknown): { ok: true; policy: CompanyPolicy } | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Rules must be an object.' }
  const o = input as Record<string, unknown>
  const strings = (v: unknown, name: string): string[] | string => {
    if (v === undefined) return []
    if (!Array.isArray(v) || v.length > MAX_ITEMS || v.some(x => typeof x !== 'string' || !x || x.length > MAX_PATTERN)) return `${name} must be a list of up to ${MAX_ITEMS} entries.`
    return [...new Set(v as string[])]
  }
  const disable = strings(o.disable, 'Turned-off rules')
  if (typeof disable === 'string') return { ok: false, error: disable }
  if (disable.some(id => !/^[\w.-]{1,60}$/.test(id))) return { ok: false, error: 'Turned-off rules must be rule IDs such as install-package.' }
  if (disable.some(id => id.startsWith('guard-config'))) return { ok: false, error: 'The rule that protects the guard settings cannot be turned off.' }
  const allow = strings(o.allow, 'Always-allowed entries')
  if (typeof allow === 'string') return { ok: false, error: allow }
  const badAllow = (allow as string[]).find(a => !validPattern(a)) as string | undefined
  if (badAllow) return { ok: false, error: `"${badAllow.slice(0, 40)}" in the always-allowed list is not a valid pattern.` }

  const rawRules = o.rules ?? []
  if (!Array.isArray(rawRules) || rawRules.length > MAX_ITEMS) return { ok: false, error: `Your rules must be a list of up to ${MAX_ITEMS}.` }
  const rules: CompanyPolicy['rules'] = []
  const ids = new Set<string>()
  for (const [i, r] of rawRules.entries()) {
    const n = `Rule ${i + 1}`
    if (!r || typeof r !== 'object') return { ok: false, error: `${n} is not a rule.` }
    const x = r as Record<string, unknown>
    const id = typeof x.id === 'string' ? x.id.trim() : ''
    if (!/^[\w.-]{1,60}$/.test(id)) return { ok: false, error: `${n} needs a short ID (letters, numbers, dashes).` }
    if (ids.has(id)) return { ok: false, error: `Two rules use the ID "${id}".` }
    ids.add(id)
    const kinds = Array.isArray(x.kind) ? x.kind : [x.kind]
    if (!kinds.length || kinds.some(k => typeof k !== 'string' || !KINDS.has(k))) return { ok: false, error: `${n} ("${id}") needs a type: shell, read, write, code, fetch or mcp.` }
    if (!validPattern(x.pattern)) return { ok: false, error: `${n} ("${id}") has a pattern that is empty or not valid.` }
    if (x.unless !== undefined && x.unless !== '' && !validPattern(x.unless)) return { ok: false, error: `${n} ("${id}") has an "unless" pattern that is not valid.` }
    if (typeof x.decision !== 'string' || !DECISIONS.has(x.decision)) return { ok: false, error: `${n} ("${id}") needs a decision: allow, ask or deny.` }
    const reason = typeof x.reason === 'string' ? x.reason.trim().slice(0, 200) : ''
    rules.push({ id, kind: Array.isArray(x.kind) ? (kinds as string[]) : (x.kind as string), pattern: x.pattern as string, ...(typeof x.unless === 'string' && x.unless ? { unless: x.unless } : {}), decision: x.decision, ...(reason ? { reason } : {}) })
  }
  if (o.whenUnattended !== undefined && o.whenUnattended !== 'block' && o.whenUnattended !== 'allow' && o.whenUnattended !== 'approve') return { ok: false, error: 'When nobody is watching must be "block", "approve" or "allow".' }
  const policy: CompanyPolicy = { disable, rules, allow, whenUnattended: o.whenUnattended === 'allow' || o.whenUnattended === 'approve' ? o.whenUnattended : 'block', projectsCanRelax: o.projectsCanRelax === true }
  if (JSON.stringify(policy).length > MAX_JSON) return { ok: false, error: 'These rules are too large to save.' }
  return { ok: true, policy }
}

/** Whose rules apply to this person: their Team owner's while they hold a seat, otherwise their own. */
export async function policyOwnerFor(env: BillingEnv, uid: string): Promise<string> {
  return (await loadTeamOwnerFor(env, uid)) ?? uid
}

async function load(db: D1Database, owner: string): Promise<{ policy: CompanyPolicy; updatedAt: number | null } | null> {
  let row: { policy_json: string; updated_at: number } | null = null
  try {
    row = await db.prepare('SELECT policy_json, updated_at FROM guard_policies WHERE owner_uid = ?').bind(owner).first<{ policy_json: string; updated_at: number }>()
  } catch {
    return null // table not created yet
  }
  if (!row) return null
  try {
    const v = validatePolicy(JSON.parse(row.policy_json))
    return v.ok ? { policy: v.policy, updatedAt: row.updated_at } : null
  } catch {
    return null
  }
}

/** GET /v1/guard/policy: the rules that apply to this account, and whether this person can change them. */
export async function getGuardPolicy(env: BillingEnv, uid: string, opts: { canEdit: boolean }): Promise<Result> {
  if (!env.BILLING_DB) return { status: 503, body: { error: 'Not available' } }
  const owner = await policyOwnerFor(env, uid)
  const saved = await load(env.BILLING_DB, owner)
  // Rules reach a whole team only on the Team plan (members inherit the owner's). Otherwise they cover this account's own keys.
  const teamWide = owner !== uid || (await checkScanQuota(env, uid)).plan === 'team'
  return {
    status: 200,
    body: {
      policy: saved?.policy ?? null,
      updatedAt: saved?.updatedAt ? new Date(saved.updatedAt).toISOString() : null,
      source: owner === uid ? 'own' : 'team',
      canEdit: opts.canEdit && owner === uid,
      teamWide,
    },
  }
}

/** POST /v1/guard/policy: save the rules (account owner only; a Team member sees the owner's rules read-only). */
export async function putGuardPolicy(env: BillingEnv, uid: string, body: unknown, now = Date.now()): Promise<Result> {
  if (!env.BILLING_DB) return { status: 503, body: { error: 'Not available' } }
  if ((await policyOwnerFor(env, uid)) !== uid) return { status: 403, body: { error: 'Your Team owner sets the rules for your team.' } }
  const v = validatePolicy((body as { policy?: unknown })?.policy)
  if (!v.ok) return { status: 400, body: { error: v.error } }
  await env.BILLING_DB.prepare('INSERT INTO guard_policies (owner_uid, policy_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner_uid) DO UPDATE SET policy_json = excluded.policy_json, updated_at = excluded.updated_at')
    .bind(uid, JSON.stringify(v.policy), now).run()
  return { status: 200, body: { ok: true, policy: v.policy, updatedAt: new Date(now).toISOString() } }
}
