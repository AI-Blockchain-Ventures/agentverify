import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { pageMetadata } from '@/lib/seo'
import { CAPABILITY_ADVICE, RATING_COPY, REVIEWED_BADGE_URL, badgeUrl, getMcpServer, mcpSafety } from '@/lib/mcpSafety'
import { CodeBlock } from '@/components/developers/CodeBlock'

export const dynamicParams = false

export function generateStaticParams() {
  return mcpSafety.servers.map(s => ({ slug: s.slug }))
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const s = getMcpServer(params.slug)
  if (!s) return {}
  const caps = s.capabilities.map(c => c.label.toLowerCase()).join(', ')
  return pageMetadata(
    `/mcp/${s.slug}`,
    `Is ${s.name} safe? MCP security check`,
    `${s.name} ${caps ? `can: ${caps}.` : 'shows no high-reach capabilities.'} Agent Verify rating: ${RATING_COPY[s.rating].label}. What it can access and how to use it safely.`,
  )
}

const SITE = 'https://aimodularity.com/agentverify'

export default function McpServerPage({ params }: { params: { slug: string } }) {
  const s = getMcpServer(params.slug)
  if (!s) notFound()
  const r = RATING_COPY[s.rating]
  const pageUrl = `${SITE}/mcp/${s.slug}/`
  const checked = new Date(mcpSafety.generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const install = `{
  "mcpServers": {
    "${s.name.split('/').pop()?.replace(/^server-|^mcp-server-|-mcp$|^mcp-/g, '') || 'server'}": {
      "command": "npx",
      "args": ["-y", "${s.name}@${s.version}"]
    }
  }
}`
  const advice = s.capabilities.map(c => CAPABILITY_ADVICE[c.id]).filter(Boolean)
  const card = { backgroundColor: 'var(--card)', border: '1px solid var(--border)' }

  return (
    <main style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen px-4 py-12 md:px-6 md:py-16">
      <article className="mx-auto max-w-3xl">
        <nav style={{ color: 'var(--text-muted)' }} className="text-xs"><Link href="/mcp/" className="hover:underline">MCP security directory</Link> / {s.name}</nav>
        <h1 style={{ color: 'var(--text-primary)' }} className="mt-3 break-words text-3xl font-semibold tracking-tight md:text-4xl">Is {s.name} safe?</h1>
        {s.description && <p style={{ color: 'var(--text-secondary)' }} className="mt-3 text-base leading-7">{s.description}</p>}

        <section style={{ ...card, borderColor: r.color }} className="mt-6 rounded-3xl p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span style={{ color: r.color, backgroundColor: r.bg }} className="rounded-full px-3 py-1 text-sm font-semibold">{r.label}</span>
            <span style={{ color: 'var(--text-muted)' }} className="text-xs">Version {s.version} · checked {checked}</span>
          </div>
          <p style={{ color: 'var(--text-primary)' }} className="mt-3 text-sm leading-6">{r.explain}</p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">Why: {s.reasons.join('; ')}.</p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">Maintain this server? <a href="#maintainers" className="font-semibold text-[color:var(--accent-purple-text)] underline">Get a README badge or ask for a re-scan</a>.</p>
        </section>

        <section className="mt-8">
          <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">What it can do</h2>
          {s.capabilities.length ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {s.capabilities.map(c => (
                <li key={c.id} style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)', backgroundColor: 'var(--surface)' }} className="rounded-full px-3 py-1 text-xs font-medium">{c.label}</li>
              ))}
            </ul>
          ) : <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-sm">No commands, file changes, browser control or database access found in its code.</p>}
          {s.tools.length > 0 && (
            <div className="mt-4">
              <p style={{ color: 'var(--text-muted)' }} className="text-xs">Tools it offers your AI ({s.tools.length}{s.tools.length >= 40 ? '+' : ''}):</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {s.tools.map(t => <li key={t} style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }} className="rounded-md px-2 py-0.5 font-mono text-[11px]">{t}</li>)}
              </ul>
            </div>
          )}
        </section>

        {advice.length > 0 && (
          <section style={card} className="mt-8 rounded-3xl p-5">
            <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">How to use it safely</h2>
            <ul style={{ color: 'var(--text-secondary)' }} className="mt-3 space-y-2 text-sm">
              {advice.map(a => <li key={a}>✓ {a}</li>)}
              <li>✓ Pin the version (below) so an update can&apos;t change what it does without you noticing.</li>
            </ul>
          </section>
        )}

        <section className="mt-8">
          <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">Code patterns worth reviewing</h2>
          {s.findings.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-sm">No risky code patterns matched in the files we read ({s.filesScanned}).</p>
          ) : (
            <>
              <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs leading-5">Automated pattern matches in the published package. Some are expected for this kind of server, and some may be false positives — they are pointers for review, not confirmed vulnerabilities.</p>
              <ul className="mt-3 space-y-2">
                {s.findings.map(f => (
                  <li key={f.code} style={card} className="rounded-2xl p-3.5">
                    <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{f.title}</p>
                    <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs leading-5">{f.whatIsWrong}</p>
                    {f.file && <p style={{ color: 'var(--text-muted)' }} className="mt-1 font-mono text-[11px]">{f.file}{f.line ? `:${f.line}` : ''}</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="mt-8">
          <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">Install it pinned</h2>
          <div className="mt-3"><CodeBlock code={install} label={`Pinned ${s.name} config`} /></div>
          <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs">
            {s.repository && <><a href={s.repository} target="_blank" rel="noreferrer nofollow" className="underline">Source</a> · </>}
            <a href={`https://www.npmjs.com/package/${s.name}`} target="_blank" rel="noreferrer nofollow" className="underline">npm</a>
            {s.license && <> · {/^SEE LICENSE/i.test(s.license) ? 'License file in package' : `${s.license} license`}</>}
            {s.weeklyDownloads > 0 && <> · {s.weeklyDownloads.toLocaleString('en-US')} downloads last week</>}
          </p>
        </section>

        <section style={card} className="mt-10 grid gap-4 rounded-3xl p-5 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <h2 style={{ color: 'var(--text-primary)' }} className="text-base font-semibold">Check your whole MCP setup</h2>
            <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">Agent Verify checks the servers in your Claude, Cursor and VS Code config — including whole-drive access and keys stored in plain text.</p>
          </div>
          <Link href="/developers#mcp" className="rounded-2xl bg-[#7C3AED] px-5 py-3 text-center text-sm font-semibold text-white hover:opacity-90">Check my setup free</Link>
        </section>

        <section id="maintainers" className="mt-10 scroll-mt-24 border-t pt-6" style={{ borderColor: 'var(--border)' }}>
          <h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Maintain {s.name}?</h2>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs leading-5">
            Show users you&apos;ve thought about access: add the badge below. It links to this page, so people can see what your server can reach and how to use it safely. If something here is wrong or you&apos;ve released a fix, <a href={`mailto:hello@aiblockchainventures.com?subject=${encodeURIComponent(`MCP re-scan request: ${s.name}`)}`} className="underline">ask for a re-scan</a> — we update pages on request.
          </p>
          <div className="mt-3"><CodeBlock code={`[![MCP safety: reviewed by Agent Verify](${REVIEWED_BADGE_URL})](${pageUrl})`} label="README badge" /></div>
          <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-[11px] leading-5">Prefer to show the access level instead? <code className="break-all">{`[![Agent Verify: ${r.label}](${badgeUrl(s)})](${pageUrl})`}</code></p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-4 text-[11px] leading-5">
            Agent Verify reads the package published on npm as text — it is never installed or run. Ratings describe capability, not intent, and are an automated, evidence-based check, not a guarantee. Scanner {mcpSafety.scannerVersion}.
          </p>
        </section>
      </article>
    </main>
  )
}
