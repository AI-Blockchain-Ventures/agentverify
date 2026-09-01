export type ReportMode = 'executive' | 'security' | 'developer' | 'compliance' | 'json' | 'technical'

export const REPORT_MODES: Array<{ id: ReportMode; label: string; description: string }> = [
  { id: 'executive', label: 'Executive', description: 'A 60-second read for a CEO, CISO, buyer, or investor — verdict, top risks, what to fix first.' },
  { id: 'security', label: 'Security', description: 'The full security analysis — posture, categories, capability chains, MCP, controls, evidence.' },
  { id: 'developer', label: 'Developer', description: 'Action-oriented: file, line, what to fix, how, and example code for every finding.' },
  { id: 'compliance', label: 'Compliance', description: 'Findings mapped to NIST AI RMF, NIST CSF, OWASP LLM Top 10, and SOC 2 — evidence, not certification.' },
  { id: 'json', label: 'AI / JSON', description: 'The stable, schema-versioned machine-readable report for CI/CD, SIEM, and API clients.' },
  { id: 'technical', label: 'Full Technical', description: 'Everything Agent Verify knows about this scan, in one place.' },
]

export function ReportModeSelector({ mode, onChange }: { mode: ReportMode; onChange: (mode: ReportMode) => void }) {
  return (
    <div role="tablist" aria-label="Report view" className="no-print mb-6 flex flex-wrap gap-1.5 rounded-2xl p-1.5" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      {REPORT_MODES.map(m => (
        <button
          key={m.id}
          role="tab"
          aria-selected={mode === m.id}
          aria-label={m.label}
          title={m.description}
          onClick={() => onChange(m.id)}
          style={{
            backgroundColor: mode === m.id ? 'var(--text-primary)' : 'transparent',
            color: mode === m.id ? 'var(--bg)' : 'var(--text-muted)',
          }}
          className="rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors sm:text-sm"
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
