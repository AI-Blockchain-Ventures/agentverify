import {
  evaluatePolicyOnScanResult,
  BUILTIN_POLICIES,
  findPolicyById,
  evaluateAllPoliciesOnScanResult,
  type PolicyId,
  type PolicyProfile,
  type PolicyEvaluationResult,
} from '@/lib/policyEvaluation'
import type { StoredReport, ScanResult } from '@/types'

// Thin adapter only — the real policy catalog and evaluation logic live in
// apps/web/src/lib/policyEvaluation.ts (an independent, client-safe reimplementation of
// packages/scanner/src/policy.ts — see that file's own comment for why it's duplicated rather
// than imported). Re-exported here so existing imports of `@/lib/policies` keep working.
export { BUILTIN_POLICIES, findPolicyById, evaluateAllPoliciesOnScanResult }
export type { PolicyId, PolicyProfile, PolicyEvaluationResult }

const findingsOf = (r: StoredReport) => (Array.isArray(r.findings) ? r.findings : Array.isArray(r.result?.findings) ? r.result.findings : []) as ScanResult['findings']
const controlsOf = (r: StoredReport) => (r.securityControlsDetected ?? r.result?.securityControlsDetected ?? []) as ScanResult['securityControlsDetected']

/**
 * Adapts a StoredReport (Firestore doc shape, sometimes evidence-nested under `.result` for
 * legacy CLI-saved records) into the minimal shape evaluatePolicyOnScanResult needs.
 */
export function evaluatePolicy(report: StoredReport, policy: PolicyProfile): PolicyEvaluationResult {
  const pseudoResult = { findings: findingsOf(report), securityControlsDetected: controlsOf(report) }
  return evaluatePolicyOnScanResult(pseudoResult, policy)
}
