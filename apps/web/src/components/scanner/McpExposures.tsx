import type { McpToolExposure } from '@/types'

const riskColor: Record<McpToolExposure['riskLevel'], string> = {
  critical: 'bg-[#E03E3E]/10 text-[color:var(--accent-red-text)]',
  high: 'bg-[#E07B39]/10 text-[color:var(--accent-orange-text)]',
  medium: 'bg-[#7C3AED]/10 text-[color:var(--accent-purple-text)]',
  low: 'bg-[var(--text-muted)]/10 text-[var(--text-muted)]',
}

/** Agent -> MCP Server -> Tool -> Permission -> Potential Action, only when real evidence exists. */
export function McpExposures({ exposures }: { exposures: McpToolExposure[] }) {
  if (exposures.length === 0) return null

  return (
    <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mb-6 rounded-3xl p-6 shadow-xl shadow-black/5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-purple-text)]">MCP exposure</p>
      <h2 style={{ color: 'var(--text-primary)' }} className="mt-1 text-lg font-semibold">What this agent can access through MCP</h2>
      <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs leading-relaxed">Agent → MCP server → tool → potential action. Only servers/tools with concrete evidence in the submitted content are listed — an unidentified capability is shown as Unknown, never guessed.</p>
      <div className="mt-4 space-y-2">
        {exposures.map((exposure, i) => (
          <div key={`${exposure.toolName}-${i}`} style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">
                {exposure.server ? `${exposure.server} → ` : ''}{exposure.toolName}
              </p>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${riskColor[exposure.riskLevel]}`}>{exposure.riskLevel}</span>
            </div>
            <ul className="mt-2 space-y-1">
              {exposure.potentialActions.map(action => (
                <li key={action} style={{ color: 'var(--text-secondary)' }} className="text-xs leading-relaxed">• {action}</li>
              ))}
            </ul>
            {exposure.evidence && <code style={{ color: 'var(--text-muted)' }} className="mt-2 block truncate font-mono text-[11px]">{exposure.evidence}</code>}
          </div>
        ))}
      </div>
    </section>
  )
}
