import type { NormalizedReport } from '@/lib/normalizeReport'
import { buildComplianceMapping, notAssessedControls, type ComplianceFramework, type ComplianceStatus } from '@/lib/complianceMapping'

const FRAMEWORKS: Array<{ key: ComplianceFramework; label: string; blurb: string }> = [
  { key: 'OWASP_LLM', label: 'OWASP LLM Top 10', blurb: 'OWASP\'s Top 10 risks for large language model applications.' },
  { key: 'NIST_AI_RMF', label: 'NIST AI Risk Management Framework (AI RMF)', blurb: 'GOVERN / MAP / MEASURE / MANAGE functions from NIST AI 100-1.' },
  { key: 'SOC2', label: 'SOC 2 Trust Services Criteria', blurb: 'Security-relevant Trust Services Criteria (the Security/Common Criteria series).' },
]

const STATUS_STYLE: Record<ComplianceStatus, { label: string; color: string; border: string }> = {
  GAP_IDENTIFIED: { label: 'Gap identified', color: 'var(--accent-red-text)', border: '#E03E3E33' },
  EVIDENCE_OBSERVED: { label: 'Evidence observed', color: 'var(--accent-green-text)', border: '#00B37E33' },
  NOT_ASSESSED: { label: 'Not assessed', color: 'var(--text-muted)', border: 'var(--border)' },
  NOT_APPLICABLE: { label: 'Not applicable', color: 'var(--text-muted)', border: 'var(--border)' },
}

/**
 * Compliance Report — a real evidence-mapping layer (src/lib/complianceMapping.ts), not a re-render
 * of finding labels. Every row traces to either a real finding that fired in this scan
 * (GAP_IDENTIFIED) or a documented, narrow inference from a genuinely clean category scan
 * (EVIDENCE_OBSERVED, always confidence: medium) — never "Compliant", never a certification claim.
 * A control with neither kind of evidence is shown as NOT_ASSESSED, not silently omitted.
 */
export function ComplianceReportView({ data }: { data: NormalizedReport }) {
  const mapping = buildComplianceMapping(data.findings, data.securityCategories)
  const byFramework = (fw: ComplianceFramework) => mapping.filter(m => m.framework === fw)
  const findingById = new Map(data.findings.map(f => [f.id, f]))

  return (
    <div className="space-y-6">
      <section style={{ backgroundColor: 'var(--card)', border: '1px solid #E07B3933' }} className="rounded-2xl p-5">
        <p className="text-sm font-semibold text-[color:var(--accent-orange-text)]">This is not a compliance certification</p>
        <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-sm leading-relaxed">
          Every row below is <strong>evidence observed</strong>, a <strong>gap identified</strong>, or <strong>not assessed</strong> — never
          &quot;compliant&quot; or &quot;certified&quot;. A gap traces to one exact finding from this scan; evidence observed means a full
          check set ran and found nothing wrong, which is real signal but still not a guarantee. Not assessed means this scan produced
          no evidence either way for that control — it is not the same as passing.
        </p>
      </section>

      {FRAMEWORKS.map(fw => {
        const items = byFramework(fw.key)
        return (
          <section key={fw.key} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-5">
            <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{fw.label}</p>
            <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-xs">{fw.blurb}</p>
            {items.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs italic">Not assessed — no finding in this scan mapped to a control in this framework, and no clean-category evidence was available either.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr style={{ color: 'var(--text-muted)' }} className="uppercase tracking-wider">
                      <th className="py-1.5 pr-3 font-medium">Control</th>
                      <th className="py-1.5 pr-3 font-medium">Status</th>
                      <th className="py-1.5 pr-3 font-medium">Confidence</th>
                      <th className="py-1.5 pr-3 font-medium">Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row, i) => {
                      const style = STATUS_STYLE[row.status]
                      const findingTitles = row.supportingFindingIds.map(id => findingById.get(id)?.title).filter(Boolean)
                      return (
                        <tr key={`${row.controlId}-${i}`} style={{ borderTop: '1px solid var(--border)' }}>
                          <td className="py-2 pr-3 align-top" style={{ color: 'var(--text-secondary)' }}>{row.controlId}</td>
                          <td className="py-2 pr-3 align-top">
                            <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: 'var(--surface)', border: `1px solid ${style.border}`, color: style.color }}>{style.label}</span>
                          </td>
                          <td className="py-2 pr-3 align-top" style={{ color: 'var(--text-muted)' }}>{row.confidence}</td>
                          <td className="py-2 pr-3 align-top" style={{ color: 'var(--text-primary)' }}>
                            {findingTitles.length > 0 ? findingTitles.join(', ') : row.explanation}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

/** Merges a caller-supplied "known controls" catalog with a scan's real mapping so genuinely
 * un-touched controls render as NOT_ASSESSED instead of disappearing. Exported for callers (e.g. a
 * future org-level compliance rollup) that want the complete picture, not just what fired. */
export function withNotAssessed(data: NormalizedReport, knownControls: Array<{ framework: ComplianceFramework; controlId: string }>) {
  const mapping = buildComplianceMapping(data.findings, data.securityCategories)
  return [...mapping, ...notAssessedControls(mapping, knownControls)]
}
