/** Agent Guard: store and list runtime tool-call decisions sent by `agentverify/guard`. */
import type { D1Database } from './billing'

const DECISIONS = new Set(['allowed', 'blocked', 'approved', 'rejected'])
const RETENTION_MS = 30 * 86400_000
export const MAX_EVENTS_PER_REQUEST = 100

const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v : '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max)

// Same patterns the client masks with — applied again here in case an older or modified client sent raw values.
const SECRET = /\b(sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|hf_[A-Za-z0-9]{30,})/g
function maskSecrets(s: string): string {
  return s.replace(SECRET, m => `${m.slice(0, 4)}****`).replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[private key removed]')
}

export async function storeGuardEvents(db: D1Database, uid: string, body: unknown, now = Date.now()): Promise<{ status: number; body: unknown }> {
  const events = (body as { events?: unknown })?.events
  if (!Array.isArray(events)) return { status: 400, body: { error: 'events must be an array' } }
  if (events.length > MAX_EVENTS_PER_REQUEST) return { status: 413, body: { error: `At most ${MAX_EVENTS_PER_REQUEST} events per request` } }
  let stored = 0
  for (const raw of events) {
    if (!raw || typeof raw !== 'object') continue
    const e = raw as Record<string, unknown>
    const decision = clip(e.decision, 16)
    const tool = clip(e.tool, 120)
    if (!DECISIONS.has(decision) || !tool) continue
    const at = Date.parse(clip(e.at, 40))
    // Clamp the client's clock to a sane window so a bad timestamp can't hide events or pin them in the future.
    const atMs = Number.isFinite(at) ? Math.min(now, Math.max(now - RETENTION_MS, at)) : now
    const duration = typeof e.durationMs === 'number' && Number.isFinite(e.durationMs) ? Math.max(0, Math.min(86400_000, Math.round(e.durationMs))) : null
    await db.prepare('INSERT INTO guard_events (uid, agent, tool, decision, reason, args_preview, duration_ms, at_ms, received_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(uid, clip(e.agent, 120) || 'agent', tool, decision, clip(e.reason, 300), maskSecrets(clip(e.argsPreview, 600)), duration, atMs, now).run()
    stored++
  }
  await db.prepare('DELETE FROM guard_events WHERE uid = ? AND at_ms < ?').bind(uid, now - RETENTION_MS).run()
  return { status: 200, body: { stored } }
}

export async function listGuardEvents(db: D1Database, uid: string, opts: { agent?: string | null; decision?: string | null; limit?: number } = {}, now = Date.now()) {
  const where = ['uid = ?', 'at_ms >= ?']
  const binds: unknown[] = [uid, now - RETENTION_MS]
  if (opts.agent) { where.push('agent = ?'); binds.push(opts.agent.slice(0, 120)) }
  if (opts.decision && DECISIONS.has(opts.decision)) { where.push('decision = ?'); binds.push(opts.decision) }
  const limit = Math.max(1, Math.min(500, opts.limit ?? 200))
  const events = (await db.prepare(`SELECT agent, tool, decision, reason, args_preview, duration_ms, at_ms FROM guard_events WHERE ${where.join(' AND ')} ORDER BY at_ms DESC LIMIT ${limit}`).bind(...binds).all<Record<string, unknown>>()).results ?? []
  const since = now - 7 * 86400_000
  const stats = (await db.prepare('SELECT decision, COUNT(*) AS n FROM guard_events WHERE uid = ? AND at_ms >= ? GROUP BY decision').bind(uid, since).all<{ decision: string; n: number }>()).results ?? []
  const agents = (await db.prepare('SELECT agent, COUNT(*) AS n, MAX(at_ms) AS last FROM guard_events WHERE uid = ? AND at_ms >= ? GROUP BY agent ORDER BY last DESC LIMIT 50').bind(uid, now - RETENTION_MS).all<{ agent: string; n: number; last: number }>()).results ?? []
  return {
    events: events.map(e => ({ agent: e.agent, tool: e.tool, decision: e.decision, reason: e.reason, argsPreview: e.args_preview, durationMs: e.duration_ms, at: new Date(Number(e.at_ms)).toISOString() })),
    last7Days: Object.fromEntries(['allowed', 'approved', 'blocked', 'rejected'].map(d => [d, stats.find(s => s.decision === d)?.n ?? 0])),
    agents,
  }
}
