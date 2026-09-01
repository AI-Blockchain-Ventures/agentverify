interface ControlLike { id: string; label: string; evidence: string }

/** "Security Controls Detected" and "What Agent Verify Could Not Determine" — the report
 * shouldn't only show what's wrong, and should be explicit about the edges of what static
 * analysis can prove. Both build credibility precisely by not overclaiming. */
export function ControlsAndLimits({ controls, notDetermined }: { controls: ControlLike[]; notDetermined: string[] }) {
  if (controls.length === 0 && notDetermined.length === 0) return null

  return (
    <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mb-6 rounded-3xl p-6 shadow-xl shadow-black/5">
      <div className="grid gap-6 md:grid-cols-2">
        {controls.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-green-text)]">Security controls detected</p>
            <h3 style={{ color: 'var(--text-primary)' }} className="mt-1 mb-3 text-sm font-semibold">What this agent already does right</h3>
            <ul className="space-y-2">
              {controls.map(c => (
                <li key={c.id} className="flex items-start gap-2 text-sm">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--accent-green-text)]" />
                  <span style={{ color: 'var(--text-secondary)' }}>{c.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {notDetermined.length > 0 && (
          <div>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold uppercase tracking-[0.18em]">What Agent Verify could not determine</p>
            <h3 style={{ color: 'var(--text-primary)' }} className="mt-1 mb-3 text-sm font-semibold">Static analysis limits</h3>
            <ul className="space-y-2">
              {notDetermined.map(item => (
                <li key={item} className="flex items-start gap-2 text-sm">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: 'var(--text-muted)' }} />
                  <span style={{ color: 'var(--text-muted)' }}>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
