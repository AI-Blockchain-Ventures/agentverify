'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { RATING_COPY, type McpRating, type McpServerEntry } from '@/lib/mcpSafety'

const FILTERS: Array<{ id: 'all' | McpRating; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'higher', label: RATING_COPY.higher.label },
  { id: 'review', label: RATING_COPY.review.label },
  { id: 'lower', label: RATING_COPY.lower.label },
]

export function McpDirectory({ servers }: { servers: McpServerEntry[] }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | McpRating>('all')
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return servers.filter(s => (filter === 'all' || s.rating === filter) && (!q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)))
  }, [servers, query, filter])

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label htmlFor="mcp-search" className="sr-only">Search MCP servers</label>
        <input
          id="mcp-search"
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by name, e.g. github, postgres, browser"
          style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
          className="w-full flex-1 rounded-2xl px-4 py-3 text-sm outline-none placeholder:text-[var(--input-placeholder)] focus:border-[#7C3AED]/50"
        />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by access">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              style={{ border: '1px solid var(--border)', backgroundColor: filter === f.id ? 'var(--text-primary)' : 'var(--surface)', color: filter === f.id ? 'var(--bg)' : 'var(--text-secondary)' }}
              className="rounded-full px-3 py-1.5 text-xs font-semibold"
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">{shown.length} of {servers.length} servers</p>
      <ul className="mt-3 grid gap-3 md:grid-cols-2">
        {shown.map(s => {
          const r = RATING_COPY[s.rating]
          return (
            <li key={s.slug}>
              <Link href={`/mcp/${s.slug}/`} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="av-hover-lift flex h-full flex-col rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <p style={{ color: 'var(--text-primary)' }} className="break-all text-sm font-semibold">{s.name}</p>
                  <span style={{ color: r.color, backgroundColor: r.bg }} className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold">{r.label}</span>
                </div>
                <p style={{ color: 'var(--text-muted)' }} className="mt-1 line-clamp-2 text-xs leading-5">{s.description || 'No description published.'}</p>
                <p style={{ color: 'var(--text-muted)' }} className="mt-auto pt-2 text-[11px]">
                  {s.capabilities.length ? s.capabilities.map(c => c.label).join(' · ') : 'No notable capabilities found'}
                </p>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
