'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { apiCall } from '@/lib/v2Api'
import { CodeBlock } from '@/components/developers/CodeBlock'
import { CompanyRules } from './CompanyRules'
import { GuardApprovals } from './GuardApprovals'

interface GuardEvent { person?: string; agent: string; tool: string; decision: 'allowed' | 'blocked' | 'approved' | 'rejected' | 'asked'; reason: string; argsPreview: string; durationMs: number | null; at: string }
interface Person { id: string; label: string; today: { total: number; blocked: number; asked: number }; lastAt: string | null }
interface GuardData { events: GuardEvent[]; last7Days: Record<GuardEvent['decision'], number>; agents: Array<{ agent: string; n: number; last: number }>; scope?: 'own' | 'team'; visibleToOwner?: boolean; people?: Person[] }

const LIVE_EVERY_MS = 5000
const eventKey = (e: GuardEvent) => `${e.at}|${e.agent}|${e.tool}|${e.argsPreview}`

function ago(iso: string | null, now: number): string {
  if (!iso) return 'no activity today'
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  return `${Math.round(s / 3600)} h ago`
}

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
  asked: { label: 'Asked a person', color: 'var(--accent-purple-text)' },
}

export function AgentGuard({ user }: { user: User }) {
  const [data, setData] = useState<GuardData | null>(null)
  const [filter, setFilter] = useState<'' | GuardEvent['decision']>('')
  const [agent, setAgent] = useState('')
  const [person, setPerson] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(true)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const seen = useRef<Set<string> | null>(null)

  const load = useCallback(async () => {
    const q = new URLSearchParams()
    if (filter) q.set('decision', filter)
    if (agent) q.set('agent', agent)
    if (person) q.set('person', person)
    try {
      const next = await apiCall<GuardData>(user, `/v1/guard/events${q.toString() ? `?${q}` : ''}`)
      // Rows that arrived since the last check get highlighted for a moment.
      const keys = next.events.map(eventKey)
      if (seen.current) {
        const added = keys.filter(k => !seen.current!.has(k))
        if (added.length) setFresh(new Set(added))
      }
      seen.current = new Set(keys)
      setData(next)
      setUpdatedAt(Date.now())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load Agent Guard activity')
      setData(d => d ?? { events: [], last7Days: { allowed: 0, approved: 0, blocked: 0, rejected: 0, asked: 0 }, agents: [] })
    }
  }, [user, filter, agent, person])

  // Changing a filter starts a fresh list (nothing is "new" yet).
  useEffect(() => { seen.current = null; setFresh(new Set()); void load() }, [load])

  // Live: check every few seconds while this tab is visible.
  useEffect(() => {
    if (!live) return
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void load() }, LIVE_EVERY_MS)
    return () => clearInterval(poll)
  }, [live, load])

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    if (!fresh.size) return
    const t = setTimeout(() => setFresh(new Set()), 3000)
    return () => clearTimeout(t)
  }, [fresh])

  const team = data?.scope === 'team'

  const card = { backgroundColor: 'var(--card)', border: '1px solid var(--border)' }
  const empty = data && data.events.length === 0 && !filter && !agent && !person

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <GuardApprovals user={user} />
      {error && <p className="text-xs" style={{ color: 'var(--accent-orange-text)' }}>{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setLive(v => !v)} aria-pressed={live} className="flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" style={{ border: '1px solid var(--border)', color: live ? 'var(--accent-green-text)' : 'var(--text-muted)' }}>
          <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${live ? 'animate-pulse' : ''}`} style={{ backgroundColor: live ? '#16A34A' : 'var(--text-muted)' }} />
          {live ? 'Live' : 'Paused'}
        </button>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{updatedAt ? `Updated ${ago(new Date(updatedAt).toISOString(), now)}` : 'Loading…'}{live ? ` · checks every ${LIVE_EVERY_MS / 1000}s` : ''}</p>
      </div>
      {data?.visibleToOwner && <p className="rounded-xl px-3 py-2 text-xs" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>You&apos;re on a Team plan, so your Team owner can see your AI agents&apos; activity here too (commands are shown with secrets masked).</p>}
      {team && (data?.people?.length ?? 0) > 0 && (
        <section style={card} className="rounded-2xl p-4" aria-label="Your team today">
          <h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold uppercase tracking-wider">Your team today</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data!.people!.map(p => (
              <li key={p.id}>
                <button type="button" onClick={() => setPerson(person === p.id ? '' : p.id)} aria-pressed={person === p.id} className="w-full rounded-xl p-3 text-left" style={{ backgroundColor: 'var(--input-bg)', border: person === p.id ? '2px solid #7C3AED' : '1px solid var(--border)' }}>
                  <p className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{p.label}</p>
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {p.today.total} {p.today.total === 1 ? 'action' : 'actions'} · <span style={{ color: p.today.blocked ? 'var(--accent-red-text)' : undefined }}>{p.today.blocked} blocked</span> · <span style={{ color: p.today.asked ? 'var(--accent-purple-text)' : undefined }}>{p.today.asked} needed a person</span>
                  </p>
                  <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>Last active {ago(p.lastAt, now)}</p>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(['blocked', 'asked', 'rejected', 'approved', 'allowed'] as const).map(d => (
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
          <h3 style={{ color: 'var(--text-primary)' }} className="mt-6 text-base font-semibold">Guard your team&apos;s AI coding agents</h3>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">Using Claude Code or Cursor? One command makes every shell command, file read, file edit and MCP tool call go through Agent Verify first. It blocks reading .env files and keys, sending secrets out, deleting whole folders and force-pushing to main, and asks before installs and deploys. Set AGENTVERIFY_API_KEY to see every action here.</p>
          <div className="mt-4"><CodeBlock code={'npx agentverify protect'} label="Run in your project folder" /></div>
        </section>
      ) : (
        <section style={card} className="rounded-3xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold uppercase tracking-wider">{person && team ? `Activity: ${data?.people?.find(p => p.id === person)?.label ?? 'one person'}` : 'Recent decisions'}</h2>
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
                <tr><th className="py-2 pr-3 font-medium">When</th>{team && <th className="py-2 pr-3 font-medium">Who</th>}<th className="py-2 pr-3 font-medium">Agent</th><th className="py-2 pr-3 font-medium">Tool</th><th className="py-2 pr-3 font-medium">Decision</th><th className="py-2 pr-3 font-medium">Why</th><th className="py-2 font-medium">Arguments (masked)</th></tr>
              </thead>
              <tbody>
                {(data?.events ?? []).map((e, i) => (
                  <tr key={`${e.at}-${i}`} style={{ borderTop: '1px solid var(--border)', backgroundColor: fresh.has(eventKey(e)) ? 'rgba(124, 58, 237, 0.14)' : undefined, transition: 'background-color 0.8s' }}>
                    <td className="whitespace-nowrap py-2 pr-3" style={{ color: 'var(--text-muted)' }}>{new Date(e.at).toLocaleString()}</td>
                    {team && <td className="py-2 pr-3" style={{ color: 'var(--text-secondary)' }}>{e.person ?? '—'}</td>}
                    <td className="py-2 pr-3" style={{ color: 'var(--text-secondary)' }}>{e.agent}</td>
                    <td className="py-2 pr-3 font-mono" style={{ color: 'var(--text-primary)' }}>{e.tool}</td>
                    <td className="py-2 pr-3 font-semibold" style={{ color: DECISION_STYLE[e.decision]?.color }}>{DECISION_STYLE[e.decision]?.label ?? e.decision}</td>
                    <td className="py-2 pr-3" style={{ color: 'var(--text-secondary)' }}>{e.reason}</td>
                    <td className="max-w-[260px] truncate py-2 font-mono" style={{ color: 'var(--text-muted)' }} title={e.argsPreview}>{e.argsPreview}</td>
                  </tr>
                ))}
                {data && data.events.length === 0 && <tr><td colSpan={team ? 7 : 6} className="py-4 text-center" style={{ color: 'var(--text-muted)' }}>Nothing matches this filter in the last 30 days.</td></tr>}
              </tbody>
            </table>
          </div>
          <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-[11px]">Kept for 30 days. Arguments are masked by the library before they leave your server, and again here.</p>
        </section>
      )}
      <CompanyRules user={user} />
    </div>
  )
}
