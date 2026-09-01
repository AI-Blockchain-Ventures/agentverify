import { firestoreBaseUrl, firestoreResourcePath, firestoreAdminAuthHeader, identityToolkitBaseUrl, apiKeyQueryParam, type FirebaseServiceAccountEnv } from './firebaseAuth'
import { hasPermission, isValidRole, type Permission, type Role } from './rbac'

/**
 * Organizations / Workspaces — data access and RBAC-enforced mutations.
 *
 * Every mutation here re-derives the actor's role from Firestore itself (never trusts a
 * client-supplied role/orgId pairing) and checks it against rbac.ts's permission matrix BEFORE
 * writing anything. Reads use admin-level Firestore access (a real service-account OAuth token in
 * production, or the emulator's "owner" token locally — see firebaseAuth.ts), which bypasses
 * firestore.rules — so this file, not firestore.rules, is the real enforcement point for every
 * organization mutation. firestore.rules still denies ALL direct client writes to
 * `organizations`/`organizations/{orgId}/members` (see firestore.rules) as defense in depth: even
 * a client holding a valid Firebase Auth session cannot bypass this module by writing to
 * Firestore directly — every mutation must go through this code.
 *
 * Backward compatibility: this is entirely ADDITIVE. Existing `users/{uid}/reports`,
 * `cliReports`, `reports` documents are never touched by anything in this file, and a user with
 * no organization membership continues to operate exactly as before — there is no "default
 * personal workspace" document that must exist; its absence simply means the uid-scoped behavior
 * applies, unchanged. No production migration is performed or required by this feature.
 */

export type OrganizationsEnv = FirebaseServiceAccountEnv

export interface Membership {
  uid: string
  role: Role
  addedAt: string
  addedBy: string
  /** Best-effort — resolved via a reverse Identity Toolkit lookup; absent if that lookup fails, never blocking the membership list itself. */
  email?: string
}

export interface Organization {
  orgId: string
  name: string
  ownerId: string
  plan: string
  createdAt: string
}

type PermissionCheck = { ok: true; role: Role } | { ok: false; status: number; error: string }

function docPath(env: OrganizationsEnv, path: string): string {
  return `${firestoreBaseUrl(env)}/${path}`
}

interface FirestoreValue {
  stringValue?: string
  booleanValue?: boolean
  nullValue?: null
}
interface FirestoreDocResponse {
  fields?: Record<string, FirestoreValue>
}

const str = (v?: FirestoreValue): string | undefined => (typeof v?.stringValue === 'string' ? v.stringValue : undefined)

/** Reads a member's role directly — the single source of truth for "what can this uid do in this org". Returns null if the org doesn't exist or the uid is not a member (never distinguished from each other in the response, to avoid confirming an org's existence to a non-member). */
export async function getMembership(orgId: string, uid: string, env: OrganizationsEnv): Promise<Membership | null> {
  const headers = await firestoreAdminAuthHeader(env)
  if (!headers) return null
  const res = await fetch(docPath(env, `organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(uid)}`), { headers })
  if (!res.ok) return null
  const data = await res.json() as FirestoreDocResponse
  const role = str(data.fields?.role)
  if (!role || !isValidRole(role)) return null
  return {
    uid,
    role,
    addedAt: str(data.fields?.addedAt) ?? '',
    addedBy: str(data.fields?.addedBy) ?? '',
  }
}

/**
 * The single gate every org-scoped Worker route calls before doing anything. `uid` must come
 * from server-side API-key/Firebase-token validation — never from a request body/query param.
 */
export async function requirePermission(orgId: string, uid: string, permission: Permission, env: OrganizationsEnv): Promise<PermissionCheck> {
  const membership = await getMembership(orgId, uid, env)
  if (!membership) return { ok: false, status: 404, error: 'Organization not found or you are not a member' }
  if (!hasPermission(membership.role, permission)) {
    return { ok: false, status: 403, error: `Role ${membership.role} does not have permission: ${permission}` }
  }
  return { ok: true, role: membership.role }
}

interface CommitWrite {
  update: { name: string; fields: Record<string, unknown> }
}

async function commitWrites(writes: CommitWrite[], headers: Record<string, string>, env: OrganizationsEnv): Promise<boolean> {
  const url = `${firestoreBaseUrl(env)}:commit`
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes }),
  })
  if (!res.ok) console.error('Firestore commit failed:', res.status, await res.text().catch(() => ''))
  return res.ok
}

/** Creates an organization and its OWNER membership atomically (a single Firestore commit — either both documents are written or neither is). The creator always becomes OWNER; there is no way to create an org owned by someone else. */
export async function createOrganization(name: string, ownerUid: string, env: OrganizationsEnv): Promise<Organization | null> {
  const headers = await firestoreAdminAuthHeader(env)
  if (!headers) return null
  const orgId = `org_${crypto.randomUUID().replace(/-/g, '')}`
  const createdAt = new Date().toISOString()
  const base = firestoreResourcePath(env)

  const ok = await commitWrites([
    {
      update: {
        name: `${base}/organizations/${orgId}`,
        fields: {
          name: { stringValue: name },
          ownerId: { stringValue: ownerUid },
          plan: { stringValue: 'free' },
          createdAt: { stringValue: createdAt },
        },
      },
    },
    {
      update: {
        name: `${base}/organizations/${orgId}/members/${ownerUid}`,
        fields: {
          uid: { stringValue: ownerUid },
          role: { stringValue: 'OWNER' },
          addedAt: { stringValue: createdAt },
          addedBy: { stringValue: ownerUid },
        },
      },
    },
  ], headers, env)

  if (!ok) return null
  return { orgId, name, ownerId: ownerUid, plan: 'free', createdAt }
}

/** Reverse uid -> email lookup for a batch of uids, via the same admin Identity Toolkit access resolveUidByEmail uses. Best-effort: a uid that can't be resolved (e.g. deleted account) is simply absent from the result map, never throws. */
async function resolveEmailsByUid(uids: string[], env: OrganizationsEnv): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (uids.length === 0) return result
  const headers = await firestoreAdminAuthHeader(env)
  if (!headers) return result
  try {
    const res = await fetch(`${identityToolkitBaseUrl(env)}/accounts:lookup?key=${apiKeyQueryParam(env)}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId: uids }),
    })
    if (!res.ok) return result
    const data = await res.json() as { users?: Array<{ localId?: string; email?: string }> }
    for (const u of data.users ?? []) {
      if (u.localId && u.email) result.set(u.localId, u.email)
    }
  } catch { /* best-effort — leave result as-is */ }
  return result
}

export async function listMembers(orgId: string, env: OrganizationsEnv): Promise<Membership[]> {
  const headers = await firestoreAdminAuthHeader(env)
  if (!headers) return []
  const url = docPath(env, `organizations/${encodeURIComponent(orgId)}/members`)
  const res = await fetch(url, { headers })
  if (!res.ok) return []
  const data = await res.json() as { documents?: FirestoreDocResponse[] }
  const members = (data.documents ?? [])
    .map(d => {
      const role = str(d.fields?.role)
      const uid = str(d.fields?.uid)
      if (!uid || !role || !isValidRole(role)) return null
      return { uid, role, addedAt: str(d.fields?.addedAt) ?? '', addedBy: str(d.fields?.addedBy) ?? '' }
    })
    .filter((m): m is Membership => m !== null)

  const emails = await resolveEmailsByUid(members.map(m => m.uid), env)
  return members.map(m => ({ ...m, email: emails.get(m.uid) }))
}

/** Adds or overwrites a member's role. Caller (`actorUid`) must already hold `invite_members`, checked by requirePermission before this is called — this function itself does not re-check, so every call site MUST gate on requirePermission first. */
export async function upsertMember(orgId: string, targetUid: string, role: Role, actorUid: string, env: OrganizationsEnv): Promise<boolean> {
  const headers = await firestoreAdminAuthHeader(env)
  if (!headers) return false
  const url = docPath(env, `organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(targetUid)}`)
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        uid: { stringValue: targetUid },
        role: { stringValue: role },
        addedAt: { stringValue: new Date().toISOString() },
        addedBy: { stringValue: actorUid },
      },
    }),
  })
  return res.ok
}

export async function removeMember(orgId: string, targetUid: string, env: OrganizationsEnv): Promise<boolean> {
  const headers = await firestoreAdminAuthHeader(env)
  if (!headers) return false
  const url = docPath(env, `organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(targetUid)}`)
  const res = await fetch(url, { method: 'DELETE', headers })
  return res.ok
}

export interface MyOrganization {
  orgId: string
  role: Role
  name: string
}

/** Lists every organization a uid belongs to, via a collectionGroup query across every org's `members` subcollection filtered by the `uid` field (never by relying on the document ID alone, since collectionGroup queries need a real field to filter on). Powers the workspace switcher / "my organizations" list — never trusts a client-supplied org list. */
export async function listMyOrganizations(uid: string, env: OrganizationsEnv): Promise<MyOrganization[]> {
  const headers = await firestoreAdminAuthHeader(env)
  if (!headers) return []
  const url = `${firestoreBaseUrl(env)}:runQuery`
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'members', allDescendants: true }],
        where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: uid } } },
        limit: 100,
      },
    }),
  })
  if (!res.ok) return []
  const rows = await res.json() as Array<{ document?: { name?: string; fields?: Record<string, FirestoreValue> } }>

  // Build (orgId, role) pairs from the SAME row in one pass — deliberately not two independently
  // filtered arrays zipped by index afterward, which would silently desync (and mismatch a role
  // to the wrong org) the moment any single row failed one filter but not the other.
  const memberships: Array<{ orgId: string; role: Role }> = []
  for (const row of rows) {
    const name = row.document?.name
    const fields = row.document?.fields
    if (!name || !fields) continue
    const match = name.match(/\/organizations\/([^/]+)\/members\//) // .../documents/organizations/{orgId}/members/{uid}
    const orgId = match?.[1]
    const role = str(fields.role)
    if (!orgId || !role || !isValidRole(role)) continue
    memberships.push({ orgId, role })
  }

  const results: MyOrganization[] = []
  for (const { orgId, role } of memberships) {
    const orgRes = await fetch(docPath(env, `organizations/${encodeURIComponent(orgId)}`), { headers })
    if (!orgRes.ok) continue
    const orgData = await orgRes.json() as FirestoreDocResponse
    results.push({ orgId, role, name: str(orgData.fields?.name) ?? 'Untitled workspace' })
  }
  return results
}

/** Resolves an email to a Firebase Auth uid via the Identity Toolkit REST API — used so "invite a member" can accept an email address rather than requiring the inviter to already know a raw uid. Returns null if no account exists with that email (never reveals WHY beyond that — same response for "no such account" as for a lookup error). Targets the local Auth emulator automatically when FIREBASE_AUTH_EMULATOR_HOST is set. */
export async function resolveUidByEmail(email: string, env: OrganizationsEnv): Promise<string | null> {
  // accounts:lookup-by-email is an ADMIN Identity Toolkit operation — it requires a real OAuth
  // admin token (or the emulator's "owner" bypass), the same as Firestore admin access. The Web
  // API key alone (?key=...) is NOT sufficient here in production; using it silently 400s with
  // MISSING_ID_TOKEN, which is exactly the bug this comment is here to prevent reintroducing.
  const headers = await firestoreAdminAuthHeader(env)
  if (!headers) return null
  try {
    const res = await fetch(`${identityToolkitBaseUrl(env)}/accounts:lookup?key=${apiKeyQueryParam(env)}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: [email] }),
    })
    if (!res.ok) return null
    const data = await res.json() as { users?: Array<{ localId?: string }> }
    return data.users?.[0]?.localId ?? null
  } catch {
    return null
  }
}
