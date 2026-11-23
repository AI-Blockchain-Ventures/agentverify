'use client'

import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { apiCall } from '@/lib/v2Api'

interface Approval { id: string; agent: string; tool: string; preview: string; reason: string; rule: string | null; status: 'pending' | 'approved' | 'denied' | 'expired'; createdAt: string; expiresAt: string; decidedAt: string | null }
interface ApprovalList { pending: Approval[]; recent: Approval[] }

const STATUS: Record<Approval['status'], { label: string; color: string }> = {
  pending: { label: 'Waiting', color: 'var(--accent-purple-text)' },
  approved: { label: 'Approved', color: 'var(--accent-green-text)' },
  denied: { label: 'Denied', color: 'var(--accent-red-text)' },
  expired: { label: 'Timed out (blocked)', color: 'var(--text-muted)' },
}

function secondsLeft(a: Approval, now: number) {
  return Math.max(0, Math.round((Date.parse(a.expiresAt) - now) / 1000))
}

/**
 * Requests from AI coding agents that are waiting for a person (auto mode, or a question Cursor can't show).
 * Checks every few seconds while the page is open; works on a phone.
 */
export function GuardApprovals({ user }: { user: User }) {
  const [data, setData] = useState<ApprovalList | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    try {
      setData(await apiCall<ApprovalList>(user, '/v1/guard/approvals'))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load approvals')
    }
  }, [user])

  useEffect(() => {
    void load()
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 4000)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [load])

  // Links in the Slack/email ping end in #approvals.
  useEffect(() => {
    if (data && window.location.hash === '#approvals') document.getElementById('approvals')?.scrollIntoView({ block: 'start' })
  }, [data])

  const decide = async (id: string, decision: 'approve' | 'deny') => {
    setBusy(id)
    try {
      await apiCall(user, `/v1/guard/approvals/${id}/decision`, { method: 'POST', body: { decision } })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your answer')
      await load()
    } finally {
      setBusy(null)
    }
  }

  const pending = (data?.pending ?? []).filter(a => secondsLeft(a, now) > 0)
  const recent = data?.recent ?? []
  if (!data || (pending.length === 0 && recent.length === 0)) return <div id="approvals" />

  const card = { backgroundColor: 'var(--card)', border: pending.length ? '2px solid #7C3AED' : '1px solid var(--border)' }
  return (
    <section id="approvals" style={card} className="scroll-mt-24 rounded-3xl p-5" aria-labelledby="approvals-title" aria-live="polite">
      <h2 id="approvals-title" style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">
        {pending.length ? `${pending.length} AI agent ${pending.length === 1 ? 'action is' : 'actions are'} waiting for you` : 'Approvals'}
      </h2>
      <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">The agent is paused until you answer. If nobody answers in time, it is blocked.</p>
      {error && <p className="mt-2 text-xs" style={{ color: 'var(--accent-orange-text)' }}>{error}</p>}

      <ul className="mt-4 space-y-3">
        {pending.map(a => (
          <li key={a.id} className="rounded-2xl p-4" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)' }}>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{a.agent} · {secondsLeft(a, now)}s left</p>
            <p className="mt-1 break-all font-mono text-sm" style={{ color: 'var(--text-primary)' }}>{a.preview}</p>
            {a.reason && <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>Needs a person because it {a.reason.replace(/\.$/, '')}.</p>}
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={busy === a.id} onClick={() => decide(a.id, 'approve')} className="min-h-[44px] flex-1 rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-50 sm:flex-none" style={{ backgroundColor: '#16A34A' }}>Approve</button>
              <button type="button" disabled={busy === a.id} onClick={() => decide(a.id, 'deny')} className="min-h-[44px] flex-1 rounded-xl px-4 text-sm font-semibold disabled:opacity-50 sm:flex-none" style={{ border: '1px solid var(--border)', color: 'var(--accent-red-text)' }}>Deny</button>
            </div>
          </li>
        ))}
      </ul>

      {recent.length > 0 && (
        <details className="mt-4" open={pending.length === 0}>
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Recent answers (last 24 hours)</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {recent.map(a => (
              <li key={a.id} className="flex flex-wrap gap-x-2" style={{ color: 'var(--text-secondary)' }}>
                <span className="font-semibold" style={{ color: STATUS[a.status].color }}>{STATUS[a.status].label}</span>
                <span className="break-all font-mono">{a.preview}</span>
                <span style={{ color: 'var(--text-muted)' }}>· {a.agent} · {new Date(a.decidedAt ?? a.expiresAt).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
