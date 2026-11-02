'use client'

import { useState } from 'react'
import type { User } from 'firebase/auth'
import { apiCall, type TeamInfo } from '@/lib/v2Api'

/** Team plan seats: the owner adds/removes people by email. Shown inside the Billing tab. */
export function TeamSeats({ user, team, onChange }: { user: User; team: TeamInfo; onChange: () => void }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  if (team.role === 'member') {
    return (
      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-6 shadow-xl shadow-black/5">
        <h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold uppercase tracking-wider">Your team</h2>
        <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-sm">You have a seat on a Team plan, so you get every Pro feature. Your team&apos;s owner manages billing and seats.</p>
      </section>
    )
  }
  if (team.role !== 'owner') return null

  const add = async () => {
    setBusy(true)
    setMessage(null)
    try {
      await apiCall(user, '/v1/team/members', { method: 'POST', body: { email } })
      setEmail('')
      setMessage({ ok: true, text: `Added. They now have every Pro feature.` })
      onChange()
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'Could not add that person.' })
    }
    setBusy(false)
  }
  const remove = async (uid: string, who: string) => {
    if (!window.confirm(`Remove ${who} from your team? They go back to the Free plan.`)) return
    try {
      await apiCall(user, `/v1/team/members?uid=${encodeURIComponent(uid)}`, { method: 'DELETE' })
      onChange()
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'Could not remove that person.' })
    }
  }
  const seats = team.seats ?? 0
  const full = (team.seatsUsed ?? 1) >= seats

  return (
    <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-6 shadow-xl shadow-black/5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold uppercase tracking-wider">Team seats</h2>
        <p style={{ color: 'var(--text-muted)' }} className="text-xs">{team.seatsUsed} of {seats} seats used (including you)</p>
      </div>
      <ul className="mt-3 divide-y" style={{ borderColor: 'var(--border)' }}>
        <li className="flex items-center justify-between py-2 text-sm">
          <span style={{ color: 'var(--text-primary)' }}>{user.email ?? 'You'}</span>
          <span style={{ color: 'var(--text-muted)' }} className="text-xs">Owner</span>
        </li>
        {(team.members ?? []).map(m => (
          <li key={m.uid} className="flex items-center justify-between gap-3 py-2 text-sm" style={{ borderTop: '1px solid var(--border)' }}>
            <span style={{ color: m.active ? 'var(--text-primary)' : 'var(--text-muted)' }} className="truncate">
              {m.email}{!m.active && ' — no seat (add seats to restore)'}
            </span>
            <button onClick={() => remove(m.uid, m.email)} className="shrink-0 text-xs font-semibold text-[color:var(--accent-orange-text)] hover:underline">Remove</button>
          </li>
        ))}
      </ul>
      <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={e => { e.preventDefault(); void add() }}>
        <label htmlFor="team-email" className="sr-only">Teammate email</label>
        <input
          id="team-email"
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="teammate@company.com"
          disabled={full}
          style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
          className="min-w-0 flex-1 rounded-xl px-3 py-2 text-sm outline-none placeholder:text-[var(--input-placeholder)] focus:border-[#7C3AED]/50"
        />
        <button type="submit" disabled={busy || full || !email} className="av-press rounded-xl bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? 'Adding…' : 'Add teammate'}
        </button>
      </form>
      <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs">
        {full ? 'All seats are in use. Add seats from Manage billing.' : 'They need a free Agent Verify account with this email first.'}
      </p>
      {message && <p className="mt-2 text-xs" style={{ color: message.ok ? 'var(--accent-green-text)' : 'var(--accent-orange-text)' }}>{message.text}</p>}
    </section>
  )
}
