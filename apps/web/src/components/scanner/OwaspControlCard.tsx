'use client'

import { useState } from 'react'
import type { ControlRow } from '@/lib/owaspProfile'
import { STATUS_LABEL, STATUS_MEANING, STATUS_STYLE, SEVERITY_LABEL, formatCoverage, formatConfidence } from '@/lib/owaspProfile'
import type { SkillEvidence } from '@/types/profileAssessment'

/** A small, reusable status pill — the ONLY place a status word is rendered, so EVIDENCE_OBSERVED / GAP_IDENTIFIED / NOT_ASSESSED always look and read the same everywhere on the page (requirement 3). Renders exactly the API's own status value; never a generic pass/fail. */
export function StatusPill({ status }: { status: 'EVIDENCE_OBSERVED' | 'GAP_IDENTIFIED' | 'NOT_ASSESSED' }) {
  const style = STATUS_STYLE[status]
  return (
    <span
      title={STATUS_MEANING[status]}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${style.badgeBg} ${style.badgeBorder} ${style.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  )
}

function evidenceFor(ids: string[], allEvidence: SkillEvidence[]): SkillEvidence[] {
  const set = new Set(ids)
  return allEvidence.filter(e => set.has(e.id))
}

/** One implemented control (AST02/AST03/AST04 today), expandable into its individual checks and evidence. */
function ImplementedControlCard({ row, allEvidence }: { row: Extract<ControlRow, { implemented: true }>; allEvidence: SkillEvidence[] }) {
  const [open, setOpen] = useState(false)
  const { control } = row
  const style = STATUS_STYLE[control.status]

  return (
    <div style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }} className={`w-full rounded-xl border p-5 text-left transition-colors ${style.badgeBorder} border-l-2`}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-start justify-between gap-3 text-left" aria-expanded={open} aria-controls={`${control.controlId}-detail`}>
        <div className="flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }} className="rounded px-1.5 py-0.5 font-mono text-xs font-semibold">
              {control.controlId}
            </span>
            <span style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{control.title}</span>
            <span style={{ color: 'var(--text-muted)' }} className="text-xs">{SEVERITY_LABEL[control.upstreamSeverity]}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={control.status} />
            <span style={{ color: 'var(--text-muted)' }} className="text-xs">{formatCoverage(control.coverage)}</span>
          </div>
          {!open && control.explanation && (
            <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs line-clamp-1">{control.explanation}</p>
          )}
        </div>
        <span style={{ color: 'var(--text-muted)' }} className="shrink-0 text-xs">{open ? '↑' : '↓'}</span>
      </button>

      {open && (
        <div id={`${control.controlId}-detail`} style={{ borderTop: '1px solid var(--border)' }} className="mt-4 space-y-4 pt-4 text-sm">
          {control.explanation && (
            <div>
              <span style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold uppercase tracking-wider">Summary</span>
              <p style={{ color: 'var(--text-secondary)' }} className="mt-1">{control.explanation}</p>
            </div>
          )}
          <div>
            <span style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold uppercase tracking-wider">Checks ({formatCoverage(control.coverage)})</span>
            <div className="mt-2 space-y-2">
              {control.checks.map(check => {
                const evidenceItems = evidenceFor(check.supportingEvidenceIds, allEvidence)
                return (
                  <div key={check.checkId} style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-lg p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span style={{ color: 'var(--text-muted)' }} className="font-mono text-xs">{check.checkId}</span>
                        <span style={{ color: 'var(--text-primary)' }} className="text-xs font-medium">{check.title}</span>
                      </div>
                      <StatusPill status={check.status} />
                    </div>
                    {check.explanation && <p style={{ color: 'var(--text-secondary)' }} className="mt-1.5 text-xs">{check.explanation}</p>}
                    <p style={{ color: 'var(--text-muted)' }} className="mt-1.5 text-[11px]">
                      Confidence: {formatConfidence(check.confidence)}{check.provenance.length > 0 ? ` · ${check.provenance.join(', ')}` : ''}
                    </p>
                    {evidenceItems.length > 0 && (
                      <div className="mt-2 space-y-2">
                        {evidenceItems.map(ev => (
                          <div key={ev.id} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-md p-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wide">Evidence — {ev.axis}</span>
                              <span style={{ color: 'var(--text-muted)' }} className="text-[11px]">{formatConfidence(ev.confidence)} confidence</span>
                            </div>
                            <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-xs">{ev.summary}</p>
                            {ev.expected && (
                              <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-[11px]"><span className="font-semibold">Expected: </span>{ev.expected}</p>
                            )}
                            {ev.remediation && (
                              <p className="mt-1 text-[11px] text-[color:var(--accent-green-text)]"><span className="font-semibold">Remediation: </span>{ev.remediation}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** A control this profile version does not implement — always renders NOT_ASSESSED, never hidden, never implying a pass. */
function NotAssessedControlCard({ row }: { row: Extract<ControlRow, { implemented: false }> }) {
  const style = STATUS_STYLE.NOT_ASSESSED
  return (
    <div style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }} className={`w-full rounded-xl border border-l-2 p-5 opacity-80 ${style.badgeBorder}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }} className="rounded px-1.5 py-0.5 font-mono text-xs font-semibold">
          {row.id}
        </span>
        <span style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{row.title}</span>
        <span style={{ color: 'var(--text-muted)' }} className="text-xs">{SEVERITY_LABEL[row.severity]}</span>
      </div>
      <div className="mt-2">
        <StatusPill status="NOT_ASSESSED" />
      </div>
      <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs">Not implemented in this profile version — no evidence was collected for this control. This is not a pass.</p>
    </div>
  )
}

export function OwaspControlCard({ row, allEvidence }: { row: ControlRow; allEvidence: SkillEvidence[] }) {
  return row.implemented ? <ImplementedControlCard row={row} allEvidence={allEvidence} /> : <NotAssessedControlCard row={row} />
}
