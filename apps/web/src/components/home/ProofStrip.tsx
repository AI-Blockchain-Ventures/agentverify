import Link from 'next/link'

// Every number here is a real, tested count from the scanner's check catalog (see /docs#catalog):
// 76 checks; 5 frameworks with dedicated checks (LangChain, CrewAI, AutoGen, OpenAI Agents SDK, Claude Agent SDK); 19 credential checks.
const STATS: Array<[string, string]> = [
  ['76', 'security checks, every one tested'],
  ['5', 'agent frameworks with dedicated checks'],
  ['19', 'kinds of secrets caught (and redacted)'],
  ['3', 'compliance standards mapped: OWASP, NIST, SOC 2'],
]

export function ProofStrip() {
  return (
    <section className="px-4 pb-12 sm:px-6" aria-label="What Agent Verify covers">
      <div className="mx-auto max-w-6xl">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {STATS.map(([value, label]) => (
            <div key={label} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl px-4 py-4 text-center">
              <p style={{ color: 'var(--text-primary)' }} className="text-3xl font-bold tabular-nums">{value}</p>
              <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs leading-5">{label}</p>
            </div>
          ))}
        </div>
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mt-3 flex flex-col gap-4 rounded-2xl p-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Built for developers: verify agents before every deploy</p>
            <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs leading-5">Scan GitHub repos, MCP configs, and LangChain, CrewAI, AutoGen, OpenAI Agents and Claude Agent SDK projects — from the dashboard, the CLI, or a GitHub Action that blocks risky merges.</p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
            <code style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} className="whitespace-nowrap rounded-xl px-3 py-2 font-mono text-xs">npx agentverify scan ./agents --ci</code>
            <Link href="/developers" className="rounded-xl bg-[#7C3AED] px-4 py-2 text-center text-xs font-semibold text-white hover:opacity-90">For developers →</Link>
          </div>
        </div>
      </div>
    </section>
  )
}
