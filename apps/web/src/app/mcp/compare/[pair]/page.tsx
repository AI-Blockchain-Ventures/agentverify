import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { pageMetadata } from '@/lib/seo'
import { CATEGORY_LABELS, RATING_COPY, compareReach, getComparison, mcpComparisons, mcpSafety, type McpServerEntry } from '@/lib/mcpSafety'

export const dynamicParams = false

export function generateStaticParams() {
  return mcpComparisons().map(c => ({ pair: c.slug }))
}

export function generateMetadata({ params }: { params: { pair: string } }): Metadata {
  const c = getComparison(params.pair)
  if (!c) return {}
  return pageMetadata(`/mcp/compare/${c.slug}`, `${c.a.name} vs ${c.b.name}: which MCP server is safer?`, `Side-by-side security comparison of ${c.a.name} and ${c.b.name}: what each can do on your computer, access level, tools, and code patterns worth reviewing.`)
}

const CAPS = [
  ['shell', 'Runs shell commands'],
  ['spawn', 'Starts other programs'],
  ['fs-write', 'Writes or deletes files'],
  ['fs-read', 'Reads files'],
  ['browser', 'Controls a web browser'],
  ['database', 'Queries a database'],
  ['network', 'Calls internet services'],
  ['secrets', 'Needs API keys or tokens'],
] as const

function has(s: McpServerEntry, id: string) {
  return s.capabilities.some(c => c.id === id)
}

export default function ComparePage({ params }: { params: { pair: string } }) {
  const c = getComparison(params.pair)
  if (!c) notFound()
  const { a, b } = c
  const cell = { borderTop: '1px solid var(--border)' }
  const rows: Array<[string, React.ReactNode, React.ReactNode]> = [
    ['Access level', <span key="a" style={{ color: RATING_COPY[a.rating].color }} className="font-semibold">{RATING_COPY[a.rating].label}</span>, <span key="b" style={{ color: RATING_COPY[b.rating].color }} className="font-semibold">{RATING_COPY[b.rating].label}</span>],
    ...CAPS.map(([id, label]) => [label, has(a, id) ? 'Yes' : '—', has(b, id) ? 'Yes' : '—'] as [string, string, string]),
    ['Tools it offers', a.tools.length || '—', b.tools.length || '—'],
    ['Code patterns to review', a.findings.length, b.findings.length],
    ['Downloads last week', a.weeklyDownloads.toLocaleString('en-US'), b.weeklyDownloads.toLocaleString('en-US')],
    ['Version checked', a.version, b.version],
  ]
  return (
    <main style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen px-4 py-12 md:px-6 md:py-16">
      <article className="mx-auto max-w-3xl">
        <nav style={{ color: 'var(--text-muted)' }} className="text-xs"><Link href="/mcp/" className="hover:underline">MCP security directory</Link> / {CATEGORY_LABELS[c.category]}</nav>
        <h1 style={{ color: 'var(--text-primary)' }} className="mt-3 break-words text-3xl font-semibold tracking-tight">{a.name} vs {b.name}</h1>
        <p style={{ color: 'var(--text-secondary)' }} className="mt-3 text-base leading-7">{compareReach(a, b)}</p>
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mt-6 overflow-x-auto rounded-3xl" role="region" aria-label="Comparison table" tabIndex={0}>
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead>
              <tr>
                <th className="p-4" />
                {[a, b].map(s => (
                  <th key={s.slug} className="p-4 align-bottom">
                    <Link href={`/mcp/${s.slug}/`} style={{ color: 'var(--text-primary)' }} className="break-all font-semibold hover:underline">{s.name}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody style={{ color: 'var(--text-secondary)' }}>
              {rows.map(([label, x, y]) => (
                <tr key={label}>
                  <th scope="row" style={{ ...cell, color: 'var(--text-muted)' }} className="p-4 text-xs font-medium">{label}</th>
                  <td style={cell} className="p-4">{x}</td>
                  <td style={cell} className="p-4">{y}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ color: 'var(--text-muted)' }} className="mt-4 text-xs leading-5">
          Based on an automated read of each package&apos;s published code (never run), checked {new Date(mcpSafety.generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. Access level describes what a server can do, not whether it is trustworthy.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={`/mcp/${a.slug}/`} className="rounded-xl border px-4 py-2 text-sm font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>Full check: {a.name}</Link>
          <Link href={`/mcp/${b.slug}/`} className="rounded-xl border px-4 py-2 text-sm font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>Full check: {b.name}</Link>
          <Link href="/developers#mcp" className="rounded-xl bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white">Check my MCP setup</Link>
        </div>
      </article>
    </main>
  )
}
