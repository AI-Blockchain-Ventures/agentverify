import type { ArtifactFingerprint } from '@agentverify/scanner'
import type { Finding, RiskLevel, ScanResult, Severity, StoredReport } from '@/types'
import { db } from './firebase'
import {
  collection,
  doc,
  DocumentData,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore'

const parseDate = (val: unknown): string => {
  if (!val) return new Date().toISOString()
  if (typeof val === 'string' && val.length > 0) return val
  if (typeof val === 'object' && val !== null) {
    if ('toDate' in val && typeof (val as { toDate: unknown }).toDate === 'function') {
      return (val as { toDate: () => Date }).toDate().toISOString()
    }
    if ('seconds' in val) {
      return new Date((val as { seconds: number }).seconds * 1000).toISOString()
    }
  }
  return new Date().toISOString()
}

const sanitize = (obj: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, v === undefined ? null : v])
  )

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// CLI/Worker-saved reports store nested structures (capabilities, MCP exposures, category
// breakdowns, etc.) as JSON strings in Firestore (see workers/api/src/worker.ts), while
// browser-saved reports store them as native arrays/objects. Every field read below must go
// through this first, or CLI-sourced report data is silently dropped instead of parsed.
const parseJsonField = (value: unknown): unknown => {
  if (typeof value !== 'string' || !value.trim()) return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

const asArray = (value: unknown): unknown[] => {
  const parsed = parseJsonField(value)
  return Array.isArray(parsed) ? parsed : []
}

const normalizeVerdict = (value: unknown): StoredReport['verdict'] => {
  if (value === 'VERIFIED') return 'VERIFIED'
  return 'NOT VERIFIED' as StoredReport['verdict']
}

const normalizeFindings = (raw: unknown): Finding[] => {
  if (!Array.isArray(raw)) return []
  return raw.map((f, i) => {
    if (typeof f === 'string') {
      return {
        id: String(i),
        code: `LEGACY_FINDING_${i}`,
        title: f,
        category: 'B' as const,
        severity: 'medium' as const,
        whatIsWrong: '',
        whyItMatters: '',
        recommendedFix: '',
      }
    }

    const finding = isRecord(f) ? f : {}
    return {
      id: typeof finding.id === 'string' ? finding.id : String(i),
      code: typeof finding.code === 'string' ? finding.code : `LEGACY_FINDING_${i}`,
      title: typeof finding.title === 'string' ? finding.title : '',
      category: (finding.category ?? 'B') as 'A' | 'B',
      severity: (finding.severity ?? 'medium') as Severity,
      whatIsWrong: typeof finding.whatIsWrong === 'string' ? finding.whatIsWrong : '',
      whyItMatters: typeof finding.whyItMatters === 'string' ? finding.whyItMatters : '',
      recommendedFix: typeof finding.recommendedFix === 'string' ? finding.recommendedFix : '',
      evidence: typeof finding.evidence === 'string' ? finding.evidence : undefined,
      quickFix: typeof finding.quickFix === 'string' ? finding.quickFix : undefined,
      compliance: isRecord(finding.compliance) ? finding.compliance as Finding['compliance'] : undefined,
      line: typeof finding.line === 'number' ? finding.line : undefined,
      evidenceType: finding.evidenceType === 'definite' || finding.evidenceType === 'heuristic' || finding.evidenceType === 'informational' ? finding.evidenceType : undefined,
      securityCategory: typeof finding.securityCategory === 'string' ? finding.securityCategory as Finding['securityCategory'] : undefined,
      capabilityImpact: typeof finding.capabilityImpact === 'string' ? finding.capabilityImpact : undefined,
      fixCode: typeof finding.fixCode === 'string' ? finding.fixCode : undefined,
    }
  })
}

export const normalize = (doc: DocumentData, id: string): StoredReport => ({
  reportId: doc.reportId ?? id,
  verdict: normalizeVerdict(doc.verdict ?? doc.result?.verdict),
  riskScore: typeof doc.riskScore === 'number' ? doc.riskScore : doc.result?.riskScore ?? 0,
  riskLevel: doc.riskLevel ?? doc.result?.riskLevel ?? ('High Risk' as RiskLevel),
  fileName: doc.fileName ?? doc.agentName ?? doc.metadata?.fileName ?? doc.result?.metadata?.fileName ?? 'Agent Config',
  scannedAt: parseDate(doc.scannedAt ?? doc.createdAt ?? doc.metadata?.scannedAt ?? doc.result?.metadata?.scannedAt),
  source: doc.source ?? 'dashboard',
  findings: normalizeFindings(doc.findings ?? doc.result?.findings),
  platform: doc.platform ?? doc.metadata?.selectedPlatform ?? doc.result?.metadata?.selectedPlatform ?? null,
  agentName: doc.agentName ?? doc.result?.bom?.agentName ?? null,
  uid: typeof doc.uid === 'string' ? doc.uid : typeof doc.userId === 'string' ? doc.userId : undefined,
  userId: typeof doc.userId === 'string' ? doc.userId : undefined,
  isPrivate: doc.isPublic !== true,
  isPublic: doc.isPublic === true,
  password: null,
  _source: doc._source === 'cli' || doc._source === 'user' || doc._source === 'public' ? doc._source : undefined,
  createdAt: doc.createdAt ?? doc.result?.metadata?.scannedAt ?? undefined,
  capabilities: asArray(doc.capabilities ?? doc.result?.capabilities) as StoredReport['capabilities'],
  mcpExposures: asArray(doc.mcpExposures ?? doc.result?.mcpExposures) as StoredReport['mcpExposures'],
  securityCategories: asArray(doc.securityCategories ?? doc.result?.securityCategories) as StoredReport['securityCategories'],
  capabilityChains: asArray(doc.capabilityChains ?? doc.result?.capabilityChains) as StoredReport['capabilityChains'],
  a2spaStatus: (doc.a2spaStatus ?? doc.result?.a2spaStatus) as StoredReport['a2spaStatus'] ?? undefined,
  securityControlsDetected: asArray(doc.securityControlsDetected ?? doc.result?.securityControlsDetected) as StoredReport['securityControlsDetected'],
  notDetermined: asArray(doc.notDetermined ?? doc.result?.notDetermined) as string[],
  categoryScores: asArray(doc.categoryScores ?? doc.result?.categoryScores) as StoredReport['categoryScores'],
  scannerVersion: typeof doc.scannerVersion === 'string' && doc.scannerVersion ? doc.scannerVersion : typeof doc.result?.metadata?.scannerVersion === 'string' ? doc.result.metadata.scannerVersion : null,
  bom: (isRecord(parseJsonField(doc.bom)) ? parseJsonField(doc.bom) : isRecord(parseJsonField(doc.result?.bom)) ? parseJsonField(doc.result?.bom) : null) as StoredReport['bom'],
  artifactHash: typeof doc.artifactHash === 'string' && doc.artifactHash ? doc.artifactHash : null,
  artifactHashAlgorithm: typeof doc.artifactHashAlgorithm === 'string' && doc.artifactHashAlgorithm ? doc.artifactHashAlgorithm : null,
  artifactFingerprintVersion: typeof doc.artifactFingerprintVersion === 'string' && doc.artifactFingerprintVersion ? doc.artifactFingerprintVersion : null,
})

export const sortReports = (reports: StoredReport[]): StoredReport[] =>
  [...reports].sort((a, b) => {
    const dateA = new Date(a?.scannedAt ?? a?.createdAt ?? 0).getTime()
    const dateB = new Date(b?.scannedAt ?? b?.createdAt ?? 0).getTime()
    return dateB - dateA
  })

export async function saveReport(uid: string, result: ScanResult, artifactFingerprint?: ArtifactFingerprint): Promise<void> {
  const reportData = sanitize({
    reportId: result.reportId,
    artifactHash: artifactFingerprint?.artifactHash ?? null,
    artifactHashAlgorithm: artifactFingerprint?.artifactHashAlgorithm ?? null,
    artifactFingerprintVersion: artifactFingerprint?.artifactFingerprintVersion ?? null,
    uid,
    userId: uid,
    verdict: result.verdict,
    riskScore: result.riskScore,
    riskLevel: result.riskLevel,
    confidence: result.confidence,
    fileName: result.metadata.fileName,
    agentName: result.bom.agentName ?? null,
    platform: result.metadata.selectedPlatform ?? null,
    scannerVersion: result.metadata.scannerVersion ?? null,
    findings: result.findings.map(f => ({
      id: f.id,
      code: f.code,
      title: f.title,
      category: f.category,
      severity: f.severity,
      whatIsWrong: f.whatIsWrong,
      whyItMatters: f.whyItMatters,
      recommendedFix: f.recommendedFix,
      evidence: f.evidence ?? null,
      quickFix: f.quickFix ?? null,
      fixCode: f.fixCode ?? null,
      compliance: f.compliance ?? null,
      line: f.line ?? null,
      evidenceType: f.evidenceType ?? null,
      securityCategory: f.securityCategory ?? null,
      capabilityImpact: f.capabilityImpact ?? null,
    })),
    scannedAt: result.metadata.scannedAt ?? new Date().toISOString(),
    source: 'dashboard',
    isPublic: false,
    categoryScores: result.categoryScores,
    securityCategories: result.securityCategories ?? [],
    capabilities: result.capabilities ?? [],
    mcpExposures: result.mcpExposures ?? [],
    capabilityChains: result.capabilityChains ?? [],
    a2spaStatus: result.a2spaStatus ?? null,
    securityControlsDetected: result.securityControlsDetected ?? [],
    notDetermined: result.notDetermined ?? [],
    reportInsights: result.reportInsights ?? null,
    threatCategories: result.threatCategories ?? [],
    bom: {
      detectedLanguage: result.bom.detectedLanguage,
      detectedFramework: result.bom.detectedFramework ?? null,
      detectedPlatform: result.bom.detectedPlatform ?? null,
      agentName: result.bom.agentName ?? null,
      toolAccessLevel: result.bom.toolAccessLevel,
      credentialExposure: result.bom.credentialExposure,
      memoryPersistence: result.bom.memoryPersistence,
      auditLogging: result.bom.auditLogging,
      humanGates: result.bom.humanGates,
      rateLimiting: result.bom.rateLimiting,
      promptInjectionSurface: result.bom.promptInjectionSurface,
      delegationScope: result.bom.delegationScope,
    },
  })
  await setDoc(doc(db, 'users', uid, 'reports', result.reportId), reportData)
  await setDoc(doc(db, 'reports', result.reportId), reportData)
}

export async function getReports(uid: string): Promise<StoredReport[]> {
  const ownSnap = await getDocs(collection(db, 'users', uid, 'reports'))
  const cliSnap = await getDocs(query(collection(db, 'cliReports'), where('uid', '==', uid)))
  const reports: StoredReport[] = [
    ...ownSnap.docs.map(item => normalize(item.data(), item.id)),
    ...cliSnap.docs.map(item => normalize(item.data(), item.id)),
  ]

  return sortReports(reports)
}

export async function getReport(reportId: string, uid?: string): Promise<StoredReport | null> {
  const canonical = await getDoc(doc(db, 'reports', reportId))
  if (canonical.exists()) return normalize(canonical.data(), canonical.id)

  if (uid) {
    const own = await getDoc(doc(db, 'users', uid, 'reports', reportId))
    if (own.exists()) return normalize(own.data(), own.id)
  }

  if (uid) {
    const cli = await getDoc(doc(db, 'cliReports', reportId))
    if (cli.exists()) return normalize(cli.data(), cli.id)
  }

  return null
}
