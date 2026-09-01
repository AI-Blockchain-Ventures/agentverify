import type { AgentCapability, McpToolExposure, CapabilityChain, SecurityControl, RuntimeBOM } from '@/types'

interface MissingControl {
  label: string
}

/**
 * Derives "missing controls" only from BOM fields the scanner explicitly resolved to a negative
 * state (Absent / Unrestricted / Unscoped / Unbounded / credentials Detected in source) — never
 * from 'Unknown'. An Unknown BOM field means static analysis couldn't determine the answer, which
 * is not the same claim as "this control is missing"; those already surface honestly in the
 * "What Agent Verify could not determine" section (ControlsAndLimits) instead of being guessed
 * into a stronger claim here.
 */
function deriveMissingControls(bom: RuntimeBOM | null | undefined): MissingControl[] {
  if (!bom) return []
  const out: MissingControl[] = []
  if (bom.humanGates === 'Absent') out.push({ label: 'No human-in-the-loop gate on consequential actions' })
  if (bom.rateLimiting === 'Absent') out.push({ label: 'No execution rate limiting' })
  if (bom.auditLogging === 'Absent') out.push({ label: 'No audit logging' })
  if (bom.toolAccessLevel === 'Unrestricted') out.push({ label: 'Tool access is unrestricted' })
  if (bom.credentialExposure === 'Detected') out.push({ label: 'Credentials exposed in source' })
  if (bom.memoryPersistence === 'Unbounded') out.push({ label: 'Unbounded memory persistence' })
  if (bom.delegationScope === 'Unscoped') out.push({ label: 'Unscoped delegation to sub-agents or tools' })
  return out
}

function hasUnknownBomField(bom: RuntimeBOM | null | undefined): boolean {
  if (!bom) return false
  return Object.values(bom).some(v => v === 'Unknown')
}

/**
 * "What authority does this agent have?" — the single clearest answer Agent Verify gives, built
 * entirely from the same evidence already rendered below (Capabilities, McpExposures, BlastRadius,
 * ControlsAndLimits) and never fabricated independently of it. Kept as a plain stacked list by
 * design — the four questions are the point, not a diagram.
 */
export function AuthoritySummary({
  capabilities,
  mcpExposures,
  capabilityChains,
  controlsDetected,
  bom,
}: {
  capabilities: AgentCapability[]
  mcpExposures: McpToolExposure[]
  capabilityChains: CapabilityChain[]
  controlsDetected: SecurityControl[]
  bom: RuntimeBOM | null | undefined
}) {
  const canDo = capabilities.map(c => c.label)

  const consequentialActions = Array.from(new Set([
    ...capabilityChains.map(c => c.title),
    ...mcpExposures.flatMap(e => e.potentialActions),
  ]))

  const missingControls = deriveMissingControls(bom)
  const hasUnknown = hasUnknownBomField(bom)

  if (canDo.length === 0 && consequentialActions.length === 0 && controlsDetected.length === 0 && missingControls.length === 0) {
    return null
  }

  const rows: { key: string; heading: string; accent: string; items: string[]; empty: string }[] = [
    { key: 'can', heading: 'This agent can', accent: 'var(--accent-purple-text)', items: canDo, empty: 'No consequential capabilities detected.' },
    { key: 'consequential', heading: 'Consequential actions', accent: 'var(--accent-red-text)', items: consequentialActions, empty: 'No dangerous capability combinations detected.' },
    { key: 'detected', heading: 'Controls detected', accent: 'var(--accent-green-text)', items: controlsDetected.map(c => c.label), empty: 'None detected.' },
    { key: 'missing', heading: 'Missing controls', accent: 'var(--accent-orange-text)', items: missingControls.map(m => m.label), empty: 'None identified.' },
  ]

  return (
    <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mb-6 overflow-hidden rounded-3xl shadow-2xl shadow-black/10">
      <div style={{ borderBottom: '1px solid var(--border)' }} className="p-6 pb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-cyan-text)]">Authority summary</p>
        <h2 style={{ color: 'var(--text-primary)' }} className="mt-1 text-lg font-semibold">What authority does this agent have?</h2>
        <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs leading-relaxed">Every line below comes from the evidence in this scan — nothing here is inferred beyond what&apos;s shown in Capabilities, MCP exposure, blast radius, and controls further down this page.</p>
      </div>
      <div className="grid gap-px sm:grid-cols-2" style={{ backgroundColor: 'var(--border)' }}>
        {rows.map(row => (
          <div key={row.key} style={{ backgroundColor: 'var(--card)' }} className="p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: row.accent }}>{row.heading}</p>
            {row.items.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-sm">{row.empty}</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {row.items.map(item => (
                  <li key={item} className="flex items-start gap-2 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: row.accent }} />
                    <span style={{ color: 'var(--text-secondary)' }}>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      {hasUnknown && (
        <p style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }} className="px-6 py-3 text-[11px]">
          Some controls could not be determined from static analysis alone — see &ldquo;What Agent Verify could not determine&rdquo; below.
        </p>
      )}
    </section>
  )
}
