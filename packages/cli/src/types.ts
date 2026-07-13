export interface ScanInput {
  content: string
  fileName?: string
  platform?: string
}

export type Verdict = 'VERIFIED' | 'NOT_VERIFIED' | 'NOT_ASSESSED'
export type RiskLevel = 'Low Risk' | 'Moderate Risk' | 'High Risk'
export type Category = 'A' | 'B'
export type Severity = 'critical' | 'high' | 'medium' | 'low'
export type ThreatCategoryStatus = 'detected' | 'possible' | 'missing_evidence' | 'not_assessed'

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

export interface Finding {
  id: string
  code: string
  title: string
  category: Category
  severity: Severity
  whatIsWrong: string
  whyItMatters: string
  evidence?: string
  recommendedFix: string
  fixCode?: string
  quickFix?: string
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

export interface CategoryScore {
  category: Category
  label: string
  score: number
  maxScore: number
  findingCount: number
}

export interface FixPriorityItem {
  code: string
  title: string
  severity: Severity
  priority: 'fix_first' | 'fix_next' | 'nice_to_have'
  reason: string
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
}

export interface ScanResult {
  schemaVersion: '1.3.0'
  reportId: string
  verdict: Verdict
  riskScore: number
  riskLevel: RiskLevel
  confidence: number
  optimizationScore: number
  reportInsights?: ReportInsights
  threatCategories?: ThreatCategoryAssessment[]
  findings: Finding[]
  categoryScores: CategoryScore[]
  bom: RuntimeBOM
  metadata: {
    schemaVersion: '1.3.0'
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
  saved: boolean
  reportUrl?: string | null
}

export interface ScanOptions {
  apiKey: string
  apiUrl?: string
  timeout?: number
}
