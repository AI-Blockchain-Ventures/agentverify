'use client'

import { useState } from 'react'
import type { User } from 'firebase/auth'
import { billingRoutes, getApiBaseUrl } from '@/lib/billing'
import type { PlanAvailability } from '@/lib/v2Api'

export function formatSeatPrice(p: NonNullable<PlanAvailability['teamSeatPrice']>): string {
  const amount = p.unitAmount / 100
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: p.currency.toUpperCase(), maximumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount)
}

/** Self-serve Team checkout with a seat picker. Only rendered when the Worker says Team checkout is on. */
export function TeamCheckout({ user, availability, onNeedSignIn }: { user: User | null; availability: PlanAvailability; onNeedSignIn: () => void }) {
  const [seats, setSeats] = useState(Math.max(3, availability.teamMinSeats))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const price = availability.teamSeatPrice

  const start = async () => {
    if (!user) return onNeedSignIn()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${getApiBaseUrl()}${billingRoutes.checkout}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'team', seats }),
      })
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (res.ok && data.url) {
        window.location.href = data.url
        return
      }
      setError(data.error ?? 'Team checkout could not start. Please try again.')
    } catch {
      setError('Team checkout could not start. Please try again.')
    }
    setBusy(false)
  }

  return (
    <div className="mt-8">
      <label htmlFor="team-seats" style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold">Seats (people on the plan, including you)</label>
      <div className="mt-1 flex items-center gap-2">
        <button type="button" aria-label="Fewer seats" onClick={() => setSeats(s => Math.max(availability.teamMinSeats, s - 1))} style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }} className="h-9 w-9 rounded-xl text-lg">−</button>
        <input
          id="team-seats"
          type="number"
          min={availability.teamMinSeats}
          max={availability.teamMaxSeats}
          value={seats}
          onChange={e => setSeats(Math.min(availability.teamMaxSeats, Math.max(availability.teamMinSeats, Number(e.target.value) || availability.teamMinSeats)))}
          style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
          className="h-9 w-16 rounded-xl text-center text-sm font-semibold"
        />
        <button type="button" aria-label="More seats" onClick={() => setSeats(s => Math.min(availability.teamMaxSeats, s + 1))} style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }} className="h-9 w-9 rounded-xl text-lg">+</button>
        {price && <span style={{ color: 'var(--text-secondary)' }} className="ml-1 text-sm">= {formatSeatPrice({ ...price, unitAmount: price.unitAmount * seats })}/{price.interval}</span>}
      </div>
      <button onClick={start} disabled={busy} className="mt-3 block w-full rounded-2xl border border-[var(--border)] px-4 py-3 text-center text-sm font-semibold text-[var(--text-primary)] transition-opacity hover:opacity-85 disabled:opacity-60">
        {busy ? 'Starting checkout…' : user ? 'Start Team' : 'Sign in to start Team'}
      </button>
      {error && <p className="mt-2 text-xs" style={{ color: 'var(--accent-orange-text)' }}>{error}</p>}
    </div>
  )
}
