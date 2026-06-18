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
}

export type DashboardTab = 'scan' | 'reports' | 'api' | 'settings'
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
  [key: string]: unknown
}

export interface APIKeyRecord {
  id: string
  label: string
  keyPreview: string
  createdAt: string
}
