import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { pageMetadata } from '@/lib/seo'
import { CATEGORY_LABELS, PACK_LABELS, SEVERITY_ORDER, SEVERITY_STYLE, checkLibrary, getCheck } from '@/lib/checkLibrary'

export const dynamicParams = false

export function generateStaticParams() {
  return checkLibrary.checks.map(c => ({ slug: c.slug }))
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const c = getCheck(params.slug)
  if (!c) return {}
  return pageMetadata(`/checks/${c.slug}`, `${c.name} (${c.id})`, `${c.whatItDetects} Why it matters for AI agents and how to fix it.`.slice(0, 300))
}

const DETECTION_COPY: Record<string, string> = {
  'pattern-match': 'Looks for a specific risky pattern in the code or config.',
  'absence-of-pattern': 'Flags a safety control that should be there but is not.',
  'contextual-heuristic': 'Looks for a risky pattern, and stays quiet when a matching safeguard is present.',
}
const EVIDENCE_COPY: Record<string, string> = {
  definite: 'Definite: the risky setting is written plainly in the file.',
  heuristic: 'Likely: strong signal, but review it in context.',
  informational: 'Informational: worth knowing, not necessarily a problem.',
}

export default function CheckPage({ params }: { params: { slug: string } }) {
  const c = getCheck(params.slug)
  if (!c) notFound()
  const sev = SEVERITY_STYLE[c.severity]
  const card = { backgroundColor: 'var(--card)', border: '1px solid var(--border)' }
  const related = checkLibrary.checks
    .filter(o => o.category === c.category && o.slug !== c.slug && !o.code.startsWith('SECRET_DETECTED_'))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, 6)
  const compliance = c.compliance ? ([['OWASP LLM Top 10', c.compliance.owasp], ['NIST AI RMF', c.compliance.nist], ['SOC 2', c.compliance.soc2]] as const).filter(([, v]) => v && v.length) : []
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: `${c.name} (${c.id})`,
    description: c.whatItDetects,
    about: 'AI agent security',
    publisher: { '@type': 'Organization', name: 'AI Blockchain Ventures' },
  }

  return (
    <main style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen px-4 py-12 md:px-6 md:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <article className="mx-auto max-w-3xl">
        <nav style={{ color: 'var(--text-muted)' }} className="text-xs" aria-label="Breadcrumb">
          <Link href="/checks" className="hover:underline">Check library</Link> / {CATEGORY_LABELS[c.category] ?? c.category}
        </nav>
        <h1 style={{ color: 'var(--text-primary)' }} className="mt-3 break-words text-3xl font-semibold tracking-tight md:text-4xl">{c.name}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span style={{ color: sev.color, backgroundColor: sev.bg }} className="rounded-full px-2.5 py-1 font-semibold">{sev.label}</span>
          <span style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }} className="rounded-full px-2.5 py-1 font-mono">{c.id}</span>
          <span style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }} className="rounded-full px-2.5 py-1">{CATEGORY_LABELS[c.category] ?? c.category}</span>
          <span style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }} className="rounded-full px-2.5 py-1">{PACK_LABELS[c.pack] ?? c.pack} pack</span>
          {c.addedIn === '2.0.0' && <span className="rounded-full bg-[#7C3AED]/10 px-2.5 py-1 font-semibold text-[color:var(--accent-purple-text)]">New in 2.0</span>}
        </div>

        <section className="mt-8">
          <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">What it finds</h2>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-2 text-base leading-7">{c.whatItDetects}</p>
        </section>

        <section className="mt-8">
          <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">Why it matters</h2>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-2 text-base leading-7">{c.whyItMatters}</p>
          {c.impact && (
            <p style={{ ...card, color: 'var(--text-primary)' }} className="mt-4 rounded-lg p-4 text-sm leading-6">
              <span className="font-semibold">What an attacker could do: </span>{c.impact}
            </p>
          )}
        </section>

        <section className="mt-8">
          <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">How to fix it</h2>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-2 text-base leading-7">{c.remediation}</p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-sm">
            Pro shows the corrected code for your exact file, step by step, and re-scans to confirm the fix.{' '}
            <Link href="/pricing" className="font-semibold text-[color:var(--accent-purple-text)]">See plans</Link>
          </p>
        </section>

        <section style={card} className="mt-8 rounded-xl p-5">
          <h2 style={{ color: 'var(--text-primary)' }} className="text-base font-semibold">Check details</h2>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-[160px_1fr]">
            <dt style={{ color: 'var(--text-muted)' }}>Finding code</dt><dd style={{ color: 'var(--text-primary)' }} className="break-all font-mono text-xs">{c.code}{c.family ? '_*' : ''}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>How it detects</dt><dd style={{ color: 'var(--text-secondary)' }}>{DETECTION_COPY[c.detectionType] ?? c.detectionType}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>Confidence</dt><dd style={{ color: 'var(--text-secondary)' }}>{EVIDENCE_COPY[c.evidenceType] ?? c.evidenceType}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>Scans</dt><dd style={{ color: 'var(--text-secondary)' }}>{c.supportedContent}</dd>
            {compliance.map(([label, items]) => (
              <div key={label} className="contents">
                <dt style={{ color: 'var(--text-muted)' }}>{label}</dt>
                <dd style={{ color: 'var(--text-secondary)' }}>{items!.join(', ')}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-8 rounded-xl p-5" style={{ backgroundColor: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.25)' }}>
          <h2 style={{ color: 'var(--text-primary)' }} className="text-base font-semibold">Check your agent for this</h2>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-sm">Paste your agent code or MCP config. The free scan runs all {checkLibrary.total} checks in about 10 seconds — no account needed.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/#public-scan" className="rounded-md bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6D28D9]">Scan an agent free</Link>
            <Link href="/developers" style={{ border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} className="rounded-md px-4 py-2 text-sm font-semibold">Run it in CI or your editor</Link>
          </div>
        </section>

        {related.length > 0 && (
          <section className="mt-10">
            <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">Related checks</h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {related.map(r => (
                <li key={r.slug}>
                  <Link href={`/checks/${r.slug}`} style={card} className="block rounded-lg p-3 text-sm transition-colors hover:border-[#7C3AED]">
                    <span style={{ color: 'var(--text-primary)' }} className="font-medium">{r.name}</span>
                    <span style={{ color: 'var(--text-muted)' }} className="mt-0.5 block font-mono text-[11px]">{r.id} · {SEVERITY_STYLE[r.severity].label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </main>
  )
}
