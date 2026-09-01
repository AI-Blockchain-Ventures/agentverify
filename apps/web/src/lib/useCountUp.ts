'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Animates a displayed integer counting up (or down) to `target` — used for score reveals so a
 * verdict/score feels like a result landing, not a static label. Respects
 * prefers-reduced-motion (jumps straight to the final value, no animation) and skips animating
 * on the very first render of a given value (so a page load doesn't count up from 0 for content
 * that was never "0" a moment ago — only a value that actually CHANGES animates).
 *
 * Correctness over polish: requestAnimationFrame is throttled to near-zero by the browser in a
 * hidden/backgrounded tab (spec-compliant behavior, not a bug) — a naive rAF-only animation can
 * then get stuck showing a stale, WRONG number (e.g. a safe agent's real 100/100 score frozen at
 * 0) for as long as the tab stays backgrounded, which is a genuinely bad failure mode for a
 * security score. This hook never lets that happen: a bounded setTimeout independent of rAF
 * always snaps the displayed value to the exact target no later than `durationMs` after a change,
 * whether or not any animation frames actually ran. A hidden tab skips the animation outright and
 * shows the correct value immediately, the same as reduced-motion.
 */
export function useCountUp(target: number, durationMs = 700): number {
  const [displayed, setDisplayed] = useState(target)
  const previousTarget = useRef(target)
  const frame = useRef<number | null>(null)
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const from = previousTarget.current
    previousTarget.current = target
    if (from === target) return

    const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const hidden = typeof document !== 'undefined' && document.hidden
    if (reduceMotion || hidden) {
      setDisplayed(target)
      return
    }

    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs)
      // ease-out cubic — fast start, settles gently, matches the rest of the product's motion feel
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplayed(Math.round(from + (target - from) * eased))
      if (progress < 1) frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)

    // Safety net: guarantees the correct final value lands even if rAF stalls or the tab is
    // backgrounded mid-animation (e.g. the user switches away right after triggering it).
    timeout.current = setTimeout(() => setDisplayed(target), durationMs + 100)

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      if (timeout.current !== null) clearTimeout(timeout.current)
    }
  }, [target, durationMs])

  return displayed
}
