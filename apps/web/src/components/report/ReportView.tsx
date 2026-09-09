'use client'

import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import type { CategoryScore, Finding, RuntimeBOM as RuntimeBOMType } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { freeBillingStatus, type BillingStatus } from '@/lib/billing'
import { normalizeReportData, toHashableScanResult } from '@/lib/normalizeReport'
import { computeReportHash } from '@/lib/reportIntegrity'
import { ReportModeSelector, type ReportMode } from '@/components/report/ReportModeSelector'
import { ExecutiveReportView } from '@/components/report/views/ExecutiveReportView'
import { SecurityReportView } from '@/components/report/views/SecurityReportView'
import { DeveloperReportView } from '@/components/report/views/DeveloperReportView'
import { ComplianceReportView } from '@/components/report/views/ComplianceReportView'
import { AiJsonReportView } from '@/components/report/views/AiJsonReportView'
import { FullTechnicalReportView } from '@/components/report/views/FullTechnicalReportView'

export interface ReportViewProps {
  report?: Record<string, unknown>
  verdict?: string
  riskScore?: number
  riskLevel?: string
  fileName?: string
  platform?: string | null
  scannedAt?: string
  source?: string
  findings?: Array<Finding | Partial<Finding> | string>
  categoryScores?: CategoryScore[]
  bom?: RuntimeBOMType | null
  reportId?: string
  originalContent?: string
  onNewScan?: () => void
  reportUrl?: string
  user?: User | null
  isOwner?: boolean
  onReportUpdate?: (updates: Record<string, unknown>) => void
  billingStatus?: BillingStatus
}

export function ReportView({
  report,
  verdict,
  riskScore,
  riskLevel,
  fileName,
  platform,
  scannedAt,
  source = 'dashboard',
  findings,
  categoryScores,
  bom,
  reportId,
  onNewScan,
  reportUrl,
  user = null,
  isOwner = false,
  onReportUpdate,
  billingStatus = freeBillingStatus,
}: ReportViewProps) {
  // Canonical evidence: every report view (Executive, Security, Developer, Compliance, AI/JSON,
  // Full Technical) calls this same pure normalizer on the same props and gets byte-identical
  // data back — this is the single source of truth, never re-derived differently.
  const normalized = normalizeReportData({ report, verdict, riskScore, riskLevel, fileName, platform, scannedAt, source, findings, categoryScores, bom, reportId, reportUrl })
  const {
    verdictLabel, verified,
    riskScore: normalizedRiskScore, riskLevel: normalizedRiskLevel, confidence: normalizedConfidence,
    fileName: normalizedFileName, platform: normalizedPlatform, scannedAt: normalizedScannedAt, formattedDate,
    source: normalizedSource, findingCount,
    criticalCount: critical, highCount: high, mediumCount: medium,
    reportInsights,
  } = normalized
  const normalizedReportId = normalized.reportId
  const nextAction = verified
    ? 'Share this report with stakeholders or export it as a PDF for your security records.'
    : reportInsights.nextAction
  const [reportMode, setReportMode] = useState<ReportMode>('security')
  const [reportHash, setReportHash] = useState<string | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    const scannerVersion = typeof report?.scannerVersion === 'string' ? report.scannerVersion : undefined
    computeReportHash(toHashableScanResult(normalized, { scannerVersion }))
      .then(integrity => { if (!cancelled) setReportHash(integrity.reportHash) })
      .catch(() => { if (!cancelled) setReportHash(undefined) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalized.reportId])

  return (
    <main style={{ backgroundColor: 'var(--bg)' }} className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-10">
      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="print-border mb-6 overflow-hidden rounded-3xl shadow-2xl shadow-black/10">
        <div className={`p-6 md:p-8 ${verified ? 'bg-[#10B981]/8' : 'bg-[#EF4444]/8'}`}>
          <div className="grid gap-8 lg:grid-cols-[1fr_240px] lg:items-center">
            <div>
              <Badge variant={verified ? 'verified' : 'failed'}>{verdictLabel}</Badge>
              <h1 className={`mt-5 text-3xl font-bold tracking-tight md:text-4xl ${verified ? 'text-[color:var(--accent-green-text)]' : 'text-[color:var(--accent-red-text)]'}`}>{verified ? 'Execution authorized' : 'Action required before deployment'}</h1>
              <p style={{ color: 'var(--text-secondary)' }} className="mt-3 max-w-2xl text-sm leading-6 md:text-base">{verified ? 'This agent satisfies the execution trust controls visible in the submitted configuration.' : 'This report found execution-trust gaps that should be fixed before this agent is connected to production tools, payments, deployments, or sensitive data.'}</p>
              <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--accent-purple-text)]">Next action</p>
                <p style={{ color: 'var(--text-primary)' }} className="mt-2 text-sm font-medium">{nextAction}</p>
              </div>
            </div>
            <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-3xl p-6 text-center">
              <div style={{ color: 'var(--text-muted)' }} className="text-xs font-medium uppercase tracking-widest">Risk Score</div>
              <div style={{ color: 'var(--text-primary)' }} className="mt-2 text-6xl font-bold">{normalizedRiskScore}<span style={{ color: 'var(--text-muted)' }} className="text-2xl">/100</span></div>
              <div className="mt-4 flex justify-center gap-2"><Badge variant="muted">{normalizedRiskLevel}</Badge></div>
              <div style={{ color: 'var(--text-muted)' }} className="mt-4 text-xs">{findingCount} finding{findingCount !== 1 ? 's' : ''} · {critical} critical / {high} high / {medium} medium</div>
              <div style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs">Confidence: {normalizedConfidence}/100</div>
            </div>
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--border)' }} className="grid text-xs md:grid-cols-4">
           <div style={{ borderBottom: '1px solid var(--border)' }} className="p-4 md:border-r"><span style={{ color: 'var(--text-muted)' }} className="block uppercase tracking-wider">Report ID</span><span style={{ color: 'var(--text-secondary)' }} className="mt-1 block font-mono">{normalizedReportId}</span></div>
          <div style={{ borderBottom: '1px solid var(--border)' }} className="p-4"><span style={{ color: 'var(--text-muted)' }} className="block uppercase tracking-wider">Scanned</span><span style={{ color: 'var(--text-secondary)' }} className="mt-1 block">{formattedDate}</span></div>
          <div style={{ borderBottom: '1px solid var(--border)' }} className="p-4 md:border-b-0 md:border-r"><span style={{ color: 'var(--text-muted)' }} className="block uppercase tracking-wider">Asset</span><span style={{ color: 'var(--text-secondary)' }} className="mt-1 block">{normalizedFileName}</span></div>
          <div className="p-4"><span style={{ color: 'var(--text-muted)' }} className="block uppercase tracking-wider">Source</span><span style={{ color: 'var(--text-secondary)' }} className="mt-1 block">{normalizedSource === 'cli' ? 'CLI Scanner' : normalizedSource === 'public' ? 'Public Report' : 'Dashboard'}{normalizedPlatform ? ` / ${normalizedPlatform}` : ''}</span></div>
        </div>
      </section>

      <ReportModeSelector mode={reportMode} onChange={setReportMode} />

      {reportMode === 'executive' && <ExecutiveReportView data={normalized} onSwitchToDeveloper={() => setReportMode('developer')} report={report} user={user} />}
      {reportMode === 'developer' && <DeveloperReportView data={normalized} />}
      {reportMode === 'compliance' && <ComplianceReportView data={normalized} />}
      {reportMode === 'json' && <AiJsonReportView data={normalized} reportHash={reportHash} />}
      {reportMode === 'technical' && <FullTechnicalReportView data={normalized} reportHash={reportHash} scannerVersion={typeof report?.scannerVersion === 'string' ? report.scannerVersion : undefined} />}

      {reportMode === 'security' && (
        <SecurityReportView
          data={normalized}
          report={report}
          reportId={reportId}
          user={user}
          isOwner={isOwner}
          onReportUpdate={onReportUpdate}
          onNewScan={onNewScan}
          reportUrl={reportUrl}
          billingStatus={billingStatus}
        />
      )}

      <footer style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }} className="print-border mt-10 flex flex-col items-center justify-between gap-3 pt-6 text-center text-xs md:flex-row md:gap-6 md:text-left">
        <span>Generated by Agent Verify - Execution Trust Analysis Platform</span>
        <span>Powered by A2SPA / AI Blockchain Ventures LLC / aiblockchainventures.com</span>
      </footer>
    </main>
  )
}
