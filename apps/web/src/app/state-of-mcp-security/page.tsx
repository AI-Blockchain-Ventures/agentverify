import Link from 'next/link'
import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { RATING_COPY, mcpSafety, type McpRating } from '@/lib/mcpSafety'
import { checkLibrary } from '@/lib/checkLibrary'

/**
 * "State of MCP Security" — a launch report computed at build time from the same data as the
 * MCP directory (src/data/mcpSafety.json). Every number on the page is derived here, so it can
 * never disagree with the directory.
 */

const S = mcpSafety.servers
const N = S.length
const pct = (n: number) => Math.round((n / Math.max(1, N)) * 100)
const fmt = (n: number) => n.toLocaleString('en-US')
const dateLabel = new Date(mcpSafety.generatedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

function countBy<T extends string>(keys: (s: (typeof S)[number]) => T[]): Array<[T, number]> {
  const m = new Map<T, number>()
  for (const s of S) for (const k of new Set(keys(s))) m.set(k, (m.get(k) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

const ratings = (['higher', 'review', 'lower'] as McpRating[]).map(r => [r, S.filter(s => s.rating === r).length] as const)
const capabilities = countBy(s => s.capabilities.map(c => c.label))
const findingTypes = countBy(s => s.findings.map(f => f.code))
const withFindings = S.filter(s => s.findings.length > 0).length
const withSerious = S.filter(s => s.counts.critical + s.counts.high > 0).length
const totalDownloads = S.reduce((a, s) => a + (s.weeklyDownloads || 0), 0)
const broadDownloads = S.filter(s => s.rating === 'higher').reduce((a, s) => a + (s.weeklyDownloads || 0), 0)
const needsKeys = S.filter(s => s.capabilities.some(c => c.id === 'secrets')).length
const writesFiles = S.filter(s => s.capabilities.some(c => c.id === 'fs-write')).length
const noRepo = S.filter(s => !s.repository).length
const poisoned = S.filter(s => s.findings.some(f => f.code === 'MCP_TOOL_POISONING' || f.code === 'MCP_HIDDEN_UNICODE' || f.code === 'MCP_TOOL_SHADOWING')).length
const topBroad = S.filter(s => s.rating === 'higher').sort((a, b) => b.weeklyDownloads - a.weeklyDownloads).slice(0, 10)
const checkByCode = new Map(checkLibrary.checks.map(c => [c.code, c]))

export const metadata: Metadata = pageMetadata(
  '/state-of-mcp-security',
  `State of MCP Security — ${dateLabel}`,
  `We scanned ${N} popular MCP servers (${fmt(totalDownloads)} weekly downloads). ${pct(writesFiles)}% can change files, ${pct(needsKeys)}% need API keys, and ${pct(withFindings)}% have code patterns worth reviewing.`,
)

function Bar({ label, value, max, suffix, href }: { label: string; value: number; max: number; suffix: string; href?: string }) {
  const width = `${Math.max(2, (value / Math.max(1, max)) * 100)}%`
  const name = href ? <Link href={href} className="hover:underline">{label}</Link> : label
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[220px_minmax(0,1fr)_auto]">
      <span style={{ color: 'var(--text-primary)' }} className="text-sm">{name}</span>
      <span className="col-span-2 row-start-2 h-3 sm:col-span-1 sm:row-start-auto" style={{ backgroundColor: 'var(--surface)', borderRadius: 4 }}>
        <span title={`${label}: ${value} of ${N} servers (${pct(value)}%)`} className="block h-3" style={{ width, backgroundColor: '#7C3AED', borderRadius: 4 }} />
      </span>
      <span style={{ color: 'var(--text-secondary)' }} className="text-right text-sm tabular-nums">{pct(value)}% <span style={{ color: 'var(--text-muted)' }} className="text-xs">({value}{suffix})</span></span>
    </li>
  )
}

export default function StateOfMcpSecurityPage() {
  const card = { backgroundColor: 'var(--card)', border: '1px solid var(--border)' }
  const h2 = 'text-2xl font-semibold tracking-tight'
  const stats: Array<[string, string]> = [
    [fmt(N), 'MCP servers scanned'],
    [fmt(totalDownloads), 'weekly npm downloads covered'],
    [`${pct(writesFiles)}%`, 'can write or delete files'],
    [`${pct(withSerious)}%`, 'have a high or critical code pattern'],
  ]

  return (
    <main style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen px-4 py-12 md:px-6 md:py-16">
      <article className="mx-auto max-w-4xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-purple-text)]">Report · {dateLabel}</p>
        <h1 style={{ color: 'var(--text-primary)' }} className="mt-2 text-3xl font-semibold tracking-tight md:text-5xl">The State of MCP Security</h1>
        <p style={{ color: 'var(--text-secondary)' }} className="mt-4 text-lg leading-8">
          MCP servers give AI assistants real powers — files, browsers, databases, your API keys. We downloaded and scanned the {fmt(N)} most-used MCP servers on npm to see what they can actually do, and what that means if the AI using them is ever tricked.
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
          <h2 style={{ color: 'var(--text-primary)' }} className={h2}>Key findings</h2>
          <ol style={{ color: 'var(--text-secondary)' }} className="mt-4 list-decimal space-y-3 pl-5 text-base leading-7">
            <li><strong style={{ color: 'var(--text-primary)' }}>Most servers can change things, not just read them.</strong> {pct(writesFiles)}% can write or delete files and {pct(capabilities.find(([k]) => k === 'Calls internet services')?.[1] ?? 0)}% call internet services. Content from the internet is the main way prompt injection gets in.</li>
            <li><strong style={{ color: 'var(--text-primary)' }}>{ratings[0][1]} servers ({pct(ratings[0][1])}%) can run shell commands.</strong> Together they get {fmt(broadDownloads)} downloads a week. A tricked assistant using one of them can do almost anything the user can.</li>
            <li><strong style={{ color: 'var(--text-primary)' }}>{pct(needsKeys)}% need API keys or tokens.</strong> Those keys usually sit in plain text in an MCP config file that gets copied, synced and shared.</li>
            <li><strong style={{ color: 'var(--text-primary)' }}>{pct(withFindings)}% have at least one code pattern worth reviewing</strong>, most often commands built from input ({fmt(findingTypes.find(([k]) => k === 'COMMAND_INJECTION_RISK')?.[1] ?? 0)} servers). These are signals to review, not confirmed vulnerabilities.</li>
            <li><strong style={{ color: 'var(--text-primary)' }}>{noRepo} servers ({pct(noRepo)}%) link to no source repository</strong>, so the code you install can&apos;t be easily compared with any public source.</li>
            {poisoned > 0 && <li><strong style={{ color: 'var(--text-primary)' }}>{poisoned} server{poisoned === 1 ? '' : 's'} had tool descriptions with hidden or manipulative instructions</strong> (tool poisoning, invisible characters, or tool shadowing).</li>}
          </ol>
        </section>

        <section className="mt-12">
          <h2 style={{ color: 'var(--text-primary)' }} className={h2}>How much access do they have?</h2>
          <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-sm">Each server gets one rating based on the most powerful thing it can do.</p>
          <div className="mt-5 flex h-8 w-full gap-[2px] overflow-hidden rounded-md" role="img" aria-label={ratings.map(([r, n]) => `${RATING_COPY[r].label}: ${n}`).join(', ')}>
            {ratings.map(([r, n]) => (
              <span key={r} title={`${RATING_COPY[r].label}: ${n} servers (${pct(n)}%)`} style={{ width: `${(n / N) * 100}%`, backgroundColor: RATING_COPY[r].color }} />
            ))}
          </div>
          <ul className="mt-4 grid gap-3 sm:grid-cols-3">
            {ratings.map(([r, n]) => (
              <li key={r} style={card} className="rounded-lg p-4">
                <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: RATING_COPY[r].color }} />
                  {RATING_COPY[r].label}
                </p>
                <p style={{ color: 'var(--text-primary)' }} className="mt-1 text-2xl font-bold tabular-nums">{pct(n)}% <span style={{ color: 'var(--text-muted)' }} className="text-sm font-normal">({n})</span></p>
                <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs leading-5">{RATING_COPY[r].explain}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-12">
          <h2 style={{ color: 'var(--text-primary)' }} className={h2}>What MCP servers can do</h2>
          <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-sm">Share of the {N} servers with each capability, found in their published code.</p>
          <ul className="mt-5 space-y-3">
            {capabilities.map(([label, n]) => <Bar key={label} label={label} value={n} max={capabilities[0][1]} suffix="" />)}
          </ul>
        </section>

        {findingTypes.length > 0 && (
          <section className="mt-12">
            <h2 style={{ color: 'var(--text-primary)' }} className={h2}>Most common code patterns</h2>
            <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-sm">Servers with at least one finding of each type. Click a pattern to see what it means and how to fix it.</p>
            <ul className="mt-5 space-y-3">
              {findingTypes.slice(0, 10).map(([code, n]) => {
                const check = checkByCode.get(code)
                return <Bar key={code} label={check?.name ?? code} value={n} max={findingTypes[0][1]} suffix="" href={check ? `/checks/${check.slug}` : undefined} />
              })}
            </ul>
          </section>
        )}

        {topBroad.length > 0 && (
          <section className="mt-12">
            <h2 style={{ color: 'var(--text-primary)' }} className={h2}>Most-downloaded servers that can run commands</h2>
            <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-sm">Not a list of bad servers — many are excellent tools. These are the ones to run in a container and keep on &quot;approve each call&quot;.</p>
            <div tabIndex={0} role="region" aria-label="Most-downloaded servers that can run commands" className="mt-4 overflow-x-auto rounded-lg" style={card}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }} className="text-left text-xs">
                    <th className="px-4 py-2 font-semibold">Server</th>
                    <th className="px-4 py-2 text-right font-semibold">Weekly downloads</th>
                    <th className="px-4 py-2 text-right font-semibold">Tools</th>
                  </tr>
                </thead>
                <tbody>
                  {topBroad.map(s => (
                    <tr key={s.slug} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td className="px-4 py-2"><Link href={`/mcp/${s.slug}`} className="font-medium text-[color:var(--accent-purple-text)] hover:underline">{s.name}</Link></td>
                      <td style={{ color: 'var(--text-secondary)' }} className="px-4 py-2 text-right tabular-nums">{fmt(s.weeklyDownloads)}</td>
                      <td style={{ color: 'var(--text-secondary)' }} className="px-4 py-2 text-right tabular-nums">{s.tools.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="mt-12">
          <h2 style={{ color: 'var(--text-primary)' }} className={h2}>What to do about it</h2>
          <ul style={{ color: 'var(--text-secondary)' }} className="mt-4 list-disc space-y-2 pl-5 text-base leading-7">
            <li>Pin every MCP server to an exact version, instead of running whatever <code>npx -y</code> fetches today.</li>
            <li>Point filesystem servers at one project folder, never your home directory.</li>
            <li>Keep &quot;approve each tool call&quot; on for anything that writes, sends, or runs commands.</li>
            <li>Keep API keys out of the config file. Use environment variables and the narrowest scopes available.</li>
            <li>Run servers that can execute commands in a container with no personal accounts or credentials.</li>
          </ul>
        </section>

        <section className="mt-12 rounded-xl p-6" style={{ backgroundColor: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.25)' }}>
          <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">Check your own MCP setup</h2>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-sm">Paste your <code>claude_desktop_config.json</code>, <code>.cursor/mcp.json</code> or <code>.vscode/mcp.json</code>. The free scan runs all {checkLibrary.total} checks, including tool poisoning and unpinned servers.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/#public-scan" className="rounded-md bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6D28D9]">Scan my config free</Link>
            <Link href="/mcp" style={{ border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} className="rounded-md px-4 py-2 text-sm font-semibold">Browse all {N} servers</Link>
          </div>
        </section>

        <section className="mt-12">
          <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">Method</h2>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-2 text-sm leading-6">
            We took the most-downloaded MCP servers published on npm (plus well-known official servers), downloaded each published package as data (never installed or run), and scanned its source with the Agent Verify scanner {mcpSafety.scannerVersion}. Capabilities come from concrete evidence in the code: for example, &quot;runs shell commands&quot; requires a tool or description that executes commands. Code patterns are static-analysis signals to review, not confirmed vulnerabilities, and a server&apos;s rating describes how much it <em>could</em> do, not whether its authors are trustworthy. Download counts are npm weekly downloads at the time of the scan ({new Date(mcpSafety.generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}). Servers change often; each server page shows the version we checked.
          </p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">Free to cite with a link to this page. Questions or corrections: hello@aiblockchainventures.com</p>
        </section>
      </article>
    </main>
  )
}
