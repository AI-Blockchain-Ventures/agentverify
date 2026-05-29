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
      <p className="text-xs font-medium uppercase tracking-widest text-[#94A3B8]">ENTERPRISE USE CASES</p>
      <h2 className="mb-10 mt-2 text-3xl font-bold text-white md:text-4xl">Built for high-stakes deployments</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {cases.map(([icon, title, desc]) => (
          <div key={title} className="cursor-default rounded-xl border border-[#1E2D40] bg-[#0F1623] p-4 transition-all hover:border-[#243244] md:p-6">
            <div className="mb-3 text-2xl">{icon}</div>
            <h3 className="mb-1 font-semibold text-white">{title}</h3>
            <p className="text-sm text-[#94A3B8]">{desc}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
