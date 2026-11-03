'use client'

import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { apiCall } from '@/lib/v2Api'

interface FunnelData { days: number; steps: Array<{ id: string; label: string; count: number }>; daily: Array<{ day: string; demoScans: number; signups: number }> }
interface FeedbackRow { id: string; uid: string; email: string | null; kind: string; message: string; page: string | null; status: string; created_at: number }
interface ErrorRow { fingerprint: string; source: string; message: string; stack: string | null; path: string | null; user_agent: string | null; count: number; first_seen: number; last_seen: number }

const TABS = [['funnel', 'Growth funnel'], ['feedback', 'Feedback'], ['errors', 'Errors']] as const
type Tab = (typeof TABS)[number][0]

const when = (sec: number) => new Date(sec * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : '—')

/** Admin-only: signup funnel, in-app feedback and error reports. */
export function AdminInsights({ user }: { user: User }) {
  const [tab, setTab] = useState<Tab>('funnel')
  const [days, setDays] = useState(30)
  const [funnel, setFunnel] = useState<FunnelData | null>(null)
  const [feedback, setFeedback] = useState<FeedbackRow[] | null>(null)
  const [errors, setErrors] = useState<ErrorRow[] | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [problem, setProblem] = useState('')

  const load = useCallback(async () => {
    setProblem('')
    try {
      if (tab === 'funnel') setFunnel(await apiCall<FunnelData>(user, `/v1/admin/funnel?days=${days}`))
      if (tab === 'feedback') setFeedback((await apiCall<{ feedback: FeedbackRow[] }>(user, '/v1/admin/feedback')).feedback)
      if (tab === 'errors') setErrors((await apiCall<{ errors: ErrorRow[] }>(user, '/v1/admin/errors')).errors)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not load this section.')
    }
  }, [tab, days, user])

  useEffect(() => { void load() }, [load])

  const markFeedback = async (id: string, status: 'new' | 'done') => {
    setFeedback(rows => rows?.map(r => (r.id === id ? { ...r, status } : r)) ?? null)
    try { await apiCall(user, '/v1/admin/feedback/status', { method: 'POST', body: { id, status } }) } catch { void load() }
  }

  const card = { backgroundColor: 'var(--card)', border: '1px solid var(--border)' }
  const muted = { color: 'var(--text-muted)' }
  const newFeedback = feedback?.filter(f => f.status === 'new').length ?? 0

  return (
    <section style={card} className="overflow-hidden rounded-xl">
      <div className="flex flex-wrap items-center gap-1 px-3" style={{ borderBottom: '1px solid var(--border)' }} role="tablist" aria-label="Insights">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className="whitespace-nowrap px-3 py-2.5 text-sm font-medium"
            style={{ color: tab === id ? 'var(--text-primary)' : 'var(--text-muted)', borderBottom: `2px solid ${tab === id ? '#7C3AED' : 'transparent'}` }}>
            {label}{id === 'feedback' && newFeedback > 0 ? ` (${newFeedback} new)` : ''}
          </button>
        ))}
        <button onClick={() => void load()} className="ml-auto rounded-md px-2.5 py-1 text-xs font-medium" style={{ border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>Refresh</button>
      </div>

      <div className="p-4">
        {problem && <p className="mb-3 text-sm text-[color:var(--accent-orange-text)]">{problem}</p>}

        {tab === 'funnel' && (
          <div>
            <div className="mb-4 flex items-center gap-2 text-sm" style={muted}>
              <label htmlFor="funnel-days">Accounts created in the last</label>
              <select id="funnel-days" value={days} onChange={e => setDays(Number(e.target.value))} className="rounded-md px-2 py-1 text-sm" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}>
                {[7, 30, 90].map(d => <option key={d} value={d}>{d} days</option>)}
              </select>
            </div>
            {!funnel ? <p className="text-sm" style={muted}>Loading…</p> : (
              <>
                <ol className="space-y-2.5">
                  {funnel.steps.map((s, i) => {
                    const base = funnel.steps[1]?.count ?? 0
                    const max = Math.max(1, ...funnel.steps.map(x => x.count))
                    return (
                      <li key={s.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[220px_minmax(0,1fr)_120px]">
                        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{s.label}</span>
                        <span className="col-span-2 row-start-2 h-3 sm:col-span-1 sm:row-start-auto" style={{ backgroundColor: 'var(--surface)', borderRadius: 4 }}>
                          <span title={`${s.label}: ${s.count}`} className="block h-3" style={{ width: `${Math.max(1, (s.count / max) * 100)}%`, backgroundColor: '#7C3AED', borderRadius: 4 }} />
                        </span>
                        <span className="text-right text-sm tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                          {s.count.toLocaleString('en-US')}{i >= 2 && <span className="ml-1 text-xs" style={muted}>({pct(s.count, base)} of new)</span>}
                        </span>
                      </li>
                    )
                  })}
                </ol>
                <p className="mt-4 text-xs" style={muted}>Steps 3–6 count accounts created in this window that went on to do each thing. Demo scans are anonymous daily totals.</p>
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Day by day</summary>
                  <div className="mt-2 max-h-72 overflow-auto" tabIndex={0} role="region" aria-label="Day by day">
                    <table className="w-full text-left text-sm">
                      <thead><tr className="text-xs" style={muted}><th className="py-1 pr-4 font-medium">Day</th><th className="py-1 pr-4 font-medium">Demo scans</th><th className="py-1 font-medium">New accounts</th></tr></thead>
                      <tbody>
                        {[...funnel.daily].reverse().map(d => (
                          <tr key={d.day} style={{ borderTop: '1px solid var(--border)' }}><td className="py-1 pr-4" style={muted}>{d.day}</td><td className="py-1 pr-4 tabular-nums">{d.demoScans}</td><td className="py-1 tabular-nums">{d.signups}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </div>
        )}

        {tab === 'feedback' && (
          !feedback ? <p className="text-sm" style={muted}>Loading…</p> : feedback.length === 0 ? <p className="text-sm" style={muted}>No feedback yet. Users send it with the Feedback button in the dashboard.</p> : (
            <ul className="space-y-3">
              {feedback.map(f => (
                <li key={f.id} className="rounded-lg p-3" style={{ border: '1px solid var(--border)', opacity: f.status === 'done' ? 0.6 : 1 }}>
                  <div className="flex flex-wrap items-center gap-2 text-xs" style={muted}>
                    <span className="rounded px-1.5 py-0.5 font-semibold" style={{ color: f.kind === 'bug' ? 'var(--accent-red-text)' : 'var(--accent-purple-text)', backgroundColor: 'var(--surface)' }}>{f.kind === 'bug' ? 'Bug' : f.kind === 'idea' ? 'Idea' : 'Other'}</span>
                    <span>{f.email ?? f.uid}</span>
                    {f.page && <span>· {f.page}</span>}
                    <span>· {when(f.created_at)}</span>
                    <span className="ml-auto flex gap-2">
                      {f.email && <a href={`mailto:${f.email}?subject=${encodeURIComponent('Re: your Agent Verify feedback')}`} className="font-semibold text-[color:var(--accent-purple-text)]">Reply</a>}
                      <button onClick={() => void markFeedback(f.id, f.status === 'done' ? 'new' : 'done')} className="font-semibold" style={{ color: 'var(--text-primary)' }}>{f.status === 'done' ? 'Reopen' : 'Mark done'}</button>
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm" style={{ color: 'var(--text-primary)' }}>{f.message}</p>
                </li>
              ))}
            </ul>
          )
        )}

        {tab === 'errors' && (
          !errors ? <p className="text-sm" style={muted}>Loading…</p> : errors.length === 0 ? <p className="text-sm" style={muted}>No errors recorded. New ones are emailed to you the first time they happen.</p> : (
            <ul className="space-y-2">
              {errors.map(e => (
                <li key={e.fingerprint} className="rounded-lg" style={{ border: '1px solid var(--border)' }}>
                  <button onClick={() => setOpenError(openError === e.fingerprint ? null : e.fingerprint)} aria-expanded={openError === e.fingerprint} className="flex w-full flex-wrap items-center gap-2 p-3 text-left text-sm">
                    <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: 'var(--surface)', color: 'var(--text-secondary)' }}>{e.source === 'web' ? 'Website' : 'API'}</span>
                    <span className="min-w-0 flex-1 truncate font-medium" style={{ color: 'var(--text-primary)' }}>{e.message}</span>
                    <span className="text-xs tabular-nums" style={muted}>{e.count}× · last {when(e.last_seen)}</span>
                  </button>
                  {openError === e.fingerprint && (
                    <div className="px-3 pb-3 text-xs" style={muted}>
                      <p>Where: {e.path ?? 'unknown'} · first seen {when(e.first_seen)}</p>
                      {e.user_agent && <p className="mt-1 break-all">Browser: {e.user_agent}</p>}
                      {e.stack && <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded p-2 font-mono text-[11px]" style={{ backgroundColor: 'var(--surface)', color: 'var(--text-secondary)' }} tabIndex={0}>{e.stack}</pre>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </section>
  )
}
