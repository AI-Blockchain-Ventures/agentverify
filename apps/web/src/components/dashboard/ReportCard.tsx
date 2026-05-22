import type { Finding, StoredReport } from '@/types'
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'

export function ReportCard({ report }: { report: StoredReport }) {
  const verdict = report.verdict ?? report.result?.verdict ?? 'NOT VERIFIED'
  const riskScore = report.riskScore ?? report.result?.riskScore ?? 0
  const riskLevel = report.riskLevel ?? report.result?.riskLevel ?? 'High Risk'
  const fileName = report.fileName ?? report.result?.metadata?.fileName ?? 'Agent Config'
  const scannedAt = report.scannedAt ?? report.result?.metadata?.scannedAt ?? ''
  const findings = report.findings ?? report.result?.findings ?? []
  const reportId = report.reportId ?? report.result?.reportId ?? ''
  const source = report.source ?? 'dashboard'
  const findingsCount = Array.isArray(findings) ? findings.length : 0

  const topFindings = Array.isArray(findings)
    ? (typeof findings[0] === 'string'
        ? (findings as string[]).slice(0, 2)
        : (findings as Finding[]).slice(0, 2).map(f => f.title))
    : []

  const verified = verdict === 'VERIFIED'

  const formattedDate = scannedAt
    ? new Date(scannedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : ''

  return (
    <Link href={`/agentverify/report?id=${encodeURIComponent(reportId)}`}>
      <div className="cursor-pointer rounded-xl border border-[#1E2D40] bg-[#0F1623] p-5 transition-colors hover:border-[#243244]">
        {/* Score bar at top */}
        <div className="mb-4 h-0.5 w-full rounded-full bg-[#1E2D40] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${verified ? 'bg-[#10B981]' : riskScore >= 50 ? 'bg-[#F59E0B]' : 'bg-[#EF4444]'}`}
            style={{ width: `${riskScore}%` }}
          />
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Badge variant={verified ? 'verified' : 'failed'}>{verdict}</Badge>
            {source === 'cli' && <Badge variant="cli">CLI</Badge>}
            <span className="font-mono text-xs text-[#4B6080]">{reportId.slice(0, 8)}...</span>
          </div>
          <span className="text-xs text-[#4B6080]">{formattedDate}</span>
        </div>

        <div className="mb-1">
          <span className="font-medium text-white">{fileName}</span>
        </div>

        <p className="mb-3 text-sm text-[#4B6080]">
          Score: <span className={`font-semibold ${verified ? 'text-[#10B981]' : riskScore >= 50 ? 'text-[#F59E0B]' : 'text-[#EF4444]'}`}>{riskScore}</span>/100 · {riskLevel}
        </p>

        <p className="mb-3 text-xs text-[#4B6080]">
          {findingsCount === 0
            ? 'No issues detected'
            : `${findingsCount} finding${findingsCount === 1 ? '' : 's'}`}
        </p>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {topFindings.map((title, i) => (
              <span key={i} className="rounded-full border border-[#1E2D40] bg-[#0D1117] px-2 py-0.5 text-xs text-[#4B6080]">
                {title}
              </span>
            ))}
          </div>
          <span className="text-xs text-[#4B6080] hover:text-white transition-colors">Open →</span>
        </div>
      </div>
        <br />
    </Link>
  )
}
