import { firestoreBaseUrl, firestoreAdminAuthHeader, type FirebaseServiceAccountEnv } from './firebaseAuth'
import { validateWebhookUrl } from './webhookSecurity'
import type { AuditAction } from './auditLog'

/**
 * Webhook Foundation — organization-configured outbound event delivery.
 *
 * Signing uses a PER-WEBHOOK secret, generated at creation and never reused across webhooks or
 * shared with the Agent Verify attestation signing key (attestationSigning.ts) — a compromised
 * webhook secret must never let anyone forge a signed attestation, and vice versa. The signature
 * scheme (`t=<timestamp>,v1=<hex hmac>`) deliberately mirrors this codebase's existing
 * verifyStripeSignature (billing.ts) for consistency — same shape, same HMAC-SHA256-over-
 * `${timestamp}.${body}` construction, so a team already integrating Stripe webhooks recognizes
 * the pattern immediately.
 *
 * DELIVERY: this module builds and can sign a delivery payload, but nothing in this codebase
 * calls the real `deliverWebhook()` against a genuine external endpoint — no outbound webhook
 * request has been sent as part of this work. Local testing exercises signing/verification and
 * the delivery-recording logic directly, with the network call itself mocked, never real egress.
 */

export type WebhookEventType = Extract<AuditAction, 'SCAN_COMPLETED' | 'VERIFICATION_PASSED' | 'VERIFICATION_FAILED' | 'ATTESTATION_ISSUED' | 'POLICY_APPLIED' | 'MEMBER_ADDED' | 'ROLE_CHANGED'>

export const WEBHOOK_EVENT_TYPES: WebhookEventType[] = [
  'SCAN_COMPLETED', 'VERIFICATION_PASSED', 'VERIFICATION_FAILED', 'ATTESTATION_ISSUED', 'POLICY_APPLIED', 'MEMBER_ADDED', 'ROLE_CHANGED',
]

export interface WebhookConfig {
  webhookId: string
  organizationId: string
  endpoint: string
  enabledEvents: WebhookEventType[]
  status: 'active' | 'disabled'
  createdAt: string
  createdBy: string
  lastDeliveryAt: string | null
  lastDeliveryStatus: 'success' | 'failed' | null
}

export interface WebhookDeliveryPayload {
  eventId: string
  eventType: WebhookEventType
  organizationId: string
  timestamp: string
  data: Record<string, unknown>
}

export type WebhooksEnv = FirebaseServiceAccountEnv

const textEncoder = new TextEncoder()
const toHex = (buffer: ArrayBuffer): string => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('')

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toHex(await crypto.subtle.sign('HMAC', key, textEncoder.encode(message)))
}

/** Same scheme as this codebase's existing verifyStripeSignature (billing.ts): `t=<unix-seconds>,v1=<hex hmac>` over `${timestamp}.${rawBody}`. */
export async function signWebhookPayload(payload: WebhookDeliveryPayload, secret: string): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const rawBody = JSON.stringify(payload)
  const digest = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`)
  return `t=${timestamp},v1=${digest}`
}

export type WebhookVerificationResult =
  | { status: 'VALID' }
  | { status: 'INVALID_SIGNATURE' }
  | { status: 'EXPIRED'; ageSeconds: number }
  | { status: 'MALFORMED' }

const parseSignatureHeader = (header: string): { timestamp: string; signatures: string[] } => {
  const parts = header.split(',').map(p => p.trim())
  return {
    timestamp: parts.find(p => p.startsWith('t='))?.slice(2) ?? '',
    signatures: parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3)),
  }
}

/**
 * The verification a webhook RECEIVER should run — included here as the reference
 * implementation/local test harness, since Agent Verify is the sender in this feature, not a
 * receiver. Enforces both HMAC validity and a replay window (default 5 minutes, matching the
 * project's existing MISSING_TIMESTAMP finding's own recommended window) so a captured, valid
 * delivery can't be replayed indefinitely.
 */
export async function verifyWebhookDelivery(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
  options: { toleranceSeconds?: number; now?: number } = {}
): Promise<WebhookVerificationResult> {
  const toleranceSeconds = options.toleranceSeconds ?? 300
  const now = options.now ?? Math.floor(Date.now() / 1000)

  if (!signatureHeader) return { status: 'MALFORMED' }
  const { timestamp, signatures } = parseSignatureHeader(signatureHeader)
  if (!timestamp || signatures.length === 0 || !/^\d+$/.test(timestamp)) return { status: 'MALFORMED' }

  const expectedDigest = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`)
  if (!signatures.includes(expectedDigest)) return { status: 'INVALID_SIGNATURE' }

  const ageSeconds = Math.abs(now - Number(timestamp))
  if (ageSeconds > toleranceSeconds) return { status: 'EXPIRED', ageSeconds }

  return { status: 'VALID' }
}

interface FirestoreValue { stringValue?: string; booleanValue?: boolean; nullValue?: null; arrayValue?: { values?: Array<{ stringValue?: string }> } }
interface FirestoreDocResponse { fields?: Record<string, FirestoreValue> }

const str = (v?: FirestoreValue): string | null => (typeof v?.stringValue === 'string' ? v.stringValue : null)
const strArray = (v?: FirestoreValue): string[] => (v?.arrayValue?.values ?? []).map(x => x.stringValue).filter((x): x is string => typeof x === 'string')

function docPath(env: WebhooksEnv, path: string): string {
  return `${firestoreBaseUrl(env)}/${path}`
}

function toWebhookConfig(orgId: string, webhookId: string, fields: Record<string, FirestoreValue>): WebhookConfig {
  return {
    webhookId,
    organizationId: orgId,
    endpoint: str(fields.endpoint) ?? '',
    enabledEvents: strArray(fields.enabledEvents) as WebhookEventType[],
    status: str(fields.status) === 'disabled' ? 'disabled' : 'active',
    createdAt: str(fields.createdAt) ?? '',
    createdBy: str(fields.createdBy) ?? '',
    lastDeliveryAt: str(fields.lastDeliveryAt),
    lastDeliveryStatus: str(fields.lastDeliveryStatus) === 'success' ? 'success' : str(fields.lastDeliveryStatus) === 'failed' ? 'failed' : null,
  }
}

/** Creates a webhook and its signing secret. The secret is returned ONCE here (to the creator, over the authenticated response) and then never again — same pattern as the API key UI's own "shown once" convention. Rejects the endpoint outright if it fails SSRF validation. */
export async function createWebhook(
  orgId: string,
  endpoint: string,
  enabledEvents: string[],
  actorUid: string,
  env: WebhooksEnv
): Promise<{ config: WebhookConfig; secret: string } | { error: string }> {
  const urlCheck = validateWebhookUrl(endpoint)
  if (!urlCheck.ok) return { error: `Invalid webhook URL: ${urlCheck.reason}` }

  const validEvents = enabledEvents.filter((e): e is WebhookEventType => (WEBHOOK_EVENT_TYPES as string[]).includes(e))
  if (validEvents.length === 0) return { error: 'At least one valid event type is required' }

  const headers = await firestoreAdminAuthHeader(env)
  if (!headers) return { error: 'Storage unavailable' }

  const webhookId = `wh_${crypto.randomUUID().replace(/-/g, '')}`
  const secret = `whsec_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`
  const createdAt = new Date().toISOString()

  const res = await fetch(docPath(env, `organizations/${encodeURIComponent(orgId)}/webhooks/${webhookId}`), {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        webhookId: { stringValue: webhookId },
        endpoint: { stringValue: endpoint },
        enabledEvents: { arrayValue: { values: validEvents.map(e => ({ stringValue: e })) } },
        status: { stringValue: 'active' },
        secret: { stringValue: secret },
        createdAt: { stringValue: createdAt },
        createdBy: { stringValue: actorUid },
        lastDeliveryAt: { nullValue: null },
        lastDeliveryStatus: { nullValue: null },
      },
    }),
  })
  if (!res.ok) return { error: 'Failed to create webhook' }

  return {
    config: { webhookId, organizationId: orgId, endpoint, enabledEvents: validEvents, status: 'active', createdAt, createdBy: actorUid, lastDeliveryAt: null, lastDeliveryStatus: null },
    secret,
  }
}

export async function listWebhooks(orgId: string, env: WebhooksEnv): Promise<WebhookConfig[]> {
  const headers = await firestoreAdminAuthHeader(env)
  if (!headers) return []
  const res = await fetch(docPath(env, `organizations/${encodeURIComponent(orgId)}/webhooks`), { headers })
  if (!res.ok) return []
  const data = await res.json() as { documents?: Array<{ name?: string; fields?: Record<string, FirestoreValue> }> }
  return (data.documents ?? [])
    .map(d => {
      const id = d.name?.split('/').pop()
      if (!id || !d.fields) return null
      return toWebhookConfig(orgId, id, d.fields)
    })
    .filter((w): w is WebhookConfig => w !== null)
}

export async function setWebhookStatus(orgId: string, webhookId: string, status: 'active' | 'disabled', env: WebhooksEnv): Promise<boolean> {
  const headers = await firestoreAdminAuthHeader(env)
  if (!headers) return false
  const getRes = await fetch(docPath(env, `organizations/${encodeURIComponent(orgId)}/webhooks/${encodeURIComponent(webhookId)}`), { headers })
  if (!getRes.ok) return false
  const existing = await getRes.json() as FirestoreDocResponse
  if (!existing.fields) return false
  const res = await fetch(`${docPath(env, `organizations/${encodeURIComponent(orgId)}/webhooks/${encodeURIComponent(webhookId)}`)}?updateMask.fieldPaths=status`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { status: { stringValue: status } } }),
  })
  return res.ok
}

/**
 * Builds and signs a delivery — does NOT send it. A real sender would POST `payload` as the body
 * with header `Agent-Verify-Signature: <signatureHeader>`. Left as a pure builder so callers
 * decide when/whether to actually perform the network call, and so this stays trivially testable
 * without ever needing to reach a real network.
 */
export async function buildWebhookDelivery(
  eventType: WebhookEventType,
  organizationId: string,
  data: Record<string, unknown>,
  secret: string
): Promise<{ payload: WebhookDeliveryPayload; signatureHeader: string }> {
  const payload: WebhookDeliveryPayload = {
    eventId: crypto.randomUUID(),
    eventType,
    organizationId,
    timestamp: new Date().toISOString(),
    data,
  }
  const signatureHeader = await signWebhookPayload(payload, secret)
  return { payload, signatureHeader }
}
