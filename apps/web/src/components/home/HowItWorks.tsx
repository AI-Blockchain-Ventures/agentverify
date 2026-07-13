const steps = [
  ['01', 'Scan agent', 'Paste code or upload a config file. Dashboard scans run in your browser.'],
  ['02', 'Review findings', 'See the verdict, risk score, severity, evidence, and affected controls.'],
  ['03', 'Apply fixes', 'Use recommended fixes, corrected code, and A2SPA guidance where available.'],
  ['04', 'Re-scan and share', 'Re-scan after changes, then keep the report private or share it when ready.'],
]

export function HowItWorks() {
  return (
    <section style={{ borderTop: '1px solid var(--border)' }} className="px-4 py-16 md:px-6 md:py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-16 text-center">
          <p style={{ color: 'var(--text-secondary)' }} className="text-xs font-semibold uppercase tracking-[0.24em]">How it works</p>
          <h2 style={{ color: 'var(--text-primary)' }} className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">From scan to safer deployment.</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
          {steps.map(([num, title, desc]) => (
            <div key={num} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-5 shadow-xl shadow-black/5 transition-transform hover:-translate-y-0.5 md:p-6">
              <div style={{ color: 'var(--border-light)' }} className="text-5xl font-bold leading-none">{num}</div>
              <h3 style={{ color: 'var(--text-primary)' }} className="mb-2 mt-4 font-semibold">{title}</h3>
              <p style={{ color: 'var(--text-secondary)' }} className="text-sm leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
