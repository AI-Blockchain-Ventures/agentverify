/**
 * Types for the OWASP Agentic Skills profile-assessment API response (`POST /v1/scan` with a `profile`
 * field — see workers/api/src/profiles.ts and workers/api/src/profileAttestationSigning.ts).
 *
 * Deliberately NOT imported from `@agentverify/scanner` (unlike apps/web/src/types/index.ts's ordinary-scan
 * types): that package is gitignored/private and its public CI build only ships a minimal stub, so a type-only
 * dependency here would mean either widening the stub just to satisfy a type import, or a type that silently
 * drifts from the real one. These interfaces instead describe the WIRE FORMAT directly, exactly as the backend
 * documents it (docs/attestation-profile-design.md, conformance/v4) — the same thing any other API consumer
 * (the CLI, a curl script) would work from. The backend remains authoritative for producing this data; nothing
 * here recomputes, infers, or reinterprets it.
 */

export type SkillCheckStatus = 'EVIDENCE_OBSERVED' | 'GAP_IDENTIFIED' | 'NOT_ASSESSED'
export type SkillConfidence = 'high' | 'medium' | 'low'
export type SkillSeverity = 'high' | 'medium' | 'low'
export type SkillPolarity = 'gap' | 'positive' | 'context'
export type SkillAxis = 'manifest' | 'tools' | 'network' | 'shell' | 'filesystem' | 'identity' | 'sensitive' | 'dependencies' | 'lockfile' | 'execution-config' | 'sbom' | 'metadata'
export type SkillProvenance = 'DECLARED' | 'STATICALLY_OBSERVED' | 'RECOMPUTED' | 'CRYPTOGRAPHICALLY_VERIFIED' | 'BEHAVIORALLY_OBSERVED' | 'EXTERNAL_EVIDENCE' | 'INFERRED'
export type SkillUpstreamSeverity = 'Critical' | 'High' | 'Medium'

export interface SkillEvidenceLocation {
  file: string
  line?: number
  keyPath?: string
}

export interface SkillEvidence {
  id: string
  kind: string
  axis: SkillAxis
  polarity: SkillPolarity
  severity: SkillSeverity
  confidence: SkillConfidence
  provenance: SkillProvenance[]
  summary: string
  expected: string
  remediation: string
  locations: SkillEvidenceLocation[]
  facts: Record<string, unknown>
}

export interface SkillCheck {
  checkId: string
  title: string
  status: SkillCheckStatus
  confidence: SkillConfidence
  provenance: SkillProvenance[]
  supportingEvidenceIds: string[]
  explanation: string
}

export interface SkillControlCoverage {
  total: number
  evidenceObserved: number
  gapIdentified: number
  notAssessed: number
}

export interface SkillControl {
  controlId: string
  framework: string
  title: string
  upstreamSeverity: SkillUpstreamSeverity
  status: SkillCheckStatus
  confidence: SkillConfidence
  explanation: string
  checks: SkillCheck[]
  coverage: SkillControlCoverage
}

export interface SkillPackageInfo {
  digest: string
  fileCount: number
  manifestFiles: string[]
}

export interface SkillProfileInfo {
  profileId: string
  framework: string
  upstreamRepo: string
  upstreamCommit: string
  upstreamStatus: string
  upstreamLicense: string
  /** The OWASP-profile MAPPING's own version (e.g. "1.0.0-alpha.1") — NOT Agent Verify's product version. */
  agentverifyProfileVersion: string
  implementedControls: string[]
  scannerVersion: string
  assessmentEngineVersion: string
  riskRubricVersion: string
  keyAllowlistVersion: string
  normalizationVersion: string
}

export interface SkillAstAssessment {
  schemaVersion: string
  profile: SkillProfileInfo
  controls: SkillControl[]
  notImplementedControls: string[]
  evidence: SkillEvidence[]
  unmappedEvidenceIds: string[]
  package: SkillPackageInfo
  notes: string[]
}

/** The signed payload's shape (workers/api/src/profileAttestationSigning.ts's `SignedProfileAttestation.payload`). */
export interface ProfileAttestationPayload {
  attestationType: string
  attestationVersion: string
  profile: string
  profileVersion: string
  framework: string
  issuer: string
  upstream: { repo: string; commit: string; license: string }
  implementedControls: string[]
  assessmentSchemaVersion: string
  interpretationVersions: Record<string, string>
  package: { digest: string; fileCount: number }
  assessment: { digest: string; canonicalization: string }
  keyId: string
  issuedAt: string
  workspaceId?: string
}

export interface SignedProfileAttestation {
  payload: ProfileAttestationPayload
  signature: string
  algorithm: string
  publicKey: { kty: string; crv: string; x: string; y: string }
}

/** The full `/v1/scan` response body when a `profile` was requested. */
export interface ProfileAssessmentResponse {
  profile: string
  assessment: SkillAstAssessment
  attestation: SignedProfileAttestation | null
  saved: false
  /** Present only alongside a real `attestation` — the frozen v4 bundle's unsigned framing constant. */
  bundleVersion?: string
}

/** The shape of a non-2xx `/v1/scan` (profile) error body. */
export interface ProfileAssessmentErrorResponse {
  error: string
  reason?: string
  rejection?: { code: string; message: string; path?: string }
  supportedProfiles?: string[]
}
