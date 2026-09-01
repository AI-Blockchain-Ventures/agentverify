'use client'

import { useEffect, useState, type SyntheticEvent } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import type { User } from 'firebase/auth'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import type { CategoryScore, Finding, RuntimeBOM as RuntimeBOMType, RiskLevel, ThreatCategoryAssessment, ThreatCategoryStatus, Verdict, AgentCapability, McpToolExposure, SecurityCategoryStatus, CapabilityChain } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { CategoryScores } from '@/components/scanner/CategoryScores'
import { FindingCard } from '@/components/scanner/FindingCard'
import { RuntimeBOM } from '@/components/scanner/RuntimeBOM'
import { ScanComparison } from '@/components/report/ScanComparison'
import { BlastRadius } from '@/components/scanner/BlastRadius'
import { ControlsAndLimits } from '@/components/scanner/ControlsAndLimits'
import { Capabilities } from '@/components/scanner/Capabilities'
import { McpExposures } from '@/components/scanner/McpExposures'
import { SecurityCategories } from '@/components/scanner/SecurityCategories'
import { ScoreExplainer } from '@/components/scanner/ScoreExplainer'
import { canUseProFeature, freeBillingStatus, type BillingStatus } from '@/lib/billing'
import { db } from '@/lib/firebase'
import { generateSummary } from '@/lib/generateSummary'
import { copyToClipboard } from '@/lib/clipboard'
import { A2SPA_DOCS_URL } from '@/lib/links'
import { normalizeReportData, toHashableScanResult } from '@/lib/normalizeReport'
import { computeReportHash } from '@/lib/reportIntegrity'
import { ReportModeSelector, type ReportMode } from '@/components/report/ReportModeSelector'
import { ExecutiveReportView } from '@/components/report/views/ExecutiveReportView'
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

const threatStatusLabel: Record<ThreatCategoryStatus, string> = {
  detected: 'Detected',
  possible: 'Possible',
  missing_evidence: 'Missing evidence',
  not_assessed: 'Not assessed',
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
  const [copied, setCopied] = useState<string | null>(null)
  const [showShare, setShowShare] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  // Canonical evidence: every report view (Executive, Security Analysis, Developer, Compliance,
  // AI/JSON, Full Technical) calls this same pure normalizer on the same props and gets
  // byte-identical data back — this is the single source of truth, never re-derived differently.
  const normalized = normalizeReportData({ report, verdict, riskScore, riskLevel, fileName, platform, scannedAt, source, findings, categoryScores, bom, reportId, reportUrl })
  const {
    reportId: normalizedReportId, verdict: normalizedVerdict, verdictLabel, verified,
    riskScore: normalizedRiskScore, riskLevel: normalizedRiskLevel, confidence: normalizedConfidence,
    fileName: normalizedFileName, platform: normalizedPlatform, scannedAt: normalizedScannedAt, formattedDate,
    source: normalizedSource, findings: safeFindings, findingCount,
    criticalCount: critical, highCount: high, mediumCount: medium,
    categoryScores: normalizedCategoryScores, bom: normalizedBom,
    capabilities: normalizedCapabilities, mcpExposures: normalizedMcpExposures,
    securityCategories: normalizedSecurityCategories, capabilityChains: normalizedCapabilityChains,
    a2spaStatus: normalizedA2spaStatus, securityControlsDetected: normalizedControls,
    notDetermined: normalizedNotDetermined, threatCategories, relevantThreatCategories,
    reportInsights, evidenceFindings, complianceTags, publicReportUrl,
  } = normalized
  const { owasp: owaspTags, nist: nistTags, soc2: soc2Tags } = complianceTags
  const nextAction = verified
    ? 'Share this report with stakeholders or export it as a PDF for your security records.'
    : reportInsights.nextAction
  const [shareSettings, setShareSettings] = useState({
    isPublic: report?.isPublic === true,
  })
  useEffect(() => {
    setShareSettings({ isPublic: report?.isPublic === true })
    setShareError(null)
  }, [report?.isPublic])
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
  const summary = generateSummary({
    reportId: normalizedReportId,
    verdict: normalizedVerdict,
    riskScore: normalizedRiskScore,
    riskLevel: normalizedRiskLevel,
      confidence: normalizedConfidence,
    optimizationScore: 0,
    findings: safeFindings,
    categoryScores: normalizedCategoryScores,
    bom: normalizedBom,
    metadata: {
      fileName: normalizedFileName,
      fileSize: 0,
      scannedAt: normalizedScannedAt,
      detectedLanguage: normalizedBom.detectedLanguage,
      detectedFramework: normalizedBom.detectedFramework,
      selectedPlatform: normalizedPlatform ?? normalizedBom.detectedPlatform,
      agentName: normalizedBom.agentName,
      scanDuration: 0,
    },
  } as any)
  const canViewFullRemediation = canUseProFeature(billingStatus, 'fullRemediation')
  const canViewCorrectedSnippets = canUseProFeature(billingStatus, 'correctedSnippets')
  const canViewA2spaGuidance = canUseProFeature(billingStatus, 'a2spaGuidance')
  const hasProAccess = canViewFullRemediation || canViewCorrectedSnippets || canViewA2spaGuidance
  const badgeReportId = typeof reportId === 'string' ? reportId : ''
  const showBadge = normalizedVerdict === 'VERIFIED' && badgeReportId.startsWith('REPORT-')
  const badgeVersion = encodeURIComponent(`${badgeReportId}-${normalizedRiskScore}-${normalizedScannedAt}`)

  const copyText = async (text: string, key: string) => {
    if (await copyToClipboard(text)) {
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    }
  }

  const saveShareSettings = async () => {
    if (!user || !normalizedReportId) return
    setShareError(null)
    setSaved(false)
    if (shareSettings.isPublic === (report?.isPublic === true)) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      return
    }
    setSaving(true)

    const reportData = report ?? {}
    const updates = {
      isPublic: shareSettings.isPublic,
    }

    try {
      const topRef = doc(db, 'reports', normalizedReportId)
      await setDoc(topRef, {
        ...reportData,
        ...updates,
        reportId: normalizedReportId,
        uid: typeof reportData.uid === 'string' ? reportData.uid : user.uid,
        userId: typeof reportData.userId === 'string' ? reportData.userId : user.uid,
      }, { merge: true })

      if (report?._source === 'cliReports') {
        await updateDoc(doc(db, 'cliReports', normalizedReportId), updates)
      }

      try {
        await updateDoc(doc(db, 'users', user.uid, 'reports', normalizedReportId), updates)
      } catch {
        // The top-level reports document is the canonical sharing state.
      }

      const savedDoc = await getDoc(topRef)
      if (!savedDoc.exists() || savedDoc.data().isPublic !== shareSettings.isPublic) {
        throw new Error('Share setting verification failed')
      }

      onReportUpdate?.(updates)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('Failed to save share settings:', err)
      setShareError('Share settings could not be saved. Refresh and try again.')
    } finally {
      setSaving(false)
    }
  }

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

      {reportMode === 'executive' && <ExecutiveReportView data={normalized} onSwitchToDeveloper={() => setReportMode('developer')} />}
      {reportMode === 'developer' && <DeveloperReportView data={normalized} />}
      {reportMode === 'compliance' && <ComplianceReportView data={normalized} />}
      {reportMode === 'json' && <AiJsonReportView data={normalized} reportHash={reportHash} />}
      {reportMode === 'technical' && <FullTechnicalReportView data={normalized} reportHash={reportHash} scannerVersion={typeof report?.scannerVersion === 'string' ? report.scannerVersion : undefined} />}

      {reportMode === 'security' && (
      <>
      <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="no-print mb-6 flex flex-col gap-4 rounded-2xl p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{hasProAccess ? 'Apply these fixes' : 'What to do next'}</p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">{hasProAccess ? 'Add A2SPA execution authorization, export PDF evidence, share the report, then run another scan.' : 'Fix the highest-severity findings first, implement A2SPA where execution controls are missing, then re-scan to verify the changes.'}</p>
        </div>
        {hasProAccess ? (
          <div className="flex flex-wrap gap-2">
            <a href={A2SPA_DOCS_URL} target="_blank" rel="noreferrer" className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-center text-sm font-semibold text-[var(--text-primary)] hover:opacity-85">Add A2SPA execution authorization</a>
            <button onClick={() => copyText(publicReportUrl, 'pro-share-link')} className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text-primary)] hover:opacity-85">Share report</button>
            {onNewScan && <button onClick={onNewScan} className="rounded-xl bg-[#7C3AED] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-85">Run another scan</button>}
          </div>
        ) : <Link href="/pricing" className="rounded-xl bg-[#7C3AED] px-4 py-2.5 text-center text-sm font-semibold text-white hover:opacity-85">Upgrade to Pro</Link>}
      </div>

      {isOwner && (
        <div className="no-print mb-6">
          <button onClick={() => setShowShare(!showShare)} style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }} className="mb-3 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors hover:opacity-70">
            {shareSettings.isPublic ? '🌐 Public' : '🔒 Private'} · Share settings
          </button>
          {showShare && (
            <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mb-6 rounded-xl p-5">
              <h3 style={{ color: 'var(--text-primary)' }} className="mb-5 text-sm font-semibold">Share Settings</h3>
              <div className="mb-5 flex items-center justify-between pb-5" style={{ borderBottom: '1px solid var(--border)' }}>
                <div>
                  <p style={{ color: 'var(--text-primary)' }} className="text-sm font-medium">Public access</p>
                  <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-xs">{shareSettings.isPublic ? 'Anyone with the link can view this report' : 'Only you can view this report'}</p>
                </div>
                <button onClick={() => { setShareError(null); setSaved(false); setShareSettings(s => ({ ...s, isPublic: !s.isPublic })) }} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${shareSettings.isPublic ? 'bg-[#7C3AED]' : 'bg-[#1A2535]'}`}>
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${shareSettings.isPublic ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              {shareError && (
                <div className="mb-5 rounded-lg border border-[#E03E3E]/30 bg-[#E03E3E]/10 p-3">
                  <p className="text-xs font-semibold text-[color:var(--accent-red-text)]">Save failed</p>
                  <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-xs">{shareError}</p>
                </div>
              )}
              <div className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <p style={{ color: 'var(--text-primary)' }} className="text-xs font-semibold">Sharing model</p>
                <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">This release supports owner-only private reports or public report links when sharing is available for your plan.</p>
              </div>
              <div className="mb-5 rounded-lg border border-[#E07B39]/30 bg-[#E07B39]/10 p-3">
                <p className="text-xs font-semibold text-[color:var(--accent-orange-text)]">Password-protected sharing is coming next</p>
                <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-xs">For now, use Public link or Private owner-only mode. We will not fake password protection until the Worker can verify passwords server-side before report content is delivered.</p>
              </div>
              {shareSettings.isPublic && (
                <div className="mb-5">
                  <p style={{ color: 'var(--text-primary)' }} className="mb-2 text-sm font-medium">Share link</p>
                  <div className="relative">
                    <input readOnly aria-label="Report share link" value={publicReportUrl} style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-muted)' }} className="w-full rounded-lg px-4 py-2.5 pr-20 font-mono text-xs outline-none" />
                    <button onClick={() => copyText(publicReportUrl, 'owner-link')} style={{ backgroundColor: copied === 'owner-link' ? '#7C3AED' : 'var(--card)', color: copied === 'owner-link' ? '#060A0F' : 'var(--text-muted)', border: '1px solid var(--border)' }} className="absolute right-2 top-1.5 rounded px-2 py-1 text-xs font-medium transition-all">
                      {copied === 'owner-link' ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}
              {shareSettings.isPublic && normalized.artifactHash && (
                <div className="mb-5">
                  <p style={{ color: 'var(--text-primary)' }} className="mb-2 text-sm font-medium">Public verification link</p>
                  <p style={{ color: 'var(--text-muted)' }} className="mb-2 text-xs leading-relaxed">A lightweight trust receipt — verdict, artifact fingerprint, and attestation status only. No findings, no report content. Safe to send to anyone.</p>
                  <div className="relative">
                    <input readOnly aria-label="Public verification link" value={`https://aimodularity.com/agentverify/verify/?hash=${normalized.artifactHash}`} style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-muted)' }} className="w-full rounded-lg px-4 py-2.5 pr-20 font-mono text-xs outline-none" />
                    <button onClick={() => copyText(`https://aimodularity.com/agentverify/verify/?hash=${normalized.artifactHash}`, 'verify-link')} style={{ backgroundColor: copied === 'verify-link' ? '#7C3AED' : 'var(--card)', color: copied === 'verify-link' ? '#060A0F' : 'var(--text-muted)', border: '1px solid var(--border)' }} className="absolute right-2 top-1.5 rounded px-2 py-1 text-xs font-medium transition-all">
                      {copied === 'verify-link' ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}
              <button onClick={saveShareSettings} disabled={saving} className="rounded-lg bg-[#7C3AED] px-5 py-2 text-sm font-semibold text-white hover:bg-[#06B6D4] hover:text-[#060A0F] disabled:opacity-50">
                {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save settings'}
              </button>
            </div>
          )}
        </div>
      )}

      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="print-border mb-6 rounded-xl p-6">
        <div style={{ borderBottom: '1px solid var(--border)' }} className="mb-5 pb-3"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-purple-text)]">Section 01</p><h2 style={{ color: 'var(--text-primary)' }} className="mt-1 text-lg font-semibold">Executive Summary</h2></div>
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-xl p-5">
          <p style={{ color: 'var(--text-primary)' }} className="mb-3 text-sm font-medium">{summary.headline}</p>
          <ul className="mb-4 space-y-1.5">
            {summary.bullets.map((bullet, i) => <li key={i} style={{ color: 'var(--text-secondary)' }} className="flex items-start gap-2 text-sm"><span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${verified ? 'bg-[#00B37E]' : 'bg-[#E03E3E]'}`} />{bullet}</li>)}
          </ul>
          {!verified && <div className="rounded-lg border border-[#E03E3E]/20 bg-[#E03E3E]/5 p-3"><p className="mb-1 text-xs font-medium text-[color:var(--accent-red-text)]">Attack Surface</p><p style={{ color: 'var(--text-secondary)' }} className="text-xs">{summary.attackerView}</p></div>}
          <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">{summary.action}</p>
        </div>
      </section>

      {isOwner && user && report && <ScanComparison report={report} user={user} />}

      {!verified && reportInsights.highestRisks.length > 0 && (
        <section style={{ backgroundColor: 'var(--card)', border: '1px solid #E03E3E33' }} className="mb-6 rounded-3xl p-6 shadow-xl shadow-black/5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-red-text)]">Highest risks</p>
          <h2 style={{ color: 'var(--text-primary)' }} className="mt-1 text-lg font-semibold">The {reportInsights.highestRisks.length} most important thing{reportInsights.highestRisks.length === 1 ? '' : 's'} to understand right now</h2>
          <ol className="mt-4 space-y-2">
            {reportInsights.highestRisks.map((title, i) => (
              <li key={title} style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="flex items-start gap-3 rounded-xl px-4 py-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E03E3E]/10 text-xs font-bold text-[color:var(--accent-red-text)]">{i + 1}</span>
                <span style={{ color: 'var(--text-primary)' }} className="text-sm font-medium">{title}</span>
              </li>
            ))}
          </ol>
          {reportInsights.canWait.length > 0 && (
            <details className="mt-4">
              <summary style={{ color: 'var(--text-muted)' }} className="cursor-pointer text-xs font-medium">What can wait ({reportInsights.canWait.length})</summary>
              <ul className="mt-2 space-y-1 pl-1">
                {reportInsights.canWait.map(title => <li key={title} style={{ color: 'var(--text-muted)' }} className="text-xs">• {title}</li>)}
              </ul>
            </details>
          )}
          <p style={{ color: 'var(--text-muted)' }} className="mt-4 text-xs leading-relaxed">Fixing these will most improve the score. Re-scan after making changes to confirm — a future scan is not guaranteed to pass, since verification depends on the actual evidence present at scan time.</p>
        </section>
      )}

      <Capabilities capabilities={normalizedCapabilities} />
      <McpExposures exposures={normalizedMcpExposures} />
      <BlastRadius chains={normalizedCapabilityChains} />
      <ControlsAndLimits controls={normalizedControls} notDetermined={normalizedNotDetermined} />

      <CategoryScores scores={normalizedCategoryScores} />
      <SecurityCategories categories={normalizedSecurityCategories} />

      {threatCategories.length > 0 && (
        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mb-6 rounded-3xl p-6 shadow-xl shadow-black/5">
          <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-purple-text)]">Threat category breakdown</p>
              <h2 style={{ color: 'var(--text-primary)' }} className="mt-1 text-lg font-semibold">Which agent risks are relevant?</h2>
            </div>
            <Badge variant="muted">{relevantThreatCategories.length} relevant categories</Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {(relevantThreatCategories.length ? relevantThreatCategories : threatCategories.slice(0, 6)).map(item => (
              <details key={item.id} style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
                <summary className="cursor-pointer list-none">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{item.label}</p>
                      <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs leading-relaxed">{item.whatItMeans}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${item.status === 'detected' ? 'bg-[#E03E3E]/10 text-[color:var(--accent-red-text)]' : item.status === 'missing_evidence' ? 'bg-[#E07B39]/10 text-[color:var(--accent-orange-text)]' : item.status === 'possible' ? 'bg-[#7C3AED]/10 text-[color:var(--accent-purple-text)]' : 'bg-[var(--text-muted)]/10 text-[var(--text-muted)]'}`}>{threatStatusLabel[item.status]}</span>
                  </div>
                </summary>
                <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
                  <p style={{ color: 'var(--text-secondary)' }} className="text-xs leading-relaxed"><strong>Scanner looks for:</strong> {item.evidencePattern}</p>
                  <p style={{ color: 'var(--text-secondary)' }} className="text-xs leading-relaxed"><strong>Why it matters:</strong> {item.whyItMatters}</p>
                  <p style={{ color: 'var(--text-secondary)' }} className="text-xs leading-relaxed"><strong>How to fix:</strong> {item.recommendedFix}</p>
                  <p style={{ color: 'var(--text-secondary)' }} className="text-xs leading-relaxed"><strong>A2SPA impact:</strong> {item.a2spaImpact}</p>
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mb-6 rounded-3xl p-6 shadow-xl shadow-black/5">
        <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-purple-text)]">Score breakdown</p>
            <h2 style={{ color: 'var(--text-primary)' }} className="mt-1 text-lg font-semibold">Why this report scored {normalizedRiskScore}/100</h2>
          </div>
          {reportInsights.topBlocker && <Badge variant="muted">Top blocker: {reportInsights.topBlocker}</Badge>}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {[
            ['Execution readiness', reportInsights.executionReadinessScore, 'Can this agent prove a request is genuinely authorized before it acts?'],
            ['A2SPA readiness', reportInsights.a2spaReadinessScore, 'Does the code actually sign and check execution requests, reject replayed or expired ones, and block action when that check fails?'],
            ['Remediation progress', reportInsights.remediationProgressScore, 'How much risk is left after everything this scan found?'],
          ].map(([label, value, detail]) => (
            <div key={label as string} style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
              <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{label}</p>
              <p className="mt-2 text-3xl font-bold text-[color:var(--accent-purple-text)]">{value as number}<span style={{ color: 'var(--text-muted)' }} className="text-sm">/100</span></p>
              <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs leading-relaxed">{detail}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div>
            <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">What reduced the score</p>
            <ul className="mt-2 space-y-2">
              {(reportInsights.scoreExplanation.length ? reportInsights.scoreExplanation : [`${findingCount} finding${findingCount !== 1 ? 's' : ''} reduced the score.`, reportInsights.topBlocker ? `${reportInsights.topBlocker} is the current top blocker.` : 'No blocking finding detected.']).map(item => <li key={item} style={{ color: 'var(--text-secondary)' }} className="text-xs leading-relaxed">- {item}</li>)}
            </ul>
          </div>
          <div>
            <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">What improves the score</p>
            <ul className="mt-2 space-y-2">
              {(reportInsights.improvesScore.length ? reportInsights.improvesScore : reportInsights.fixPriority.slice(0, 4).map(item => `Fix ${item.title.toLowerCase()} and re-scan.`)).map(item => <li key={item} style={{ color: 'var(--text-secondary)' }} className="text-xs leading-relaxed">- {item}</li>)}
            </ul>
          </div>
        </div>
        <div className="mt-5">
          <ScoreExplainer formula={reportInsights.scoreFormula} />
        </div>
      </section>

      {reportInsights.fixPriority.length > 0 && (
        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mb-6 rounded-3xl p-6 shadow-xl shadow-black/5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-purple-text)]">Prioritized fix plan</p>
          <h2 style={{ color: 'var(--text-primary)' }} className="mt-1 text-lg font-semibold">What to fix first</h2>
          <div className="mt-4 grid gap-3">
            {reportInsights.fixPriority.slice(0, 7).map((item, index) => (
              <div key={`${item.title}-${index}`} style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{index + 1}. {item.title}</p>
                  <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${item.priority === 'fix_first' ? 'bg-[#E03E3E]/10 text-[color:var(--accent-red-text)]' : item.priority === 'fix_next' ? 'bg-[#E07B39]/10 text-[color:var(--accent-orange-text)]' : 'bg-[#7C3AED]/10 text-[color:var(--accent-purple-text)]'}`}>{item.priority === 'fix_first' ? 'Fix first' : item.priority === 'fix_next' ? 'Fix next' : 'Nice to have'}</span>
                </div>
                <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs leading-relaxed">{item.reason}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {safeFindings.some(finding => finding.category === 'A') && (
        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mb-6 rounded-3xl p-6 shadow-xl shadow-black/5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-purple-text)]">Implement A2SPA</p>
            {normalizedA2spaStatus && (
              <span
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{
                  color: normalizedA2spaStatus === 'detected' ? 'var(--accent-green-text)' : normalizedA2spaStatus === 'partially_detected' ? 'var(--accent-orange-text)' : normalizedA2spaStatus === 'not_detected' ? 'var(--accent-red-text)' : 'var(--text-muted)',
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                }}
              >
                {normalizedA2spaStatus === 'detected' ? 'DETECTED' : normalizedA2spaStatus === 'partially_detected' ? 'PARTIALLY DETECTED' : normalizedA2spaStatus === 'not_detected' ? 'NOT DETECTED' : 'CANNOT DETERMINE'}
              </span>
            )}
          </div>
          <h2 style={{ color: 'var(--text-primary)' }} className="mt-1 text-lg font-semibold">Add authorization at the execution boundary</h2>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs leading-relaxed">Status reflects only static evidence in the submitted content — mentioning &quot;A2SPA&quot; by name is not treated as evidence; only an actual signature/verification code pattern is.</p>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-3 text-sm leading-relaxed">A2SPA signs the intended execution payload before action and verifies that signed payload at the server-side execution boundary. Add signing on the trusted caller side, verify before tools or payments run, reject reused nonces and expired timestamps, and fail closed when authorization is missing or invalid.</p>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-3 text-sm leading-relaxed">Place your private key in your deployment environment or secret manager, then reference it here with environment variables such as <code>process.env.A2SPA_PRIVATE_KEY</code> and <code>process.env.A2SPA_PUBLIC_KEY</code>.</p>
          <p className="mt-3 text-xs font-semibold text-[color:var(--accent-orange-text)]">Never paste a production private key into Agent Verify, source code, or a public repository. Store it in an environment variable or a secret manager.</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <a href={A2SPA_DOCS_URL} target="_blank" rel="noreferrer" className="rounded-xl bg-[#7C3AED] px-4 py-2.5 text-center text-sm font-semibold text-white">Read A2SPA docs</a>
            <button onClick={() => copyText('const signingKey = process.env.A2SPA_PRIVATE_KEY\nconst verifyKey = process.env.A2SPA_PUBLIC_KEY', 'a2spa-env')} style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }} className="rounded-xl px-4 py-2.5 text-sm font-semibold">{copied === 'a2spa-env' ? 'Copied' : 'Copy env placeholders'}</button>
          </div>
        </section>
      )}

      {evidenceFindings.length > 0 && (
        <div className="mb-6">
          <div className="mb-4 flex items-center gap-3">
            <h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-bold uppercase tracking-widest">Evidence Extracts</h2>
            <div style={{ backgroundColor: 'var(--border)' }} className="h-px flex-1" />
          </div>
          <div className="space-y-2">
            {evidenceFindings.map((finding, i) => (
              <div key={finding.id ?? i} style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="flex items-start gap-3 rounded-lg px-4 py-3">
                <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-bold ${finding.severity === 'critical' ? 'bg-[#E03E3E]/10 text-[color:var(--accent-red-text)]' : finding.severity === 'high' ? 'bg-[#E07B39]/10 text-[color:var(--accent-orange-text)]' : 'bg-[var(--text-muted)]/20 text-[var(--text-muted)]'}`}>
                  {finding.severity}
                </span>
                <div className="min-w-0 flex-1">
                  <p style={{ color: 'var(--text-secondary)' }} className="mb-1 text-xs font-medium">{finding.title}</p>
                  <code className="break-all font-mono text-xs text-[color:var(--accent-orange-text)]">{finding.evidence}</code>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <section className="mb-6">
        <div style={{ borderBottom: '1px solid var(--border)' }} className="mb-4 pb-3"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-purple-text)]">Section 02</p><h2 style={{ color: 'var(--text-primary)' }} className="mt-1 font-semibold">Findings ({safeFindings.length})</h2></div>
        {safeFindings.length > 0 && !hasProAccess && (
          <div className="mb-4 rounded-xl border border-[#7C3AED]/30 bg-[#7C3AED]/10 p-4">
            <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Need corrected code and implementation guidance?</p>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-xs">Pro includes full remediation, corrected code, A2SPA guidance, and PDF export.</p>
            <Link href="/pricing" className="mt-3 inline-flex rounded-lg bg-[#7C3AED] px-3 py-2 text-xs font-semibold text-white">View Pro</Link>
          </div>
        )}
        {safeFindings.length === 0 ? <div className="rounded-xl border border-[#10B981]/20 bg-[#10B981]/5 p-8 text-center"><div style={{ color: 'var(--text-primary)' }} className="font-semibold">No issues detected</div><div style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">This agent passed all security checks</div></div> : <div className="space-y-2">{safeFindings.map(finding => <FindingCard key={finding.id} finding={finding} showFullRemediation={canViewFullRemediation} showCorrectedSnippets={canViewCorrectedSnippets} showA2spaGuidance={canViewA2spaGuidance} />)}</div>}
      </section>

      {(owaspTags.length > 0 || nistTags.length > 0 || soc2Tags.length > 0) && (
        <div className="mb-8">
          <div className="mb-4 flex items-center gap-3">
            <h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-bold uppercase tracking-widest">Compliance Mapping</h2>
            <div style={{ backgroundColor: 'var(--border)' }} className="h-px flex-1" />
          </div>
          <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-xl p-5">
            <p style={{ color: 'var(--text-muted)' }} className="mb-4 text-xs">Findings mapped to industry security frameworks</p>
            {owaspTags.length > 0 && (
              <div className="mb-4">
                <p style={{ color: 'var(--text-primary)' }} className="mb-2 text-xs font-semibold">OWASP LLM Top 10</p>
                <div className="flex flex-wrap gap-2">
                  {owaspTags.map(tag => <span key={tag} className="rounded border border-[#E07B39]/20 bg-[#E07B39]/5 px-2.5 py-1 text-xs text-[color:var(--accent-orange-text)]">{tag}</span>)}
                </div>
              </div>
            )}
            {nistTags.length > 0 && (
              <div className="mb-4">
                <p style={{ color: 'var(--text-primary)' }} className="mb-2 text-xs font-semibold">NIST AI RMF</p>
                <div className="flex flex-wrap gap-2">
                  {nistTags.map(tag => <span key={tag} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }} className="rounded px-2.5 py-1 text-xs">{tag}</span>)}
                </div>
              </div>
            )}
            {soc2Tags.length > 0 && (
              <div>
                <p style={{ color: 'var(--text-primary)' }} className="mb-2 text-xs font-semibold">SOC 2</p>
                <div className="flex flex-wrap gap-2">
                  {soc2Tags.map(tag => <span key={tag} style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }} className="rounded px-2.5 py-1 text-xs">{tag}</span>)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {safeFindings.length > 0 && (
        <section className="mb-8">
          <div className="mb-4 flex items-center gap-3"><h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-bold uppercase tracking-widest">Agent Fixer</h2><div style={{ backgroundColor: 'var(--border)' }} className="h-px flex-1" /></div>
          <div className="space-y-3">
            {safeFindings.map((finding, i) => {
              if (!finding.quickFix && !finding.recommendedFix) return null
              return <div key={finding.id ?? i} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-xl p-5"><p style={{ color: 'var(--text-primary)' }} className="mb-3 text-sm font-semibold">{finding.title}</p>{finding.quickFix && <div className="mb-3"><p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[color:var(--accent-green-text)]">Quick Fix</p><pre tabIndex={0} role="region" aria-label="Quick fix code" className="overflow-x-auto rounded-lg border border-[#00B37E]/20 bg-[#00B37E]/5 px-4 py-3 font-mono text-xs leading-relaxed text-[color:var(--accent-green-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#06B6D4]">{finding.quickFix}</pre></div>}{finding.recommendedFix && <div><p style={{ color: 'var(--text-muted)' }} className="mb-1.5 text-xs font-semibold uppercase tracking-wider">Full Guidance</p><p style={{ color: 'var(--text-secondary)' }} className="whitespace-pre-line text-sm leading-relaxed">{finding.recommendedFix}</p></div>}</div>
            })}
          </div>
        </section>
      )}

      <RuntimeBOM bom={normalizedBom} />

      {(onNewScan || reportUrl) && <div className="mt-8 flex flex-col gap-3 sm:flex-row">{onNewScan && <button onClick={onNewScan} className="rounded-lg bg-[#06B6D4] px-5 py-2.5 text-sm font-semibold text-[#080B14] transition-colors hover:bg-[#06B6D4]">Run New Scan</button>}{reportUrl && <button onClick={() => copyText(publicReportUrl, 'report-link')} style={{ backgroundColor: copied === 'report-link' ? '#7C3AED' : 'var(--card)', color: copied === 'report-link' ? '#060A0F' : 'var(--text-muted)', border: '1px solid var(--border)' }} className="rounded-lg px-5 py-2.5 text-sm font-semibold transition-all hover:opacity-70">{copied === 'report-link' ? '✓ Copied' : 'Copy Report Link'}</button>}</div>}

      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mt-8 rounded-xl p-6">
        <div className="mb-4 flex items-center gap-3">
          <h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-bold uppercase tracking-widest">Share Report</h2>
          <div style={{ backgroundColor: 'var(--border)' }} className="h-px flex-1" />
        </div>
        <p style={{ color: 'var(--text-secondary)' }} className="mb-4 text-sm">
          Share this report with your team or include it in your security documentation.
        </p>
        <div className="relative mb-4">
          <input
            readOnly
            aria-label="Report share link"
            value={publicReportUrl ?? ''}
            style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
            className="w-full rounded-lg px-4 py-2.5 pr-20 font-mono text-xs outline-none"
          />
          <button onClick={() => copyText(publicReportUrl, 'link')} style={{ backgroundColor: copied === 'link' ? '#7C3AED' : 'var(--card)', color: copied === 'link' ? '#060A0F' : 'var(--text-muted)', border: '1px solid var(--border)' }} className="absolute right-2 top-1.5 rounded px-2 py-1 text-xs font-medium transition-all">
            {copied === 'link' ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        {showBadge && (
          <div
            style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
            className="mb-6 rounded-xl p-6"
          >
            <h3 style={{ color: 'var(--text-primary)' }} className="mb-4 text-sm font-semibold">
              Share & Badge
            </h3>

            <div className="mb-4">
              <p style={{ color: 'var(--text-muted)' }} className="mb-2 text-xs uppercase tracking-wider">
                Badge Preview
              </p>
              <Image
                src={`https://agentverify-api.agentverify.workers.dev/v1/badge/${badgeReportId}?v=${badgeVersion}`}
                alt="Agent Verify badge"
                width={214}
                height={20}
                className="h-5"
                key={badgeReportId}
                onError={(e: SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = 'none' }}
              />
            </div>

            <div>
              <p style={{ color: 'var(--text-muted)' }} className="mb-2 text-xs uppercase tracking-wider">
                Add to your README
              </p>
              <div className="relative">
                <pre
                  tabIndex={0}
                  role="region"
                  aria-label="README badge markdown"
                  style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: '#7C3AED' }}
                  className="overflow-x-auto rounded-lg px-4 py-3 pr-16 font-mono text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#06B6D4]"
                >
                  {`[![Agent Verify](https://agentverify-api.agentverify.workers.dev/v1/badge/${badgeReportId})](https://aimodularity.com/agentverify/report/?id=${badgeReportId})`}
                </pre>
                <button
                  onClick={() => copyText(`[![Agent Verify](https://agentverify-api.agentverify.workers.dev/v1/badge/${badgeReportId})](https://aimodularity.com/agentverify/report/?id=${badgeReportId})`, 'badge-markdown')}
                  style={{ border: '1px solid var(--border)', color: copied === 'badge-markdown' ? 'var(--accent-green-text)' : 'var(--text-muted)' }}
                  className="absolute right-2 top-2 rounded px-2 py-1 text-xs transition-opacity hover:opacity-70"
                >
                  {copied === 'badge-markdown' ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs">
                Paste this into your README.md to display a live trust badge.
              </p>
            </div>
          </div>
        )}
      </div>
      </>
      )}

      <footer style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }} className="print-border mt-10 flex flex-col items-center justify-between gap-3 pt-6 text-center text-xs md:flex-row md:gap-6 md:text-left">
        <span>Generated by Agent Verify - Execution Trust Analysis Platform</span>
        <span>Powered by A2SPA / AI Blockchain Ventures LLC / aiblockchainventures.com</span>
      </footer>
    </main>
  )
}
