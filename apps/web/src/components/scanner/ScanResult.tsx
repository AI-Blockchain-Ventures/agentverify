'use client'

import type { ScanResult as ScanResultType } from '@/types'
import { ReportView } from '@/components/report/ReportView'

interface ScanResultProps {
  result: ScanResultType
  onNewScan: () => void
  reportUrl?: string
  originalContent?: string
}

export function ScanResult({ result, onNewScan, reportUrl, originalContent = '' }: ScanResultProps) {
  return (
    <ReportView
      verdict={result.verdict}
      riskScore={result.riskScore}
      riskLevel={result.riskLevel}
      fileName={result.metadata.fileName}
      platform={result.metadata.selectedPlatform}
      scannedAt={result.metadata.scannedAt}
      source="dashboard"
      findings={result.findings}
      categoryScores={result.categoryScores}
      bom={result.bom}
      reportId={result.reportId}
      originalContent={originalContent}
      onNewScan={onNewScan}
      reportUrl={reportUrl}
    />
  )
}
