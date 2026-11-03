'use client'

import { useCallback, useEffect, useState } from 'react'
import { getApiBaseUrl } from '@/lib/billing'

type State = { status: 'checking' } | { status: 'up'; ms: number } | { status: 'down'; detail: string }

async function probe(url: string, accept: (data: unknown) => boolean): Promise<State> {
  const started = performance.now()
  try {
    const res = await fetch(url, { cache: 'no-store' })
    const data = await res.json().catch(() => null)
    if (res.ok && accept(data)) return { status: 'up', ms: Math.round(performance.now() - started) }
    return { status: 'down', detail: `Responded with ${res.status}` }
  } catch {
    return { status: 'down', detail: 'Could not be reached' }
  }
}

export function StatusBoard() {
  const [api, setApi] = useState<State>({ status: 'checking' })
  const [checks, setChecks] = useState<State>({ status: 'checking' })
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)

  const run = useCallback(async () => {
    setApi({ status: 'checking' })
    setChecks({ status: 'checking' })
    const base = getApiBaseUrl()
    const [a, c] = await Promise.all([
      probe(`${base}/health`, d => (d as { ok?: boolean } | null)?.ok === true),
      probe(`${base}/v1/checks/catalog`, d => Array.isArray((d as { checks?: unknown[] } | null)?.checks)),
    ])
    setApi(a)
    setChecks(c)
    setCheckedAt(new Date())
  }, [])

  useEffect(() => { void run() }, [run])

  const rows: Array<[string, string, State]> = [
    ['Website', 'This page loaded, so the website is up.', { status: 'up', ms: 0 }],
    ['API', 'Scans, reports, billing and PR checks.', api],
    ['Security checks', 'The check catalog the scanner runs.', checks],
  ]
  const allUp = rows.every(([, , s]) => s.status === 'up')
  const anyChecking = rows.some(([, , s]) => s.status === 'checking')

  return (
    <div className="mt-8 space-y-4">
      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="flex items-center gap-3 rounded-xl p-5" aria-live="polite">
        <span className={`h-3 w-3 rounded-full ${anyChecking ? 'animate-pulse bg-[#98A2B3]' : allUp ? 'bg-[#12B76A]' : 'bg-[#F79009]'}`} aria-hidden="true" />
        <p style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">{anyChecking ? 'Checking…' : allUp ? 'All systems operational' : 'Some systems have problems'}</p>
      </div>
      <ul style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="overflow-hidden rounded-xl">
        {rows.map(([name, desc, s], i) => (
          <li key={name} className="flex items-center justify-between gap-4 px-5 py-4" style={i ? { borderTop: '1px solid var(--border)' } : undefined}>
            <div>
              <p style={{ color: 'var(--text-primary)' }} className="font-medium">{name}</p>
              <p style={{ color: 'var(--text-muted)' }} className="text-sm">{desc}</p>
            </div>
            <span className="shrink-0 text-sm font-semibold" style={{ color: s.status === 'up' ? 'var(--accent-green-text)' : s.status === 'down' ? 'var(--accent-orange-text)' : 'var(--text-muted)' }}>
              {s.status === 'up' ? `Operational${s.ms ? ` · ${s.ms} ms` : ''}` : s.status === 'down' ? s.detail : 'Checking…'}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-muted)' }}>
        <span>{checkedAt ? `Last checked ${checkedAt.toLocaleTimeString()}` : ''}</span>
        <button onClick={() => void run()} className="rounded-md px-3 py-1.5 font-medium" style={{ border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>Check again</button>
      </div>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Problem not shown here? Email <a href="mailto:hello@aiblockchainventures.com" className="font-semibold text-[color:var(--accent-purple-text)]">hello@aiblockchainventures.com</a>.</p>
    </div>
  )
}
