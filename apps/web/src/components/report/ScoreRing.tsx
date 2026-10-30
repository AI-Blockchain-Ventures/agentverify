/**
 * Score ring + severity bar for the report header (v1.6). Plain SVG/CSS — prints cleanly in the
 * PDF export and needs no chart library. The number shown is the same riskScore as before; the
 * ring only visualizes it.
 */
export function ScoreRing({ score, verified, size = 132 }: { score: number; verified: boolean; size?: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)))
  const stroke = 11
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - clamped / 100)
  const color = verified ? '#10B981' : clamped >= 70 ? '#EAB308' : clamped >= 40 ? '#E07B39' : '#E03E3E'
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Security score ${clamped} out of 100 (higher is safer)`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 700ms ease-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span style={{ color: 'var(--text-primary)' }} className="text-4xl font-bold tabular-nums leading-none">{clamped}</span>
        <span style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">/100</span>
      </div>
    </div>
  )
}

export function SeverityBar({ critical, high, medium, low }: { critical: number; high: number; medium: number; low: number }) {
  const total = critical + high + medium + low
  const parts: Array<[string, number, string]> = [
    ['Critical', critical, '#E03E3E'],
    ['High', high, '#E07B39'],
    ['Medium', medium, '#EAB308'],
    ['Low', low, '#06B6D4'],
  ]
  if (total === 0) {
    return <div style={{ color: 'var(--text-muted)' }} className="text-xs">No findings</div>
  }
  return (
    <div>
      <div className="flex h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: 'var(--border)' }} aria-hidden="true">
        {parts.filter(([, n]) => n > 0).map(([label, n, c]) => (
          <span key={label} style={{ width: `${(n / total) * 100}%`, backgroundColor: c }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        {parts.filter(([, n]) => n > 0).map(([label, n, c]) => (
          <span key={label} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: c }} />{n} {label.toLowerCase()}</span>
        ))}
      </div>
    </div>
  )
}
