import type { StoredReport } from '@/types'
import { normalizeVerdict } from '@/lib/verdict'
import Link from 'next/link'

export function ReportCard({ report }: { report: StoredReport }) {
  const verdict = normalizeVerdict(report.verdict ?? report.result?.verdict)
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

  if (!reportId) return null

  return (
    <Link href={`/report/?id=${encodeURIComponent(reportId)}`}>
      <div style={{ backgroundColor: 'var(--card)', borderBottom: '1px solid var(--border)' }} className="group flex cursor-pointer items-center gap-3 px-4 py-4 transition-opacity hover:opacity-80 sm:gap-4">
        <div className={`h-2 w-2 shrink-0 rounded-full ${verified ? 'bg-[#00B37E]' : 'bg-[#E03E3E]'}`} />
        <div className="min-w-0 flex-1">
          <p style={{ color: 'var(--text-primary)' }} className="truncate text-sm font-semibold">{fileName}</p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-xs">{source === 'cli' ? 'CLI scan' : 'Dashboard scan'} · {formattedDate || 'Recently scanned'}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-sm font-bold ${verified ? 'text-[#00B37E]' : riskScore >= 50 ? 'text-[#E07B39]' : 'text-[#E03E3E]'}`}>{riskScore}</p>
          <p style={{ color: 'var(--text-muted)' }} className="text-xs">/100</p>
        </div>
        <div className="hidden w-16 shrink-0 text-right sm:block">
          <p style={{ color: 'var(--text-secondary)' }} className="text-xs">{findingsCount} issue{findingsCount !== 1 ? 's' : ''}</p>
        </div>
        <span style={{ color: 'var(--text-muted)' }} className="shrink-0 text-sm transition-opacity group-hover:opacity-70">→</span>
      </div>
    </Link>
  )
}
