'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { StoredReport } from '@/types'

const DISMISS_KEY = 'agentverify-getting-started-dismissed'

/**
 * v1.6 first-run checklist. Each step's "done" state comes from the user's real reports — nothing
 * is ticked just for clicking: a first scan exists, an agent has been re-scanned, a CLI/CI scan has
 * been saved. Hidden once all three are done, or when the user dismisses it.
 */
export function GettingStarted({ reports, onGoToScan, variant = 'card' }: { reports: StoredReport[]; onGoToScan: () => void; variant?: 'card' | 'hero' }) {
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    try { setDismissed(window.localStorage.getItem(DISMISS_KEY) === '1') } catch { /* storage blocked: just show it */ }
  }, [])

  const scanned = reports.length > 0
  const counts = new Map<string, number>()
  for (const r of reports) {
    const key = (r.agentName ?? r.fileName ?? r.reportId ?? '').toString()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const rescanned = reports.length >= 2 && [...counts.values()].some(n => n >= 2)
  const ciConnected = reports.some(r => r.source === 'cli' || r._source === 'cli')

  const steps: Array<{ done: boolean; title: string; body: string; action: React.ReactNode }> = [
    {
      done: scanned,
      title: 'Scan your first agent',
      body: 'Paste code, drop files or a .zip, link a GitHub repo, or check your MCP config.',
      action: <button onClick={onGoToScan} className="rounded-xl bg-[#06B6D4] px-3 py-1.5 text-xs font-semibold text-[#080B14] hover:opacity-90">Scan now</button>,
    },
    {
      done: rescanned,
      title: 'Fix the top issue and re-scan',
      body: 'Start with the "Fix first" item, then scan the same agent again to confirm it is gone.',
      action: <button onClick={onGoToScan} style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }} className="rounded-xl px-3 py-1.5 text-xs font-semibold hover:opacity-80">Re-scan</button>,
    },
    {
      done: ciConnected,
      title: 'Add Agent Verify to CI',
      body: 'Run the CLI in a GitHub Action so risky changes fail before they merge.',
      action: <Link href="/developers" style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }} className="rounded-xl px-3 py-1.5 text-xs font-semibold hover:opacity-80">Set up CI</Link>,
    },
  ]
  const doneCount = steps.filter(s => s.done).length
  if (variant === 'card' && (dismissed || doneCount === steps.length)) return null

  const dismiss = () => {
    setDismissed(true)
    try { window.localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
  }

  return (
    <section style={variant === 'card' ? { backgroundColor: 'var(--card)', border: '1px solid var(--border)' } : undefined} className={variant === 'card' ? 'av-animate-rise rounded-3xl p-5' : 'mx-auto mt-5 max-w-lg'} aria-label="Getting started">
      {variant === 'card' && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-purple-text)]">Getting started · {doneCount} of {steps.length} done</p>
            <div className="mt-2 h-1.5 w-40 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--border)' }}>
              <div className="h-full rounded-full bg-[#06B6D4] transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
            </div>
          </div>
          <button onClick={dismiss} style={{ color: 'var(--text-muted)' }} className="text-xs underline-offset-2 hover:underline">Hide</button>
        </div>
      )}
      <ol className="space-y-2">
        {steps.map((step, i) => (
          <li key={step.title} style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${step.done ? 'bg-[#10B981] text-white' : 'bg-[var(--card)] text-[var(--text-muted)]'}`}
              style={step.done ? undefined : { border: '1px solid var(--border)' }}
              aria-label={step.done ? 'Done' : `Step ${i + 1}`}
            >
              {step.done ? '✓' : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p style={{ color: 'var(--text-primary)' }} className={`text-sm font-semibold ${step.done ? 'line-through opacity-60' : ''}`}>{step.title}</p>
              {!step.done && <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-xs leading-5">{step.body}</p>}
            </div>
            {!step.done && <div className="shrink-0">{step.action}</div>}
          </li>
        ))}
      </ol>
    </section>
  )
}
