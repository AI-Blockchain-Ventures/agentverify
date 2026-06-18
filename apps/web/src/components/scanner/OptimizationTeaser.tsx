import type { Finding } from '@/types'

interface OptimizationTeaserProps {
  findings: Finding[]
}

export function OptimizationTeaser({ findings }: OptimizationTeaserProps) {
  const hints = findings.length
    ? findings.map(f => ({ title: f.title, fix: f.recommendedFix }))
    : [{ title: 'No findings', fix: 'Your agent configuration passed all checks.' }]

  return (
    <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-xl p-6">
      <h3 style={{ color: 'var(--text-primary)' }} className="mb-4 font-semibold">Remediation Guide</h3>
      <div className="space-y-3">
        {hints.slice(0, 5).map((item, idx) => (
          <div key={idx}>
            <p style={{ color: 'var(--text-primary)' }} className="text-sm font-medium">{item.title}</p>
            <p style={{ color: 'var(--text-muted)' }} className="text-sm">{item.fix}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
