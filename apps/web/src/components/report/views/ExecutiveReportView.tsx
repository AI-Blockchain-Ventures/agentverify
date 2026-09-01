import type { NormalizedReport } from '@/lib/normalizeReport'
import { Badge } from '@/components/ui/Badge'

/**
 * Executive Report — for a CEO, CISO, CTO, buyer, or investor. Everything on this page must be
 * understandable in about 60 seconds by someone who has never read a security finding before.
 * No raw evidence, no regex, no code snippets — those live in the Security/Developer/Technical
 * views, all built from this exact same normalized evidence.
 */
export function ExecutiveReportView({ data, agentName, onSwitchToDeveloper }: { data: NormalizedReport; agentName?: string | null; onSwitchToDeveloper?: () => void }) {
  const { verified, riskScore, reportInsights, capabilities, mcpExposures, capabilityChains, securityControlsDetected, criticalCount, highCount, bom } = data
  const topRisks = reportInsights.highestRisks.slice(0, 5)
  const fixFirst = reportInsights.fixPriority.filter(f => f.priority === 'fix_first').slice(0, 3)
  const name = agentName || bom.agentName || 'This agent'

  return (
    <div className="space-y-6">
      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className={`rounded-3xl p-6 shadow-xl shadow-black/5 md:p-8 ${verified ? 'bg-[#10B981]/8' : 'bg-[#EF4444]/8'}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Badge variant={verified ? 'verified' : 'failed'}>{verified ? 'VERIFIED' : 'NOT VERIFIED'}</Badge>
            <h1 style={{ color: 'var(--text-primary)' }} className="mt-3 text-2xl font-bold tracking-tight md:text-3xl">{name}</h1>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-2 max-w-xl text-sm leading-relaxed">
              {verified
                ? 'This agent showed the execution trust controls Agent Verify checks for. Findings and evidence are in the Security view.'
                : 'This agent has gaps that should be closed before it is connected to production tools, payments, deployments, or sensitive data.'}
            </p>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="shrink-0 rounded-2xl px-6 py-4 text-center">
            <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-medium uppercase tracking-widest">Security score</p>
            <p style={{ color: 'var(--text-primary)' }} className="mt-1 text-4xl font-bold">{riskScore}<span style={{ color: 'var(--text-muted)' }} className="text-lg">/100</span></p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-5">
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">What this agent can do</p>
          {capabilities.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs">No consequential capabilities were detected.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {capabilities.slice(0, 8).map(c => <li key={c.id} style={{ color: 'var(--text-secondary)' }} className="text-sm">• {c.label}</li>)}
            </ul>
          )}
        </section>
        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-5">
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">What it can access</p>
          {mcpExposures.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs">No external tool/MCP connections were detected. Tool access level: {bom.toolAccessLevel}.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {mcpExposures.slice(0, 8).map((m, i) => <li key={`${m.toolName}-${i}`} style={{ color: 'var(--text-secondary)' }} className="text-sm">• {m.toolName}{m.server ? ` (${m.server})` : ''}</li>)}
            </ul>
          )}
        </section>
      </div>

      {topRisks.length > 0 && (
        <section style={{ backgroundColor: 'var(--card)', border: '1px solid #E03E3E33' }} className="rounded-3xl p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-red-text)]">Top risks</p>
          <h2 style={{ color: 'var(--text-primary)' }} className="mt-1 text-lg font-semibold">{topRisks.length} thing{topRisks.length === 1 ? '' : 's'} to know right now</h2>
          <ol className="mt-3 space-y-2">
            {topRisks.map((title, i) => (
              <li key={title} className="flex items-start gap-3 rounded-xl px-4 py-2.5" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E03E3E]/10 text-xs font-bold text-[color:var(--accent-red-text)]">{i + 1}</span>
                <span style={{ color: 'var(--text-primary)' }} className="text-sm font-medium">{title}</span>
              </li>
            ))}
          </ol>
          <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">{criticalCount} critical, {highCount} high-severity finding{highCount === 1 ? '' : 's'} in total.</p>
        </section>
      )}

      {capabilityChains.length > 0 && (
        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-5">
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Consequential capability combinations</p>
          <ul className="mt-2 space-y-1.5">
            {capabilityChains.slice(0, 5).map(c => <li key={c.id} style={{ color: 'var(--text-secondary)' }} className="text-sm">• {c.title}</li>)}
          </ul>
        </section>
      )}

      {securityControlsDetected.length > 0 && (
        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-5">
          <p className="text-sm font-semibold text-[color:var(--accent-green-text)]">Security controls detected</p>
          <ul className="mt-2 space-y-1.5">
            {securityControlsDetected.slice(0, 6).map(c => <li key={c.id} style={{ color: 'var(--text-secondary)' }} className="text-sm">• {c.label}</li>)}
          </ul>
        </section>
      )}

      {fixFirst.length > 0 && (
        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-5">
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Fix first</p>
          <ol className="mt-2 space-y-1.5">
            {fixFirst.map((item, i) => <li key={item.title} style={{ color: 'var(--text-secondary)' }} className="text-sm">{i + 1}. {item.title}</li>)}
          </ol>
          {onSwitchToDeveloper && <button onClick={onSwitchToDeveloper} className="mt-3 text-xs font-semibold text-[color:var(--accent-cyan-text)] hover:opacity-80">See the Developer view for exactly how to fix each one →</button>}
        </section>
      )}

      <p style={{ color: 'var(--text-muted)' }} className="text-center text-xs">Scan-to-scan change history is in the Security view when a previous scan of this agent exists.</p>
    </div>
  )
}
