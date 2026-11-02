'use client'

import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { apiCall } from '@/lib/v2Api'

interface Conn { id: string; provider: 'gitlab' | 'bitbucket'; host: string; project: string; created_at: number }
interface Created { id: string; provider: 'gitlab' | 'bitbucket'; project: string; webhookUrl: string; webhookSecret: string }

const STEPS: Record<'gitlab' | 'bitbucket', { token: string; webhook: string[] }> = {
  gitlab: {
    token: 'In GitLab: your project → Settings → Access tokens → add a token with the "api" scope and the Developer role.',
    webhook: ['In GitLab: your project → Settings → Webhooks → Add new webhook.', 'URL: paste the address below. Secret token: paste the secret below.', 'Trigger: tick "Merge request events" only, then Add webhook.'],
  },
  bitbucket: {
    token: 'In Bitbucket: your repository → Repository settings → Access tokens → create a token with "Pull requests: Write" and "Repositories: Read".',
    webhook: ['In Bitbucket: Repository settings → Webhooks → Add webhook.', 'URL: paste the address below. Secret: paste the secret below.', 'Triggers: Pull request → Created and Updated, then Save.'],
  },
}

export function VcsConnections({ user }: { user: User }) {
  const [list, setList] = useState<Conn[] | null>(null)
  const [provider, setProvider] = useState<'gitlab' | 'bitbucket'>('gitlab')
  const [host, setHost] = useState('gitlab.com')
  const [project, setProject] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Created | null>(null)

  const load = useCallback(async () => {
    try { setList((await apiCall<{ connections: Conn[] }>(user, '/v1/vcs/connections')).connections) } catch { setList([]) }
  }, [user])
  useEffect(() => { void load() }, [load])

  const connect = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await apiCall<Created>(user, '/v1/vcs/connections', { method: 'POST', body: { provider, host: provider === 'gitlab' ? host : undefined, project, token } })
      setCreated(res)
      setToken('')
      setProject('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect that project.')
    }
    setBusy(false)
  }
  const remove = async (c: Conn) => {
    if (!window.confirm(`Disconnect ${c.project}? Merge requests there will no longer be scanned. Also delete the webhook in ${c.provider === 'gitlab' ? 'GitLab' : 'Bitbucket'}.`)) return
    await apiCall(user, `/v1/vcs/connections?id=${encodeURIComponent(c.id)}`, { method: 'DELETE' }).catch(() => undefined)
    await load()
  }

  const card = { backgroundColor: 'var(--card)', border: '1px solid var(--border)' }
  const input = { backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }
  const copy = (text: string) => { void navigator.clipboard?.writeText(text).catch(() => undefined) }

  return (
    <section style={card} className="rounded-3xl p-6 shadow-xl shadow-black/5">
      <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">GitLab and Bitbucket</h2>
      <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">The same pass/fail check and updating comment on merge requests and pull requests. Connect one project at a time.</p>

      {list && list.length > 0 && (
        <ul className="mt-4 space-y-2">
          {list.map(c => (
            <li key={c.id} style={{ border: '1px solid var(--border)' }} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm">
              <span style={{ color: 'var(--text-primary)' }} className="truncate">{c.provider === 'gitlab' ? 'GitLab' : 'Bitbucket'} · {c.host === 'gitlab.com' || c.host === 'bitbucket.org' ? '' : `${c.host} · `}{c.project}</span>
              <button onClick={() => remove(c)} className="shrink-0 text-xs font-semibold text-[color:var(--accent-orange-text)] hover:underline">Disconnect</button>
            </li>
          ))}
        </ul>
      )}

      {created ? (
        <div className="mt-5 rounded-2xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p style={{ color: 'var(--accent-green-text)' }} className="text-sm font-semibold">Connected {created.project}. One last step — add the webhook:</p>
          <ol style={{ color: 'var(--text-secondary)' }} className="mt-2 list-decimal space-y-1 pl-5 text-sm">{STEPS[created.provider].webhook.map(s => <li key={s}>{s}</li>)}</ol>
          {[['Webhook address', created.webhookUrl], ['Secret', created.webhookSecret]].map(([label, value]) => (
            <div key={label} className="mt-3">
              <p style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold">{label}</p>
              <div className="mt-1 flex gap-2">
                <input readOnly value={value} onFocus={e => e.currentTarget.select()} style={input} className="min-w-0 flex-1 rounded-lg px-2 py-1.5 font-mono text-xs" aria-label={label} />
                <button onClick={() => copy(value)} className="rounded-lg px-3 text-xs font-semibold" style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }}>Copy</button>
              </div>
            </div>
          ))}
          <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">Save the secret now — it is not shown again. Your access token is stored encrypted and never displayed.</p>
          <button onClick={() => setCreated(null)} className="mt-3 text-xs font-semibold text-[color:var(--accent-purple-text)] hover:underline">Done</button>
        </div>
      ) : (
        <form onSubmit={connect} className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
            Code host
            <select value={provider} onChange={e => setProvider(e.target.value as 'gitlab' | 'bitbucket')} style={input} className="mt-1 w-full rounded-xl px-3 py-2 text-sm font-normal">
              <option value="gitlab">GitLab</option>
              <option value="bitbucket">Bitbucket Cloud</option>
            </select>
          </label>
          {provider === 'gitlab' && (
            <label className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              GitLab address
              <input value={host} onChange={e => setHost(e.target.value)} placeholder="gitlab.com" style={input} className="mt-1 w-full rounded-xl px-3 py-2 text-sm font-normal" />
            </label>
          )}
          <label className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
            {provider === 'gitlab' ? 'Project path' : 'Workspace / repository'}
            <input required value={project} onChange={e => setProject(e.target.value)} placeholder={provider === 'gitlab' ? 'group/project' : 'workspace/repo'} style={input} className="mt-1 w-full rounded-xl px-3 py-2 text-sm font-normal" />
          </label>
          <label className="text-xs font-semibold sm:col-span-2" style={{ color: 'var(--text-primary)' }}>
            Access token
            <input required type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} style={input} className="mt-1 w-full rounded-xl px-3 py-2 text-sm font-normal" />
            <span style={{ color: 'var(--text-muted)' }} className="mt-1 block font-normal">{STEPS[provider].token}</span>
          </label>
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy} className="av-press rounded-xl bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Checking…' : 'Connect project'}</button>
            {error && <p className="mt-2 text-xs" style={{ color: 'var(--accent-orange-text)' }}>{error}</p>}
          </div>
        </form>
      )}
    </section>
  )
}
