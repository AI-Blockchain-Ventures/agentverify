import Link from 'next/link'
import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { CATEGORY_LABELS, mcpComparisons, mcpSafety } from '@/lib/mcpSafety'
import { McpDirectory } from '@/components/mcp/McpDirectory'

export const metadata: Metadata = pageMetadata(
  '/mcp',
  'Is your MCP server safe? MCP security directory',
  'Before you install an MCP server, see what it can do on your computer — run commands, change files, control a browser, use your API keys — and how to use it safely. Popular MCP servers, checked by Agent Verify.',
)

export default function McpIndexPage() {
  const servers = [...mcpSafety.servers].sort((a, b) => b.weeklyDownloads - a.weeklyDownloads)
  const updated = new Date(mcpSafety.generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  return (
    <main style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen px-4 py-16 md:px-6 md:py-20">
      <div className="mx-auto max-w-5xl">
        <header className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[color:var(--accent-cyan-text)]">MCP security directory</p>
          <h1 style={{ color: 'var(--text-primary)' }} className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">Is your MCP server safe?</h1>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-5 text-base leading-7">
            An MCP server gives your AI assistant new powers. If the assistant is ever tricked — by a web page, an email, or a poisoned document — it can use those powers against you. See what {servers.length} popular servers can do before you install them.
          </p>
        </header>

        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mx-auto mt-10 max-w-3xl rounded-3xl p-5 text-sm">
          <p style={{ color: 'var(--text-primary)' }} className="font-semibold">How to read this</p>
          <ul style={{ color: 'var(--text-secondary)' }} className="mt-2 space-y-1.5">
            <li><strong>Broad access</strong> — can run commands on your computer.</li>
            <li><strong>Review before use</strong> — can change files, drive a browser, query a database, or spend your API keys.</li>
            <li><strong>Limited access</strong> — no high-reach capabilities found.</li>
          </ul>
          <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs leading-5">
            Ratings describe what a server <em>can do</em>, not whether its authors are trustworthy — many excellent servers need broad access to be useful. Based on an automated read of each package&apos;s published code (never run). Updated {updated}.
          </p>
        </section>

        <div className="mt-10">
          <McpDirectory servers={servers} />
        </div>

        <section className="mt-12">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">Compare popular servers</h2>
            <Link href="/mcp/new/" className="text-sm font-semibold text-[color:var(--accent-purple-text)] hover:underline">New this month →</Link>
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {mcpComparisons().slice(0, 24).map(c => (
              <li key={c.slug}>
                <Link href={`/mcp/compare/${c.slug}/`} style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)', backgroundColor: 'var(--card)' }} className="block truncate rounded-xl px-3 py-2 text-xs hover:opacity-80">
                  <span style={{ color: 'var(--text-muted)' }}>{CATEGORY_LABELS[c.category]}:</span> {c.a.name} vs {c.b.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mt-12 grid gap-4 rounded-3xl p-6 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">Check the servers you already have</h2>
            <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">Agent Verify reads your Claude, Cursor, VS Code and Windsurf MCP settings and flags whole-drive access, unpinned packages, unauthenticated remote servers and keys stored in plain text.</p>
          </div>
          <Link href="/developers#mcp" className="rounded-2xl bg-[#7C3AED] px-5 py-3 text-center text-sm font-semibold text-white hover:opacity-90">Check my MCP setup</Link>
        </section>
      </div>
    </main>
  )
}
