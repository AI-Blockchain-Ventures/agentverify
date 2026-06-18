'use client'

import { useState } from 'react'
import type { User } from 'firebase/auth'
import { doc, updateDoc } from 'firebase/firestore'
import type { CategoryScore, Finding, RuntimeBOM as RuntimeBOMType, RiskLevel, Verdict } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { CategoryScores } from '@/components/scanner/CategoryScores'
import { FindingCard } from '@/components/scanner/FindingCard'
import { RuntimeBOM } from '@/components/scanner/RuntimeBOM'
import { db } from '@/lib/firebase'
import { generateSummary } from '@/lib/generateSummary'

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
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const reportIdFromUrl = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  try {
    return new URL(value).searchParams.get('id') ?? ''
  } catch {
    return ''
  }
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
}: ReportViewProps) {
  const [copied, setCopied] = useState<string | null>(null)
  const [showShare, setShowShare] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const rawResult = isRecord(report?.result) ? report.result : undefined
  const rawMetadata = isRecord(rawResult?.metadata) ? rawResult.metadata : undefined
  const normalizedReportId = asString(reportId, asString(report?.reportId, asString(report?.id, reportIdFromUrl(reportUrl) || reportIdFromUrl(report?.reportUrl))))
  const normalizedVerdict: Verdict = (verdict ?? report?.verdict ?? rawResult?.verdict) === 'VERIFIED' ? 'VERIFIED' : 'NOT VERIFIED'
  const normalizedRiskScore = asNumber(riskScore ?? report?.riskScore ?? rawResult?.riskScore)
  const normalizedRiskLevel = ((riskLevel ?? report?.riskLevel ?? rawResult?.riskLevel) === 'Low Risk' || (riskLevel ?? report?.riskLevel ?? rawResult?.riskLevel) === 'Moderate Risk' || (riskLevel ?? report?.riskLevel ?? rawResult?.riskLevel) === 'High Risk' ? (riskLevel ?? report?.riskLevel ?? rawResult?.riskLevel) : 'High Risk') as RiskLevel
  const normalizedFileName = asString(fileName ?? report?.fileName ?? rawMetadata?.fileName, 'Agent Config')
  const normalizedPlatform = (platform ?? asString(report?.platform ?? rawMetadata?.selectedPlatform, '')) || null
  const normalizedScannedAt = asString(scannedAt ?? report?.scannedAt ?? report?.createdAt ?? rawMetadata?.scannedAt, new Date().toISOString())
  const normalizedSource = source ?? asString(report?.source, 'dashboard')
  const normalizedBom = bom ?? normalizeBom(report?.bom, normalizedPlatform) ?? normalizeBom(rawResult?.bom, normalizedPlatform) ?? fallbackBom(normalizedPlatform)
  const normalizedFindings = findings ?? (Array.isArray(report?.findings) ? report.findings : Array.isArray(rawResult?.findings) ? rawResult.findings : [])
  const [shareSettings, setShareSettings] = useState({
    isPublic: report?.isPublic === true,
    password: typeof report?.password === 'string' ? report.password : '',
  })
  const safeFindings: Finding[] = normalizedFindings.map((finding, i) => {
    if (typeof finding === 'string') {
      return {
        id: String(i),
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
  const verified = normalizedVerdict === 'VERIFIED'
  const formattedDate = new Date(normalizedScannedAt).toLocaleString()
  const critical = safeFindings.filter(finding => finding.severity === 'critical').length
  const high = safeFindings.filter(finding => finding.severity === 'high').length
  const medium = safeFindings.filter(finding => finding.severity === 'medium').length
  const evidenceFindings = safeFindings.filter(finding => finding.evidence)
  const owaspTags = [...new Set(safeFindings.flatMap(finding => finding.compliance?.owasp ?? []))]
  const nistTags = [...new Set(safeFindings.flatMap(finding => finding.compliance?.nist ?? []))]
  const soc2Tags = [...new Set(safeFindings.flatMap(finding => finding.compliance?.soc2 ?? []))]
  const summary = generateSummary({
    reportId: normalizedReportId,
    verdict: normalizedVerdict,
    riskScore: normalizedRiskScore,
    riskLevel: normalizedRiskLevel,
    confidence: 0,
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
  })
  const publicReportUrl = reportUrl ?? asString(report?.reportUrl, `https://aimodularity.com/agentverify/report/?id=${normalizedReportId}`)
  const badgeReportId = asString(reportId, normalizedReportId)
  const badgeVerdict = verdict ?? normalizedVerdict

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const saveShareSettings = async () => {
    if (!user || !normalizedReportId) return
    setSaving(true)
    try {
      const updates = {
        isPublic: shareSettings.isPublic,
        isPrivate: !shareSettings.isPublic,
        password: shareSettings.password.trim() || null,
      }
      await updateDoc(doc(db, 'users', user.uid, 'reports', normalizedReportId), updates)
      await updateDoc(doc(db, 'reports', normalizedReportId), updates)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('Failed to save:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main style={{ backgroundColor: 'var(--bg)' }} className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-10">
      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="print-border mb-6 overflow-hidden rounded-2xl">
        <div style={{ borderBottom: '1px solid var(--border)' }} className="grid text-xs md:grid-cols-2">
           <div style={{ borderBottom: '1px solid var(--border)' }} className="p-4 md:border-r"><span style={{ color: 'var(--text-muted)' }} className="block uppercase tracking-wider">Report ID</span><span style={{ color: 'var(--text-secondary)' }} className="mt-1 block font-mono">{normalizedReportId}</span></div>
          <div style={{ borderBottom: '1px solid var(--border)' }} className="p-4"><span style={{ color: 'var(--text-muted)' }} className="block uppercase tracking-wider">Scanned</span><span style={{ color: 'var(--text-secondary)' }} className="mt-1 block">{formattedDate}</span></div>
          <div style={{ borderBottom: '1px solid var(--border)' }} className="p-4 md:border-b-0 md:border-r"><span style={{ color: 'var(--text-muted)' }} className="block uppercase tracking-wider">Asset</span><span style={{ color: 'var(--text-secondary)' }} className="mt-1 block">{normalizedFileName}</span></div>
          <div className="p-4"><span style={{ color: 'var(--text-muted)' }} className="block uppercase tracking-wider">Source</span><span style={{ color: 'var(--text-secondary)' }} className="mt-1 block">{normalizedSource === 'cli' ? 'CLI Scanner' : normalizedSource === 'public' ? 'Public Report' : 'Dashboard'}{normalizedPlatform ? ` / ${normalizedPlatform}` : ''}</span></div>
        </div>
        <div className={`p-6 ${verified ? 'bg-[#10B981]/8' : 'bg-[#EF4444]/8'}`}>
          <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <Badge variant={verified ? 'verified' : 'failed'}>{normalizedVerdict}</Badge>
              <div className={`mt-4 text-2xl font-bold md:text-3xl ${verified ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>{verified ? 'Execution Authorized' : 'Execution Not Authorized'}</div>
              <p style={{ color: 'var(--text-secondary)' }} className="mt-2 text-sm leading-relaxed">{verified ? 'This agent satisfies the required execution trust controls for the evaluated configuration.' : 'This agent failed execution trust authorization and should not be deployed until the listed issues are remediated.'}</p>
              <div className="mt-4 flex flex-wrap gap-2"><Badge variant="muted">{normalizedRiskLevel}</Badge></div>
            </div>
            <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-2xl p-5 text-center">
              <div style={{ color: 'var(--text-muted)' }} className="text-xs font-medium uppercase tracking-widest">Risk Score</div>
              <div style={{ color: 'var(--text-primary)' }} className="mt-1 text-5xl font-bold">{normalizedRiskScore}<span style={{ color: 'var(--text-muted)' }} className="text-xl">/100</span></div>
              <div style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs">{critical} critical / {high} high / {medium} medium</div>
            </div>
          </div>
        </div>
      </section>

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
                <button onClick={() => setShareSettings(s => ({ ...s, isPublic: !s.isPublic }))} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${shareSettings.isPublic ? 'bg-[#00C4CC]' : 'bg-[#1A2535]'}`}>
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${shareSettings.isPublic ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              <div className="mb-5">
                <p style={{ color: 'var(--text-primary)' }} className="mb-1 text-sm font-medium">Password protection</p>
                <p style={{ color: 'var(--text-muted)' }} className="mb-2 text-xs">Optionally require a password to view this report</p>
                <input type="text" value={shareSettings.password} onChange={e => setShareSettings(s => ({ ...s, password: e.target.value }))} placeholder="Leave empty for no password" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }} className="w-full rounded-lg px-4 py-2.5 text-sm outline-none placeholder:opacity-50" />
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
        {safeFindings.length === 0 ? <div className="rounded-xl border border-[#10B981]/20 bg-[#10B981]/5 p-8 text-center"><div style={{ color: 'var(--text-primary)' }} className="font-semibold">No issues detected</div><div style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">This agent passed all security checks</div></div> : <div className="space-y-2">{safeFindings.map(finding => <FindingCard key={finding.id} finding={finding} />)}</div>}
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
        {badgeVerdict === 'VERIFIED' && badgeReportId && (
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
              <img
                src={`https://agentverify-api.agentverify.workers.dev/v1/badge/${badgeReportId}`}
                alt="Agent Verify badge"
                className="h-5"
                key={badgeReportId}
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
