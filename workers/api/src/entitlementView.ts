import type { Finding, ScanResult } from '@agentverify/scanner'

/**
 * Server-side enforcement of the Pro remediation entitlement (v1.6).
 *
 * Free plans get every check, every finding, its evidence, severity, and "what is wrong / why it
 * matters" — but not the fix itself: `recommendedFix`, `quickFix`, and `fixCode` are removed here,
 * on the server, before the result is hashed, signed, saved, or returned. Hiding them only in the
 * UI would still ship them to the browser; this makes the paywall real.
 *
 * Order matters: callers apply this BEFORE computeReportHash / buildAttestationPayload /
 * saveReportToFirebase, so the stored report, its integrity hash, and any signed attestation all
 * describe exactly the evidence the caller received — no hash mismatch, nothing to "re-add" later.
 *
 * `fixLocked: true` marks a finding that has a fix the caller's plan does not include, so the UI
 * can say "Pro has the fix for this" (or, for a report made on Free and viewed after upgrading,
 * "re-scan to get the fix") without the fix itself ever being present.
 */

export type RemediationPlan = 'free' | 'pro'

export interface LockableFinding extends Finding {
  fixLocked?: boolean
}

const hasFix = (f: Finding) => Boolean((f.recommendedFix && f.recommendedFix.trim()) || f.quickFix || f.fixCode)

export function lockFindingFix(finding: Finding): LockableFinding {
  if (!hasFix(finding)) return finding
  const { quickFix: _quickFix, fixCode: _fixCode, ...rest } = finding
  return { ...rest, recommendedFix: '', fixLocked: true }
}

/** Returns a copy of the scan result with fixes removed when the plan does not include remediation. Pro results are returned unchanged. */
export function applyRemediationEntitlement<T extends ScanResult>(result: T, plan: RemediationPlan): T {
  if (plan === 'pro') return result
  return { ...result, findings: result.findings.map(lockFindingFix) }
}
