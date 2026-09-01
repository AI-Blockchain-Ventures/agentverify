import type { AgentCapability } from '@/types'

const confidenceLabel: Record<AgentCapability['confidence'], string> = {
  definite: 'Detected',
  heuristic: 'Likely',
  informational: 'Context',
}

const confidenceColor: Record<AgentCapability['confidence'], string> = {
  definite: 'text-[color:var(--accent-red-text)]',
  heuristic: 'text-[color:var(--accent-orange-text)]',
  informational: 'text-[var(--text-muted)]',
}

/** "What could this agent actually do if compromised?" — only ever from concrete evidence. */
export function Capabilities({ capabilities }: { capabilities: AgentCapability[] }) {
  if (capabilities.length === 0) {
    return (
      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mb-6 rounded-3xl p-6 shadow-xl shadow-black/5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-purple-text)]">Capabilities</p>
        <h2 style={{ color: 'var(--text-primary)' }} className="mt-1 text-lg font-semibold">What this agent can do</h2>
        <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-sm">No consequential capabilities were detected in the submitted content.</p>
      </section>
    )
  }

  return (
    <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mb-6 rounded-3xl p-6 shadow-xl shadow-black/5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-purple-text)]">Capabilities</p>
      <h2 style={{ color: 'var(--text-primary)' }} className="mt-1 text-lg font-semibold">What this agent can do</h2>
      <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs leading-relaxed">Derived only from concrete evidence in the submitted content — this is what an attacker could use, not a judgment about whether it&apos;s appropriate.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {capabilities.map(cap => (
          <div key={cap.id} style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-xl p-3">
            <div className="flex items-start justify-between gap-2">
              <p style={{ color: 'var(--text-primary)' }} className="text-sm font-medium">{cap.label}</p>
              <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wider ${confidenceColor[cap.confidence]}`}>{confidenceLabel[cap.confidence]}</span>
            </div>
            {cap.evidence && <code style={{ color: 'var(--text-muted)' }} className="mt-1 block truncate font-mono text-[11px]">{cap.evidence}</code>}
          </div>
        ))}
      </div>
    </section>
  )
}
