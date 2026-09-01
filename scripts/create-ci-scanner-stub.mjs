import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

if (existsSync('packages/scanner/package.json')) process.exit(0)

mkdirSync('packages/scanner/src', { recursive: true })
mkdirSync('packages/scanner/dist', { recursive: true })

writeFileSync('packages/scanner/package.json', `${JSON.stringify({
  name: '@agentverify/scanner',
  version: '1.4.0',
  private: true,
  type: 'module',
  main: './dist/index.js',
  module: './dist/index.js',
  types: './dist/index.d.ts',
  scripts: {
    build: 'node -e "console.log(\'CI scanner stub: no private scanner build\')"',
    test: 'node -e "console.log(\'CI scanner stub: private scanner tests run outside public CI\')"',
  },
}, null, 2)}\n`)

const types = `export type Verdict = 'VERIFIED' | 'NOT_VERIFIED' | 'NOT_ASSESSED'
export type RiskLevel = 'Low Risk' | 'Moderate Risk' | 'High Risk'
export type Category = 'A' | 'B'
export type Severity = 'critical' | 'high' | 'medium' | 'low'
export type ThreatCategoryStatus = 'detected' | 'possible' | 'missing_evidence' | 'not_assessed'
export type EvidenceType = 'definite' | 'heuristic' | 'informational'
export type SecurityCategoryId = 'identity' | 'permissions' | 'tools' | 'mcp' | 'execution-authorization' | 'secrets' | 'runtime' | 'network' | 'dependencies' | 'auditability' | 'human-oversight'
export type A2spaStatus = 'detected' | 'partially_detected' | 'not_detected' | 'cannot_determine'

export interface ScanInput {
  content: string
  fileName?: string
  fileSize?: number
  platform?: string
}

export interface CategoryScore {
  category: Category
  label: string
  score: number
  maxScore: number
  findingCount: number
}

export interface SecurityCategoryStatus {
  id: SecurityCategoryId
  label: string
  findingCount: number
  highestSeverity: Severity | null
  status: 'strong' | 'needs_attention' | 'critical' | 'not_assessed'
}

export interface AgentCapability {
  id: string
  label: string
  evidence: string
  confidence: EvidenceType
}

export interface McpToolExposure {
  toolName: string
  server: string | null
  potentialActions: string[]
  riskLevel: Severity
  evidence: string
}

export interface CapabilityChain {
  id: string
  title: string
  capabilityIds: string[]
  impact: string
  severity: Severity
}

export interface SecurityControl {
  id: string
  label: string
  evidence: string
}

export interface Finding {
  id: string
  code: string
  title: string
  category: Category
  severity: Severity
  whatIsWrong: string
  whyItMatters: string
  recommendedFix: string
  evidence?: string
  quickFix?: string
  fixCode?: string
  line?: number
  capabilityImpact?: string
  evidenceType?: EvidenceType
  securityCategory?: SecurityCategoryId
  compliance?: {
    owasp?: string[]
    nist?: string[]
    soc2?: string[]
  }
}

export interface RuntimeBOM {
  detectedLanguage: string
  detectedFramework: string | null
  detectedPlatform: string | null
  agentName: string | null
  toolAccessLevel: 'Restricted' | 'Unrestricted' | 'Unknown'
  credentialExposure: 'Detected' | 'Not Detected'
  memoryPersistence: 'Bounded' | 'Unbounded' | 'Unknown'
  auditLogging: 'Present' | 'Absent' | 'Unknown'
  humanGates: 'Present' | 'Absent' | 'Unknown'
  rateLimiting: 'Present' | 'Absent' | 'Unknown'
  promptInjectionSurface: 'Detected' | 'Not Detected' | 'Unknown'
  delegationScope: 'Scoped' | 'Unscoped' | 'Unknown'
}

export interface ThreatCategoryAssessment {
  id: string
  label: string
  status: ThreatCategoryStatus
  severity: Severity
  whatItMeans: string
  evidencePattern: string
  whyItMatters: string
  recommendedFix: string
  a2spaImpact: string
}

export interface FixPriorityItem {
  code: string
  title: string
  severity: Severity
  priority: 'fix_first' | 'fix_next' | 'nice_to_have'
  reason: string
}

export interface ScoreDeduction {
  reason: string
  points: number
}

export interface ScoreFormula {
  startingScore: number
  deductions: ScoreDeduction[]
  cappedAt: number | null
  cappedReason: string | null
  finalScore: number
}

export interface ReportInsights {
  executionReadinessScore: number
  a2spaReadinessScore: number
  remediationProgressScore: number
  topBlocker: string | null
  nextAction: string
  scoreExplanation: string[]
  improvesScore: string[]
  verificationBlockers: string[]
  fixPriority: FixPriorityItem[]
  scoreFormula: ScoreFormula
  highestRisks: string[]
  canWait: string[]
}

export interface ScanResult {
  schemaVersion: string
  reportId: string
  verdict: Verdict
  riskScore: number
  riskLevel: RiskLevel
  confidence: number
  optimizationScore: number
  reportInsights: ReportInsights
  threatCategories: ThreatCategoryAssessment[]
  findings: Finding[]
  categoryScores: CategoryScore[]
  securityCategories: SecurityCategoryStatus[]
  capabilities: AgentCapability[]
  mcpExposures: McpToolExposure[]
  capabilityChains: CapabilityChain[]
  a2spaStatus: A2spaStatus
  securityControlsDetected: SecurityControl[]
  notDetermined: string[]
  bom: RuntimeBOM
  metadata: {
    schemaVersion: string
    scannerVersion: string
    fileName: string
    fileSize: number
    scannedAt: string
    detectedLanguage: string
    detectedFramework: string | null
    selectedPlatform: string | null
    agentName: string | null
    scanDuration: number
  }
}

// --- Verification catalog / taxonomy / integrity stubs (type-compatible, empty/no-op) ---

export type CheckStatus = 'implemented' | 'planned'
export type DetectionType = 'pattern-match' | 'absence-of-pattern' | 'contextual-heuristic'

export interface VerificationCheck {
  id: string
  code: string
  isFamily: boolean
  name: string
  category: SecurityCategoryId
  description: string
  severity: Severity
  detectionType: DetectionType
  evidenceType: EvidenceType
  supportedContent: string
  whatItDetects: string
  whyItMatters: string
  remediation: string
  testCovered?: boolean
  status: CheckStatus
}

export type RiskFamilyId = 'identity-access' | 'tools-capabilities' | 'execution-security' | 'secrets-data' | 'runtime-network' | 'supply-chain' | 'oversight-auditability'

export interface RiskFamily {
  id: RiskFamilyId
  label: string
  description: string
  categories: SecurityCategoryId[]
}

export interface ReportIntegrity {
  reportHash: string
  algorithm: 'SHA-256'
  schemaVersion: string
  scannerVersion: string
  scanId: string
  timestamp: string
}

export interface ArtifactFingerprint {
  artifactHash: string
  artifactHashAlgorithm: 'SHA-256'
  artifactFingerprintVersion: '1.0.0'
}

export interface AttestationPayload {
  attestationVersion: string
  artifactHash: string
  artifactHashAlgorithm: string
  artifactFingerprintVersion: string
  scanId: string
  reportHash: string
  verdict: string
  score: number
  policyProfile?: string
  policyResult?: 'PASS' | 'FAIL'
  scannerVersion: string
  rulesetVersion: string
  schemaVersion: string
  issuedAt: string
  issuer: string
}

export interface BuildAttestationPayloadInput {
  artifactHash: string
  artifactHashAlgorithm: string
  artifactFingerprintVersion: string
  scanId: string
  reportHash: string
  verdict: string
  score: number
  policyProfile?: string
  policyResult?: 'PASS' | 'FAIL'
  scannerVersion: string
  schemaVersion: string
  issuer: string
  issuedAt?: string
}

export type AttestationAlgorithm = 'ECDSA-P256-SHA256'

export interface SignedAttestation {
  payload: AttestationPayload
  signature: string
  algorithm: AttestationAlgorithm
  publicKey: JsonWebKey
}

export type AttestationVerificationStatus = 'VALID' | 'INVALID_SIGNATURE' | 'MALFORMED' | 'UNSUPPORTED_VERSION'

export interface AttestationVerificationResult {
  status: AttestationVerificationStatus
  reason?: string
}

export type PolicyId = 'standard' | 'high-security' | 'financial-agent' | 'production-infrastructure'

export interface PolicyProfile {
  id: PolicyId
  name: string
  description: string
  maxAllowedSeverity: Severity
  requiredControlIds: string[]
  forbiddenFindingCodes: string[]
  requirements: string[]
}

export interface PolicyEvaluationResult {
  policy: PolicyProfile
  pass: boolean
  reasons: string[]
}
`

const implementation = `export function scan(input: ScanInput): ScanResult {
  const emptyFormula: ScoreFormula = { startingScore: 100, deductions: [], cappedAt: null, cappedReason: null, finalScore: 0 }
  return {
    schemaVersion: '1.3.0',
    reportId: 'REPORT-CI-STUB',
    verdict: 'NOT_ASSESSED',
    riskScore: 0,
    riskLevel: 'High Risk',
    confidence: 0,
    optimizationScore: 0,
    reportInsights: {
      executionReadinessScore: 0, a2spaReadinessScore: 0, remediationProgressScore: 0,
      topBlocker: null, nextAction: '', scoreExplanation: [], improvesScore: [], verificationBlockers: [],
      fixPriority: [], scoreFormula: emptyFormula, highestRisks: [], canWait: [],
    },
    threatCategories: [],
    findings: [],
    categoryScores: [],
    securityCategories: [],
    capabilities: [],
    mcpExposures: [],
    capabilityChains: [],
    a2spaStatus: 'cannot_determine',
    securityControlsDetected: [],
    notDetermined: ['CI scanner stub — no real analysis was performed.'],
    bom: {
      detectedLanguage: 'Unknown', detectedFramework: null, detectedPlatform: input.platform || null, agentName: null,
      toolAccessLevel: 'Unknown', credentialExposure: 'Not Detected', memoryPersistence: 'Unknown',
      auditLogging: 'Unknown', humanGates: 'Unknown', rateLimiting: 'Unknown',
      promptInjectionSurface: 'Unknown', delegationScope: 'Unknown',
    },
    metadata: {
      schemaVersion: '1.3.0',
      scannerVersion: 'ci-stub',
      fileName: input.fileName || 'agent.txt',
      fileSize: input.fileSize || input.content.length,
      scannedAt: new Date().toISOString(),
      detectedLanguage: 'Unknown',
      detectedFramework: null,
      selectedPlatform: input.platform || null,
      agentName: null,
      scanDuration: 0,
    },
  }
}

export const VERIFICATION_CATALOG: VerificationCheck[] = []
export const META_FINDING_CODES: readonly string[] = ['CONTENT_TRUNCATED_FOR_SCAN', 'INSUFFICIENT_EXECUTION_CONTEXT']
export const CAPABILITY_DETECTOR_COUNT = 0
export const MCP_TOOL_CLASSIFIER_COUNT = 0
export const CAPABILITY_CHAIN_RULE_COUNT = 0
export const THREAT_CATEGORY_COUNT = 0
export const SECURITY_CATEGORY_COUNT = 11
export function catalogSummary() {
  return { totalImplemented: 0, totalPlanned: 0, byCategory: {}, capabilityDetectors: 0, mcpToolClassifiers: 0, capabilityChainRules: 0, threatCategories: 0, securityCategories: 11 }
}

export const RISK_TAXONOMY: RiskFamily[] = []
export function familyFor(_category: SecurityCategoryId): RiskFamilyId {
  return 'runtime-network'
}

// Real, faithful implementation — NOT proprietary. Recursive key-sort canonicalization is a pure,
// public function (also independently reimplemented client-side at apps/web/src/lib/
// verifyAttestation.ts for the same reason: it's part of the public verification contract, safe
// to run anywhere, and must stay byte-identical to packages/scanner/src/reportIntegrity.ts's
// canonicalizeForHash for signatures produced by the real signing key to verify correctly here.
export function canonicalizeForHash(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value.map(canonicalizeForHash)
  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalizeForHash((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return String(value)
}
export async function computeReportHash(result: ScanResult): Promise<ReportIntegrity> {
  return { reportHash: '0'.repeat(64), algorithm: 'SHA-256', schemaVersion: result.schemaVersion, scannerVersion: result.metadata.scannerVersion, scanId: result.reportId, timestamp: result.metadata.scannedAt }
}
export async function verifyReportHash(_result: ScanResult, expectedHash: string): Promise<{ valid: boolean; recomputedHash: string }> {
  return { valid: false, recomputedHash: expectedHash }
}
export async function computeArtifactFingerprint(_content: string): Promise<ArtifactFingerprint> {
  return { artifactHash: '0'.repeat(64), artifactHashAlgorithm: 'SHA-256', artifactFingerprintVersion: '1.0.0' }
}
export const ATTESTATION_VERSION = '1.0.0'
export function buildAttestationPayload(input: BuildAttestationPayloadInput): AttestationPayload {
  const payload: AttestationPayload = {
    attestationVersion: '1.0.0', artifactHash: input.artifactHash, artifactHashAlgorithm: input.artifactHashAlgorithm,
    artifactFingerprintVersion: input.artifactFingerprintVersion, scanId: input.scanId, reportHash: input.reportHash,
    verdict: input.verdict, score: input.score, scannerVersion: input.scannerVersion, rulesetVersion: input.scannerVersion,
    schemaVersion: input.schemaVersion, issuedAt: input.issuedAt ?? new Date().toISOString(), issuer: input.issuer,
  }
  if (input.policyProfile !== undefined) payload.policyProfile = input.policyProfile
  if (input.policyResult !== undefined) payload.policyResult = input.policyResult
  return payload
}
// Real implementation — the exact string that gets signed / whose signature gets verified. Must
// match packages/scanner/src/attestation.ts's canonicalAttestationJson exactly: both the real
// module and this stub call the SAME canonicalizeForHash shape, over the SAME payload fields.
export function canonicalAttestationJson(payload: AttestationPayload): string {
  return JSON.stringify(canonicalizeForHash(payload))
}
const REQUIRED_ATTESTATION_PAYLOAD_FIELDS = [
  'attestationVersion', 'artifactHash', 'artifactHashAlgorithm', 'artifactFingerprintVersion',
  'scanId', 'reportHash', 'verdict', 'score', 'scannerVersion', 'rulesetVersion', 'schemaVersion',
  'issuedAt', 'issuer',
] as const
function isWellFormedAttestation(signed: unknown): signed is SignedAttestation {
  if (typeof signed !== 'object' || signed === null) return false
  const s = signed as Record<string, unknown>
  if (typeof s.signature !== 'string' || s.signature.length === 0) return false
  if (s.algorithm !== 'ECDSA-P256-SHA256') return false
  if (typeof s.publicKey !== 'object' || s.publicKey === null) return false
  if (typeof s.payload !== 'object' || s.payload === null) return false
  const payload = s.payload as Record<string, unknown>
  return REQUIRED_ATTESTATION_PAYLOAD_FIELDS.every(field => payload[field] !== undefined && payload[field] !== null)
}
function base64ToBytesForVerify(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}
// Real ECDSA P-256 / SHA-256 (ES256) signature verification via the standard Web Crypto API —
// this is the PUBLIC verification contract (a viewer or third party verifies a signed attestation
// against its own embedded public key, exactly as documented at
// docs/private-scanner-boundary.md), not proprietary detection logic. It never signs anything and
// never touches a private key. Byte-identical algorithm to packages/scanner/src/attestation.ts's
// verifyAttestation and its independent client-side port at
// apps/web/src/lib/verifyAttestation.ts.
export async function verifyAttestation(signed: unknown, expectedPublicKey?: JsonWebKey): Promise<AttestationVerificationResult> {
  if (!isWellFormedAttestation(signed)) {
    return { status: 'MALFORMED', reason: 'Attestation is missing required fields or has an unrecognized shape.' }
  }
  if (signed.payload.attestationVersion !== ATTESTATION_VERSION) {
    return { status: 'UNSUPPORTED_VERSION', reason: \`This verifier supports attestationVersion \${ATTESTATION_VERSION}, got \${signed.payload.attestationVersion}.\` }
  }
  if (expectedPublicKey && JSON.stringify(canonicalizeForHash(expectedPublicKey)) !== JSON.stringify(canonicalizeForHash(signed.publicKey))) {
    return { status: 'INVALID_SIGNATURE', reason: 'The embedded public key does not match the expected Agent Verify signing key.' }
  }
  try {
    const key = await crypto.subtle.importKey('jwk', signed.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    const signatureBytes = base64ToBytesForVerify(signed.signature)
    const dataBytes = new TextEncoder().encode(canonicalAttestationJson(signed.payload))
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signatureBytes as BufferSource, dataBytes as BufferSource)
    return valid ? { status: 'VALID' } : { status: 'INVALID_SIGNATURE', reason: 'Signature does not match the payload under the embedded public key.' }
  } catch {
    return { status: 'MALFORMED', reason: 'Public key or signature could not be parsed.' }
  }
}
// Real, faithful port of packages/scanner/src/policy.ts's built-in policy definitions and pure
// evaluator — NOT proprietary. Policy evaluation consumes already-produced scan evidence
// (findings, securityControlsDetected) and decides pass/fail against public, documented
// thresholds; it never determines HOW the private engine discovers that evidence. Identical to
// the independent client-side port at apps/web/src/lib/policyEvaluation.ts, for the same "safe
// to run anywhere, keep in sync by hand" reasoning documented there. Do not add, remove, or
// change policy ids/requirements here independently of packages/scanner/src/policy.ts.
const POLICY_SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }
const POLICY_CONTROL_LABELS: Record<string, string> = {
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
export function evaluatePolicy(result: ScanResult, policy: PolicyProfile): PolicyEvaluationResult {
  const findings = result.findings ?? []
  const controlIds = new Set((result.securityControlsDetected ?? []).map(c => c.id).filter(Boolean))
  const reasons: string[] = []
  const maxRank = POLICY_SEVERITY_RANK[policy.maxAllowedSeverity]
  for (const f of findings) {
    const rank = f.severity ? POLICY_SEVERITY_RANK[f.severity] : undefined
    if (rank !== undefined && rank >= maxRank) {
      reasons.push(\`\${f.title ?? f.code ?? 'Finding'} (\${f.severity}) exceeds this policy's maximum allowed severity.\`)
    }
    if (f.code && policy.forbiddenFindingCodes.includes(f.code)) {
      reasons.push(\`\${f.title ?? f.code} is explicitly forbidden by this policy.\`)
    }
  }
  for (const controlId of policy.requiredControlIds) {
    if (!controlIds.has(controlId)) {
      reasons.push(\`No detected evidence of \${POLICY_CONTROL_LABELS[controlId] ?? controlId}.\`)
    }
  }
  return { policy, pass: reasons.length === 0, reasons }
}
export function evaluateAllPolicies(result: ScanResult): PolicyEvaluationResult[] {
  return BUILTIN_POLICIES.map(p => evaluatePolicy(result, p))
}
`

// dist/index.d.ts needs `scan`'s signature as a declaration (`;`), not a body — everything else
// in `implementation` is already declaration-shaped (const/function with a body is valid inside
// a .d.ts only for functions with inferable bodies, but to keep this simple and correct we just
// swap the one function that has a full statement body for its ambient declaration form).
const scanDeclaration = 'export function scan(input: ScanInput): ScanResult;\n'
const dtsImplementation = implementation.replace(
  /export function scan\(input: ScanInput\): ScanResult \{[\s\S]*?\n\}\n\n/,
  scanDeclaration
)

// dist/index.js is executed directly by Node with no TypeScript stripping available at the point
// this script runs in CI (it runs BEFORE `npm ci`, so no bundler/transpiler dependency is
// available yet) — so this is hand-written plain JS, not derived from the TS strings above via
// string replacement. Keeping it as its own literal avoids the fragility of regex-stripping types
// out of an evolving TS string (a single missed annotation breaks the whole public CI pipeline).
const jsImplementation = `export function scan(input) {
  const emptyFormula = { startingScore: 100, deductions: [], cappedAt: null, cappedReason: null, finalScore: 0 }
  return {
    schemaVersion: '1.3.0',
    reportId: 'REPORT-CI-STUB',
    verdict: 'NOT_ASSESSED',
    riskScore: 0,
    riskLevel: 'High Risk',
    confidence: 0,
    optimizationScore: 0,
    reportInsights: {
      executionReadinessScore: 0, a2spaReadinessScore: 0, remediationProgressScore: 0,
      topBlocker: null, nextAction: '', scoreExplanation: [], improvesScore: [], verificationBlockers: [],
      fixPriority: [], scoreFormula: emptyFormula, highestRisks: [], canWait: [],
    },
    threatCategories: [],
    findings: [],
    categoryScores: [],
    securityCategories: [],
    capabilities: [],
    mcpExposures: [],
    capabilityChains: [],
    a2spaStatus: 'cannot_determine',
    securityControlsDetected: [],
    notDetermined: ['CI scanner stub — no real analysis was performed.'],
    bom: {
      detectedLanguage: 'Unknown', detectedFramework: null, detectedPlatform: input.platform || null, agentName: null,
      toolAccessLevel: 'Unknown', credentialExposure: 'Not Detected', memoryPersistence: 'Unknown',
      auditLogging: 'Unknown', humanGates: 'Unknown', rateLimiting: 'Unknown',
      promptInjectionSurface: 'Unknown', delegationScope: 'Unknown',
    },
    metadata: {
      schemaVersion: '1.3.0',
      scannerVersion: 'ci-stub',
      fileName: input.fileName || 'agent.txt',
      fileSize: input.fileSize || input.content.length,
      scannedAt: new Date().toISOString(),
      detectedLanguage: 'Unknown',
      detectedFramework: null,
      selectedPlatform: input.platform || null,
      agentName: null,
      scanDuration: 0,
    },
  }
}

export const VERIFICATION_CATALOG = []
export const META_FINDING_CODES = ['CONTENT_TRUNCATED_FOR_SCAN', 'INSUFFICIENT_EXECUTION_CONTEXT']
export const CAPABILITY_DETECTOR_COUNT = 0
export const MCP_TOOL_CLASSIFIER_COUNT = 0
export const CAPABILITY_CHAIN_RULE_COUNT = 0
export const THREAT_CATEGORY_COUNT = 0
export const SECURITY_CATEGORY_COUNT = 11
export function catalogSummary() {
  return { totalImplemented: 0, totalPlanned: 0, byCategory: {}, capabilityDetectors: 0, mcpToolClassifiers: 0, capabilityChainRules: 0, threatCategories: 0, securityCategories: 11 }
}

export const RISK_TAXONOMY = []
export function familyFor(_category) {
  return 'runtime-network'
}

export function canonicalizeForHash(value) {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value.map(canonicalizeForHash)
  if (typeof value === 'object') {
    const sorted = {}
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalizeForHash(value[key])
    return sorted
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return String(value)
}
export async function computeReportHash(result) {
  return { reportHash: '0'.repeat(64), algorithm: 'SHA-256', schemaVersion: result.schemaVersion, scannerVersion: result.metadata.scannerVersion, scanId: result.reportId, timestamp: result.metadata.scannedAt }
}
export async function verifyReportHash(_result, expectedHash) {
  return { valid: false, recomputedHash: expectedHash }
}
export async function computeArtifactFingerprint(_content) {
  return { artifactHash: '0'.repeat(64), artifactHashAlgorithm: 'SHA-256', artifactFingerprintVersion: '1.0.0' }
}
export const ATTESTATION_VERSION = '1.0.0'
export function buildAttestationPayload(input) {
  const payload = {
    attestationVersion: '1.0.0', artifactHash: input.artifactHash, artifactHashAlgorithm: input.artifactHashAlgorithm,
    artifactFingerprintVersion: input.artifactFingerprintVersion, scanId: input.scanId, reportHash: input.reportHash,
    verdict: input.verdict, score: input.score, scannerVersion: input.scannerVersion, rulesetVersion: input.scannerVersion,
    schemaVersion: input.schemaVersion, issuedAt: input.issuedAt ?? new Date().toISOString(), issuer: input.issuer,
  }
  if (input.policyProfile !== undefined) payload.policyProfile = input.policyProfile
  if (input.policyResult !== undefined) payload.policyResult = input.policyResult
  return payload
}
export function canonicalAttestationJson(payload) {
  return JSON.stringify(canonicalizeForHash(payload))
}
const REQUIRED_ATTESTATION_PAYLOAD_FIELDS = [
  'attestationVersion', 'artifactHash', 'artifactHashAlgorithm', 'artifactFingerprintVersion',
  'scanId', 'reportHash', 'verdict', 'score', 'scannerVersion', 'rulesetVersion', 'schemaVersion',
  'issuedAt', 'issuer',
]
function isWellFormedAttestation(signed) {
  if (typeof signed !== 'object' || signed === null) return false
  if (typeof signed.signature !== 'string' || signed.signature.length === 0) return false
  if (signed.algorithm !== 'ECDSA-P256-SHA256') return false
  if (typeof signed.publicKey !== 'object' || signed.publicKey === null) return false
  if (typeof signed.payload !== 'object' || signed.payload === null) return false
  return REQUIRED_ATTESTATION_PAYLOAD_FIELDS.every(field => signed.payload[field] !== undefined && signed.payload[field] !== null)
}
function base64ToBytesForVerify(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}
// Real ECDSA P-256 / SHA-256 signature verification via the standard Web Crypto API — the PUBLIC
// verification contract (see docs/private-scanner-boundary.md), not proprietary detection logic.
// Never signs, never touches a private key. Byte-identical algorithm to
// packages/scanner/src/attestation.ts's verifyAttestation.
export async function verifyAttestation(signed, expectedPublicKey) {
  if (!isWellFormedAttestation(signed)) {
    return { status: 'MALFORMED', reason: 'Attestation is missing required fields or has an unrecognized shape.' }
  }
  if (signed.payload.attestationVersion !== ATTESTATION_VERSION) {
    return { status: 'UNSUPPORTED_VERSION', reason: 'This verifier supports attestationVersion ' + ATTESTATION_VERSION + ', got ' + signed.payload.attestationVersion + '.' }
  }
  if (expectedPublicKey && JSON.stringify(canonicalizeForHash(expectedPublicKey)) !== JSON.stringify(canonicalizeForHash(signed.publicKey))) {
    return { status: 'INVALID_SIGNATURE', reason: 'The embedded public key does not match the expected Agent Verify signing key.' }
  }
  try {
    const key = await crypto.subtle.importKey('jwk', signed.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    const signatureBytes = base64ToBytesForVerify(signed.signature)
    const dataBytes = new TextEncoder().encode(canonicalAttestationJson(signed.payload))
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signatureBytes, dataBytes)
    return valid ? { status: 'VALID' } : { status: 'INVALID_SIGNATURE', reason: 'Signature does not match the payload under the embedded public key.' }
  } catch {
    return { status: 'MALFORMED', reason: 'Public key or signature could not be parsed.' }
  }
}
// Real, faithful port of packages/scanner/src/policy.ts — public policy evaluation over
// already-produced scan evidence, not proprietary detection logic. See the matching comment in
// the TypeScript block above; must stay in sync with packages/scanner/src/policy.ts and
// apps/web/src/lib/policyEvaluation.ts.
const POLICY_SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 }
const POLICY_CONTROL_LABELS = {
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
export const BUILTIN_POLICIES = [
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
export function findPolicyById(id) {
  return BUILTIN_POLICIES.find(p => p.id === id)
}
export function evaluatePolicy(result, policy) {
  const findings = result.findings ?? []
  const controlIds = new Set((result.securityControlsDetected ?? []).map(c => c.id).filter(Boolean))
  const reasons = []
  const maxRank = POLICY_SEVERITY_RANK[policy.maxAllowedSeverity]
  for (const f of findings) {
    const rank = f.severity ? POLICY_SEVERITY_RANK[f.severity] : undefined
    if (rank !== undefined && rank >= maxRank) {
      reasons.push((f.title ?? f.code ?? 'Finding') + ' (' + f.severity + ') exceeds this policy\\'s maximum allowed severity.')
    }
    if (f.code && policy.forbiddenFindingCodes.includes(f.code)) {
      reasons.push((f.title ?? f.code) + ' is explicitly forbidden by this policy.')
    }
  }
  for (const controlId of policy.requiredControlIds) {
    if (!controlIds.has(controlId)) {
      reasons.push('No detected evidence of ' + (POLICY_CONTROL_LABELS[controlId] ?? controlId) + '.')
    }
  }
  return { policy, pass: reasons.length === 0, reasons }
}
export function evaluateAllPolicies(result) {
  return BUILTIN_POLICIES.map(p => evaluatePolicy(result, p))
}
`

writeFileSync('packages/scanner/src/index.ts', `${types}\n${implementation}`)
writeFileSync('packages/scanner/dist/index.d.ts', types + dtsImplementation)
writeFileSync('packages/scanner/dist/index.js', jsImplementation)
