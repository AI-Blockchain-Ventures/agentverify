export function ProblemSection() {
  return (
    <section className="mx-auto max-w-4xl px-6 py-16 md:py-20">
      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-6 shadow-2xl shadow-black/5 backdrop-blur md:p-10">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-[#EF4444]">Why it matters</p>
        <h2 style={{ color: 'var(--text-primary)' }} className="mb-4 text-3xl font-semibold tracking-tight md:text-4xl">AI agents often run with real authority.</h2>
        <p style={{ color: 'var(--text-secondary)' }} className="text-lg leading-relaxed">
          Agent Verify helps you catch hardcoded credentials, broad tool access, missing approval gates, and weak execution controls before an agent reaches production. Each report turns findings into clear next steps.
        </p>
      </div>
    </section>
  )
}
