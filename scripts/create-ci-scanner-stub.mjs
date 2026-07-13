import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

if (existsSync('packages/scanner/package.json')) process.exit(0)

mkdirSync('packages/scanner/src', { recursive: true })
mkdirSync('packages/scanner/dist', { recursive: true })

writeFileSync('packages/scanner/package.json', `${JSON.stringify({
  name: '@agentverify/scanner',
  version: '1.3.0',
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

const types = `export type Verdict = 'VERIFIED' | 'NOT VERIFIED'
export type RiskLevel = 'Low Risk' | 'Moderate Risk' | 'High Risk'
export type Category = 'A' | 'B'
export type Severity = 'critical' | 'high' | 'medium' | 'low'
export type ThreatCategoryStatus = 'detected' | 'possible' | 'missing_evidence' | 'not_assessed'

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

export interface Finding {
  id?: string
  code?: string
  title: string
  category: Category
  severity: Severity
  whatIsWrong?: string
  whyItMatters?: string
  recommendedFix?: string
  evidence?: string
  quickFix?: string
  fixCode?: string
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

export interface ScanResult {
  reportId: string
  verdict: Verdict
  riskScore: number
  riskLevel: RiskLevel
  confidence?: number
  findings: Finding[]
  categoryScores?: CategoryScore[]
  bom?: RuntimeBOM
  reportInsights?: Record<string, unknown>
  threatCategories?: ThreatCategoryAssessment[]
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

`

const implementation = `export function scan(input: ScanInput): ScanResult {
  return {
    reportId: 'REPORT-CI-STUB',
    verdict: 'NOT VERIFIED',
    riskScore: 0,
    riskLevel: 'High Risk',
    confidence: 0,
    findings: [],
    categoryScores: [],
    threatCategories: [],
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
`

writeFileSync('packages/scanner/src/index.ts', `${types}\n${implementation}`)
writeFileSync('packages/scanner/dist/index.d.ts', types)
const jsImplementation = implementation
  .replace('export function scan(input: ScanInput): ScanResult {', 'export function scan(input) {')
writeFileSync('packages/scanner/dist/index.js', jsImplementation)
