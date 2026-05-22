export interface ScanInput {
  content: string
  fileName?: string
  platform?: string
}

export interface Finding {
  title: string
  category: 'A' | 'B'
  severity: 'critical' | 'high' | 'medium' | 'low'
  whatIsWrong: string
  whyItMatters: string
  recommendedFix: string
  evidence?: string
}

export interface ScanResult {
  verdict: 'VERIFIED' | 'NOT VERIFIED'
  riskScore: number
  riskLevel: 'Low Risk' | 'Moderate Risk' | 'High Risk'
  findings: Finding[]
  reportId: string
  scannedAt: string
  saved: boolean
  reportUrl?: string
}

export interface ScanOptions {
  apiKey: string
  apiUrl?: string
  timeout?: number
}
