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

export function canonicalizeForHash(value: unknown): unknown {
  return value
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
export function canonicalAttestationJson(payload: AttestationPayload): string {
  return JSON.stringify(payload)
}
export async function verifyAttestation(_signed: unknown, _expectedPublicKey?: JsonWebKey): Promise<AttestationVerificationResult> {
  return { status: 'MALFORMED', reason: 'CI scanner stub — attestation verification is not implemented here.' }
}
export const BUILTIN_POLICIES: PolicyProfile[] = []
export function findPolicyById(_id: string): PolicyProfile | undefined {
  return undefined
}
export function evaluatePolicy(_result: ScanResult, policy: PolicyProfile): PolicyEvaluationResult {
  return { policy, pass: true, reasons: [] }
}
export function evaluateAllPolicies(_result: ScanResult): PolicyEvaluationResult[] {
  return []
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
  return value
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
  return JSON.stringify(payload)
}
export async function verifyAttestation(_signed, _expectedPublicKey) {
  return { status: 'MALFORMED', reason: 'CI scanner stub — attestation verification is not implemented here.' }
}
export const BUILTIN_POLICIES = []
export function findPolicyById(_id) {
  return undefined
}
export function evaluatePolicy(_result, policy) {
  return { policy, pass: true, reasons: [] }
}
export function evaluateAllPolicies(_result) {
  return []
}
`

writeFileSync('packages/scanner/src/index.ts', `${types}\n${implementation}`)
writeFileSync('packages/scanner/dist/index.d.ts', types + dtsImplementation)
writeFileSync('packages/scanner/dist/index.js', jsImplementation)
