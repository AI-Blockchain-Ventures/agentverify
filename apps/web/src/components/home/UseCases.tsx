const cases = [
  ['💰', 'Financial AI Agents', 'Trading, settlement, and payment agents with execution authority'],
  ['🏥', 'Healthcare Workflow', 'Clinical and records agents with patient data access'],
  ['🛒', 'Autonomous Procurement', 'Purchasing agents with budget authority'],
  ['🏪', 'Agent Marketplaces', 'Third-party agent trust verification at submission'],
  ['🔗', 'Multi-Agent Systems', 'Orchestration chains with delegated authority'],
  ['🏛️', 'Government AI', 'Regulated environments requiring compliance-grade analysis'],
]

export function UseCases() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-20">
      <p style={{ color: 'var(--text-secondary)' }} className="text-xs font-medium uppercase tracking-widest">ENTERPRISE USE CASES</p>
      <h2 style={{ color: 'var(--text-primary)' }} className="mb-10 mt-2 text-3xl font-bold md:text-4xl">Built for high-stakes deployments</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {cases.map(([icon, title, desc]) => (
          <div key={title} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="cursor-default rounded-xl p-4 transition-all hover:opacity-80 md:p-6">
            <div className="mb-3 text-2xl">{icon}</div>
            <h3 style={{ color: 'var(--text-primary)' }} className="mb-1 font-semibold">{title}</h3>
            <p style={{ color: 'var(--text-secondary)' }} className="text-sm">{desc}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
