const cards = [
  ['✓', 'Execution Verdict', 'Binary VERIFIED / NOT VERIFIED determination. A 100-point risk score and per-category confidence breakdown.'],
  ['≡', 'Runtime Bill of Materials', 'Structured inventory of every permission, credential, tool access, governance control, and operational characteristic.'],
  ['⚡', 'Fix Guidance', 'Actionable fix recommendations for every issue detected. Know exactly what to change and why.'],
]

export function WhatYouGet() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-20">
      <p className="text-xs font-medium uppercase tracking-widest text-[#94A3B8]">WHAT YOU GET</p>
      <h2 className="mb-10 mt-2 text-3xl font-bold text-white md:text-4xl">More than a scanner.</h2>
      <div className="grid gap-6 md:grid-cols-3">
        {cards.map(([icon, title, body]) => (
          <div key={title} className="rounded-xl border border-[#1E2D40] bg-[#0F1623] p-6">
            <div className="mb-4 text-xl text-white">{icon}</div>
            <h3 className="mb-2 font-semibold text-white">{title}</h3>
            <p className="text-sm leading-relaxed text-[#94A3B8]">{body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
