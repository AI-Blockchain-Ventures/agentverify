'use client'

import { useEffect, useMemo, useState } from 'react'
import type { User } from 'firebase/auth'
import { getReports } from '@/lib/scanStore'
import { groupReportsByAgent, agentGroupSlug, type AgentGroup } from '@/lib/agentGrouping'
import { compareReports } from '@/lib/compareReports'
import { normalizeVerdict, verdictLabel } from '@/lib/verdict'
import type { StoredReport } from '@/types'

const reportScore = (r: StoredReport) => r.riskScore ?? r.result?.riskScore ?? 0
const findingsOf = (r: StoredReport) => (Array.isArray(r.findings) ? r.findings : Array.isArray(r.result?.findings) ? r.result.findings : []) as Array<{ severity?: string }>
const countBy = (r: StoredReport, sev: string) => findingsOf(r).filter(f => f.severity === sev).length

type SortKey = 'newest' | 'score_asc' | 'score_desc' | 'name'
type StatusFilter = 'all' | 'verified' | 'not_verified'

/**
 * "Here is my organization's AI agent inventory" — one row per real, name-detected agent
 * (standalone/unnamed reports are intentionally excluded here, same identity rule as everywhere
 * else: never group or list under a guessed name).
 */
export function AgentsInventory({ user, onOpenAgent }: { user: User; onOpenAgent: (slug: string) => void }) {
  const [reports, setReports] = useState<StoredReport[] | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<SortKey>('newest')

  useEffect(() => {
    let cancelled = false
    getReports(user.uid).then(list => { if (!cancelled) setReports(list) }).catch(() => { if (!cancelled) setReports([]) })
    return () => { cancelled = true }
  }, [user.uid])

  const namedGroups = useMemo(
    () => (reports ? groupReportsByAgent(reports).filter(g => g.agentName !== null) : []),
    [reports]
  )

  const rows = useMemo(() => {
    return namedGroups.map(g => {
      const latest = g.reports[0]
      const previous = g.reports[1]
      const change = previous ? compareReports(previous, latest) : null
      return {
        group: g,
        latest,
        verdict: normalizeVerdict(latest.verdict),
        score: reportScore(latest),
        critical: countBy(latest, 'critical'),
        high: countBy(latest, 'high'),
        capabilities: latest.capabilities?.length ?? 0,
        mcpCount: latest.mcpExposures?.length ?? 0,
        version: latest.scannerVersion ?? 'Unknown',
        scanCount: g.reports.length,
        scoreChange: change?.scoreChange ?? null,
      }
    })
  }, [namedGroups])

  const filtered = useMemo(() => {
    let list = rows
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter(r => r.group.displayName.toLowerCase().includes(q))
    }
    if (status !== 'all') {
      list = list.filter(r => (status === 'verified' ? r.verdict === 'VERIFIED' : r.verdict !== 'VERIFIED'))
    }
    const sorted = [...list].sort((a, b) => {
      if (sort === 'name') return a.group.displayName.localeCompare(b.group.displayName)
      if (sort === 'score_asc') return a.score - b.score
      if (sort === 'score_desc') return b.score - a.score
      return new Date(b.latest.scannedAt ?? 0).getTime() - new Date(a.latest.scannedAt ?? 0).getTime()
    })
    return sorted
  }, [rows, query, status, sort])

  if (reports === null) {
    return (
      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-8 text-center">
        <div style={{ borderColor: 'var(--border)', borderTopColor: '#06B6D4' }} className="mx-auto mb-4 h-6 w-6 animate-spin rounded-full border-2" />
        <p style={{ color: 'var(--text-primary)' }} className="text-sm font-medium">Loading agent inventory</p>
      </div>
    )
  }

  if (namedGroups.length === 0) {
    return (
      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="av-animate-rise rounded-3xl p-8 text-center shadow-2xl shadow-black/5 md:p-12">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#7C3AED]/10 text-lg font-semibold text-[color:var(--accent-purple-text)]">▤</div>
        <h3 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">No named agents yet</h3>
        <p style={{ color: 'var(--text-muted)' }} className="mx-auto mt-2 max-w-md text-sm">
          Agents appear here once a scan detects a real agent name in the submitted code (e.g. <code>name: &apos;MyAgent&apos;</code>). Reports without a detected name stay in the Reports tab as standalone scans — we never guess an identity.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search agents..."
          aria-label="Search agents"
          style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
          className="w-full rounded-xl px-4 py-2.5 text-sm outline-none sm:w-64"
        />
        <div className="flex flex-wrap gap-2">
          <div className="flex gap-1.5">
            {([['all', 'All'], ['verified', 'Verified'], ['not_verified', 'Not verified']] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setStatus(value)}
                style={{
                  backgroundColor: status === value ? 'var(--text-primary)' : 'var(--card)',
                  color: status === value ? 'var(--bg)' : 'var(--text-muted)',
                  border: '1px solid var(--border)',
                }}
                className="av-transition rounded-full px-3 py-1.5 text-xs font-medium"
              >
                {label}
              </button>
            ))}
          </div>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortKey)}
            aria-label="Sort agents"
            style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
            className="rounded-full px-3 py-1.5 text-xs font-medium outline-none"
          >
            <option value="newest">Newest scan</option>
            <option value="score_desc">Highest score</option>
            <option value="score_asc">Lowest score</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-8 text-center">
          <p style={{ color: 'var(--text-muted)' }} className="text-sm">No agents match this filter.</p>
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)' }} className="av-stagger overflow-hidden rounded-3xl shadow-xl shadow-black/5">
          {filtered.map(row => (
            <button
              key={row.group.key}
              onClick={() => row.group.agentName && onOpenAgent(agentGroupSlug(row.group.agentName))}
              style={{ backgroundColor: 'var(--card)', borderBottom: '1px solid var(--border)' }}
              className="av-transition flex w-full flex-col gap-2 px-4 py-4 text-left hover:opacity-85 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <p style={{ color: 'var(--text-primary)' }} className="truncate text-sm font-semibold">{row.group.displayName}</p>
                <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-xs">
                  {row.scanCount} scan{row.scanCount === 1 ? '' : 's'} · {row.capabilities} capabilit{row.capabilities === 1 ? 'y' : 'ies'} · {row.mcpCount} MCP tool{row.mcpCount === 1 ? '' : 's'} · scanner {row.version}
                </p>
              </div>
              <span className={`w-fit shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${row.verdict === 'VERIFIED' ? 'bg-[#00B37E]/10 text-[color:var(--accent-green-text)]' : 'bg-[#E03E3E]/10 text-[color:var(--accent-red-text)]'}`}>
                {verdictLabel(row.verdict)}
              </span>
              <div className="flex shrink-0 items-center gap-4 text-xs">
                <div className="text-right">
                  <p style={{ color: 'var(--text-primary)' }} className="font-bold">{row.score}<span style={{ color: 'var(--text-muted)' }} className="font-normal">/100</span></p>
                  {row.scoreChange !== null && row.scoreChange !== 0 && (
                    <p className={row.scoreChange > 0 ? 'text-[color:var(--accent-green-text)]' : 'text-[color:var(--accent-red-text)]'}>{row.scoreChange > 0 ? '+' : ''}{row.scoreChange}</p>
                  )}
                </div>
                <div className="text-right" style={{ color: 'var(--text-muted)' }}>
                  {row.critical > 0 && <p className="text-[color:var(--accent-red-text)]">{row.critical} critical</p>}
                  {row.high > 0 && <p className="text-[color:var(--accent-orange-text)]">{row.high} high</p>}
                  {row.critical === 0 && row.high === 0 && <p>0 critical/high</p>}
                </div>
                <span style={{ color: 'var(--text-muted)' }}>→</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
