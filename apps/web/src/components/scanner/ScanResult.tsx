'use client'

import type { ScanResult as ScanResultType } from '@/types'
import { ReportView } from '@/components/report/ReportView'
import type { BillingStatus } from '@/lib/billing'
import type { User } from 'firebase/auth'

interface ScanResultProps {
  result: ScanResultType
  onNewScan: () => void
  reportUrl?: string
  originalContent?: string
  billingStatus?: BillingStatus
  /** The signed-in user who ran this scan (they own the saved report and can share it). */
  user?: User | null
  onSaveAsNewScan?: (content: string) => void
}

export function ScanResult({ result, onNewScan, reportUrl, originalContent = '', billingStatus, user = null, onSaveAsNewScan }: ScanResultProps) {
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
      user={user}
      onSaveAsNewScan={onSaveAsNewScan}
      isOwner={!!user && !!reportId}
    />
  )
}
