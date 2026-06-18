const categoryA = [
  ['Missing cryptographic signature', 'Prevents unsigned or tampered requests from triggering agent execution.'],
  ['Missing nonce validation', 'Stops replayed requests from being accepted more than once.'],
  ['Missing timestamp enforcement', 'Limits how long an execution request remains valid.'],
  ['Over-permissioned action scopes', 'Keeps compromised agents from exceeding the task they were approved for.'],
  ['Missing fail-closed enforcement', 'Ensures verification failures block execution instead of becoming warnings.'],
]

const categoryB = [
  ['Hardcoded credentials', 'API keys exposed in source code'],
  ['Unrestricted tool access', 'Agent can invoke any available tool'],
  ['Missing human approval gates', 'Irreversible actions run automatically'],
  ['Unbounded memory persistence', 'Agent retains data across sessions'],
  ['Missing audit logging', 'No record of what the agent did'],
]

function FindingRow({ item, color }: { item: string[]; color: 'red' | 'orange' }) {
  const [title, whyItMatters] = item
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }} className="group relative flex items-start gap-3 py-3 last:border-b-0">
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${color === 'red' ? 'bg-red' : 'bg-orange'}`} />
      <span style={{ color: 'var(--text-secondary)' }} className="text-sm transition-opacity group-hover:opacity-70">{title}</span>
      <div style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }} className="pointer-events-none absolute left-[calc(100%+12px)] top-1/2 z-20 hidden w-64 -translate-y-1/2 rounded-lg px-3 py-2 text-xs leading-relaxed shadow-2xl group-hover:block">
        {whyItMatters}
      </div>
    </div>
  )
}

export function CategorySection() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-20">
      <div className="mb-16 text-center">
        <p style={{ color: 'var(--text-secondary)' }} className="mb-3 text-xs font-bold uppercase tracking-widest">DETECTION COVERAGE</p>
        <h2 style={{ color: 'var(--text-primary)' }} className="text-3xl font-bold md:text-4xl">What Agent Verify analyzes</h2>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-xl p-5 md:p-8">
          <div className="mb-6 flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-red" />
            <span className="rounded-full border border-[#EF4444]/20 bg-[#EF4444]/20 px-2.5 py-0.5 text-xs font-medium text-[#EF4444]">Category A</span>
            <div>
              <h3 style={{ color: 'var(--text-primary)' }} className="font-semibold">Protocol Compliance</h3>
              <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-xs">Cryptographic execution authorization</p>
            </div>
          </div>
          {categoryA.map(item => (
            <FindingRow key={item[0]} item={item} color="red" />
          ))}
        </div>
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-xl p-5 md:p-8">
          <div className="mb-6 flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-orange" />
            <span className="rounded-full border border-orange/10 bg-orange/5 px-2.5 py-0.5 text-xs font-medium text-orange">Category B</span>
            <h3 style={{ color: 'var(--text-primary)' }} className="font-semibold">Security Controls</h3>
          </div>
          {categoryB.map(item => (
            <FindingRow key={item[0]} item={item} color="orange" />
          ))}
        </div>
      </div>
      <p style={{ color: 'var(--text-muted)' }} className="mt-6 text-center text-xs">
        Protocol compliance powered by A2SPA™ —
        <a href="mailto:hello@aiblockchainventures.com" className="ml-1 text-[#00C4CC] hover:underline">contact us for integration</a>
      </p>
      <div className="mt-12 text-center">
        <p style={{ color: 'var(--text-muted)' }} className="mb-4 text-xs uppercase tracking-widest">
          Every finding mapped to
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {['OWASP LLM Top 10', 'NIST AI RMF', 'SOC 2'].map(framework => (
            <span
              key={framework}
              style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              className="rounded-full px-4 py-1.5 text-sm font-medium"
            >
              {framework}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
