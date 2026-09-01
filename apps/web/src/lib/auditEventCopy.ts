import type { AuditEvent } from './orgApi'

/**
 * Turns a raw audit event into a plain-English sentence — "Jonathan changed Sarah's role from
 * MEMBER to ADMIN," not "ROLE_CHANGED". The technical action/target/metadata stay available in
 * the event object itself for an expandable details view; this only produces the headline.
 *
 * `actorLabel`/`targetLabel` are resolved by the caller (usually an email, falling back to a
 * shortened uid) since this module has no access to the member directory itself — keeps this a
 * pure, easily-testable formatting function.
 */
export function describeAuditEvent(event: AuditEvent, actorLabel: string, targetLabel?: string): string {
  const target = targetLabel ?? shortenId(event.targetId)
  switch (event.action) {
    case 'SCAN_COMPLETED':
      return `${target} completed a scan${event.metadata.verdict ? ` — ${event.metadata.verdict}` : ''}${typeof event.metadata.score === 'number' ? ` (score ${event.metadata.score}/100)` : ''}.`
    case 'VERIFICATION_PASSED':
      return `${target} passed verification.`
    case 'VERIFICATION_FAILED':
      return `${target} failed verification.`
    case 'REPORT_SHARED':
      return `${actorLabel} shared a report publicly.`
    case 'REPORT_REVOKED':
      return `${actorLabel} revoked public access to a report.`
    case 'API_KEY_CREATED':
      return `${actorLabel} created an API key.`
    case 'API_KEY_ROTATED':
      return `${actorLabel} rotated an API key.`
    case 'POLICY_APPLIED':
      return `${target} was evaluated against the ${event.metadata.policyProfile ?? 'policy'} — ${event.metadata.policyResult ?? 'result unknown'}.`
    case 'POLICY_CHANGED':
      return `${actorLabel} changed a policy.`
    case 'MEMBER_ADDED':
      return `${actorLabel} added ${target} as ${event.metadata.role ?? 'a member'}.`
    case 'MEMBER_REMOVED':
      return `${actorLabel} removed ${target} from the workspace.`
    case 'ROLE_CHANGED':
      return `${actorLabel} changed ${target}'s role${event.metadata.previousRole ? ` from ${event.metadata.previousRole}` : ''} to ${event.metadata.newRole ?? 'a new role'}.`
    case 'ATTESTATION_ISSUED':
      return `A verification attestation was issued for ${target}.`
    case 'INTEGRATION_CHANGED':
      return `${actorLabel} changed an integration.`
    case 'WEBHOOK_CREATED':
      return `${actorLabel} created a webhook${event.metadata.endpoint ? ` (${event.metadata.endpoint})` : ''}.`
    case 'WEBHOOK_DISABLED':
      return `${actorLabel} disabled a webhook.`
    case 'AUTH_LOGIN':
      return `${actorLabel} signed in.`
    default:
      return `${actorLabel} performed ${event.action} on ${target}.`
  }
}

function shortenId(id: string): string {
  if (!id) return 'an item'
  return id.length > 12 ? `${id.slice(0, 10)}…` : id
}
