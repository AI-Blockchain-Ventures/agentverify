'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { User } from 'firebase/auth'
import { apiCall } from '@/lib/v2Api'
import { getReports } from '@/lib/scanStore'
import { getApiBaseUrl } from '@/lib/billing'
import { copyToClipboard } from '@/lib/clipboard'
import { noAutofill } from '@/lib/noAutofill'
import type { StoredReport } from '@/types'

interface Profile { slug: string; name: string; description: string; website: string; reportId: string | null; redteamTargetId: string | null; guardAgent: string | null; published: boolean; summary: boolean }
interface Linkable { injectionTargets: Array<{ id: string; name: string; host: string; verified: boolean }>; guardAgents: string[] }
interface Data { profiles: Profile[]; linkable: Linkable }

const EMPTY = { slug: '', name: '', description: '', website: '', reportId: '', redteamTargetId: '', guardAgent: '', published: true }
const siteBase = () => (typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname.split('/dashboard')[0]}` : '')

/** Create and manage public, signed profile pages for your agents. Evidence is picked from your account. */
export function AgentProfiles({ user }: { user: User }) {
  const [data, setData] = useState<Data | null>(null)
  const [reports, setReports] = useState<StoredReport[]>([])
  const [form, setForm] = useState(EMPTY)
  const [editing, setEditing] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')

  const load = useCallback(async () => {
    try { setData(await apiCall<Data>(user, '/v1/agent-profiles')) } catch (e) { setMessage({ ok: false, text: e instanceof Error ? e.message : 'Could not load profiles' }) }
  }, [user])
  useEffect(() => { void load() }, [load])
  useEffect(() => { getReports(user.uid).then(r => setReports(r.slice(0, 50))).catch(() => setReports([])) }, [user.uid])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      const body = { ...(form.slug ? { slug: form.slug } : {}), name: form.name, description: form.description, website: form.website, reportId: form.reportId, redteamTargetId: form.redteamTargetId, guardAgent: form.guardAgent, published: form.published }
      const res = await apiCall<{ slug: string }>(user, '/v1/agent-profiles', { method: 'POST', body })
      setMessage({ ok: true, text: form.slug ? 'Saved. The public page updates right away.' : 'Profile created. Share the link or add the badge to your README.' })
      setForm(EMPTY)
      setEditing(false)
      await load()
      if (!form.slug) setCopied(res.slug)
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Could not save' })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (p: Profile) => {
    if (!window.confirm(`Delete the public profile for ${p.name}? The link and badge stop working.`)) return
    try { await apiCall(user, `/v1/agent-profiles?slug=${encodeURIComponent(p.slug)}`, { method: 'DELETE' }); await load() } catch (e) { setMessage({ ok: false, text: e instanceof Error ? e.message : 'Could not delete' }) }
  }

  const copy = async (key: string, text: string) => { if (await copyToClipboard(text)) { setCopied(key); setTimeout(() => setCopied(''), 1500) } }
  const card = { backgroundColor: 'var(--card)', border: '1px solid var(--border)' }
  const input = { backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }
  const muted = { color: 'var(--text-muted)' }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <section style={card} className="rounded-3xl p-6">
        <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">Show customers your agent is safe</h2>
        <p style={muted} className="mt-1 text-sm">A public page for each agent with its latest security scan, prompt-injection test results and Agent Guard protection, signed by Agent Verify so anyone can check it. You only pick the evidence; you can&apos;t type in results. Nothing private is shown: no code, findings, prompts, replies or commands.</p>
        <p style={muted} className="mt-2 text-xs">An agent is shown as <strong style={{ color: 'var(--accent-green-text)' }}>Verified</strong> when its scan is VERIFIED and it resisted every injection test, both within the last 30 days. Turn on weekly re-tests to keep it current.</p>
        {message && <p role="status" className="mt-3 text-xs" style={{ color: message.ok ? 'var(--accent-green-text)' : 'var(--accent-orange-text)' }}>{message.text}</p>}
      </section>

      {(data?.profiles ?? []).map(p => {
        const url = `${siteBase()}/agent/?slug=${p.slug}`
        const badge = `[![Agent Verify](${getApiBaseUrl()}/v1/agents/${p.slug}/badge.svg)](${url})`
        return (
          <section key={p.slug} style={card} className="rounded-3xl p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{p.name} {!p.published && <span className="text-xs font-normal" style={muted}>(unpublished)</span>}</p>
                <p className="text-xs font-semibold" style={{ color: p.summary ? 'var(--accent-green-text)' : 'var(--text-muted)' }}>{p.summary ? '✓ Verified agent' : 'Not verified yet'}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {p.published && <Link href={`/agent/?slug=${p.slug}`} target="_blank" className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }}>View page</Link>}
                <button type="button" onClick={() => copy(`l${p.slug}`, url)} className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }}>{copied === `l${p.slug}` || copied === p.slug ? 'Copied' : 'Copy link'}</button>
                <button type="button" onClick={() => copy(`b${p.slug}`, badge)} className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }}>{copied === `b${p.slug}` ? 'Copied' : 'Copy README badge'}</button>
                <button type="button" onClick={() => { setForm({ slug: p.slug, name: p.name, description: p.description, website: p.website, reportId: p.reportId ?? '', redteamTargetId: p.redteamTargetId ?? '', guardAgent: p.guardAgent ?? '', published: p.published }); setEditing(true) }} className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>Edit</button>
                <button type="button" onClick={() => remove(p)} className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}>Delete</button>
              </div>
            </div>
          </section>
        )
      })}

      {!editing && <button type="button" onClick={() => { setForm(EMPTY); setEditing(true) }} className="av-press rounded-xl bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white">+ New agent profile</button>}

      {editing && (
        <form autoComplete="off" onSubmit={save} style={card} className="grid gap-3 rounded-3xl p-6 sm:grid-cols-2">
          <h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold uppercase tracking-wider sm:col-span-2">{form.slug ? 'Edit profile' : 'New agent profile'}</h2>
          <label className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Agent name<input {...noAutofill} required maxLength={80} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Acme support bot" style={input} className="mt-1 w-full rounded-xl px-3 py-2 text-sm font-normal" /></label>
          <label className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Company website (https)<input {...noAutofill} value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} placeholder="https://acme.com" style={input} className="mt-1 w-full rounded-xl px-3 py-2 text-sm font-normal" /></label>
          <label className="text-xs font-semibold sm:col-span-2" style={{ color: 'var(--text-primary)' }}>Short description<input {...noAutofill} maxLength={300} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Answers order questions and issues refunds up to $100." style={input} className="mt-1 w-full rounded-xl px-3 py-2 text-sm font-normal" /></label>
          <label className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Security scan
            <select value={form.reportId} onChange={e => setForm({ ...form, reportId: e.target.value })} style={input} className="mt-1 w-full rounded-xl px-3 py-2 text-sm font-normal">
              <option value="">None yet</option>
              {reports.map(r => <option key={r.reportId} value={r.reportId}>{r.agentName || r.fileName || r.reportId} · {r.verdict ?? '?'} · {r.riskScore ?? '?'}/100{r.scannedAt ? ` · ${new Date(r.scannedAt).toLocaleDateString()}` : ''}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Injection tests
            <select value={form.redteamTargetId} onChange={e => setForm({ ...form, redteamTargetId: e.target.value })} style={input} className="mt-1 w-full rounded-xl px-3 py-2 text-sm font-normal">
              <option value="">None yet</option>
              {(data?.linkable.injectionTargets ?? []).map(t => <option key={t.id} value={t.id}>{t.name} ({t.host}){t.verified ? '' : ' · not verified'}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Agent Guard (runtime protection)
            <select value={form.guardAgent} onChange={e => setForm({ ...form, guardAgent: e.target.value })} style={input} className="mt-1 w-full rounded-xl px-3 py-2 text-sm font-normal">
              <option value="">None yet</option>
              {(data?.linkable.guardAgents ?? []).map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="mt-5 flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}><input type="checkbox" checked={form.published} onChange={e => setForm({ ...form, published: e.target.checked })} /> Public (anyone with the link can see it)</label>
          <p className="text-xs sm:col-span-2" style={muted}>The website shows as &quot;owner verified&quot; when an injection-test agent on that domain is verified. Only counts from Agent Guard are published, never what the agent did.</p>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" disabled={busy} className="av-press rounded-xl bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : form.slug ? 'Save' : 'Create profile'}</button>
            <button type="button" onClick={() => { setEditing(false); setForm(EMPTY) }} className="rounded-xl px-4 py-2 text-sm" style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  )
}
