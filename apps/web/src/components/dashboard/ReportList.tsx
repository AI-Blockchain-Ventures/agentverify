'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { StoredReport } from '@/types'
import type { User } from 'firebase/auth'
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { normalize, sortReports } from '@/lib/scanStore'
import { normalizeVerdict } from '@/lib/verdict'
import { agentGroupSlug, groupReportsByAgent } from '@/lib/agentGrouping'
import { ReportCard } from './ReportCard'

type VerdictFilter = 'all' | 'verified' | 'not_verified'
type SortOrder = 'newest' | 'oldest' | 'score_asc' | 'score_desc'

// Report rows render fine well past this (measured ~0.1ms/row even at 1000), but rendering
// every row upfront with no cap is still wasted work once an account accumulates hundreds of
// scans — this caps the initial render and lets the user reveal more explicitly, without ever
// hiding a report (everything is still reachable, just not all rendered at once).
const PAGE_SIZE = 50

const reportScore = (report: StoredReport): number => report.riskScore ?? report.result?.riskScore ?? 0
const reportVerdict = (report: StoredReport) => normalizeVerdict(report.verdict ?? report.result?.verdict)
const reportDateMs = (report: StoredReport): number => {
  const raw = report.scannedAt ?? report.createdAt ?? report.result?.metadata?.scannedAt
  const ms = raw ? new Date(raw).getTime() : NaN
  return Number.isFinite(ms) ? ms : 0
}

export function ReportList({ user, onRunScan, onNewReports, onClearNotification }: {
  user: User
  onRunScan: () => void
  onNewReports?: (count: number) => void
  onClearNotification?: () => void
}) {
  const [reports, setReports] = useState<StoredReport[]>([])
  const [loading, setLoading] = useState(true)
  const [newCount, setNewCount] = useState(0)
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>('all')
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const baselineCount = useRef(0)
  const isFirstLoad = useRef(true)
  const seenCliIds = useRef<Set<string>>(new Set())
  const cliInitialized = useRef(false)

  useEffect(() => {
    if (!user) return
    setLoading(true)
    isFirstLoad.current = true
    baselineCount.current = 0
    seenCliIds.current = new Set()
    cliInitialized.current = false

    let dashboardReports: StoredReport[] = []
    let cliReports: StoredReport[] = []
    let loaded = 0

    const merge = () => {
      const all = sortReports([...dashboardReports, ...cliReports])
      setReports(all)
      if (loaded < 2) {
        loaded++
        if (loaded === 2) setLoading(false)
      }
    }

    const unsubDashboard = onSnapshot(
      collection(db, 'users', user.uid, 'reports'),
      snap => {
        dashboardReports = snap.docs.map(d => normalize(d.data(), d.id))

        if (isFirstLoad.current) {
          baselineCount.current = snap.docs.length
          isFirstLoad.current = false
          setNewCount(0)
          onClearNotification?.()
          merge()
          return
        }

        const added = Math.max(0, dashboardReports.length - baselineCount.current)
        baselineCount.current = dashboardReports.length
        if (added > 0) {
          setNewCount(c => c + added)
          onNewReports?.(added)
        }
        merge()
      },
      err => {
        console.error('Dashboard reports error:', err)
        setLoading(false)
      }
    )

    const cliQuery = query(
      collection(db, 'cliReports'),
      where('uid', '==', user.uid),
      limit(100)
    )
    const unsubCli = onSnapshot(
      cliQuery,
      snap => {
        const allCliReports = snap.docs.map(d => normalize(d.data(), d.id))
        cliReports = allCliReports

        if (!cliInitialized.current) {
          snap.docs.forEach(d => seenCliIds.current.add(d.id))
          cliInitialized.current = true
          merge()
          return
        }

        const newDocs = snap.docs.filter(d => !seenCliIds.current.has(d.id))
        newDocs.forEach(d => seenCliIds.current.add(d.id))

        if (newDocs.length > 0) {
          setNewCount(c => c + newDocs.length)
          onNewReports?.(newDocs.length)
        }
        merge()
      },
      err => {
        console.error('CLI reports error:', err)
        merge()
      }
    )

    return () => {
      unsubDashboard()
      unsubCli()
    }
  }, [user, onNewReports, onClearNotification])

  // Real, database-backed summary derived from the reports already loaded above —
  // never fabricated or hardcoded.
  const stats = useMemo(() => {
    const total = reports.length
    const verified = reports.filter(r => reportVerdict(r) === 'VERIFIED').length
    const criticalFindings = reports.reduce((sum, r) => {
      const findings = r.findings ?? r.result?.findings ?? []
      return sum + (Array.isArray(findings) ? findings.filter(f => typeof f === 'object' && f !== null && (f as { severity?: string }).severity === 'critical').length : 0)
    }, 0)
    const avgScore = total ? Math.round(reports.reduce((sum, r) => sum + reportScore(r), 0) / total) : 0
    return { total, verified, notVerified: total - verified, criticalFindings, avgScore }
  }, [reports])

  // Grouped by a real, scanner-detected agent name only — never by filename alone, since
  // unrelated projects can share a filename. Reports without a reliable name are shown
  // standalone rather than guessed into a group. "Requiring attention" reflects each
  // agent's LATEST posture, not every historical scan of the same agent.
  const agentGroups = useMemo(() => groupReportsByAgent(reports), [reports])

  const attentionNeeded = useMemo(() =>
    agentGroups
      .map(g => ({ group: g, latest: g.reports[0] }))
      .filter(({ latest }) => reportVerdict(latest) !== 'VERIFIED')
      .sort((a, b) => reportScore(a.latest) - reportScore(b.latest))
      .slice(0, 5),
  [agentGroups])

  const commonFindings = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of reports) {
      const findings = Array.isArray(r.findings) ? r.findings : Array.isArray(r.result?.findings) ? r.result.findings : []
      for (const f of findings) {
        if (typeof f !== 'object' || f === null) continue
        const title = (f as { title?: string }).title
        if (title) counts.set(title, (counts.get(title) ?? 0) + 1)
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [reports])

  const filteredReports = useMemo(() => {
    const filtered = verdictFilter === 'all'
      ? reports
      : reports.filter(r => (verdictFilter === 'verified' ? reportVerdict(r) === 'VERIFIED' : reportVerdict(r) !== 'VERIFIED'))
    const sorted = [...filtered].sort((a, b) => {
      if (sortOrder === 'newest') return reportDateMs(b) - reportDateMs(a)
      if (sortOrder === 'oldest') return reportDateMs(a) - reportDateMs(b)
      if (sortOrder === 'score_asc') return reportScore(a) - reportScore(b)
      return reportScore(b) - reportScore(a)
    })
    return sorted
  }, [reports, verdictFilter, sortOrder])

  // Reset how many rows are revealed whenever the filter/sort changes, so switching filters
  // never leaves a confusingly-large or confusingly-small page size from a previous view.
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [verdictFilter, sortOrder])

  const visibleReports = useMemo(() => filteredReports.slice(0, visibleCount), [filteredReports, visibleCount])

  if (loading) {
    return (
      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-8 text-center">
        <div style={{ borderColor: 'var(--border)', borderTopColor: '#06B6D4' }} className="mx-auto mb-4 h-6 w-6 animate-spin rounded-full border-2" />
        <p style={{ color: 'var(--text-primary)' }} className="text-sm font-medium">Loading security reports</p>
        <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">Your workspace will appear here in a moment.</p>
      </div>
    )
  }

  if (!reports.length) {
    return (
      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-8 text-center shadow-2xl shadow-black/5 md:p-12">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#7C3AED]/10 text-lg font-semibold text-[color:var(--accent-purple-text)]">R</div>
        <h3 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">No security reports yet</h3>
        <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-sm">
          Run your first scan to create a private report with findings and recommended fixes.
        </p>
        <button
          onClick={onRunScan}
          className="mt-6 rounded-2xl bg-[#06B6D4] px-5 py-3 text-sm font-semibold text-[#080B14] hover:bg-[#06B6D4] transition-colors"
        >
          Scan agent
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Total scans', stats.total],
          ['Verified', stats.verified],
          ['Avg score', `${stats.avgScore}/100`],
          ['Critical findings', stats.criticalFindings],
        ].map(([label, value]) => (
          <div key={label as string} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-3.5">
            <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-medium uppercase tracking-wider">{label}</p>
            <p style={{ color: 'var(--text-primary)' }} className="mt-1 text-xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      {(attentionNeeded.length > 0 || commonFindings.length > 0) && (
        <div className="mb-5 grid gap-3 md:grid-cols-2">
          {attentionNeeded.length > 0 && (
            <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--accent-red-text)]">Agents requiring attention</p>
              <div className="mt-2 space-y-1.5">
                {attentionNeeded.map(({ group, latest }) => (
                  <a
                    key={group.key}
                    href={group.agentName ? `/agentverify/dashboard/agent/?name=${agentGroupSlug(group.agentName)}` : `/agentverify/report/?id=${encodeURIComponent(latest.reportId)}`}
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs transition-opacity hover:opacity-70"
                  >
                    <span style={{ color: 'var(--text-primary)' }} className="truncate">{group.displayName}</span>
                    <span className="shrink-0 font-semibold text-[color:var(--accent-red-text)]">{reportScore(latest)}/100</span>
                  </a>
                ))}
              </div>
            </div>
          )}
          {commonFindings.length > 0 && (
            <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
              <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wider">Most common findings</p>
              <div className="mt-2 space-y-1.5">
                {commonFindings.map(([title, count]) => (
                  <div key={title} className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                    <span style={{ color: 'var(--text-secondary)' }} className="truncate">{title}</span>
                    <span style={{ color: 'var(--text-muted)' }} className="shrink-0 font-semibold">×{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5">
          {([['all', 'All'], ['verified', 'Verified'], ['not_verified', 'Not verified']] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setVerdictFilter(value)}
              style={{
                backgroundColor: verdictFilter === value ? 'var(--text-primary)' : 'var(--card)',
                color: verdictFilter === value ? 'var(--bg)' : 'var(--text-muted)',
                border: '1px solid var(--border)',
              }}
              className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={sortOrder}
          onChange={event => setSortOrder(event.target.value as SortOrder)}
          aria-label="Sort reports"
          style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
          className="rounded-full px-3 py-1.5 text-xs font-medium outline-none"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="score_desc">Highest score</option>
          <option value="score_asc">Lowest score</option>
        </select>
      </div>

      {newCount > 0 && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-[#06B6D4]/20 bg-[#06B6D4]/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#06B6D4] animate-pulse" />
            <span style={{ color: 'var(--text-primary)' }} className="text-sm">
              {newCount} new report{newCount > 1 ? 's' : ''} added
            </span>
          </div>
          <button
            onClick={() => {
              setNewCount(0)
              onClearNotification?.()
            }}
            style={{ color: 'var(--text-muted)' }}
            className="text-xs transition-colors hover:opacity-70"
          >
            Dismiss
          </button>
        </div>
      )}
      <div style={{ border: '1px solid var(--border)' }} className="overflow-hidden rounded-3xl shadow-2xl shadow-black/5">
        <div style={{ backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--border)' }} className="hidden items-center gap-4 px-4 py-3 sm:flex">
          <div className="w-2" />
          <p style={{ color: 'var(--text-muted)' }} className="flex-1 text-xs font-medium uppercase tracking-wider">Report</p>
          <p style={{ color: 'var(--text-muted)' }} className="text-xs font-medium uppercase tracking-wider">Score</p>
          <p style={{ color: 'var(--text-muted)' }} className="w-16 text-xs font-medium uppercase tracking-wider">Issues</p>
          <div className="w-4" />
        </div>
        {filteredReports.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p style={{ color: 'var(--text-muted)' }} className="text-sm">No reports match this filter.</p>
          </div>
        ) : visibleReports.map(report => (
          <ReportCard key={`${report.source}-${report.reportId}`} report={report} />
        ))}
      </div>
      {visibleCount < filteredReports.length && (
        <div className="mt-4 flex flex-col items-center gap-1">
          <button
            onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
            style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            className="rounded-2xl bg-[var(--card)] px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-85"
          >
            Show more ({filteredReports.length - visibleCount} remaining)
          </button>
        </div>
      )}
    </div>
  )
}
