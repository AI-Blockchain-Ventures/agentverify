/**
 * Growth: referrals (a free month of Pro for each friend who signs up and runs a first scan; 14 days for the friend)
 * and the opt-in weekly email. No Stripe involvement — referral rewards are a Pro end date stored in D1.
 */
import type { D1Database } from './billing'
import type { FetchLike } from './githubApp'

export interface GrowthEnv {
  BILLING_DB?: D1Database
  RESEND_API_KEY?: string
  ALERT_FROM_EMAIL?: string
  /** Public base URL of this Worker, for unsubscribe links. */
  PUBLIC_API_URL?: string
}

const DAY = 86400
export const REFERRER_REWARD_DAYS = 30
export const REFERRED_REWARD_DAYS = 14
export const MAX_REWARDS_PER_YEAR = 12
const SITE = 'https://aimodularity.com/agentverify'
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

function randomString(len: number, alphabet = CODE_ALPHABET): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  return [...bytes].map(b => alphabet[b % alphabet.length]).join('')
}

const nowSec = () => Math.floor(Date.now() / 1000)

// ── Referrals ──

export async function getOrCreateReferralCode(db: D1Database, uid: string): Promise<string> {
  const row = await db.prepare('SELECT code FROM referral_codes WHERE uid = ?').bind(uid).first<{ code: string }>()
  if (row) return row.code
  for (let i = 0; i < 5; i++) {
    const code = randomString(8)
    const res = await db.prepare('INSERT OR IGNORE INTO referral_codes (uid, code, created_at) VALUES (?, ?, ?)').bind(uid, code, nowSec()).run()
    if ((res.meta?.changes ?? 1) > 0) return code
    const again = await db.prepare('SELECT code FROM referral_codes WHERE uid = ?').bind(uid).first<{ code: string }>()
    if (again) return again.code
  }
  throw new Error('Could not create a referral code')
}

/** Active referral Pro time for this user (unix seconds), or 0. */
export async function bonusProUntil(db: D1Database | undefined, uid: string, now = nowSec()): Promise<number> {
  if (!db) return 0
  try {
    const row = await db.prepare('SELECT until FROM bonus_pro WHERE uid = ?').bind(uid).first<{ until: number }>()
    return row && row.until > now ? row.until : 0
  } catch {
    return 0 // growth tables not created yet
  }
}

async function addBonus(db: D1Database, uid: string, days: number, countsAsReward: boolean, now: number): Promise<void> {
  const row = await db.prepare('SELECT until, rewards FROM bonus_pro WHERE uid = ?').bind(uid).first<{ until: number; rewards: number }>()
  const start = row && row.until > now ? row.until : now
  const until = start + days * DAY
  await db.prepare(`INSERT INTO bonus_pro (uid, until, rewards, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(uid) DO UPDATE SET until = excluded.until, rewards = excluded.rewards, updated_at = excluded.updated_at`)
    .bind(uid, until, (row?.rewards ?? 0) + (countsAsReward ? 1 : 0), now).run()
}

export interface ReferralSummary { code: string; link: string; invited: number; qualified: number; bonusUntil: string | null; rewardDays: number; friendDays: number }

export async function referralSummary(db: D1Database, uid: string): Promise<ReferralSummary> {
  const code = await getOrCreateReferralCode(db, uid)
  const counts = await db.prepare('SELECT COUNT(*) AS invited, SUM(CASE WHEN qualified_at IS NOT NULL THEN 1 ELSE 0 END) AS qualified FROM referrals WHERE referrer_uid = ?').bind(uid).first<{ invited: number; qualified: number | null }>()
  const until = await bonusProUntil(db, uid)
  return {
    code,
    link: `${SITE}/?ref=${code}`,
    invited: counts?.invited ?? 0,
    qualified: counts?.qualified ?? 0,
    bonusUntil: until ? new Date(until * 1000).toISOString() : null,
    rewardDays: REFERRER_REWARD_DAYS,
    friendDays: REFERRED_REWARD_DAYS,
  }
}

/**
 * A new user claims the invite they arrived with. Only accounts that have never scanned can claim (so existing users
 * can't farm rewards), nobody can refer themselves, and each account can only be referred once.
 */
export async function claimReferral(db: D1Database, uid: string, code: unknown): Promise<{ status: number; body: unknown }> {
  if (typeof code !== 'string' || !/^[a-z0-9]{6,12}$/.test(code)) return { status: 400, body: { error: 'Invalid invite code' } }
  const owner = await db.prepare('SELECT uid FROM referral_codes WHERE code = ?').bind(code).first<{ uid: string }>()
  if (!owner) return { status: 404, body: { error: 'Invite not found' } }
  if (owner.uid === uid) return { status: 400, body: { error: 'You cannot use your own invite' } }
  const scanned = await db.prepare('SELECT 1 AS x FROM usage_monthly WHERE uid = ? LIMIT 1').bind(uid).first()
  if (scanned) return { status: 409, body: { error: 'Invites are for new accounts' } }
  const res = await db.prepare('INSERT OR IGNORE INTO referrals (referred_uid, referrer_uid, created_at) VALUES (?, ?, ?)').bind(uid, owner.uid, nowSec()).run()
  if ((res.meta?.changes ?? 1) === 0) return { status: 409, body: { error: 'This account was already invited' } }
  return { status: 200, body: { ok: true, friendDays: REFERRED_REWARD_DAYS } }
}

/** Called after a user's successful scan: the first one qualifies their referral and hands out both rewards. */
export async function qualifyReferral(db: D1Database | undefined, uid: string, now = nowSec()): Promise<'rewarded' | 'none'> {
  if (!db) return 'none'
  try {
    const ref = await db.prepare('SELECT referrer_uid FROM referrals WHERE referred_uid = ? AND qualified_at IS NULL').bind(uid).first<{ referrer_uid: string }>()
    if (!ref) return 'none'
    const marked = await db.prepare('UPDATE referrals SET qualified_at = ? WHERE referred_uid = ? AND qualified_at IS NULL').bind(now, uid).run()
    if ((marked.meta?.changes ?? 1) === 0) return 'none' // another request got there first
    await addBonus(db, uid, REFERRED_REWARD_DAYS, false, now)
    const yearAgo = now - 365 * DAY
    const recent = await db.prepare('SELECT COUNT(*) AS n FROM referrals WHERE referrer_uid = ? AND qualified_at >= ?').bind(ref.referrer_uid, yearAgo).first<{ n: number }>()
    if ((recent?.n ?? 0) <= MAX_REWARDS_PER_YEAR) await addBonus(db, ref.referrer_uid, REFERRER_REWARD_DAYS, true, now)
    return 'rewarded'
  } catch (e) {
    console.error('Referral qualification failed:', e instanceof Error ? e.message : e)
    return 'none'
  }
}

// ── Weekly email ──

export async function getDigest(db: D1Database, uid: string) {
  const row = await db.prepare('SELECT email, enabled FROM digest_subscriptions WHERE uid = ?').bind(uid).first<{ email: string; enabled: number }>()
  return { enabled: row?.enabled === 1, email: row?.email ?? null }
}

export async function setDigest(db: D1Database, uid: string, accountEmail: string | undefined, body: { enabled?: unknown }): Promise<{ status: number; body: unknown }> {
  const enabled = body.enabled === true
  if (enabled && !accountEmail) return { status: 400, body: { error: 'Your account has no email address to send to.' } }
  const existing = await db.prepare('SELECT unsubscribe_token FROM digest_subscriptions WHERE uid = ?').bind(uid).first<{ unsubscribe_token: string }>()
  if (!existing) {
    if (!enabled) return { status: 200, body: { enabled: false } }
    await db.prepare('INSERT INTO digest_subscriptions (uid, email, enabled, unsubscribe_token, created_at) VALUES (?, ?, 1, ?, ?)').bind(uid, accountEmail!, randomString(32, 'abcdefghijklmnopqrstuvwxyz0123456789'), nowSec()).run()
  } else {
    await db.prepare('UPDATE digest_subscriptions SET enabled = ?, email = COALESCE(?, email) WHERE uid = ?').bind(enabled ? 1 : 0, accountEmail ?? null, uid).run()
  }
  return { status: 200, body: { enabled } }
}

export async function unsubscribe(db: D1Database, token: string): Promise<boolean> {
  if (!/^[a-z0-9]{32}$/.test(token)) return false
  const res = await db.prepare('UPDATE digest_subscriptions SET enabled = 0 WHERE unsubscribe_token = ?').bind(token).run()
  return (res.meta?.changes ?? 0) > 0
}

export interface DigestContent { subject: string; text: string; html: string }

interface RepoRow { repo_full_name: string; score: number; created_at: number; critical_count: number; high_count: number }

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Builds one person's weekly email from their monitored repos and referral progress. */
export function buildDigest(input: { repos: Array<{ repo: string; now: RepoRow; before: RepoRow | null }>; referrals: { invited: number; qualified: number; link: string }; popularMcp: Array<{ name: string; url: string; label: string }>; unsubscribeUrl: string }): DigestContent {
  const lines: string[] = []
  const html: string[] = []
  const worse = input.repos.filter(r => r.before && r.now.score < r.before.score)
  const subject = worse.length
    ? `Agent Verify weekly: ${worse.length} repo${worse.length === 1 ? '' : 's'} got riskier`
    : input.repos.length ? 'Agent Verify weekly: your agents this week' : 'Agent Verify weekly: what to check this week'
  if (input.repos.length) {
    lines.push('Your monitored repos:')
    html.push('<h2 style="font-size:16px">Your monitored repos</h2><ul>')
    for (const r of input.repos) {
      const delta = r.before ? r.now.score - r.before.score : 0
      const change = !r.before ? 'new' : delta === 0 ? 'no change' : `${delta > 0 ? '+' : ''}${delta} this week`
      const serious = r.now.critical_count + r.now.high_count
      const line = `${r.repo}: ${r.now.score}/100 (${change})${serious ? ` — ${serious} critical/high to fix` : ''}`
      lines.push(`• ${line}`)
      html.push(`<li>${esc(line)}</li>`)
    }
    html.push('</ul>')
  } else {
    lines.push('Connect a GitHub repo to get pull request checks and a weekly score here.')
    html.push(`<p>Connect a GitHub repo to get pull request checks and a weekly score here: <a href="${SITE}/dashboard/?tab=github">connect GitHub</a>.</p>`)
  }
  if (input.popularMcp.length) {
    lines.push('', 'MCP servers people are checking:')
    html.push('<h2 style="font-size:16px">MCP servers people are checking</h2><ul>')
    for (const m of input.popularMcp) {
      lines.push(`• ${m.name} — ${m.label}: ${m.url}`)
      html.push(`<li><a href="${esc(m.url)}">${esc(m.name)}</a> — ${esc(m.label)}</li>`)
    }
    html.push('</ul>')
  }
  const refLine = input.referrals.qualified
    ? `You've earned ${input.referrals.qualified} free month${input.referrals.qualified === 1 ? '' : 's'} of Pro from invites. Keep going: ${input.referrals.link}`
    : `Get a free month of Pro for each friend who signs up and runs a scan: ${input.referrals.link}`
  lines.push('', refLine, '', `Open your dashboard: ${SITE}/dashboard/`, '', `Unsubscribe: ${input.unsubscribeUrl}`)
  html.push(`<p>${esc(refLine.split(': ')[0])}: <a href="${esc(input.referrals.link)}">${esc(input.referrals.link)}</a></p>`)
  html.push(`<p><a href="${SITE}/dashboard/">Open your dashboard</a></p>`)
  html.push(`<p style="color:#888;font-size:12px">You get this because you turned on the weekly email in Agent Verify. <a href="${esc(input.unsubscribeUrl)}">Unsubscribe</a> in one click.</p>`)
  return { subject, text: lines.join('\n'), html: `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#111">${html.join('')}</div>` }
}

/** True during the weekly send window: Mondays 14:00–14:59 UTC. */
export function inDigestWindow(date = new Date()): boolean {
  return date.getUTCDay() === 1 && date.getUTCHours() === 14
}

/**
 * Sends the weekly email to up to `batch` subscribers who haven't had one in 6 days. Called from the cron every
 * minute during the window, so a large list is worked through in small batches.
 */
export async function sendDigestBatch(env: GrowthEnv, popularMcp: Array<{ name: string; url: string; label: string }>, fetchFn: FetchLike = fetch, batch = 25, now = nowSec()): Promise<number> {
  const db = env.BILLING_DB
  if (!db || !env.RESEND_API_KEY || !env.ALERT_FROM_EMAIL) return 0
  const due = (await db.prepare('SELECT uid, email, unsubscribe_token FROM digest_subscriptions WHERE enabled = 1 AND (last_sent_at IS NULL OR last_sent_at < ?) LIMIT ?').bind(now - 6 * DAY, batch).all<{ uid: string; email: string; unsubscribe_token: string }>()).results ?? []
  let sent = 0
  for (const sub of due) {
    // Mark first, so a slow or failed send is never retried into a duplicate email this week.
    await db.prepare('UPDATE digest_subscriptions SET last_sent_at = ? WHERE uid = ?').bind(now, sub.uid).run()
    const installs = (await db.prepare('SELECT installation_id FROM github_installations WHERE linked_uid = ?').bind(sub.uid).all<{ installation_id: number }>().catch(() => ({ results: [] }))).results ?? []
    const repos: Array<{ repo: string; now: RepoRow; before: RepoRow | null }> = []
    for (const { installation_id } of installs) {
      const latest = (await db.prepare(`SELECT repo_full_name, score, created_at, critical_count, high_count FROM repo_scans WHERE installation_id = ? AND trigger = 'push' ORDER BY created_at DESC LIMIT 200`).bind(installation_id).all<RepoRow>()).results ?? []
      const seen = new Set<string>()
      for (const row of latest) {
        if (seen.has(row.repo_full_name)) continue
        seen.add(row.repo_full_name)
        const before = latest.find(r => r.repo_full_name === row.repo_full_name && r.created_at <= now * 1000 - 7 * DAY * 1000) ?? null
        repos.push({ repo: row.repo_full_name, now: row, before })
        if (repos.length >= 10) break
      }
    }
    const summary = await referralSummary(db, sub.uid)
    const base = env.PUBLIC_API_URL ?? 'https://agentverify-api.agentverify.workers.dev'
    const content = buildDigest({ repos, referrals: summary, popularMcp, unsubscribeUrl: `${base}/v1/digest/unsubscribe?token=${sub.unsubscribe_token}` })
    try {
      const res = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.ALERT_FROM_EMAIL, to: [sub.email], subject: content.subject, text: content.text, html: content.html, headers: { 'List-Unsubscribe': `<${base}/v1/digest/unsubscribe?token=${sub.unsubscribe_token}>` } }),
      })
      if (res.ok) sent++
    } catch (e) {
      console.error('Weekly email failed:', e instanceof Error ? e.message : e)
    }
  }
  return sent
}

export const POPULAR_MCP_FOR_EMAIL = [
  { name: '@modelcontextprotocol/server-filesystem', url: `${SITE}/mcp/modelcontextprotocol-server-filesystem/`, label: 'can change files' },
  { name: '@playwright/mcp', url: `${SITE}/mcp/playwright-mcp/`, label: 'drives a browser' },
  { name: 'chrome-devtools-mcp', url: `${SITE}/mcp/chrome-devtools-mcp/`, label: 'can run commands' },
]
