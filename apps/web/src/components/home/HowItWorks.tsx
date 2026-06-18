const steps = [
  ['01', 'Submit', 'Paste agent code or upload a config file. JavaScript, Python, YAML, JSON — any format.'],
  ['02', 'Analyze', '15 signals run in milliseconds. No data leaves your browser for dashboard scans.'],
  ['03', 'Verdict', 'VERIFIED or NOT VERIFIED with a 100-point score, severity breakdown, compliance mapping, and evidence extracts.'],
  ['04', 'Fix & Share', 'Every finding includes remediation guidance. Keep reports private, password protect them, or share a public link and README badge.'],
]

export function HowItWorks() {
  return (
    <section style={{ borderTop: '1px solid var(--border)' }} className="px-4 py-16 md:px-6 md:py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-16 text-center">
          <p style={{ color: 'var(--text-secondary)' }} className="text-xs font-medium uppercase tracking-widest">HOW IT WORKS</p>
          <h2 style={{ color: 'var(--text-primary)' }} className="mt-2 text-3xl font-bold md:text-4xl">Four steps to execution trust</h2>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {steps.map(([num, title, desc]) => (
            <div key={num} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-xl p-4 transition-opacity hover:opacity-80 md:p-6">
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
