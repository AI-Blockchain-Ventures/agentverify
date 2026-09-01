const trustSignals = [
  { label: 'OWASP LLM Top 10', detail: 'Compliance mapping', icon: 'OWASP' },
  { label: 'NIST AI RMF', detail: 'Risk management alignment', icon: 'NIST' },
  { label: 'SOC 2', detail: 'Control mapping', icon: 'SOC' },
  { label: 'Patent-Pending A2SPA Protocol', detail: 'Execution authorization guidance', icon: 'A2SPA' },
]

export function TrustSignals() {
  return (
    <section style={{ backgroundColor: 'var(--bg)' }} className="px-6 pb-16">
      <div className="mx-auto max-w-6xl">
        <div style={{ border: '1px solid var(--border)', backgroundColor: 'var(--card)' }} className="rounded-[2rem] p-5 shadow-2xl shadow-black/5 md:p-6">
          <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-purple-text)]">Trust signals</p>
              <h2 style={{ color: 'var(--text-primary)' }} className="mt-2 text-2xl font-semibold tracking-tight">Built around recognized AI security frameworks.</h2>
            </div>
            <a href="https://github.com/AI-Blockchain-Ventures/agentverify" target="_blank" rel="noreferrer" className="inline-flex w-fit rounded-2xl border border-[#7C3AED]/30 bg-[#7C3AED]/10 px-4 py-2 text-sm font-semibold text-[color:var(--accent-purple-text)] transition-opacity hover:opacity-80">
              Open Source
            </a>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {trustSignals.map(signal => (
              <div key={signal.label} style={{ border: '1px solid var(--border)', backgroundColor: 'var(--surface)' }} className="rounded-2xl p-4">
                <div className="mb-4 inline-flex rounded-xl bg-[#7C3AED]/10 px-3 py-2 font-mono text-xs font-semibold text-[color:var(--accent-purple-text)]">{signal.icon}</div>
                <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{signal.label}</p>
                <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs leading-relaxed">{signal.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
