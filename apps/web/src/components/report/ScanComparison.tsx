'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { User } from 'firebase/auth'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { normalize, sortReports } from '@/lib/scanStore'
import { compareReports, findPreviousReport, type ScanComparisonSummary } from '@/lib/compareReports'
import type { StoredReport } from '@/types'

const severityLabel: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }
const severityColor: Record<string, string> = {
  critical: 'text-[color:var(--accent-red-text)]',
  high: 'text-[color:var(--accent-orange-text)]',
  medium: 'text-[var(--text-secondary)]',
  low: 'text-[var(--text-muted)]',
}

/**
 * Self-contained: given the current report + owner, finds the most recent prior scan of the
 * same agent (see findPreviousReport for the matching rule) and renders a "what changed" view.
 * Renders nothing when there is no comparable prior scan — no empty/fake comparison shown.
 */
export function ScanComparison({ report, user }: { report: Record<string, unknown>; user: User }) {
  const [comparison, setComparison] = useState<ScanComparisonSummary | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const agentName = typeof report.agentName === 'string' ? report.agentName : undefined
      const fileName = typeof report.fileName === 'string' ? report.fileName : undefined
      if (!agentName && !fileName) {
        setComparison(null)
        return
      }
      try {
        const [ownSnap, cliSnap] = await Promise.all([
          getDocs(collection(db, 'users', user.uid, 'reports')),
          getDocs(query(collection(db, 'cliReports'), where('uid', '==', user.uid))),
        ])
        const history: StoredReport[] = sortReports([
          ...ownSnap.docs.map(d => normalize(d.data(), d.id)),
          ...cliSnap.docs.map(d => normalize(d.data(), d.id)),
        ])
        const currentStored = normalize(report, typeof report.reportId === 'string' ? report.reportId : '')
        const previous = findPreviousReport(currentStored, history)
        if (cancelled) return
        setComparison(previous ? compareReports(previous, currentStored) : null)
      } catch (err) {
        console.error('Scan comparison lookup failed:', err)
        if (!cancelled) setComparison(null)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [report, user.uid])

  if (comparison === undefined || comparison === null) return null

  return <ScanComparisonView comparison={comparison} />
}

/**
 * Presentational half of scan comparison, decoupled from Firestore lookup — used both by
 * ScanComparison above (single-report view, matches by agent name via findPreviousReport) and
 * by the agent detail page (which already has the exact ordered scan history for one agent
 * group and can diff two of its own reports directly without re-matching).
 */
export function ScanComparisonView({ comparison }: { comparison: ScanComparisonSummary }) {
  const { previous, current, scoreChange, verdictChanged, verdictImproved, findings, capabilities, mcpExposures, bomChanges, newCriticalCount, resolvedCriticalCount, newHighCount, resolvedHighCount } = comparison
  const hasAnyChange = verdictChanged || scoreChange !== 0 || findings.new.length > 0 || findings.resolved.length > 0 || capabilities.new.length > 0 || capabilities.resolved.length > 0 || mcpExposures.new.length > 0 || mcpExposures.resolved.length > 0 || bomChanges.length > 0

  return (
    <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mb-6 rounded-3xl p-6 shadow-xl shadow-black/5">
      <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-purple-text)]">Scan comparison</p>
          <h2 style={{ color: 'var(--text-primary)' }} className="mt-1 text-lg font-semibold">What changed since the last scan</h2>
        </div>
        <Link href={`/report/?id=${encodeURIComponent(previous.reportId)}`} style={{ color: 'var(--text-muted)' }} className="text-xs hover:opacity-70">View previous report →</Link>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-2xl p-4 text-center">
          <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-medium uppercase tracking-wider">Previous score</p>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-2xl font-bold">{previous.riskScore}</p>
        </div>
        <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-2xl p-4 text-center">
          <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-medium uppercase tracking-wider">Current score</p>
          <p style={{ color: 'var(--text-primary)' }} className="mt-1 text-2xl font-bold">{current.riskScore}</p>
        </div>
        <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-2xl p-4 text-center">
          <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-medium uppercase tracking-wider">Score change</p>
          <p className={`mt-1 text-2xl font-bold ${scoreChange > 0 ? 'text-[color:var(--accent-green-text)]' : scoreChange < 0 ? 'text-[color:var(--accent-red-text)]' : ''}`} style={scoreChange === 0 ? { color: 'var(--text-secondary)' } : undefined}>
            {scoreChange > 0 ? '+' : ''}{scoreChange}
          </p>
        </div>
        <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-2xl p-4 text-center">
          <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-medium uppercase tracking-wider">Verdict</p>
          <p className="mt-1 text-sm font-bold">
            {verdictChanged ? (
              <span className={verdictImproved ? 'text-[color:var(--accent-green-text)]' : 'text-[color:var(--accent-red-text)]'}>
                {verdictImproved ? 'IMPROVED' : 'WORSENED'}
              </span>
            ) : (
              <span style={{ color: 'var(--text-secondary)' }}>UNCHANGED</span>
            )}
          </p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-[11px]">{previous.verdict.replace('_', ' ')} → {current.verdict.replace('_', ' ')}</p>
        </div>
      </div>

      {!hasAnyChange && (
        <p style={{ color: 'var(--text-muted)' }} className="text-sm">No material changes detected since the previous scan of this agent.</p>
      )}

      {(newCriticalCount > 0 || newHighCount > 0 || resolvedCriticalCount > 0 || resolvedHighCount > 0) && (
        <div className="mb-4 flex flex-wrap gap-2">
          {newCriticalCount > 0 && <span className="rounded-full bg-[color:var(--accent-red-text)]/10 px-3 py-1 text-xs font-semibold text-[color:var(--accent-red-text)]">{newCriticalCount} new critical finding{newCriticalCount === 1 ? '' : 's'}</span>}
          {newHighCount > 0 && <span className="rounded-full bg-[color:var(--accent-orange-text)]/10 px-3 py-1 text-xs font-semibold text-[color:var(--accent-orange-text)]">{newHighCount} new high finding{newHighCount === 1 ? '' : 's'}</span>}
          {resolvedCriticalCount > 0 && <span className="rounded-full bg-[color:var(--accent-green-text)]/10 px-3 py-1 text-xs font-semibold text-[color:var(--accent-green-text)]">{resolvedCriticalCount} critical resolved</span>}
          {resolvedHighCount > 0 && <span className="rounded-full bg-[color:var(--accent-green-text)]/10 px-3 py-1 text-xs font-semibold text-[color:var(--accent-green-text)]">{resolvedHighCount} high resolved</span>}
        </div>
      )}

      {findings.new.length > 0 && (
        <div className="mb-4">
          <p style={{ color: 'var(--text-primary)' }} className="mb-2 text-sm font-semibold">New risks</p>
          <div className="space-y-1.5">
            {findings.new.map(f => (
              <div key={f.code} style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2">
                <span style={{ color: 'var(--text-primary)' }} className="text-sm">{f.title}</span>
                <span className={`shrink-0 text-xs font-semibold ${severityColor[f.severity]}`}>{severityLabel[f.severity]} · NEW</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {findings.resolved.length > 0 && (
        <div className="mb-4">
          <p style={{ color: 'var(--text-primary)' }} className="mb-2 text-sm font-semibold">Resolved</p>
          <div className="space-y-1.5">
            {findings.resolved.map(f => (
              <div key={f.code} style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2">
                {/* No opacity fade on the row — the strikethrough + RESOLVED badge already signal
                    "resolved" without pushing --text-secondary's contrast below WCAG AA. */}
                <span style={{ color: 'var(--text-secondary)' }} className="text-sm line-through decoration-1">{f.title}</span>
                <span className="shrink-0 text-xs font-semibold text-[color:var(--accent-green-text)]">RESOLVED</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {findings.unchanged.length > 0 && (
        <details className="mb-4">
          <summary style={{ color: 'var(--text-muted)' }} className="cursor-pointer text-xs font-medium">Unchanged findings ({findings.unchanged.length})</summary>
          <div className="mt-2 space-y-1.5">
            {findings.unchanged.map(f => (
              <div key={f.code} style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2">
                <span style={{ color: 'var(--text-secondary)' }} className="text-sm">{f.title}</span>
                <span style={{ color: 'var(--text-muted)' }} className="shrink-0 text-xs font-semibold">UNCHANGED</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {(capabilities.new.length > 0 || capabilities.resolved.length > 0) && (
        <div className="mb-4">
          <p style={{ color: 'var(--text-primary)' }} className="mb-2 text-sm font-semibold">Capability changes</p>
          <div className="space-y-1.5">
            {capabilities.new.map(c => (
              <div key={c.id} style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2">
                <span style={{ color: 'var(--text-primary)' }} className="text-sm">{c.label}</span>
                <span className="shrink-0 text-xs font-semibold text-[color:var(--accent-orange-text)]">NEW CAPABILITY</span>
              </div>
            ))}
            {capabilities.resolved.map(c => (
              <div key={c.id} style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 opacity-80">
                <span style={{ color: 'var(--text-secondary)' }} className="text-sm">{c.label}</span>
                <span className="shrink-0 text-xs font-semibold text-[color:var(--accent-green-text)]">NO LONGER DETECTED</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(mcpExposures.new.length > 0 || mcpExposures.resolved.length > 0) && (
        <div className="mb-4">
          <p style={{ color: 'var(--text-primary)' }} className="mb-2 text-sm font-semibold">MCP exposure changes</p>
          <div className="space-y-1.5">
            {mcpExposures.new.map(m => (
              <div key={m.toolName} style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2">
                <span style={{ color: 'var(--text-primary)' }} className="text-sm">{m.toolName}</span>
                <span className="shrink-0 text-xs font-semibold text-[color:var(--accent-orange-text)]">NEW</span>
              </div>
            ))}
            {mcpExposures.resolved.map(m => (
              <div key={m.toolName} style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 opacity-80">
                <span style={{ color: 'var(--text-secondary)' }} className="text-sm">{m.toolName}</span>
                <span className="shrink-0 text-xs font-semibold text-[color:var(--accent-green-text)]">REMOVED</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {bomChanges.length > 0 && (
        <div>
          <p style={{ color: 'var(--text-primary)' }} className="mb-2 text-sm font-semibold">Configuration changes</p>
          <div className="space-y-1.5">
            {bomChanges.map(c => (
              <div key={c.field} style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-lg px-3 py-2 text-sm">
                <span style={{ color: 'var(--text-primary)' }} className="font-medium">{c.label}: </span>
                <span style={{ color: 'var(--text-muted)' }}>{c.from}</span>
                <span style={{ color: 'var(--text-muted)' }}> → </span>
                <span style={{ color: 'var(--text-primary)' }}>{c.to}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
