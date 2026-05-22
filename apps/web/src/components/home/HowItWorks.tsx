const steps = [
  ['01', 'Submit', 'Paste code or upload a file. JSON, YAML, Python, JavaScript, TypeScript.'],
  ['02', 'Analyze', '15-signal pipeline runs deterministic analysis across both vulnerability categories.'],
  ['03', 'Verdict', 'VERIFIED or NOT VERIFIED. Binary result with 100-point risk score.'],
  ['04', 'Report', 'Runtime BOM, categorized findings, and fix recommendations. Shareable link.'],
]

export function HowItWorks() {
  return (
    <section className="border-t border-[#1E2D40] px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-16 text-center">
          <p className="text-xs font-medium uppercase tracking-widest text-[#94A3B8]">HOW IT WORKS</p>
          <h2 className="mt-2 text-4xl font-bold text-white">Four steps to execution trust</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {steps.map(([num, title, desc]) => (
            <div key={num} className="rounded-xl border border-[#1E2D40] bg-[#0F1623] p-6 transition-colors hover:border-[#243244]">
              <div className="text-5xl font-bold leading-none text-[#1E2D40]">{num}</div>
              <h3 className="mb-2 mt-4 font-semibold text-white">{title}</h3>
              <p className="text-sm leading-relaxed text-[#94A3B8]">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
