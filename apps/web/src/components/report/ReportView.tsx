'use client'

import { useEffect, useState, type SyntheticEvent } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import type { User } from 'firebase/auth'
import { doc, setDoc, updateDoc } from 'firebase/firestore'
import type { CategoryScore, Finding, RuntimeBOM as RuntimeBOMType, RiskLevel, ThreatCategoryAssessment, ThreatCategoryStatus, Verdict } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { CategoryScores } from '@/components/scanner/CategoryScores'
import { FindingCard } from '@/components/scanner/FindingCard'
import { RuntimeBOM } from '@/components/scanner/RuntimeBOM'
import { canUseProFeature, freeBillingStatus, type BillingStatus } from '@/lib/billing'
import { db } from '@/lib/firebase'
import { generateSummary } from '@/lib/generateSummary'
import { A2SPA_DOCS_URL } from '@/lib/links'

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
  onUpgradePrompt?: (message: string) => void
  billingStatus?: BillingStatus
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseJson = (value: unknown): unknown => {
  if (typeof value !== 'string' || !value.trim()) return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

const threatStatusLabel: Record<ThreatCategoryStatus, string> = {
  detected: 'Detected',
  possible: 'Possible',
  missing_evidence: 'Missing evidence',
  not_assessed: 'Not assessed',
}

const reportIdFromUrl = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  try {
    return new URL(value).searchParams.get('id') ?? ''
  } catch {
    return ''
  }
}

const normalizeVerdict = (value: unknown): Verdict => {
  if (value === 'VERIFIED') return 'VERIFIED'
  return 'NOT VERIFIED' as Verdict
}

const getVerdictLabel = (value: Verdict): string => {
  if (value === 'VERIFIED') return 'VERIFIED'
  return 'NOT VERIFIED'
}

const fallbackBom = (platform?: string | null): RuntimeBOMType => ({
  detectedLanguage: 'Unknown',
  detectedFramework: null,
  detectedPlatform: platform ?? null,
  agentName: null,
  toolAccessLevel: 'Unknown',
  credentialExposure: 'Not Detected',
  memoryPersistence: 'Unknown',
  auditLogging: 'Unknown',
  humanGates: 'Unknown',
  rateLimiting: 'Unknown',
  promptInjectionSurface: 'Unknown',
  delegationScope: 'Unknown',
})

const normalizeBom = (value: unknown, platform?: string | null): RuntimeBOMType | null => {
  if (!isRecord(value)) return null
  return {
    detectedLanguage: asString(value.detectedLanguage, 'Unknown'),
    detectedFramework: typeof value.detectedFramework === 'string' ? value.detectedFramework : null,
    detectedPlatform: typeof value.detectedPlatform === 'string' ? value.detectedPlatform : platform ?? null,
    agentName: typeof value.agentName === 'string' ? value.agentName : null,
    toolAccessLevel: value.toolAccessLevel === 'Restricted' || value.toolAccessLevel === 'Unrestricted' || value.toolAccessLevel === 'Unknown' ? value.toolAccessLevel : 'Unknown',
    credentialExposure: value.credentialExposure === 'Detected' || value.credentialExposure === 'Not Detected' ? value.credentialExposure : 'Not Detected',
    memoryPersistence: value.memoryPersistence === 'Bounded' || value.memoryPersistence === 'Unbounded' || value.memoryPersistence === 'Unknown' ? value.memoryPersistence : 'Unknown',
    auditLogging: value.auditLogging === 'Present' || value.auditLogging === 'Absent' || value.auditLogging === 'Unknown' ? value.auditLogging : 'Unknown',
    humanGates: value.humanGates === 'Present' || value.humanGates === 'Absent' || value.humanGates === 'Unknown' ? value.humanGates : 'Unknown',
    rateLimiting: value.rateLimiting === 'Present' || value.rateLimiting === 'Absent' || value.rateLimiting === 'Unknown' ? value.rateLimiting : 'Unknown',
    promptInjectionSurface: value.promptInjectionSurface === 'Detected' || value.promptInjectionSurface === 'Not Detected' || value.promptInjectionSurface === 'Unknown' ? value.promptInjectionSurface : 'Unknown',
    delegationScope: value.delegationScope === 'Scoped' || value.delegationScope === 'Unscoped' || value.delegationScope === 'Unknown' ? value.delegationScope : 'Unknown',
  }
}

const scoreCategories = (findings: Finding[]): CategoryScore[] => {
  const catA = findings.filter(finding => finding.category === 'A').length
  const catB = findings.filter(finding => finding.category === 'B').length
  return [
    { category: 'A', label: 'Protocol Compliance', score: Math.max(0, 50 - catA * 10), maxScore: 50, findingCount: catA },
    { category: 'B', label: 'Security Controls', score: Math.max(0, 50 - catB * 10), maxScore: 50, findingCount: catB },
  ]
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
  onUpgradePrompt,
  billingStatus = freeBillingStatus,
}: ReportViewProps) {
  const [copied, setCopied] = useState<string | null>(null)
  const [showShare, setShowShare] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const rawResult = isRecord(report?.result) ? report.result : undefined
  const rawMetadata = isRecord(rawResult?.metadata) ? rawResult.metadata : undefined
  const parsedReportInsights = parseJson(report?.reportInsights)
  const parsedResultInsights = parseJson(rawResult?.reportInsights)
  const rawInsights = isRecord(parsedReportInsights) ? parsedReportInsights : isRecord(parsedResultInsights) ? parsedResultInsights : undefined
  const normalizedReportId = asString(reportId, asString(report?.reportId, asString(report?.id, reportIdFromUrl(reportUrl) || reportIdFromUrl(report?.reportUrl))))
  const normalizedVerdict: Verdict = normalizeVerdict(verdict ?? report?.verdict ?? rawResult?.verdict)
  const normalizedRiskScore = asNumber(riskScore ?? report?.riskScore ?? rawResult?.riskScore)
  const normalizedConfidence = asNumber(report?.confidence ?? rawResult?.confidence, normalizedRiskScore > 0 ? 80 : 0)
  const normalizedRiskLevel = ((riskLevel ?? report?.riskLevel ?? rawResult?.riskLevel) === 'Low Risk' || (riskLevel ?? report?.riskLevel ?? rawResult?.riskLevel) === 'Moderate Risk' || (riskLevel ?? report?.riskLevel ?? rawResult?.riskLevel) === 'High Risk' ? (riskLevel ?? report?.riskLevel ?? rawResult?.riskLevel) : 'High Risk') as RiskLevel
  const normalizedFileName = asString(fileName ?? report?.fileName ?? rawMetadata?.fileName, 'Agent Config')
  const normalizedPlatform = (platform ?? asString(report?.platform ?? rawMetadata?.selectedPlatform, '')) || null
  const normalizedScannedAt = asString(scannedAt ?? report?.scannedAt ?? report?.createdAt ?? rawMetadata?.scannedAt, new Date().toISOString())
  const normalizedSource = source ?? asString(report?.source, 'dashboard')
  const normalizedBom = bom ?? normalizeBom(report?.bom, normalizedPlatform) ?? normalizeBom(rawResult?.bom, normalizedPlatform) ?? fallbackBom(normalizedPlatform)
  const normalizedFindings = findings ?? (Array.isArray(report?.findings) ? report.findings : Array.isArray(rawResult?.findings) ? rawResult.findings : [])
  const parsedReportThreatCategories = parseJson(report?.threatCategories)
  const parsedResultThreatCategories = parseJson(rawResult?.threatCategories)
  const rawThreatCategories = Array.isArray(parsedReportThreatCategories) ? parsedReportThreatCategories : Array.isArray(parsedResultThreatCategories) ? parsedResultThreatCategories : []
  const verdictLabel = getVerdictLabel(normalizedVerdict)
  const [shareSettings, setShareSettings] = useState({
    isPublic: report?.isPublic === true,
  })
  useEffect(() => {
    setShareSettings({ isPublic: report?.isPublic === true })
  }, [report?.isPublic])
  const safeFindings: Finding[] = normalizedFindings.map((finding, i) => {
    if (typeof finding === 'string') {
      return {
        id: String(i),
        code: `LEGACY_FINDING_${i}`,
        title: finding,
        category: 'B',
        severity: 'medium',
        whatIsWrong: '',
        whyItMatters: '',
        recommendedFix: '',
      }
    }

    return {
      id: finding.id ?? String(i),
      code: finding.code ?? `LEGACY_FINDING_${i}`,
      title: finding.title ?? '',
      category: finding.category === 'A' ? 'A' : 'B',
      severity: finding.severity === 'critical' || finding.severity === 'high' || finding.severity === 'medium' || finding.severity === 'low' ? finding.severity : 'medium',
      whatIsWrong: finding.whatIsWrong ?? '',
      whyItMatters: finding.whyItMatters ?? '',
      recommendedFix: finding.recommendedFix ?? '',
      evidence: finding.evidence ?? undefined,
      quickFix: finding.quickFix ?? undefined,
      fixCode: finding.fixCode ?? undefined,
      compliance: finding.compliance ?? undefined,
    }
  })
  const rawCategoryScores = categoryScores ?? (Array.isArray(report?.categoryScores) ? report.categoryScores as CategoryScore[] : Array.isArray(rawResult?.categoryScores) ? rawResult.categoryScores as CategoryScore[] : undefined)
  const normalizedCategoryScores = rawCategoryScores?.length ? rawCategoryScores : scoreCategories(safeFindings)
  const threatCategories: ThreatCategoryAssessment[] = rawThreatCategories.filter(isRecord).map((item, index) => ({
    id: asString(item.id, `threat-${index}`),
    label: asString(item.label, 'Threat category'),
    status: item.status === 'detected' || item.status === 'possible' || item.status === 'missing_evidence' || item.status === 'not_assessed' ? item.status : 'not_assessed',
    severity: item.severity === 'critical' || item.severity === 'high' || item.severity === 'medium' || item.severity === 'low' ? item.severity : 'medium',
    whatItMeans: asString(item.whatItMeans, 'This category describes a possible agent execution risk.'),
    evidencePattern: asString(item.evidencePattern, 'No pattern description available.'),
    whyItMatters: asString(item.whyItMatters, 'This can increase execution risk.'),
    recommendedFix: asString(item.recommendedFix, 'Review the relevant controls and re-scan with complete evidence.'),
    a2spaImpact: asString(item.a2spaImpact, 'A2SPA may reduce execution risk when authorization evidence is present.'),
  }))
  const relevantThreatCategories = threatCategories.filter(item => item.status !== 'not_assessed')
  const verified = normalizedVerdict === 'VERIFIED'
  const formattedDate = new Date(normalizedScannedAt).toLocaleString()
  const critical = safeFindings.filter(finding => finding.severity === 'critical').length
  const high = safeFindings.filter(finding => finding.severity === 'high').length
  const medium = safeFindings.filter(finding => finding.severity === 'medium').length
  const findingCount = safeFindings.length
  const topFinding = [...safeFindings].sort((a, b) => {
    const rank = { critical: 4, high: 3, medium: 2, low: 1 }
    return rank[b.severity] - rank[a.severity]
  })[0]
  const insightFixPriority = Array.isArray(rawInsights?.fixPriority) ? rawInsights.fixPriority.filter(isRecord) : []
  const fixPriority = insightFixPriority.length
    ? insightFixPriority.map(item => ({
        title: asString(item.title, 'Review finding'),
        severity: asString(item.severity, 'medium'),
        priority: asString(item.priority, 'fix_next'),
        reason: asString(item.reason, 'This improves the security report.'),
      }))
    : safeFindings.map((finding, index) => ({
        title: finding.title,
        severity: finding.severity,
        priority: index < 3 || finding.severity === 'critical' ? 'fix_first' : finding.severity === 'high' || finding.severity === 'medium' ? 'fix_next' : 'nice_to_have',
        reason: finding.category === 'A' ? 'Blocks execution-readiness and A2SPA evidence.' : 'Improves runtime security and operational safety.',
      }))
  const reportInsights = {
    executionReadinessScore: asNumber(rawInsights?.executionReadinessScore, Math.max(0, 100 - safeFindings.filter(f => f.category === 'A').length * 18 - critical * 8 - high * 4)),
    a2spaReadinessScore: asNumber(rawInsights?.a2spaReadinessScore, Math.max(0, 100 - safeFindings.filter(f => f.category === 'A').length * 20)),
    remediationProgressScore: asNumber(rawInsights?.remediationProgressScore, normalizedRiskScore),
    topBlocker: asString(rawInsights?.topBlocker, topFinding?.title ?? ''),
    nextAction: asString(rawInsights?.nextAction, topFinding ? `Fix first: ${topFinding.title}. Then re-scan to confirm the evidence changed.` : 'Re-scan after any code or configuration change.'),
    scoreExplanation: asStringArray(rawInsights?.scoreExplanation),
    improvesScore: asStringArray(rawInsights?.improvesScore),
    verificationBlockers: asStringArray(rawInsights?.verificationBlockers),
    fixPriority,
  }
  const nextAction = verified
    ? 'Share this report with stakeholders or export it as a PDF for your security records.'
    : reportInsights.nextAction
  const evidenceFindings = safeFindings.filter(finding => finding.evidence)
  const owaspTags = [...new Set(safeFindings.flatMap(finding => finding.compliance?.owasp ?? []))]
  const nistTags = [...new Set(safeFindings.flatMap(finding => finding.compliance?.nist ?? []))]
  const soc2Tags = [...new Set(safeFindings.flatMap(finding => finding.compliance?.soc2 ?? []))]
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
  const publicReportUrl = reportUrl ?? asString(report?.reportUrl, `https://aimodularity.com/agentverify/report/?id=${normalizedReportId}`)
  const canShareReport = canUseProFeature(billingStatus, 'reportSharing')
  const canViewFullRemediation = canUseProFeature(billingStatus, 'fullRemediation')
  const canViewCorrectedSnippets = canUseProFeature(billingStatus, 'correctedSnippets')
  const canViewA2spaGuidance = canUseProFeature(billingStatus, 'a2spaGuidance')
  const hasProAccess = canShareReport || canViewFullRemediation || canViewCorrectedSnippets || canViewA2spaGuidance
  const badgeReportId = typeof reportId === 'string' ? reportId : ''
  const showBadge = normalizedVerdict === 'VERIFIED' && badgeReportId.startsWith('REPORT-')
  const badgeVersion = encodeURIComponent(`${badgeReportId}-${normalizedRiskScore}-${normalizedScannedAt}`)

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const saveShareSettings = async () => {
    if (!user || !normalizedReportId) return
    if (!canShareReport) {
      onUpgradePrompt?.('Report sharing is included in Pro. Request Pro access to enable public report links.')
      return
    }
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

      try {
        await updateDoc(doc(db, 'users', user.uid, 'reports', normalizedReportId), updates)
      } catch {
        // The top-level reports document is the canonical sharing state.
      }

      onReportUpdate?.(updates)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('Failed to save share settings:', err)
    }

    setSaving(false)
  }

  return (
    <main style={{ backgroundColor: 'var(--bg)' }} className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-10">
      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="print-border mb-6 overflow-hidden rounded-3xl shadow-2xl shadow-black/10">
        <div className={`p-6 md:p-8 ${verified ? 'bg-[#10B981]/8' : 'bg-[#EF4444]/8'}`}>
          <div className="grid gap-8 lg:grid-cols-[1fr_240px] lg:items-center">
            <div>
              <Badge variant={verified ? 'verified' : 'failed'}>{verdictLabel}</Badge>
              <h1 className={`mt-5 text-3xl font-bold tracking-tight md:text-4xl ${verified ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>{verified ? 'Execution authorized' : 'Action required before deployment'}</h1>
              <p style={{ color: 'var(--text-secondary)' }} className="mt-3 max-w-2xl text-sm leading-6 md:text-base">{verified ? 'This agent satisfies the execution trust controls visible in the submitted configuration.' : 'This report found execution-trust gaps that should be fixed before this agent is connected to production tools, payments, deployments, or sensitive data.'}</p>
              <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#00C4CC]">Next action</p>
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

      <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="no-print mb-6 flex flex-col gap-4 rounded-2xl p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{hasProAccess ? 'Apply these fixes' : 'What to do next'}</p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">{hasProAccess ? 'Add A2SPA execution authorization, export PDF evidence, share the report, then run another scan.' : 'Fix the highest-severity findings first, implement A2SPA where execution controls are missing, then re-scan to verify the changes.'}</p>
        </div>
        {hasProAccess ? (
          <div className="flex flex-wrap gap-2">
            <a href={A2SPA_DOCS_URL} target="_blank" rel="noreferrer" className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-center text-sm font-semibold text-[var(--text-primary)] hover:opacity-85">Add A2SPA execution authorization</a>
            <button onClick={() => copyToClipboard(publicReportUrl, 'pro-share-link')} className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text-primary)] hover:opacity-85">Share report</button>
            {onNewScan && <button onClick={onNewScan} className="rounded-xl bg-[#00C4CC] px-4 py-2.5 text-sm font-semibold text-[#060A0F] hover:opacity-85">Run another scan</button>}
          </div>
        ) : <Link href="/pricing" className="rounded-xl bg-[#00C4CC] px-4 py-2.5 text-center text-sm font-semibold text-[#060A0F] hover:opacity-85">Upgrade to Pro</Link>}
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
                  <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-xs">{canShareReport ? shareSettings.isPublic ? 'Anyone with the link can view this report' : 'Only you can view this report' : 'Public sharing requires Pro'}</p>
                </div>
                <button disabled={!canShareReport} onClick={() => setShareSettings(s => ({ ...s, isPublic: !s.isPublic }))} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${shareSettings.isPublic ? 'bg-[#00C4CC]' : 'bg-[#1A2535]'}`}>
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${shareSettings.isPublic ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              <div className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <p style={{ color: 'var(--text-primary)' }} className="text-xs font-semibold">Sharing model</p>
                <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">This release supports owner-only private reports or public report links when sharing is available for your plan.</p>
              </div>
              <div className="mb-5 rounded-lg border border-[#E07B39]/30 bg-[#E07B39]/10 p-3">
                <p className="text-xs font-semibold text-[#E07B39]">Password-protected sharing is coming next</p>
                <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-xs">For now, use Public link or Private owner-only mode. We will not fake password protection until the Worker can verify passwords server-side before report content is delivered.</p>
              </div>
              {shareSettings.isPublic && (
                <div className="mb-5">
                  <p style={{ color: 'var(--text-primary)' }} className="mb-2 text-sm font-medium">Share link</p>
                  <div className="relative">
                    <input readOnly value={publicReportUrl} style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-muted)' }} className="w-full rounded-lg px-4 py-2.5 pr-20 font-mono text-xs outline-none" />
                    <button onClick={() => copyToClipboard(publicReportUrl, 'owner-link')} style={{ backgroundColor: copied === 'owner-link' ? '#00C4CC' : 'var(--card)', color: copied === 'owner-link' ? '#060A0F' : 'var(--text-muted)', border: '1px solid var(--border)' }} className="absolute right-2 top-1.5 rounded px-2 py-1 text-xs font-medium transition-all">
                      {copied === 'owner-link' ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}
              <button onClick={saveShareSettings} disabled={saving} className="rounded-lg bg-[#00C4CC] px-5 py-2 text-sm font-semibold text-[#060A0F] hover:bg-[#00D9E0] disabled:opacity-50">
                {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save settings'}
              </button>
            </div>
          )}
        </div>
      )}

      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="print-border mb-6 rounded-xl p-6">
        <div style={{ borderBottom: '1px solid var(--border)' }} className="mb-5 pb-3"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#00C4CC]">Section 01</p><h2 style={{ color: 'var(--text-primary)' }} className="mt-1 text-lg font-semibold">Executive Summary</h2></div>
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-xl p-5">
          <p style={{ color: 'var(--text-primary)' }} className="mb-3 text-sm font-medium">{summary.headline}</p>
          <ul className="mb-4 space-y-1.5">
            {summary.bullets.map((bullet, i) => <li key={i} style={{ color: 'var(--text-secondary)' }} className="flex items-start gap-2 text-sm"><span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${verified ? 'bg-[#00B37E]' : 'bg-[#E03E3E]'}`} />{bullet}</li>)}
          </ul>
          {!verified && <div className="rounded-lg border border-[#E03E3E]/20 bg-[#E03E3E]/5 p-3"><p className="mb-1 text-xs font-medium text-[#E03E3E]">Attack Surface</p><p style={{ color: 'var(--text-secondary)' }} className="text-xs">{summary.attackerView}</p></div>}
          <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">{summary.action}</p>
        </div>
      </section>

      <CategoryScores scores={normalizedCategoryScores} />

      {threatCategories.length > 0 && (
        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mb-6 rounded-3xl p-6 shadow-xl shadow-black/5">
          <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#00C4CC]">Threat category breakdown</p>
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
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${item.status === 'detected' ? 'bg-[#E03E3E]/10 text-[#E03E3E]' : item.status === 'missing_evidence' ? 'bg-[#E07B39]/10 text-[#E07B39]' : item.status === 'possible' ? 'bg-[#00C4CC]/10 text-[#00C4CC]' : 'bg-[var(--text-muted)]/10 text-[var(--text-muted)]'}`}>{threatStatusLabel[item.status]}</span>
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
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#00C4CC]">Score breakdown</p>
            <h2 style={{ color: 'var(--text-primary)' }} className="mt-1 text-lg font-semibold">Why this report scored {normalizedRiskScore}/100</h2>
          </div>
          {reportInsights.topBlocker && <Badge variant="muted">Top blocker: {reportInsights.topBlocker}</Badge>}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {[
            ['Execution readiness', reportInsights.executionReadinessScore, 'Can the agent prove authorized execution before action?'],
            ['A2SPA readiness', reportInsights.a2spaReadinessScore, 'Does the code show signing, verification, nonce, timestamp, and fail-closed evidence?'],
            ['Remediation progress', reportInsights.remediationProgressScore, 'How much risk remains after detected findings are considered?'],
          ].map(([label, value, detail]) => (
            <div key={label as string} style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
              <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{label}</p>
              <p className="mt-2 text-3xl font-bold text-[#00C4CC]">{value as number}<span style={{ color: 'var(--text-muted)' }} className="text-sm">/100</span></p>
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
      </section>

      {reportInsights.fixPriority.length > 0 && (
        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mb-6 rounded-3xl p-6 shadow-xl shadow-black/5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#00C4CC]">Prioritized fix plan</p>
          <h2 style={{ color: 'var(--text-primary)' }} className="mt-1 text-lg font-semibold">What to fix first</h2>
          <div className="mt-4 grid gap-3">
            {reportInsights.fixPriority.slice(0, 7).map((item, index) => (
              <div key={`${item.title}-${index}`} style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{index + 1}. {item.title}</p>
                  <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${item.priority === 'fix_first' ? 'bg-[#E03E3E]/10 text-[#E03E3E]' : item.priority === 'fix_next' ? 'bg-[#E07B39]/10 text-[#E07B39]' : 'bg-[#00C4CC]/10 text-[#00C4CC]'}`}>{item.priority === 'fix_first' ? 'Fix first' : item.priority === 'fix_next' ? 'Fix next' : 'Nice to have'}</span>
                </div>
                <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs leading-relaxed">{item.reason}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {safeFindings.some(finding => finding.category === 'A') && (
        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mb-6 rounded-3xl p-6 shadow-xl shadow-black/5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#00C4CC]">Implement A2SPA</p>
          <h2 style={{ color: 'var(--text-primary)' }} className="mt-1 text-lg font-semibold">Add authorization at the execution boundary</h2>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-3 text-sm leading-relaxed">A2SPA signs the intended execution payload before action and verifies that signed payload at the server-side execution boundary. Add signing on the trusted caller side, verify before tools or payments run, reject reused nonces and expired timestamps, and fail closed when authorization is missing or invalid.</p>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-3 text-sm leading-relaxed">Place your private key in your deployment environment or secret manager, then reference it here with environment variables such as <code>process.env.A2SPA_PRIVATE_KEY</code> and <code>process.env.A2SPA_PUBLIC_KEY</code>.</p>
          <p className="mt-3 text-xs font-semibold text-[#E07B39]">Never paste a production private key into Agent Verify, source code, or a public repository. Store it in an environment variable or a secret manager.</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <a href={A2SPA_DOCS_URL} target="_blank" rel="noreferrer" className="rounded-xl bg-[#00C4CC] px-4 py-2.5 text-center text-sm font-semibold text-[#060A0F]">Read A2SPA docs</a>
            <button onClick={() => copyToClipboard('const signingKey = process.env.A2SPA_PRIVATE_KEY\nconst verifyKey = process.env.A2SPA_PUBLIC_KEY', 'a2spa-env')} style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }} className="rounded-xl px-4 py-2.5 text-sm font-semibold">{copied === 'a2spa-env' ? 'Copied' : 'Copy env placeholders'}</button>
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
                <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-bold ${finding.severity === 'critical' ? 'bg-[#E03E3E]/10 text-[#E03E3E]' : finding.severity === 'high' ? 'bg-[#E07B39]/10 text-[#E07B39]' : 'bg-[var(--text-muted)]/20 text-[var(--text-muted)]'}`}>
                  {finding.severity}
                </span>
                <div className="min-w-0 flex-1">
                  <p style={{ color: 'var(--text-secondary)' }} className="mb-1 text-xs font-medium">{finding.title}</p>
                  <code className="break-all font-mono text-xs text-[#E07B39]">{finding.evidence}</code>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <section className="mb-6">
        <div style={{ borderBottom: '1px solid var(--border)' }} className="mb-4 pb-3"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#00C4CC]">Section 02</p><h2 style={{ color: 'var(--text-primary)' }} className="mt-1 font-semibold">Findings ({safeFindings.length})</h2></div>
        {safeFindings.length > 0 && !hasProAccess && (
          <div className="mb-4 rounded-xl border border-[#00C4CC]/30 bg-[#00C4CC]/10 p-4">
            <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Need corrected code and implementation guidance?</p>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-xs">Pro includes full remediation, corrected code, A2SPA guidance, PDF export, and shareable reports.</p>
            <Link href="/pricing" className="mt-3 inline-flex rounded-lg bg-[#00C4CC] px-3 py-2 text-xs font-semibold text-[#060A0F]">View Pro</Link>
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
                  {owaspTags.map(tag => <span key={tag} className="rounded border border-[#E07B39]/20 bg-[#E07B39]/5 px-2.5 py-1 text-xs text-[#E07B39]">{tag}</span>)}
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
              return <div key={finding.id ?? i} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-xl p-5"><p style={{ color: 'var(--text-primary)' }} className="mb-3 text-sm font-semibold">{finding.title}</p>{finding.quickFix && <div className="mb-3"><p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[#00B37E]">Quick Fix</p><pre className="overflow-x-auto rounded-lg border border-[#00B37E]/20 bg-[#00B37E]/5 px-4 py-3 font-mono text-xs leading-relaxed text-[#00B37E]">{finding.quickFix}</pre></div>}{finding.recommendedFix && <div><p style={{ color: 'var(--text-muted)' }} className="mb-1.5 text-xs font-semibold uppercase tracking-wider">Full Guidance</p><p style={{ color: 'var(--text-secondary)' }} className="whitespace-pre-line text-sm leading-relaxed">{finding.recommendedFix}</p></div>}</div>
            })}
          </div>
        </section>
      )}

      <RuntimeBOM bom={normalizedBom} />

      {(onNewScan || reportUrl) && <div className="mt-8 flex flex-col gap-3 sm:flex-row">{onNewScan && <button onClick={onNewScan} className="rounded-lg bg-[#06B6D4] px-5 py-2.5 text-sm font-semibold text-[#080B14] transition-colors hover:bg-[#22D3EE]">Run New Scan</button>}{reportUrl && <button onClick={() => copyToClipboard(publicReportUrl, 'report-link')} style={{ backgroundColor: copied === 'report-link' ? '#00C4CC' : 'var(--card)', color: copied === 'report-link' ? '#060A0F' : 'var(--text-muted)', border: '1px solid var(--border)' }} className="rounded-lg px-5 py-2.5 text-sm font-semibold transition-all hover:opacity-70">{copied === 'report-link' ? '✓ Copied' : 'Copy Report Link'}</button>}</div>}

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
            value={publicReportUrl ?? ''}
            style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
            className="w-full rounded-lg px-4 py-2.5 pr-20 font-mono text-xs outline-none"
          />
          <button onClick={() => copyToClipboard(publicReportUrl, 'link')} style={{ backgroundColor: copied === 'link' ? '#00C4CC' : 'var(--card)', color: copied === 'link' ? '#060A0F' : 'var(--text-muted)', border: '1px solid var(--border)' }} className="absolute right-2 top-1.5 rounded px-2 py-1 text-xs font-medium transition-all">
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
                  style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: '#00C4CC' }}
                  className="overflow-x-auto rounded-lg px-4 py-3 pr-16 font-mono text-xs"
                >
                  {`[![Agent Verify](https://agentverify-api.agentverify.workers.dev/v1/badge/${badgeReportId})](https://aimodularity.com/agentverify/report/?id=${badgeReportId})`}
                </pre>
                <button
                  onClick={() => {
                    const badge = `[![Agent Verify](https://agentverify-api.agentverify.workers.dev/v1/badge/${badgeReportId})](https://aimodularity.com/agentverify/report/?id=${badgeReportId})`
                    navigator.clipboard.writeText(badge)
                  }}
                  style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                  className="absolute right-2 top-2 rounded px-2 py-1 text-xs transition-opacity hover:opacity-70"
                >
                  Copy
                </button>
              </div>
              <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs">
                Paste this into your README.md to display a live trust badge.
              </p>
            </div>
          </div>
        )}
      </div>

      <footer style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }} className="print-border mt-10 flex flex-col items-center justify-between gap-3 pt-6 text-center text-xs md:flex-row md:gap-6 md:text-left">
        <span>Generated by Agent Verify - Execution Trust Analysis Platform</span>
        <span>Powered by A2SPA / AI Blockchain Ventures LLC / aiblockchainventures.com</span>
      </footer>
    </main>
  )
}
