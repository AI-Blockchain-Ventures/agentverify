'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/components/auth/AuthProvider'
import { Brand } from '@/components/layout/Brand'
import { apiCall } from '@/lib/v2Api'
import { AdminInsights } from '@/components/admin/AdminInsights'

interface Overview { totalUsers: number; newThisWeek: number; paying: number; payingPro: number; payingTeam: number; granted: number; referral: number; mrrCents: number | null; currency: string }
interface AdminUser {
  uid: string; email: string | null; name: string | null; company: string | null; role: string | null; teamSize: string | null; building: string[]; heardFrom: string | null
  referredBy: string | null; createdAt: number | null; lastSeenAt: number | null; plan: 'free' | 'pro' | 'team'; paidVia: 'stripe' | 'granted' | 'team-seat' | 'referral' | 'none'
  seats: number | null; until: number | null; stripeStatus: string | null; grantNote: string | null; teamOwnerEmail: string | null; scansThisMonth: number
}

const FILTERS: Array<[string, string]> = [['all', 'All users'], ['paying', 'Paying'], ['granted', 'Given by you'], ['new', 'New this week'], ['teams', 'Teams'], ['free', 'Free']]
const ROLE: Record<string, string> = { engineer: 'Engineer', security: 'Security', manager: 'Eng manager / CTO', founder: 'Founder', compliance: 'Compliance', student: 'Student', other: 'Other' }
const HEARD: Record<string, string> = { google: 'Google', github: 'GitHub', friend: 'A friend', 'reddit-hn': 'Reddit / HN', 'x-linkedin': 'X / LinkedIn', 'product-hunt': 'Product Hunt', other: 'Other' }

const date = (s: number | null) => (s ? new Date(s * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')
const money = (cents: number | null, currency: string) => (cents === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(cents / 100))

function paidViaText(u: AdminUser): string {
  if (u.paidVia === 'stripe') return `Stripe${u.stripeStatus === 'trialing' ? ' (trial)' : ''}`
  if (u.paidVia === 'granted') return `Given by you · ${u.until ? `until ${date(u.until)}` : 'no end date'}`
  if (u.paidVia === 'team-seat') return `Seat on ${u.teamOwnerEmail ?? 'a team'}`
  if (u.paidVia === 'referral') return `Referral bonus · until ${date(u.until)}`
  return '—'
}

function toCsv(users: AdminUser[]): string {
  const cols = ['email', 'name', 'company', 'role', 'teamSize', 'building', 'heardFrom', 'referredBy', 'plan', 'paidVia', 'seats', 'until', 'scansThisMonth', 'signedUp', 'lastSeen']
  // Prefix cells that start with = + - @ so spreadsheets never run them as formulas.
  const cell = (v: unknown) => { let s = v === null || v === undefined ? '' : String(v); if (/^[=+\-@]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"` }
  const rows = users.map(u => [u.email, u.name, u.company, u.role, u.teamSize, u.building.join(' '), u.heardFrom, u.referredBy, u.plan, u.paidVia, u.seats, u.until ? date(u.until) : '', u.scansThisMonth, date(u.createdAt), date(u.lastSeenAt)].map(cell).join(','))
  return [cols.join(','), ...rows].join('\n')
}

export default function AdminPage() {
  const { user, loading } = useAuth()
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (loading) return
    if (!user) { setAllowed(false); return }
    apiCall<{ admin?: boolean }>(user, '/v1/admin/me').then(r => setAllowed(r.admin === true)).catch(() => setAllowed(false))
  }, [user, loading])

  const load = useCallback(async () => {
    if (!user) return
    const params = new URLSearchParams({ filter, q, limit: '1000' })
    const [o, list] = await Promise.all([
      apiCall<Overview>(user, '/v1/admin/overview'),
      apiCall<{ total: number; users: AdminUser[] }>(user, `/v1/admin/users?${params}`),
    ])
    setOverview(o)
    setUsers(list.users)
    setTotal(list.total)
  }, [user, filter, q])

  useEffect(() => {
    if (!allowed) return
    const t = window.setTimeout(() => { void load().catch(e => setMessage({ ok: false, text: e instanceof Error ? e.message : 'Could not load users' })) }, 200)
    return () => window.clearTimeout(t)
  }, [allowed, load])

  const importUsers = async () => {
    if (!user) return
    setBusy(true)
    setMessage(null)
    try {
      const r = await apiCall<{ imported: number }>(user, '/v1/admin/import', { method: 'POST' })
      setMessage({ ok: true, text: `Checked ${r.imported} Firebase accounts. Everyone who has signed up is now listed.` })
      await load()
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'Import failed' })
    }
    setBusy(false)
  }

  const exportCsv = () => {
    const blob = new Blob([toCsv(users)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `agentverify-users-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const card = { backgroundColor: 'var(--card)', border: '1px solid var(--border)' }

  if (loading || allowed === null) {
    return <main className="flex min-h-screen items-center justify-center" style={{ backgroundColor: 'var(--bg)', color: 'var(--text-muted)' }}>Loading…</main>
  }
  if (!allowed) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center" style={{ backgroundColor: 'var(--bg)' }}>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Page not found</h1>
        <Link href="/dashboard" className="text-sm font-semibold text-[color:var(--accent-purple-text)]">Go to your dashboard →</Link>
      </main>
    )
  }

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg)' }}>
      <header style={{ backgroundColor: 'var(--card)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex h-14 w-full max-w-[1600px] items-center gap-4 px-4 md:px-8">
          <Link href="/dashboard" className="text-[15px]"><Brand size={28} /></Link>
          <span className="rounded px-2 py-0.5 text-[11px] font-bold tracking-wide text-[color:var(--accent-red-text)]" style={{ backgroundColor: 'rgba(217,45,32,0.10)' }}>ADMIN · ONLY YOU CAN SEE THIS</span>
          <Link href="/dashboard" className="ml-auto text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Back to dashboard</Link>
        </div>
      </header>

      <div className="w-full max-w-[1600px] space-y-5 px-4 py-6 md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>Users &amp; plans</h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Everyone who has signed up, how they pay, and plans you have given away.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void importUsers()} disabled={busy} className="rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-60" style={{ ...card, color: 'var(--text-primary)' }}>{busy ? 'Syncing…' : 'Sync from Firebase'}</button>
            <button onClick={exportCsv} className="rounded-md px-3 py-1.5 text-sm font-medium" style={{ ...card, color: 'var(--text-primary)' }}>Export CSV</button>
            <button onClick={() => setEditing('new')} className="rounded-md bg-[#7C3AED] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#6D28D9]">Give someone a plan</button>
          </div>
        </div>

        {message && <p className="text-sm" style={{ color: message.ok ? 'var(--accent-green-text)' : 'var(--accent-orange-text)' }}>{message.text}</p>}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['Total users', overview?.totalUsers ?? '—', overview ? `${overview.newThisWeek} new this week` : ''],
            ['Paying customers', overview?.paying ?? '—', overview ? `${overview.payingPro} Pro · ${overview.payingTeam} Team` : ''],
            ['Monthly revenue (est.)', overview ? money(overview.mrrCents, overview.currency) : '—', 'From current Stripe prices'],
            ['Free plans given', overview ? overview.granted + overview.referral : '—', overview ? `${overview.granted} by you · ${overview.referral} referral` : ''],
          ].map(([label, value, sub]) => (
            <div key={label as string} style={card} className="rounded-xl p-4">
              <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{value}</p>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>{sub}</p>
            </div>
          ))}
        </div>

        <section style={card} className="overflow-hidden rounded-xl">
          <div className="flex gap-1 overflow-x-auto px-3" style={{ borderBottom: '1px solid var(--border)' }} role="tablist" aria-label="Filter users">
            {FILTERS.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={filter === id} onClick={() => setFilter(id)} className="whitespace-nowrap px-3 py-2.5 text-sm font-medium"
                style={{ color: filter === id ? 'var(--text-primary)' : 'var(--text-muted)', borderBottom: `2px solid ${filter === id ? '#7C3AED' : 'transparent'}` }}>{label}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by email, name or company" aria-label="Search users" className="min-w-[220px] flex-1 rounded-md px-3 py-1.5 text-sm"
              style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{total} {total === 1 ? 'user' : 'users'}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--surface)', color: 'var(--text-muted)' }} className="text-xs">
                  {['User', 'Company · role', 'Plan', 'Paid via', 'Scans (month)', 'Signed up', 'Last seen', ''].map(h => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.uid} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{u.name || u.email || u.uid}</p>
                      {u.name && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{u.email}</p>}
                    </td>
                    <td className="px-4 py-2.5" style={{ color: 'var(--text-secondary)' }}>
                      {[u.company, u.role ? ROLE[u.role] ?? u.role : null].filter(Boolean).join(' · ') || '—'}
                      {(u.heardFrom || u.referredBy) && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{u.referredBy ? `Referred by ${u.referredBy}` : `Heard via ${HEARD[u.heardFrom!] ?? u.heardFrom}`}</p>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="rounded px-2 py-0.5 text-[11px] font-semibold" style={u.plan === 'free' ? { color: 'var(--text-muted)', border: '1px solid var(--border)' } : { color: 'var(--accent-purple-text)', backgroundColor: 'rgba(124,58,237,0.10)' }}>
                        {u.plan === 'team' ? `Team${u.seats ? ` · ${u.seats} seats` : ''}` : u.plan === 'pro' ? 'Pro' : 'Free'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{paidViaText(u)}</td>
                    <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--text-secondary)' }}>{u.scansThisMonth}</td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{date(u.createdAt)}</td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{date(u.lastSeenAt)}</td>
                    <td className="px-4 py-2.5 text-right"><button onClick={() => setEditing(u)} className="rounded-md px-2.5 py-1 text-xs font-medium" style={{ border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>Manage</button></td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No users here yet. Try “Sync from Firebase” to list everyone who has signed up.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {user && (
          <div>
            <h2 className="mb-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Growth, feedback &amp; errors</h2>
            <AdminInsights user={user} />
          </div>
        )}
      </div>

      {editing && user && (
        <GrantDrawer
          target={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={text => { setEditing(null); setMessage({ ok: true, text }); void load() }}
          save={body => apiCall(user, '/v1/admin/grants', { method: 'POST', body })}
        />
      )}
    </main>
  )
}

function GrantDrawer({ target, onClose, onSaved, save }: { target: AdminUser | null; onClose: () => void; onSaved: (text: string) => void; save: (body: unknown) => Promise<unknown> }) {
  const current = target?.paidVia === 'granted' ? target.plan : 'pro'
  const [plan, setPlan] = useState<'pro' | 'team' | 'none'>(current === 'free' ? 'pro' : current)
  const [email, setEmail] = useState('')
  const [seats, setSeats] = useState(target?.seats ?? 5)
  const [length, setLength] = useState(target?.paidVia === 'granted' && !target.until ? 'forever' : 'date')
  const [endDate, setEndDate] = useState(() => {
    const d = target?.paidVia === 'granted' && target.until ? new Date(target.until * 1000) : new Date(Date.now() + 90 * 86400_000)
    return d.toISOString().slice(0, 10)
  })
  const [note, setNote] = useState(target?.grantNote ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const stripePaid = target?.paidVia === 'stripe'

  const until = useMemo(() => {
    if (length === 'forever') return null
    const months = { '1m': 1, '3m': 3, '12m': 12 }[length]
    if (months) { const d = new Date(); d.setMonth(d.getMonth() + months); return Math.floor(d.getTime() / 1000) }
    return Math.floor(new Date(`${endDate}T23:59:59`).getTime() / 1000)
  }, [length, endDate])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await save({ ...(target ? { uid: target.uid } : { email }), plan, seats: plan === 'team' ? seats : undefined, until: plan === 'none' ? undefined : until, note })
      const who = target?.email ?? email
      onSaved(plan === 'none' ? `Removed the free plan for ${who}.` : `${who} now has ${plan === 'team' ? `Team (${seats} seats)` : 'Pro'}${until ? ` until ${new Date(until * 1000).toLocaleDateString()}` : ' with no end date'}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    }
    setSaving(false)
  }

  const input = { backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }
  const label = 'flex flex-col gap-1.5 text-xs font-semibold'
  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ backgroundColor: 'rgba(16,24,40,0.35)' }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-label="Give a plan" className="av-animate-slide flex h-full w-full max-w-md flex-col shadow-2xl" style={{ backgroundColor: 'var(--card)', borderLeft: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="font-semibold">Give a plan{target ? ` — ${target.name || target.email}` : ''}</h2>
          <button type="button" onClick={onClose} className="rounded-md px-2.5 py-1 text-sm" style={{ border: '1px solid var(--border-light)' }}>Close</button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {target ? (
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 rounded-lg p-3 text-sm" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <dt style={{ color: 'var(--text-muted)' }}>Email</dt><dd className="break-all">{target.email ?? '—'}</dd>
              <dt style={{ color: 'var(--text-muted)' }}>Current plan</dt><dd>{target.plan === 'free' ? 'Free' : `${target.plan === 'team' ? 'Team' : 'Pro'} — ${paidViaText(target)}`}</dd>
              <dt style={{ color: 'var(--text-muted)' }}>Signed up</dt><dd>{date(target.createdAt)}</dd>
            </dl>
          ) : (
            <label className={label}>Their account email<input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="partner@company.com" style={input} className="rounded-md px-3 py-2 text-sm font-normal" />
              <span className="font-normal" style={{ color: 'var(--text-muted)' }}>They need to have signed up first.</span></label>
          )}
          {stripePaid && <p className="rounded-md p-3 text-xs" style={{ backgroundColor: 'rgba(245,158,11,0.10)', color: 'var(--accent-orange-text)' }}>This person already pays through Stripe. A plan you give only applies if their paid plan ends.</p>}

          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold">Plan</legend>
            <div className="flex overflow-hidden rounded-md" style={{ border: '1px solid var(--border-light)' }}>
              {(['pro', 'team', 'none'] as const).map(p => (
                <button key={p} type="button" aria-pressed={plan === p} onClick={() => setPlan(p)} className="flex-1 py-2 text-sm font-medium" style={plan === p ? { backgroundColor: '#7C3AED', color: '#fff' } : { color: 'var(--text-secondary)' }}>
                  {p === 'pro' ? 'Pro' : p === 'team' ? 'Team' : 'Remove'}
                </button>
              ))}
            </div>
          </fieldset>

          {plan === 'team' && <label className={label}>Seats (people on the team, including them)<input type="number" min={2} max={100} value={seats} onChange={e => setSeats(Number(e.target.value))} style={input} className="rounded-md px-3 py-2 text-sm font-normal" /></label>}

          {plan !== 'none' && (
            <>
              <label className={label}>How long
                <select value={length} onChange={e => setLength(e.target.value)} style={input} className="rounded-md px-3 py-2 text-sm font-normal">
                  <option value="date">Until a date…</option>
                  <option value="1m">1 month</option>
                  <option value="3m">3 months</option>
                  <option value="12m">12 months</option>
                  <option value="forever">No end date</option>
                </select>
              </label>
              {length === 'date' && <label className={label}>End date<input type="date" required value={endDate} min={new Date().toISOString().slice(0, 10)} onChange={e => setEndDate(e.target.value)} style={input} className="rounded-md px-3 py-2 text-sm font-normal" /></label>}
              <label className={label}>Note (only you see this)<textarea rows={3} maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Launch partner — free Pro through year end" style={input} className="rounded-md px-3 py-2 text-sm font-normal" /></label>
            </>
          )}
          <p className="text-xs leading-5" style={{ color: 'var(--text-muted)' }}>
            {plan === 'none' ? 'They go back to Free (or to their paid plan, if they have one).' : 'It turns on the next time they open Agent Verify. Nothing is charged in Stripe. When it ends they go back to Free, or to their paid plan if they have one.'}
          </p>
          {error && <p className="text-sm text-[color:var(--accent-orange-text)]">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm" style={{ border: '1px solid var(--border-light)' }}>Cancel</button>
          <button type="submit" disabled={saving} className="rounded-md bg-[#7C3AED] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Saving…' : plan === 'none' ? 'Remove plan' : `Give ${plan === 'team' ? 'Team' : 'Pro'}`}</button>
        </div>
      </form>
    </div>
  )
}
