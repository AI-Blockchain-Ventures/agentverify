import type { NormalizedReport } from '@/lib/normalizeReport'
import type { Finding } from '@/types'

interface ComplianceRow {
  framework: string
  control: string
  status: 'Potential Gap' | 'Evidence Found'
  evidence: string
  relatedFinding: string
  severity: Finding['severity']
}

const FRAMEWORKS: Array<{ key: 'owasp' | 'nist' | 'soc2'; label: string; blurb: string }> = [
  { key: 'owasp', label: 'OWASP LLM Top 10', blurb: 'OWASP\'s Top 10 risks for large language model applications.' },
  { key: 'nist', label: 'NIST AI Risk Management Framework (AI RMF)', blurb: 'GOVERN / MAP / MEASURE / MANAGE functions from NIST AI 100-1.' },
  { key: 'soc2', label: 'SOC 2 Trust Services Criteria', blurb: 'Security-relevant Trust Services Criteria (the Security/Common Criteria series).' },
]

function buildRows(findings: Finding[]): Record<string, ComplianceRow[]> {
  const byFramework: Record<string, ComplianceRow[]> = { owasp: [], nist: [], soc2: [] }
  for (const finding of findings) {
    if (!finding.compliance) continue
    for (const key of ['owasp', 'nist', 'soc2'] as const) {
      const tags = finding.compliance[key]
      if (!tags) continue
      for (const tag of tags) {
        byFramework[key].push({
          framework: key,
          control: tag,
          status: 'Potential Gap',
          evidence: finding.evidence || finding.whatIsWrong,
          relatedFinding: finding.title,
          severity: finding.severity,
        })
      }
    }
  }
  return byFramework
}

/**
 * Compliance Report — findings mapped to real, cited framework controls. This is deliberately
 * NOT a certification: nothing here says "Compliant". A finding maps to a control as a
 * "Potential Gap" (evidence the control may not be met); a detected security control maps as
 * "Evidence Found" for a good-practice signal. Frameworks with no mapped items for this scan are
 * shown as "not evaluated" rather than silently omitted, so the absence is visible, not implied
 * to mean "passed everything".
 */
export function ComplianceReportView({ data }: { data: NormalizedReport }) {
  const rows = buildRows(data.findings)
  const controlRows = data.securityControlsDetected.map(c => ({
    framework: '—', control: c.label, status: 'Evidence Found' as const, evidence: c.evidence, relatedFinding: '—', severity: 'low' as const,
  }))

  return (
    <div className="space-y-6">
      <section style={{ backgroundColor: 'var(--card)', border: '1px solid #E07B3933' }} className="rounded-2xl p-5">
        <p className="text-sm font-semibold text-[color:var(--accent-orange-text)]">This is not a compliance certification</p>
        <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-sm leading-relaxed">
          Every row below says <strong>evidence relevant to</strong> a control, or a <strong>potential gap</strong> against one — never
          &quot;compliant&quot;. Static analysis of submitted content cannot prove organization-wide compliance with any framework; it can
          only show what evidence this specific scan did or didn&apos;t find. Controls with no mapped item here were not evaluated by this
          scan, not passed.
        </p>
      </section>

      {FRAMEWORKS.map(fw => {
        const items = rows[fw.key]
        return (
          <section key={fw.key} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-5">
            <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{fw.label}</p>
            <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-xs">{fw.blurb}</p>
            {items.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs italic">Not evaluated — no finding in this scan mapped to a control in this framework.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr style={{ color: 'var(--text-muted)' }} className="uppercase tracking-wider">
                      <th className="py-1.5 pr-3 font-medium">Control</th>
                      <th className="py-1.5 pr-3 font-medium">Status</th>
                      <th className="py-1.5 pr-3 font-medium">Related finding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row, i) => (
                      <tr key={`${row.control}-${i}`} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className="py-2 pr-3" style={{ color: 'var(--text-secondary)' }}>{row.control}</td>
                        <td className="py-2 pr-3"><span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: 'var(--surface)', border: '1px solid #E07B3933', color: 'var(--accent-orange-text)' }}>Potential Gap</span></td>
                        <td className="py-2 pr-3" style={{ color: 'var(--text-primary)' }}>{row.relatedFinding}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )
      })}

      {controlRows.length > 0 && (
        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-5">
          <p className="text-sm font-semibold text-[color:var(--accent-green-text)]">Evidence found (positive signals)</p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-xs">Detected controls this scan found evidence of. Not yet mapped to specific framework citations.</p>
          <ul className="mt-3 space-y-1.5">
            {controlRows.map((c, i) => <li key={i} style={{ color: 'var(--text-secondary)' }} className="text-sm">• {c.control}</li>)}
          </ul>
        </section>
      )}
    </div>
  )
}
