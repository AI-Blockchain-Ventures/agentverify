const cards = [
  ['Verdict', 'Security report', 'A clear verdict, 100-point risk score, risk level, and finding count on the first screen.'],
  ['Fix', 'Recommended fixes', 'Plain-English findings with corrected code or configuration snippets when available.'],
  ['Share', 'Private by default', 'Keep reports private, or share a public report link any time — Pro also unlocks PDF export.'],
]

export function WhatYouGet() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-20">
      <p style={{ color: 'var(--text-secondary)' }} className="text-xs font-semibold uppercase tracking-[0.24em]">What you get</p>
      <h2 style={{ color: 'var(--text-primary)' }} className="mb-10 mt-2 text-3xl font-semibold tracking-tight md:text-4xl">A report your team can act on.</h2>
      <div className="grid gap-6 md:grid-cols-3">
        {cards.map(([label, title, body]) => (
          <div key={title} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-6 shadow-xl shadow-black/5">
            <div className="mb-4 inline-flex rounded-full bg-[#7C3AED]/10 px-3 py-1 text-xs font-semibold text-[color:var(--accent-purple-text)]">{label}</div>
            <h3 style={{ color: 'var(--text-primary)' }} className="mb-2 font-semibold">{title}</h3>
            <p style={{ color: 'var(--text-secondary)' }} className="text-sm leading-relaxed">{body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
