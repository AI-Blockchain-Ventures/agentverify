import Link from 'next/link'
import { StatusPill } from '@/components/scanner/OwaspControlCard'
import { OWASP_ATTRIBUTION_DISCLAIMER, STATUS_MEANING } from '@/lib/owaspProfile'

const STATUSES = ['EVIDENCE_OBSERVED', 'GAP_IDENTIFIED', 'NOT_ASSESSED'] as const

export function OwaspProfileSection() {
  return (
    <section style={{ backgroundColor: 'var(--bg)' }} className="px-6 py-16">
      <div className="mx-auto max-w-6xl">
        <div style={{ border: '1px solid var(--border)', backgroundColor: 'var(--card)' }} className="rounded-[2rem] p-6 shadow-2xl shadow-black/5 md:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-purple-text)]">New &middot; OWASP Agentic Skills</p>
          <h2 style={{ color: 'var(--text-primary)' }} className="mt-2 max-w-2xl text-2xl font-semibold tracking-tight md:text-3xl">Assess agent skills against the OWASP Agentic Skills Top 10.</h2>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-3 max-w-2xl text-sm leading-6">
            Get evidence-based results for supply chain compromise (AST02), over-privileged skills (AST03), and insecure metadata (AST04). Every other control is shown as not assessed &mdash; never as a pass. Ask for a cryptographic signature and anyone can check the assessment against a key we publish independently.
          </p>
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {STATUSES.map(status => (
              <div key={status} style={{ border: '1px solid var(--border)', backgroundColor: 'var(--surface)' }} className="rounded-2xl p-4">
                <StatusPill status={status} />
                <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs leading-relaxed">{STATUS_MEANING[status]}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/owasp-agentic-skills" className="rounded-2xl bg-[#7C3AED] px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90">View a sample assessment</Link>
            <Link href="/profile-attestation" style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }} className="rounded-2xl px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-80">How signing works</Link>
          </div>
          <p style={{ color: 'var(--text-muted)' }} className="mt-5 text-xs leading-relaxed">{OWASP_ATTRIBUTION_DISCLAIMER}</p>
        </div>
      </div>
    </section>
  )
}
