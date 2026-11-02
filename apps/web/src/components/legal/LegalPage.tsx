'use client'

import type { ReactNode } from 'react'

export interface LegalSection {
  title: string
  body: ReactNode
}

/** Shared layout for the Privacy Policy and Terms pages. */
export function LegalPage({ title, updated, intro, sections }: { title: string; updated: string; intro?: ReactNode; sections: LegalSection[] }) {
  return (
    <>
      <div className="mx-auto max-w-3xl px-6 pt-6">
        <button onClick={() => window.history.back()} style={{ color: 'var(--text-muted)' }} className="mb-6 flex items-center gap-2 text-sm transition-opacity hover:opacity-70">
          ← Back
        </button>
      </div>
      <article style={{ backgroundColor: 'var(--bg)' }} className="mx-auto max-w-3xl px-6 pb-16 pt-6">
        <h1 style={{ color: 'var(--text-primary)' }} className="text-3xl font-bold tracking-tight">{title}</h1>
        <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">Last updated: {updated}</p>
        {intro && <div style={{ color: 'var(--text-secondary)' }} className="mt-6 text-sm leading-relaxed">{intro}</div>}
        <div className="mt-8">
          {sections.map(section => (
            <section key={section.title} style={{ borderBottom: '1px solid var(--border)' }} className="mb-8 pb-8 last:border-b-0">
              <h2 style={{ color: 'var(--text-primary)' }} className="mb-3 text-lg font-semibold">{section.title}</h2>
              <div style={{ color: 'var(--text-secondary)' }} className="legal-body space-y-3 text-sm leading-relaxed">{section.body}</div>
            </section>
          ))}
        </div>
      </article>
    </>
  )
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return <ul className="list-disc space-y-1.5 pl-5">{items.map((item, i) => <li key={i}>{item}</li>)}</ul>
}
