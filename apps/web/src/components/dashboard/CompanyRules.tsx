'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { User } from 'firebase/auth'
import { apiCall } from '@/lib/v2Api'

type Decision = 'allow' | 'ask' | 'deny'
type Kind = 'shell' | 'read' | 'write' | 'code' | 'fetch' | 'mcp'
interface CustomRule { id: string; kind: Kind; pattern: string; decision: Decision; reason?: string }
interface CompanyPolicy { disable: string[]; rules: CustomRule[]; allow: string[]; whenUnattended: 'block' | 'allow' | 'approve'; projectsCanRelax: boolean }
interface PolicyResponse { policy: CompanyPolicy | null; updatedAt: string | null; source: 'own' | 'team'; canEdit: boolean; teamWide?: boolean }

/**
 * The built-in rules of `agentverify protect`, in plain English. Must list the same IDs as DEFAULT_RULES in
 * packages/cli/src/codingGuard.ts (a CLI test checks this).
 */
export const BUILT_IN_RULES: Array<{ group: string; rules: Array<{ id: string; decision: 'ask' | 'deny'; label: string; locked?: boolean }> }> = [
  { group: 'Guard settings', rules: [
    { id: 'guard-config', decision: 'deny', label: 'Changing the guard settings (file edits)', locked: true },
    { id: 'guard-config-shell', decision: 'deny', label: 'Changing the guard settings (commands)', locked: true },
  ] },
  { group: 'Deleting and wiping', rules: [
    { id: 'rm-root', decision: 'deny', label: 'Deleting a whole drive, home folder or project' },
    { id: 'ps-remove-root', decision: 'deny', label: 'Deleting a whole drive or project (PowerShell)' },
    { id: 'disk-wipe', decision: 'deny', label: 'Wiping or formatting a disk' },
    { id: 'rm-recursive', decision: 'ask', label: 'Deleting a folder and everything in it' },
    { id: 'cmd-remove-tree', decision: 'ask', label: 'Deleting a folder and everything in it (Windows)' },
    { id: 'sql-drop', decision: 'ask', label: 'Dropping or emptying database tables' },
  ] },
  { group: 'Git', rules: [
    { id: 'git-force-main', decision: 'deny', label: 'Force-pushing to main or master' },
    { id: 'git-force', decision: 'ask', label: 'Other force pushes' },
    { id: 'git-push-main', decision: 'ask', label: 'Pushing straight to main or master' },
    { id: 'git-destructive', decision: 'ask', label: 'Rewriting history or throwing away changes' },
    { id: 'edit-git-hooks', decision: 'deny', label: 'Editing git hooks or git config' },
  ] },
  { group: 'Secrets and keys', rules: [
    { id: 'read-secret-file', decision: 'deny', label: 'Reading .env files, SSH keys and cloud credentials' },
    { id: 'shell-secret-file', decision: 'deny', label: 'Commands that touch secret files' },
    { id: 'shell-secret-glob', decision: 'deny', label: 'Wildcards that match secret files (cat .en*)' },
    { id: 'write-secret-file', decision: 'ask', label: 'Changing a secret file' },
    { id: 'exfil-secret', decision: 'deny', label: 'Sending a secret or key to a web address' },
    { id: 'exfil-upload', decision: 'ask', label: 'Uploading data from the computer' },
    { id: 'dump-env', decision: 'ask', label: 'Listing every environment variable' },
    { id: 'dump-env-code', decision: 'ask', label: 'One-line scripts that print every environment variable' },
    { id: 'code-reads-secret', decision: 'ask', label: 'Writing code that opens a secret file' },
    { id: 'code-dumps-env', decision: 'ask', label: 'Writing code that prints every environment variable' },
    { id: 'code-sends-secrets', decision: 'deny', label: 'Writing code that sends secrets to a web address' },
  ] },
  { group: 'Running code and installing', rules: [
    { id: 'curl-pipe-shell', decision: 'deny', label: 'Piping a download into a shell (curl … | sh)' },
    { id: 'decode-to-shell', decision: 'deny', label: 'Running encoded (hidden) commands' },
    { id: 'install-package', decision: 'ask', label: 'Installing packages' },
    { id: 'sudo', decision: 'ask', label: 'Running as administrator (sudo)' },
    { id: 'chmod-wide', decision: 'ask', label: 'Making files writable by everyone' },
  ] },
  { group: 'Deploys and CI', rules: [
    { id: 'deploy', decision: 'ask', label: 'Deploying' },
    { id: 'edit-ci', decision: 'ask', label: 'Editing CI pipelines' },
  ] },
  { group: 'Network', rules: [
    { id: 'fetch-metadata', decision: 'deny', label: 'Calling the cloud metadata service' },
    { id: 'fetch-dropsite', decision: 'ask', label: 'Fetching from paste and file-drop sites' },
  ] },
  { group: 'MCP tools', rules: [
    { id: 'mcp-destructive', decision: 'ask', label: 'Tools that delete things' },
    { id: 'mcp-money', decision: 'ask', label: 'Tools that move money' },
    { id: 'mcp-send', decision: 'ask', label: 'Tools that send or publish for you' },
  ] },
]

const EMPTY: CompanyPolicy = { disable: [], rules: [], allow: [], whenUnattended: 'block', projectsCanRelax: false }
const KIND_LABEL: Record<Kind, string> = { shell: 'Command', read: 'File read', write: 'File edit (path)', code: 'Code written', fetch: 'Web address', mcp: 'MCP tool' }
const DECISION_LABEL: Record<Decision, string> = { deny: 'Block', ask: 'Ask a person', allow: 'Allow' }

export function CompanyRules({ user }: { user: User }) {
  const [saved, setSaved] = useState<PolicyResponse | null>(null)
  const [draft, setDraft] = useState<CompanyPolicy>(EMPTY)
  const [allowText, setAllowText] = useState('')
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await apiCall<PolicyResponse>(user, '/v1/guard/policy')
      setSaved(res)
      const p = res.policy ?? EMPTY
      setDraft(p)
      setAllowText(p.allow.join('\n'))
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof Error ? e.message : 'Could not load company rules' })
    }
  }, [user])

  useEffect(() => { void load() }, [load])

  const editable = saved?.canEdit ?? false
  const current = useMemo(() => ({ ...draft, allow: allowText.split('\n').map(s => s.trim()).filter(Boolean) }), [draft, allowText])
  const dirty = saved !== null && JSON.stringify(current) !== JSON.stringify(saved.policy ?? EMPTY)

  const toggle = (id: string, on: boolean) => setDraft(d => ({ ...d, disable: on ? d.disable.filter(x => x !== id) : [...d.disable, id] }))
  const setRule = (i: number, patch: Partial<CustomRule>) => setDraft(d => ({ ...d, rules: d.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) }))

  const save = async () => {
    setSaving(true)
    setStatus(null)
    try {
      const rules = current.rules.map(r => ({ ...r, id: r.id.trim(), pattern: r.pattern.trim(), reason: r.reason?.trim() || undefined }))
      await apiCall(user, '/v1/guard/policy', { method: 'POST', body: { policy: { ...current, rules } } })
      await load()
      setStatus({ kind: 'ok', text: 'Saved. Every developer\'s guard picks this up within 5 minutes.' })
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof Error ? e.message : 'Could not save' })
    } finally {
      setSaving(false)
    }
  }

  const card = { backgroundColor: 'var(--card)', border: '1px solid var(--border)' }
  const input = { backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }
  const muted = { color: 'var(--text-muted)' }

  return (
    <section style={card} className="rounded-3xl p-5" aria-labelledby="company-rules-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="company-rules-title" style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">Company rules for AI coding agents</h2>
          <p style={muted} className="mt-1 max-w-2xl text-sm">
            {saved?.teamWide
              ? <>Set once, applied to everyone on {saved.source === 'team' ? 'your team' : 'your team (you included)'} who runs <code>agentverify protect</code> with their API key.</>
              : <>Applied wherever <code>agentverify protect</code> runs with an API key from this account.</>}
            {' '}A project&apos;s own rules can make these stricter, never weaker.
          </p>
        </div>
        {saved?.updatedAt && <p style={muted} className="text-xs">Last saved {new Date(saved.updatedAt).toLocaleString()}</p>}
      </div>

      {saved && editable && !saved.teamWide && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ border: '1px solid #7C3AED' }}>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>Set these once for your whole team.</strong> On the Team plan, everyone you add gets these rules automatically, and only you can change them.
          </p>
          <Link href="/pricing" className="shrink-0 rounded-lg bg-[#7C3AED] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">See the Team plan</Link>
        </div>
      )}

      {saved && !editable && (
        <p className="mt-3 rounded-xl px-3 py-2 text-xs" style={{ ...input, color: 'var(--text-secondary)' }}>
          {saved.source === 'team' ? 'Your Team owner sets these rules. You can see them here.' : 'Only a signed-in owner can change these rules.'}
        </p>
      )}

      <fieldset disabled={!editable || saving} className="mt-5 space-y-6">
        <div>
          <h3 style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Built-in rules</h3>
          <p style={muted} className="mt-1 text-xs">Untick a rule to turn it off for everyone.</p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {BUILT_IN_RULES.map(g => (
              <div key={g.group}>
                <p style={muted} className="text-[11px] font-semibold uppercase tracking-wider">{g.group}</p>
                <ul className="mt-1 space-y-1">
                  {g.rules.map(r => {
                    const on = r.locked || !draft.disable.includes(r.id)
                    return (
                      <li key={r.id}>
                        <label className="flex items-start gap-2 text-sm" style={{ color: on ? 'var(--text-secondary)' : 'var(--text-muted)' }} title={r.id}>
                          <input type="checkbox" className="mt-1" checked={on} disabled={r.locked} onChange={e => toggle(r.id, e.target.checked)} />
                          <span>
                            {r.label}{' '}
                            <span className="text-[11px] font-semibold" style={{ color: r.decision === 'deny' ? 'var(--accent-red-text)' : 'var(--accent-purple-text)' }}>{r.decision === 'deny' ? 'Block' : 'Ask'}</span>
                            {r.locked && <span style={muted} className="text-[11px]"> · always on</span>}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm" style={{ color: 'var(--text-secondary)' }}>
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>When nobody is watching</span>
            <span style={muted} className="mt-1 block text-xs">In auto or bypass mode the agent approves its own questions. Asking on the dashboard pauses the agent and pings your Slack or email from alert settings.</span>
            <select value={draft.whenUnattended} onChange={e => setDraft(d => ({ ...d, whenUnattended: e.target.value as 'block' | 'allow' | 'approve' }))} style={input} className="mt-2 rounded-lg px-2 py-1.5 text-sm">
              <option value="block">Block anything that needs a person</option>
              <option value="approve">Ask a person on this dashboard (waits up to 2 minutes)</option>
              <option value="allow">Let the agent decide</option>
            </select>
          </label>
          <label className="flex items-start gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" className="mt-1" checked={draft.projectsCanRelax} onChange={e => setDraft(d => ({ ...d, projectsCanRelax: e.target.checked }))} />
            <span>
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Projects can relax built-in rules</span>
              <span style={muted} className="mt-1 block text-xs">Off: a project&apos;s <code>.agentverify/policy.json</code> can only add rules. On: it can also turn built-in rules off. Your own rules below always apply.</span>
            </span>
          </label>
        </div>

        <div>
          <h3 style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Your own rules</h3>
          <p style={muted} className="mt-1 text-xs">Patterns are regular expressions, matched without regard to case. Example: block <code>psql .*prod</code> as a command.</p>
          <div className="mt-3 space-y-2">
            {draft.rules.map((r, i) => (
              <div key={i} className="grid gap-2 rounded-xl p-2 sm:grid-cols-[8rem_8rem_1fr_8rem_1fr_auto]" style={{ border: '1px solid var(--border)' }}>
                <input aria-label="Rule ID" placeholder="no-prod-db" value={r.id} onChange={e => setRule(i, { id: e.target.value })} style={input} className="rounded-lg px-2 py-1 font-mono text-xs" />
                <select aria-label="What it checks" value={r.kind} onChange={e => setRule(i, { kind: e.target.value as Kind })} style={input} className="rounded-lg px-2 py-1 text-xs">
                  {(Object.keys(KIND_LABEL) as Kind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
                <input aria-label="Pattern" placeholder="psql .*prod" value={r.pattern} onChange={e => setRule(i, { pattern: e.target.value })} style={input} className="rounded-lg px-2 py-1 font-mono text-xs" />
                <select aria-label="Decision" value={r.decision} onChange={e => setRule(i, { decision: e.target.value as Decision })} style={input} className="rounded-lg px-2 py-1 text-xs">
                  {(Object.keys(DECISION_LABEL) as Decision[]).map(d => <option key={d} value={d}>{DECISION_LABEL[d]}</option>)}
                </select>
                <input aria-label="Reason shown to the developer" placeholder="Why (shown to the developer)" value={r.reason ?? ''} onChange={e => setRule(i, { reason: e.target.value })} style={input} className="rounded-lg px-2 py-1 text-xs" />
                <button type="button" onClick={() => setDraft(d => ({ ...d, rules: d.rules.filter((_, j) => j !== i) }))} className="rounded-lg px-2 py-1 text-xs" style={{ color: 'var(--accent-red-text)' }} aria-label={`Remove rule ${r.id || i + 1}`}>Remove</button>
              </div>
            ))}
            <button type="button" onClick={() => setDraft(d => ({ ...d, rules: [...d.rules, { id: '', kind: 'shell', pattern: '', decision: 'deny', reason: '' }] }))} className="rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }}>+ Add rule</button>
          </div>
        </div>

        <label className="block text-sm">
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Always allowed</span>
          <span style={muted} className="mt-1 block text-xs">One pattern per line. Matching commands, paths or addresses skip the built-in rules and project rules (never the guard-settings rule).</span>
          <textarea value={allowText} onChange={e => setAllowText(e.target.value)} rows={3} placeholder={'^npm (i|install) --save-dev eslint$'} style={input} className="mt-2 w-full rounded-lg px-2 py-1.5 font-mono text-xs" />
        </label>
      </fieldset>

      {editable && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={!dirty || saving} className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: '#7C3AED' }}>{saving ? 'Saving…' : 'Save company rules'}</button>
          {dirty && !saving && <button type="button" onClick={() => { const p = saved?.policy ?? EMPTY; setDraft(p); setAllowText(p.allow.join('\n')); setStatus(null) }} className="text-xs underline" style={muted}>Undo changes</button>}
        </div>
      )}
      {status && <p role="status" className="mt-3 text-xs" style={{ color: status.kind === 'ok' ? 'var(--accent-green-text)' : 'var(--accent-orange-text)' }}>{status.text}</p>}
    </section>
  )
}
