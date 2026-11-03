'use client'

import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { apiCall } from '@/lib/v2Api'
import { CodeBlock } from '@/components/developers/CodeBlock'

interface GuardEvent { agent: string; tool: string; decision: 'allowed' | 'blocked' | 'approved' | 'rejected'; reason: string; argsPreview: string; durationMs: number | null; at: string }
interface GuardData { events: GuardEvent[]; last7Days: Record<GuardEvent['decision'], number>; agents: Array<{ agent: string; n: number; last: number }> }

const SETUP = `npm install agentverify

import { createGuard } from 'agentverify/guard'

const guard = createGuard({
  agent: 'support-bot',
  apiKey: process.env.AGENTVERIFY_API_KEY,   // shows every decision here
  policy: {
    allow: ['lookup_order', 'send_email', 'refund'],
    requireApproval: ['refund'],
    args: { send_email: { to: { allowDomains: ['yourcompany.com'] } } },
    rateLimit: { perMinute: 30 },
  },
  approve: async call => askATeammate(call),  // Slack, email, or a CLI prompt
})

const tools = guard.wrapAll({ lookup_order, send_email, refund })`

const DECISION_STYLE: Record<GuardEvent['decision'], { label: string; color: string }> = {
  allowed: { label: 'Allowed', color: 'var(--text-muted)' },
  approved: { label: 'Approved', color: 'var(--accent-green-text)' },
  blocked: { label: 'Blocked', color: 'var(--accent-red-text)' },
  rejected: { label: 'Rejected by a person', color: 'var(--accent-orange-text)' },
}

export function AgentGuard({ user }: { user: User }) {
  const [data, setData] = useState<GuardData | null>(null)
  const [filter, setFilter] = useState<'' | GuardEvent['decision']>('')
  const [agent, setAgent] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const q = new URLSearchParams()
    if (filter) q.set('decision', filter)
    if (agent) q.set('agent', agent)
    try {
      setData(await apiCall<GuardData>(user, `/v1/guard/events${q.toString() ? `?${q}` : ''}`))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load Agent Guard activity')
      setData({ events: [], last7Days: { allowed: 0, approved: 0, blocked: 0, rejected: 0 }, agents: [] })
    }
  }, [user, filter, agent])

  useEffect(() => { void load() }, [load])

  const card = { backgroundColor: 'var(--card)', border: '1px solid var(--border)' }
  const empty = data && data.events.length === 0 && !filter && !agent

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {error && <p className="text-xs" style={{ color: 'var(--accent-orange-text)' }}>{error}</p>}
      <div className="grid gap-3 sm:grid-cols-4">
        {(['blocked', 'rejected', 'approved', 'allowed'] as const).map(d => (
          <button key={d} onClick={() => setFilter(filter === d ? '' : d)} aria-pressed={filter === d} style={{ ...card, outline: filter === d ? '2px solid #7C3AED' : undefined }} className="rounded-2xl p-4 text-left">
            <p className="text-2xl font-semibold tabular-nums" style={{ color: DECISION_STYLE[d].color }}>{data?.last7Days[d] ?? '—'}</p>
            <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">{DECISION_STYLE[d].label} · last 7 days</p>
          </button>
        ))}
      </div>

      {empty ? (
        <section style={card} className="rounded-3xl p-6">
          <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">Protect your agent while it runs</h2>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">Scanning catches risks before deploy. Agent Guard stops them at runtime: tools you didn&apos;t allow are blocked, risky ones wait for a human, emails and links can only go where you allow, and anything carrying an API key out is stopped. Every decision shows up here.</p>
          <div className="mt-4"><CodeBlock code={SETUP} label="Add Agent Guard to your agent" /></div>
          <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">Works with any JavaScript or TypeScript agent: LangChain.js, the OpenAI Agents SDK, the Claude Agent SDK, or your own tool functions.</p>
        </section>
      ) : (
        <section style={card} className="rounded-3xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold uppercase tracking-wider">Recent decisions</h2>
            <label className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Agent{' '}
              <select value={agent} onChange={e => setAgent(e.target.value)} style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }} className="ml-1 rounded-lg px-2 py-1 text-xs">
                <option value="">All agents</option>
                {(data?.agents ?? []).map(a => <option key={a.agent} value={a.agent}>{a.agent} ({a.n})</option>)}
              </select>
            </label>
          </div>
          <div className="mt-3 overflow-x-auto" role="region" aria-label="Agent Guard decisions" tabIndex={0}>
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead style={{ color: 'var(--text-muted)' }} className="uppercase tracking-wider">
                <tr><th className="py-2 pr-3 font-medium">When</th><th className="py-2 pr-3 font-medium">Agent</th><th className="py-2 pr-3 font-medium">Tool</th><th className="py-2 pr-3 font-medium">Decision</th><th className="py-2 pr-3 font-medium">Why</th><th className="py-2 font-medium">Arguments (masked)</th></tr>
              </thead>
              <tbody>
                {(data?.events ?? []).map((e, i) => (
                  <tr key={`${e.at}-${i}`} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="whitespace-nowrap py-2 pr-3" style={{ color: 'var(--text-muted)' }}>{new Date(e.at).toLocaleString()}</td>
                    <td className="py-2 pr-3" style={{ color: 'var(--text-secondary)' }}>{e.agent}</td>
                    <td className="py-2 pr-3 font-mono" style={{ color: 'var(--text-primary)' }}>{e.tool}</td>
                    <td className="py-2 pr-3 font-semibold" style={{ color: DECISION_STYLE[e.decision]?.color }}>{DECISION_STYLE[e.decision]?.label ?? e.decision}</td>
                    <td className="py-2 pr-3" style={{ color: 'var(--text-secondary)' }}>{e.reason}</td>
                    <td className="max-w-[260px] truncate py-2 font-mono" style={{ color: 'var(--text-muted)' }} title={e.argsPreview}>{e.argsPreview}</td>
                  </tr>
                ))}
                {data && data.events.length === 0 && <tr><td colSpan={6} className="py-4 text-center" style={{ color: 'var(--text-muted)' }}>Nothing matches this filter in the last 30 days.</td></tr>}
              </tbody>
            </table>
          </div>
          <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-[11px]">Kept for 30 days. Arguments are masked by the library before they leave your server, and again here.</p>
        </section>
      )}
    </div>
  )
}
