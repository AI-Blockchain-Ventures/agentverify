import type { StoredReport } from '@/types'
import Link from 'next/link'

export function ReportCard({ report }: { report: StoredReport }) {
  const verdict = report.verdict ?? report.result?.verdict ?? 'NOT VERIFIED'
  const riskScore = report.riskScore ?? report.result?.riskScore ?? 0
  const fileName = report.fileName ?? report.result?.metadata?.fileName ?? 'Agent Config'
  const scannedAt = report.scannedAt ?? report.result?.metadata?.scannedAt ?? ''
  const findings = report.findings ?? report.result?.findings ?? []
  const reportId = report.reportId ?? report.result?.reportId ?? ''
  const source = report.source ?? 'dashboard'
  const findingsCount = Array.isArray(findings) ? findings.length : 0

  const verified = verdict === 'VERIFIED'

  const formattedDate = scannedAt
    ? new Date(scannedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : ''

  return (
    <Link href={`/report?id=${encodeURIComponent(reportId)}`}>
      <div className="group flex cursor-pointer items-center gap-4 border-b border-[#1A2535] px-4 py-3 transition-colors hover:bg-[#0D1321]">
        <div className={`h-2 w-2 shrink-0 rounded-full ${verified ? 'bg-[#00B37E]' : 'bg-[#E03E3E]'}`} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{fileName}</p>
          <p className="mt-0.5 text-xs text-[#3D5166]">{source === 'cli' ? 'CLI' : 'Dashboard'} · {formattedDate}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-sm font-bold ${verified ? 'text-[#00B37E]' : riskScore >= 50 ? 'text-[#E07B39]' : 'text-[#E03E3E]'}`}>{riskScore}</p>
          <p className="text-xs text-[#3D5166]">/100</p>
        </div>
        <div className="w-16 shrink-0 text-right">
          <p className="text-xs text-[#8896A8]">{findingsCount} issue{findingsCount !== 1 ? 's' : ''}</p>
        </div>
        <span className="shrink-0 text-sm text-[#3D5166] transition-colors group-hover:text-[#8896A8]">→</span>
      </div>
    </Link>
  )
}
