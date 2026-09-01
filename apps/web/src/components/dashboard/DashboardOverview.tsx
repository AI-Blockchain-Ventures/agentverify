'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { User } from 'firebase/auth'
import { getReports } from '@/lib/scanStore'
import { groupReportsByAgent, agentGroupSlug } from '@/lib/agentGrouping'
import { compareReports } from '@/lib/compareReports'
import { normalizeVerdict, verdictLabel } from '@/lib/verdict'
import type { StoredReport } from '@/types'

const reportScore = (r: StoredReport) => r.riskScore ?? r.result?.riskScore ?? 0
const findingsOf = (r: StoredReport) => (Array.isArray(r.findings) ? r.findings : Array.isArray(r.result?.findings) ? r.result.findings : []) as Array<{ severity?: string; title?: string }>

/**
 * "Security command center" — the first screen after login. Answers: are my agents safe, what
 * needs attention, what changed, what's getting worse, what was fixed. Every number here comes
 * from the same reports the Reports tab shows — nothing is a separately-maintained aggregate that
 * could silently drift from what a click-through would reveal.
 */
export function DashboardOverview({ user, onGoToScan, onGoToAgent }: { user: User; onGoToScan: () => void; onGoToAgent: (slug: string) => void }) {
  const [reports, setReports] = useState<StoredReport[] | null>(null)

  useEffect(() => {
    let cancelled = false
    getReports(user.uid).then(list => { if (!cancelled) setReports(list) }).catch(() => { if (!cancelled) setReports([]) })
    return () => { cancelled = true }
  }, [user.uid])

  const groups = useMemo(() => (reports ? groupReportsByAgent(reports) : []), [reports])

  const stats = useMemo(() => {
    const latestPerAgent = groups.map(g => g.reports[0])
    const verified = latestPerAgent.filter(r => normalizeVerdict(r.verdict) === 'VERIFIED').length
    const attention = latestPerAgent.filter(r => normalizeVerdict(r.verdict) !== 'VERIFIED')
    let critical = 0, high = 0
    for (const r of latestPerAgent) {
      for (const f of findingsOf(r)) {
        if (f.severity === 'critical') critical++
        else if (f.severity === 'high') high++
      }
    }
    return { totalAgents: groups.length, verified, attentionCount: attention.length, critical, high, attention }
  }, [groups])

  const scoreTrend = useMemo(() => {
    // Most recent 10 scans across all agents, oldest -> newest, as a simple posture trend.
    if (!reports) return []
    return [...reports].sort((a, b) => new Date(a.scannedAt ?? 0).getTime() - new Date(b.scannedAt ?? 0).getTime()).slice(-10)
  }, [reports])

  const recentActivity = useMemo(() => {
    const events: Array<{ agentSlug: string; agentName: string; kind: 'resolved' | 'new' | 'improved' | 'worsened'; label: string; when: string }> = []
    for (const g of groups) {
      if (g.agentName === null || g.reports.length < 2) continue
      const [current, previous] = g.reports
      const diff = compareReports(previous, current)
      for (const f of diff.findings.resolved.slice(0, 2)) {
        events.push({ agentSlug: agentGroupSlug(g.agentName), agentName: g.displayName, kind: 'resolved', label: f.title, when: current.scannedAt ?? '' })
      }
      for (const f of diff.findings.new.slice(0, 2)) {
        events.push({ agentSlug: agentGroupSlug(g.agentName), agentName: g.displayName, kind: 'new', label: f.title, when: current.scannedAt ?? '' })
      }
      if (diff.verdictChanged) {
        events.push({ agentSlug: agentGroupSlug(g.agentName), agentName: g.displayName, kind: diff.verdictImproved ? 'improved' : 'worsened', label: `Verdict ${diff.verdictImproved ? 'improved' : 'worsened'}: ${previous.verdict} → ${current.verdict}`, when: current.scannedAt ?? '' })
      }
    }
    return events.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime()).slice(0, 6)
  }, [groups])

  const commonRisks = useMemo(() => {
    if (!reports) return []
    const counts = new Map<string, number>()
    for (const r of reports) {
      for (const f of findingsOf(r)) {
        if (f.title) counts.set(f.title, (counts.get(f.title) ?? 0) + 1)
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [reports])

  const latestScans = useMemo(() => (reports ?? []).slice(0, 5), [reports])

  if (reports === null) {
    return (
      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-8 text-center">
        <div style={{ borderColor: 'var(--border)', borderTopColor: '#06B6D4' }} className="mx-auto mb-4 h-6 w-6 animate-spin rounded-full border-2" />
        <p style={{ color: 'var(--text-primary)' }} className="text-sm font-medium">Loading your security posture</p>
      </div>
    )
  }

  if (reports.length === 0) {
    return (
      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="av-animate-rise rounded-3xl p-8 text-center shadow-2xl shadow-black/5 md:p-12">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#7C3AED]/10 text-lg font-semibold text-[color:var(--accent-purple-text)]">◧</div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-purple-text)]">Welcome to Agent Verify</p>
        <h3 style={{ color: 'var(--text-primary)' }} className="mt-1 text-lg font-semibold">Understand what your AI agents can actually do</h3>
        <ol className="av-stagger mx-auto mt-5 max-w-sm space-y-2 text-left text-sm">
          {[
            'Scan your first agent',
            'Review what it can do',
            'Fix high-risk capabilities',
            'Verify again',
            'Add Agent Verify to CI',
          ].map((step, i) => (
            <li key={step} style={{ color: 'var(--text-secondary)' }} className="flex items-center gap-3">
              <span style={{ backgroundColor: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
        <div className="mt-7 flex flex-col items-center gap-2.5 sm:flex-row sm:justify-center">
          <button onClick={onGoToScan} className="av-press w-full rounded-2xl bg-[#06B6D4] px-5 py-3 text-sm font-semibold text-[#080B14] transition-opacity hover:opacity-90 sm:w-auto">Scan your first agent</button>
          <Link href="/report/demo" style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }} className="av-press w-full rounded-2xl bg-[var(--surface)] px-5 py-3 text-sm font-semibold transition-opacity hover:opacity-90 sm:w-auto">Try the demo report</Link>
        </div>
        <Link href="/docs" style={{ color: 'var(--text-muted)' }} className="mt-4 inline-block text-xs underline hover:opacity-80">Read the docs</Link>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="av-stagger grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ['Agents tracked', stats.totalAgents, 'var(--text-primary)'],
          ['Verified', stats.verified, 'var(--accent-green-text)'],
          ['Need attention', stats.attentionCount, stats.attentionCount > 0 ? 'var(--accent-orange-text)' : 'var(--text-primary)'],
          ['Critical findings', stats.critical, stats.critical > 0 ? 'var(--accent-red-text)' : 'var(--text-primary)'],
          ['High findings', stats.high, stats.high > 0 ? 'var(--accent-orange-text)' : 'var(--text-primary)'],
        ].map(([label, value, color]) => (
          <div key={label as string} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="av-hover-lift rounded-2xl p-4">
            <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-medium uppercase tracking-wider">{label}</p>
            <p style={{ color: color as string }} className="mt-1 text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="av-animate-rise rounded-3xl p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--accent-red-text)]">Agents requiring attention</p>
          {stats.attention.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-sm">Every tracked agent is currently VERIFIED.</p>
          ) : (
            <div className="mt-3 space-y-1.5">
              {stats.attention.slice(0, 5).map(r => {
                const group = groups.find(g => g.reports[0].reportId === r.reportId)
                return (
                  <button
                    key={r.reportId}
                    onClick={() => group?.agentName && onGoToAgent(agentGroupSlug(group.agentName))}
                    className="av-press flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs transition-opacity hover:opacity-70"
                    style={{ backgroundColor: 'var(--surface)' }}
                  >
                    <span style={{ color: 'var(--text-primary)' }} className="truncate font-medium">{group?.displayName ?? r.fileName}</span>
                    <span className="shrink-0 font-semibold text-[color:var(--accent-red-text)]">{reportScore(r)}/100</span>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="av-animate-rise rounded-3xl p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--accent-cyan-text)]">Security score trend</p>
          {scoreTrend.length < 2 ? (
            <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-sm">Scan the same agent again to see a trend.</p>
          ) : (
            <div className="mt-4 flex items-end gap-1.5">
              {scoreTrend.map(r => (
                <div key={r.reportId} className="flex flex-1 flex-col items-center gap-1" title={`${reportScore(r)}/100`}>
                  <div
                    className={`av-transition w-full rounded-t ${normalizeVerdict(r.verdict) === 'VERIFIED' ? 'bg-[#00B37E]' : 'bg-[#E03E3E]'}`}
                    style={{ height: `${Math.max(4, reportScore(r) * 0.5)}px` }}
                  />
                </div>
              ))}
            </div>
          )}
          <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-[11px]">Last {scoreTrend.length} scans across all agents, oldest → newest.</p>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="av-animate-rise rounded-3xl p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--accent-purple-text)]">Recent changes</p>
          {recentActivity.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-sm">Nothing has changed since each agent&apos;s previous scan yet.</p>
          ) : (
            <div className="mt-3 space-y-1.5">
              {recentActivity.map((e, i) => (
                <button key={i} onClick={() => onGoToAgent(e.agentSlug)} className="av-press flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left text-xs transition-opacity hover:opacity-70" style={{ backgroundColor: 'var(--surface)' }}>
                  <span
                    className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                    style={{
                      color: e.kind === 'resolved' || e.kind === 'improved' ? 'var(--accent-green-text)' : e.kind === 'new' || e.kind === 'worsened' ? 'var(--accent-red-text)' : 'var(--text-muted)',
                      backgroundColor: 'var(--input-bg)',
                    }}
                  >
                    {e.kind}
                  </span>
                  <span style={{ color: 'var(--text-secondary)' }} className="min-w-0 flex-1">
                    <span style={{ color: 'var(--text-primary)' }} className="font-medium">{e.agentName}</span>: {e.label}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="av-animate-rise rounded-3xl p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--accent-orange-text)]">Most common risks</p>
          {commonRisks.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-sm">No findings across your scans.</p>
          ) : (
            <div className="mt-3 space-y-1.5">
              {commonRisks.map(([title, count]) => (
                <div key={title} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs" style={{ backgroundColor: 'var(--surface)' }}>
                  <span style={{ color: 'var(--text-secondary)' }} className="truncate">{title}</span>
                  <span style={{ color: 'var(--text-muted)' }} className="shrink-0 font-semibold">×{count}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="av-animate-rise rounded-3xl p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">Latest scans</p>
        <div className="av-stagger mt-3 space-y-1.5">
          {latestScans.map(r => {
            const verdict = normalizeVerdict(r.verdict)
            return (
              <div key={r.reportId} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-xs" style={{ backgroundColor: 'var(--surface)' }}>
                <span style={{ color: 'var(--text-primary)' }} className="truncate font-medium">{r.agentName || r.fileName}</span>
                <span className={verdict === 'VERIFIED' ? 'text-[color:var(--accent-green-text)]' : 'text-[color:var(--accent-red-text)]'}>{verdictLabel(verdict)}</span>
                <span style={{ color: 'var(--text-muted)' }} className="shrink-0">{reportScore(r)}/100</span>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
