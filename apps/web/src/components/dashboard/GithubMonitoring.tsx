'use client'

import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { getApiBaseUrl } from '@/lib/billing'
import { VcsConnections } from './VcsConnections'
import { apiCall, type AlertSettings, type GithubConfig, type GithubInstallations, type RepoScan } from '@/lib/v2Api'

const STATE_KEY = 'av-github-link-state'

function randomState(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
}

function scoreColor(score: number): string {
  return score >= 80 ? 'var(--accent-green-text)' : score >= 50 ? 'var(--accent-orange-text)' : 'var(--accent-red-text)'
}

/** Small score-over-time line for a repo (one point per default-branch scan). */
function Sparkline({ points }: { points: Array<{ score: number }> }) {
  if (points.length < 2) return <span style={{ color: 'var(--text-muted)' }} className="text-xs">History appears after the next push</span>
  const w = 160
  const h = 36
  const step = w / (points.length - 1)
  const y = (s: number) => h - 2 - (Math.max(0, Math.min(100, s)) / 100) * (h - 4)
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ')
  const last = points[points.length - 1].score
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Security score over the last ${points.length} scans, now ${last}`}>
      <path d={d} fill="none" stroke={scoreColor(last)} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={(points.length - 1) * step} cy={y(last)} r="3" fill={scoreColor(last)} />
    </svg>
  )
}

function counts(s: RepoScan): string {
  const parts = [['critical', s.critical_count], ['high', s.high_count], ['medium', s.medium_count]].filter(([, n]) => Number(n) > 0).map(([k, n]) => `${n} ${k}`)
  return parts.length ? parts.join(', ') : 'no critical/high/medium'
}

export function GithubMonitoring({ user }: { user: User }) {
  const [config, setConfig] = useState<GithubConfig | null>(null)
  const [data, setData] = useState<GithubInstallations | null>(null)
  const [alerts, setAlerts] = useState<AlertSettings | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [pendingLink, setPendingLink] = useState<{ installationId: number; code: string } | null>(null)
  const [needsConnect, setNeedsConnect] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      setData(await apiCall<GithubInstallations>(user, '/v1/github/installations'))
    } catch {
      setData({ installations: [], repos: [] })
    }
    try {
      setAlerts(await apiCall<AlertSettings>(user, '/v1/alerts/settings'))
    } catch {
      setAlerts({ slackWebhookUrl: '', email: '', minSeverity: 'high', emailAvailable: false })
    }
  }, [user])

  const link = useCallback(async (installationId: number, code: string) => {
    try {
      await apiCall(user, '/v1/github/link', { method: 'POST', body: { installationId, code } })
      setNotice({ ok: true, text: 'Connected. Pull requests are now scanned automatically, and pushes to your main branch are monitored.' })
      setPendingLink(null)
      await load()
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : 'Could not connect that installation.' })
    }
  }, [user, load])

  useEffect(() => {
    const fallback: GithubConfig = { configured: false, installUrl: '', scansPerMonth: { unlinked: 50, free: 50, pro: 1000 } }
    // Only trust a response that really is the GitHub config (an older API answers 404 with { error }).
    fetch(`${getApiBaseUrl()}/v1/github/config`)
      .then(async r => {
        const body = await r.json().catch(() => null) as Partial<GithubConfig> | null
        setConfig(r.ok && body && typeof body.configured === 'boolean' && body.scansPerMonth ? body as GithubConfig : fallback)
      })
      .catch(() => setConfig(fallback))
    void load()
    // Coming back from GitHub (after installing, or after "Connect"): ?code=…&installation_id=…&state=…
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const fromPr = Number(params.get('github_installation'))
    let expected: string | null = null
    try { expected = sessionStorage.getItem(STATE_KEY) } catch { /* storage blocked */ }
    if (code) {
      const state = params.get('state') ?? ''
      const [stateId, stateNonce] = state.split('.')
      const installationId = Number(params.get('installation_id') ?? stateId)
      const clean = new URL(window.location.href)
      for (const k of ['code', 'installation_id', 'setup_action', 'state']) clean.searchParams.delete(k)
      window.history.replaceState(null, '', clean.toString())
      if (Number.isInteger(installationId) && installationId > 0) {
        // Only link without asking when this browser started the flow (state matches); otherwise ask first.
        if (expected && stateNonce === expected) void link(installationId, code)
        else setPendingLink({ installationId, code })
      }
      try { sessionStorage.removeItem(STATE_KEY) } catch { /* ignore */ }
    } else if (Number.isInteger(fromPr) && fromPr > 0) {
      setNeedsConnect(fromPr)
    }
  }, [load, link])

  const startInstall = () => {
    if (!config?.installUrl) return
    const nonce = randomState()
    try { sessionStorage.setItem(STATE_KEY, nonce) } catch { /* ignore */ }
    window.location.href = `${config.installUrl}?state=${encodeURIComponent(`0.${nonce}`)}`
  }

  const startConnect = (installationId: number) => {
    if (!config?.clientId) return
    const nonce = randomState()
    try { sessionStorage.setItem(STATE_KEY, nonce) } catch { /* ignore */ }
    window.location.href = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(config.clientId)}&state=${encodeURIComponent(`${installationId}.${nonce}`)}`
  }

  const saveAlerts = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!alerts) return
    setSaving(true)
    try {
      await apiCall(user, '/v1/alerts/settings', { method: 'POST', body: alerts })
      setNotice({ ok: true, text: 'Alert settings saved.' })
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Could not save alert settings.' })
    }
    setSaving(false)
  }

  const card = { backgroundColor: 'var(--card)', border: '1px solid var(--border)' }
  const input = { backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }
  const installed = (data?.installations.length ?? 0) > 0

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {notice && (
        <div role="status" className="rounded-2xl px-4 py-3 text-sm" style={{ ...card, color: notice.ok ? 'var(--accent-green-text)' : 'var(--accent-orange-text)' }}>{notice.text}</div>
      )}

      {pendingLink && (
        <section style={card} className="rounded-3xl p-6">
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Connect GitHub installation #{pendingLink.installationId} to your Agent Verify account?</p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">Only continue if you just installed Agent Verify on GitHub yourself.</p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => void link(pendingLink.installationId, pendingLink.code)} className="av-press rounded-xl bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white">Connect</button>
            <button onClick={() => setPendingLink(null)} style={{ color: 'var(--text-muted)' }} className="rounded-xl px-4 py-2 text-sm">Cancel</button>
          </div>
        </section>
      )}

      {needsConnect && !pendingLink && (
        <section style={card} className="rounded-3xl p-6">
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Connect your repos to this account</p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">Sign in with GitHub to confirm you can access installation #{needsConnect}. Then pull request comments include fixes on Pro, and pushes to your main branch are monitored.</p>
          <button onClick={() => startConnect(needsConnect)} disabled={!config?.clientId} className="av-press mt-3 rounded-xl bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Connect with GitHub</button>
        </section>
      )}

      <section style={card} className="rounded-3xl p-6 shadow-xl shadow-black/5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">Agent Verify for GitHub</h2>
            <ul style={{ color: 'var(--text-muted)' }} className="mt-2 space-y-1 text-sm">
              <li>✓ Scans every pull request that changes agent code, prompts, tools or MCP config</li>
              <li>✓ Pass/fail check and inline notes on the risky lines</li>
              <li>✓ One comment per PR, updated on every push (fixes included on Pro)</li>
              <li>✓ Monitors your main branch: score history and alerts on new risks</li>
            </ul>
            {config && <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs">{config.scansPerMonth.free} PR scans a month on Free, {config.scansPerMonth.pro} on Pro and Team.</p>}
          </div>
          {config?.configured ? (
            <button onClick={startInstall} className="av-press shrink-0 rounded-xl bg-[#7C3AED] px-4 py-2.5 text-sm font-semibold text-white">{installed ? 'Add more repos' : 'Install on GitHub'}</button>
          ) : (
            <span style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }} className="shrink-0 rounded-full px-3 py-1 text-xs">Available soon</span>
          )}
        </div>
      </section>

      {installed && (
        <section style={card} className="rounded-3xl p-6 shadow-xl shadow-black/5">
          <h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold uppercase tracking-wider">Monitored repos</h2>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">
            {data!.installations.map(i => `${i.account_login} (${i.scansThisMonth} scans this month)`).join(' · ')}
          </p>
          {data!.repos.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }} className="mt-4 text-sm">No scans yet. Open a pull request that changes agent code, or push to your main branch.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {data!.repos.map(r => (
                <div key={r.repo} style={{ border: '1px solid var(--border)' }} className="rounded-2xl p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <a href={`https://github.com/${r.repo}`} target="_blank" rel="noreferrer" style={{ color: 'var(--text-primary)' }} className="truncate text-sm font-semibold hover:underline">{r.repo}</a>
                      <p style={{ color: 'var(--text-muted)' }} className="text-xs">Latest: {counts(r.latest)} · {new Date(r.latest.created_at).toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <Sparkline points={r.history} />
                      <span className="text-2xl font-semibold tabular-nums" style={{ color: scoreColor(r.latest.score) }}>{r.latest.score}</span>
                    </div>
                  </div>
                  {r.recentPrs.length > 0 && (
                    <ul className="mt-3 space-y-1">
                      {r.recentPrs.map(p => (
                        <li key={`${p.pr_number}-${p.commit_sha}`} className="flex justify-between gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                          <a href={`https://github.com/${r.repo}/pull/${p.pr_number}`} target="_blank" rel="noreferrer" className="hover:underline">PR #{p.pr_number} · {p.commit_sha.slice(0, 7)}</a>
                          <span><span style={{ color: scoreColor(p.score) }}>{p.score}/100</span> · {counts(p)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <VcsConnections user={user} />

      {alerts && (
        <form onSubmit={saveAlerts} style={card} className="rounded-3xl p-6 shadow-xl shadow-black/5">
          <h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold uppercase tracking-wider">Alerts</h2>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">Get told when a monitored repo&apos;s main branch gains a new risk, or its score drops by 10 or more. Known issues don&apos;t repeat.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              Slack incoming webhook
              <input value={alerts.slackWebhookUrl} onChange={e => setAlerts({ ...alerts, slackWebhookUrl: e.target.value })} placeholder="https://hooks.slack.com/services/…" style={input} className="mt-1 w-full rounded-xl px-3 py-2 text-sm font-normal outline-none" />
            </label>
            <label className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              Email {alerts.emailAvailable ? '' : '(coming soon)'}
              <input type="email" value={alerts.email} disabled={!alerts.emailAvailable} onChange={e => setAlerts({ ...alerts, email: e.target.value })} placeholder={user.email ?? 'you@company.com'} style={input} className="mt-1 w-full rounded-xl px-3 py-2 text-sm font-normal outline-none disabled:opacity-50" />
            </label>
            <label className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              Alert me about
              <select value={alerts.minSeverity} onChange={e => setAlerts({ ...alerts, minSeverity: e.target.value as AlertSettings['minSeverity'] })} style={input} className="mt-1 w-full rounded-xl px-3 py-2 text-sm font-normal outline-none">
                <option value="critical">Critical only</option>
                <option value="high">High and critical</option>
                <option value="medium">Medium and above</option>
              </select>
            </label>
          </div>
          <button type="submit" disabled={saving} className="av-press mt-4 rounded-xl bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save alerts'}</button>
        </form>
      )}
    </div>
  )
}
