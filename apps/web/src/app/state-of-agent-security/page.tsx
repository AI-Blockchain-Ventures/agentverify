import Link from 'next/link'
import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { checkLibrary } from '@/lib/checkLibrary'
import data from '@/data/agentSecurity.json'

/**
 * "State of AI Agent Security" — computed at build time from src/data/agentSecurity.json, which
 * scripts/build-agent-security.mjs produces by scanning popular open-source agent projects with the real
 * engine. Only totals are published: no project is named next to a result.
 */

const T = data.totals
const N = T.projects
const pct = (n: number) => Math.round((n / Math.max(1, N)) * 100)
const fmt = (n: number) => n.toLocaleString('en-US')
const dateLabel = new Date(data.generatedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
const capability = (id: string) => data.capabilities.find(c => c.id === id)?.projects ?? 0
const finding = (code: string) => data.findings.find(f => f.code === code)?.projects ?? 0
const checkByCode = new Map(checkLibrary.checks.map(c => [c.code, c]))

const shell = capability('execute_commands')
const writes = capability('modify_files')
const deletes = capability('delete_files')
const dbWrites = capability('modify_databases')
const browser = capability('browser_automation')
const cmdFromInput = finding('COMMAND_INJECTION_RISK')
const noSigning = Math.max(finding('MISSING_SIGNATURE'), finding('MISSING_NONCE'))
const rogue = finding('ROGUE_AGENT_RISK')
const unboundedMemory = finding('UNBOUNDED_MEMORY')
const safetyOff = finding('SAFETY_CONTROLS_DISABLED')

// Manual review of the scanner's possible-secret findings (see Method). Update when the data is rebuilt.
const SECRET_REVIEW = { projects: 14, reviewed: 'November 2026' }

export const metadata: Metadata = pageMetadata(
  '/state-of-agent-security',
  `State of AI Agent Security — ${dateLabel}`,
  `We scanned the source code of ${N} of the most-starred open-source AI agent projects (${fmt(T.stars)} GitHub stars). ${pct(shell)}% can run shell commands, ${pct(cmdFromInput)}% build commands from changing input, and only ${T.verified} passed every check.`,
)

function Bar({ label, value, href }: { label: string; value: number; href?: string }) {
  const name = href ? <Link href={href} className="hover:underline">{label}</Link> : label
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[260px_minmax(0,1fr)_auto]">
      <span style={{ color: 'var(--text-primary)' }} className="text-sm">{name}</span>
      <span className="col-span-2 row-start-2 h-3 sm:col-span-1 sm:row-start-auto" style={{ backgroundColor: 'var(--surface)', borderRadius: 4 }}>
        <span title={`${label}: ${value} of ${N} projects (${pct(value)}%)`} className="block h-3" style={{ width: `${Math.max(2, pct(value))}%`, backgroundColor: '#7C3AED', borderRadius: 4 }} />
      </span>
      <span style={{ color: 'var(--text-secondary)' }} className="text-right text-sm tabular-nums">{pct(value)}% <span style={{ color: 'var(--text-muted)' }} className="text-xs">({value})</span></span>
    </li>
  )
}

export default function StateOfAgentSecurityPage() {
  const card = { backgroundColor: 'var(--card)', border: '1px solid var(--border)' }
  const h2 = 'text-2xl font-semibold tracking-tight'
  const strong = { color: 'var(--text-primary)' }
  const stats: Array<[string, string]> = [
    [String(N), `popular agent projects scanned (${fmt(T.stars)} GitHub stars)`],
    [`${pct(shell)}%`, 'can run shell commands'],
    [`${pct(cmdFromInput)}%`, 'build commands from changing input'],
    [`${T.verified} of ${N}`, 'passed every check'],
  ]
  const patterns = data.findings
    .filter(f => !['MISSING_SIGNATURE', 'MISSING_NONCE', 'MISSING_TIMESTAMP', 'MISSING_FAIL_CLOSED', 'HARDCODED_CREDENTIALS'].includes(f.code) && !f.code.startsWith('SECRET_DETECTED'))
    .slice(0, 10)

  return (
    <main style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen px-4 py-12 md:px-6 md:py-16">
      <article className="mx-auto max-w-4xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-purple-text)]">Report · {dateLabel}</p>
        <h1 style={{ color: 'var(--text-primary)' }} className="mt-2 text-3xl font-semibold tracking-tight md:text-5xl">The State of AI Agent Security</h1>
        <p style={{ color: 'var(--text-secondary)' }} className="mt-4 text-lg leading-8">
          AI agents now run commands, edit files and call services on their own. We scanned the source code of {N} of the most-starred open-source AI agent projects on GitHub to see how much power they have, and how often the safeguards around that power are visible in the code.
        </p>

        <section className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Key numbers">
          {stats.map(([v, l]) => (
            <div key={l} style={card} className="rounded-xl p-4">
              <p style={{ color: 'var(--text-primary)' }} className="text-2xl font-bold tabular-nums md:text-3xl">{v}</p>
              <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs leading-5">{l}</p>
            </div>
          ))}
        </section>

        <section className="mt-12">
          <h2 style={strong} className={h2}>Key findings</h2>
          <ol style={{ color: 'var(--text-secondary)' }} className="mt-4 list-decimal space-y-3 pl-5 text-base leading-7">
            <li><strong style={strong}>Most agents have real power over the machine they run on.</strong> {pct(shell)}% can run shell commands, {pct(writes)}% can write files and {pct(deletes)}% can delete them. {pct(browser)}% drive a real browser. If an agent is tricked, this is what the attacker gets.</li>
            <li><strong style={strong}>{pct(cmdFromInput)}% build shell commands from changing input.</strong> For coding agents that is often the point. It also means the most important question is whether text from a web page, file or message can ever reach that command.</li>
            <li><strong style={strong}>Safeguards are rarely visible in the code.</strong> In {pct(noSigning)}% of projects, nothing in the code checks that a request to act is genuine (a signature or replay check) before the agent acts. Many rely on the person watching instead, which works in a terminal and breaks when the agent runs unattended.</li>
            <li><strong style={strong}>{pct(rogue)}% register agents or plugins at runtime with no visible check of where they came from</strong>, and {pct(unboundedMemory)}% keep memory with no expiry. Both are ways one bad input can outlast the conversation it arrived in.</li>
            {safetyOff > 0 && <li><strong style={strong}>{safetyOff} project{safetyOff === 1 ? '' : 's'} switch a safety feature off in code</strong>, such as auto-approving every tool call or skipping permission prompts. Often it is an opt-in &quot;yolo&quot; mode, which is fine for a sandbox and dangerous anywhere else.</li>}
            <li><strong style={strong}>Only {T.verified} of {N} passed every check, and the median score was {T.medianScore}/100.</strong> That is not a ranking of quality: these are popular, well-built projects. It shows how far default agent code is from what a security team would sign off on for production.</li>
          </ol>
        </section>

        <section className="mt-12">
          <h2 style={strong} className={h2}>What agent projects can do</h2>
          <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-sm">Share of the {N} projects with each capability, from concrete evidence in their source code.</p>
          <ul className="mt-5 space-y-3">
            {data.capabilities.filter(c => c.projects >= 2).map(c => <Bar key={c.id} label={c.label} value={c.projects} />)}
          </ul>
        </section>

        <section className="mt-12">
          <h2 style={strong} className={h2}>Most common patterns to review</h2>
          <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-sm">Projects with at least one finding of each type. These are static-analysis signals, not confirmed vulnerabilities. Click one to see what it means and how to fix it.</p>
          <ul className="mt-5 space-y-3">
            {patterns.map(f => {
              const check = checkByCode.get(f.code)
              return <Bar key={f.code} label={check?.name ?? f.code} value={f.projects} href={check ? `/checks/${check.slug}` : undefined} />
            })}
          </ul>
        </section>

        <section className="mt-12">
          <h2 style={strong} className={h2}>Scores</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {data.scoreBands.map(b => (
              <div key={b.lo} style={card} className="rounded-xl p-4">
                <p style={{ color: 'var(--text-muted)' }} className="text-xs">Score {b.lo}–{b.hi}</p>
                <p style={strong} className="mt-1 text-2xl font-bold tabular-nums">{b.projects} <span style={{ color: 'var(--text-muted)' }} className="text-sm font-normal">project{b.projects === 1 ? '' : 's'}</span></p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <h2 style={strong} className={h2}>A note on secrets</h2>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-3 text-base leading-7">
            The scanner flagged possible hard-coded keys or passwords in {SECRET_REVIEW.projects} projects. We reviewed every one by hand: nearly all were placeholders, local development defaults or analytics keys that are meant to be public. So we are not reporting any of them as leaks. Open-source maintainers are generally careful here; the bigger risk is what agents can <em>do</em>, not what they ship with.
          </p>
        </section>

        <section className="mt-12">
          <h2 style={strong} className={h2}>What to do about it</h2>
          <ul style={{ color: 'var(--text-secondary)' }} className="mt-4 list-disc space-y-2 pl-5 text-base leading-7">
            <li>Give each agent only the tools its job needs. A support agent does not need a shell.</li>
            <li>Keep text from web pages, files, emails and other agents away from commands and tool arguments, or check it first.</li>
            <li>Ask a person before anything that deletes, pays, sends or deploys, and make the agent stop if approval is missing.</li>
            <li>When agents run unattended, check that each request to act is genuine (signed, recent, not replayed), and log every action.</li>
            <li>Run agents that can execute commands in a container with no personal accounts or credentials.</li>
          </ul>
        </section>

        <section className="mt-12 rounded-xl p-6" style={{ backgroundColor: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.25)' }}>
          <h2 style={strong} className="text-lg font-semibold">How does your agent compare?</h2>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-sm">Paste your agent code or connect a repo. The free scan runs all {checkLibrary.total} checks and shows the exact line for each finding. Pro shows the fix and re-checks your changes.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/#public-scan" className="rounded-md bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6D28D9]">Scan my agent free</Link>
            <Link href="/report/demo" style={{ border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} className="rounded-md px-4 py-2 text-sm font-semibold">See a sample report</Link>
            <Link href="/state-of-mcp-security" style={{ border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} className="rounded-md px-4 py-2 text-sm font-semibold">State of MCP Security</Link>
          </div>
        </section>

        <section className="mt-12">
          <h2 style={strong} className="text-lg font-semibold">Method</h2>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-2 text-sm leading-6">
            We searched GitHub for public projects tagged {data.method.topics.map(t => `“${t}”`).join(', ')} with more than {data.method.minStars} stars, kept those written mainly in {data.method.languages.join(', ')}, and left out {data.method.excluded}. We took the {N} most-starred ({Object.entries(T.languages).map(([l, n]) => `${n} ${l}`).join(', ')}). For each one we read {data.method.files}: {fmt(T.files)} files in total. Nothing was cloned, installed or run. Each project was scanned with the Agent Verify scanner {data.scannerVersion} on {new Date(data.generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.
          </p>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-3 text-sm leading-6">
            Findings are static-analysis signals about the code we read, not confirmed vulnerabilities, and a large project is only partly covered by 60 files. Capabilities describe what a project <em>could</em> do, not whether it is safe to use or whether its authors are careful. We publish totals only and do not name projects next to results. Maintainers who want their own project&apos;s results can ask, and we will share them privately.
          </p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">Free to cite with a link to this page. Questions, corrections or a copy of your project&apos;s results: hello@aiblockchainventures.com</p>
        </section>
      </article>
    </main>
  )
}
