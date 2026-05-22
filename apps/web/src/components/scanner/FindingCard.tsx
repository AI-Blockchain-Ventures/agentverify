'use client'

import { useState } from 'react'
import type { Finding } from '@/types'

const severityColors: Record<string, string> = {
  critical: 'bg-[#EF4444]',
  high: 'bg-[#F59E0B]',
  medium: 'bg-yellow-500',
  low: 'bg-[#4B6080]',
}

const severityLabel: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export function FindingCard({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false)
  const isA = finding.category === 'A'

  return (
    <button
      onClick={() => setOpen(!open)}
      className={`w-full rounded-xl border border-[#1E2D40] bg-[#0F1623] p-5 text-left transition-colors hover:border-[#243244] ${
        isA ? 'border-l-2 border-l-[#EF4444]' : 'border-l-2 border-l-[#F59E0B]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className={`h-2 w-2 rounded-full shrink-0 ${severityColors[finding.severity] ?? 'bg-[#4B6080]'}`} />
            <span className="rounded border border-[#1E2D40] bg-[#0D1117] px-1.5 py-0.5 text-xs font-medium text-[#94A3B8]">
              {isA ? 'A2SPA' : 'Security'}
            </span>
            <span className="text-xs text-[#4B6080]">{severityLabel[finding.severity]}</span>
            <span className="text-sm font-medium text-white">{finding.title}</span>
          </div>
          {!open && (
            <p className="mt-1 text-xs text-[#4B6080] line-clamp-1">{finding.whatIsWrong}</p>
          )}
        </div>
        <span className="shrink-0 text-xs text-[#4B6080]">{open ? '↑' : '↓'}</span>
      </div>

      {open && (
        <div className="mt-4 space-y-3 border-t border-[#1E2D40] pt-4 text-sm">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-[#4B6080]">What&apos;s wrong</span>
            <p className="mt-1 text-[#94A3B8]">{finding.whatIsWrong}</p>
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-[#4B6080]">Why it matters</span>
            <p className="mt-1 text-[#94A3B8]">{finding.whyItMatters}</p>
          </div>
          {finding.evidence && (
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-[#4B6080]">Evidence</span>
              <pre className="mt-1 overflow-x-auto rounded-lg bg-[#080B14] border border-[#1E2D40] px-3 py-2 font-mono text-xs text-[#06B6D4]">
                {finding.evidence}
              </pre>
            </div>
          )}
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-[#10B981]">Recommended Fix</span>
            <p className="mt-1 text-[#94A3B8]">{finding.recommendedFix}</p>
          </div>
          {finding.fixCode && (
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-[#4B6080]">Fix Example</span>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-[#1E2D40] bg-[#080B14] px-4 py-3 font-mono text-xs leading-relaxed text-[#10B981]">
                {finding.fixCode}
              </pre>
            </div>
          )}
          {finding.a2spaFix && (
            <div className="rounded-lg border border-[#06B6D4]/20 bg-[#06B6D4]/5 p-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#06B6D4]">A2SPA Fix</span>
              <p className="mt-1 text-sm text-[#94A3B8]">{finding.a2spaFix}</p>
            </div>
          )}
        </div>
      )}
    </button>
  )
}
