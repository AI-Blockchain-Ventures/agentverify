import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { normalize, sortReports } from '@/lib/scanStore'
import { compareReports, findPreviousReport, type ScanComparisonSummary } from '@/lib/compareReports'
import type { StoredReport } from '@/types'
import type { NormalizedReport } from '@/lib/normalizeReport'
import { Badge } from '@/components/ui/Badge'

export type DeploymentRecommendation = 'DEPLOY' | 'DEPLOY_WITH_CONDITIONS' | 'DO_NOT_DEPLOY' | 'NOT_ASSESSED'

const DEPLOYMENT_RECOMMENDATION_COPY: Record<DeploymentRecommendation, { label: string; color: string; bg: string }> = {
  DEPLOY: { label: 'DEPLOY', color: 'var(--accent-green-text)', bg: '#00B37E1A' },
  DEPLOY_WITH_CONDITIONS: { label: 'DEPLOY WITH CONDITIONS', color: 'var(--accent-orange-text)', bg: '#E07B391A' },
  DO_NOT_DEPLOY: { label: 'DO NOT DEPLOY', color: 'var(--accent-red-text)', bg: '#E03E3E1A' },
  NOT_ASSESSED: { label: 'NOT ASSESSED', color: 'var(--text-muted)', bg: 'var(--surface)' },
}

/**
 * A blunt, defensible deployment call derived ONLY from evidence this scan already produced — the
 * scanner's own VERIFIED criteria (see docs #security-score) plus critical/high finding counts.
 * Never invents new evidence: NOT_ASSESSED when the scan itself couldn't reach a verdict,
 * DO_NOT_DEPLOY when a critical finding is present (VERIFIED already requires zero criticals, so
 * this can only trigger on NOT_VERIFIED), DEPLOY_WITH_CONDITIONS for a high-only gap, DEPLOY only
 * when the scan verdict itself was VERIFIED.
 */
export function deploymentRecommendation(data: Pick<NormalizedReport, 'verdict' | 'criticalCount' | 'highCount'>): DeploymentRecommendation {
  if (data.verdict === 'NOT_ASSESSED') return 'NOT_ASSESSED'
  if (data.verdict === 'VERIFIED') return 'DEPLOY'
  if (data.criticalCount > 0) return 'DO_NOT_DEPLOY'
  if (data.highCount > 0) return 'DEPLOY_WITH_CONDITIONS'
  return 'DO_NOT_DEPLOY' // NOT_VERIFIED with no critical/high still means a real control failed
}

/**
 * Executive Report — for a CEO, CISO, CTO, buyer, or investor. Everything on this page must be
 * understandable in about 60 seconds by someone who has never read a security finding before.
 * No raw evidence, no regex, no code snippets — those live in the Security/Developer/Technical
 * views, all built from this exact same normalized evidence. Answers, in order: can this be
 * deployed, why, the top risks, what to fix first, and whether posture is improving (via the
 * scan-comparison link into the Security view, where the real trend data lives).
 */
export interface ExecutiveReportViewProps {
  data: NormalizedReport
  agentName?: string | null
  onSwitchToDeveloper?: () => void
  /** Raw stored-report record + owner, ONLY for the posture-trend lookup below — same real
   * Firestore query ScanComparison.tsx already runs, just reduced to the one-line trend verdict
   * this view needs. Optional: when absent (e.g. an unauthenticated/public report), the trend
   * section honestly shows "No prior scan available" rather than fetching or guessing. */
  report?: Record<string, unknown>
  user?: User | null
}

/**
 * Real evidence only: fetches this agent's own scan history and compares against the most recent
 * prior scan, exactly like ScanComparison.tsx does — never fabricates a trend when no prior scan
 * exists. Returns undefined while loading, null when there is genuinely no comparable prior scan.
 */
function usePostureTrend(report: Record<string, unknown> | undefined, user: User | null | undefined): ScanComparisonSummary | null | undefined {
  const [comparison, setComparison] = useState<ScanComparisonSummary | null | undefined>(undefined)
  useEffect(() => {
    if (!report || !user) { setComparison(null); return }
    let cancelled = false
    const load = async () => {
      const agentName = typeof report.agentName === 'string' ? report.agentName : undefined
      const fileName = typeof report.fileName === 'string' ? report.fileName : undefined
      if (!agentName && !fileName) { setComparison(null); return }
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
        console.error('Posture trend lookup failed:', err)
        if (!cancelled) setComparison(null)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [report, user])
  return comparison
}

export function ExecutiveReportView({ data, agentName, onSwitchToDeveloper, report, user }: ExecutiveReportViewProps) {
  const { verified, riskScore, reportInsights, capabilities, mcpExposures, capabilityChains, securityControlsDetected, criticalCount, highCount, bom, findings } = data
  const topRisks = reportInsights.highestRisks.slice(0, 5)
  const fixFirst = reportInsights.fixPriority.filter(f => f.priority === 'fix_first').slice(0, 3)
  const name = agentName || bom.agentName || 'This agent'
  const recommendation = deploymentRecommendation(data)
  const recCopy = DEPLOYMENT_RECOMMENDATION_COPY[recommendation]
  const blockers = findings.filter(f => f.severity === 'critical' || (f.severity === 'high' && recommendation !== 'DEPLOY')).slice(0, 5)
  const trend = usePostureTrend(report, user)

  return (
    <div className="space-y-6">
      <section style={{ backgroundColor: recCopy.bg, border: `1px solid ${recCopy.color}` }} className="rounded-2xl p-4">
        <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-widest">Deployment recommendation</p>
        <p style={{ color: recCopy.color }} className="mt-1 text-xl font-bold tracking-tight">{recCopy.label}</p>
        <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-xs leading-relaxed">
          {recommendation === 'DEPLOY' && 'This scan verdict is VERIFIED — the required execution-trust controls showed evidence.'}
          {recommendation === 'DEPLOY_WITH_CONDITIONS' && `${highCount} high-severity finding${highCount === 1 ? '' : 's'} should be resolved first; no critical blocker was found.`}
          {recommendation === 'DO_NOT_DEPLOY' && (criticalCount > 0 ? `${criticalCount} critical finding${criticalCount === 1 ? '' : 's'} must be fixed before this agent reaches production.` : 'This scan verdict is NOT VERIFIED — a required control failed.')}
          {recommendation === 'NOT_ASSESSED' && 'The submitted content did not contain enough agent execution context for a verdict. This is not a security failure — Agent Verify could not evaluate it.'}
        </p>
        {blockers.length > 0 && recommendation !== 'DEPLOY' && (
          <div className="mt-3 border-t pt-3" style={{ borderColor: recCopy.color }}>
            <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wider">Deployment blockers</p>
            <ul className="mt-1.5 space-y-1">
              {blockers.map(f => <li key={f.id} style={{ color: 'var(--text-primary)' }} className="text-sm">• {f.title}</li>)}
            </ul>
          </div>
        )}
      </section>

      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
        <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-widest">Posture trend</p>
        {trend === undefined ? (
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">Checking scan history…</p>
        ) : trend === null ? (
          <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-sm font-semibold">No prior scan available</p>
        ) : (
          <p style={{ color: trend.verdictImproved || trend.scoreChange > 0 ? 'var(--accent-green-text)' : trend.scoreChange < 0 || (trend.verdictChanged && !trend.verdictImproved) ? 'var(--accent-red-text)' : 'var(--text-secondary)' }} className="mt-1 text-sm font-semibold">
            {trend.verdictImproved || trend.scoreChange > 0 ? 'Improving' : trend.scoreChange < 0 || (trend.verdictChanged && !trend.verdictImproved) ? 'Degrading' : 'Unchanged'}
            {trend.scoreChange !== 0 && ` — score ${trend.scoreChange > 0 ? '+' : ''}${trend.scoreChange} vs. previous scan`}
          </p>
        )}
      </section>

      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className={`rounded-3xl p-6 shadow-xl shadow-black/5 md:p-8 ${verified ? 'bg-[#10B981]/8' : 'bg-[#EF4444]/8'}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Badge variant={verified ? 'verified' : 'failed'}>{verified ? 'VERIFIED' : 'NOT VERIFIED'}</Badge>
            <h1 style={{ color: 'var(--text-primary)' }} className="mt-3 text-2xl font-bold tracking-tight md:text-3xl">{name}</h1>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-2 max-w-xl text-sm leading-relaxed">
              {verified
                ? 'This agent showed the execution trust controls Agent Verify checks for. Findings and evidence are in the Security view.'
                : 'This agent has gaps that should be closed before it is connected to production tools, payments, deployments, or sensitive data.'}
            </p>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="shrink-0 rounded-2xl px-6 py-4 text-center">
            <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-medium uppercase tracking-widest">Security score</p>
            <p style={{ color: 'var(--text-primary)' }} className="mt-1 text-4xl font-bold">{riskScore}<span style={{ color: 'var(--text-muted)' }} className="text-lg">/100</span></p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-5">
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">What this agent can do</p>
          {capabilities.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs">No consequential capabilities were detected.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {capabilities.slice(0, 8).map(c => <li key={c.id} style={{ color: 'var(--text-secondary)' }} className="text-sm">• {c.label}</li>)}
            </ul>
          )}
        </section>
        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-5">
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">What it can access</p>
          {mcpExposures.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs">No external tool/MCP connections were detected. Tool access level: {bom.toolAccessLevel}.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {mcpExposures.slice(0, 8).map((m, i) => <li key={`${m.toolName}-${i}`} style={{ color: 'var(--text-secondary)' }} className="text-sm">• {m.toolName}{m.server ? ` (${m.server})` : ''}</li>)}
            </ul>
          )}
        </section>
      </div>

      {topRisks.length > 0 && (
        <section style={{ backgroundColor: 'var(--card)', border: '1px solid #E03E3E33' }} className="rounded-3xl p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-red-text)]">Top risks</p>
          <h2 style={{ color: 'var(--text-primary)' }} className="mt-1 text-lg font-semibold">{topRisks.length} thing{topRisks.length === 1 ? '' : 's'} to know right now</h2>
          <ol className="mt-3 space-y-2">
            {topRisks.map((title, i) => (
              <li key={title} className="flex items-start gap-3 rounded-xl px-4 py-2.5" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E03E3E]/10 text-xs font-bold text-[color:var(--accent-red-text)]">{i + 1}</span>
                <span style={{ color: 'var(--text-primary)' }} className="text-sm font-medium">{title}</span>
              </li>
            ))}
          </ol>
          <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">{criticalCount} critical, {highCount} high-severity finding{highCount === 1 ? '' : 's'} in total.</p>
        </section>
      )}

      {capabilityChains.length > 0 && (
        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-5">
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Consequential capability combinations</p>
          <ul className="mt-2 space-y-1.5">
            {capabilityChains.slice(0, 5).map(c => <li key={c.id} style={{ color: 'var(--text-secondary)' }} className="text-sm">• {c.title}</li>)}
          </ul>
        </section>
      )}

      {securityControlsDetected.length > 0 && (
        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-5">
          <p className="text-sm font-semibold text-[color:var(--accent-green-text)]">Security controls detected</p>
          <ul className="mt-2 space-y-1.5">
            {securityControlsDetected.slice(0, 6).map(c => <li key={c.id} style={{ color: 'var(--text-secondary)' }} className="text-sm">• {c.label}</li>)}
          </ul>
        </section>
      )}

      {fixFirst.length > 0 && (
        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-5">
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Fix first</p>
          <ol className="mt-2 space-y-1.5">
            {fixFirst.map((item, i) => <li key={item.title} style={{ color: 'var(--text-secondary)' }} className="text-sm">{i + 1}. {item.title}</li>)}
          </ol>
          {onSwitchToDeveloper && <button onClick={onSwitchToDeveloper} className="mt-3 text-xs font-semibold text-[color:var(--accent-cyan-text)] hover:opacity-80">See the Developer view for exactly how to fix each one →</button>}
        </section>
      )}

      <p style={{ color: 'var(--text-muted)' }} className="text-center text-xs">Scan-to-scan change history is in the Security view when a previous scan of this agent exists.</p>
    </div>
  )
}
