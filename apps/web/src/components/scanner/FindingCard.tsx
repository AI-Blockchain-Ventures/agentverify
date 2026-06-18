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
  const categoryLabel = finding.category === 'A' ? 'Protocol' : 'Security'

  return (
    <button
      onClick={() => setOpen(!open)}
      style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
      className={`w-full rounded-xl border p-5 text-left transition-colors hover:opacity-90 ${
        isA ? 'border-l-2 border-l-[#EF4444]' : 'border-l-2 border-l-[#F59E0B]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className={`h-2 w-2 rounded-full shrink-0 ${severityColors[finding.severity] ?? 'bg-[#4B6080]'}`} />
            <span style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }} className="rounded px-1.5 py-0.5 text-xs font-medium">
              {categoryLabel}
            </span>
            <span style={{ color: 'var(--text-muted)' }} className="text-xs">{severityLabel[finding.severity]}</span>
            <span style={{ color: 'var(--text-primary)' }} className="text-sm font-medium">{finding.title}</span>
          </div>
          {!open && (
            <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs line-clamp-1">{finding.whatIsWrong}</p>
          )}
        </div>
        <span style={{ color: 'var(--text-muted)' }} className="shrink-0 text-xs">{open ? '↑' : '↓'}</span>
      </div>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)' }} className="mt-4 space-y-3 pt-4 text-sm">
          <div>
            <span style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold uppercase tracking-wider">What&apos;s wrong</span>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-1">{finding.whatIsWrong}</p>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold uppercase tracking-wider">Why it matters</span>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-1">{finding.whyItMatters}</p>
          </div>
          {finding.evidence && (
            <div>
              <span style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold uppercase tracking-wider">Evidence</span>
              <pre style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)' }} className="mt-1 overflow-x-auto rounded-lg px-3 py-2 font-mono text-xs text-[#06B6D4]">
                {finding.evidence}
              </pre>
            </div>
          )}
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-[#10B981]">Recommended Fix</span>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-1">{finding.recommendedFix}</p>
          </div>
          {finding.quickFix && (
            <div className="mt-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#00B37E]">Quick Fix</span>
              <pre className="mt-1.5 overflow-x-auto rounded-lg border border-[#00B37E]/20 bg-[#00B37E]/5 px-4 py-3 font-mono text-xs leading-relaxed text-[#00B37E]">
                {finding.quickFix}
              </pre>
            </div>
          )}
          {finding.fixCode && (
            <div>
              <span style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold uppercase tracking-wider">Fix Example</span>
              <pre style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)' }} className="mt-2 overflow-x-auto rounded-lg px-4 py-3 font-mono text-xs leading-relaxed text-[#10B981]">
                {finding.fixCode}
              </pre>
            </div>
          )}
          {isA && (
            <div className="mt-3 rounded-lg border border-[#00C4CC]/20 bg-[#00C4CC]/5 p-3">
              <p className="mb-1 text-xs font-semibold text-[#00C4CC]">Protocol-Level Fix Available</p>
              <p style={{ color: 'var(--text-secondary)' }} className="text-xs">
                This is a protocol-level security control. Multiple implementation approaches exist.
                Contact us for guidance on the right solution for your stack.
              </p>
              <a href="mailto:hello@aiblockchainventures.com" className="mt-1 inline-block text-xs text-[#00C4CC] hover:underline">
                hello@aiblockchainventures.com →
              </a>
            </div>
          )}
          {(finding.compliance?.owasp?.length || finding.compliance?.nist?.length || finding.compliance?.soc2?.length) && (
            <div className="mt-3">
              <span style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold uppercase tracking-wider">Compliance</span>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {finding.compliance?.owasp?.map(tag => (
                  <span key={tag} className="rounded border border-[#E07B39]/20 bg-[#E07B39]/5 px-2 py-0.5 text-xs text-[#E07B39]">OWASP {tag}</span>
                ))}
                {finding.compliance?.nist?.map(tag => (
                  <span key={tag} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }} className="rounded px-2 py-0.5 text-xs">NIST {tag}</span>
                ))}
                {finding.compliance?.soc2?.map(tag => (
                  <span key={tag} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }} className="rounded px-2 py-0.5 text-xs">SOC 2 {tag}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </button>
  )
}
