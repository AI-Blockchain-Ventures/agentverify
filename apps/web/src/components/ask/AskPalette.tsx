'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/components/auth/AuthProvider'
import { getApiBaseUrl } from '@/lib/billing'
import { assetUrl } from '@/lib/assets'
import { getReports } from '@/lib/scanStore'
import type { DashboardTab, StoredReport } from '@/types'
import { ASK_EVENT } from './askEvents'
import { STATIC_ENTRIES, looksLikeQuestion, scoreEntry, termWeights, tokenize, type AskEntry } from './askIndex'

export const DASHBOARD_TAB_EVENT = 'av:dashboard-tab'

interface McpIndexItem { n: string; s: string; r: string; d: string; c: string[]; f: number; w: number }
interface CheckIndexItem { s: string; n: string; i: string; v: string; d: string; r: string }

type AiState = { status: 'idle' } | { status: 'loading'; question: string } | { status: 'done'; question: string; answer: string; sources: Array<{ title: string; url?: string }>; remaining?: number } | { status: 'fallback'; question: string; message: string }

const KIND_LABEL: Record<AskEntry['kind'], string> = { answer: 'Answers', finding: 'Your findings', action: 'Go to', mcp: 'MCP servers', check: 'Security checks', page: 'Pages', doc: 'Docs' }
const KIND_ORDER: AskEntry['kind'][] = ['answer', 'finding', 'action', 'check', 'mcp', 'page', 'doc']
const KIND_ICON: Record<AskEntry['kind'], string> = { answer: '?', finding: '!', action: '→', mcp: '▤', check: '✓', page: '◧', doc: '§' }

function findingEntries(reports: StoredReport[]): AskEntry[] {
  const seen = new Set<string>()
  const out: AskEntry[] = []
  for (const r of reports.slice(0, 30)) {
    const agent = (r.agentName || r.fileName || 'your agent').toString()
    if (seen.has(agent)) continue // latest report per agent only
    seen.add(agent)
    const findings = Array.isArray(r.findings) ? r.findings : []
    for (const f of findings.slice(0, 25)) {
      if (!f || typeof f !== 'object') continue
      const rec = f as unknown as Record<string, unknown>
      const title = typeof rec.title === 'string' ? rec.title : ''
      if (!title) continue
      const severity = typeof rec.severity === 'string' ? rec.severity : ''
      const description = typeof rec.description === 'string' ? rec.description : ''
      out.push({
        id: `f-${r.reportId}-${out.length}`,
        kind: 'finding',
        title: `${title} — ${agent}`,
        text: `${severity ? `${severity} risk in ${agent}. ` : ''}${description}`.slice(0, 600),
        url: `/report?id=${encodeURIComponent(r.reportId)}`,
        keywords: `${agent} ${severity} ${r.verdict ?? ''} fail failed`,
      })
    }
  }
  return out
}

export function AskPalette() {
  const { user } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [mcp, setMcp] = useState<McpIndexItem[] | null>(null)
  const [checks, setChecks] = useState<CheckIndexItem[]>([])
  const [findings, setFindings] = useState<AskEntry[]>([])
  const [ai, setAi] = useState<AiState>({ status: 'idle' })
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)

  const show = useCallback((q?: string) => {
    restoreFocus.current = document.activeElement as HTMLElement | null
    setQuery(q ?? '')
    setSelected(0)
    setAi({ status: 'idle' })
    setOpen(true)
  }, [])
  const close = useCallback(() => {
    setOpen(false)
    restoreFocus.current?.focus?.()
  }, [])

  useEffect(() => {
    const onOpen = (e: Event) => show((e as CustomEvent<string>).detail)
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); show() }
    }
    window.addEventListener(ASK_EVENT, onOpen)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener(ASK_EVENT, onOpen); window.removeEventListener('keydown', onKey) }
  }, [show])

  // Load the MCP directory index and the user's own findings the first time Ask opens.
  useEffect(() => {
    if (!open) return
    window.setTimeout(() => inputRef.current?.focus(), 10)
    if (mcp === null) {
      fetch(assetUrl('/ask-index.json')).then(r => r.json()).then((d: { servers?: McpIndexItem[]; checks?: CheckIndexItem[] }) => { setMcp(d.servers ?? []); setChecks(d.checks ?? []) }).catch(() => setMcp([]))
    }
    if (user) getReports(user.uid).then(r => setFindings(findingEntries(r))).catch(() => setFindings([]))
  }, [open, user, mcp])

  const mcpEntries = useMemo<AskEntry[]>(() => (mcp ?? []).map(s => ({
    id: `m-${s.s}`, kind: 'mcp', title: s.n, url: `/mcp/${s.s}/`,
    text: `${s.r}. ${s.d} Can: ${s.c.join(', ') || 'no risky capabilities found'}. ${s.f} code pattern${s.f === 1 ? '' : 's'} worth reviewing. ${s.w.toLocaleString('en-US')} weekly downloads.`,
    keywords: `mcp server ${s.s.replace(/-/g, ' ')}`,
  })), [mcp])

  const checkEntries = useMemo<AskEntry[]>(() => checks.map(c => ({
    id: `c-${c.s}`, kind: 'check', title: c.n, url: `/checks/${c.s}/`,
    text: `${c.d} How to fix: ${c.r}`,
    keywords: `${c.i} ${c.v} check finding fix`,
  })), [checks])

  const results = useMemo(() => {
    const raw = query.trim()
    const pool = [...STATIC_ENTRIES.filter(e => !e.signedInOnly || user), ...findings, ...checkEntries, ...mcpEntries]
    if (!raw) {
      // Helpful defaults before typing.
      const defaults = user ? ['t-scan', 't-reports', 't-github', 'a-vscode', 'a-mcp-safe', 'a-pricing'] : ['a-first-scan', 'a-mcp-safe', 'a-pricing', 'a-ci', 'a-data', 'p-demo']
      return defaults.map(id => pool.find(e => e.id === id)).filter(Boolean) as AskEntry[]
    }
    const terms = tokenize(raw)
    const weights = termWeights(pool, terms)
    return pool
      .map(e => ({ e, s: scoreEntry(e, terms, raw, weights) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map(x => x.e)
  }, [query, user, findings, checkEntries, mcpEntries])

  const grouped = useMemo(() => {
    const map = new Map<AskEntry['kind'], AskEntry[]>()
    for (const r of results) map.set(r.kind, [...(map.get(r.kind) ?? []), r])
    return KIND_ORDER.filter(k => map.has(k)).map(k => ({ kind: k, items: map.get(k)! }))
  }, [results])
  const flat = useMemo(() => grouped.flatMap(g => g.items), [grouped])
  const showAskRow = query.trim().length >= 3
  const rowCount = flat.length + (showAskRow ? 1 : 0)

  useEffect(() => { setSelected(0) }, [query])

  const go = (entry: AskEntry) => {
    close()
    if (entry.tab) {
      if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) window.dispatchEvent(new CustomEvent(DASHBOARD_TAB_EVENT, { detail: entry.tab as DashboardTab }))
      else router.push(`/dashboard?tab=${entry.tab}`)
      return
    }
    if (entry.url) router.push(entry.url)
  }

  const askAi = async () => {
    const question = query.trim()
    if (question.length < 3) return
    setAi({ status: 'loading', question })
    const context = results.slice(0, 8).map(r => ({ title: r.title, text: r.text, url: r.url && r.url.startsWith('/') ? r.url : undefined }))
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`
      const res = await fetch(`${getApiBaseUrl()}/v1/ask`, { method: 'POST', headers, body: JSON.stringify({ question, context }) })
      const data = await res.json().catch(() => ({})) as { answer?: string; error?: string; fallback?: boolean; sources?: Array<{ title: string; url?: string }>; remaining?: number }
      if (res.ok && data.answer) setAi({ status: 'done', question, answer: data.answer, sources: data.sources ?? [], remaining: data.remaining })
      // Only show the server's own wording when it is one of Ask's friendly fallback messages.
      else setAi({ status: 'fallback', question, message: data.fallback && data.error ? data.error : 'AI answers are unavailable right now — here is what search found.' })
    } catch {
      setAi({ status: 'fallback', question, message: 'AI answers are unavailable right now — here is what search found.' })
    }
  }

  const activate = (index: number) => {
    if (showAskRow && index === 0) { void askAi(); return }
    const entry = flat[index - (showAskRow ? 1 : 0)]
    if (entry) go(entry)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, Math.max(rowCount - 1, 0))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      // A question goes to AI first; a short search opens the best match.
      if (selected === 0 && showAskRow && !looksLikeQuestion(query) && flat.length > 0) activate(1)
      else activate(selected)
    }
  }

  // Keep the highlighted row in view.
  useEffect(() => {
    if (!open) return
    document.getElementById(`av-ask-row-${selected}`)?.scrollIntoView({ block: 'nearest' })
  }, [selected, open])

  if (!open) return null

  const rowStyle = (i: number) => ({ backgroundColor: selected === i ? 'var(--surface)' : 'transparent' })
  let rowIndex = showAskRow ? 1 : 0

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[10vh]" style={{ backgroundColor: 'rgba(16,24,40,0.5)' }} onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
      <div role="dialog" aria-modal="true" aria-label="Ask Agent Verify" className="av-animate-scale flex max-h-[78vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl shadow-2xl" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border-light)' }}>
        <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2" aria-hidden="true"><path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z" /></svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={user ? 'Ask anything, or search your findings, repos and docs…' : 'Ask anything — e.g. “is the filesystem MCP server safe?”'}
            aria-label="Ask or search"
            aria-controls="av-ask-results"
            aria-activedescendant={rowCount ? `av-ask-row-${selected}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
            style={{ color: 'var(--text-primary)' }}
          />
          <button onClick={close} className="av-kbd" aria-label="Close">Esc</button>
        </div>

        <div id="av-ask-results" role="listbox" aria-label="Results" className="overflow-y-auto py-2">
          {ai.status !== 'idle' && (
            <div className="mx-4 mb-2 rounded-lg p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} aria-live="polite">
              <p className="flex items-center gap-2 text-xs font-semibold text-[color:var(--accent-purple-text)]">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z" /></svg>
                {ai.status === 'loading' ? 'Thinking…' : ai.status === 'done' ? 'Answer' : 'Search results'}
              </p>
              {ai.status === 'loading' && <div className="mt-3 h-3 w-2/3 animate-pulse rounded" style={{ backgroundColor: 'var(--border)' }} />}
              {ai.status === 'done' && (
                <>
                  <p className="mt-2 whitespace-pre-line text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{ai.answer}</p>
                  {ai.sources.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {ai.sources.map(s => (
                        <button key={s.url} onClick={() => go({ id: s.url!, kind: 'page', title: s.title, text: '', url: s.url })} className="rounded px-2 py-0.5 text-[11px]" style={{ border: '1px solid var(--border)', backgroundColor: 'var(--card)', color: 'var(--text-secondary)' }}>{s.title} →</button>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>AI answer from Agent Verify&apos;s pages{user ? ' and your scans' : ''}. Check important details.{typeof ai.remaining === 'number' ? ` ${ai.remaining} left today.` : ''}</p>
                </>
              )}
              {ai.status === 'fallback' && <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>{ai.message}</p>}
            </div>
          )}

          {showAskRow && (
            <button id="av-ask-row-0" role="option" aria-selected={selected === 0} onMouseEnter={() => setSelected(0)} onClick={() => activate(0)} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm" style={rowStyle(0)}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#7C3AED] text-xs text-white" aria-hidden="true">✦</span>
              <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--text-primary)' }}>Ask AI: <span className="font-semibold">{query.trim()}</span></span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{looksLikeQuestion(query) ? 'Enter' : ''}</span>
            </button>
          )}

          {grouped.map(group => (
            <div key={group.kind} className="pt-2">
              <p className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{KIND_LABEL[group.kind]}</p>
              {group.items.map(entry => {
                const i = rowIndex++
                return (
                  <button key={entry.id} id={`av-ask-row-${i}`} role="option" aria-selected={selected === i} onMouseEnter={() => setSelected(i)} onClick={() => activate(i)} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm" style={rowStyle(i)}>
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs" style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }} aria-hidden="true">{KIND_ICON[entry.kind]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate" style={{ color: 'var(--text-primary)' }}>{entry.title}</span>
                      {(entry.kind === 'answer' || entry.kind === 'mcp' || entry.kind === 'finding') && selected === i && (
                        <span className="mt-0.5 block text-xs leading-5" style={{ color: 'var(--text-muted)' }}>{entry.text}</span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}

          {query.trim() && flat.length === 0 && (
            <p className="px-4 py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No matches. {showAskRow ? 'Press Enter to ask AI.' : ''}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 px-4 py-2 text-[11px]" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          <span><span className="av-kbd">↑</span> <span className="av-kbd">↓</span> move</span>
          <span><span className="av-kbd">Enter</span> open</span>
          <span className="ml-auto hidden sm:inline">Search is instant · AI answers are free and limited per day</span>
        </div>
      </div>
    </div>
  )
}
