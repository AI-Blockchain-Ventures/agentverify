/**
 * Monitoring alerts: when a watched repo's default branch gets a NEW serious finding (or its score drops sharply),
 * tell the account owner on Slack and/or by email. Only new problems alert, so a known issue doesn't repeat.
 */
import type { Finding, ScanResult } from '@agentverify/scanner'
import type { D1Database } from './billing'
import { countBySeverity, locateLine, sortFindings, type RepoFile } from './githubPr'
import type { FetchLike } from './githubApp'

export interface AlertEnv {
  BILLING_DB?: D1Database
  /** Optional: email alerts via Resend. Slack alerts work without it. */
  RESEND_API_KEY?: string
  ALERT_FROM_EMAIL?: string
}

export type MinSeverity = 'critical' | 'high' | 'medium'
const RANK: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 }
const SITE = 'https://aimodularity.com/agentverify'
export const SCORE_DROP_ALERT = 10

export interface AlertSettings { slack_webhook_url: string | null; email: string | null; min_severity: MinSeverity }

/** Only real Slack incoming-webhook addresses are accepted, so this can never be pointed at another server. */
export function isSlackWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname === 'hooks.slack.com' && u.pathname.startsWith('/services/')
  } catch {
    return false
  }
}

export function isEmail(value: string): boolean {
  return /^[^\s@<>()]{1,64}@[^\s@<>()]{1,255}\.[A-Za-z]{2,}$/.test(value)
}

export interface AlertInput {
  uid: string
  repo: string
  sha: string
  branch: string
  result: ScanResult
  previous: { score: number; finding_codes: string } | null
  files: RepoFile[]
}

/** What changed since the last scan, filtered to the account's alert level. Null = nothing worth an alert. */
export function alertDecision(input: AlertInput, minSeverity: MinSeverity): { newFindings: Finding[]; scoreDrop: number } | null {
  const before = new Set((input.previous?.finding_codes ?? '').split(',').filter(Boolean))
  const isFirst = input.previous === null
  const newFindings = sortFindings(input.result.findings ?? []).filter(f => !before.has(f.code) && RANK[f.severity] >= RANK[minSeverity])
  const scoreDrop = input.previous ? input.previous.score - input.result.riskScore : 0
  // First scan of a repo: alert only if it already has serious findings (so connecting a repo tells you where you stand).
  if (newFindings.length === 0 && scoreDrop < SCORE_DROP_ALERT) return null
  if (isFirst && newFindings.length === 0) return null
  return { newFindings, scoreDrop }
}

export function alertText(input: AlertInput, decision: { newFindings: Finding[]; scoreDrop: number }): { subject: string; lines: string[] } {
  const c = countBySeverity(decision.newFindings)
  const subject = decision.newFindings.length
    ? `Agent Verify: ${decision.newFindings.length} new security finding${decision.newFindings.length === 1 ? '' : 's'} in ${input.repo}`
    : `Agent Verify: security score for ${input.repo} dropped ${decision.scoreDrop} points`
  const lines = [
    `${input.repo} (${input.branch} @ ${input.sha.slice(0, 7)}): security score ${input.result.riskScore}/100` +
      (input.previous ? ` (was ${input.previous.score})` : ''),
  ]
  if (decision.newFindings.length) lines.push(`New: ${[['critical', c.critical], ['high', c.high], ['medium', c.medium]].filter(([, n]) => n).map(([s, n]) => `${n} ${s}`).join(', ')}`)
  for (const f of decision.newFindings.slice(0, 8)) {
    const loc = typeof f.line === 'number' && f.line > 0 ? locateLine(input.files, f.line) : null
    lines.push(`• [${f.severity.toUpperCase()}] ${f.title}${loc ? ` — ${loc.path}:${loc.line}` : ''}`)
  }
  lines.push(`Open the dashboard: ${SITE}/dashboard/`)
  return { subject, lines }
}

export async function loadAlertSettings(db: D1Database, uid: string): Promise<AlertSettings | null> {
  return db.prepare('SELECT slack_webhook_url, email, min_severity FROM alert_settings WHERE uid = ?').bind(uid).first<AlertSettings>()
}

export async function saveAlertSettings(db: D1Database, uid: string, body: { slackWebhookUrl?: unknown; email?: unknown; minSeverity?: unknown }): Promise<{ ok: true } | { ok: false; error: string }> {
  const slack = typeof body.slackWebhookUrl === 'string' && body.slackWebhookUrl.trim() ? body.slackWebhookUrl.trim() : null
  const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null
  const min = body.minSeverity === 'critical' || body.minSeverity === 'medium' ? body.minSeverity : 'high'
  if (slack && !isSlackWebhookUrl(slack)) return { ok: false, error: 'Use a Slack incoming webhook address (https://hooks.slack.com/services/…).' }
  if (email && !isEmail(email)) return { ok: false, error: 'That email address does not look right.' }
  await db.prepare(`INSERT INTO alert_settings (uid, slack_webhook_url, email, min_severity, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(uid) DO UPDATE SET slack_webhook_url = excluded.slack_webhook_url, email = excluded.email, min_severity = excluded.min_severity, updated_at = excluded.updated_at`)
    .bind(uid, slack, email, min, Date.now()).run()
  return { ok: true }
}

export async function sendScanAlerts(env: AlertEnv, input: AlertInput, fetchFn: FetchLike = fetch): Promise<'sent' | 'none'> {
  if (!env.BILLING_DB) return 'none'
  const settings = await loadAlertSettings(env.BILLING_DB, input.uid)
  if (!settings || (!settings.slack_webhook_url && !settings.email)) return 'none'
  const decision = alertDecision(input, settings.min_severity)
  if (!decision) return 'none'
  const { subject, lines } = alertText(input, decision)
  const jobs: Array<Promise<unknown>> = []
  if (settings.slack_webhook_url && isSlackWebhookUrl(settings.slack_webhook_url)) {
    jobs.push(fetchFn(settings.slack_webhook_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `*${subject}*\n${lines.join('\n')}` }) }))
  }
  if (settings.email && env.RESEND_API_KEY && env.ALERT_FROM_EMAIL) {
    jobs.push(fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.ALERT_FROM_EMAIL, to: [settings.email], subject, text: lines.join('\n') }),
    }))
  }
  const results = await Promise.allSettled(jobs)
  for (const r of results) if (r.status === 'rejected') console.error('Alert delivery failed:', r.reason instanceof Error ? r.reason.message : r.reason)
  return jobs.length ? 'sent' : 'none'
}
