import type {
  CategoryScore, Finding, RuntimeBOM as RuntimeBOMType, RiskLevel, ThreatCategoryAssessment,
  ThreatCategoryStatus, Verdict, AgentCapability, McpToolExposure, SecurityCategoryStatus,
  CapabilityChain, A2spaStatus, SecurityControl, ScanResult,
} from '@/types'

/**
 * Canonical evidence normalizer — the ONE place raw report data (a Firestore doc, a live
 * ScanResult, or explicit props) gets turned into a clean, typed shape. Every report view
 * (Executive, Security Analysis, Developer, Compliance, AI/JSON, Full Technical) calls this same
 * function on the same input and gets byte-identical output — there is no second code path that
 * could drift and show a different verdict, score, or finding list in a different view.
 *
 * This is a pure function: same input always produces the same output, so each view can call it
 * independently without any shared state or prop-drilling risk. It performs no I/O and has no
 * side effects.
 */

export interface NormalizeReportInput {
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
  reportUrl?: string
}

export interface NormalizedReport {
  reportId: string
  verdict: Verdict
  verdictLabel: string
  verified: boolean
  riskScore: number
  riskLevel: RiskLevel
  confidence: number
  fileName: string
  platform: string | null
  scannedAt: string
  formattedDate: string
  source: string
  findings: Finding[]
  findingCount: number
  criticalCount: number
  highCount: number
  mediumCount: number
  lowCount: number
  categoryScores: CategoryScore[]
  bom: RuntimeBOMType
  capabilities: AgentCapability[]
  mcpExposures: McpToolExposure[]
  securityCategories: SecurityCategoryStatus[]
  capabilityChains: CapabilityChain[]
  a2spaStatus: A2spaStatus | undefined
  securityControlsDetected: SecurityControl[]
  notDetermined: string[]
  threatCategories: ThreatCategoryAssessment[]
  relevantThreatCategories: ThreatCategoryAssessment[]
  reportInsights: {
    executionReadinessScore: number
    a2spaReadinessScore: number
    remediationProgressScore: number
    topBlocker: string
    nextAction: string
    scoreExplanation: string[]
    improvesScore: string[]
    verificationBlockers: string[]
    fixPriority: Array<{ title: string; severity: string; priority: string; reason: string }>
    scoreFormula: { startingScore: number; deductions: Array<{ reason: string; points: number }>; cappedAt: number | null; cappedReason: string | null; finalScore: number }
    highestRisks: string[]
    canWait: string[]
  }
  evidenceFindings: Finding[]
  complianceTags: { owasp: string[]; nist: string[]; soc2: string[] }
  publicReportUrl: string
  isPublic: boolean
  /** Identifies the exact submitted content this scan analyzed — undefined for reports scanned before this field existed. See packages/scanner/src/artifactFingerprint.ts for what it does and does not prove. */
  artifactHash: string | undefined
  artifactHashAlgorithm: string | undefined
  artifactFingerprintVersion: string | undefined
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

const reportIdFromUrl = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  try {
    return new URL(value).searchParams.get('id') ?? ''
  } catch {
    return ''
  }
}

const normalizeVerdictValue = (value: unknown): Verdict => (value === 'VERIFIED' ? 'VERIFIED' : 'NOT VERIFIED' as Verdict)

const fallbackBom = (platform?: string | null): RuntimeBOMType => ({
  detectedLanguage: 'Unknown', detectedFramework: null, detectedPlatform: platform ?? null, agentName: null,
  toolAccessLevel: 'Unknown', credentialExposure: 'Not Detected', memoryPersistence: 'Unknown',
  auditLogging: 'Unknown', humanGates: 'Unknown', rateLimiting: 'Unknown',
  promptInjectionSurface: 'Unknown', delegationScope: 'Unknown',
})

const normalizeBomValue = (value: unknown, platform?: string | null): RuntimeBOMType | null => {
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
  const catA = findings.filter(f => f.category === 'A').length
  const catB = findings.filter(f => f.category === 'B').length
  return [
    { category: 'A', label: 'Protocol Compliance', score: Math.max(0, 50 - catA * 10), maxScore: 50, findingCount: catA },
    { category: 'B', label: 'Security Controls', score: Math.max(0, 50 - catB * 10), maxScore: 50, findingCount: catB },
  ]
}

export function normalizeReportData(input: NormalizeReportInput): NormalizedReport {
  const { report, verdict, riskScore, riskLevel, fileName, platform, scannedAt, source = 'dashboard', findings, categoryScores, bom, reportId, reportUrl } = input

  const rawResult = isRecord(report?.result) ? report.result : undefined
  const rawMetadata = isRecord(rawResult?.metadata) ? rawResult.metadata : undefined
  const parsedReportInsights = parseJson(report?.reportInsights)
  const parsedResultInsights = parseJson(rawResult?.reportInsights)
  const rawInsights = isRecord(parsedReportInsights) ? parsedReportInsights : isRecord(parsedResultInsights) ? parsedResultInsights : undefined

  const normalizedReportId = asString(reportId, asString(report?.reportId, asString(report?.id, reportIdFromUrl(reportUrl) || reportIdFromUrl(report?.reportUrl))))
  const normalizedVerdict = normalizeVerdictValue(verdict ?? report?.verdict ?? rawResult?.verdict)
  const normalizedRiskScore = asNumber(riskScore ?? report?.riskScore ?? rawResult?.riskScore)
  const normalizedConfidence = asNumber(report?.confidence ?? rawResult?.confidence, normalizedRiskScore > 0 ? 80 : 0)
  const rawRiskLevel = riskLevel ?? report?.riskLevel ?? rawResult?.riskLevel
  const normalizedRiskLevel = (rawRiskLevel === 'Low Risk' || rawRiskLevel === 'Moderate Risk' || rawRiskLevel === 'High Risk' ? rawRiskLevel : 'High Risk') as RiskLevel
  const normalizedFileName = asString(fileName ?? report?.fileName ?? rawMetadata?.fileName, 'Agent Config')
  const normalizedPlatform = (platform ?? asString(report?.platform ?? rawMetadata?.selectedPlatform, '')) || null
  const normalizedScannedAt = asString(scannedAt ?? report?.scannedAt ?? report?.createdAt ?? rawMetadata?.scannedAt, new Date().toISOString())
  const normalizedSource = source ?? asString(report?.source, 'dashboard')

  const parsedBom = parseJson(report?.bom) ?? parseJson(rawResult?.bom)
  const normalizedBom = bom ?? normalizeBomValue(parsedBom, normalizedPlatform) ?? fallbackBom(normalizedPlatform)
  const rawFindings = findings ?? (Array.isArray(report?.findings) ? report.findings : Array.isArray(rawResult?.findings) ? rawResult.findings : [])

  const parsedReportThreatCategories = parseJson(report?.threatCategories)
  const parsedResultThreatCategories = parseJson(rawResult?.threatCategories)
  const rawThreatCategories = Array.isArray(parsedReportThreatCategories) ? parsedReportThreatCategories : Array.isArray(parsedResultThreatCategories) ? parsedResultThreatCategories : []

  const safeFindings: Finding[] = rawFindings.map((finding, i) => {
    if (typeof finding === 'string') {
      return { id: String(i), code: `LEGACY_FINDING_${i}`, title: finding, category: 'B', severity: 'medium', whatIsWrong: '', whyItMatters: '', recommendedFix: '' }
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
      evidence: finding.evidence || undefined,
      quickFix: finding.quickFix || undefined,
      fixCode: finding.fixCode || undefined,
      compliance: finding.compliance ?? undefined,
      line: typeof finding.line === 'number' ? finding.line : undefined,
      evidenceType: finding.evidenceType === 'definite' || finding.evidenceType === 'heuristic' || finding.evidenceType === 'informational' ? finding.evidenceType : undefined,
      securityCategory: (finding.securityCategory || undefined) as Finding['securityCategory'],
      capabilityImpact: finding.capabilityImpact || undefined,
    }
  })

  const rawCategoryScoresParsed = parseJson(report?.categoryScores) ?? parseJson(rawResult?.categoryScores)
  const rawCategoryScores = categoryScores ?? (Array.isArray(rawCategoryScoresParsed) ? rawCategoryScoresParsed as CategoryScore[] : undefined)
  const normalizedCategoryScores = rawCategoryScores?.length ? rawCategoryScores : scoreCategories(safeFindings)

  const parsedCapabilities = parseJson(report?.capabilities) ?? parseJson(rawResult?.capabilities)
  const normalizedCapabilities: AgentCapability[] = Array.isArray(parsedCapabilities) ? parsedCapabilities.filter(isRecord).map(item => ({
    id: asString(item.id, 'capability'), label: asString(item.label, 'Capability'), evidence: asString(item.evidence, ''),
    confidence: item.confidence === 'definite' || item.confidence === 'heuristic' || item.confidence === 'informational' ? item.confidence : 'heuristic',
  })) : []

  const parsedMcpExposures = parseJson(report?.mcpExposures) ?? parseJson(rawResult?.mcpExposures)
  const normalizedMcpExposures: McpToolExposure[] = Array.isArray(parsedMcpExposures) ? parsedMcpExposures.filter(isRecord).map(item => ({
    toolName: asString(item.toolName, 'Unknown tool'), server: typeof item.server === 'string' ? item.server : null,
    potentialActions: asStringArray(item.potentialActions),
    riskLevel: item.riskLevel === 'critical' || item.riskLevel === 'high' || item.riskLevel === 'medium' || item.riskLevel === 'low' ? item.riskLevel : 'medium',
    evidence: asString(item.evidence, ''),
  })) : []

  const parsedSecurityCategories = parseJson(report?.securityCategories) ?? parseJson(rawResult?.securityCategories)
  const normalizedSecurityCategories: SecurityCategoryStatus[] = Array.isArray(parsedSecurityCategories) ? parsedSecurityCategories.filter(isRecord).map(item => ({
    id: item.id as SecurityCategoryStatus['id'], label: asString(item.label, 'Category'), findingCount: asNumber(item.findingCount, 0),
    highestSeverity: (item.highestSeverity as SecurityCategoryStatus['highestSeverity']) ?? null,
    status: item.status === 'strong' || item.status === 'needs_attention' || item.status === 'critical' || item.status === 'not_assessed' ? item.status : 'not_assessed',
  })) : []

  const parsedCapabilityChains = parseJson(report?.capabilityChains) ?? parseJson(rawResult?.capabilityChains)
  const normalizedCapabilityChains: CapabilityChain[] = Array.isArray(parsedCapabilityChains) ? parsedCapabilityChains.filter(isRecord).map(item => ({
    id: asString(item.id, 'chain'), title: asString(item.title, 'Capability combination'), capabilityIds: asStringArray(item.capabilityIds),
    impact: asString(item.impact, ''), severity: (item.severity === 'critical' || item.severity === 'high' || item.severity === 'medium' || item.severity === 'low' ? item.severity : 'medium') as CapabilityChain['severity'],
  })) : []

  const rawA2spaStatus = report?.a2spaStatus ?? rawResult?.a2spaStatus
  const normalizedA2spaStatus = rawA2spaStatus === 'detected' || rawA2spaStatus === 'partially_detected' || rawA2spaStatus === 'not_detected' || rawA2spaStatus === 'cannot_determine' ? rawA2spaStatus : undefined

  const parsedControls = parseJson(report?.securityControlsDetected) ?? parseJson(rawResult?.securityControlsDetected)
  const normalizedControls = Array.isArray(parsedControls) ? parsedControls.filter(isRecord).map(item => ({
    id: asString(item.id, 'control'), label: asString(item.label, ''), evidence: asString(item.evidence, ''),
  })) : []

  const parsedNotDetermined = parseJson(report?.notDetermined) ?? parseJson(rawResult?.notDetermined)
  const normalizedNotDetermined = asStringArray(parsedNotDetermined)

  const threatCategories: ThreatCategoryAssessment[] = rawThreatCategories.filter(isRecord).map((item, index) => ({
    id: asString(item.id, `threat-${index}`), label: asString(item.label, 'Threat category'),
    status: item.status === 'detected' || item.status === 'possible' || item.status === 'missing_evidence' || item.status === 'not_assessed' ? item.status : 'not_assessed' as ThreatCategoryStatus,
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
  const critical = safeFindings.filter(f => f.severity === 'critical').length
  const high = safeFindings.filter(f => f.severity === 'high').length
  const medium = safeFindings.filter(f => f.severity === 'medium').length
  const low = safeFindings.filter(f => f.severity === 'low').length
  const topFinding = [...safeFindings].sort((a, b) => {
    const rank = { critical: 4, high: 3, medium: 2, low: 1 }
    return rank[b.severity] - rank[a.severity]
  })[0]

  const insightFixPriority = Array.isArray(rawInsights?.fixPriority) ? rawInsights.fixPriority.filter(isRecord) : []
  const fixPriority = insightFixPriority.length
    ? insightFixPriority.map(item => ({ title: asString(item.title, 'Review finding'), severity: asString(item.severity, 'medium'), priority: asString(item.priority, 'fix_next'), reason: asString(item.reason, 'This improves the security report.') }))
    : safeFindings.map((finding, index) => ({
        title: finding.title, severity: finding.severity,
        priority: index < 3 || finding.severity === 'critical' ? 'fix_first' : finding.severity === 'high' || finding.severity === 'medium' ? 'fix_next' : 'nice_to_have',
        reason: finding.category === 'A' ? 'Blocks execution-readiness and A2SPA evidence.' : 'Improves runtime security and operational safety.',
      }))

  const rawScoreFormula = isRecord(rawInsights?.scoreFormula) ? rawInsights.scoreFormula : undefined
  const fallbackDeductions = [
    critical > 0 ? { reason: `${critical} critical finding${critical === 1 ? '' : 's'} (−20 each)`, points: critical * 20 } : null,
    high > 0 ? { reason: `${high} high finding${high === 1 ? '' : 's'} (−10 each)`, points: high * 10 } : null,
    medium > 0 ? { reason: `${medium} medium finding${medium === 1 ? '' : 's'} (−5 each)`, points: medium * 5 } : null,
  ].filter((item): item is { reason: string; points: number } => item !== null)
  const scoreFormula = {
    startingScore: asNumber(rawScoreFormula?.startingScore, 100),
    deductions: Array.isArray(rawScoreFormula?.deductions) ? rawScoreFormula.deductions.filter(isRecord).map(d => ({ reason: asString(d.reason), points: asNumber(d.points) })) : fallbackDeductions,
    cappedAt: typeof rawScoreFormula?.cappedAt === 'number' ? rawScoreFormula.cappedAt : null,
    cappedReason: typeof rawScoreFormula?.cappedReason === 'string' ? rawScoreFormula.cappedReason : null,
    finalScore: asNumber(rawScoreFormula?.finalScore, normalizedRiskScore),
  }

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
    scoreFormula,
    highestRisks: asStringArray(rawInsights?.highestRisks).length ? asStringArray(rawInsights?.highestRisks) : fixPriority.filter(item => item.priority === 'fix_first').slice(0, 5).map(item => item.title),
    canWait: asStringArray(rawInsights?.canWait).length ? asStringArray(rawInsights?.canWait) : fixPriority.filter(item => item.priority === 'nice_to_have').map(item => item.title),
  }

  const evidenceFindings = safeFindings.filter(f => f.evidence)
  const owaspTags = [...new Set(safeFindings.flatMap(f => f.compliance?.owasp ?? []))]
  const nistTags = [...new Set(safeFindings.flatMap(f => f.compliance?.nist ?? []))]
  const soc2Tags = [...new Set(safeFindings.flatMap(f => f.compliance?.soc2 ?? []))]

  const publicReportUrl = reportUrl ?? asString(report?.reportUrl, `https://aimodularity.com/agentverify/report/?id=${normalizedReportId}`)

  return {
    reportId: normalizedReportId,
    verdict: normalizedVerdict,
    verdictLabel: normalizedVerdict === 'VERIFIED' ? 'VERIFIED' : 'NOT VERIFIED',
    verified,
    riskScore: normalizedRiskScore,
    riskLevel: normalizedRiskLevel,
    confidence: normalizedConfidence,
    fileName: normalizedFileName,
    platform: normalizedPlatform,
    scannedAt: normalizedScannedAt,
    formattedDate,
    source: normalizedSource,
    findings: safeFindings,
    findingCount: safeFindings.length,
    criticalCount: critical,
    highCount: high,
    mediumCount: medium,
    lowCount: low,
    categoryScores: normalizedCategoryScores,
    bom: normalizedBom,
    capabilities: normalizedCapabilities,
    mcpExposures: normalizedMcpExposures,
    securityCategories: normalizedSecurityCategories,
    capabilityChains: normalizedCapabilityChains,
    a2spaStatus: normalizedA2spaStatus,
    securityControlsDetected: normalizedControls,
    notDetermined: normalizedNotDetermined,
    threatCategories,
    relevantThreatCategories,
    reportInsights,
    evidenceFindings,
    complianceTags: { owasp: owaspTags, nist: nistTags, soc2: soc2Tags },
    publicReportUrl,
    isPublic: report?.isPublic === true,
    artifactHash: typeof report?.artifactHash === 'string' && report.artifactHash ? report.artifactHash : undefined,
    artifactHashAlgorithm: typeof report?.artifactHashAlgorithm === 'string' && report.artifactHashAlgorithm ? report.artifactHashAlgorithm : undefined,
    artifactFingerprintVersion: typeof report?.artifactFingerprintVersion === 'string' && report.artifactFingerprintVersion ? report.artifactFingerprintVersion : undefined,
  }
}

/**
 * Reconstructs a ScanResult-shaped object from NormalizedReport for report-integrity hashing
 * (see @agentverify/scanner's computeReportHash/verifyReportHash). This is the same canonical
 * evidence every view already renders — hashing it, not a separately-computed structure, is what
 * makes "verify this report hasn't changed" mean the same thing as "verify what you're looking
 * at hasn't changed". schemaVersion/scannerVersion/scanDuration fall back to honest neutral
 * defaults when the source report predates those fields being persisted.
 */
export function toHashableScanResult(data: NormalizedReport, extra?: { schemaVersion?: string; scannerVersion?: string; scanDuration?: number }): ScanResult {
  return {
    schemaVersion: (extra?.schemaVersion ?? '1.3.0') as ScanResult['schemaVersion'],
    reportId: data.reportId,
    verdict: data.verdict === 'VERIFIED' ? 'VERIFIED' : 'NOT_VERIFIED',
    riskScore: data.riskScore,
    riskLevel: data.riskLevel,
    confidence: data.confidence,
    optimizationScore: 0,
    reportInsights: data.reportInsights as ScanResult['reportInsights'],
    threatCategories: data.threatCategories,
    findings: data.findings,
    categoryScores: data.categoryScores,
    securityCategories: data.securityCategories,
    capabilities: data.capabilities,
    mcpExposures: data.mcpExposures,
    capabilityChains: data.capabilityChains,
    a2spaStatus: data.a2spaStatus ?? 'cannot_determine',
    securityControlsDetected: data.securityControlsDetected,
    notDetermined: data.notDetermined,
    bom: data.bom,
    metadata: {
      schemaVersion: (extra?.schemaVersion ?? '1.3.0') as ScanResult['metadata']['schemaVersion'],
      scannerVersion: extra?.scannerVersion ?? 'unknown',
      fileName: data.fileName,
      fileSize: 0,
      scannedAt: data.scannedAt,
      detectedLanguage: data.bom.detectedLanguage,
      detectedFramework: data.bom.detectedFramework,
      selectedPlatform: data.platform,
      agentName: data.bom.agentName,
      scanDuration: extra?.scanDuration ?? 0,
    },
  }
}
