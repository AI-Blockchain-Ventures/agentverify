const cases = [
  ['Finance', 'Financial AI agents', 'Trading, settlement, and payment agents with execution authority.'],
  ['Health', 'Healthcare workflows', 'Clinical and records agents with patient data access.'],
  ['Procure', 'Autonomous procurement', 'Purchasing agents with budget authority.'],
  ['Market', 'Agent marketplaces', 'Third-party agent review before publication.'],
  ['Multi', 'Multi-agent systems', 'Orchestration chains with delegated authority.'],
  ['Gov', 'Regulated teams', 'Environments that need clear security evidence.'],
]

export function UseCases() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-20">
      <p style={{ color: 'var(--text-secondary)' }} className="text-xs font-semibold uppercase tracking-[0.24em]">Use cases</p>
      <h2 style={{ color: 'var(--text-primary)' }} className="mb-10 mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Useful wherever agents can take action.</h2>
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        {cases.map(([label, title, desc]) => (
          <div key={title} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="cursor-default rounded-3xl p-5 shadow-xl shadow-black/5 transition-all hover:opacity-90 md:p-6">
            <div className="mb-3 inline-flex rounded-full bg-[#00C4CC]/10 px-2.5 py-1 text-xs font-semibold text-[#00C4CC]">{label}</div>
            <h3 style={{ color: 'var(--text-primary)' }} className="mb-1 font-semibold">{title}</h3>
            <p style={{ color: 'var(--text-secondary)' }} className="text-sm">{desc}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
