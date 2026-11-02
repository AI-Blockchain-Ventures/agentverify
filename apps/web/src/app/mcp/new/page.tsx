import Link from 'next/link'
import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { CATEGORY_LABELS, RATING_COPY, categoryOf, mcpSafety, newMcpServers } from '@/lib/mcpSafety'

export const metadata: Metadata = pageMetadata(
  '/mcp/new',
  'New MCP servers this month — security check',
  'MCP servers released in the last few weeks, with what each one can do on your computer before you install it.',
)

export default function NewMcpPage() {
  const fresh = newMcpServers()
  const list = fresh.length ? fresh : [...mcpSafety.servers].sort((a, b) => new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime()).slice(0, 30)
  return (
    <main style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen px-4 py-12 md:px-6 md:py-16">
      <div className="mx-auto max-w-3xl">
        <nav style={{ color: 'var(--text-muted)' }} className="text-xs"><Link href="/mcp/" className="hover:underline">MCP security directory</Link> / New</nav>
        <h1 style={{ color: 'var(--text-primary)' }} className="mt-3 text-3xl font-semibold tracking-tight">{fresh.length ? 'New MCP servers this month' : 'Recently updated MCP servers'}</h1>
        <p style={{ color: 'var(--text-secondary)' }} className="mt-3 text-base leading-7">New servers have the least track record. Check what each one can reach before you connect it to your AI assistant.</p>
        <ul className="mt-6 space-y-3">
          {list.map(s => {
            const r = RATING_COPY[s.rating]
            const first = (s as typeof s & { firstPublishedAt?: string | null }).firstPublishedAt
            return (
              <li key={s.slug}>
                <Link href={`/mcp/${s.slug}/`} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="flex flex-wrap items-start justify-between gap-3 rounded-2xl p-4">
                  <div className="min-w-0">
                    <p style={{ color: 'var(--text-primary)' }} className="break-all text-sm font-semibold">{s.name}</p>
                    <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">{CATEGORY_LABELS[categoryOf(s)]}{first ? ` · first released ${new Date(first).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</p>
                  </div>
                  <span style={{ color: r.color, backgroundColor: r.bg }} className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold">{r.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </main>
  )
}
