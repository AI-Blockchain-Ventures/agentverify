'use client'

import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import type { Category, CategoryScore, Finding, RiskLevel, RuntimeBOM as RuntimeBOMType, ScanResult, Severity, SourceType, StoredReport, Verdict } from '@/types'
import { useAuth } from '@/components/auth/AuthProvider'
import { db } from '@/lib/firebase'
import { Badge } from '@/components/ui/Badge'
import { CategoryScores } from '@/components/scanner/CategoryScores'
import { RuntimeBOM } from '@/components/scanner/RuntimeBOM'
import { FindingCard } from '@/components/scanner/FindingCard'
import { assetUrl } from '@/lib/assets'

type RawRecord = Record<string, unknown>

const isRecord = (value: unknown): value is RawRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const unwrapMap = (value: unknown): unknown => {
  if (!isRecord(value)) return value
  const fields = isRecord(value.fields) ? value.fields : value
  return Object.fromEntries(Object.entries(fields).map(([key, val]) => [key, unwrapFirestoreValue(val)]))
}

const unwrapFirestoreValue = (value: unknown): unknown => {
  if (!isRecord(value)) return value
  if ('toDate' in value && typeof value.toDate === 'function') return value
  if ('stringValue' in value) return value.stringValue ?? ''
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('booleanValue' in value) return Boolean(value.booleanValue)
  if ('timestampValue' in value) return value.timestampValue
  if ('nullValue' in value) return null
  if ('arrayValue' in value) {
    const arrayValue = isRecord(value.arrayValue) ? value.arrayValue : {}
    return Array.isArray(arrayValue.values) ? arrayValue.values.map(unwrapFirestoreValue) : []
  }
  if ('mapValue' in value) return unwrapMap(value.mapValue)
  return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, unwrapFirestoreValue(val)]))
}

const asString = (value: unknown, fallback = ''): string => {
  const unwrapped = unwrapFirestoreValue(value)
  return typeof unwrapped === 'string' && unwrapped.length > 0 ? unwrapped : fallback
}

const asNumber = (value: unknown, fallback = 0): number => {
  const unwrapped = unwrapFirestoreValue(value)
  return typeof unwrapped === 'number' && Number.isFinite(unwrapped) ? unwrapped : fallback
}

const asArray = (value: unknown): unknown[] => {
  const unwrapped = unwrapFirestoreValue(value)
  return Array.isArray(unwrapped) ? unwrapped : []
}

const asDateString = (value: unknown): string => {
  const unwrapped = unwrapFirestoreValue(value)
  if (typeof unwrapped === 'string' && unwrapped.length > 0) return unwrapped
  if (isRecord(unwrapped)) {
    if ('toDate' in unwrapped && typeof unwrapped.toDate === 'function') {
      return (unwrapped.toDate as () => Date)().toISOString()
    }
    if (typeof unwrapped.seconds === 'number') {
      return new Date(unwrapped.seconds * 1000).toISOString()
    }
  }
  return new Date().toISOString()
}

const asVerdict = (value: unknown): Verdict =>
  asString(value) === 'VERIFIED' ? 'VERIFIED' : 'NOT VERIFIED'

const asRiskLevel = (value: unknown): RiskLevel => {
  const riskLevel = asString(value)
  return riskLevel === 'Low Risk' || riskLevel === 'Moderate Risk' || riskLevel === 'High Risk'
    ? riskLevel
    : 'High Risk'
}

const asCategory = (value: unknown): Category => asString(value) === 'A' ? 'A' : 'B'

const asSeverity = (value: unknown): Severity => {
  const severity = asString(value)
  return severity === 'critical' || severity === 'high' || severity === 'medium' || severity === 'low'
    ? severity
    : 'medium'
}

const asSource = (value: unknown): SourceType => {
  const source = asString(value)
  return source === 'cli' || source === 'public' || source === 'dashboard' ? source : 'dashboard'
}

const stringOrNull = (value: unknown): string | null => {
  const unwrapped = unwrapFirestoreValue(value)
  return typeof unwrapped === 'string' && unwrapped.length > 0 ? unwrapped : null
}

const fallbackBom = (report: StoredReport): RuntimeBOMType => ({
  detectedLanguage: 'Unknown',
  detectedFramework: null,
  detectedPlatform: report.platform ?? null,
  agentName: report.agentName ?? null,
  toolAccessLevel: 'Unknown',
  credentialExposure: 'Not Detected',
  memoryPersistence: 'Unknown',
  auditLogging: 'Unknown',
  humanGates: 'Unknown',
  rateLimiting: 'Unknown',
  promptInjectionSurface: 'Unknown',
  delegationScope: 'Unknown',
})

const asFinding = (finding: unknown, index: number): Finding => {
  const unwrapped = unwrapFirestoreValue(finding)
  if (typeof unwrapped === 'string') {
    return {
      id: `finding-${index}`,
      title: unwrapped,
      category: 'B',
      severity: 'medium',
      whatIsWrong: unwrapped,
      whyItMatters: 'This issue may affect the agent execution trust posture.',
      recommendedFix: 'Review and remediate this finding before production deployment.',
    }
  }

  const record = isRecord(unwrapped) ? unwrapped : {}
  const title = asString(record.title, `Finding ${index + 1}`)
  return {
    id: asString(record.id, `finding-${index}`),
    title,
    category: asCategory(record.category),
    severity: asSeverity(record.severity),
    whatIsWrong: asString(record.whatIsWrong, title),
    whyItMatters: asString(record.whyItMatters, 'This issue may affect the agent execution trust posture.'),
    evidence: stringOrNull(record.evidence) ?? undefined,
    recommendedFix: asString(record.recommendedFix, 'Review and remediate this finding before production deployment.'),
    a2spaFix: stringOrNull(record.a2spaFix) ?? undefined,
    fixCode: stringOrNull(record.fixCode) ?? undefined,
  }
}

const parseFindings = (raw: unknown[]): Finding[] => raw.map(asFinding)

const scoreCategories = (findings: Finding[]): CategoryScore[] => {
  const catA = findings.filter(finding => finding.category === 'A').length
  const catB = findings.filter(finding => finding.category === 'B').length
  return [
    { category: 'A', label: 'A2SPA Protocol Compliance', score: Math.max(0, 50 - catA * 10), maxScore: 50, findingCount: catA },
    { category: 'B', label: 'General Agent Security', score: Math.max(0, 50 - catB * 10), maxScore: 50, findingCount: catB },
  ]
}

const parseCategoryScores = (raw: unknown, findings: Finding[]): CategoryScore[] => {
  const scores = asArray(raw).map(score => {
    const record = isRecord(unwrapFirestoreValue(score)) ? unwrapFirestoreValue(score) as RawRecord : {}
    const category = asCategory(record.category)
    return {
      category,
      label: asString(record.label, category === 'A' ? 'A2SPA Protocol Compliance' : 'General Agent Security'),
      score: asNumber(record.score),
      maxScore: asNumber(record.maxScore, 50),
      findingCount: asNumber(record.findingCount),
    }
  })
  return scores.length > 0 ? scores : scoreCategories(findings)
}

const parseBom = (raw: unknown, report: StoredReport): RuntimeBOMType => {
  const record = unwrapFirestoreValue(raw)
  if (!isRecord(record)) return fallbackBom(report)

  return {
    detectedLanguage: asString(record.detectedLanguage, 'Unknown'),
    detectedFramework: stringOrNull(record.detectedFramework),
    detectedPlatform: stringOrNull(record.detectedPlatform) ?? report.platform ?? null,
    agentName: stringOrNull(record.agentName) ?? report.agentName ?? null,
    toolAccessLevel: (asString(record.toolAccessLevel, 'Unknown') as RuntimeBOMType['toolAccessLevel']),
    credentialExposure: (asString(record.credentialExposure, 'Not Detected') as RuntimeBOMType['credentialExposure']),
    memoryPersistence: (asString(record.memoryPersistence, 'Unknown') as RuntimeBOMType['memoryPersistence']),
    auditLogging: (asString(record.auditLogging, 'Unknown') as RuntimeBOMType['auditLogging']),
    humanGates: (asString(record.humanGates, 'Unknown') as RuntimeBOMType['humanGates']),
    rateLimiting: (asString(record.rateLimiting, 'Unknown') as RuntimeBOMType['rateLimiting']),
    promptInjectionSurface: (asString(record.promptInjectionSurface, 'Unknown') as RuntimeBOMType['promptInjectionSurface']),
    delegationScope: (asString(record.delegationScope, 'Unknown') as RuntimeBOMType['delegationScope']),
  }
}

const hydrateReport = (data: RawRecord, id: string): StoredReport => {
  const raw = unwrapFirestoreValue(data) as RawRecord
  const result = isRecord(raw.result) ? raw.result : undefined
  const metadata = isRecord(result?.metadata) ? result.metadata : undefined
  const findings = asArray(raw.findings).length > 0 ? asArray(raw.findings) : asArray(result?.findings)

  return {
    ...raw,
    reportId: asString(raw.reportId, asString(result?.reportId, id)),
    verdict: asVerdict(raw.verdict ?? result?.verdict),
    riskScore: asNumber(raw.riskScore ?? result?.riskScore),
    riskLevel: asRiskLevel(raw.riskLevel ?? result?.riskLevel),
    fileName: asString(raw.fileName ?? metadata?.fileName, 'Agent Config'),
    scannedAt: asDateString(raw.scannedAt ?? raw.createdAt ?? metadata?.scannedAt),
    source: asSource(raw.source),
    findings: findings as StoredReport['findings'],
    platform: stringOrNull(raw.platform ?? metadata?.selectedPlatform),
    agentName: stringOrNull(raw.agentName ?? metadata?.agentName),
    uid: stringOrNull(raw.uid ?? raw.userId) ?? undefined,
    createdAt: asDateString(raw.createdAt ?? metadata?.scannedAt),
    result: result as ScanResult | undefined,
  }
}

export function ReportClient({ reportId: providedReportId }: { reportId?: string | null }) {
  const params = useParams<{ reportId: string }>()
  const reportId = providedReportId ?? params.reportId
  const { user, loading: authLoading } = useAuth()
  const [report, setReport] = useState<StoredReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [linkCopied, setLinkCopied] = useState(false)

  useEffect(() => {
    if (authLoading) return
    if (!reportId) {
      setReport(null)
      setLoading(false)
      return
    }

    const load = async () => {
      const id = reportId
      const cli = await getDoc(doc(db, 'cliReports', id))
      if (cli.exists()) {
        setReport(hydrateReport(cli.data(), cli.id))
        setLoading(false)
        return
      }

      if (user) {
        const own = await getDoc(doc(db, 'users', user.uid, 'reports', id))
        if (own.exists()) {
          setReport(hydrateReport(own.data(), own.id))
          setLoading(false)
          return
        }
      }

      const pub = await getDoc(doc(db, 'publicReports', id))
      setReport(pub.exists() ? hydrateReport(pub.data(), pub.id) : null)
      setLoading(false)
    }

    void load()
  }, [reportId, user, authLoading])

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  if (loading) return <div className="min-h-screen px-6 py-24 text-center text-[#4B6080]">Loading report...</div>
  if (!report) return <div className="min-h-screen px-6 py-24 text-center"><h1 className="text-3xl font-bold text-white">Report not found</h1></div>

  const rawFindings = asArray(report.findings).length > 0 ? asArray(report.findings) : asArray(report.result?.findings)
  const findings = parseFindings(rawFindings)
  const verdict = asVerdict(report.verdict ?? report.result?.verdict)
  const verified = verdict === 'VERIFIED'
  const riskScore = asNumber(report.riskScore ?? report.result?.riskScore)
  const riskLevel = asRiskLevel(report.riskLevel ?? report.result?.riskLevel)
  const confidence = typeof report.result?.confidence === 'number' ? report.result.confidence : undefined
  const fileName = asString(report.fileName ?? report.result?.metadata.fileName, 'Agent Config')
  const platform = stringOrNull(report.platform ?? report.result?.metadata.selectedPlatform)
  const scannedAt = asDateString(report.scannedAt ?? report.result?.metadata.scannedAt)
  const formattedDate = new Date(scannedAt).toLocaleString()
  const source = report.source ?? 'dashboard'
  const categoryScores = parseCategoryScores(report.categoryScores ?? report.result?.categoryScores, findings)
  const bom = parseBom(report.bom ?? report.result?.bom, report)
  const criticalFindings = findings.filter(finding => finding.severity === 'critical')
  const critical = criticalFindings.length
  const high = findings.filter(finding => finding.severity === 'high').length
  const medium = findings.filter(finding => finding.severity === 'medium').length

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="no-print mb-8 flex items-center justify-between">
        <button onClick={() => window.history.back()} className="no-print flex items-center gap-2 text-sm text-[#4B6080] transition-colors hover:text-white">Back</button>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="no-print flex items-center gap-2 rounded-lg border border-[#1E2D40] px-4 py-2 text-sm text-[#94A3B8] transition-colors hover:border-[#243244] hover:text-white">Export PDF</button>
          <button onClick={copyLink} className="no-print flex items-center gap-2 rounded-lg border border-[#1E2D40] px-4 py-2 text-sm text-[#94A3B8] transition-colors hover:border-[#243244] hover:text-white">{linkCopied ? 'Copied!' : 'Copy Link'}</button>
        </div>
      </div>

      <div className="mb-8">
        <div className="mb-2 flex items-center gap-3">
          <img src={assetUrl('/logo.png')} className="h-14" alt="" />
          <span className="text-xs text-[#4B6080]">Execution Trust Report</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-[#4B6080]">
          <span>Report ID: {report.reportId}</span>
          <span>Scanned: {formattedDate}</span>
          <span>Source: {source === 'cli' ? 'CLI Scanner' : source === 'public' ? 'Public Report' : 'Dashboard'}</span>
          {platform && <span>Platform: {platform}</span>}
        </div>
      </div>

      <section className={`print-border mb-6 overflow-hidden rounded-2xl border text-center ${verified ? 'border-[#10B981]/20 bg-[#10B981]/8' : 'border-[#EF4444]/20 bg-[#EF4444]/8'}`}>
        <div className={`h-1 rounded-t-2xl ${verified ? 'bg-[#10B981]' : 'bg-[#EF4444]'}`} />
        <div className="p-8">
          <div className={`text-3xl font-bold ${verified ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>{verified ? 'Execution Authorized' : 'Execution Not Authorized'}</div>
          <div className="mt-6 text-xs font-medium uppercase tracking-widest text-[#4B6080]">Risk Score</div>
          <div className="text-7xl font-bold text-white">{riskScore}<span className="text-2xl text-[#4B6080]">/100</span></div>
          <div className="mt-2 text-xs text-[#4B6080]">{critical} critical / {high} high / {medium} medium</div>
          <div className="mt-4 flex flex-wrap justify-center gap-2"><Badge variant={verified ? 'verified' : 'failed'}>{verdict}</Badge><Badge variant="muted">{riskLevel}</Badge>{typeof confidence === 'number' && <Badge variant="cli">{confidence}% confidence</Badge>}</div>
          <div className="mt-3 flex flex-wrap justify-center gap-4 text-xs text-[#4B6080]"><span>{fileName}</span>{platform && <span>{platform}</span>}<span>{formattedDate}</span></div>
        </div>
      </section>

      <section className="print-border mb-6 rounded-xl border border-[#1E2D40] bg-[#0F1623] p-6">
        <h2 className="mb-5 text-lg font-semibold text-white">Executive Summary</h2>
        <div className="grid gap-6 md:grid-cols-3">
          <div><h3 className="mb-2 text-sm font-semibold text-white">Risk Assessment</h3><p className="text-sm leading-relaxed text-[#94A3B8]">This agent {verified ? 'passed' : 'failed'} execution trust analysis with a score of {riskScore}/100. {findings.length === 0 ? 'No security issues were detected.' : `${findings.length} issue${findings.length === 1 ? '' : 's'} were identified requiring attention before production deployment.`}</p></div>
          <div><h3 className="mb-2 text-sm font-semibold text-white">Critical Issues</h3>{criticalFindings.length ? <div className="space-y-2">{criticalFindings.map(finding => <div key={finding.id} className="flex gap-2 text-sm text-[#94A3B8]"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#EF4444]" />{finding.title}</div>)}</div> : <p className="text-sm text-[#10B981]">No critical issues detected</p>}</div>
          <div><h3 className="mb-2 text-sm font-semibold text-white">Recommended Action</h3><p className="text-sm leading-relaxed text-[#94A3B8]">{verified ? 'This agent meets execution trust requirements. Continue monitoring with regular re-scans.' : 'Address critical findings before deployment. Contact AI Blockchain Ventures for A2SPA integration support.'} <a className="text-[#06B6D4]" href="https://aiblockchainventures.com">aiblockchainventures.com</a></p></div>
        </div>
      </section>

      <CategoryScores scores={categoryScores} />

      <section className="mb-6">
        <h2 className="mb-4 font-semibold text-white">Findings ({findings.length})</h2>
        {findings.length === 0 ? <div className="rounded-xl border border-[#10B981]/20 bg-[#10B981]/5 p-8 text-center"><div className="mb-3 text-3xl text-[#10B981]">No issues</div><div className="font-semibold text-white">No issues detected</div><div className="mt-1 text-sm text-[#4B6080]">This agent passed all security checks</div></div> : <div className="space-y-2">{findings.map(finding => <FindingCard key={finding.id} finding={finding} />)}</div>}
      </section>

      <RuntimeBOM bom={bom} />

      <footer className="print-border mt-10 flex items-center justify-between gap-6 border-t border-[#1E2D40] pt-6 text-xs text-[#4B6080]">
        <span>Generated by Agent Verify - Execution Trust Analysis Platform</span>
        <span>Powered by A2SPA / AI Blockchain Ventures LLC / aiblockchainventures.com</span>
      </footer>
    </main>
  )
}
