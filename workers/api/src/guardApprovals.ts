/**
 * Approvals for the coding-agent guard. When an AI coding agent wants to do something that needs a person and
 * nobody is at the screen (auto mode, or a question Cursor can't show), the guard asks here and waits.
 * A signed-in person approves or denies on the dashboard (phone or desktop); a Slack/email ping tells them.
 *
 * Security: only a signed-in person can decide, never an API key, because the agent itself can read the key.
 */
import type { D1Database } from './billing'
import { isSlackWebhookUrl, loadAlertSettings, type AlertEnv } from './alerts'
import { policyOwnerFor } from './guardPolicy'
import type { FetchLike } from './githubApp'
import type { BillingEnv } from './billing'

type Result = { status: number; body: unknown }
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired'

export const DEFAULT_WAIT_SECONDS = 120
export const MAX_WAIT_SECONDS = 600
const KEEP_MS = 7 * 86400_000
const MAX_PENDING_PER_ACCOUNT = 20
const SITE = 'https://aimodularity.com/agentverify'

const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v : '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max)
const SECRET = /\b(sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|hf_[A-Za-z0-9]{30,})/g
const mask = (s: string) => s.replace(SECRET, m => `${m.slice(0, 4)}****`).replace(/((?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*)\S+/gi, '$1****')

interface Row {
  id: string; owner_uid: string; requester_uid: string; agent: string; tool: string; preview: string; reason: string; rule: string
  status: ApprovalStatus; created_ms: number; expires_ms: number; decided_ms: number | null; decided_by: string | null
}

function view(r: Row, now: number) {
  const status: ApprovalStatus = r.status === 'pending' && now >= r.expires_ms ? 'expired' : r.status
  return { id: r.id, agent: r.agent, tool: r.tool, preview: r.preview, reason: r.reason, rule: r.rule || null, status, createdAt: new Date(r.created_ms).toISOString(), expiresAt: new Date(r.expires_ms).toISOString(), decidedAt: r.decided_ms ? new Date(r.decided_ms).toISOString() : null }
}

function newId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16))
  return 'apr_' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
}

/** POST /v1/guard/approvals: the guard asks for a decision. Works with an API key. */
export async function createApproval(env: BillingEnv & AlertEnv, uid: string, body: unknown, opts: { now?: number; notify?: (p: Promise<unknown>) => void; fetchFn?: FetchLike } = {}): Promise<Result> {
  const db = env.BILLING_DB
  if (!db) return { status: 503, body: { error: 'Not available' } }
  const now = opts.now ?? Date.now()
  const b = (body ?? {}) as Record<string, unknown>
  const tool = clip(b.tool, 120)
  const preview = mask(clip(b.preview, 600))
  if (!tool || !preview) return { status: 400, body: { error: 'tool and preview are required' } }
  const wait = Math.max(30, Math.min(MAX_WAIT_SECONDS, Number(b.waitSeconds) || DEFAULT_WAIT_SECONDS))
  const owner = await policyOwnerFor(env, uid)
  await db.prepare('DELETE FROM guard_approvals WHERE created_ms < ?').bind(now - KEEP_MS).run()
  const pending = await db.prepare('SELECT COUNT(*) AS n FROM guard_approvals WHERE requester_uid = ? AND status = ? AND expires_ms > ?').bind(uid, 'pending', now).first<{ n: number }>()
  if ((pending?.n ?? 0) >= MAX_PENDING_PER_ACCOUNT) return { status: 429, body: { error: 'Too many requests are already waiting for a decision.' } }
  const row: Row = { id: newId(), owner_uid: owner, requester_uid: uid, agent: clip(b.agent, 120) || 'AI coding agent', tool, preview, reason: clip(b.reason, 300), rule: clip(b.rule, 60), status: 'pending', created_ms: now, expires_ms: now + wait * 1000, decided_ms: null, decided_by: null }
  await db.prepare('INSERT INTO guard_approvals (id, owner_uid, requester_uid, agent, tool, preview, reason, rule, status, created_ms, expires_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(row.id, row.owner_uid, row.requester_uid, row.agent, row.tool, row.preview, row.reason, row.rule, row.status, row.created_ms, row.expires_ms).run()
  const ping = notifyApprovers(env, row, opts.fetchFn ?? fetch)
  if (opts.notify) opts.notify(ping)
  else await ping
  return { status: 200, body: { ...view(row, now), approveUrl: `${SITE}/dashboard/?tab=guard#approvals` } }
}

/** Slack and/or email ping to the people who can decide (the account, and the Team owner if different). */
async function notifyApprovers(env: AlertEnv, row: Row, fetchFn: FetchLike): Promise<void> {
  if (!env.BILLING_DB) return
  const uids = [...new Set([row.requester_uid, row.owner_uid])]
  const subject = `Approval needed: ${row.agent}`
  const text = [`An AI coding agent is waiting for a decision (${Math.round((row.expires_ms - row.created_ms) / 60000) || 1} min).`, `Agent: ${row.agent}`, `Wants to: ${row.preview}`, row.reason ? `Why it needs a person: ${row.reason}` : '', `Approve or deny (sign-in required): ${SITE}/dashboard/?tab=guard#approvals`].filter(Boolean)
  const jobs: Array<Promise<unknown>> = []
  for (const uid of uids) {
    const s = await loadAlertSettings(env.BILLING_DB, uid).catch(() => null)
    if (!s) continue
    if (s.slack_webhook_url && isSlackWebhookUrl(s.slack_webhook_url)) jobs.push(fetchFn(s.slack_webhook_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `*${subject}*\n${text.join('\n')}` }) }))
    if (s.email && env.RESEND_API_KEY && env.ALERT_FROM_EMAIL) jobs.push(fetchFn('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.ALERT_FROM_EMAIL, to: [s.email], subject, text: text.join('\n') }) }))
  }
  const results = await Promise.allSettled(jobs)
  for (const r of results) if (r.status === 'rejected') console.error('Approval ping failed:', r.reason instanceof Error ? r.reason.message : r.reason)
}

async function loadRow(db: D1Database, id: string): Promise<Row | null> {
  if (!/^apr_[0-9a-f]{32}$/.test(id)) return null
  return db.prepare('SELECT * FROM guard_approvals WHERE id = ?').bind(id).first<Row>()
}

const canSee = (r: Row, uid: string) => r.requester_uid === uid || r.owner_uid === uid

/** GET /v1/guard/approvals/:id: the guard checks whether someone decided. */
export async function getApproval(env: BillingEnv, uid: string, id: string, now = Date.now()): Promise<Result> {
  if (!env.BILLING_DB) return { status: 503, body: { error: 'Not available' } }
  const r = await loadRow(env.BILLING_DB, id)
  if (!r || !canSee(r, uid)) return { status: 404, body: { error: 'Not found' } }
  return { status: 200, body: view(r, now) }
}

/** GET /v1/guard/approvals: requests waiting for this person (their own, and their team's if they own it). */
export async function listApprovals(env: BillingEnv, uid: string, now = Date.now()): Promise<Result> {
  if (!env.BILLING_DB) return { status: 503, body: { error: 'Not available' } }
  const rows = (await env.BILLING_DB.prepare('SELECT * FROM guard_approvals WHERE (requester_uid = ? OR owner_uid = ?) AND created_ms > ? ORDER BY created_ms DESC LIMIT 50').bind(uid, uid, now - 86400_000).all<Row>()).results ?? []
  const all = rows.map(r => view(r, now))
  return { status: 200, body: { pending: all.filter(a => a.status === 'pending'), recent: all.filter(a => a.status !== 'pending').slice(0, 10) } }
}

/** POST /v1/guard/approvals/:id/decision { decision: 'approve' | 'deny' }: signed-in people only (checked by the route). */
export async function decideApproval(env: BillingEnv, uid: string, id: string, body: unknown, now = Date.now()): Promise<Result> {
  if (!env.BILLING_DB) return { status: 503, body: { error: 'Not available' } }
  const decision = (body as { decision?: unknown })?.decision
  if (decision !== 'approve' && decision !== 'deny') return { status: 400, body: { error: 'decision must be "approve" or "deny"' } }
  const r = await loadRow(env.BILLING_DB, id)
  if (!r || !canSee(r, uid)) return { status: 404, body: { error: 'Not found' } }
  if (r.status !== 'pending') return { status: 409, body: { error: `Already ${r.status}.` } }
  if (now >= r.expires_ms) return { status: 409, body: { error: 'This request timed out, so the agent was blocked.' } }
  const status: ApprovalStatus = decision === 'approve' ? 'approved' : 'denied'
  // Only the first decision counts (two people tapping at once).
  const res = await env.BILLING_DB.prepare('UPDATE guard_approvals SET status = ?, decided_ms = ?, decided_by = ? WHERE id = ? AND status = ?').bind(status, now, uid, id, 'pending').run()
  if (!res.meta?.changes) return { status: 409, body: { error: 'Someone already decided.' } }
  return { status: 200, body: view({ ...r, status, decided_ms: now, decided_by: uid }, now) }
}
