'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { apiCall } from '@/lib/v2Api'
import { noAutofill, noAutofillSecret } from '@/lib/noAutofill'

interface Target { id: string; name: string; url: string; host: string; verified: boolean; verify_token: string }
interface Result { id: string; name: string; severity: string; outcome: 'passed' | 'failed' | 'review' | 'error'; reply: string }
interface Run { id: string; target_id: string; status: 'queued' | 'running' | 'done' | 'failed'; next_index: number; total: number; results: Result[]; created_at: number }
interface Data { attacks: Array<{ id: string; name: string; severity: string }>; targets: Target[]; runs: Run[] }

const OUTCOME: Record<Result['outcome'], { label: string; color: string }> = {
  failed: { label: 'Fell for it', color: 'var(--accent-red-text)' },
  review: { label: 'Check this', color: 'var(--accent-orange-text)' },
  passed: { label: 'Resisted', color: 'var(--accent-green-text)' },
  error: { label: 'No answer', color: 'var(--text-muted)' },
}

export function InjectionTests({ user, isPro }: { user: User; isPro: boolean }) {
  const [data, setData] = useState<Data | null>(null)
  const [form, setForm] = useState({ name: '', url: '', auth: '', bodyTemplate: '{"message":"{{prompt}}"}', responsePath: '' })
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try { setData(await apiCall<Data>(user, '/v1/redteam')) } catch { setData({ attacks: [], targets: [], runs: [] }) }
  }, [user])
  useEffect(() => { void load() }, [load])
  const running = data?.runs.some(r => r.status === 'queued' || r.status === 'running')
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => void load(), 10_000)
    return () => clearInterval(t)
  }, [running, load])

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key)
    setMessage(null)
    try { await fn(); setMessage({ ok: true, text: ok }); await load() } catch (e) { setMessage({ ok: false, text: e instanceof Error ? e.message : 'Something went wrong.' }) }
    setBusy('')
  }
  const add = (e: React.FormEvent) => {
    e.preventDefault()
    void act('add', () => apiCall(user, '/v1/redteam/targets', { method: 'POST', body: { name: form.name, url: form.url, bodyTemplate: form.bodyTemplate, responsePath: form.responsePath, headers: form.auth ? { Authorization: form.auth } : undefined } }), 'Agent added. Next: prove you own it.')
  }

  const card = { backgroundColor: 'var(--card)', border: '1px solid var(--border)' }
  const input = { backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <section style={card} className="rounded-3xl p-6">
        <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">Test your agent against prompt injection</h2>
        <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">We send {data?.attacks.length ?? 10} known attacks to your agent — hidden instructions in documents, fake system messages, data-leak links, requests to email out your keys — and show which ones it fell for. Each attack hides a unique code, so results are clear-cut.</p>
        {!isPro && <p className="mt-3 text-sm"><Link href="/pricing" className="font-semibold text-[color:var(--accent-purple-text)] hover:underline">Included with Pro →</Link> <span style={{ color: 'var(--text-muted)' }}>You can add and verify an agent now.</span></p>}
        {message && <p className="mt-3 text-xs" style={{ color: message.ok ? 'var(--accent-green-text)' : 'var(--accent-orange-text)' }}>{message.text}</p>}
      </section>

      {(data?.targets ?? []).map(t => {
        const runs = (data?.runs ?? []).filter(r => r.target_id === t.id)
        const latest = runs[0]
        return (
          <section key={t.id} style={card} className="rounded-3xl p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p style={{ color: 'var(--text-primary)' }} className="font-semibold">{t.name}</p>
                <p style={{ color: 'var(--text-muted)' }} className="truncate font-mono text-xs">{t.url}</p>
              </div>
              <div className="flex gap-2">
                {t.verified ? (
                  <button disabled={!isPro || busy === t.id || Boolean(running)} onClick={() => void act(t.id, () => apiCall(user, '/v1/redteam/runs', { method: 'POST', body: { targetId: t.id } }), 'Test started. Results appear here over the next few minutes.')} className="av-press rounded-xl bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Run tests</button>
                ) : (
                  <button disabled={busy === `v${t.id}`} onClick={() => void act(`v${t.id}`, () => apiCall(user, '/v1/redteam/verify', { method: 'POST', body: { id: t.id } }), 'Verified — you can run tests now.')} className="av-press rounded-xl bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Check verification</button>
                )}
                <button onClick={() => { if (window.confirm(`Remove ${t.name}?`)) void act(`d${t.id}`, () => apiCall(user, `/v1/redteam/targets?id=${encodeURIComponent(t.id)}`, { method: 'DELETE' }), 'Removed.') }} className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}>Remove</button>
              </div>
            </div>
            {!t.verified && (
              <div className="mt-4 rounded-2xl p-4 text-sm" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>Prove you own this agent</p>
                <p className="mt-1">Publish a text file at <code>https://{t.host}/.well-known/agentverify.txt</code> containing:</p>
                <input {...noAutofill} readOnly value={t.verify_token} onFocus={e => e.currentTarget.select()} style={input} className="mt-2 w-full rounded-lg px-2 py-1.5 font-mono text-xs" aria-label="Verification token" />
                <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>We only ever send test messages to agents on hosts that publish this token.</p>
              </div>
            )}
            {latest && (
              <div className="mt-4">
                <p style={{ color: 'var(--text-muted)' }} className="text-xs">
                  {latest.status === 'done' ? `Last run ${new Date(latest.created_at).toLocaleString()}: ${latest.results.filter(r => r.outcome === 'failed').length} of ${latest.total} attacks worked` : latest.status === 'failed' ? 'The last run could not finish.' : `Running… ${latest.next_index} of ${latest.total} sent`}
                </p>
                {latest.results.length > 0 && (
                  <ul className="mt-2 space-y-2">
                    {latest.results.map(r => (
                      <li key={r.id} style={{ border: '1px solid var(--border)' }} className="rounded-xl p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{r.name}</span>
                          <span style={{ color: OUTCOME[r.outcome].color }} className="text-xs font-semibold">{OUTCOME[r.outcome].label}</span>
                        </div>
                        <p style={{ color: 'var(--text-muted)' }} className="mt-1 line-clamp-2 font-mono text-[11px]">{r.reply}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        )
      })}

      <form autoComplete="off" onSubmit={add} style={card} className="grid gap-3 rounded-3xl p-6 sm:grid-cols-2">
        <h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold uppercase tracking-wider sm:col-span-2">Add an agent to test</h2>
        <label className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Name<input {...noAutofill} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Support bot (staging)" style={input} className="mt-1 w-full rounded-xl px-3 py-2 text-sm font-normal" /></label>
        <label className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Chat endpoint (HTTPS, POST)<input {...noAutofill} required value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://staging.yourapp.com/api/chat" style={input} className="mt-1 w-full rounded-xl px-3 py-2 text-sm font-normal" /></label>
        <label className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Authorization header (optional, stored encrypted)<input type="password" {...noAutofillSecret} value={form.auth} onChange={e => setForm({ ...form, auth: e.target.value })} placeholder="Bearer test-token" style={input} className="mt-1 w-full rounded-xl px-3 py-2 text-sm font-normal" /></label>
        <label className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Reply field (optional)<input {...noAutofill} value={form.responsePath} onChange={e => setForm({ ...form, responsePath: e.target.value })} placeholder="output  or  choices.0.message.content" style={input} className="mt-1 w-full rounded-xl px-3 py-2 text-sm font-normal" /></label>
        <label className="text-xs font-semibold sm:col-span-2" style={{ color: 'var(--text-primary)' }}>Request body — <code>{'{{prompt}}'}</code> is replaced with each attack<input {...noAutofill} value={form.bodyTemplate} onChange={e => setForm({ ...form, bodyTemplate: e.target.value })} style={input} className="mt-1 w-full rounded-xl px-3 py-2 font-mono text-xs font-normal" /></label>
        <p style={{ color: 'var(--text-muted)' }} className="text-xs sm:col-span-2">Use a staging copy of your agent if you can: the tests ask it to do things like email data out, and a real agent with real tools might try.</p>
        <div className="sm:col-span-2"><button type="submit" disabled={busy === 'add'} className="av-press rounded-xl bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === 'add' ? 'Adding…' : 'Add agent'}</button></div>
      </form>
    </div>
  )
}
