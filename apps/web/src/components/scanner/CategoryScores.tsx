import type { CategoryScore } from '@/types'
import { ScoreBar } from '@/components/ui/ScoreBar'

export function CategoryScores({ scores }: { scores: CategoryScore[] }) {
  return (
    <div className="mb-6 rounded-xl border border-gray-800 bg-gray-950 p-6">
      <h3 className="mb-4 font-semibold text-white">Category Scores</h3>
      <div className="space-y-5">
        {scores.map(score => <ScoreBar key={score.category} score={score.score} maxScore={score.maxScore} label={score.label} category={score.category} />)}
      </div>
    </div>
  )
}
