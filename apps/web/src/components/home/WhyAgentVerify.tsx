const questions = [
  { who: 'Traditional code security', asks: '"Is the software vulnerable?"' },
  { who: 'Identity / IAM', asks: '"Who is this, and what can it access?"' },
  { who: 'Agent Verify', asks: '"What can this AI agent actually DO with everything it has been given?"', highlight: true },
  { who: 'Execution authorization (A2SPA)', asks: '"Is this exact consequential action authorized right now?"' },
]

export function WhyAgentVerify() {
  return (
    <section style={{ backgroundColor: 'var(--bg)' }} className="px-6 py-16 md:py-20">
      <div className="mx-auto max-w-4xl">
        <p className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--accent-cyan-text)]">Why Agent Verify?</p>
        <h2 style={{ color: 'var(--text-primary)' }} className="mb-4 text-center text-3xl font-semibold tracking-tight md:text-4xl">A different question than the tools you already have.</h2>
        <p style={{ color: 'var(--text-secondary)' }} className="mx-auto mb-10 max-w-2xl text-center text-base leading-relaxed">
          A legitimate credential, valid API access, and an approved tool can still combine into an action an agent should never be able to take. Existing categories of security tools don&apos;t ask that question — Agent Verify does.
        </p>
        <div className="space-y-3">
          {questions.map(q => (
            <div
              key={q.who}
              style={{
                backgroundColor: q.highlight ? 'rgba(124,58,237,0.08)' : 'var(--card)',
                border: q.highlight ? '1px solid #7C3AED55' : '1px solid var(--border)',
              }}
              className="flex flex-col gap-1 rounded-2xl p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
            >
              <p style={{ color: q.highlight ? 'var(--accent-purple-text)' : 'var(--text-primary)' }} className="shrink-0 text-sm font-semibold sm:w-64">{q.who}</p>
              <p style={{ color: 'var(--text-secondary)' }} className="text-base italic leading-relaxed">{q.asks}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
