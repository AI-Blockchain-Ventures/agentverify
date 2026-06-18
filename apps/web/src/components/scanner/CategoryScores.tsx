import type { CategoryScore } from '@/types'
import { ScoreBar } from '@/components/ui/ScoreBar'

export function CategoryScores({ scores }: { scores: CategoryScore[] }) {
  const displayScores = scores.map(score => ({
    ...score,
    label: score.category === 'A' ? 'Protocol Compliance' : 'Security Controls',
  }))

  return (
    <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mb-6 rounded-xl p-6">
      <h3 style={{ color: 'var(--text-primary)' }} className="mb-4 font-semibold">Category Scores</h3>
      <div className="space-y-5">
        {displayScores.map(score => <ScoreBar key={score.category} score={score.score} maxScore={score.maxScore} label={score.label} category={score.category} />)}
      </div>
    </div>
  )
}
