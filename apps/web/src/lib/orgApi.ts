import type { User } from 'firebase/auth'
import { getApiBaseUrl } from './billing'

/**
 * Client-side wrapper for the Organizations/Audit Log/Webhooks Worker API — the browser side of
 * the Firebase-token auth bridge (workers/api/src/authz.ts). Every call here sends the current
 * user's real Firebase ID token as a Bearer token; the Worker independently re-verifies it and
 * re-reads the caller's role from Firestore on every request — nothing here, including any
 * "role" value a response happens to include, should ever be treated by calling UI code as
 * authoritative for what the user is ALLOWED to do next. It's authoritative only for what to
 * display; a denied action still gets rejected server-side even if the UI never renders a button
 * for it.
 */

export type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'

export interface Organization {
  orgId: string
  name: string
  ownerId: string
  plan: string
  createdAt: string
}

export interface MyOrganization {
  orgId: string
  role: Role
  name: string
}

export interface Member {
  uid: string
  role: Role
  addedAt: string
  addedBy: string
  /** Best-effort — resolved server-side; absent if that lookup failed. */
  email?: string
}

export interface AuditEvent {
  eventId: string
  organizationId: string
  actorId: string
  actorType: 'user' | 'api_key' | 'system'
  action: string
  targetType: string
  targetId: string
  timestamp: string
  metadata: Record<string, string | number | boolean | null>
}

export interface Webhook {
  webhookId: string
  organizationId: string
  endpoint: string
  enabledEvents: string[]
  status: 'active' | 'disabled'
  createdAt: string
  createdBy: string
  lastDeliveryAt: string | null
  lastDeliveryStatus: 'success' | 'failed' | null
}

export class OrgApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
    this.name = 'OrgApiError'
  }
}

async function call<T>(user: User, path: string, init: RequestInit = {}): Promise<T> {
  const token = await user.getIdToken()
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers },
  })
  const body = await res.json().catch(() => ({})) as Record<string, unknown> & { error?: string }
  if (!res.ok) throw new OrgApiError(body.error ?? `Request failed (${res.status})`, res.status)
  return body as T
}

export const createOrganization = (user: User, name: string) =>
  call<Organization>(user, '/v1/organizations', { method: 'POST', body: JSON.stringify({ name }) })

export const listMyOrganizations = (user: User) =>
  call<{ organizations: MyOrganization[] }>(user, '/v1/organizations/mine').then(r => r.organizations)

export const listMembers = (user: User, orgId: string) =>
  call<{ members: Member[] }>(user, `/v1/organizations/${orgId}/members`).then(r => r.members)

export const inviteMember = (user: User, orgId: string, email: string, role: Role) =>
  call<{ ok: true; uid: string; role: Role }>(user, `/v1/organizations/${orgId}/members`, { method: 'POST', body: JSON.stringify({ email, role }) })

export const changeRole = (user: User, orgId: string, targetUid: string, role: Role) =>
  call<{ ok: true }>(user, `/v1/organizations/${orgId}/members/${targetUid}`, { method: 'PATCH', body: JSON.stringify({ role }) })

export const removeMember = (user: User, orgId: string, targetUid: string) =>
  call<{ ok: true }>(user, `/v1/organizations/${orgId}/members/${targetUid}`, { method: 'DELETE' })

export const listAuditEvents = (user: User, orgId: string) =>
  call<{ events: AuditEvent[] }>(user, `/v1/organizations/${orgId}/audit-log`).then(r => r.events)

export const listWebhooks = (user: User, orgId: string) =>
  call<{ webhooks: Webhook[] }>(user, `/v1/organizations/${orgId}/webhooks`).then(r => r.webhooks)

export const createWebhook = (user: User, orgId: string, endpoint: string, events: string[]) =>
  call<Webhook & { secret: string }>(user, `/v1/organizations/${orgId}/webhooks`, { method: 'POST', body: JSON.stringify({ endpoint, events }) })

export const disableWebhook = (user: User, orgId: string, webhookId: string) =>
  call<{ ok: true }>(user, `/v1/organizations/${orgId}/webhooks/${webhookId}/disable`, { method: 'POST' })
