interface ChainLike {
  id: string
  title: string
  impact: string
  severity: 'critical' | 'high' | 'medium' | 'low'
}

const severityColor: Record<string, string> = {
  critical: 'border-l-[color:var(--accent-red-text)]',
  high: 'border-l-[color:var(--accent-orange-text)]',
  medium: 'border-l-[var(--text-muted)]',
  low: 'border-l-[var(--border)]',
}

/** "Potential Blast Radius" — dangerous combinations of capabilities, not just individual findings. */
export function BlastRadius({ chains }: { chains: ChainLike[] }) {
  if (chains.length === 0) return null

  return (
    <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mb-6 rounded-3xl p-6 shadow-xl shadow-black/5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-red-text)]">Potential blast radius</p>
      <h2 style={{ color: 'var(--text-primary)' }} className="mt-1 text-lg font-semibold">Dangerous capability combinations</h2>
      <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs leading-relaxed">Individual permissions often matter less than combinations. These are not claims that an exploit exists — only that this combination, if the agent is compromised or misused, could allow the described impact.</p>
      <div className="mt-4 space-y-2">
        {chains.map(chain => (
          <div key={chain.id} style={{ backgroundColor: 'var(--surface)' }} className={`rounded-xl border-l-4 p-4 ${severityColor[chain.severity]}`}>
            <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{chain.title}</p>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-xs leading-relaxed">{chain.impact}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
