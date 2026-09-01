'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { useAuth } from '@/components/auth/AuthProvider'
import { Badge } from '@/components/ui/Badge'
import { Capabilities } from '@/components/scanner/Capabilities'
import { AuthoritySummary } from '@/components/scanner/AuthoritySummary'
import { McpExposures } from '@/components/scanner/McpExposures'
import { BlastRadius } from '@/components/scanner/BlastRadius'
import { SecurityCategories } from '@/components/scanner/SecurityCategories'
import { ControlsAndLimits } from '@/components/scanner/ControlsAndLimits'
import { ScanComparisonView } from '@/components/report/ScanComparison'
import { PostureTimeline } from '@/components/scanner/PostureTimeline'
import { useCountUp } from '@/lib/useCountUp'
import { getReports } from '@/lib/scanStore'
import { compareReports } from '@/lib/compareReports'
import { findAgentGroup, type AgentGroup } from '@/lib/agentGrouping'
import { normalizeVerdict, verdictLabel } from '@/lib/verdict'
import type { StoredReport } from '@/types'

function severityCount(report: StoredReport, severity: string): number {
  const findings = Array.isArray(report.findings) ? report.findings : []
  return findings.filter(f => typeof f === 'object' && f !== null && (f as { severity?: string }).severity === severity).length
}

function AgentDetailInner() {
  const searchParams = useSearchParams()
  const slug = searchParams.get('name') ?? ''
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [reports, setReports] = useState<StoredReport[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !user) router.push('/')
  }, [authLoading, user, router])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    getReports(user.uid)
      .then(list => { if (!cancelled) setReports(list) })
      .catch(err => {
        console.error('Failed to load agent history:', err)
        if (!cancelled) setError('Could not load your scan history. Refresh and try again.')
      })
    return () => { cancelled = true }
  }, [user])

  // This page only ever reads the signed-in user's OWN reports (getReports scopes every query
  // to user.uid) — the ?name= param only selects which of THAT user's own agent groups to show,
  // never another user's data. Firestore Security Rules enforce ownership server-side regardless.
  const group: AgentGroup | null = useMemo(
    () => (reports ? findAgentGroup(reports, slug) : null),
    [reports, slug]
  )
  // Called unconditionally (before any early return) per the Rules of Hooks — animates when the
  // score genuinely changes (e.g. navigating from one agent to another without a full remount),
  // never on first paint.
  const animatedScore = useCountUp(group?.reports[0]?.riskScore ?? 0)

  if (authLoading || (!!user && reports === null && !error)) {
    return (
      <div style={{ backgroundColor: 'var(--bg)' }} className="flex min-h-screen items-center justify-center px-6">
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="w-full max-w-sm rounded-3xl p-8 text-center shadow-2xl shadow-black/5">
          <div style={{ borderColor: 'var(--border)', borderTopColor: '#06B6D4' }} className="mx-auto mb-4 h-6 w-6 animate-spin rounded-full border-2" />
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Loading agent history</p>
        </div>
      </div>
    )
  }

  if (!user) return null

  if (error) {
    return (
      <div style={{ backgroundColor: 'var(--bg)' }} className="flex min-h-screen items-center justify-center px-6">
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="max-w-md rounded-3xl p-8 text-center shadow-2xl shadow-black/5">
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{error}</p>
          <Link href="/dashboard" className="mt-5 inline-flex rounded-2xl bg-[#06B6D4] px-5 py-3 text-sm font-semibold text-[#060A0F]">Back to dashboard</Link>
        </div>
      </div>
    )
  }

  if (!group) {
    return (
      <div style={{ backgroundColor: 'var(--bg)' }} className="flex min-h-screen items-center justify-center px-6">
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="max-w-md rounded-3xl p-8 text-center shadow-2xl shadow-black/5">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#E07B39]/10 text-lg font-semibold text-[color:var(--accent-orange-text)]">?</div>
          <p style={{ color: 'var(--text-primary)' }} className="text-xl font-semibold">Agent not found</p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-sm">
            This could mean the agent name in the link doesn&apos;t match one of your reports, or the report only has an
            unidentified filename rather than a detected agent name — in that case it appears as a standalone report,
            not a grouped agent.
          </p>
          <Link href="/dashboard" className="mt-6 inline-flex rounded-2xl bg-[#06B6D4] px-5 py-3 text-sm font-semibold text-[#060A0F]">Back to dashboard</Link>
        </div>
      </div>
    )
  }

  const latest = group.reports[0]
  const previous = group.reports[1] ?? null
  const verdict = normalizeVerdict(latest.verdict)
  const verified = verdict === 'VERIFIED'
  const critical = severityCount(latest, 'critical')
  const high = severityCount(latest, 'high')
  const findingCount = Array.isArray(latest.findings) ? latest.findings.length : 0
  const comparison = previous ? compareReports(previous, latest) : null
  const scoreTrend = [...group.reports].reverse() // oldest -> newest, for a left-to-right trend read

  return (
    <div style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen">
      <main className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-10">
        <Link href="/dashboard" style={{ color: 'var(--text-muted)' }} className="mb-4 inline-flex items-center gap-1.5 text-xs hover:opacity-70">← Back to dashboard</Link>

        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mb-6 overflow-hidden rounded-3xl shadow-2xl shadow-black/10">
          <div className={`p-6 md:p-8 ${verified ? 'bg-[#10B981]/8' : 'bg-[#EF4444]/8'}`}>
            <div className="grid gap-6 lg:grid-cols-[1fr_220px] lg:items-center">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--accent-cyan-text)]">Agent</p>
                <h1 style={{ color: 'var(--text-primary)' }} className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">{group.displayName}</h1>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge variant={verified ? 'verified' : 'failed'}>{verdictLabel(verdict)}</Badge>
                  <span style={{ color: 'var(--text-muted)' }} className="text-xs">Last scanned {new Date(latest.scannedAt ?? '').toLocaleString()}</span>
                </div>
              </div>
              <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-3xl p-5 text-center">
                <div style={{ color: 'var(--text-muted)' }} className="text-xs font-medium uppercase tracking-widest">Current score</div>
                <div style={{ color: 'var(--text-primary)' }} className="mt-1 text-5xl font-bold tabular-nums">{animatedScore}<span style={{ color: 'var(--text-muted)' }} className="text-xl">/100</span></div>
              </div>
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--border)' }} className="grid grid-cols-2 text-xs sm:grid-cols-4">
            <div style={{ borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }} className="p-4 sm:border-b-0"><span style={{ color: 'var(--text-muted)' }} className="block uppercase tracking-wider">Scans</span><span style={{ color: 'var(--text-secondary)' }} className="mt-1 block font-semibold">{group.reports.length}</span></div>
            <div style={{ borderBottom: '1px solid var(--border)' }} className="p-4 sm:border-b-0 sm:border-r"><span style={{ color: 'var(--text-muted)' }} className="block uppercase tracking-wider">Findings</span><span style={{ color: 'var(--text-secondary)' }} className="mt-1 block font-semibold">{findingCount}</span></div>
            <div style={{ borderRight: '1px solid var(--border)' }} className="p-4"><span style={{ color: 'var(--text-muted)' }} className="block uppercase tracking-wider">Critical risks</span><span className="mt-1 block font-semibold text-[color:var(--accent-red-text)]">{critical}</span></div>
            <div className="p-4"><span style={{ color: 'var(--text-muted)' }} className="block uppercase tracking-wider">High risks</span><span className="mt-1 block font-semibold text-[color:var(--accent-orange-text)]">{high}</span></div>
          </div>
        </section>

        <div className="mb-6 flex justify-end">
          <Link href={`/report/?id=${encodeURIComponent(latest.reportId)}`} className="rounded-xl bg-[#7C3AED] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-85">Open full report →</Link>
        </div>

        <AuthoritySummary
          capabilities={latest.capabilities ?? []}
          mcpExposures={latest.mcpExposures ?? []}
          capabilityChains={latest.capabilityChains ?? []}
          controlsDetected={latest.securityControlsDetected ?? []}
          bom={latest.bom}
        />

        <div className="mb-2 flex items-center gap-3">
          <h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-bold uppercase tracking-widest">Current security posture</h2>
          <div style={{ backgroundColor: 'var(--border)' }} className="h-px flex-1" />
        </div>
        <Capabilities capabilities={latest.capabilities ?? []} />
        <McpExposures exposures={latest.mcpExposures ?? []} />
        <BlastRadius chains={latest.capabilityChains ?? []} />
        <SecurityCategories categories={latest.securityCategories ?? []} />
        <ControlsAndLimits controls={latest.securityControlsDetected ?? []} notDetermined={latest.notDetermined ?? []} />

        {group.reports.length > 1 && (
          <>
            <div className="mb-2 mt-2 flex items-center gap-3">
              <h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-bold uppercase tracking-widest">Changes over time</h2>
              <div style={{ backgroundColor: 'var(--border)' }} className="h-px flex-1" />
            </div>
            <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mb-6 rounded-3xl p-6 shadow-xl shadow-black/5">
              <p style={{ color: 'var(--text-primary)' }} className="mb-3 text-sm font-semibold">Score trend</p>
              <div className="flex items-end gap-1.5 overflow-x-auto pb-1">
                {scoreTrend.map((r, i) => {
                  const score = r.riskScore ?? 0
                  return (
                    <div key={r.reportId} className="flex shrink-0 flex-col items-center gap-1" title={`${score}/100 · ${new Date(r.scannedAt ?? '').toLocaleDateString()}`}>
                      <div
                        className={`w-6 rounded-t ${normalizeVerdict(r.verdict) === 'VERIFIED' ? 'bg-[#00B37E]' : 'bg-[#E03E3E]'}`}
                        style={{ height: `${Math.max(6, score)}px`, opacity: i === scoreTrend.length - 1 ? 1 : 0.55 }}
                      />
                      <span style={{ color: 'var(--text-muted)' }} className="text-[10px]">{score}</span>
                    </div>
                  )
                })}
              </div>
              <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">Oldest → newest, left to right. {group.reports.length} scan{group.reports.length === 1 ? '' : 's'} total.</p>
            </section>
            <PostureTimeline reports={group.reports} />
            {comparison && <ScanComparisonView comparison={comparison} />}
          </>
        )}

        <div className="mb-2 mt-2 flex items-center gap-3">
          <h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-bold uppercase tracking-widest">Scan history</h2>
          <div style={{ backgroundColor: 'var(--border)' }} className="h-px flex-1" />
        </div>
        <div style={{ border: '1px solid var(--border)' }} className="overflow-hidden rounded-3xl shadow-2xl shadow-black/5">
          <div style={{ backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--border)' }} className="hidden items-center gap-4 px-4 py-3 text-xs font-medium uppercase tracking-wider sm:flex" >
            <span style={{ color: 'var(--text-muted)' }} className="flex-1">Scanned</span>
            <span style={{ color: 'var(--text-muted)' }} className="w-20">Score</span>
            <span style={{ color: 'var(--text-muted)' }} className="w-28">Verdict</span>
            <span style={{ color: 'var(--text-muted)' }} className="w-20">Findings</span>
            <span style={{ color: 'var(--text-muted)' }} className="w-24">Scanner</span>
            <div className="w-4" />
          </div>
          {group.reports.map(r => {
            const rVerdict = normalizeVerdict(r.verdict)
            const rFindingCount = Array.isArray(r.findings) ? r.findings.length : 0
            return (
              <Link key={r.reportId} href={`/report/?id=${encodeURIComponent(r.reportId)}`} style={{ backgroundColor: 'var(--card)', borderBottom: '1px solid var(--border)' }} className="flex flex-col gap-1 px-4 py-3 text-sm transition-opacity hover:opacity-80 sm:flex-row sm:items-center sm:gap-4">
                <span style={{ color: 'var(--text-primary)' }} className="flex-1">{new Date(r.scannedAt ?? '').toLocaleString()}</span>
                <span style={{ color: 'var(--text-secondary)' }} className="sm:w-20">{r.riskScore ?? 0}/100</span>
                <span className={`sm:w-28 ${rVerdict === 'VERIFIED' ? 'text-[color:var(--accent-green-text)]' : 'text-[color:var(--accent-red-text)]'}`}>{verdictLabel(rVerdict)}</span>
                <span style={{ color: 'var(--text-secondary)' }} className="sm:w-20">{rFindingCount} issue{rFindingCount === 1 ? '' : 's'}</span>
                <span style={{ color: 'var(--text-muted)' }} className="sm:w-24">{r.scannerVersion ?? 'Unknown'}</span>
              </Link>
            )
          })}
        </div>
      </main>
    </div>
  )
}

export default function AgentDetailPage() {
  return (
    <Suspense fallback={<div style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen" />}>
      <AgentDetailInner />
    </Suspense>
  )
}
