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
import { generateSummary } from '@/lib/generateSummary'

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

  const emailReport = () => {
    if (!report) return
    const subject = `Agent Verify Report — ${report.fileName} — ${report.verdict}`
    const body = `Agent Verify Execution Trust Report\n\nFile: ${report.fileName}\nVerdict: ${report.verdict}\nScore: ${report.riskScore}/100\nRisk Level: ${report.riskLevel}\n\nView full report: ${window.location.href}\n\nPowered by Agent Verify — aimodularity.com/agentverify`
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  const downloadPDF = async () => {
    if (!report) return
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const margin = 20
    const contentWidth = pageWidth - margin * 2
    let y = 20

    const addText = (text: string, size: number, color: [number, number, number], bold = false) => {
      doc.setFontSize(size)
      doc.setTextColor(...color)
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      const lines = doc.splitTextToSize(text, contentWidth)
      doc.text(lines, margin, y)
      y += (lines.length * size * 0.4) + 3
      if (y > 270) {
        doc.addPage()
        doc.setFillColor(6, 10, 15)
        doc.rect(0, 0, pageWidth, 297, 'F')
        y = 20
      }
    }

    const addDivider = () => {
      doc.setDrawColor(26, 37, 53)
      doc.line(margin, y, pageWidth - margin, y)
      y += 6
    }

    doc.setFillColor(6, 10, 15)
    doc.rect(0, 0, pageWidth, 297, 'F')

    addText('AGENT VERIFY', 8, [0, 196, 204], true)
    addText('Execution Trust Report', 20, [232, 237, 242], true)
    y += 4
    addText(`Report ID: ${report.reportId}`, 9, [61, 81, 102])
    addText(`Scanned: ${new Date(scannedAt).toLocaleString()}`, 9, [61, 81, 102])
    addText(`Source: ${source === 'cli' ? 'CLI Scanner' : 'Dashboard'}`, 9, [61, 81, 102])
    y += 6
    addDivider()

    addText(verified ? '✓ EXECUTION AUTHORIZED' : '✗ EXECUTION NOT AUTHORIZED', 16, verified ? [0, 179, 126] : [224, 62, 62], true)
    addText(`Risk Score: ${riskScore}/100`, 14, [232, 237, 242], true)
    addText(`Risk Level: ${riskLevel}`, 10, [136, 150, 168])
    addText(`File: ${fileName}`, 10, [136, 150, 168])
    y += 4
    addDivider()

    if (summary) {
      addText('EXECUTIVE SUMMARY', 9, [61, 81, 102], true)
      y += 2
      addText(summary.headline, 11, [232, 237, 242])
      y += 2
      summary.bullets.forEach(b => addText(`• ${b}`, 10, [136, 150, 168]))
      if (summary.attackerView) {
        y += 2
        addText('Attack Surface:', 9, [224, 62, 62], true)
        addText(summary.attackerView, 10, [136, 150, 168])
      }
      y += 4
      addDivider()
    }

    if (findings.length > 0) {
      addText('FINDINGS', 9, [61, 81, 102], true)
      y += 2
      findings.forEach((f, i) => {
        addText(`${i + 1}. ${f.title}`, 11, [232, 237, 242], true)
        addText(`Severity: ${f.severity.toUpperCase()}`, 9, [136, 150, 168])
        if (f.recommendedFix) addText(`Fix: ${f.recommendedFix}`, 9, [136, 150, 168])
        y += 2
      })
      addDivider()
    }

    addText('Generated by Agent Verify — Execution Trust Analysis Platform', 8, [61, 81, 102])
    addText('Powered by A2SPA · AI Blockchain Ventures LLC · aiblockchainventures.com', 8, [61, 81, 102])
    doc.save(`agent-verify-report-${report.reportId}.pdf`)
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
  const summary = generateSummary({
    reportId: report.reportId,
    verdict,
    riskScore,
    riskLevel,
    confidence: typeof confidence === 'number' ? confidence : 0,
    optimizationScore: typeof report.result?.optimizationScore === 'number' ? report.result.optimizationScore : 0,
    findings,
    categoryScores,
    bom,
    metadata: {
      fileName,
      fileSize: report.result?.metadata.fileSize ?? 0,
      scannedAt,
      detectedLanguage: report.result?.metadata.detectedLanguage ?? bom.detectedLanguage,
      detectedFramework: report.result?.metadata.detectedFramework ?? bom.detectedFramework,
      selectedPlatform: platform,
      agentName: bom.agentName,
      scanDuration: report.result?.metadata.scanDuration ?? 0,
    },
  })
  const criticalFindings = findings.filter(finding => finding.severity === 'critical')
  const critical = criticalFindings.length
  const high = findings.filter(finding => finding.severity === 'high').length
  const medium = findings.filter(finding => finding.severity === 'medium').length

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-10">
      <div className="no-print mb-8 flex items-center justify-between">
        <button onClick={() => window.history.back()} className="no-print flex items-center gap-2 text-sm text-[#4B6080] transition-colors hover:text-white"><span>←</span><span className="hidden sm:inline">Back</span></button>
        <div className="flex gap-2">
          <button onClick={downloadPDF} className="no-print flex items-center gap-2 rounded-lg border border-[#1E2D40] px-3 py-2 text-sm text-[#94A3B8] transition-colors hover:border-[#243244] hover:text-white sm:px-4"><span>↓</span><span className="hidden sm:inline">Download PDF</span></button>
          <button onClick={emailReport} className="no-print flex items-center gap-2 rounded-lg border border-[#1A2535] px-3 py-2 text-sm text-[#8896A8] transition-colors hover:border-[#1F2D40] hover:text-white sm:px-4"><span>✉</span><span className="hidden sm:inline">Email Report</span></button>
          <button onClick={copyLink} className="no-print flex items-center gap-2 rounded-lg border border-[#1E2D40] px-3 py-2 text-sm text-[#94A3B8] transition-colors hover:border-[#243244] hover:text-white sm:px-4"><span>{linkCopied ? '✓' : '↗'}</span><span className="hidden sm:inline">{linkCopied ? 'Copied!' : 'Copy Link'}</span></button>
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

      <section className={`verdict-banner print-border mb-6 overflow-hidden rounded-2xl border text-center ${verified ? 'border-[#10B981]/20 bg-[#10B981]/8' : 'border-[#EF4444]/20 bg-[#EF4444]/8'}`}>
        <div className={`h-1 rounded-t-2xl ${verified ? 'bg-[#10B981]' : 'bg-[#EF4444]'}`} />
        <div className="p-5 md:p-8">
          <div className={`text-2xl font-bold md:text-3xl ${verified ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>{verified ? 'Execution Authorized' : 'Execution Not Authorized'}</div>
          <div className="mt-6 text-xs font-medium uppercase tracking-widest text-[#4B6080]">Risk Score</div>
          <div className="text-5xl font-bold text-white md:text-7xl">{riskScore}<span className="text-2xl text-[#4B6080]">/100</span></div>
          <div className="mt-2 text-xs text-[#4B6080]">{critical} critical / {high} high / {medium} medium</div>
          <div className="mt-4 flex flex-wrap justify-center gap-2"><Badge variant={verified ? 'verified' : 'failed'}>{verdict}</Badge><Badge variant="muted">{riskLevel}</Badge>{typeof confidence === 'number' && <Badge variant="cli">{confidence}% confidence</Badge>}</div>
          <div className="mt-3 flex flex-wrap justify-center gap-4 text-xs text-[#4B6080]"><span>{fileName}</span>{platform && <span>{platform}</span>}<span>{formattedDate}</span></div>
        </div>
      </section>

      <section className="print-border mb-6 rounded-xl border border-[#1E2D40] bg-[#0F1623] p-6">
        <h2 className="mb-5 text-lg font-semibold text-white">Executive Summary</h2>
        <div className="mb-6 rounded-xl border border-[#1A2535] bg-[#0D1321] p-5">
          <p className="mb-3 text-sm font-medium text-white">{summary.headline}</p>
          <ul className="mb-4 space-y-1.5">
            {summary.bullets.map((b, i) => <li key={i} className="flex items-start gap-2 text-sm text-[#8896A8]"><span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${verdict === 'VERIFIED' ? 'bg-[#00B37E]' : 'bg-[#E03E3E]'}`} />{b}</li>)}
          </ul>
          {verdict !== 'VERIFIED' && <div className="rounded-lg border border-[#E03E3E]/20 bg-[#E03E3E]/5 p-3"><p className="mb-1 text-xs font-medium text-[#E03E3E]">Attack Surface</p><p className="text-xs text-[#8896A8]">{summary.attackerView}</p></div>}
          <p className="mt-3 text-xs text-[#3D5166]">{summary.action}</p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          <div><h3 className="mb-2 text-sm font-semibold text-white">Risk Assessment</h3><p className="text-sm leading-relaxed text-[#94A3B8]">This agent {verified ? 'passed' : 'failed'} execution trust analysis with a score of {riskScore}/100. {findings.length === 0 ? 'No security issues were detected.' : `${findings.length} issue${findings.length === 1 ? '' : 's'} were identified requiring attention before production deployment.`}</p></div>
          <div><h3 className="mb-2 text-sm font-semibold text-white">Critical Issues</h3>{criticalFindings.length ? <div className="space-y-2">{criticalFindings.map(finding => <div key={finding.id} className="flex gap-2 text-sm text-[#94A3B8]"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#EF4444]" />{finding.title}</div>)}</div> : <p className="text-sm text-[#10B981]">No critical issues detected</p>}</div>
          <div><h3 className="mb-2 text-sm font-semibold text-white">Recommended Action</h3><p className="text-sm leading-relaxed text-[#94A3B8]">{verified ? 'This agent meets execution trust requirements. Continue monitoring with regular re-scans.' : 'Address critical findings before deployment. Contact AI Blockchain Ventures for A2SPA integration support.'} <a className="text-[#06B6D4]" href="https://aiblockchainventures.com">aiblockchainventures.com</a></p></div>
        </div>
      </section>

      <CategoryScores scores={categoryScores} />

      <section className="mb-6">
        <h2 className="mb-4 font-semibold text-white">Findings ({findings.length})</h2>
        {findings.length === 0 ? <div className="rounded-xl border border-[#10B981]/20 bg-[#10B981]/5 p-8 text-center"><div className="mb-3 text-3xl text-[#10B981]">No issues</div><div className="font-semibold text-white">No issues detected</div><div className="mt-1 text-sm text-[#4B6080]">This agent passed all security checks</div></div> : <div className="space-y-2">{findings.map(finding => <div key={finding.id} className="finding-card"><FindingCard finding={finding} /></div>)}</div>}
      </section>

      <RuntimeBOM bom={bom} />

      <footer className="print-border mt-10 flex flex-col items-center justify-between gap-3 border-t border-[#1E2D40] pt-6 text-center text-xs text-[#4B6080] md:flex-row md:gap-6 md:text-left">
        <span>Generated by Agent Verify - Execution Trust Analysis Platform</span>
        <span>Powered by A2SPA / AI Blockchain Ventures LLC / aiblockchainventures.com</span>
      </footer>
    </main>
  )
}
