'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { User } from 'firebase/auth'
import * as orgApi from '@/lib/orgApi'
import { copyToClipboard } from '@/lib/clipboard'
import type { MyOrganization, Member, AuditEvent, Webhook, Role } from '@/lib/orgApi'
import { hasPermission, ROLE_LABELS, ROLE_DESCRIPTIONS } from '@/lib/rbac'
import { describeAuditEvent } from '@/lib/auditEventCopy'
import type { DashboardTab } from '@/types'

type Section = 'overview' | 'members' | 'audit' | 'webhooks'

/**
 * Workspace — the authenticated Organizations/RBAC/Audit Log/Webhooks experience, built entirely
 * on top of the browser Firebase-token auth bridge (workers/api/src/authz.ts). Every mutation
 * here is enforced server-side; this component only decides what to SHOW based on the caller's
 * real, server-reported role — never grants anything on its own.
 */
export function Workspace({ user, onNavigate }: { user: User; onNavigate?: (tab: DashboardTab) => void }) {
  const [orgs, setOrgs] = useState<MyOrganization[] | null>(null)
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)
  const [section, setSection] = useState<Section>('overview')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newOrgName, setNewOrgName] = useState('')

  const loadOrgs = () => {
    orgApi.listMyOrganizations(user)
      .then(list => {
        setOrgs(list)
        setSelectedOrgId(prev => prev && list.some(o => o.orgId === prev) ? prev : (list[0]?.orgId ?? null))
      })
      .catch(err => setError(err instanceof orgApi.OrgApiError ? err.message : 'Could not load your workspaces.'))
  }

  useEffect(() => { loadOrgs() }, [user.uid]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedOrg = orgs?.find(o => o.orgId === selectedOrgId) ?? null

  const handleCreate = async () => {
    if (!newOrgName.trim()) return
    setCreating(true)
    setError(null)
    try {
      const org = await orgApi.createOrganization(user, newOrgName.trim())
      setNewOrgName('')
      loadOrgs()
      setSelectedOrgId(org.orgId)
    } catch (err) {
      setError(err instanceof orgApi.OrgApiError ? err.message : 'Could not create the workspace.')
    } finally {
      setCreating(false)
    }
  }

  if (orgs === null) {
    return (
      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-8 text-center">
        <div style={{ borderColor: 'var(--border)', borderTopColor: '#06B6D4' }} className="mx-auto mb-4 h-6 w-6 animate-spin rounded-full border-2" />
        <p style={{ color: 'var(--text-primary)' }} className="text-sm font-medium">Loading your workspaces</p>
      </div>
    )
  }

  if (orgs.length === 0) {
    return (
      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="av-animate-rise rounded-3xl p-8 text-center shadow-2xl shadow-black/5 md:p-12">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#7C3AED]/10 text-lg font-semibold text-[color:var(--accent-purple-text)]">▣</div>
        <h3 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">No workspace yet</h3>
        <p style={{ color: 'var(--text-muted)' }} className="mx-auto mt-2 max-w-sm text-sm">Create a workspace to invite teammates, share policies, and see a shared audit log across everyone&apos;s scans.</p>
        <div className="mx-auto mt-6 flex max-w-sm flex-col gap-2 sm:flex-row">
          <input value={newOrgName} onChange={e => setNewOrgName(e.target.value)} placeholder="Workspace name" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }} className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none" />
          <button onClick={handleCreate} disabled={creating || !newOrgName.trim()} className="av-press rounded-xl bg-[#06B6D4] px-5 py-2.5 text-sm font-semibold text-[#080B14] transition-opacity hover:opacity-90 disabled:opacity-50">
            {creating ? 'Creating...' : 'Create workspace'}
          </button>
        </div>
        {error && <p className="mt-3 text-xs text-[color:var(--accent-red-text)]">{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {orgs.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold uppercase tracking-wide">Workspace:</span>
          <select value={selectedOrgId ?? ''} onChange={e => setSelectedOrgId(e.target.value)} aria-label="Switch workspace" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }} className="rounded-xl px-3 py-1.5 text-sm outline-none">
            {orgs.map(o => <option key={o.orgId} value={o.orgId}>{o.name}</option>)}
          </select>
        </div>
      )}

      {selectedOrg && (
        <>
          <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-5 shadow-xl shadow-black/5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">{selectedOrg.name}</p>
                <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">{ROLE_DESCRIPTIONS[selectedOrg.role]}</p>
              </div>
              <span className="rounded-full bg-[#7C3AED]/10 px-3 py-1.5 text-xs font-semibold text-[color:var(--accent-purple-text)]">Your role: {ROLE_LABELS[selectedOrg.role]}</span>
            </div>
          </div>

          <div className="av-stagger flex gap-1.5 overflow-x-auto">
            {([['overview', 'Overview'], ['members', 'Members'], ['audit', 'Audit Log'], ['webhooks', 'Webhooks']] as const)
              .filter(([id]) => id !== 'webhooks' || hasPermission(selectedOrg.role, 'configure_webhook'))
              .map(([id, label]) => (
              <button key={id} onClick={() => setSection(id)} aria-current={section === id ? 'page' : undefined} style={{ backgroundColor: section === id ? 'var(--text-primary)' : 'var(--card)', color: section === id ? 'var(--bg)' : 'var(--text-muted)', border: '1px solid var(--border)' }} className="av-transition shrink-0 rounded-full px-4 py-2 text-xs font-semibold">
                {label}
              </button>
            ))}
          </div>

          {error && <p className="text-xs text-[color:var(--accent-red-text)]">{error}</p>}

          <div key={section} className="av-animate-fade">
            {section === 'overview' && <WorkspaceOverview org={selectedOrg} onNavigate={onNavigate} />}
            {section === 'members' && <MembersSection user={user} org={selectedOrg} onError={setError} />}
            {section === 'audit' && <AuditLogSection user={user} org={selectedOrg} />}
            {section === 'webhooks' && <WebhooksSection user={user} org={selectedOrg} onError={setError} />}
          </div>
        </>
      )}
    </div>
  )
}

function WorkspaceOverview({ org, onNavigate }: { org: MyOrganization; onNavigate?: (tab: DashboardTab) => void }) {
  return (
    <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-6 shadow-xl shadow-black/5">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wider">Workspace name</p>
          <p style={{ color: 'var(--text-primary)' }} className="mt-1 text-sm font-medium">{org.name}</p>
        </div>
        <div>
          <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wider">Your role</p>
          <p style={{ color: 'var(--text-primary)' }} className="mt-1 text-sm font-medium">{ROLE_LABELS[org.role]}</p>
        </div>
        <div>
          <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wider">Plan</p>
          <p style={{ color: 'var(--text-primary)' }} className="mt-1 text-sm font-medium">Free</p>
        </div>
      </div>
      <p style={{ color: 'var(--text-muted)' }} className="mt-5 text-xs leading-relaxed">
        Agents, policies, and integrations scanned or configured with an API key attributed to this workspace (via <code>organizationId</code> on a scan) show up in the Audit Log tab. See the Agents and Policies tabs for the full lists — they aren&apos;t duplicated here.
      </p>
      <div style={{ borderTop: '1px solid var(--border)' }} className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 pt-4 text-xs">
        <button onClick={() => onNavigate?.('api')} className="font-semibold text-[color:var(--accent-cyan-text)] hover:opacity-80">Your API keys →</button>
        <Link href="/docs#workspaces" className="font-semibold text-[color:var(--accent-cyan-text)] hover:opacity-80">Workspaces docs →</Link>
        <Link href="/docs#webhooks" className="font-semibold text-[color:var(--accent-cyan-text)] hover:opacity-80">Webhooks docs →</Link>
      </div>
    </div>
  )
}

function MembersSection({ user, org, onError }: { user: User; org: MyOrganization; onError: (e: string | null) => void }) {
  const [members, setMembers] = useState<Member[] | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('MEMBER')
  const [busy, setBusy] = useState(false)

  const load = () => {
    orgApi.listMembers(user, org.orgId).then(setMembers).catch(err => onError(err instanceof orgApi.OrgApiError ? err.message : 'Could not load members.'))
  }
  useEffect(() => { load() }, [org.orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  const invite = async () => {
    if (!email.trim()) return
    setBusy(true)
    onError(null)
    try {
      await orgApi.inviteMember(user, org.orgId, email.trim(), role)
      setEmail('')
      load()
    } catch (err) {
      onError(err instanceof orgApi.OrgApiError ? friendlyMemberError(err) : 'Could not invite that member.')
    } finally {
      setBusy(false)
    }
  }

  const changeRole = async (uid: string, newRole: Role) => {
    onError(null)
    try {
      await orgApi.changeRole(user, org.orgId, uid, newRole)
      load()
    } catch (err) {
      onError(err instanceof orgApi.OrgApiError ? friendlyMemberError(err) : 'Could not change that role.')
    }
  }

  const remove = async (uid: string) => {
    onError(null)
    try {
      await orgApi.removeMember(user, org.orgId, uid)
      load()
    } catch (err) {
      onError(err instanceof orgApi.OrgApiError ? friendlyMemberError(err) : 'Could not remove that member.')
    }
  }

  const canInvite = hasPermission(org.role, 'invite_members')
  const canModifyRoles = hasPermission(org.role, 'modify_roles')

  return (
    <div className="space-y-4">
      {canInvite && (
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
          <p style={{ color: 'var(--text-primary)' }} className="mb-2 text-sm font-semibold">Invite a member</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="teammate@example.com" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }} className="flex-1 rounded-xl px-3 py-2 text-sm outline-none" />
            <select value={role} onChange={e => setRole(e.target.value as Role)} aria-label="Role for new member" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }} className="rounded-xl px-3 py-2 text-sm outline-none">
              <option value="ADMIN">Admin</option>
              <option value="MEMBER">Member</option>
              <option value="VIEWER">Viewer</option>
            </select>
            <button onClick={invite} disabled={busy || !email.trim()} className="av-press rounded-xl bg-[#06B6D4] px-4 py-2 text-sm font-semibold text-[#080B14] disabled:opacity-50">Invite</button>
          </div>
          <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs">They must already have an Agent Verify account with this email.</p>
        </div>
      )}

      <div style={{ border: '1px solid var(--border)' }} className="overflow-hidden rounded-2xl">
        <div style={{ backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--border)' }} className="hidden gap-4 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide sm:flex">
          <span style={{ color: 'var(--text-muted)' }} className="flex-1">Member</span>
          <span style={{ color: 'var(--text-muted)' }} className="w-28">Role</span>
          <span style={{ color: 'var(--text-muted)' }} className="w-32">Joined</span>
          <span style={{ color: 'var(--text-muted)' }} className="w-20 text-right">Actions</span>
        </div>
        {members === null ? (
          <p style={{ color: 'var(--text-muted)' }} className="p-4 text-sm">Loading members...</p>
        ) : members.map(m => (
          <div key={m.uid} style={{ backgroundColor: 'var(--card)', borderBottom: '1px solid var(--border)' }} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
            <span style={{ color: 'var(--text-primary)' }} className="flex-1 truncate text-sm font-medium">{m.email ?? m.uid}</span>
            <span className="w-28">
              {canModifyRoles && m.role !== 'OWNER' ? (
                <select value={m.role} onChange={e => changeRole(m.uid, e.target.value as Role)} aria-label={`Change role for ${m.email ?? m.uid}`} style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }} className="w-full rounded-lg px-2 py-1 text-xs outline-none">
                  <option value="ADMIN">Admin</option>
                  <option value="MEMBER">Member</option>
                  <option value="VIEWER">Viewer</option>
                </select>
              ) : (
                <span style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold">{ROLE_LABELS[m.role]}</span>
              )}
            </span>
            <span style={{ color: 'var(--text-muted)' }} className="w-32 text-xs">{m.addedAt ? new Date(m.addedAt).toLocaleDateString() : '—'}</span>
            <span className="w-20 text-right">
              {canInvite && m.role !== 'OWNER' && (
                <button onClick={() => remove(m.uid)} className="av-press text-xs font-semibold text-[color:var(--accent-red-text)]">Remove</button>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function friendlyMemberError(err: orgApi.OrgApiError): string {
  if (err.status === 403) return "You don't have permission to do that in this workspace."
  if (err.status === 404 && /account found/i.test(err.message)) return "No Agent Verify account exists with that email yet — ask them to sign up first."
  if (/last OWNER/i.test(err.message)) return err.message
  return err.message
}

function AuditLogSection({ user, org }: { user: User; org: MyOrganization }) {
  const [events, setEvents] = useState<AuditEvent[] | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [actionFilter, setActionFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    orgApi.listAuditEvents(user, org.orgId).then(setEvents).catch(() => setEvents([]))
    orgApi.listMembers(user, org.orgId).then(setMembers).catch(() => {})
  }, [user, org.orgId])

  const emailByUid = useMemo(() => new Map(members.map(m => [m.uid, m.email ?? m.uid])), [members])

  const actions = useMemo(() => Array.from(new Set((events ?? []).map(e => e.action))).sort(), [events])

  const filtered = useMemo(() => {
    let list = events ?? []
    if (actionFilter !== 'all') list = list.filter(e => e.action === actionFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(e => describeAuditEvent(e, emailByUid.get(e.actorId) ?? e.actorId, resolveTargetLabel(e, emailByUid)).toLowerCase().includes(q))
    }
    return list
  }, [events, actionFilter, search, emailByUid])

  if (events === null) return <p style={{ color: 'var(--text-muted)' }} className="text-sm">Loading audit log...</p>

  if (events.length === 0) {
    return (
      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-8 text-center">
        <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">No activity yet</p>
        <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">Scans, member changes, and webhook activity attributed to this workspace will appear here.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search activity..." aria-label="Search audit log" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }} className="w-full rounded-xl px-3 py-2 text-sm outline-none sm:w-64" />
        <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} aria-label="Filter by action" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }} className="rounded-xl px-3 py-2 text-xs outline-none">
          <option value="all">All actions</option>
          {actions.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
        </select>
      </div>
      <div className="av-stagger space-y-1.5">
        {filtered.map(event => {
          const actorLabel = emailByUid.get(event.actorId) ?? event.actorId
          const targetLabel = resolveTargetLabel(event, emailByUid)
          const isOpen = expanded === event.eventId
          return (
            <div key={event.eventId} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="av-transition overflow-hidden rounded-2xl">
              <button onClick={() => setExpanded(isOpen ? null : event.eventId)} className="flex w-full items-start gap-3 px-4 py-3 text-left" aria-expanded={isOpen}>
                <span style={{ color: 'var(--text-muted)' }} className="mt-0.5 w-32 shrink-0 text-[11px]">{event.timestamp ? new Date(event.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</span>
                <span style={{ color: 'var(--text-primary)' }} className="flex-1 text-sm">{describeAuditEvent(event, actorLabel, targetLabel)}</span>
              </button>
              {isOpen && (
                <div style={{ borderTop: '1px solid var(--border)' }} className="av-animate-fade px-4 py-3 text-xs">
                  <p style={{ color: 'var(--text-muted)' }}>Action: <code>{event.action}</code> · Target: <code>{event.targetType}/{event.targetId}</code></p>
                  {Object.keys(event.metadata).length > 0 && (
                    <pre style={{ color: 'var(--text-muted)' }} className="mt-1 overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(event.metadata, null, 2)}</pre>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function resolveTargetLabel(event: AuditEvent, emailByUid: Map<string, string>): string | undefined {
  if (event.targetType === 'member') return emailByUid.get(event.targetId) ?? event.targetId
  if (event.targetType === 'scan' && typeof event.metadata.fileName === 'string') return event.metadata.fileName
  return undefined
}

function WebhooksSection({ user, org, onError }: { user: User; org: MyOrganization; onError: (e: string | null) => void }) {
  const [webhooks, setWebhooks] = useState<Webhook[] | null>(null)
  const [endpoint, setEndpoint] = useState('')
  const [events, setEvents] = useState<string[]>(['SCAN_COMPLETED'])
  const [busy, setBusy] = useState(false)
  const [newSecret, setNewSecret] = useState<{ webhookId: string; secret: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const canConfigure = hasPermission(org.role, 'configure_webhook')

  const load = () => {
    if (!canConfigure) return
    orgApi.listWebhooks(user, org.orgId).then(setWebhooks).catch(err => onError(err instanceof orgApi.OrgApiError ? friendlyWebhookError(err) : 'Could not load webhooks.'))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [org.orgId])

  const create = async () => {
    if (!endpoint.trim() || events.length === 0) return
    setBusy(true)
    onError(null)
    try {
      const created = await orgApi.createWebhook(user, org.orgId, endpoint.trim(), events)
      setNewSecret({ webhookId: created.webhookId, secret: created.secret })
      setEndpoint('')
      load()
    } catch (err) {
      onError(err instanceof orgApi.OrgApiError ? friendlyWebhookError(err) : 'Could not create the webhook.')
    } finally {
      setBusy(false)
    }
  }

  const disable = async (webhookId: string) => {
    onError(null)
    try {
      await orgApi.disableWebhook(user, org.orgId, webhookId)
      load()
    } catch (err) {
      onError(err instanceof orgApi.OrgApiError ? err.message : 'Could not disable that webhook.')
    }
  }

  const toggleEvent = (e: string) => setEvents(prev => prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e])

  return (
    <div className="space-y-4">
      {newSecret && (
        <div style={{ backgroundColor: 'var(--surface)', border: '1px solid #7C3AED55' }} className="av-animate-rise rounded-2xl p-4">
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Webhook signing secret — shown once</p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">Copy this now. Agent Verify never displays it again after you leave this page.</p>
          <div className="relative mt-2">
            <input readOnly value={newSecret.secret} style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-muted)' }} className="w-full rounded-lg px-3 py-2 pr-20 font-mono text-xs outline-none" />
            <button onClick={async () => { if (await copyToClipboard(newSecret.secret)) { setCopied(true); setTimeout(() => setCopied(false), 2000) } }} className="av-press absolute right-1.5 top-1.5 rounded px-2 py-1 text-xs font-medium" style={{ backgroundColor: copied ? '#7C3AED' : 'var(--card)', color: copied ? '#fff' : 'var(--text-muted)', border: '1px solid var(--border)' }}>
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {canConfigure && (
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Add Webhook Endpoint</p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs leading-relaxed">
            Send Agent Verify events to your SIEM, automation, or backend. A webhook is a URL of yours that Agent Verify can notify — pick which events matter to you below, and every notification is signed so your endpoint can verify it really came from Agent Verify.
            {' '}<Link href="/docs#webhooks" className="underline hover:opacity-80">How webhooks work →</Link>
          </p>
          <p style={{ color: 'var(--accent-orange-text)' }} className="mt-2 text-xs">
            Configuration is live today; automatic delivery to your endpoint is not enabled yet — see the docs above for what that means right now.
          </p>
          <input value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="https://your-service.example.com/webhook" aria-label="Webhook endpoint URL" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }} className="mt-3 w-full rounded-xl px-3 py-2 text-sm outline-none" />
          <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-[11px] font-semibold uppercase tracking-wide">Notify this endpoint when:</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {['SCAN_COMPLETED', 'VERIFICATION_PASSED', 'VERIFICATION_FAILED', 'ATTESTATION_ISSUED', 'POLICY_APPLIED', 'ROLE_CHANGED', 'MEMBER_ADDED'].map(e => (
              <button key={e} onClick={() => toggleEvent(e)} style={{ backgroundColor: events.includes(e) ? 'var(--text-primary)' : 'var(--card)', color: events.includes(e) ? 'var(--bg)' : 'var(--text-muted)', border: '1px solid var(--border)' }} className="av-transition rounded-full px-3 py-1 text-[11px] font-semibold">
                {e.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
          <button onClick={create} disabled={busy || !endpoint.trim() || events.length === 0} className="av-press mt-3 rounded-xl bg-[#06B6D4] px-4 py-2 text-sm font-semibold text-[#080B14] disabled:opacity-50">
            {busy ? 'Adding...' : 'Add webhook endpoint'}
          </button>
        </div>
      )}

      <div className="av-stagger space-y-2">
        {!canConfigure ? (
          <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-6 text-center">
            <p style={{ color: 'var(--text-muted)' }} className="text-sm">You don&apos;t have permission to view webhooks in this workspace. Ask an Owner or Admin.</p>
          </div>
        ) : webhooks === null ? (
          <p style={{ color: 'var(--text-muted)' }} className="text-sm">Loading webhooks...</p>
        ) : webhooks.length === 0 ? (
          <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-6 text-center">
            <p style={{ color: 'var(--text-muted)' }} className="text-sm">No webhooks configured for this workspace yet.</p>
          </div>
        ) : webhooks.map(w => (
          <div key={w.webhookId} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p style={{ color: 'var(--text-primary)' }} className="truncate text-sm font-semibold">{w.endpoint}</p>
                <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-xs">{w.enabledEvents.join(', ')}</p>
                <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-[11px]">Created {w.createdAt ? new Date(w.createdAt).toLocaleDateString() : '—'} · Last delivery: {w.lastDeliveryAt ? new Date(w.lastDeliveryAt).toLocaleString() : 'none yet'}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${w.status === 'active' ? 'bg-[#00B37E]/10 text-[color:var(--accent-green-text)]' : 'bg-[var(--surface)] text-[color:var(--text-muted)]'}`} style={w.status !== 'active' ? { border: '1px solid var(--border)' } : undefined}>
                  {w.status === 'active' ? 'Active' : 'Disabled'}
                </span>
                {canConfigure && w.status === 'active' && (
                  <button onClick={() => disable(w.webhookId)} className="av-press text-xs font-semibold text-[color:var(--accent-red-text)]">Disable</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function friendlyWebhookError(err: orgApi.OrgApiError): string {
  // Server messages are already plain-English (see webhookSecurity.ts) — e.g. "This endpoint
  // cannot use a private or local network address." — never a raw RFC1918/regex detail, so this
  // just passes the message through rather than re-wrapping it.
  return err.message.replace(/^Invalid webhook URL: /, '')
}
