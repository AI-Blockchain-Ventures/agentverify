/**
 * Verified agent profiles: a public, signed page per AI agent that its owner can share with customers.
 *
 * The page brings together evidence Agent Verify already has, never anything the owner types in:
 *   1. Security scan    — the latest report the owner linked (verdict + score), snapshotted when linked.
 *   2. Injection tests  — the latest finished run against the owner's verified endpoint, per OWASP category.
 *   3. Runtime guard    — whether Agent Guard has reported for this agent in the last 7 days (counts only).
 *   4. Owner            — the website's domain, shown as verified only when the owner proved control of it
 *                         (a verified injection-test target on that host).
 * "Verified agent" needs (1) VERIFIED and (2) no attack getting through, both from the last 30 days.
 *
 * The public statement is signed with Agent Verify's attestation key under a fixed domain-separation prefix
 * (see signAgentProfileStatement), so it can be checked offline against /v1/attestation/public-key and can never
 * be mistaken for a scan attestation. Nothing private is published: no commands, replies, prompts or findings.
 */
import type { D1Database } from './billing'
import { ATTACKS, OWASP, attachActions } from './redteam'
import { signAgentProfileStatement, type AttestationSigningEnv } from './attestationSigning'

type Result = { status: number; body: unknown }
export const FRESH_DAYS = 30
const DAY = 86400_000

export interface ReportSnapshot { verdict: string; score: number; scannedAt: string; artifactHash: string | null }
/** Reads a report the caller wants to link: who owns it and what it says. Injected (Firestore in production). */
export type ReportLoader = (reportId: string, callerUid: string) => Promise<(ReportSnapshot & { uid: string }) | null>

interface Row {
  slug: string; uid: string; name: string; description: string; website: string
  report_id: string | null; report_snapshot: string | null; redteam_target_id: string | null; guard_agent: string | null
  published: number; created_at: number; updated_at: number
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '')

function slugify(name: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'agent'
  const tail = Array.from(crypto.getRandomValues(new Uint8Array(3)), b => b.toString(16).padStart(2, '0')).join('')
  return `${base}-${tail}`
}

function websiteHost(website: string): string | null {
  if (!website) return null
  try {
    const u = new URL(website)
    return u.protocol === 'https:' ? u.hostname.toLowerCase() : null
  } catch {
    return null
  }
}

async function loadRow(db: D1Database, slug: string): Promise<Row | null> {
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) return null
  return db.prepare('SELECT * FROM agent_profiles WHERE slug = ?').bind(slug).first<Row>()
}

/** Checks every link belongs to the caller. Returns the cleaned fields or a plain-English problem. */
async function validateLinks(db: D1Database, uid: string, body: Record<string, unknown>, loadReport: ReportLoader, current: Row | null) {
  const name = clean(body.name ?? current?.name, 80)
  if (!name) return { error: 'Give the agent a name.' }
  const description = clean(body.description ?? current?.description ?? '', 300)
  const website = clean(body.website ?? current?.website ?? '', 200)
  if (website && !websiteHost(website)) return { error: 'The website must be an https:// address.' }

  let reportId = current?.report_id ?? null
  let snapshot = current?.report_snapshot ?? null
  if (body.reportId !== undefined) {
    reportId = clean(body.reportId, 120) || null
    snapshot = null
    if (reportId) {
      const r = await loadReport(reportId, uid)
      if (!r || r.uid !== uid) return { error: 'That report was not found in your account.' }
      snapshot = JSON.stringify({ verdict: r.verdict, score: r.score, scannedAt: r.scannedAt, artifactHash: r.artifactHash } satisfies ReportSnapshot)
    }
  }
  let targetId = current?.redteam_target_id ?? null
  if (body.redteamTargetId !== undefined) {
    targetId = clean(body.redteamTargetId, 60) || null
    if (targetId && !(await db.prepare('SELECT id FROM redteam_targets WHERE id = ? AND uid = ?').bind(targetId, uid).first())) return { error: 'That injection-test agent was not found in your account.' }
  }
  let guardAgent = current?.guard_agent ?? null
  if (body.guardAgent !== undefined) {
    guardAgent = clean(body.guardAgent, 120) || null
    if (guardAgent) {
      const seen = await db.prepare('SELECT 1 AS ok FROM guard_events WHERE uid = ? AND agent = ? LIMIT 1').bind(uid, guardAgent).first().catch(() => null)
      if (!seen) return { error: 'Agent Guard has no activity for that agent name in your account.' }
    }
  }
  return { name, description, website, reportId, snapshot, targetId, guardAgent, published: body.published === undefined ? (current?.published ?? 1) : body.published === false ? 0 : 1 }
}

/** POST /v1/agent-profiles: create (or with { slug }, update) one of your profiles. */
export async function saveAgentProfile(env: { BILLING_DB?: D1Database }, uid: string, body: Record<string, unknown>, loadReport: ReportLoader, now = Date.now()): Promise<Result> {
  const db = env.BILLING_DB
  if (!db) return { status: 503, body: { error: 'Not available' } }
  const slug = clean(body.slug, 60)
  const current = slug ? await loadRow(db, slug) : null
  if (slug && (!current || current.uid !== uid)) return { status: 404, body: { error: 'Not found' } }
  if (!current) {
    const count = (await db.prepare('SELECT COUNT(*) AS n FROM agent_profiles WHERE uid = ?').bind(uid).first<{ n: number }>())?.n ?? 0
    if (count >= 25) return { status: 409, body: { error: 'Up to 25 agent profiles per account.' } }
  }
  const v = await validateLinks(db, uid, body, loadReport, current)
  if ('error' in v) return { status: 400, body: { error: v.error } }
  if (current) {
    await db.prepare('UPDATE agent_profiles SET name = ?, description = ?, website = ?, report_id = ?, report_snapshot = ?, redteam_target_id = ?, guard_agent = ?, published = ?, updated_at = ? WHERE slug = ?')
      .bind(v.name, v.description, v.website, v.reportId, v.snapshot, v.targetId, v.guardAgent, v.published, now, current.slug).run()
    return { status: 200, body: { slug: current.slug } }
  }
  const newSlug = slugify(v.name)
  await db.prepare('INSERT INTO agent_profiles (slug, uid, name, description, website, report_id, report_snapshot, redteam_target_id, guard_agent, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(newSlug, uid, v.name, v.description, v.website, v.reportId, v.snapshot, v.targetId, v.guardAgent, v.published, now, now).run()
  return { status: 200, body: { slug: newSlug } }
}

export async function deleteAgentProfile(db: D1Database, uid: string, slug: string): Promise<Result> {
  const res = await db.prepare('DELETE FROM agent_profiles WHERE slug = ? AND uid = ?').bind(slug, uid).run()
  return res.meta?.changes ? { status: 200, body: { ok: true } } : { status: 404, body: { error: 'Not found' } }
}

/** GET /v1/agent-profiles: your profiles, plus what you can link to them. */
export async function listAgentProfiles(db: D1Database, uid: string, now = Date.now()): Promise<Result> {
  const rows = (await db.prepare('SELECT * FROM agent_profiles WHERE uid = ? ORDER BY created_at DESC').bind(uid).all<Row>()).results ?? []
  const targets = (await db.prepare('SELECT id, name, host, verified_at FROM redteam_targets WHERE uid = ? ORDER BY created_at DESC').bind(uid).all<{ id: string; name: string; host: string; verified_at: number | null }>().catch(() => ({ results: [] }))).results ?? []
  const agents = (await db.prepare('SELECT agent, MAX(at_ms) AS last FROM guard_events WHERE uid = ? AND at_ms >= ? GROUP BY agent ORDER BY last DESC LIMIT 50').bind(uid, now - FRESH_DAYS * DAY).all<{ agent: string; last: number }>().catch(() => ({ results: [] }))).results ?? []
  const profiles = await Promise.all(rows.map(async r => ({ slug: r.slug, name: r.name, description: r.description, website: r.website, reportId: r.report_id, redteamTargetId: r.redteam_target_id, guardAgent: r.guard_agent, published: Boolean(r.published), summary: (await buildStatement(db, r, now)).statement.verified })))
  return { status: 200, body: { profiles, linkable: { injectionTargets: targets.map(t => ({ id: t.id, name: t.name, host: t.host, verified: Boolean(t.verified_at) })), guardAgents: agents.map(a => a.agent) } } }
}

type CheckStatus = 'pass' | 'fail' | 'stale' | 'missing'
export interface ProfileStatement {
  type: 'agentverify.agent-profile'
  version: 1
  slug: string
  name: string
  description: string
  owner: { website: string | null; domain: string | null; domainVerified: boolean }
  checks: {
    scan: { status: CheckStatus; verdict: string | null; score: number | null; scannedAt: string | null; artifactHash: string | null }
    injectionTests: { status: CheckStatus; testedAt: string | null; attacks: number; gotThrough: number; needsReview: number; weekly: boolean; byOwasp: Record<string, { name: string; resisted: number; total: number }> }
    runtimeGuard: { status: CheckStatus; lastSeenAt: string | null; last7Days: { blocked: number; askedAPerson: number; allowed: number } }
  }
  verified: boolean
  issuedAt: string
}

/** Everything the public page shows, computed fresh from stored evidence. */
export async function buildStatement(db: D1Database, r: Row, now = Date.now()): Promise<{ statement: ProfileStatement }> {
  const fresh = (iso: string | null | number) => iso !== null && now - (typeof iso === 'number' ? iso : Date.parse(iso)) <= FRESH_DAYS * DAY

  // 1. Scan
  const snap = r.report_snapshot ? (JSON.parse(r.report_snapshot) as ReportSnapshot) : null
  const scan: ProfileStatement['checks']['scan'] = snap
    ? { status: !fresh(snap.scannedAt) ? 'stale' : snap.verdict === 'VERIFIED' ? 'pass' : 'fail', verdict: snap.verdict, score: snap.score, scannedAt: snap.scannedAt, artifactHash: snap.artifactHash }
    : { status: 'missing', verdict: null, score: null, scannedAt: null, artifactHash: null }

  // 2. Injection tests (with real actions from Agent Guard counted in)
  const injection: ProfileStatement['checks']['injectionTests'] = { status: 'missing', testedAt: null, attacks: 0, gotThrough: 0, needsReview: 0, weekly: false, byOwasp: {} }
  let targetHost: string | null = null
  let targetVerified = false
  if (r.redteam_target_id) {
    const t = await db.prepare('SELECT host, verified_at FROM redteam_targets WHERE id = ? AND uid = ?').bind(r.redteam_target_id, r.uid).first<{ host: string; verified_at: number | null }>()
    if (t) {
      targetHost = t.host
      targetVerified = Boolean(t.verified_at)
      const run = await db.prepare("SELECT canary, results, created_at, finished_at FROM redteam_runs WHERE target_id = ? AND uid = ? AND status = 'done' ORDER BY created_at DESC LIMIT 1").bind(r.redteam_target_id, r.uid).first<{ canary: string; results: string; created_at: number; finished_at: number | null }>()
      const sched = await db.prepare('SELECT every_days FROM redteam_schedules WHERE target_id = ?').bind(r.redteam_target_id).first<{ every_days: number }>().catch(() => null)
      injection.weekly = Boolean(sched?.every_days)
      if (run) {
        const results = await attachActions(db, r.uid, run, JSON.parse(run.results || '[]'), now)
        injection.testedAt = new Date(run.finished_at ?? run.created_at).toISOString()
        injection.attacks = results.length
        injection.gotThrough = results.filter(x => x.outcome === 'failed').length
        injection.needsReview = results.filter(x => x.outcome === 'review').length
        for (const x of results) {
          const code = x.owasp ?? ATTACKS.find(a => a.id === x.id)?.owasp ?? 'LLM01'
          const bucket = (injection.byOwasp[code] ??= { name: OWASP[code] ?? code, resisted: 0, total: 0 })
          bucket.total++
          if (x.outcome === 'passed') bucket.resisted++
        }
        injection.status = !fresh(run.finished_at ?? run.created_at) ? 'stale' : injection.gotThrough === 0 && results.every(x => x.outcome !== 'error') ? 'pass' : 'fail'
      }
    }
  }

  // 3. Runtime guard (counts only)
  const runtime: ProfileStatement['checks']['runtimeGuard'] = { status: 'missing', lastSeenAt: null, last7Days: { blocked: 0, askedAPerson: 0, allowed: 0 } }
  if (r.guard_agent) {
    const rows = (await db.prepare('SELECT decision, COUNT(*) AS n, MAX(at_ms) AS last FROM guard_events WHERE uid = ? AND agent = ? AND at_ms >= ? GROUP BY decision').bind(r.uid, r.guard_agent, now - 7 * DAY).all<{ decision: string; n: number; last: number }>().catch(() => ({ results: [] }))).results ?? []
    const n = (...d: string[]) => rows.filter(x => d.includes(x.decision)).reduce((t, x) => t + Number(x.n), 0)
    const last = rows.reduce((m, x) => Math.max(m, Number(x.last) || 0), 0)
    runtime.last7Days = { blocked: n('blocked', 'rejected'), askedAPerson: n('asked', 'approved'), allowed: n('allowed') }
    runtime.lastSeenAt = last ? new Date(last).toISOString() : null
    runtime.status = last ? 'pass' : 'stale'
  }

  // 4. Owner: the website's domain is verified only if the owner proved control of that host.
  const domain = websiteHost(r.website)
  const domainVerified = Boolean(domain && targetVerified && targetHost && (targetHost === domain || targetHost.endsWith(`.${domain}`)))

  return {
    statement: {
      type: 'agentverify.agent-profile', version: 1, slug: r.slug, name: r.name, description: r.description,
      owner: { website: r.website || null, domain, domainVerified },
      checks: { scan, injectionTests: injection, runtimeGuard: runtime },
      verified: scan.status === 'pass' && injection.status === 'pass',
      issuedAt: new Date(now).toISOString(),
    },
  }
}

/** Keys sorted at every level, so the same statement always serialises to the same bytes. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(value)
}

/** GET /v1/agents/:slug — public. The statement and, when a key is configured, its signature. */
export async function publicAgentProfile(env: { BILLING_DB?: D1Database } & AttestationSigningEnv, slug: string, now = Date.now()): Promise<Result> {
  const db = env.BILLING_DB
  if (!db) return { status: 503, body: { error: 'Not available' } }
  const r = await loadRow(db, slug)
  if (!r || !r.published) return { status: 404, body: { error: 'No public agent profile at this address.' } }
  const { statement } = await buildStatement(db, r, now)
  const signed = await signAgentProfileStatement(canonicalJson(statement), env)
  return { status: 200, body: { statement, signature: signed } }
}

/** A small live badge for READMEs and websites. */
export function agentBadgeSvg(statement: ProfileStatement | null): string {
  const passed = statement ? [statement.checks.scan, statement.checks.injectionTests, statement.checks.runtimeGuard].filter(c => c.status === 'pass').length : 0
  const label = !statement ? 'not found' : statement.verified ? 'verified agent' : `${passed}/3 checks`
  const color = !statement ? '#6B7280' : statement.verified ? '#00B37E' : passed ? '#E07B39' : '#E03E3E'
  const right = Math.max(70, label.length * 7 + 14)
  const total = 92 + right
  const esc = (s: string) => s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] as string)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="Agent Verify: ${esc(label)}"><clipPath id="r"><rect width="${total}" height="20" rx="3"/></clipPath><g clip-path="url(#r)"><rect width="92" height="20" fill="#0D1321"/><rect x="92" width="${right}" height="20" fill="${color}"/></g><g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11"><text x="46" y="14">Agent Verify</text><text x="${92 + right / 2}" y="14">${esc(label)}</text></g></svg>`
}

export async function agentBadge(env: { BILLING_DB?: D1Database }, slug: string, now = Date.now()): Promise<string> {
  const db = env.BILLING_DB
  const r = db ? await loadRow(db, slug) : null
  if (!db || !r || !r.published) return agentBadgeSvg(null)
  return agentBadgeSvg((await buildStatement(db, r, now)).statement)
}
