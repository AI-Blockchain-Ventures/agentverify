import type { SignedAttestation } from '@agentverify/scanner'
import { firestoreBaseUrl, firestoreAdminAuthHeader, type FirebaseServiceAccountEnv } from './firebaseAuth'

/**
 * Verification Status API — `GET /v1/verification/{artifactHash}`.
 *
 * "What is the current Agent Verify status for this artifact?" — answered from stored report
 * evidence, never by re-deriving anything. Full findings are never exposed here by design (this
 * is a status/attestation lookup, not a report-fetch endpoint); use the existing report
 * endpoints/UI, which have their own separate authorization, for that.
 *
 * Authorization model (enforced entirely in this module's own code, never left to Firestore
 * rules alone, since the Firestore reads here go through a service-account OAuth token that
 * bypasses firestore.rules — see firebaseAuth.ts):
 * - No/invalid API key: only a report explicitly marked `isPublic: true` for this artifact is
 *   returned. Nothing else is visible.
 * - Valid API key: the caller's OWN report for this artifact is returned (checked by comparing
 *   the report's stored `uid` field — resolved server-side from the API key — never a
 *   client-supplied id). A report belonging to a different uid is never returned to this caller
 *   even if it exists, and the response is identical (404) whether it doesn't exist at all or
 *   exists only under a different, non-public tenant — this endpoint never confirms or denies
 *   the existence of another tenant's data.
 */

export type VerificationEnv = FirebaseServiceAccountEnv

export type VerificationLookupOutcome =
  | { kind: 'found'; status: VerificationStatusResponse }
  | { kind: 'not_found' }

export interface VerificationStatusResponse {
  artifactHash: string
  latestScanId: string
  verdict: string
  score: number
  policyProfile: string | null
  policyResult: string | null
  scannerVersion: string | null
  rulesetVersion: string | null
  verifiedAt: string
  reportHash: string | null
  attestation: SignedAttestation | null
  signature: string | null
  /** 'private' — visible only because the caller authenticated as the owner. 'public' — visible to anyone because the record was explicitly published. */
  status: 'private' | 'public'
}

interface FirestoreValue {
  stringValue?: string
  integerValue?: string
  doubleValue?: number | string
  booleanValue?: boolean
  nullValue?: null
}

interface FirestoreDoc {
  fields?: Record<string, FirestoreValue>
}

interface RunQueryResultRow {
  document?: FirestoreDoc
}

const FIRESTORE_QUERY_LIMIT = 20 // recent candidates only — this is a status lookup, not an audit export

async function runArtifactHashQuery(
  collectionId: 'cliReports' | 'reports',
  artifactHash: string,
  headers: Record<string, string>,
  env: VerificationEnv
): Promise<FirestoreDoc[]> {
  const url = `${firestoreBaseUrl(env)}:runQuery`
  const body = {
    structuredQuery: {
      from: [{ collectionId }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'artifactHash' },
          op: 'EQUAL',
          value: { stringValue: artifactHash },
        },
      },
      orderBy: [{ field: { fieldPath: 'scannedAt' }, direction: 'DESCENDING' }],
      limit: FIRESTORE_QUERY_LIMIT,
    },
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    // A missing composite index (artifactHash ASC, scannedAt DESC) on this collection surfaces
    // as a 400 FAILED_PRECONDITION here in a real Firestore project — see docs/verification-api.md.
    console.warn('Verification status query failed', collectionId, res.status, await res.text().catch(() => ''))
    return []
  }
  const rows = await res.json() as RunQueryResultRow[]
  return rows.map(r => r.document).filter((d): d is FirestoreDoc => !!d)
}

const str = (v?: FirestoreValue): string | null => (typeof v?.stringValue === 'string' ? v.stringValue : null)
const num = (v?: FirestoreValue): number => {
  const raw = v?.integerValue ?? v?.doubleValue
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  return Number.isFinite(n) ? n : 0
}
const bool = (v?: FirestoreValue): boolean => v?.booleanValue === true

function toStatusResponse(doc: FirestoreDoc, artifactHash: string, visibility: 'private' | 'public'): VerificationStatusResponse {
  const f = doc.fields ?? {}
  let attestation: SignedAttestation | null = null
  const attestationRaw = str(f.attestation)
  if (attestationRaw) {
    try { attestation = JSON.parse(attestationRaw) as SignedAttestation } catch { attestation = null }
  }
  return {
    artifactHash,
    latestScanId: str(f.reportId) ?? '',
    verdict: str(f.verdict) ?? 'NOT_ASSESSED',
    score: num(f.riskScore),
    policyProfile: str(f.policyProfile),
    policyResult: str(f.policyResult),
    scannerVersion: str(f.scannerVersion),
    rulesetVersion: str(f.scannerVersion), // this scanner does not version its ruleset separately — see attestation.ts
    verifiedAt: str(f.scannedAt) ?? '',
    reportHash: str(f.reportHash),
    attestation,
    signature: attestation?.signature ?? null,
    status: visibility,
  }
}

/**
 * `callerUid` must come only from server-side API-key validation (see worker.ts's
 * validateApiKey) — never from a client-supplied header/param. Pass `null` for an unauthenticated
 * or invalid-key request; this function then only ever considers public records.
 */
export async function lookupVerificationStatus(
  artifactHash: string,
  callerUid: string | null,
  env: VerificationEnv
): Promise<VerificationLookupOutcome> {
  const headers = await firestoreAdminAuthHeader(env)
  if (!headers) return { kind: 'not_found' }

  const [cliDocs, reportDocs] = await Promise.all([
    runArtifactHashQuery('cliReports', artifactHash, headers, env),
    runArtifactHashQuery('reports', artifactHash, headers, env),
  ])
  // Both collections can contain a matching artifact (CLI/API scans write cliReports, browser
  // scans write reports) — merge and re-sort by scannedAt so "latest" is genuinely latest across
  // both, not just within whichever collection happened to be queried first.
  const all = [...cliDocs, ...reportDocs].sort((a, b) => (str(b.fields?.scannedAt) ?? '').localeCompare(str(a.fields?.scannedAt) ?? ''))

  if (callerUid) {
    const owned = all.find(d => str(d.fields?.uid) === callerUid)
    if (owned) return { kind: 'found', status: toStatusResponse(owned, artifactHash, 'private') }
  }

  const publicDoc = all.find(d => bool(d.fields?.isPublic))
  if (publicDoc) return { kind: 'found', status: toStatusResponse(publicDoc, artifactHash, 'public') }

  return { kind: 'not_found' }
}
