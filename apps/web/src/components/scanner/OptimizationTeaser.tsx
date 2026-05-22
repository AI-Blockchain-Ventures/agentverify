import type { Finding } from '@/types'

interface OptimizationTeaserProps {
  findings: Finding[]
}

export function OptimizationTeaser({ findings }: OptimizationTeaserProps) {
  const hints = findings.length
    ? findings.map(f => ({ title: f.title, fix: f.recommendedFix }))
    : [{ title: 'No findings', fix: 'Your agent configuration passed all checks.' }]

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950 p-6">
      <h3 className="mb-4 font-semibold text-white">Remediation Guide</h3>
      <div className="space-y-3">
        {hints.slice(0, 5).map((item, idx) => (
          <div key={idx}>
            <p className="text-sm font-medium text-gray-300">{item.title}</p>
            <p className="text-sm text-gray-500">{item.fix}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
