'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/components/auth/AuthProvider'
import { apiCall } from '@/lib/v2Api'

/** Opt-in weekly email switch, shown in Settings. */
export function WeeklyEmailToggle() {
  const { user } = useAuth()
  const [state, setState] = useState<{ enabled: boolean; available: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    apiCall<{ enabled: boolean; available: boolean }>(user, '/v1/digest').then(setState).catch(() => setState(null))
  }, [user])

  if (!user || !state) return null
  const toggle = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await apiCall<{ enabled: boolean }>(user, '/v1/digest', { method: 'POST', body: { enabled: !state.enabled } })
      setState({ ...state, enabled: res.enabled })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update.')
    }
    setBusy(false)
  }

  return (
    <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-6 shadow-xl shadow-black/5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">Weekly email</h2>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">
            Monday summary of your monitored repos&apos; security scores, new risks, and MCP servers worth checking. Sent to {user.email}. Unsubscribe any time.
          </p>
          {!state.available && <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">Sending starts soon — your choice is saved.</p>}
          {error && <p className="mt-1 text-xs" style={{ color: 'var(--accent-orange-text)' }}>{error}</p>}
        </div>
        <button
          role="switch"
          aria-checked={state.enabled}
          aria-label="Weekly email"
          disabled={busy}
          onClick={toggle}
          style={{ backgroundColor: state.enabled ? '#7C3AED' : 'var(--surface)', border: '1px solid var(--border)' }}
          className="relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60"
        >
          <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: state.enabled ? '1.5rem' : '0.25rem' }} />
        </button>
      </div>
    </section>
  )
}
