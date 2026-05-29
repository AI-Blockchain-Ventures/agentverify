const categoryA = [
  ['Missing cryptographic signature', 'Prevents unsigned or tampered requests from triggering agent execution.'],
  ['Missing nonce validation', 'Stops replayed requests from being accepted more than once.'],
  ['Missing timestamp enforcement', 'Limits how long an execution request remains valid.'],
  ['Over-permissioned action scopes', 'Keeps compromised agents from exceeding the task they were approved for.'],
  ['Missing fail-closed enforcement', 'Ensures verification failures block execution instead of becoming warnings.'],
]

const categoryB = [
  ['Hardcoded credentials', 'Prevents repository, log, and error-trace leaks from exposing secrets.'],
  ['Unrestricted tool access', 'Reduces privilege escalation from unconstrained tool discovery.'],
  ['Missing human-in-the-loop gates', 'Adds approval checkpoints before destructive or financial actions.'],
  ['Unbounded memory persistence', 'Limits retention of sensitive or poisoned context across sessions.'],
  ['Missing audit logging', 'Preserves execution history for compliance and incident response.'],
]

function FindingRow({ item, color }: { item: string[]; color: 'red' | 'orange' }) {
  const [title, whyItMatters] = item
  return (
    <div className="group relative flex items-start gap-3 border-b border-[#1E2D40] py-3 last:border-b-0">
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${color === 'red' ? 'bg-red' : 'bg-orange'}`} />
      <span className="text-sm text-[#94A3B8] transition-colors group-hover:text-white">{title}</span>
      <div className="pointer-events-none absolute left-[calc(100%+12px)] top-1/2 z-20 hidden w-64 -translate-y-1/2 rounded-lg border border-[#1E2D40] bg-[#080B14] px-3 py-2 text-xs leading-relaxed text-[#94A3B8] shadow-2xl group-hover:block">
        {whyItMatters}
      </div>
    </div>
  )
}

export function CategorySection() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-20">
      <div className="mb-16 text-center">
        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-[#94A3B8]">DETECTION COVERAGE</p>
        <h2 className="text-3xl font-bold text-white md:text-4xl">What Agent Verify analyzes</h2>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-[#1E2D40] bg-[#0F1623] p-5 md:p-8">
          <div className="mb-6 flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-red" />
            <span className="rounded-full border border-[#EF4444]/20 bg-[#EF4444]/20 px-2.5 py-0.5 text-xs font-medium text-[#EF4444]">Category A</span>
            <h3 className="font-semibold text-white">A2SPA Protocol Compliance</h3>
          </div>
          {categoryA.map(item => (
            <FindingRow key={item[0]} item={item} color="red" />
          ))}
        </div>
        <div className="rounded-xl border border-[#1E2D40] bg-[#0F1623] p-5 md:p-8">
          <div className="mb-6 flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-orange" />
            <span className="rounded-full border border-orange/10 bg-orange/5 px-2.5 py-0.5 text-xs font-medium text-orange">Category B</span>
            <h3 className="font-semibold text-white">General Agent Security</h3>
          </div>
          {categoryB.map(item => (
            <FindingRow key={item[0]} item={item} color="orange" />
          ))}
        </div>
      </div>
      <p className="mt-6 text-center text-sm text-[#4B6080]">+ 5 additional Category B signals analyzed on every scan</p>
    </section>
  )
}
