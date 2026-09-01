import type {
  ScanInput,
  ScanResult,
  Finding,
  RuntimeBOM,
  CategoryScore,
  Verdict,
  RiskLevel,
  Category,
  Severity,
  ThreatCategoryAssessment,
  ThreatCategoryStatus,
  AgentCapability,
  McpToolExposure,
  EvidenceType,
  ScoreFormula,
  ScoreDeduction,
  SecurityCategoryId,
  SecurityCategoryStatus,
  CapabilityChain,
  A2spaStatus,
  SecurityControl,
} from '@agentverify/scanner'

export type {
  ScanInput,
  ScanResult,
  Finding,
  RuntimeBOM,
  CategoryScore,
  Verdict,
  RiskLevel,
  Category,
  Severity,
  ThreatCategoryAssessment,
  ThreatCategoryStatus,
  AgentCapability,
  McpToolExposure,
  EvidenceType,
  ScoreFormula,
  ScoreDeduction,
  SecurityCategoryId,
  SecurityCategoryStatus,
  CapabilityChain,
  A2spaStatus,
  SecurityControl,
}

export type DashboardTab = 'overview' | 'agents' | 'scan' | 'reports' | 'checks' | 'policies' | 'workspace' | 'integrations' | 'api' | 'settings'
export type SourceType = 'dashboard' | 'cli' | 'public'

export interface StoredReport {
  reportId: string
  verdict?: Verdict
  riskScore?: number
  riskLevel?: RiskLevel
  fileName?: string
  scannedAt?: string
  source: SourceType
  findings?: string[] | Finding[]
  platform?: string | null
  agentName?: string | null
  uid?: string
  userId?: string
  isPrivate?: boolean
  isPublic?: boolean
  password?: string | null
  _source?: 'cli' | 'user' | 'public'
  createdAt?: string
  result?: ScanResult
  capabilities?: AgentCapability[]
  mcpExposures?: McpToolExposure[]
  securityCategories?: SecurityCategoryStatus[]
  capabilityChains?: CapabilityChain[]
  a2spaStatus?: A2spaStatus
  securityControlsDetected?: SecurityControl[]
  notDetermined?: string[]
  categoryScores?: CategoryScore[]
  bom?: RuntimeBOM | null
  scannerVersion?: string | null
  /** Identifies the exact submitted content this scan analyzed. Absent on reports scanned before this field existed. */
  artifactHash?: string | null
  artifactHashAlgorithm?: string | null
  artifactFingerprintVersion?: string | null
  [key: string]: unknown
}

export interface APIKeyRecord {
  id: string
  label: string
  keyPreview: string
  createdAt: string
}
