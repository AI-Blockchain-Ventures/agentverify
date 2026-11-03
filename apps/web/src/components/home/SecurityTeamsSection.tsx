import Link from 'next/link'

const POINTS = [
  'Your raw agent code is never stored — only the results',
  'GitLab/Bitbucket tokens and test-agent headers encrypted at rest (AES-GCM)',
  'Signed, independently verifiable scan reports',
  'Team seats, roles and an audit log',
  'Public status page and changelog',
]

export function SecurityTeamsSection() {
  return (
    <section className="py-14 md:py-20">
      <div className="av-container">
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="grid items-center gap-8 rounded-xl p-6 md:grid-cols-2 md:p-10">
          <div>
            <h2 style={{ color: 'var(--text-primary)' }} className="text-2xl font-bold tracking-tight md:text-3xl">Built for security teams</h2>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-3 max-w-md text-base leading-7">Clear answers on how your code and data are handled — before you sign up.</p>
            <Link href="/trust" style={{ border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} className="mt-5 inline-flex rounded-md px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-80">Visit the Trust Center →</Link>
          </div>
          <ul className="space-y-3">
            {POINTS.map(p => (
              <li key={p} className="flex gap-3 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
                <span className="font-bold text-[color:var(--accent-green-text)]" aria-hidden="true">✓</span>{p}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
