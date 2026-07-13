import type { Verdict } from '@/types'

export function normalizeVerdict(value: unknown): Verdict {
  if (value === 'VERIFIED') return 'VERIFIED'
  if (value === 'NOT_ASSESSED' || value === 'NOT ASSESSED') return 'NOT_ASSESSED'
  return 'NOT_VERIFIED'
}

export function verdictLabel(verdict: Verdict): string {
  if (verdict === 'VERIFIED') return 'VERIFIED'
  if (verdict === 'NOT_ASSESSED') return 'NOT ASSESSED'
  return 'NOT VERIFIED'
}
