/**
 * Independent, client-side policy evaluation — deliberately NOT imported from
 * @agentverify/scanner, even though packages/scanner/src/policy.ts is itself self-contained
 * (only imports types, no detection logic — it evaluates PASS/FAIL rules against a ScanResult's
 * ALREADY-COMPUTED findings/securityControlsDetected, never raw source). Same packaging reason
 * as verifyAttestation.ts/reportIntegrity.ts: importing anything from the scanner package's one
 * bundled entry point pulls the whole detection engine into the client bundle.
 *
 * This does mean policy definitions/evaluation now exist in two places (here and
 * packages/scanner/src/policy.ts, which the Worker/CLI path still uses) rather than one shared
 * implementation — a real, acknowledged drift risk the original code deliberately avoided. Kept
 * in sync by hand for now; the real fix is giving packages/scanner a second, minimal tsup entry
 * point for client-safe exports (attestation verification, report-hash canonicalization, policy
 * evaluation) so both sides import the same source without bundling the detection engine — a
 * build-tooling change to the proprietary package, flagged as a follow-up rather than done here.
 */

export type PolicyId = 'standard' | 'high-security' | 'financial-agent' | 'production-infrastructure'

export interface PolicyProfile {
  id: PolicyId
  name: string
  description: string
  maxAllowedSeverity: string
  requiredControlIds: string[]
  forbiddenFindingCodes: string[]
  requirements: string[]
}

export interface PolicyEvaluationResult {
  policy: PolicyProfile
  pass: boolean
  reasons: string[]
}

interface EvaluableFinding {
  title?: string
  code?: string
  severity?: string
}

interface EvaluableControl {
  id?: string
}

interface EvaluableScanResult {
  findings?: EvaluableFinding[]
  securityControlsDetected?: EvaluableControl[]
}

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }

const CONTROL_LABELS: Record<string, string> = {
  signature: 'cryptographic execution-signature verification',
  nonce: 'replay-protection (nonce) verification',
  fail_closed: 'fail-closed enforcement on verification failure',
  scoped_permissions: 'an explicit, non-wildcard permission scope',
  human_approval: 'a human approval gate before consequential actions',
  audit_logging: 'audit logging',
  rate_limiting: 'execution rate limiting',
  bounded_memory: 'bounded (non-indefinite) memory retention',
  prompt_sanitization: 'input sanitization near prompt assembly',
  scoped_delegation: 'scope-constrained delegation',
  https_only: 'HTTPS-only network calls',
}

export const BUILTIN_POLICIES: PolicyProfile[] = [
  {
    id: 'standard',
    name: 'Standard',
    description: 'A reasonable baseline for internal tools and low-stakes agents. Blocks critical findings only.',
    maxAllowedSeverity: 'critical',
    requiredControlIds: [],
    forbiddenFindingCodes: [],
    requirements: ['No critical-severity findings'],
  },
  {
    id: 'high-security',
    name: 'High Security',
    description: 'For agents with broad system access or sensitive data exposure. Blocks critical and high findings, and requires visible execution-authorization and audit controls.',
    maxAllowedSeverity: 'high',
    requiredControlIds: ['signature', 'audit_logging'],
    forbiddenFindingCodes: ['UNSAFE_EVAL_EXEC', 'COMMAND_INJECTION_RISK', 'PRIVILEGED_CONTAINER_CONFIG'],
    requirements: [
      'No critical or high-severity findings',
      'Cryptographic execution-signature verification detected',
      'Audit logging detected',
      'No dynamic code execution, command injection risk, or privileged container configuration',
    ],
  },
  {
    id: 'financial-agent',
    name: 'Financial Agent',
    description: 'For agents that can move money, touch payment systems, or access financial records. The strictest built-in profile.',
    maxAllowedSeverity: 'high',
    requiredControlIds: ['signature', 'human_approval', 'audit_logging', 'scoped_permissions'],
    forbiddenFindingCodes: ['HARDCODED_CREDENTIALS'],
    requirements: [
      'No critical or high-severity findings',
      'Cryptographic execution-signature verification detected',
      'Human approval gate detected before consequential actions',
      'Audit logging detected',
      'An explicit, scoped (non-wildcard) permission declaration detected',
      'No hardcoded credentials',
    ],
  },
  {
    id: 'production-infrastructure',
    name: 'Production Infrastructure',
    description: 'For agents with shell, deployment, or infrastructure-level access. Focused on execution boundaries and supply-chain integrity.',
    maxAllowedSeverity: 'high',
    requiredControlIds: ['signature', 'fail_closed'],
    forbiddenFindingCodes: ['COMMAND_INJECTION_RISK', 'UNSAFE_EVAL_EXEC', 'PRIVILEGED_CONTAINER_CONFIG', 'SUPPLY_CHAIN_RISK'],
    requirements: [
      'No critical or high-severity findings',
      'No command injection risk or unsafe dynamic code execution',
      'No privileged/host-mounted container configuration',
      'No unpinned or remote-install supply-chain risk',
      'Execution-signature verification and fail-closed enforcement detected',
    ],
  },
]

export function findPolicyById(id: string): PolicyProfile | undefined {
  return BUILTIN_POLICIES.find(p => p.id === id)
}

export function evaluatePolicyOnScanResult(result: EvaluableScanResult, policy: PolicyProfile): PolicyEvaluationResult {
  const findings = result.findings ?? []
  const controlIds = new Set((result.securityControlsDetected ?? []).map(c => c.id).filter(Boolean))
  const reasons: string[] = []
  const maxRank = SEVERITY_RANK[policy.maxAllowedSeverity]

  for (const f of findings) {
    const rank = f.severity ? SEVERITY_RANK[f.severity] : undefined
    if (rank !== undefined && rank >= maxRank) {
      reasons.push(`${f.title ?? f.code ?? 'Finding'} (${f.severity}) exceeds this policy's maximum allowed severity.`)
    }
    if (f.code && policy.forbiddenFindingCodes.includes(f.code)) {
      reasons.push(`${f.title ?? f.code} is explicitly forbidden by this policy.`)
    }
  }

  for (const controlId of policy.requiredControlIds) {
    if (!controlIds.has(controlId)) {
      reasons.push(`No detected evidence of ${CONTROL_LABELS[controlId] ?? controlId}.`)
    }
  }

  return { policy, pass: reasons.length === 0, reasons }
}

export function evaluateAllPoliciesOnScanResult(result: EvaluableScanResult): PolicyEvaluationResult[] {
  return BUILTIN_POLICIES.map(p => evaluatePolicyOnScanResult(result, p))
}
