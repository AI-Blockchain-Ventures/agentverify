import { firestoreBaseUrl, firestoreAdminAuthHeader, type FirebaseServiceAccountEnv } from './firebaseAuth'

/**
 * Audit Log — canonical, server-written event record for an organization.
 *
 * Every event is written here, by Worker code, using the service-account token — never by a
 * client directly (firestore.rules denies all client writes to
 * `organizations/{orgId}/auditEvents`, same defense-in-depth posture as organizations.ts).
 * A client cannot fabricate, backdate, or omit an audit event by controlling what it sends to
 * the API; the event is derived from what the server actually did, not from a client-asserted
 * claim, for every event type actually wired below.
 *
 * Coverage note: not every event type in AuditAction is wired to a real emission site yet.
 * API_KEY_CREATED/API_KEY_ROTATED and REPORT_SHARED/REPORT_REVOKED describe actions that
 * currently happen directly from the browser against Firestore (see apps/web APIAccess.tsx /
 * ReportView.tsx) with no Worker round-trip to hook an audit write into — wiring them requires
 * moving those mutations server-side first. AUTH_LOGIN is similarly unobservable here: Firebase
 * Auth sign-in happens entirely client-side and the Worker is never in that path. These types are
 * defined now so the schema doesn't need to change later, but are not emitted yet — grep this
 * file's own emission call sites for the current source of truth on what's actually live.
 */

export type AuditAction =
  | 'SCAN_STARTED'
  | 'SCAN_COMPLETED'
  | 'VERIFICATION_PASSED'
  | 'VERIFICATION_FAILED'
  | 'REPORT_SHARED'
  | 'REPORT_REVOKED'
  | 'API_KEY_CREATED'
  | 'API_KEY_ROTATED'
  | 'POLICY_APPLIED'
  | 'POLICY_CHANGED'
  | 'MEMBER_ADDED'
  | 'MEMBER_REMOVED'
  | 'ROLE_CHANGED'
  | 'ATTESTATION_ISSUED'
  | 'INTEGRATION_CHANGED'
  | 'WEBHOOK_CREATED'
  | 'WEBHOOK_DISABLED'
  | 'AUTH_LOGIN'

export interface AuditEvent {
  eventId: string
  organizationId: string
  actorId: string
  actorType: 'user' | 'api_key' | 'system'
  action: AuditAction
  targetType: string
  targetId: string
  timestamp: string
  /** Free-form but sanitized — see sanitizeMetadata(). Never a secret, never raw source. */
  metadata: Record<string, string | number | boolean | null>
}

export type AuditLogEnv = FirebaseServiceAccountEnv

const SECRET_KEY_PATTERN = /password|secret|private[-_]?key|api[-_]?key|authorization|token|credential/i

/**
 * Refuses to persist anything that looks like it could be a secret or raw source, rather than
 * trying to enumerate every possible secret shape — an allowlist-by-key-name-pattern policy
 * fails safe (drops the value) instead of failing open (logs it anyway).
 */
export function sanitizeMetadata(input: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(input)) {
    if (SECRET_KEY_PATTERN.test(key)) continue
    if (typeof value === 'string') {
      // Cap length defensively — metadata is for a short human-readable detail (e.g. a finding
      // title, a file name), never a place raw submitted source could end up even by accident.
      out[key] = value.length > 500 ? `${value.slice(0, 500)}…` : value
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[key] = value
    }
    // objects/arrays are silently dropped — metadata is flat by design, never a place for a full
    // findings array or similar to leak into the audit trail.
  }
  return out
}

/** Fire-and-log-only: an audit write failure must never block or fail the real action it's describing (e.g. a scan must still succeed even if the audit write fails) — callers should not await-and-throw on this. */
export async function recordAuditEvent(
  input: Omit<AuditEvent, 'eventId' | 'timestamp'>,
  env: AuditLogEnv
): Promise<void> {
  try {
    const headers = await firestoreAdminAuthHeader(env)
    if (!headers) return
    const eventId = crypto.randomUUID()
    const timestamp = new Date().toISOString()
    const metadata = sanitizeMetadata(input.metadata ?? {})
    const url = `${firestoreBaseUrl(env)}/organizations/${encodeURIComponent(input.organizationId)}/auditEvents/${eventId}`
    const metadataFields: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(metadata)) {
      metadataFields[key] = typeof value === 'string' ? { stringValue: value }
        : typeof value === 'number' ? { doubleValue: value }
        : typeof value === 'boolean' ? { booleanValue: value }
        : { nullValue: null }
    }
    await fetch(url, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          eventId: { stringValue: eventId },
          organizationId: { stringValue: input.organizationId },
          actorId: { stringValue: input.actorId },
          actorType: { stringValue: input.actorType },
          action: { stringValue: input.action },
          targetType: { stringValue: input.targetType },
          targetId: { stringValue: input.targetId },
          timestamp: { stringValue: timestamp },
          metadata: { mapValue: { fields: metadataFields } },
        },
      }),
    })
  } catch (e) {
    console.error('recordAuditEvent failed (non-fatal):', e instanceof Error ? e.message : e)
  }
}

interface FirestoreValue {
  stringValue?: string
  doubleValue?: number
  booleanValue?: boolean
  nullValue?: null
  mapValue?: { fields?: Record<string, FirestoreValue> }
}
interface FirestoreListResponse {
  documents?: Array<{ fields?: Record<string, FirestoreValue> }>
}

function fromFirestoreValue(v?: FirestoreValue): string | number | boolean | null {
  if (!v) return null
  if (typeof v.stringValue === 'string') return v.stringValue
  if (typeof v.doubleValue === 'number') return v.doubleValue
  if (typeof v.booleanValue === 'boolean') return v.booleanValue
  return null
}

export async function listAuditEvents(organizationId: string, env: AuditLogEnv, limit = 100): Promise<AuditEvent[]> {
  const headers = await firestoreAdminAuthHeader(env)
  if (!headers) return []
  const url = `${firestoreBaseUrl(env)}/organizations/${encodeURIComponent(organizationId)}/auditEvents?pageSize=${limit}`
  const res = await fetch(url, { headers })
  if (!res.ok) return []
  const data = await res.json() as FirestoreListResponse
  const events = (data.documents ?? []).map(doc => {
    const f = doc.fields ?? {}
    const metadata: Record<string, string | number | boolean | null> = {}
    for (const [key, value] of Object.entries(f.metadata?.mapValue?.fields ?? {})) {
      metadata[key] = fromFirestoreValue(value)
    }
    return {
      eventId: String(fromFirestoreValue(f.eventId) ?? ''),
      organizationId: String(fromFirestoreValue(f.organizationId) ?? ''),
      actorId: String(fromFirestoreValue(f.actorId) ?? ''),
      actorType: (fromFirestoreValue(f.actorType) as AuditEvent['actorType']) ?? 'system',
      action: (fromFirestoreValue(f.action) as AuditAction) ?? 'SCAN_STARTED',
      targetType: String(fromFirestoreValue(f.targetType) ?? ''),
      targetId: String(fromFirestoreValue(f.targetId) ?? ''),
      timestamp: String(fromFirestoreValue(f.timestamp) ?? ''),
      metadata,
    } satisfies AuditEvent
  })
  return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}
