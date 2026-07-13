'use client'

import type { ScanResult as ScanResultType } from '@/types'
import { ReportView } from '@/components/report/ReportView'
import type { BillingStatus } from '@/lib/billing'

interface ScanResultProps {
  result: ScanResultType
  onNewScan: () => void
  reportUrl?: string
  originalContent?: string
  billingStatus?: BillingStatus
}

export function ScanResult({ result, onNewScan, reportUrl, originalContent = '', billingStatus }: ScanResultProps) {
  const reportId = typeof result.reportId === 'string' && result.reportId.startsWith('REPORT-') ? result.reportId : undefined

  return (
    <ReportView
      report={result as unknown as Record<string, unknown>}
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
      reportId={reportId}
      originalContent={originalContent}
      onNewScan={onNewScan}
      reportUrl={reportUrl}
      billingStatus={billingStatus}
    />
  )
}
