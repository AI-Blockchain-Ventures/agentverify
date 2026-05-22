import type { ScanResult, StoredReport, Verdict, RiskLevel } from '@/types'
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

export const normalize = (doc: DocumentData, id: string): StoredReport => ({
  reportId: doc.reportId ?? id,
  verdict: doc.verdict ?? doc.result?.verdict ?? ('NOT VERIFIED' as Verdict),
  riskScore: typeof doc.riskScore === 'number' ? doc.riskScore : doc.result?.riskScore ?? 0,
  riskLevel: doc.riskLevel ?? doc.result?.riskLevel ?? ('High Risk' as RiskLevel),
  fileName: doc.fileName ?? doc.agentName ?? doc.metadata?.fileName ?? doc.result?.metadata?.fileName ?? 'Agent Config',
  scannedAt: parseDate(doc.scannedAt ?? doc.createdAt ?? doc.metadata?.scannedAt ?? doc.result?.metadata?.scannedAt),
  source: doc.source ?? 'dashboard',
  findings: doc.findings ?? doc.result?.findings ?? [],
  platform: doc.platform ?? doc.metadata?.selectedPlatform ?? doc.result?.metadata?.selectedPlatform ?? null,
  agentName: doc.agentName ?? doc.result?.bom?.agentName ?? null,
  uid: doc.uid ?? typeof doc.userId === 'string' ? doc.userId : undefined,
  createdAt: doc.createdAt ?? doc.result?.metadata?.scannedAt ?? undefined,
})

export const sortReports = (reports: StoredReport[]): StoredReport[] =>
  [...reports].sort((a, b) => {
    const dateA = new Date(a?.scannedAt ?? a?.createdAt ?? 0).getTime()
    const dateB = new Date(b?.scannedAt ?? b?.createdAt ?? 0).getTime()
    return dateB - dateA
  })

export async function saveReport(uid: string, result: ScanResult): Promise<void> {
  const payload = sanitize({
    reportId: result.reportId,
    verdict: result.verdict,
    riskScore: result.riskScore,
    riskLevel: result.riskLevel,
    fileName: result.metadata.fileName,
    agentName: result.bom.agentName ?? null,
    platform: result.metadata.selectedPlatform ?? null,
    findings: result.findings.map(f => f.title),
    scannedAt: result.metadata.scannedAt ?? new Date().toISOString(),
    source: 'dashboard',
    userId: uid,
    categoryScores: result.categoryScores,
    bom: { ...result.bom },
  })
  await setDoc(doc(db, 'users', uid, 'reports', result.reportId), payload)
}

export async function savePublicReport(result: ScanResult): Promise<void> {
  const payload = sanitize({
    reportId: result.reportId,
    source: 'public',
    createdAt: result.metadata.scannedAt,
    createdAtServer: serverTimestamp(),
    result: {
      ...result,
      findings: result.findings.map(finding => ({ ...finding, evidence: finding.evidence ? '[redacted]' : null })),
    },
  })
  await setDoc(doc(db, 'publicReports', result.reportId), payload)
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
  if (uid) {
    const own = await getDoc(doc(db, 'users', uid, 'reports', reportId))
    if (own.exists()) return normalize(own.data(), own.id)
  }

  const cli = await getDoc(doc(db, 'cliReports', reportId))
  if (cli.exists()) return normalize(cli.data(), cli.id)

  const pub = await getDoc(doc(db, 'publicReports', reportId))
  if (pub.exists()) return normalize(pub.data(), pub.id)

  return null
}
