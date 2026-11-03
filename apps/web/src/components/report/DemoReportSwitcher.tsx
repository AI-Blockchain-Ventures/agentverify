'use client'

import { useState } from 'react'
import { ReportView } from '@/components/report/ReportView'
import type { ScanResult } from '@/types'

export interface DemoSample { id: string; label: string; summary: string; content: string; result: ScanResult }

/** The public demo: one agent before, part-way through, and after fixing, each scanned by the real engine. */
export function DemoReportSwitcher({ samples }: { samples: DemoSample[] }) {
  const [activeId, setActiveId] = useState(samples[0]?.id)
  const active = samples.find(s => s.id === activeId) ?? samples[0]
  if (!active) return null
  const r = active.result

  return (
    <>
      <div className="mx-auto max-w-3xl px-4 md:px-6">
        <div role="tablist" aria-label="Demo versions" className="mt-4 grid grid-cols-3 gap-2">
          {samples.map(s => {
            const on = s.id === active.id
            const pass = s.result.verdict === 'VERIFIED'
            return (
              <button
                key={s.id}
                role="tab"
                aria-selected={on}
                onClick={() => setActiveId(s.id)}
                style={{ backgroundColor: on ? 'var(--card)' : 'var(--surface)', border: `1px solid ${on ? '#7C3AED' : 'var(--border)'}` }}
                className="rounded-2xl px-3 py-3 text-left transition-colors"
              >
                <span style={{ color: 'var(--text-muted)' }} className="block text-[11px] font-semibold uppercase tracking-wider">{s.label}</span>
                <span className={`mt-1 block text-2xl font-bold ${pass ? 'text-[color:var(--accent-green-text)]' : s.result.riskScore >= 40 ? 'text-[color:var(--accent-orange-text)]' : 'text-[color:var(--accent-red-text)]'}`}>
                  {s.result.riskScore}<span style={{ color: 'var(--text-muted)' }} className="text-xs font-medium">/100</span>
                </span>
                <span style={{ color: 'var(--text-secondary)' }} className="block text-xs">{pass ? 'Verified' : `${s.result.findings.length} finding${s.result.findings.length === 1 ? '' : 's'}`}</span>
              </button>
            )
          })}
        </div>
        <p style={{ color: 'var(--text-secondary)' }} className="mt-3 text-sm">{active.summary}</p>
        <details style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="mt-3 rounded-2xl px-4 py-3">
          <summary style={{ color: 'var(--text-primary)' }} className="cursor-pointer text-sm font-semibold">Show the code that was scanned</summary>
          <pre tabIndex={0} style={{ color: 'var(--text-secondary)' }} className="mt-3 max-h-96 overflow-auto whitespace-pre font-mono text-xs leading-relaxed">{active.content}</pre>
        </details>
      </div>
      <ReportView
        key={active.id}
        report={r as unknown as Record<string, unknown>}
        verdict={r.verdict}
        riskScore={r.riskScore}
        riskLevel={r.riskLevel}
        fileName={r.metadata.fileName}
        platform={r.metadata.selectedPlatform}
        scannedAt={r.metadata.scannedAt}
        source="dashboard"
        findings={r.findings}
        categoryScores={r.categoryScores}
        bom={r.bom}
        isOwner={false}
        reportUrl="https://aimodularity.com/agentverify/report/demo/"
      />
    </>
  )
}
