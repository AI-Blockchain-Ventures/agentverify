const cards = [
  ['✓', 'Execution Verdict', 'VERIFIED or NOT VERIFIED with a 100-point risk score and severity breakdown across 15 security signals.'],
  ['≡', 'Evidence & Fix Code', 'See exactly what triggered each finding with extracted code evidence. Quick-fix snippets and full remediation guidance for every issue.'],
  ['⚡', 'Compliance & Sharing', 'Findings mapped to OWASP, NIST, and SOC 2. Share reports publicly, with a password, or keep them private. Verified badge for your README.'],
]

export function WhatYouGet() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-20">
      <p style={{ color: 'var(--text-secondary)' }} className="text-xs font-medium uppercase tracking-widest">WHAT YOU GET</p>
      <h2 style={{ color: 'var(--text-primary)' }} className="mb-10 mt-2 text-3xl font-bold md:text-4xl">More than a scanner.</h2>
      <div className="grid gap-6 md:grid-cols-3">
        {cards.map(([icon, title, body]) => (
          <div key={title} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-xl p-6">
            <div style={{ color: 'var(--text-primary)' }} className="mb-4 text-xl">{icon}</div>
            <h3 style={{ color: 'var(--text-primary)' }} className="mb-2 font-semibold">{title}</h3>
            <p style={{ color: 'var(--text-secondary)' }} className="text-sm leading-relaxed">{body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
