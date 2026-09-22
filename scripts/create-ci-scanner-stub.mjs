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

// Skill-package assessment types (type-compatible with the private scanner's public exports; the stub
// performs no analysis). The Worker treats the assessment as an opaque, frozen object.
export interface SkillPackageFileInput {
  path: string
  content: string
  kind?: 'file' | 'directory' | 'symlink' | 'hardlink' | 'other'
}

export interface SkillPackageRejection {
  code: string
  message: string
  path?: string
}

export interface SkillAstAssessment {
  schemaVersion: '1.1.0'
  profile: {
    profileId: string
    framework: string
    upstreamRepo: string
    upstreamCommit: string
    upstreamStatus: string
    upstreamLicense: string
    agentverifyProfileVersion: string
    implementedControls: readonly string[]
    scannerVersion: string
    assessmentEngineVersion: string
    riskRubricVersion: string
    keyAllowlistVersion: string
    normalizationVersion: string
  }
  controls: unknown[]
  evidence: unknown[]
  notImplementedControls: string[]
  unmappedEvidenceIds: string[]
  package: { digest: string; fileCount: number; manifestFiles: string[] }
  notes: string[]
}

export type SkillAstAssessmentResult =
  | { ok: true; assessment: SkillAstAssessment; normalized: unknown }
  | { ok: false; rejection: SkillPackageRejection }

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

// Stub: performs NO analysis. Returns a well-formed, empty assessment so public CI can build and typecheck the
// Worker's profile plumbing. Tests that need real findings run only where the private scanner is present.
export const SKILL_ASSESSMENT_SCHEMA_VERSION = '1.1.0'
export async function assessSkillPackageAst(files: SkillPackageFileInput[]): Promise<SkillAstAssessmentResult> {
  return {
    ok: true,
    normalized: null,
    assessment: {
      schemaVersion: '1.1.0',
      profile: { profileId: 'owasp-agentic-skills-2026', framework: 'OWASP_AGENTIC_SKILLS_TOP_10', upstreamRepo: 'ci-stub', upstreamCommit: '0'.repeat(40), upstreamStatus: 'ci-stub', upstreamLicense: 'ci-stub', agentverifyProfileVersion: 'ci-stub', implementedControls: [], scannerVersion: 'ci-stub', assessmentEngineVersion: 'ci-stub', riskRubricVersion: 'ci-stub', keyAllowlistVersion: 'ci-stub', normalizationVersion: 'ci-stub' },
      controls: [],
      evidence: [],
      notImplementedControls: [],
      unmappedEvidenceIds: [],
      package: { digest: 'ci-stub', fileCount: files.length, manifestFiles: [] },
      notes: ['CI scanner stub — no real analysis was performed.'],
    },
  }
}

// ── Profile-attestation verification logic (NOT proprietary — a faithful, hand-maintained flattened port of
// packages/scanner/src/profileAttestation.ts, itself a port of conformance/v4/reference/*.mjs). Unlike
// assessSkillPackageAst above, this is safe and correct to include here in full: it contains no detection
// logic, no scanning heuristics, nothing that needs to stay private. It exists in the CI stub so that
// workers/api/src/profileAttestationSigning.ts — which imports these exact names from '@agentverify/scanner' —
// typechecks and runs correctly in public CI, where the private scanner package is absent. If the real
// packages/scanner/src/profileAttestation.ts ever changes these algorithms, this block must be kept in sync by
// hand (there is no build step that derives one from the other) — packages/scanner/test/profileAttestationPort.test.mjs
// (private, not run in public CI) is what keeps the REAL module honest against conformance/v4; this CI-stub
// copy only needs to satisfy this repo's OWN Worker-side tests, not byte-for-byte parity with the reference.
export const PROFILE_ATTESTATION_TYPE = 'agentverify.profile-assessment'
export const PROFILE_ATTESTATION_VERSION = '1.0.0'
export const PROFILE_BUNDLE_VERSION = '1.0.0'
export const PROFILE_PAYLOAD_TAG = 'agentverify-attestation/profile-assessment/v1\\n'
export const PROFILE_KEY_PURPOSE = 'agentverify-profile-v1'
export const PROFILE_ASSESSMENT_TAG = 'agentverify-assessment-digest/v1\\n'
export const PROFILE_ATTESTATION_ALGORITHM = 'ECDSA-P256-SHA256'
export const PROFILE_ASSESSMENT_SCHEMA_VERSION = '1.1.0'
export const INTERPRETATION_VERSION_KEYS = ['scannerVersion', 'assessmentEngineVersion', 'riskRubricVersion', 'keyAllowlistVersion', 'normalizationVersion']
export const PROFILE_PAYLOAD_BASE_DEPTH = 2
const PROFILE_ASSESSMENT_BASE_DEPTH = 1
const PROFILE_MAX_JSON_DEPTH = 64

function profileNumberProblem(value: any) {
  if (typeof value !== 'number') return 'NOT_A_NUMBER'
  if (!Number.isFinite(value)) return 'NON_FINITE'
  if (Object.is(value, -0)) return 'NEGATIVE_ZERO'
  if (!Number.isInteger(value)) return 'NON_INTEGER'
  if (!Number.isSafeInteger(value)) return 'UNSAFE_INTEGER'
  return null
}

function profileIsWellFormedString(s: any) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1)
      if (n >= 0xdc00 && n <= 0xdfff) { i++; continue }
      return false
    }
    if (c >= 0xdc00 && c <= 0xdfff) return false
  }
  return true
}

function profileCanonicalizeSigned(value: any, baseDepth: any) {
  const stack = new Set()
  function ser(v: any, depth: any, where: any): string {
    if (v === null) return 'null'
    switch (typeof v) {
      case 'undefined': throw new Error('JCS_UNDEFINED: undefined at ' + where)
      case 'boolean': return v ? 'true' : 'false'
      case 'number': {
        if (!Number.isFinite(v)) throw new Error('JCS_NON_FINITE: non-finite number at ' + where)
        const problem = profileNumberProblem(v)
        if (problem !== null) throw new Error('JCS_NUMBER_NOT_ADMITTED: ' + problem + ' at ' + where)
        return String(v)
      }
      case 'string': {
        if (!profileIsWellFormedString(v)) throw new Error('JCS_ILL_FORMED_STRING: lone surrogate at ' + where)
        return JSON.stringify(v)
      }
      case 'function': case 'symbol': case 'bigint':
        throw new Error('JCS_UNSUPPORTED_TYPE: ' + typeof v + ' at ' + where)
      default: break
    }
    if (depth > PROFILE_MAX_JSON_DEPTH) throw new Error('JCS_TOO_DEEP: nesting deeper than ' + PROFILE_MAX_JSON_DEPTH + ' at ' + where)
    if (stack.has(v)) throw new Error('JCS_CYCLE: cycle at ' + where)
    stack.add(v)
    try {
      if (Array.isArray(v)) {
        if (Object.getPrototypeOf(v) !== Array.prototype) throw new Error('JCS_NOT_PLAIN: array subclass at ' + where)
        const keys = Reflect.ownKeys(v).filter(function(k: any) { return k !== 'length' })
        if (keys.length !== v.length || keys.some(function(k: any, idx: any) { return k !== String(idx) })) throw new Error('JCS_NOT_PLAIN: sparse array at ' + where)
        return '[' + v.map(function(item: any, idx: any) { return ser(item, depth + 1, where + '[' + idx + ']') }).join(',') + ']'
      }
      const proto = Object.getPrototypeOf(v)
      if (proto !== Object.prototype && proto !== null) throw new Error('JCS_NOT_PLAIN: non-plain object at ' + where)
      const own = Reflect.ownKeys(v)
      if (own.some(function(k: any) { return typeof k === 'symbol' })) throw new Error('JCS_NOT_PLAIN: symbol-keyed property at ' + where)
      const parts = []
      const sortedKeys = own.slice().sort()
      for (const key of sortedKeys) {
        const d = Object.getOwnPropertyDescriptor(v, key)
        if (!d || !d.enumerable || 'get' in d || 'set' in d) throw new Error('JCS_NOT_PLAIN: non-data property ' + JSON.stringify(key) + ' at ' + where)
        if (typeof key !== 'string' || !profileIsWellFormedString(key)) throw new Error('JCS_ILL_FORMED_STRING: lone surrogate in a key at ' + where)
        parts.push(JSON.stringify(key) + ':' + ser(d.value, depth + 1, where + '.' + key))
      }
      return '{' + parts.join(',') + '}'
    } finally {
      stack.delete(v)
    }
  }
  return ser(value, baseDepth + 1, '$')
}
function profileSignedBytes(value: any, baseDepth: any) {
  return new TextEncoder().encode(profileCanonicalizeSigned(value, baseDepth))
}

const profileEnc = new TextEncoder()
function profileHex(bytes: any) { return Array.from(new Uint8Array(bytes)).map(function(b: any) { return b.toString(16).padStart(2, '0') }).join('') }
function profileConcat(a: any, b: any) { const out = new Uint8Array(a.length + b.length); out.set(a, 0); out.set(b, a.length); return out }
function profileToBase64Url(bytes: any) {
  let binary = ''
  const arr = new Uint8Array(bytes)
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i])
  return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '')
}

export async function profileAssessmentDigest(assessment: any) {
  const bytes = profileConcat(profileEnc.encode(PROFILE_ASSESSMENT_TAG), profileSignedBytes(assessment, PROFILE_ASSESSMENT_BASE_DEPTH))
  return 'avassess-sha256:' + profileHex(await crypto.subtle.digest('SHA-256', bytes))
}
export function profileSigningInput(payload: any) {
  return profileConcat(profileEnc.encode(PROFILE_PAYLOAD_TAG), profileSignedBytes(payload, PROFILE_PAYLOAD_BASE_DEPTH))
}
export async function profileKeyIdOf(jwk: any) {
  if (jwk.kty !== 'EC') throw new Error('unsupported key type for a thumbprint')
  const members = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }
  return profileToBase64Url(await crypto.subtle.digest('SHA-256', profileEnc.encode(profileCanonicalizeSigned(members, 0))))
}

export const P256_ORDER = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n
export const P256_HALF_ORDER = P256_ORDER / 2n
const PROFILE_FIELD_PRIME = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFFn

function profileBase64UrlToBytes(s: any) {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
function profileBytesToBigInt(bytes: any) { let n = 0n; for (let i = 0; i < bytes.length; i++) n = (n << 8n) | BigInt(bytes[i]); return n }
function profileBigIntToBytes32(n: any) { const out = new Uint8Array(32); for (let i = 31; i >= 0; i--) { out[i] = Number(n & 0xffn); n >>= 8n } return out }

function profileIsCanonicalCoordinate(s: any) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(s)) return false
  const bytes = profileBase64UrlToBytes(s)
  if (bytes.length !== 32) return false
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '') === s
}
function profileIsCoordinateInRange(s: any) {
  return profileBytesToBigInt(profileBase64UrlToBytes(s)) < PROFILE_FIELD_PRIME
}
export function checkP256PublicJwk(jwk: any): any {
  if (typeof jwk !== 'object' || jwk === null || Array.isArray(jwk)) return { ok: false, reasonCode: 'jwk.shape' }
  const keys = Object.keys(jwk).sort()
  if (JSON.stringify(keys) !== JSON.stringify(['crv', 'kty', 'x', 'y'])) {
    return { ok: false, reasonCode: Object.hasOwn(jwk, 'd') ? 'jwk.private-key-material' : 'jwk.members' }
  }
  if (typeof jwk.kty !== 'string' || typeof jwk.crv !== 'string') return { ok: false, reasonCode: 'jwk.types' }
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') return { ok: false, reasonCode: 'jwk.not-p256' }
  if (!profileIsCanonicalCoordinate(jwk.x) || !profileIsCanonicalCoordinate(jwk.y)) return { ok: false, reasonCode: 'jwk.coordinates' }
  if (!profileIsCoordinateInRange(jwk.x) || !profileIsCoordinateInRange(jwk.y)) return { ok: false, reasonCode: 'jwk.coordinate-range' }
  return { ok: true }
}
export function profileSignatureProblem(bytes: any) {
  if (bytes.length !== 64) return 'signature.range'
  const r = profileBytesToBigInt(bytes.subarray(0, 32))
  const s = profileBytesToBigInt(bytes.subarray(32))
  if (r < 1n || r >= P256_ORDER || s < 1n || s >= P256_ORDER) return 'signature.range'
  if (s > P256_HALF_ORDER) return 'signature.high-s'
  return null
}
export function normalizeProfileSignatureLowS(rawSignature: any) {
  if (rawSignature.length !== 64) throw new Error('raw ECDSA signature must be exactly 64 bytes (r || s)')
  const r = rawSignature.subarray(0, 32)
  const s = profileBytesToBigInt(rawSignature.subarray(32))
  const lowS = s > P256_HALF_ORDER ? P256_ORDER - s : s
  const out = new Uint8Array(64)
  out.set(r, 0)
  out.set(profileBigIntToBytes32(lowS), 32)
  return out
}

const PROFILE_CONFIDENCES = ['high', 'medium', 'low']
const PROFILE_SEVERITIES = ['high', 'medium', 'low']
const PROFILE_POLARITIES = ['gap', 'positive', 'context']
const PROFILE_AXES = ['manifest', 'tools', 'network', 'shell', 'filesystem', 'identity', 'sensitive', 'dependencies', 'lockfile', 'execution-config', 'sbom', 'metadata']
const PROFILE_PROVENANCES = ['DECLARED', 'STATICALLY_OBSERVED', 'RECOMPUTED', 'CRYPTOGRAPHICALLY_VERIFIED', 'BEHAVIORALLY_OBSERVED', 'EXTERNAL_EVIDENCE', 'INFERRED']
const PROFILE_UPSTREAM_SEVERITIES = ['Critical', 'High', 'Medium']
const PROFILE_CHECK_STATUSES = ['EVIDENCE_OBSERVED', 'GAP_IDENTIFIED', 'NOT_ASSESSED']
const PROFILE_TOP = ['schemaVersion', 'profile', 'controls', 'notImplementedControls', 'evidence', 'unmappedEvidenceIds', 'package', 'notes']
const PROFILE_PROFILE_KEYS = ['profileId', 'framework', 'upstreamRepo', 'upstreamCommit', 'upstreamStatus', 'upstreamLicense', 'agentverifyProfileVersion', 'implementedControls'].concat(INTERPRETATION_VERSION_KEYS)
const PROFILE_CONTROL_KEYS = ['controlId', 'framework', 'title', 'upstreamSeverity', 'status', 'confidence', 'explanation', 'checks', 'coverage']
const PROFILE_CHECK_KEYS = ['checkId', 'title', 'status', 'confidence', 'provenance', 'supportingEvidenceIds', 'explanation']
const PROFILE_COVERAGE_KEYS = ['total', 'evidenceObserved', 'gapIdentified', 'notAssessed']
const PROFILE_EVIDENCE_KEYS = ['id', 'kind', 'axis', 'polarity', 'severity', 'confidence', 'provenance', 'summary', 'expected', 'remediation', 'locations', 'facts']
const PROFILE_PACKAGE_KEYS = ['digest', 'fileCount', 'manifestFiles']
const PROFILE_SEMVER_RE = /^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$/
const PROFILE_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const PROFILE_CONTROL_ID_RE = /^[A-Z]{3}\\d{2}$/
const PROFILE_COMMIT_RE = /^[0-9a-f]{40}$/
const PROFILE_PACKAGE_DIGEST_RE = /^avpkg-sha256:[0-9a-f]{64}$/

function profileIsPlain(v: any) { return typeof v === 'object' && v !== null && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null) }
function profileIsDenseArray(v: any) {
  if (!Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype) return false
  const keys = Reflect.ownKeys(v).filter(function(k: any) { return k !== 'length' })
  return keys.length === v.length && keys.every(function(k: any, i: any) { return k === String(i) })
}
function profileExactKeys(o: any, required: any, optional: any = []) {
  optional = optional || []
  if (Object.getOwnPropertySymbols(o).length > 0) return false
  const keys = Object.keys(o)
  return required.every(function(k: any) { return Object.hasOwn(o, k) }) && keys.every(function(k: any) { return required.includes(k) || optional.includes(k) })
}
function profileIsNonEmptyString(s: any) { return typeof s === 'string' && s.length > 0 && profileIsWellFormedString(s) }
function profileIsString(s: any) { return typeof s === 'string' && profileIsWellFormedString(s) }
function profileIsSemver(s: any) { return typeof s === 'string' && PROFILE_SEMVER_RE.test(s) }
function profileIsCommit(s: any) { return typeof s === 'string' && PROFILE_COMMIT_RE.test(s) }
function profileIsNonNegativeSafeInteger(n: any) { return typeof n === 'number' && profileNumberProblem(n) === null && n >= 0 }
function profileIsPositiveSafeInteger(n: any) { return typeof n === 'number' && profileNumberProblem(n) === null && n >= 1 }
function profileIsUniqueStringArray(a: any, itemOk: any) { return profileIsDenseArray(a) && a.every(itemOk) && new Set(a).size === a.length }
function profileInEnum(list: any, v: any) { return typeof v === 'string' && list.includes(v) }
function profileIsFact(v: any) { return typeof v === 'boolean' || profileIsString(v) || (typeof v === 'number' && profileNumberProblem(v) === null) || (profileIsDenseArray(v) && v.every(profileIsString)) }
function profileIsLocation(l: any) { return profileIsPlain(l) && profileExactKeys(l, ['file'], ['line', 'keyPath']) && profileIsNonEmptyString(l.file) && (!Object.hasOwn(l, 'line') || profileIsPositiveSafeInteger(l.line)) && (!Object.hasOwn(l, 'keyPath') || profileIsNonEmptyString(l.keyPath)) }

export function assessmentSchemaProblem(a: any) {
  if (!profileIsPlain(a) || !profileExactKeys(a, PROFILE_TOP)) return 'assessment.schema.top-level'
  if (a.schemaVersion !== PROFILE_ASSESSMENT_SCHEMA_VERSION) return 'assessment.schema.schema-version'
  const p = a.profile
  if (!profileIsPlain(p) || !profileExactKeys(p, PROFILE_PROFILE_KEYS)) return 'assessment.schema.profile'
  if (!(typeof p.profileId === 'string' && PROFILE_ID_RE.test(p.profileId))) return 'assessment.schema.profile'
  const profileStringFields = ['framework', 'upstreamRepo', 'upstreamStatus', 'upstreamLicense']
  for (let i = 0; i < profileStringFields.length; i++) if (!profileIsNonEmptyString(p[profileStringFields[i]])) return 'assessment.schema.profile'
  if (!profileIsCommit(p.upstreamCommit) || !profileIsSemver(p.agentverifyProfileVersion)) return 'assessment.schema.profile'
  if (!INTERPRETATION_VERSION_KEYS.every(function(k: any) { return profileIsSemver(p[k]) })) return 'assessment.schema.profile'
  if (!profileIsUniqueStringArray(p.implementedControls, function(c: any) { return typeof c === 'string' && PROFILE_CONTROL_ID_RE.test(c) }) || p.implementedControls.length === 0) return 'assessment.schema.profile.implemented-controls'

  if (!profileIsDenseArray(a.evidence)) return 'assessment.schema.evidence'
  const evidenceIds = new Set()
  for (const e of a.evidence) {
    if (!profileIsPlain(e) || !profileExactKeys(e, PROFILE_EVIDENCE_KEYS)) return 'assessment.schema.evidence'
    if (!profileIsNonEmptyString(e.id) || !profileIsNonEmptyString(e.kind)) return 'assessment.schema.evidence'
    if (!profileInEnum(PROFILE_AXES, e.axis) || !profileInEnum(PROFILE_POLARITIES, e.polarity) || !profileInEnum(PROFILE_SEVERITIES, e.severity) || !profileInEnum(PROFILE_CONFIDENCES, e.confidence)) return 'assessment.schema.evidence'
    if (!profileIsUniqueStringArray(e.provenance, function(x: any) { return profileInEnum(PROFILE_PROVENANCES, x) })) return 'assessment.schema.evidence'
    if (!profileIsString(e.summary) || !profileIsString(e.expected) || !profileIsString(e.remediation)) return 'assessment.schema.evidence'
    if (!profileIsDenseArray(e.locations) || !e.locations.every(profileIsLocation)) return 'assessment.schema.evidence'
    if (!profileIsPlain(e.facts) || !Object.keys(e.facts).every(function(k: any) { return profileIsFact(e.facts[k]) }) || Object.getOwnPropertySymbols(e.facts).length > 0) return 'assessment.schema.evidence'
    if (evidenceIds.has(e.id)) return 'assessment.schema.evidence.duplicate-id'
    evidenceIds.add(e.id)
  }

  if (!profileIsDenseArray(a.controls)) return 'assessment.schema.controls'
  const seenControls = new Set()
  const referencedEvidenceIds = new Set()
  for (const c of a.controls) {
    if (!profileIsPlain(c) || !profileExactKeys(c, PROFILE_CONTROL_KEYS)) return 'assessment.schema.control'
    if (typeof c.controlId !== 'string' || !PROFILE_CONTROL_ID_RE.test(c.controlId)) return 'assessment.schema.control'
    if (c.framework !== p.framework) return 'assessment.schema.control'
    if (!profileIsNonEmptyString(c.title) || !profileIsString(c.explanation)) return 'assessment.schema.control'
    if (!profileInEnum(PROFILE_UPSTREAM_SEVERITIES, c.upstreamSeverity) || !profileInEnum(PROFILE_CHECK_STATUSES, c.status) || !profileInEnum(PROFILE_CONFIDENCES, c.confidence)) return 'assessment.schema.control'
    if (seenControls.has(c.controlId)) return 'assessment.schema.controls'
    seenControls.add(c.controlId)
    if (!profileIsDenseArray(c.checks) || c.checks.length === 0) return 'assessment.schema.checks'
    const seenChecks = new Set()
    const counts = { EVIDENCE_OBSERVED: 0, GAP_IDENTIFIED: 0, NOT_ASSESSED: 0 }
    for (const k of c.checks) {
      if (!profileIsPlain(k) || !profileExactKeys(k, PROFILE_CHECK_KEYS)) return 'assessment.schema.check'
      if (!profileIsNonEmptyString(k.checkId) || !profileIsNonEmptyString(k.title) || !profileIsString(k.explanation)) return 'assessment.schema.check'
      if (!profileInEnum(PROFILE_CHECK_STATUSES, k.status) || !profileInEnum(PROFILE_CONFIDENCES, k.confidence)) return 'assessment.schema.check'
      if (!profileIsUniqueStringArray(k.provenance, function(x: any) { return profileInEnum(PROFILE_PROVENANCES, x) })) return 'assessment.schema.check'
      if (!profileIsUniqueStringArray(k.supportingEvidenceIds, profileIsNonEmptyString)) return 'assessment.schema.check'
      if (seenChecks.has(k.checkId)) return 'assessment.schema.check'
      seenChecks.add(k.checkId)
      if (!k.supportingEvidenceIds.every(function(id: any) { return evidenceIds.has(id) })) return 'assessment.schema.evidence-reference'
      for (const id of k.supportingEvidenceIds) referencedEvidenceIds.add(id)
      counts[k.status as keyof typeof counts]++
    }
    const cov = c.coverage
    if (!profileIsPlain(cov) || !profileExactKeys(cov, PROFILE_COVERAGE_KEYS) || !PROFILE_COVERAGE_KEYS.every(function(f: any) { return profileIsNonNegativeSafeInteger(cov[f]) })) return 'assessment.schema.coverage'
    if (cov.total !== c.checks.length || cov.evidenceObserved !== counts.EVIDENCE_OBSERVED || cov.gapIdentified !== counts.GAP_IDENTIFIED || cov.notAssessed !== counts.NOT_ASSESSED) return 'assessment.schema.coverage'
    const expectedStatus = counts.GAP_IDENTIFIED > 0 ? 'GAP_IDENTIFIED' : counts.NOT_ASSESSED > 0 ? 'NOT_ASSESSED' : 'EVIDENCE_OBSERVED'
    if (c.status !== expectedStatus) return 'assessment.schema.control-status'
  }
  const controlIds = a.controls.map(function(c: any) { return c.controlId })
  if (controlIds.length !== p.implementedControls.length || controlIds.some(function(id: any, i: any) { return id !== p.implementedControls[i] })) return 'assessment.schema.controls'
  if (!profileIsUniqueStringArray(a.notImplementedControls, function(c: any) { return typeof c === 'string' && PROFILE_CONTROL_ID_RE.test(c) })) return 'assessment.schema.not-implemented'
  if (a.notImplementedControls.some(function(c: any) { return p.implementedControls.includes(c) })) return 'assessment.schema.not-implemented'
  if (!profileIsUniqueStringArray(a.unmappedEvidenceIds, profileIsNonEmptyString) || !a.unmappedEvidenceIds.every(function(id: any) { return evidenceIds.has(id) })) return 'assessment.schema.unmapped-evidence'
  for (const id of a.unmappedEvidenceIds) if (referencedEvidenceIds.has(id)) return 'assessment.schema.evidence-mapping-conflict'
  const unmappedEvidenceIdSet = new Set(a.unmappedEvidenceIds)
  for (const id of evidenceIds) if (!referencedEvidenceIds.has(id) && !unmappedEvidenceIdSet.has(id)) return 'assessment.schema.evidence-unaccounted'
  const pk = a.package
  if (!profileIsPlain(pk) || !profileExactKeys(pk, PROFILE_PACKAGE_KEYS)) return 'assessment.schema.package'
  if (typeof pk.digest !== 'string' || !PROFILE_PACKAGE_DIGEST_RE.test(pk.digest) || !profileIsNonNegativeSafeInteger(pk.fileCount)) return 'assessment.schema.package'
  if (!profileIsDenseArray(pk.manifestFiles) || !pk.manifestFiles.every(profileIsNonEmptyString)) return 'assessment.schema.package'
  if (!profileIsDenseArray(a.notes) || !a.notes.every(profileIsString)) return 'assessment.schema.notes'
  return null
}

export const PROFILE_ATTESTATION_REGISTRY = Object.freeze({
  'owasp-agentic-skills-2026': Object.freeze({
    versions: Object.freeze({
      '1.0.0-alpha.1': Object.freeze({
        framework: 'OWASP_AGENTIC_SKILLS_TOP_10',
        upstream: Object.freeze({ repo: 'OWASP/www-project-agentic-skills-top-10', commit: 'd6f7d7d0de314f52a83a85d1828e06ab096e595c', license: 'CC-BY-SA-4.0', status: 'public-review' }),
        controlUniverse: Object.freeze(['AST01', 'AST02', 'AST03', 'AST04', 'AST05', 'AST06', 'AST07', 'AST08', 'AST09', 'AST10']),
        implementedControls: Object.freeze(['AST02', 'AST03', 'AST04']),
        assessmentSchemaVersion: '1.1.0',
      }),
    }),
  }),
})

export function lookupProfileAttestationDefinition(profileId: any, profileVersion: any): any {
  const registry: any = PROFILE_ATTESTATION_REGISTRY
  const entry = typeof profileId === 'string' && Object.hasOwn(registry, profileId) ? registry[profileId] : undefined
  if (!entry) return { problem: 'UNSUPPORTED_PROFILE' }
  const definition = typeof profileVersion === 'string' && Object.hasOwn(entry.versions, profileVersion) ? entry.versions[profileVersion] : undefined
  if (!definition) return { problem: 'UNSUPPORTED_PROFILE_VERSION' }
  return { definition: definition }
}
function profileSameList(a: any, b: any) { return Array.isArray(a) && a.length === b.length && a.every(function(x: any, i: any) { return x === b[i] }) }
function profileDefinitionProblem(definition: any, assessment: any): any {
  const p = assessment.profile
  if (p.framework !== definition.framework) return 'profile.framework'
  if (p.upstreamRepo !== definition.upstream.repo) return 'profile.upstream.repo'
  if (p.upstreamCommit !== definition.upstream.commit) return 'profile.upstream.commit'
  if (p.upstreamLicense !== definition.upstream.license) return 'profile.upstream.license'
  if (p.upstreamStatus !== definition.upstream.status) return 'profile.upstream.status'
  if (!profileSameList(p.implementedControls, definition.implementedControls)) return 'profile.implemented-controls'
  const expectedNotImplemented = definition.controlUniverse.filter(function(c: any) { return !definition.implementedControls.includes(c) })
  if (!profileSameList(assessment.notImplementedControls, expectedNotImplemented)) return 'profile.not-implemented-controls'
  if (assessment.schemaVersion !== definition.assessmentSchemaVersion) return 'profile.assessment-schema-version'
  return null
}
export function profileInterpretationOf(assessment: any): any {
  if (!profileIsPlain(assessment) || typeof assessment.schemaVersion !== 'string' || assessment.schemaVersion !== PROFILE_ASSESSMENT_SCHEMA_VERSION) {
    return { interpretation: 'UNSUPPORTED_SCHEMA' }
  }
  const structural = assessmentSchemaProblem(assessment)
  if (structural) return { interpretation: 'INVALID_ASSESSMENT', interpretationReason: structural }
  const found = lookupProfileAttestationDefinition(assessment.profile.profileId, assessment.profile.agentverifyProfileVersion)
  if (found.problem) return { interpretation: found.problem }
  const mismatch = profileDefinitionProblem(found.definition, assessment)
  if (mismatch) return { interpretation: 'PROFILE_DEFINITION_MISMATCH', interpretationReason: mismatch }
  return { interpretation: 'SUPPORTED' }
}
export function admitAssessment(assessment: any): any {
  try {
    profileSignedBytes(assessment, PROFILE_ASSESSMENT_BASE_DEPTH)
  } catch (e) {
    const code = e instanceof Error ? e.message.split(':')[0] : 'ERROR'
    return { admitted: false, reason: 'assessment.not-canonicalizable:' + code }
  }
  const result = profileInterpretationOf(assessment)
  if (result.interpretation === 'SUPPORTED') return { admitted: true }
  return { admitted: false, reason: result.interpretationReason !== undefined ? result.interpretationReason : result.interpretation }
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

// Stub: performs NO analysis (see the matching TypeScript block above).
export const SKILL_ASSESSMENT_SCHEMA_VERSION = '1.1.0'
export async function assessSkillPackageAst(files) {
  return {
    ok: true,
    normalized: null,
    assessment: {
      schemaVersion: '1.1.0',
      profile: { profileId: 'owasp-agentic-skills-2026', framework: 'OWASP_AGENTIC_SKILLS_TOP_10', upstreamRepo: 'ci-stub', upstreamCommit: '0'.repeat(40), upstreamStatus: 'ci-stub', upstreamLicense: 'ci-stub', agentverifyProfileVersion: 'ci-stub', implementedControls: [], scannerVersion: 'ci-stub', assessmentEngineVersion: 'ci-stub', riskRubricVersion: 'ci-stub', keyAllowlistVersion: 'ci-stub', normalizationVersion: 'ci-stub' },
      controls: [],
      evidence: [],
      notImplementedControls: [],
      unmappedEvidenceIds: [],
      package: { digest: 'ci-stub', fileCount: files.length, manifestFiles: [] },
      notes: ['CI scanner stub — no real analysis was performed.'],
    },
  }
}

// ── Profile-attestation verification logic (NOT proprietary — a faithful, hand-maintained flattened port of
// packages/scanner/src/profileAttestation.ts, itself a port of conformance/v4/reference/*.mjs). Unlike
// assessSkillPackageAst above, this is safe and correct to include here in full: it contains no detection
// logic, no scanning heuristics, nothing that needs to stay private. It exists in the CI stub so that
// workers/api/src/profileAttestationSigning.ts — which imports these exact names from '@agentverify/scanner' —
// typechecks and runs correctly in public CI, where the private scanner package is absent. If the real
// packages/scanner/src/profileAttestation.ts ever changes these algorithms, this block must be kept in sync by
// hand (there is no build step that derives one from the other) — packages/scanner/test/profileAttestationPort.test.mjs
// (private, not run in public CI) is what keeps the REAL module honest against conformance/v4; this CI-stub
// copy only needs to satisfy this repo's OWN Worker-side tests, not byte-for-byte parity with the reference.
export const PROFILE_ATTESTATION_TYPE = 'agentverify.profile-assessment'
export const PROFILE_ATTESTATION_VERSION = '1.0.0'
export const PROFILE_BUNDLE_VERSION = '1.0.0'
export const PROFILE_PAYLOAD_TAG = 'agentverify-attestation/profile-assessment/v1\\n'
export const PROFILE_KEY_PURPOSE = 'agentverify-profile-v1'
export const PROFILE_ASSESSMENT_TAG = 'agentverify-assessment-digest/v1\\n'
export const PROFILE_ATTESTATION_ALGORITHM = 'ECDSA-P256-SHA256'
export const PROFILE_ASSESSMENT_SCHEMA_VERSION = '1.1.0'
export const INTERPRETATION_VERSION_KEYS = ['scannerVersion', 'assessmentEngineVersion', 'riskRubricVersion', 'keyAllowlistVersion', 'normalizationVersion']
export const PROFILE_PAYLOAD_BASE_DEPTH = 2
const PROFILE_ASSESSMENT_BASE_DEPTH = 1
const PROFILE_MAX_JSON_DEPTH = 64

function profileNumberProblem(value) {
  if (typeof value !== 'number') return 'NOT_A_NUMBER'
  if (!Number.isFinite(value)) return 'NON_FINITE'
  if (Object.is(value, -0)) return 'NEGATIVE_ZERO'
  if (!Number.isInteger(value)) return 'NON_INTEGER'
  if (!Number.isSafeInteger(value)) return 'UNSAFE_INTEGER'
  return null
}

function profileIsWellFormedString(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1)
      if (n >= 0xdc00 && n <= 0xdfff) { i++; continue }
      return false
    }
    if (c >= 0xdc00 && c <= 0xdfff) return false
  }
  return true
}

function profileCanonicalizeSigned(value, baseDepth) {
  const stack = new Set()
  function ser(v, depth, where) {
    if (v === null) return 'null'
    switch (typeof v) {
      case 'undefined': throw new Error('JCS_UNDEFINED: undefined at ' + where)
      case 'boolean': return v ? 'true' : 'false'
      case 'number': {
        if (!Number.isFinite(v)) throw new Error('JCS_NON_FINITE: non-finite number at ' + where)
        const problem = profileNumberProblem(v)
        if (problem !== null) throw new Error('JCS_NUMBER_NOT_ADMITTED: ' + problem + ' at ' + where)
        return String(v)
      }
      case 'string': {
        if (!profileIsWellFormedString(v)) throw new Error('JCS_ILL_FORMED_STRING: lone surrogate at ' + where)
        return JSON.stringify(v)
      }
      case 'function': case 'symbol': case 'bigint':
        throw new Error('JCS_UNSUPPORTED_TYPE: ' + typeof v + ' at ' + where)
      default: break
    }
    if (depth > PROFILE_MAX_JSON_DEPTH) throw new Error('JCS_TOO_DEEP: nesting deeper than ' + PROFILE_MAX_JSON_DEPTH + ' at ' + where)
    if (stack.has(v)) throw new Error('JCS_CYCLE: cycle at ' + where)
    stack.add(v)
    try {
      if (Array.isArray(v)) {
        if (Object.getPrototypeOf(v) !== Array.prototype) throw new Error('JCS_NOT_PLAIN: array subclass at ' + where)
        const keys = Reflect.ownKeys(v).filter(function (k) { return k !== 'length' })
        if (keys.length !== v.length || keys.some(function (k, idx) { return k !== String(idx) })) throw new Error('JCS_NOT_PLAIN: sparse array at ' + where)
        return '[' + v.map(function (item, idx) { return ser(item, depth + 1, where + '[' + idx + ']') }).join(',') + ']'
      }
      const proto = Object.getPrototypeOf(v)
      if (proto !== Object.prototype && proto !== null) throw new Error('JCS_NOT_PLAIN: non-plain object at ' + where)
      const own = Reflect.ownKeys(v)
      if (own.some(function (k) { return typeof k === 'symbol' })) throw new Error('JCS_NOT_PLAIN: symbol-keyed property at ' + where)
      const parts = []
      const sortedKeys = own.slice().sort()
      for (const key of sortedKeys) {
        const d = Object.getOwnPropertyDescriptor(v, key)
        if (!d || !d.enumerable || 'get' in d || 'set' in d) throw new Error('JCS_NOT_PLAIN: non-data property ' + JSON.stringify(key) + ' at ' + where)
        if (typeof key !== 'string' || !profileIsWellFormedString(key)) throw new Error('JCS_ILL_FORMED_STRING: lone surrogate in a key at ' + where)
        parts.push(JSON.stringify(key) + ':' + ser(d.value, depth + 1, where + '.' + key))
      }
      return '{' + parts.join(',') + '}'
    } finally {
      stack.delete(v)
    }
  }
  return ser(value, baseDepth + 1, '$')
}
function profileSignedBytes(value, baseDepth) {
  return new TextEncoder().encode(profileCanonicalizeSigned(value, baseDepth))
}

const profileEnc = new TextEncoder()
function profileHex(bytes) { return Array.from(new Uint8Array(bytes)).map(function (b) { return b.toString(16).padStart(2, '0') }).join('') }
function profileConcat(a, b) { const out = new Uint8Array(a.length + b.length); out.set(a, 0); out.set(b, a.length); return out }
function profileToBase64Url(bytes) {
  let binary = ''
  const arr = new Uint8Array(bytes)
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i])
  return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '')
}

export async function profileAssessmentDigest(assessment) {
  const bytes = profileConcat(profileEnc.encode(PROFILE_ASSESSMENT_TAG), profileSignedBytes(assessment, PROFILE_ASSESSMENT_BASE_DEPTH))
  return 'avassess-sha256:' + profileHex(await crypto.subtle.digest('SHA-256', bytes))
}
export function profileSigningInput(payload) {
  return profileConcat(profileEnc.encode(PROFILE_PAYLOAD_TAG), profileSignedBytes(payload, PROFILE_PAYLOAD_BASE_DEPTH))
}
export async function profileKeyIdOf(jwk) {
  if (jwk.kty !== 'EC') throw new Error('unsupported key type for a thumbprint')
  const members = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }
  return profileToBase64Url(await crypto.subtle.digest('SHA-256', profileEnc.encode(profileCanonicalizeSigned(members, 0))))
}

export const P256_ORDER = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n
export const P256_HALF_ORDER = P256_ORDER / 2n
const PROFILE_FIELD_PRIME = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFFn

function profileBase64UrlToBytes(s) {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
function profileBytesToBigInt(bytes) { let n = 0n; for (let i = 0; i < bytes.length; i++) n = (n << 8n) | BigInt(bytes[i]); return n }
function profileBigIntToBytes32(n) { const out = new Uint8Array(32); for (let i = 31; i >= 0; i--) { out[i] = Number(n & 0xffn); n >>= 8n } return out }

function profileIsCanonicalCoordinate(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(s)) return false
  const bytes = profileBase64UrlToBytes(s)
  if (bytes.length !== 32) return false
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '') === s
}
function profileIsCoordinateInRange(s) {
  return profileBytesToBigInt(profileBase64UrlToBytes(s)) < PROFILE_FIELD_PRIME
}
export function checkP256PublicJwk(jwk) {
  if (typeof jwk !== 'object' || jwk === null || Array.isArray(jwk)) return { ok: false, reasonCode: 'jwk.shape' }
  const keys = Object.keys(jwk).sort()
  if (JSON.stringify(keys) !== JSON.stringify(['crv', 'kty', 'x', 'y'])) {
    return { ok: false, reasonCode: Object.hasOwn(jwk, 'd') ? 'jwk.private-key-material' : 'jwk.members' }
  }
  if (typeof jwk.kty !== 'string' || typeof jwk.crv !== 'string') return { ok: false, reasonCode: 'jwk.types' }
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') return { ok: false, reasonCode: 'jwk.not-p256' }
  if (!profileIsCanonicalCoordinate(jwk.x) || !profileIsCanonicalCoordinate(jwk.y)) return { ok: false, reasonCode: 'jwk.coordinates' }
  if (!profileIsCoordinateInRange(jwk.x) || !profileIsCoordinateInRange(jwk.y)) return { ok: false, reasonCode: 'jwk.coordinate-range' }
  return { ok: true }
}
export function profileSignatureProblem(bytes) {
  if (bytes.length !== 64) return 'signature.range'
  const r = profileBytesToBigInt(bytes.subarray(0, 32))
  const s = profileBytesToBigInt(bytes.subarray(32))
  if (r < 1n || r >= P256_ORDER || s < 1n || s >= P256_ORDER) return 'signature.range'
  if (s > P256_HALF_ORDER) return 'signature.high-s'
  return null
}
export function normalizeProfileSignatureLowS(rawSignature) {
  if (rawSignature.length !== 64) throw new Error('raw ECDSA signature must be exactly 64 bytes (r || s)')
  const r = rawSignature.subarray(0, 32)
  const s = profileBytesToBigInt(rawSignature.subarray(32))
  const lowS = s > P256_HALF_ORDER ? P256_ORDER - s : s
  const out = new Uint8Array(64)
  out.set(r, 0)
  out.set(profileBigIntToBytes32(lowS), 32)
  return out
}

const PROFILE_CONFIDENCES = ['high', 'medium', 'low']
const PROFILE_SEVERITIES = ['high', 'medium', 'low']
const PROFILE_POLARITIES = ['gap', 'positive', 'context']
const PROFILE_AXES = ['manifest', 'tools', 'network', 'shell', 'filesystem', 'identity', 'sensitive', 'dependencies', 'lockfile', 'execution-config', 'sbom', 'metadata']
const PROFILE_PROVENANCES = ['DECLARED', 'STATICALLY_OBSERVED', 'RECOMPUTED', 'CRYPTOGRAPHICALLY_VERIFIED', 'BEHAVIORALLY_OBSERVED', 'EXTERNAL_EVIDENCE', 'INFERRED']
const PROFILE_UPSTREAM_SEVERITIES = ['Critical', 'High', 'Medium']
const PROFILE_CHECK_STATUSES = ['EVIDENCE_OBSERVED', 'GAP_IDENTIFIED', 'NOT_ASSESSED']
const PROFILE_TOP = ['schemaVersion', 'profile', 'controls', 'notImplementedControls', 'evidence', 'unmappedEvidenceIds', 'package', 'notes']
const PROFILE_PROFILE_KEYS = ['profileId', 'framework', 'upstreamRepo', 'upstreamCommit', 'upstreamStatus', 'upstreamLicense', 'agentverifyProfileVersion', 'implementedControls'].concat(INTERPRETATION_VERSION_KEYS)
const PROFILE_CONTROL_KEYS = ['controlId', 'framework', 'title', 'upstreamSeverity', 'status', 'confidence', 'explanation', 'checks', 'coverage']
const PROFILE_CHECK_KEYS = ['checkId', 'title', 'status', 'confidence', 'provenance', 'supportingEvidenceIds', 'explanation']
const PROFILE_COVERAGE_KEYS = ['total', 'evidenceObserved', 'gapIdentified', 'notAssessed']
const PROFILE_EVIDENCE_KEYS = ['id', 'kind', 'axis', 'polarity', 'severity', 'confidence', 'provenance', 'summary', 'expected', 'remediation', 'locations', 'facts']
const PROFILE_PACKAGE_KEYS = ['digest', 'fileCount', 'manifestFiles']
const PROFILE_SEMVER_RE = /^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$/
const PROFILE_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const PROFILE_CONTROL_ID_RE = /^[A-Z]{3}\\d{2}$/
const PROFILE_COMMIT_RE = /^[0-9a-f]{40}$/
const PROFILE_PACKAGE_DIGEST_RE = /^avpkg-sha256:[0-9a-f]{64}$/

function profileIsPlain(v) { return typeof v === 'object' && v !== null && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null) }
function profileIsDenseArray(v) {
  if (!Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype) return false
  const keys = Reflect.ownKeys(v).filter(function (k) { return k !== 'length' })
  return keys.length === v.length && keys.every(function (k, i) { return k === String(i) })
}
function profileExactKeys(o, required, optional) {
  optional = optional || []
  if (Object.getOwnPropertySymbols(o).length > 0) return false
  const keys = Object.keys(o)
  return required.every(function (k) { return Object.hasOwn(o, k) }) && keys.every(function (k) { return required.includes(k) || optional.includes(k) })
}
function profileIsNonEmptyString(s) { return typeof s === 'string' && s.length > 0 && profileIsWellFormedString(s) }
function profileIsString(s) { return typeof s === 'string' && profileIsWellFormedString(s) }
function profileIsSemver(s) { return typeof s === 'string' && PROFILE_SEMVER_RE.test(s) }
function profileIsCommit(s) { return typeof s === 'string' && PROFILE_COMMIT_RE.test(s) }
function profileIsNonNegativeSafeInteger(n) { return typeof n === 'number' && profileNumberProblem(n) === null && n >= 0 }
function profileIsPositiveSafeInteger(n) { return typeof n === 'number' && profileNumberProblem(n) === null && n >= 1 }
function profileIsUniqueStringArray(a, itemOk) { return profileIsDenseArray(a) && a.every(itemOk) && new Set(a).size === a.length }
function profileInEnum(list, v) { return typeof v === 'string' && list.includes(v) }
function profileIsFact(v) { return typeof v === 'boolean' || profileIsString(v) || (typeof v === 'number' && profileNumberProblem(v) === null) || (profileIsDenseArray(v) && v.every(profileIsString)) }
function profileIsLocation(l) { return profileIsPlain(l) && profileExactKeys(l, ['file'], ['line', 'keyPath']) && profileIsNonEmptyString(l.file) && (!Object.hasOwn(l, 'line') || profileIsPositiveSafeInteger(l.line)) && (!Object.hasOwn(l, 'keyPath') || profileIsNonEmptyString(l.keyPath)) }

export function assessmentSchemaProblem(a) {
  if (!profileIsPlain(a) || !profileExactKeys(a, PROFILE_TOP)) return 'assessment.schema.top-level'
  if (a.schemaVersion !== PROFILE_ASSESSMENT_SCHEMA_VERSION) return 'assessment.schema.schema-version'
  const p = a.profile
  if (!profileIsPlain(p) || !profileExactKeys(p, PROFILE_PROFILE_KEYS)) return 'assessment.schema.profile'
  if (!(typeof p.profileId === 'string' && PROFILE_ID_RE.test(p.profileId))) return 'assessment.schema.profile'
  const profileStringFields = ['framework', 'upstreamRepo', 'upstreamStatus', 'upstreamLicense']
  for (let i = 0; i < profileStringFields.length; i++) if (!profileIsNonEmptyString(p[profileStringFields[i]])) return 'assessment.schema.profile'
  if (!profileIsCommit(p.upstreamCommit) || !profileIsSemver(p.agentverifyProfileVersion)) return 'assessment.schema.profile'
  if (!INTERPRETATION_VERSION_KEYS.every(function (k) { return profileIsSemver(p[k]) })) return 'assessment.schema.profile'
  if (!profileIsUniqueStringArray(p.implementedControls, function (c) { return typeof c === 'string' && PROFILE_CONTROL_ID_RE.test(c) }) || p.implementedControls.length === 0) return 'assessment.schema.profile.implemented-controls'

  if (!profileIsDenseArray(a.evidence)) return 'assessment.schema.evidence'
  const evidenceIds = new Set()
  for (const e of a.evidence) {
    if (!profileIsPlain(e) || !profileExactKeys(e, PROFILE_EVIDENCE_KEYS)) return 'assessment.schema.evidence'
    if (!profileIsNonEmptyString(e.id) || !profileIsNonEmptyString(e.kind)) return 'assessment.schema.evidence'
    if (!profileInEnum(PROFILE_AXES, e.axis) || !profileInEnum(PROFILE_POLARITIES, e.polarity) || !profileInEnum(PROFILE_SEVERITIES, e.severity) || !profileInEnum(PROFILE_CONFIDENCES, e.confidence)) return 'assessment.schema.evidence'
    if (!profileIsUniqueStringArray(e.provenance, function (x) { return profileInEnum(PROFILE_PROVENANCES, x) })) return 'assessment.schema.evidence'
    if (!profileIsString(e.summary) || !profileIsString(e.expected) || !profileIsString(e.remediation)) return 'assessment.schema.evidence'
    if (!profileIsDenseArray(e.locations) || !e.locations.every(profileIsLocation)) return 'assessment.schema.evidence'
    if (!profileIsPlain(e.facts) || !Object.keys(e.facts).every(function (k) { return profileIsFact(e.facts[k]) }) || Object.getOwnPropertySymbols(e.facts).length > 0) return 'assessment.schema.evidence'
    if (evidenceIds.has(e.id)) return 'assessment.schema.evidence.duplicate-id'
    evidenceIds.add(e.id)
  }

  if (!profileIsDenseArray(a.controls)) return 'assessment.schema.controls'
  const seenControls = new Set()
  const referencedEvidenceIds = new Set()
  for (const c of a.controls) {
    if (!profileIsPlain(c) || !profileExactKeys(c, PROFILE_CONTROL_KEYS)) return 'assessment.schema.control'
    if (typeof c.controlId !== 'string' || !PROFILE_CONTROL_ID_RE.test(c.controlId)) return 'assessment.schema.control'
    if (c.framework !== p.framework) return 'assessment.schema.control'
    if (!profileIsNonEmptyString(c.title) || !profileIsString(c.explanation)) return 'assessment.schema.control'
    if (!profileInEnum(PROFILE_UPSTREAM_SEVERITIES, c.upstreamSeverity) || !profileInEnum(PROFILE_CHECK_STATUSES, c.status) || !profileInEnum(PROFILE_CONFIDENCES, c.confidence)) return 'assessment.schema.control'
    if (seenControls.has(c.controlId)) return 'assessment.schema.controls'
    seenControls.add(c.controlId)
    if (!profileIsDenseArray(c.checks) || c.checks.length === 0) return 'assessment.schema.checks'
    const seenChecks = new Set()
    const counts = { EVIDENCE_OBSERVED: 0, GAP_IDENTIFIED: 0, NOT_ASSESSED: 0 }
    for (const k of c.checks) {
      if (!profileIsPlain(k) || !profileExactKeys(k, PROFILE_CHECK_KEYS)) return 'assessment.schema.check'
      if (!profileIsNonEmptyString(k.checkId) || !profileIsNonEmptyString(k.title) || !profileIsString(k.explanation)) return 'assessment.schema.check'
      if (!profileInEnum(PROFILE_CHECK_STATUSES, k.status) || !profileInEnum(PROFILE_CONFIDENCES, k.confidence)) return 'assessment.schema.check'
      if (!profileIsUniqueStringArray(k.provenance, function (x) { return profileInEnum(PROFILE_PROVENANCES, x) })) return 'assessment.schema.check'
      if (!profileIsUniqueStringArray(k.supportingEvidenceIds, profileIsNonEmptyString)) return 'assessment.schema.check'
      if (seenChecks.has(k.checkId)) return 'assessment.schema.check'
      seenChecks.add(k.checkId)
      if (!k.supportingEvidenceIds.every(function (id) { return evidenceIds.has(id) })) return 'assessment.schema.evidence-reference'
      for (const id of k.supportingEvidenceIds) referencedEvidenceIds.add(id)
      counts[k.status]++
    }
    const cov = c.coverage
    if (!profileIsPlain(cov) || !profileExactKeys(cov, PROFILE_COVERAGE_KEYS) || !PROFILE_COVERAGE_KEYS.every(function (f) { return profileIsNonNegativeSafeInteger(cov[f]) })) return 'assessment.schema.coverage'
    if (cov.total !== c.checks.length || cov.evidenceObserved !== counts.EVIDENCE_OBSERVED || cov.gapIdentified !== counts.GAP_IDENTIFIED || cov.notAssessed !== counts.NOT_ASSESSED) return 'assessment.schema.coverage'
    const expectedStatus = counts.GAP_IDENTIFIED > 0 ? 'GAP_IDENTIFIED' : counts.NOT_ASSESSED > 0 ? 'NOT_ASSESSED' : 'EVIDENCE_OBSERVED'
    if (c.status !== expectedStatus) return 'assessment.schema.control-status'
  }
  const controlIds = a.controls.map(function (c) { return c.controlId })
  if (controlIds.length !== p.implementedControls.length || controlIds.some(function (id, i) { return id !== p.implementedControls[i] })) return 'assessment.schema.controls'
  if (!profileIsUniqueStringArray(a.notImplementedControls, function (c) { return typeof c === 'string' && PROFILE_CONTROL_ID_RE.test(c) })) return 'assessment.schema.not-implemented'
  if (a.notImplementedControls.some(function (c) { return p.implementedControls.includes(c) })) return 'assessment.schema.not-implemented'
  if (!profileIsUniqueStringArray(a.unmappedEvidenceIds, profileIsNonEmptyString) || !a.unmappedEvidenceIds.every(function (id) { return evidenceIds.has(id) })) return 'assessment.schema.unmapped-evidence'
  for (const id of a.unmappedEvidenceIds) if (referencedEvidenceIds.has(id)) return 'assessment.schema.evidence-mapping-conflict'
  const unmappedEvidenceIdSet = new Set(a.unmappedEvidenceIds)
  for (const id of evidenceIds) if (!referencedEvidenceIds.has(id) && !unmappedEvidenceIdSet.has(id)) return 'assessment.schema.evidence-unaccounted'
  const pk = a.package
  if (!profileIsPlain(pk) || !profileExactKeys(pk, PROFILE_PACKAGE_KEYS)) return 'assessment.schema.package'
  if (typeof pk.digest !== 'string' || !PROFILE_PACKAGE_DIGEST_RE.test(pk.digest) || !profileIsNonNegativeSafeInteger(pk.fileCount)) return 'assessment.schema.package'
  if (!profileIsDenseArray(pk.manifestFiles) || !pk.manifestFiles.every(profileIsNonEmptyString)) return 'assessment.schema.package'
  if (!profileIsDenseArray(a.notes) || !a.notes.every(profileIsString)) return 'assessment.schema.notes'
  return null
}

export const PROFILE_ATTESTATION_REGISTRY = Object.freeze({
  'owasp-agentic-skills-2026': Object.freeze({
    versions: Object.freeze({
      '1.0.0-alpha.1': Object.freeze({
        framework: 'OWASP_AGENTIC_SKILLS_TOP_10',
        upstream: Object.freeze({ repo: 'OWASP/www-project-agentic-skills-top-10', commit: 'd6f7d7d0de314f52a83a85d1828e06ab096e595c', license: 'CC-BY-SA-4.0', status: 'public-review' }),
        controlUniverse: Object.freeze(['AST01', 'AST02', 'AST03', 'AST04', 'AST05', 'AST06', 'AST07', 'AST08', 'AST09', 'AST10']),
        implementedControls: Object.freeze(['AST02', 'AST03', 'AST04']),
        assessmentSchemaVersion: '1.1.0',
      }),
    }),
  }),
})

export function lookupProfileAttestationDefinition(profileId, profileVersion) {
  const entry = typeof profileId === 'string' && Object.hasOwn(PROFILE_ATTESTATION_REGISTRY, profileId) ? PROFILE_ATTESTATION_REGISTRY[profileId] : undefined
  if (!entry) return { problem: 'UNSUPPORTED_PROFILE' }
  const definition = typeof profileVersion === 'string' && Object.hasOwn(entry.versions, profileVersion) ? entry.versions[profileVersion] : undefined
  if (!definition) return { problem: 'UNSUPPORTED_PROFILE_VERSION' }
  return { definition: definition }
}
function profileSameList(a, b) { return Array.isArray(a) && a.length === b.length && a.every(function (x, i) { return x === b[i] }) }
function profileDefinitionProblem(definition, assessment) {
  const p = assessment.profile
  if (p.framework !== definition.framework) return 'profile.framework'
  if (p.upstreamRepo !== definition.upstream.repo) return 'profile.upstream.repo'
  if (p.upstreamCommit !== definition.upstream.commit) return 'profile.upstream.commit'
  if (p.upstreamLicense !== definition.upstream.license) return 'profile.upstream.license'
  if (p.upstreamStatus !== definition.upstream.status) return 'profile.upstream.status'
  if (!profileSameList(p.implementedControls, definition.implementedControls)) return 'profile.implemented-controls'
  const expectedNotImplemented = definition.controlUniverse.filter(function (c) { return !definition.implementedControls.includes(c) })
  if (!profileSameList(assessment.notImplementedControls, expectedNotImplemented)) return 'profile.not-implemented-controls'
  if (assessment.schemaVersion !== definition.assessmentSchemaVersion) return 'profile.assessment-schema-version'
  return null
}
export function profileInterpretationOf(assessment) {
  if (!profileIsPlain(assessment) || typeof assessment.schemaVersion !== 'string' || assessment.schemaVersion !== PROFILE_ASSESSMENT_SCHEMA_VERSION) {
    return { interpretation: 'UNSUPPORTED_SCHEMA' }
  }
  const structural = assessmentSchemaProblem(assessment)
  if (structural) return { interpretation: 'INVALID_ASSESSMENT', interpretationReason: structural }
  const found = lookupProfileAttestationDefinition(assessment.profile.profileId, assessment.profile.agentverifyProfileVersion)
  if (found.problem) return { interpretation: found.problem }
  const mismatch = profileDefinitionProblem(found.definition, assessment)
  if (mismatch) return { interpretation: 'PROFILE_DEFINITION_MISMATCH', interpretationReason: mismatch }
  return { interpretation: 'SUPPORTED' }
}
export function admitAssessment(assessment) {
  try {
    profileSignedBytes(assessment, PROFILE_ASSESSMENT_BASE_DEPTH)
  } catch (e) {
    const code = e instanceof Error ? e.message.split(':')[0] : 'ERROR'
    return { admitted: false, reason: 'assessment.not-canonicalizable:' + code }
  }
  const result = profileInterpretationOf(assessment)
  if (result.interpretation === 'SUPPORTED') return { admitted: true }
  return { admitted: false, reason: result.interpretationReason !== undefined ? result.interpretationReason : result.interpretation }
}
`

writeFileSync('packages/scanner/src/index.ts', `${types}\n${implementation}`)
writeFileSync('packages/scanner/dist/index.d.ts', types + dtsImplementation)
writeFileSync('packages/scanner/dist/index.js', jsImplementation)
