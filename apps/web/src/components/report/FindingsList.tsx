'use client'

import { useMemo, useState } from 'react'
import type { Finding, Severity } from '@/types'
import { FindingCard } from '@/components/scanner/FindingCard'
import { isNewInV16 } from '@/lib/release'

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low']
const SEVERITY_LABEL: Record<Severity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }
const SEVERITY_ACTIVE: Record<Severity, string> = {
  critical: 'bg-[#E03E3E] text-white border-[#E03E3E]',
  high: 'bg-[#E07B39] text-white border-[#E07B39]',
  medium: 'bg-[#EAB308] text-[#1a1a1a] border-[#EAB308]',
  low: 'bg-[#06B6D4] text-[#06202a] border-[#06B6D4]',
}
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 }

/**
 * v1.6 findings list: filter by severity, search by text, and expand/collapse every card at once.
 * Pure presentation over the same normalized findings every report view already uses — it never
 * hides a finding permanently (filters are visible and reset with one click).
 */
export function FindingsList({
  findings,
  showFullRemediation,
  showCorrectedSnippets,
  showA2spaGuidance,
}: {
  findings: Finding[]
  showFullRemediation: boolean
  showCorrectedSnippets: boolean
  showA2spaGuidance: boolean
}) {
  const [severity, setSeverity] = useState<Severity | 'all' | 'new'>('all')
  const [query, setQuery] = useState('')
  const [expandAll, setExpandAll] = useState(false)
  const [expandVersion, setExpandVersion] = useState(0)

  const counts = useMemo(() => {
    const c: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 }
    for (const f of findings) if (f.severity in c) c[f.severity] += 1
    return c
  }, [findings])
  const newCount = useMemo(() => findings.filter(f => isNewInV16(f.code)).length, [findings])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return findings
      .filter(f => severity === 'all' || (severity === 'new' ? isNewInV16(f.code) : f.severity === severity))
      .filter(f => !q || [f.title, f.whatIsWrong, f.code, f.evidence ?? '', f.recommendedFix].some(v => v.toLowerCase().includes(q)))
      .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9))
  }, [findings, severity, query])

  const toggleAll = () => {
    setExpandAll(v => !v)
    setExpandVersion(v => v + 1)
  }

  const chip = (active: boolean, activeClass: string) =>
    `rounded-full border px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-85 ${active ? activeClass : 'border-[var(--border)] bg-[var(--card)] text-[var(--text-secondary)]'}`

  return (
    <div>
      <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between print:hidden">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter findings by severity">
          <button onClick={() => setSeverity('all')} aria-pressed={severity === 'all'} className={chip(severity === 'all', 'bg-[var(--text-primary)] text-[var(--bg)] border-[var(--text-primary)]')}>
            All {findings.length}
          </button>
          {SEVERITIES.filter(s => counts[s] > 0).map(s => (
            <button key={s} onClick={() => setSeverity(s)} aria-pressed={severity === s} className={chip(severity === s, SEVERITY_ACTIVE[s])}>
              {SEVERITY_LABEL[s]} {counts[s]}
            </button>
          ))}
          {newCount > 0 && (
            <button onClick={() => setSeverity('new')} aria-pressed={severity === 'new'} className={chip(severity === 'new', 'bg-[#7C3AED] text-white border-[#7C3AED]')}>
              New in v1.6 {newCount}
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search findings..."
            aria-label="Search findings"
            style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
            className="w-full rounded-xl px-3 py-2 text-xs outline-none md:w-48"
          />
          <button onClick={toggleAll} style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }} className="shrink-0 rounded-xl px-3 py-2 text-xs font-semibold transition-opacity hover:opacity-70">
            {expandAll ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-xl p-6 text-center">
          <p style={{ color: 'var(--text-muted)' }} className="text-sm">No findings match this filter.</p>
          <button onClick={() => { setSeverity('all'); setQuery('') }} className="mt-2 text-xs font-semibold text-[color:var(--accent-purple-text)] underline-offset-2 hover:underline">Show all findings</button>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(finding => (
            <FindingCard
              key={`${finding.id}-${expandVersion}`}
              finding={finding}
              defaultOpen={expandAll}
              showFullRemediation={showFullRemediation}
              showCorrectedSnippets={showCorrectedSnippets}
              showA2spaGuidance={showA2spaGuidance}
            />
          ))}
        </div>
      )}
      {visible.length !== findings.length && visible.length > 0 && (
        <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs">Showing {visible.length} of {findings.length} findings.</p>
      )}
    </div>
  )
}
