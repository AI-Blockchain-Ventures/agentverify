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
})

export const sortReports = (reports: StoredReport[]): StoredReport[] =>
  [...reports].sort((a, b) => {
    const dateA = new Date(a?.scannedAt ?? a?.createdAt ?? 0).getTime()
    const dateB = new Date(b?.scannedAt ?? b?.createdAt ?? 0).getTime()
    return dateB - dateA
  })

export async function saveReport(uid: string, result: ScanResult): Promise<void> {
  const reportData = sanitize({
    reportId: result.reportId,
    uid,
    userId: uid,
    verdict: result.verdict,
    riskScore: result.riskScore,
    riskLevel: result.riskLevel,
    confidence: result.confidence,
    fileName: result.metadata.fileName,
    agentName: result.bom.agentName ?? null,
    platform: result.metadata.selectedPlatform ?? null,
    findings: result.findings.map(f => ({
      id: f.id,
      title: f.title,
      category: f.category,
      severity: f.severity,
      whatIsWrong: f.whatIsWrong,
      whyItMatters: f.whyItMatters,
      recommendedFix: f.recommendedFix,
      evidence: f.evidence ?? null,
      quickFix: f.quickFix ?? null,
      compliance: f.compliance ?? null,
    })),
    scannedAt: result.metadata.scannedAt ?? new Date().toISOString(),
    source: 'dashboard',
    isPublic: false,
    categoryScores: result.categoryScores,
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
