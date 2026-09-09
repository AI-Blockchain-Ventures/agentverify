import { validateWebhookUrl } from './webhookSecurity'
import { listActiveWebhooksForEvent, getWebhookForDelivery, buildWebhookDelivery, type WebhookEventType, type WebhooksEnv } from './webhooks'
import type { D1Database } from './billing'

/**
 * Webhook Delivery — the piece webhooks.ts's own top comment (as of 2026-09-02) explicitly said
 * did not exist yet: "nothing in this codebase calls the real deliverWebhook() against a genuine
 * external endpoint." This module is that missing piece — real, signed, outbound HTTP delivery
 * with durable retry state, wired to the actual event-emission sites in worker.ts (never a
 * simulated/fake send).
 *
 * State lives in D1 (BILLING_DB — the one D1 instance already provisioned; see schema/webhooks.sql),
 * because a Cloudflare Worker has no persistent memory between requests, and delivery needs to
 * survive across the gap between "an event happened" and "a scheduled sweep gets around to
 * attempting/retrying it." Webhook CONFIGURATION (endpoint, secret, enabled events) still lives in
 * Firestore — this module only owns the state of individual delivery ATTEMPTS.
 *
 * Flow:
 *   1. enqueueWebhookDeliveries() — called from worker.ts right where each real event already
 *      fires (recordAuditEvent's call sites). Fans out to every ACTIVE webhook subscribed to that
 *      event type in the org, inserting one 'pending' row per webhook.
 *   2. runDueDeliveries() — called from the Worker's scheduled() handler (a Cron Trigger; see
 *      wrangler.toml) on a short interval. Attempts every row whose next_attempt_at has arrived.
 *   3. attemptDelivery() — the actual signed POST, with a real timeout, real backoff on failure,
 *      and a hard cap after which a delivery becomes 'dead_letter' (retried only manually).
 */

export type WebhooksDeliveryEnv = WebhooksEnv & { BILLING_DB?: D1Database }

export type DeliveryStatus = 'pending' | 'delivered' | 'dead_letter'

export interface DeliveryRow {
  delivery_id: string
  webhook_id: string
  organization_id: string
  event_id: string
  event_type: string
  endpoint: string
  payload_json: string
  signature_header: string
  status: DeliveryStatus
  attempt_count: number
  max_attempts: number
  next_attempt_at: number
  last_http_status: number | null
  last_response_snippet: string | null
  last_error: string | null
  created_at: number
  last_attempted_at: number | null
  delivered_at: number | null
}

// Exponential backoff after each failed attempt: 1m, 5m, 30m, 2h, 12h. A delivery gets 1 initial
// attempt + up to 5 retries (MAX_ATTEMPTS = 6) before becoming a dead letter.
const BACKOFF_SECONDS = [60, 300, 1800, 7200, 43200]
const MAX_ATTEMPTS = 6
const DELIVERY_TIMEOUT_MS = 10_000
const RESPONSE_SNIPPET_MAX_CHARS = 500

const nowSeconds = (): number => Math.floor(Date.now() / 1000)

function backoffSecondsFor(attemptNumber: number): number {
  return BACKOFF_SECONDS[Math.min(attemptNumber - 1, BACKOFF_SECONDS.length - 1)]
}

/**
 * Fans an event out to every active, subscribed webhook in the org — one durable 'pending' row
 * per webhook, due for its first attempt immediately. Call this at the exact place the event
 * actually happens (alongside recordAuditEvent for the same action), never speculatively.
 * Best-effort: a failure here (D1 unavailable, Firestore read failure) never blocks or fails the
 * request that triggered the event — webhook delivery is additive, not a dependency of core
 * product functionality.
 */
export async function enqueueWebhookDeliveries(
  organizationId: string,
  eventType: WebhookEventType,
  data: Record<string, unknown>,
  env: WebhooksDeliveryEnv
): Promise<void> {
  if (!env.BILLING_DB) return
  try {
    const webhooks = await listActiveWebhooksForEvent(organizationId, eventType, env)
    if (webhooks.length === 0) return
    const now = nowSeconds()
    for (const webhook of webhooks) {
      const { payload, signatureHeader } = await buildWebhookDelivery(eventType, organizationId, data, webhook.secret)
      const deliveryId = `whd_${crypto.randomUUID().replace(/-/g, '')}`
      await env.BILLING_DB.prepare(`
        INSERT INTO webhook_deliveries
          (delivery_id, webhook_id, organization_id, event_id, event_type, endpoint, payload_json, signature_header,
           status, attempt_count, max_attempts, next_attempt_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
      `).bind(
        deliveryId, webhook.webhookId, organizationId, payload.eventId, eventType, webhook.endpoint,
        JSON.stringify(payload), signatureHeader, MAX_ATTEMPTS, now, now
      ).run()
    }
  } catch (e) {
    console.error('enqueueWebhookDeliveries failed (non-fatal):', e instanceof Error ? e.message : e)
  }
}

/** Truncates a response body to a bounded snippet — never store an unbounded external response. */
function snippet(text: string): string {
  return text.length > RESPONSE_SNIPPET_MAX_CHARS ? text.slice(0, RESPONSE_SNIPPET_MAX_CHARS) + '…' : text
}

/**
 * One real attempt: re-validates the endpoint against the SSRF blocklist (defense-in-depth — the
 * URL was already validated at webhook-creation time, but re-checking immediately before every
 * outbound call is the cheap, correct habit even though nothing currently lets an endpoint be
 * edited after creation), then performs the actual signed POST with a hard timeout. Always updates
 * the row's durable state — success, a scheduled retry, or a terminal dead_letter — so the row
 * itself is always the source of truth for what happened, never just the return value here.
 */
export async function attemptDelivery(
  row: DeliveryRow,
  env: WebhooksDeliveryEnv,
  timeoutMs = DELIVERY_TIMEOUT_MS,
  // Overridable ONLY so tests can exercise real delivery against a real local receiver, whose
  // 127.0.0.1 address the real validateWebhookUrl correctly rejects as loopback — production code
  // never passes this, so the real SSRF check is always what actually gates a real delivery.
  urlValidator: typeof validateWebhookUrl = validateWebhookUrl
): Promise<DeliveryStatus> {
  if (!env.BILLING_DB) return row.status
  const urlCheck = urlValidator(row.endpoint)
  if (!urlCheck.ok) {
    return finalizeFailure(row, env, { httpStatus: null, error: `Endpoint rejected at delivery time: ${urlCheck.reason}` })
  }

  try {
    const res = await fetch(row.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Agent-Verify-Signature': row.signature_header },
      body: row.payload_json,
      signal: AbortSignal.timeout(timeoutMs),
    })
    const bodyText = await res.text().catch(() => '')
    if (res.ok) {
      await env.BILLING_DB.prepare(`
        UPDATE webhook_deliveries SET status = 'delivered', attempt_count = attempt_count + 1,
          last_http_status = ?, last_response_snippet = ?, last_error = NULL,
          last_attempted_at = ?, delivered_at = ?
        WHERE delivery_id = ?
      `).bind(res.status, snippet(bodyText), nowSeconds(), nowSeconds(), row.delivery_id).run()
      return 'delivered'
    }
    return finalizeFailure(row, env, { httpStatus: res.status, responseSnippet: snippet(bodyText), error: `HTTP ${res.status}` })
  } catch (e) {
    const message = e instanceof Error ? (e.name === 'TimeoutError' || e.name === 'AbortError' ? 'Request timed out' : e.message) : 'Unknown delivery error'
    return finalizeFailure(row, env, { httpStatus: null, error: message })
  }
}

async function finalizeFailure(
  row: DeliveryRow,
  env: WebhooksDeliveryEnv,
  outcome: { httpStatus: number | null; responseSnippet?: string; error: string }
): Promise<DeliveryStatus> {
  if (!env.BILLING_DB) return row.status
  const attemptNumber = row.attempt_count + 1
  const now = nowSeconds()
  if (attemptNumber >= row.max_attempts) {
    await env.BILLING_DB.prepare(`
      UPDATE webhook_deliveries SET status = 'dead_letter', attempt_count = ?,
        last_http_status = ?, last_response_snippet = ?, last_error = ?, last_attempted_at = ?
      WHERE delivery_id = ?
    `).bind(attemptNumber, outcome.httpStatus, outcome.responseSnippet ?? null, outcome.error, now, row.delivery_id).run()
    return 'dead_letter'
  }
  const nextAttemptAt = now + backoffSecondsFor(attemptNumber)
  await env.BILLING_DB.prepare(`
    UPDATE webhook_deliveries SET status = 'pending', attempt_count = ?, next_attempt_at = ?,
      last_http_status = ?, last_response_snippet = ?, last_error = ?, last_attempted_at = ?
    WHERE delivery_id = ?
  `).bind(attemptNumber, nextAttemptAt, outcome.httpStatus, outcome.responseSnippet ?? null, outcome.error, now, row.delivery_id).run()
  return 'pending'
}

/**
 * The scheduled sweep — called from the Worker's scheduled() handler. Picks up every delivery
 * whose next_attempt_at has arrived and attempts it, but re-checks the webhook is still 'active'
 * in Firestore FIRST: disabling a webhook must stop its in-flight retries immediately, not just
 * block new deliveries from being enqueued. A disabled/deleted webhook's due deliveries are marked
 * dead_letter without ever making the outbound call.
 */
export async function runDueDeliveries(
  env: WebhooksDeliveryEnv,
  limit = 25,
  timeoutMs = DELIVERY_TIMEOUT_MS,
  urlValidator: typeof validateWebhookUrl = validateWebhookUrl
): Promise<{ attempted: number; delivered: number; deadLettered: number; skippedDisabled: number }> {
  const result = { attempted: 0, delivered: 0, deadLettered: 0, skippedDisabled: 0 }
  if (!env.BILLING_DB) return result
  const due = await env.BILLING_DB.prepare(`
    SELECT * FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at ASC LIMIT ?
  `).bind(nowSeconds(), limit).all<DeliveryRow>()

  for (const row of due.results ?? []) {
    const webhook = await getWebhookForDelivery(row.organization_id, row.webhook_id, env)
    if (!webhook || webhook.status !== 'active') {
      await env.BILLING_DB.prepare(`
        UPDATE webhook_deliveries SET status = 'dead_letter', last_error = 'Webhook disabled or removed before delivery', last_attempted_at = ? WHERE delivery_id = ?
      `).bind(nowSeconds(), row.delivery_id).run()
      result.skippedDisabled += 1
      continue
    }
    result.attempted += 1
    const outcome = await attemptDelivery(row, env, timeoutMs, urlValidator)
    if (outcome === 'delivered') result.delivered += 1
    else if (outcome === 'dead_letter') result.deadLettered += 1
  }
  return result
}

export interface DeliveryHistoryEntry {
  deliveryId: string
  eventType: string
  status: DeliveryStatus
  attemptCount: number
  maxAttempts: number
  nextAttemptAt: string | null
  lastHttpStatus: number | null
  lastResponseSnippet: string | null
  lastError: string | null
  createdAt: string
  lastAttemptedAt: string | null
  deliveredAt: string | null
}

const toIso = (unixSeconds: number | null): string | null => (unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null)

/** Delivery history for one webhook — never includes the payload or signing secret, just attempt/outcome metadata for the UI. */
export async function listDeliveries(webhookId: string, env: WebhooksDeliveryEnv, limit = 50): Promise<DeliveryHistoryEntry[]> {
  if (!env.BILLING_DB) return []
  const rows = await env.BILLING_DB.prepare(`
    SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?
  `).bind(webhookId, limit).all<DeliveryRow>()
  return (rows.results ?? []).map(r => ({
    deliveryId: r.delivery_id,
    eventType: r.event_type,
    status: r.status,
    attemptCount: r.attempt_count,
    maxAttempts: r.max_attempts,
    nextAttemptAt: r.status === 'pending' ? toIso(r.next_attempt_at) : null,
    lastHttpStatus: r.last_http_status,
    lastResponseSnippet: r.last_response_snippet,
    lastError: r.last_error,
    createdAt: toIso(r.created_at)!,
    lastAttemptedAt: toIso(r.last_attempted_at),
    deliveredAt: toIso(r.delivered_at),
  }))
}

/**
 * Manual retry — the operator's explicit decision to give a dead-lettered delivery a fresh full
 * attempt cycle (resets attempt_count to 0, not just "one more try"), due immediately. Only valid
 * for a delivery that's actually dead_letter; retrying a 'pending' (already scheduled) or
 * 'delivered' (already succeeded) delivery would be meaningless, so those are rejected.
 */
export async function retryDelivery(webhookId: string, deliveryId: string, env: WebhooksDeliveryEnv): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!env.BILLING_DB) return { ok: false, error: 'Delivery storage is not configured' }
  const row = await env.BILLING_DB.prepare('SELECT * FROM webhook_deliveries WHERE delivery_id = ? AND webhook_id = ?').bind(deliveryId, webhookId).first<DeliveryRow>()
  if (!row) return { ok: false, error: 'Delivery not found' }
  if (row.status !== 'dead_letter') return { ok: false, error: `Only a dead-lettered delivery can be manually retried (this one is ${row.status})` }
  await env.BILLING_DB.prepare(`
    UPDATE webhook_deliveries SET status = 'pending', attempt_count = 0, next_attempt_at = ?, last_error = NULL WHERE delivery_id = ?
  `).bind(nowSeconds(), deliveryId).run()
  return { ok: true }
}
