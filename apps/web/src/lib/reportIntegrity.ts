/**
 * Independent, client-side report-hash verification — deliberately NOT imported from
 * @agentverify/scanner. Same reasoning as verifyAttestation.ts: importing anything from the
 * scanner package's single bundled entry point pulls the whole detection engine into the client
 * bundle, even though this specific function (a SHA-256 hash over already-computed evidence
 * fields, no detection logic) is itself completely self-contained and safe to run in a browser.
 * Logic mirrored from packages/scanner/src/reportIntegrity.ts — keep in sync if that changes.
 */
import type { ScanResult } from '@/types'

export interface ReportIntegrity {
  reportHash: string
  algorithm: 'SHA-256'
  schemaVersion: string
  scannerVersion: string
  scanId: string
  timestamp: string
}

const CANONICAL_FIELDS = [
  'schemaVersion', 'reportId', 'verdict', 'riskScore', 'riskLevel', 'confidence', 'optimizationScore',
  'reportInsights', 'threatCategories', 'findings', 'categoryScores', 'securityCategories',
  'capabilities', 'mcpExposures', 'capabilityChains', 'a2spaStatus', 'securityControlsDetected',
  'notDetermined', 'bom', 'metadata',
] as const

type CanonicalValue = string | number | boolean | null | CanonicalValue[] | { [key: string]: CanonicalValue }

function canonicalizeForHash(value: unknown): CanonicalValue {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value.map(canonicalizeForHash)
  if (typeof value === 'object') {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort()
    const out: { [key: string]: CanonicalValue } = {}
    for (const key of sortedKeys) out[key] = canonicalizeForHash((value as Record<string, unknown>)[key])
    return out
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return String(value)
}

function evidenceSubset(result: ScanResult): Record<string, unknown> {
  const subset: Record<string, unknown> = {}
  for (const key of CANONICAL_FIELDS) subset[key] = (result as unknown as Record<string, unknown>)[key]
  return subset
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function canonicalJson(result: ScanResult): string {
  return JSON.stringify(canonicalizeForHash(evidenceSubset(result)))
}

export async function computeReportHash(result: ScanResult): Promise<ReportIntegrity> {
  const hash = await sha256Hex(canonicalJson(result))
  return {
    reportHash: hash,
    algorithm: 'SHA-256',
    schemaVersion: result.schemaVersion,
    scannerVersion: result.metadata.scannerVersion,
    scanId: result.reportId,
    timestamp: result.metadata.scannedAt,
  }
}
