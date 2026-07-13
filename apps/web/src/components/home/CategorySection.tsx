const executionThreats = [
  ['Prompt Injection', 'Untrusted text can steer prompts and tool decisions.'],
  ['Tool Misuse', 'Agents can call tools that change money, infrastructure, or data.'],
  ['Command Injection', 'Untrusted input can reach shell or command execution paths.'],
  ['Replay Attacks', 'Captured execution requests can be reused without nonce and expiry controls.'],
  ['Rogue Agent', 'Unknown agents or plugins can inherit trust without identity verification.'],
  ['Agent Communication Poisoning', 'Unsafe messages can propagate through agent chains.'],
]

const controlCoverage = [
  ['A2SPA readiness', 'Checks for signing, verification, nonce, timestamp, and fail-closed behavior.'],
  ['Memory Poisoning', 'Flags persistent or unbounded memory patterns that can carry stale context.'],
  ['Privilege Compromise', 'Finds wildcard scopes, admin permissions, and broad access.'],
  ['Resource Overload', 'Looks for missing rate limits, budgets, timeouts, and execution caps.'],
  ['Auditability', 'Checks whether execution leaves enough evidence for investigation.'],
  ['Version Drift', 'Surfaces model and agent version evidence that should be controlled.'],
]

function FindingRow({ item, color }: { item: string[]; color: 'red' | 'orange' }) {
  const [title, whyItMatters] = item
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }} className="group relative flex items-start gap-3 py-3 last:border-b-0">
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${color === 'red' ? 'bg-red' : 'bg-orange'}`} />
      <div>
        <span style={{ color: 'var(--text-secondary)' }} className="text-sm transition-opacity group-hover:opacity-70">{title}</span>
        <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-xs leading-relaxed lg:hidden">{whyItMatters}</p>
      </div>
      <div style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }} className="pointer-events-none absolute left-[calc(100%+12px)] top-1/2 z-20 hidden w-64 -translate-y-1/2 rounded-lg px-3 py-2 text-xs leading-relaxed shadow-2xl lg:group-hover:block">
        {whyItMatters}
      </div>
    </div>
  )
}

export function CategorySection() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-20">
      <div className="mb-16 text-center">
          <p style={{ color: 'var(--text-secondary)' }} className="mb-3 text-xs font-semibold uppercase tracking-[0.24em]">Execution-risk coverage</p>
          <h2 style={{ color: 'var(--text-primary)' }} className="text-3xl font-semibold tracking-tight md:text-4xl">What Agent Verify checks before release</h2>
          <p style={{ color: 'var(--text-muted)' }} className="mx-auto mt-3 max-w-2xl text-sm leading-6">Static scanning cannot prove every threat class. Agent Verify separates detected issues, possible risks, missing evidence, and not-assessed categories so teams can make honest release decisions.</p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-5 shadow-xl shadow-black/5 md:p-8">
          <div className="mb-6 flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-red" />
              <span className="rounded-full border border-[#EF4444]/20 bg-[#EF4444]/20 px-2.5 py-0.5 text-xs font-medium text-[#EF4444]">Threat classes</span>
              <div>
                <h3 style={{ color: 'var(--text-primary)' }} className="font-semibold">Agent attack patterns</h3>
                <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-xs">How agent behavior becomes business risk</p>
              </div>
            </div>
          {executionThreats.map(item => (
            <FindingRow key={item[0]} item={item} color="red" />
          ))}
        </div>
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-5 shadow-xl shadow-black/5 md:p-8">
          <div className="mb-6 flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-orange" />
            <span className="rounded-full border border-orange/10 bg-orange/5 px-2.5 py-0.5 text-xs font-medium text-orange">Controls</span>
            <h3 style={{ color: 'var(--text-primary)' }} className="font-semibold">Release-readiness evidence</h3>
          </div>
          {controlCoverage.map(item => (
            <FindingRow key={item[0]} item={item} color="orange" />
          ))}
        </div>
      </div>
      <p style={{ color: 'var(--text-muted)' }} className="mt-6 text-center text-xs">
        A2SPA guidance appears when execution-related findings need signed intent, replay protection, fail-closed behavior, or audit receipts.
      </p>
      <div className="mt-4 text-center">
        <a href="https://aimodularity.com/A2SPA/docs" target="_blank" rel="noreferrer" className="inline-flex rounded-2xl border border-[#00C4CC]/30 px-4 py-2 text-sm font-semibold text-[#00C4CC] transition-opacity hover:opacity-80">
          Read A2SPA docs
        </a>
      </div>
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
