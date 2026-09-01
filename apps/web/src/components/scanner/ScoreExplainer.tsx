interface ScoreFormulaLike {
  startingScore: number
  deductions: Array<{ reason: string; points: number }>
  cappedAt: number | null
  cappedReason: string | null
  finalScore: number
}

/** "How is this score calculated?" — an exact, structured breakdown, not just prose. */
export function ScoreExplainer({ formula }: { formula: ScoreFormulaLike }) {
  return (
    <details style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
      <summary className="cursor-pointer list-none">
        <div className="flex items-center justify-between gap-3">
          <span style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">How is this score calculated?</span>
          <span style={{ color: 'var(--text-muted)' }} className="text-xs">Show breakdown</span>
        </div>
      </summary>
      <div className="mt-4 space-y-2 border-t border-[var(--border)] pt-4 text-sm">
        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--text-secondary)' }}>Starting score</span>
          <span style={{ color: 'var(--text-primary)' }} className="font-mono font-semibold">{formula.startingScore}</span>
        </div>
        {formula.deductions.length === 0 && (
          <p style={{ color: 'var(--text-muted)' }} className="text-xs">No deductions — no critical, high, or medium findings were detected.</p>
        )}
        {formula.deductions.map((d, i) => (
          <div key={i} className="flex items-center justify-between">
            <span style={{ color: 'var(--text-secondary)' }} className="text-xs">{d.reason}</span>
            <span className="font-mono text-xs font-semibold text-[color:var(--accent-red-text)]">−{d.points}</span>
          </div>
        ))}
        {formula.cappedAt !== null && (
          <div className="rounded-lg border border-[#E07B39]/30 bg-[#E07B39]/10 p-3">
            <p className="text-xs font-semibold text-[color:var(--accent-orange-text)]">Capped at {formula.cappedAt}</p>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-xs">{formula.cappedReason}</p>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-[var(--border)] pt-2">
          <span style={{ color: 'var(--text-primary)' }} className="font-semibold">Final score</span>
          <span style={{ color: 'var(--text-primary)' }} className="font-mono text-lg font-bold">{formula.finalScore}</span>
        </div>
        <p style={{ color: 'var(--text-muted)' }} className="pt-2 text-xs leading-relaxed">
          Severity weighting: critical −20, high −10, medium −5 per finding (low-severity findings are shown but don&apos;t subtract points). Wildcard/broad tool or permission access caps the score at 65 regardless of other findings, because unrestricted access is treated as a ceiling on trust, not just one more deduction. This is a heuristic, evidence-based score — not a formal proof of security.
        </p>
      </div>
    </details>
  )
}
