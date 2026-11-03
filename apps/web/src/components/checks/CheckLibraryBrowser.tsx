'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { CATEGORY_LABELS, CATEGORY_ORDER, SEVERITY_ORDER, SEVERITY_STYLE, type CheckSeverity } from '@/lib/checkLibrary'

export interface BrowserCheck {
  slug: string
  id: string
  code: string
  name: string
  category: string
  severity: CheckSeverity
  pack: string
  isNew: boolean
  summary: string
}

const SEVERITIES: CheckSeverity[] = ['critical', 'high', 'medium', 'low']

/** Search + filters for the check library. Everything is in the page already; this only hides rows. */
export function CheckLibraryBrowser({ checks }: { checks: BrowserCheck[] }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [severity, setSeverity] = useState<'all' | CheckSeverity>('all')
  const [onlyNew, setOnlyNew] = useState(false)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return checks.filter(c =>
      (category === 'all' || c.category === category) &&
      (severity === 'all' || c.severity === severity) &&
      (!onlyNew || c.isNew) &&
      (!q || `${c.name} ${c.id} ${c.code.replace(/_/g, ' ')} ${c.summary} ${CATEGORY_LABELS[c.category] ?? ''}`.toLowerCase().includes(q)))
  }, [checks, query, category, severity, onlyNew])

  const groups = CATEGORY_ORDER
    .map(cat => ({ cat, items: shown.filter(c => c.category === cat).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id)) }))
    .filter(g => g.items.length)

  const control = { backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }
  const card = { backgroundColor: 'var(--card)', border: '1px solid var(--border)' }

  return (
    <div className="mt-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <label className="flex-1">
          <span className="sr-only">Search checks</span>
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search checks — e.g. MCP, payment, LangChain, secret" style={control} className="w-full rounded-md px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]" />
        </label>
        <label>
          <span className="sr-only">Category</span>
          <select value={category} onChange={e => setCategory(e.target.value)} style={control} className="w-full rounded-md px-3 py-2.5 text-sm md:w-56">
            <option value="all">All categories</option>
            {CATEGORY_ORDER.map(cat => <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Severity</span>
          <select value={severity} onChange={e => setSeverity(e.target.value as 'all' | CheckSeverity)} style={control} className="w-full rounded-md px-3 py-2.5 text-sm md:w-40">
            <option value="all">All severities</option>
            {SEVERITIES.map(s => <option key={s} value={s}>{SEVERITY_STYLE[s].label}</option>)}
          </select>
        </label>
        <label style={{ color: 'var(--text-secondary)' }} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyNew} onChange={e => setOnlyNew(e.target.checked)} className="h-4 w-4 accent-[#7C3AED]" />
          New in 2.0
        </label>
      </div>
      <p aria-live="polite" style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">Showing {shown.length} of {checks.length} checks</p>

      {groups.length === 0 && (
        <p style={{ ...card, color: 'var(--text-secondary)' }} className="mt-6 rounded-xl p-6 text-center text-sm">No checks match. Try a different word or clear the filters.</p>
      )}

      <div className="mt-6 space-y-10">
        {groups.map(({ cat, items }) => (
          <section key={cat} aria-labelledby={`cat-${cat}`}>
            <h2 id={`cat-${cat}`} style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">{CATEGORY_LABELS[cat]} <span style={{ color: 'var(--text-muted)' }} className="text-sm font-normal">({items.length})</span></h2>
            <ul className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map(c => {
                const sev = SEVERITY_STYLE[c.severity]
                return (
                  <li key={c.slug} className="min-w-0">
                    <Link href={`/checks/${c.slug}`} style={card} className="flex h-full flex-col rounded-xl p-4 transition-colors hover:border-[#7C3AED]">
                      <span className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span style={{ color: sev.color, backgroundColor: sev.bg }} className="rounded-full px-2 py-0.5 font-semibold">{sev.label}</span>
                        <span style={{ color: 'var(--text-muted)' }} className="font-mono">{c.id}</span>
                        {c.isNew && <span className="rounded-full bg-[#7C3AED]/10 px-2 py-0.5 font-semibold text-[color:var(--accent-purple-text)]">New</span>}
                      </span>
                      <span style={{ color: 'var(--text-primary)' }} className="mt-2 text-sm font-semibold leading-5">{c.name}</span>
                      <span style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs leading-5">{c.summary}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
