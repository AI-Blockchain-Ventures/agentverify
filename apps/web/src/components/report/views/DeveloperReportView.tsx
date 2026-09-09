import type { NormalizedReport } from '@/lib/normalizeReport'

const evidenceTypeLabel: Record<string, string> = {
  definite: 'Definite',
  heuristic: 'Heuristic',
  informational: 'Informational',
}

const severityColor: Record<string, string> = {
  critical: 'text-[color:var(--accent-red-text)]',
  high: 'text-[color:var(--accent-orange-text)]',
  medium: 'text-[var(--text-secondary)]',
  low: 'text-[var(--text-muted)]',
}

/**
 * Developer Report — the report to have open while actually fixing an agent. One card per
 * finding, ordered by severity, with file/line/what/why/could-do/fix/confidence/rule ID/how-to-
 * verify/machine-readable metadata always visible — no expand/collapse, no summarizing. Same
 * findings array as every other view. Where context genuinely isn't available (e.g. no line
 * number was locatable in the submitted content), this says "Not available" explicitly rather
 * than omitting the row or guessing a value.
 */
export function DeveloperReportView({ data }: { data: NormalizedReport }) {
  const sorted = [...data.findings].sort((a, b) => {
    const rank = { critical: 4, high: 3, medium: 2, low: 1 }
    return rank[b.severity] - rank[a.severity]
  })

  if (sorted.length === 0) {
    return (
      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-6 text-center">
        <p style={{ color: 'var(--text-muted)' }} className="text-sm">No findings to fix.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p style={{ color: 'var(--text-muted)' }} className="text-xs">{sorted.length} finding{sorted.length === 1 ? '' : 's'}, ordered by severity. File: {data.fileName}.</p>
      {sorted.map(f => {
        const fixSnippet = f.fixCode || f.quickFix
        return (
          <div key={f.id} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold uppercase ${severityColor[f.severity]}`}>{f.severity}</span>
                <span style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{f.title}</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                <code className="rounded px-1.5 py-0.5" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>{f.code}</code>
                {f.evidenceType && <span>{evidenceTypeLabel[f.evidenceType]} confidence</span>}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span><strong style={{ color: 'var(--text-secondary)' }}>File:</strong> {data.fileName}</span>
              <span><strong style={{ color: 'var(--text-secondary)' }}>Line:</strong> {typeof f.line === 'number' ? f.line : 'Not available'}</span>
              <span><strong style={{ color: 'var(--text-secondary)' }}>Component/context:</strong> {f.capabilityImpact ? 'See "What the agent could do" below' : 'Not available'}</span>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wider">What is wrong</p>
                <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-sm">{f.whatIsWrong}</p>
              </div>
              <div>
                <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wider">Why it matters</p>
                <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-sm">{f.whyItMatters}</p>
              </div>
            </div>
            {f.capabilityImpact && (
              <div className="mt-3">
                <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wider">What the agent could do because of this</p>
                <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-sm">{f.capabilityImpact}</p>
              </div>
            )}
            {f.evidence && (
              <div className="mt-3">
                <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wider">Evidence</p>
                <code style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--accent-cyan-text)' }} className="mt-1 block overflow-x-auto rounded-lg px-3 py-2 font-mono text-xs">{f.evidence}</code>
              </div>
            )}
            <div className="mt-3">
              <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wider">How to fix it</p>
              <p style={{ color: 'var(--text-secondary)' }} className="mt-1 whitespace-pre-line text-sm">{f.recommendedFix}</p>
            </div>
            {fixSnippet && (
              <div className="mt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--accent-green-text)]">Example fix</p>
                <pre tabIndex={0} role="region" aria-label="Example fix code" className="mt-1 overflow-x-auto rounded-lg border border-[#00B37E]/20 bg-[#00B37E]/5 px-3 py-2 font-mono text-xs leading-relaxed text-[color:var(--accent-green-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#06B6D4]">{fixSnippet}</pre>
              </div>
            )}
            <div className="mt-3">
              <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wider">How to verify the fix</p>
              <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-sm">Re-scan this agent after applying the change. A passing re-scan means check <code>{f.code}</code> no longer fired — that specific gap is closed. A future scan is not guaranteed to pass overall, since other findings and evidence can still change independently.</p>
            </div>
            <details className="mt-3">
              <summary style={{ color: 'var(--text-muted)' }} className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider">Machine-readable remediation metadata</summary>
              <pre tabIndex={0} role="region" aria-label="Machine-readable remediation metadata" className="mt-1 overflow-x-auto rounded-lg px-3 py-2 font-mono text-[11px] leading-relaxed" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--accent-cyan-text)' }}>
                {JSON.stringify({
                  ruleId: f.code,
                  severity: f.severity,
                  confidence: f.evidenceType ?? 'heuristic',
                  category: f.securityCategory ?? null,
                  file: data.fileName,
                  line: typeof f.line === 'number' ? f.line : null,
                  fixAvailable: Boolean(fixSnippet),
                  verify: 're-scan and confirm this ruleId no longer appears in findings',
                }, null, 2)}
              </pre>
            </details>
          </div>
        )
      })}
    </div>
  )
}
