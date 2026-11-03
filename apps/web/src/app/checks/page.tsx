import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { checkLibrary } from '@/lib/checkLibrary'
import { CheckLibraryBrowser, type BrowserCheck } from '@/components/checks/CheckLibraryBrowser'

export const metadata: Metadata = pageMetadata(
  '/checks',
  'AI Agent Security Check Library',
  `All ${checkLibrary.total} Agent Verify checks for AI agents and MCP servers: what each one finds, why it matters, and how to fix it.`,
)

export default function ChecksPage() {
  const checks: BrowserCheck[] = checkLibrary.checks.map(c => ({
    slug: c.slug,
    id: c.id,
    code: c.code,
    name: c.name,
    category: c.category,
    severity: c.severity,
    pack: c.pack,
    isNew: c.addedIn === '2.0.0',
    summary: c.whatItDetects.length > 170 ? `${c.whatItDetects.slice(0, 167)}…` : c.whatItDetects,
  }))
  const newCount = checks.filter(c => c.isNew).length

  return (
    <main style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen px-4 py-12 md:px-6 md:py-16">
      <div className="mx-auto max-w-[1320px] min-[1800px]:max-w-[1520px]">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-purple-text)]">Check library</p>
        <h1 style={{ color: 'var(--text-primary)' }} className="mt-2 text-3xl font-semibold tracking-tight md:text-5xl">{checkLibrary.total} security checks for AI agents</h1>
        <p style={{ color: 'var(--text-secondary)' }} className="mt-4 max-w-3xl text-base leading-7">
          Every check Agent Verify runs, in plain English: what it finds, why it matters, and how to fix it. Each one is tested to make sure it actually fires — {newCount} are new in 2.0, including MCP tool poisoning, AI agents in CI, and checks for 11 agent frameworks.
        </p>
        <CheckLibraryBrowser checks={checks} />
      </div>
    </main>
  )
}
