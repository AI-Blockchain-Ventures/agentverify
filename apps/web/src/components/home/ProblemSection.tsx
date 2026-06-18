export function ProblemSection() {
  return (
    <section className="mx-auto max-w-4xl px-6 py-20">
      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-xl p-10">
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-[#EF4444]">THE PROBLEM</p>
        <h2 style={{ color: 'var(--text-primary)' }} className="mb-4 text-3xl font-bold">AI agents operate with real-world authority.</h2>
        <p style={{ color: 'var(--text-secondary)' }} className="text-lg leading-relaxed">
          Most AI agents ship to production without any security review. They carry hardcoded credentials, use wildcard tool access, and execute irreversible actions without human approval gates. Agent Verify gives you a structured security analysis before your agent reaches production — in the same time it takes to run a test.
        </p>
      </div>
    </section>
  )
}
