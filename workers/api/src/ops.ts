/**
 * Running the product (2.0): error reports with admin alerts, anonymous daily counters, the signup
 * funnel for the admin panel, in-app feedback, and the three-email welcome series.
 *
 * Everything here is best-effort: a failure is logged and never breaks the request that caused it.
 * Emails need RESEND_API_KEY + ALERT_FROM_EMAIL; without them the data is still recorded and shown
 * in the admin panel. Tables: schema/ops.sql (plus user_profiles.email_verified in admin.sql).
 */
import type { D1Database } from './billing'

export interface OpsEnv {
  BILLING_DB?: D1Database
  ADMIN_EMAILS?: string
  RESEND_API_KEY?: string
  ALERT_FROM_EMAIL?: string
  /** "true" turns the welcome email series on. Off by default so nothing is sent by surprise. */
  ONBOARDING_EMAILS?: string
  /** Public site address, for links in emails. */
  PUBLIC_SITE_URL?: string
  /** Public API address, for unsubscribe links. */
  PUBLIC_API_URL?: string
}

type FetchLike = typeof fetch
const nowSec = () => Math.floor(Date.now() / 1000)
const DAY = 86400
const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10)
const siteUrl = (env: OpsEnv) => (env.PUBLIC_SITE_URL ?? 'https://aimodularity.com/agentverify').replace(/\/$/, '')
const apiUrl = (env: OpsEnv) => (env.PUBLIC_API_URL ?? 'https://agentverify-api.agentverify.workers.dev').replace(/\/$/, '')

function clip(value: unknown, max: number): string {
  // Strip control characters (keep newlines and tabs) and cap the length.
  return (typeof value === 'string' ? value : '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max)
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function adminEmails(env: OpsEnv): string[] {
  return (env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim()).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
}

async function sendEmail(env: OpsEnv, to: string[], subject: string, html: string, fetchFn: FetchLike, headers: Record<string, string> = {}): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.ALERT_FROM_EMAIL || to.length === 0) return false
  try {
    const res = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.ALERT_FROM_EMAIL, to, subject, html, ...(Object.keys(headers).length ? { headers } : {}) }),
    })
    return res.ok
  } catch {
    return false
  }
}

// ── Daily counters ─────────────────────────────────────────────────────────────────────────────

export async function bumpCounter(db: D1Database | undefined, key: string, now = Date.now()): Promise<void> {
  if (!db) return
  try {
    await db.prepare('INSERT INTO daily_counters (day, key, count) VALUES (?, ?, 1) ON CONFLICT(day, key) DO UPDATE SET count = count + 1').bind(today(now), key).run()
  } catch { /* ops.sql not applied yet */ }
}

// ── Error reports ──────────────────────────────────────────────────────────────────────────────

export interface ErrorReport { source: 'web' | 'api'; message: string; stack?: string; path?: string; userAgent?: string }

/** Noise we never want to alert on: browser extensions, benign browser warnings, aborted requests. */
export function isNoise(message: string, stack = ''): boolean {
  return /chrome-extension:|moz-extension:|safari-extension:|ResizeObserver loop|Script error\.?$|AbortError|The user aborted|Load failed$|NetworkError when attempting|Failed to fetch$/i.test(`${message}\n${stack}`)
}

/** Strips anything after ? or # so tokens in links never reach the error log. */
export function safePath(value: unknown): string {
  return clip(value, 300).replace(/[?#].*$/, '')
}

export async function recordError(env: OpsEnv, report: ErrorReport, fetchFn: FetchLike = fetch, now = nowSec()): Promise<'recorded' | 'ignored'> {
  const db = env.BILLING_DB
  const message = clip(report.message, 500).trim()
  const stack = clip(report.stack, 4000)
  if (!db || !message || isNoise(message, stack)) return 'ignored'
  const path = safePath(report.path)
  const firstFrame = stack.split('\n').find(l => /\bat\b|@/.test(l))?.replace(/:\d+:\d+\)?$/, '') ?? ''
  const fingerprint = await sha256Hex(`${report.source}\n${message.replace(/\d+/g, '#')}\n${firstFrame}`)
  try {
    await db.prepare(`INSERT INTO error_events (fingerprint, source, message, stack, path, user_agent, count, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET count = count + 1, last_seen = excluded.last_seen, path = excluded.path, user_agent = excluded.user_agent`)
      .bind(fingerprint, report.source, message, stack || null, path || null, clip(report.userAgent, 300) || null, now, now).run()
    // Email the admins the first time an error appears (at most 10 alerts an hour overall).
    const row = await db.prepare('SELECT count, alerted_at FROM error_events WHERE fingerprint = ?').bind(fingerprint).first<{ count: number; alerted_at: number | null }>()
    if (row && !row.alerted_at) {
      const recent = await db.prepare('SELECT COUNT(*) AS n FROM error_events WHERE alerted_at >= ?').bind(now - 3600).first<{ n: number }>()
      if ((recent?.n ?? 0) < 10) {
        await db.prepare('UPDATE error_events SET alerted_at = ? WHERE fingerprint = ?').bind(now, fingerprint).run()
        const html = `<p><strong>New ${report.source === 'web' ? 'website' : 'API'} error</strong> on ${escapeHtml(path || 'unknown page')}</p><pre style="white-space:pre-wrap;font-size:12px">${escapeHtml(message)}\n\n${escapeHtml(stack.slice(0, 1500))}</pre><p>See all errors in the <a href="${siteUrl(env)}/admin/">admin panel</a>.</p>`
        await sendEmail(env, adminEmails(env), `[Agent Verify] New ${report.source} error: ${message.slice(0, 80)}`, html, fetchFn)
      }
    }
    return 'recorded'
  } catch {
    return 'ignored'
  }
}

/** Error reports are kept for 90 days after they were last seen. Run hourly from the cron. */
export async function pruneErrors(db: D1Database | undefined, now = nowSec()): Promise<void> {
  if (!db) return
  try { await db.prepare('DELETE FROM error_events WHERE last_seen < ?').bind(now - 90 * DAY).run() } catch { /* ops.sql not applied yet */ }
}

export async function listErrors(db: D1Database, limit = 50) {
  return (await db.prepare('SELECT fingerprint, source, message, stack, path, user_agent, count, first_seen, last_seen FROM error_events ORDER BY last_seen DESC LIMIT ?').bind(Math.min(200, Math.max(1, limit))).all<Record<string, unknown>>()).results ?? []
}

// ── Feedback ───────────────────────────────────────────────────────────────────────────────────

const KINDS = new Set(['bug', 'idea', 'other'])

export async function saveFeedback(env: OpsEnv, uid: string, email: string | undefined, body: Record<string, unknown>, fetchFn: FetchLike = fetch, now = nowSec()): Promise<{ status: number; body: unknown }> {
  const db = env.BILLING_DB
  if (!db) return { status: 503, body: { error: 'Feedback is not available right now.' } }
  const message = clip(body.message, 2000).trim()
  if (message.length < 3) return { status: 400, body: { error: 'Write a few words first.' } }
  const kind = typeof body.kind === 'string' && KINDS.has(body.kind) ? body.kind : 'other'
  const page = safePath(body.page)
  const id = [...crypto.getRandomValues(new Uint8Array(10))].map(b => b.toString(16).padStart(2, '0')).join('')
  await db.prepare('INSERT INTO feedback (id, uid, email, kind, message, page, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, uid, email ?? null, kind, message, page || null, now).run()
  const label = kind === 'bug' ? 'Bug report' : kind === 'idea' ? 'Idea' : 'Feedback'
  await sendEmail(env, adminEmails(env), `[Agent Verify] ${label} from ${email ?? 'a user'}`,
    `<p><strong>${label}</strong> from ${escapeHtml(email ?? uid)}${page ? ` on ${escapeHtml(page)}` : ''}</p><p style="white-space:pre-wrap">${escapeHtml(message)}</p><p><a href="${siteUrl(env)}/admin/">Open the admin panel</a></p>`, fetchFn,
    email ? { 'Reply-To': email } : {})
  return { status: 200, body: { ok: true } }
}

export async function listFeedback(db: D1Database, limit = 100) {
  return (await db.prepare('SELECT id, uid, email, kind, message, page, status, created_at FROM feedback ORDER BY created_at DESC LIMIT ?').bind(Math.min(300, Math.max(1, limit))).all<Record<string, unknown>>()).results ?? []
}

export async function setFeedbackStatus(db: D1Database, id: string, status: unknown): Promise<{ status: number; body: unknown }> {
  if (status !== 'new' && status !== 'done') return { status: 400, body: { error: 'status must be new or done' } }
  await db.prepare('UPDATE feedback SET status = ? WHERE id = ?').bind(status, id.slice(0, 40)).run()
  return { status: 200, body: { ok: true } }
}

// ── Signup funnel ──────────────────────────────────────────────────────────────────────────────

/**
 * Of the accounts created in the last `days` days: how many ran a private scan, connected a repo,
 * and pay. Plus anonymous free demo scans over the same days. Computed from existing tables; no
 * extra tracking of people.
 */
export async function funnel(db: D1Database, days = 30, now = nowSec()) {
  const span = Math.min(365, Math.max(1, Math.floor(days)))
  const since = now - span * DAY
  const one = async (sql: string, ...binds: unknown[]) => {
    try { return Number((await db.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0) } catch { return 0 }
  }
  const sinceDay = today(since * 1000)
  const demoScans = await one("SELECT COALESCE(SUM(count), 0) AS n FROM daily_counters WHERE key = 'demo_scan' AND day >= ?", sinceDay)
  const signups = await one('SELECT COUNT(*) AS n FROM user_profiles WHERE created_at >= ?', since)
  const verified = await one('SELECT COUNT(*) AS n FROM user_profiles WHERE created_at >= ? AND email_verified = 1', since)
  const scanned = await one('SELECT COUNT(DISTINCT p.uid) AS n FROM user_profiles p JOIN usage_monthly u ON u.uid = p.uid WHERE p.created_at >= ? AND u.scan_count > 0', since)
  const connected = await one(`SELECT COUNT(*) AS n FROM user_profiles p WHERE p.created_at >= ? AND (
      EXISTS (SELECT 1 FROM github_installations g WHERE g.linked_uid = p.uid) OR EXISTS (SELECT 1 FROM vcs_connections v WHERE v.uid = p.uid))`, since)
  const paying = await one(`SELECT COUNT(*) AS n FROM user_profiles p JOIN subscriptions s ON s.uid = p.uid
      WHERE p.created_at >= ? AND s.plan IN ('pro', 'team') AND s.status IN ('active', 'trialing', 'past_due')`, since)
  const daily: Array<{ day: string; demoScans: number; signups: number }> = []
  try {
    const demo = (await db.prepare("SELECT day, count FROM daily_counters WHERE key = 'demo_scan' AND day >= ?").bind(sinceDay).all<{ day: string; count: number }>()).results ?? []
    const sign = (await db.prepare("SELECT strftime('%Y-%m-%d', created_at, 'unixepoch') AS day, COUNT(*) AS count FROM user_profiles WHERE created_at >= ? GROUP BY day").bind(since).all<{ day: string; count: number }>()).results ?? []
    for (let i = span - 1; i >= 0; i--) {
      const day = today((now - i * DAY) * 1000)
      daily.push({ day, demoScans: demo.find(d => d.day === day)?.count ?? 0, signups: sign.find(d => d.day === day)?.count ?? 0 })
    }
  } catch { /* tables missing */ }
  return { days: span, steps: [
    { id: 'demo', label: 'Free demo scans (no account)', count: demoScans },
    { id: 'signup', label: 'New accounts', count: signups },
    { id: 'verified', label: 'Verified their email', count: verified },
    { id: 'scanned', label: 'Ran a private scan', count: scanned },
    { id: 'connected', label: 'Connected a repo', count: connected },
    { id: 'paying', label: 'Paying (Pro or Team)', count: paying },
  ], daily }
}

// ── Welcome email series ───────────────────────────────────────────────────────────────────────

export const ONBOARDING_STEPS = [
  { step: 1, afterSec: 10 * 60, subject: 'Welcome to Agent Verify — run your first scan' },
  { step: 2, afterSec: 2 * DAY, subject: 'Check every pull request automatically' },
  { step: 3, afterSec: 5 * DAY, subject: 'Fix what Agent Verify finds, faster' },
] as const

function emailShell(env: OpsEnv, bodyHtml: string, token: string): string {
  const unsub = `${apiUrl(env)}/v1/onboarding/unsubscribe?token=${encodeURIComponent(token)}`
  return `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#101828;line-height:1.55">${bodyHtml}
<p style="margin-top:28px">— The Agent Verify team</p>
<p style="font-size:12px;color:#667085;margin-top:24px">You're getting this because you created an Agent Verify account. <a href="${unsub}" style="color:#667085">Stop these tips</a>. AI Blockchain Ventures LLC, Sarasota, Florida.</p></div>`
}

const button = (href: string, label: string) => `<p><a href="${href}" style="display:inline-block;background:#7C3AED;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">${label}</a></p>`

export function onboardingEmail(env: OpsEnv, step: number, token: string): { subject: string; html: string } {
  const site = siteUrl(env)
  const meta = ONBOARDING_STEPS.find(s => s.step === step)!
  const bodies: Record<number, string> = {
    1: `<h1 style="font-size:20px">Welcome to Agent Verify</h1>
<p>You can check an AI agent in about 30 seconds: paste its code or MCP config, or try one of the ready-made examples (a poisoned MCP tool, an agent in CI, a payments agent).</p>
${button(`${site}/dashboard/?tab=scan`, 'Run your first scan')}
<p>Prefer your editor? Agent Verify also runs in VS Code, Claude Code and Cursor: <a href="${site}/developers/#mcp">set it up in 2 minutes</a>.</p>`,
    2: `<h1 style="font-size:20px">Catch risky changes before they merge</h1>
<p>Connect a GitHub, GitLab or Bitbucket repo and every pull request that touches agent code, prompts, tools or MCP config gets a pass/fail check and one clear comment — free plans included.</p>
${button(`${site}/dashboard/?tab=github`, 'Connect a repo')}
<p>Not ready? Our <a href="${site}/checks/">check library</a> explains every risk we look for and how to fix it.</p>`,
    3: `<h1 style="font-size:20px">Fix what the scan finds, faster</h1>
<p>Free shows you what is wrong. Pro adds the fix for each finding with corrected code, one-click fixes in pull requests, prompt-injection tests on your own agent, and PDF and compliance evidence for clients and auditors.</p>
${button(`${site}/pricing/`, 'See what Pro adds')}
<p>Questions? Just reply to this email.</p>`,
  }
  return { subject: meta.subject, html: emailShell(env, bodies[step], token) }
}

async function optoutToken(db: D1Database, uid: string): Promise<string> {
  const row = await db.prepare('SELECT token FROM onboarding_optout WHERE uid = ?').bind(uid).first<{ token: string }>()
  if (row) return row.token
  const token = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('')
  await db.prepare('INSERT OR IGNORE INTO onboarding_optout (uid, token, opted_out_at) VALUES (?, ?, NULL)').bind(uid, token).run()
  return ((await db.prepare('SELECT token FROM onboarding_optout WHERE uid = ?').bind(uid).first<{ token: string }>())?.token) ?? token
}

/**
 * Sends the next due welcome email to recently created, verified accounts. Each step goes out once;
 * step 2 is skipped for people who already connected a repo, step 3 for people who already pay.
 * Only accounts created in the last 14 days are considered, so importing old users never emails them.
 */
export async function sendOnboardingBatch(env: OpsEnv, fetchFn: FetchLike = fetch, now = nowSec(), maxPerRun = 25): Promise<number> {
  const db = env.BILLING_DB
  if (!db || env.ONBOARDING_EMAILS !== 'true' || !env.RESEND_API_KEY || !env.ALERT_FROM_EMAIL) return 0
  let sent = 0
  try {
    const candidates = (await db.prepare(`SELECT p.uid, p.email, p.created_at FROM user_profiles p
        LEFT JOIN onboarding_optout o ON o.uid = p.uid
        WHERE p.email_verified = 1 AND p.email IS NOT NULL AND p.created_at >= ? AND (o.opted_out_at IS NULL)
        ORDER BY p.created_at ASC LIMIT 500`).bind(now - 14 * DAY).all<{ uid: string; email: string; created_at: number }>()).results ?? []
    for (const c of candidates) {
      if (sent >= maxPerRun) break
      const done = new Set(((await db.prepare('SELECT step FROM onboarding_emails WHERE uid = ?').bind(c.uid).all<{ step: number }>()).results ?? []).map(r => r.step))
      const next = ONBOARDING_STEPS.find(s => !done.has(s.step))
      if (!next || now - c.created_at < next.afterSec) continue
      let skip = false
      if (next.step === 2) {
        const connected = await db.prepare('SELECT 1 AS x FROM github_installations WHERE linked_uid = ? UNION SELECT 1 FROM vcs_connections WHERE uid = ? LIMIT 1').bind(c.uid, c.uid).first().catch(() => null)
        skip = Boolean(connected)
      }
      if (next.step === 3) {
        const paying = await db.prepare("SELECT 1 AS x FROM subscriptions WHERE uid = ? AND plan IN ('pro','team') AND status IN ('active','trialing') LIMIT 1").bind(c.uid).first().catch(() => null)
        skip = Boolean(paying)
      }
      // Claim the step first so two overlapping runs can never send it twice.
      const claim = await db.prepare('INSERT OR IGNORE INTO onboarding_emails (uid, step, sent_at) VALUES (?, ?, ?)').bind(c.uid, next.step, now).run()
      if ((claim.meta?.changes ?? 1) === 0 || skip) continue
      const token = await optoutToken(db, c.uid)
      const { subject, html } = onboardingEmail(env, next.step, token)
      const unsub = `${apiUrl(env)}/v1/onboarding/unsubscribe?token=${encodeURIComponent(token)}`
      if (await sendEmail(env, [c.email], subject, html, fetchFn, { 'List-Unsubscribe': `<${unsub}>` })) sent++
    }
  } catch (e) {
    console.error('Welcome emails failed:', e instanceof Error ? e.message : e)
  }
  return sent
}

export async function onboardingUnsubscribe(db: D1Database | undefined, token: string, now = nowSec()): Promise<boolean> {
  if (!db || !/^[0-9a-f]{32}$/.test(token)) return false
  try {
    const res = await db.prepare('UPDATE onboarding_optout SET opted_out_at = ? WHERE token = ?').bind(now, token).run()
    return (res.meta?.changes ?? 0) > 0
  } catch {
    return false
  }
}
