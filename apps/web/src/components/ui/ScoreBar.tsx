'use client'

import { useEffect, useState } from 'react'

interface ScoreBarProps {
  score: number
  maxScore: number
  label: string
  category?: 'A' | 'B'
  showLabel?: boolean
}

export function ScoreBar({ score, maxScore, label, category, showLabel = true }: ScoreBarProps) {
  const [width, setWidth] = useState(0)
  const pct = maxScore === 0 ? 0 : Math.max(0, Math.min(100, (score / maxScore) * 100))
  const fill = category === 'A' ? 'bg-red' : category === 'B' ? 'bg-orange' : 'bg-blue'
  const scoreColor = pct >= 80 ? 'text-green' : pct >= 50 ? 'text-orange' : 'text-red'

  useEffect(() => setWidth(pct), [pct])

  return (
    <div>
      {showLabel && (
        <div className="mb-2 flex justify-between text-sm">
          <span className="text-gray-400">{label}</span>
          <span className={scoreColor}>{score}/{maxScore}</span>
        </div>
      )}
      <div className="h-1.5 overflow-hidden rounded-full bg-gray-800">
        <div className={`h-full rounded-full transition-all duration-700 ease-out ${fill}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}
