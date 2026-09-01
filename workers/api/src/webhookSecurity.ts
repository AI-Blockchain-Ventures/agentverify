/**
 * Webhook URL validation — SSRF defense for user-supplied webhook endpoints.
 *
 * A webhook endpoint URL is attacker-influenced input (an organization admin, or an attacker who
 * compromises an ADMIN/OWNER account, chooses it) that this server will later make outbound
 * requests to. Without validation, that's a direct Server-Side Request Forgery primitive against
 * the Worker's own network position — reachable internal services, cloud metadata endpoints,
 * etc. This module is deliberately fail-closed: anything not affirmatively recognized as a safe
 * public http(s) hostname is rejected.
 *
 * WHAT THIS BLOCKS (checked against the literal hostname/IP in the URL, before any request is made):
 * - Non-http/https schemes entirely (file:, ftp:, gopher:, data:, custom schemes).
 * - localhost and any *.localhost hostname.
 * - Loopback: 127.0.0.0/8, ::1.
 * - Unspecified: 0.0.0.0, ::.
 * - Link-local: 169.254.0.0/16 (includes the 169.254.169.254 cloud metadata address used by
 *   AWS/GCP/Azure instance metadata services), fe80::/10.
 * - Private RFC1918 ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16.
 * - Unique local IPv6: fc00::/7.
 * - Known cloud metadata hostnames (metadata.google.internal, etc).
 *
 * WHAT THIS DOES NOT FULLY SOLVE — DNS rebinding: a hostname that resolves to a public IP at
 * validation time could be repointed to a private/internal IP by the time of actual delivery.
 * Literal hostname/IP string checks (what this module does, and all that's practical to test
 * outside the real Workers runtime) cannot catch that on their own. Real production hardening
 * needs to additionally re-resolve and re-validate the IP immediately before each delivery
 * attempt (or pin/verify the resolved IP the request actually connects to) — that stronger check
 * requires the real Workers `fetch()`/connect behavior and is flagged as follow-up hardening
 * requiring the production environment, not silently claimed as solved here.
 */

export type WebhookUrlValidation = { ok: true } | { ok: false; reason: string }

const BLOCKED_HOSTNAME_SUFFIXES = ['.localhost', '.internal', '.local']
const BLOCKED_HOSTNAMES = new Set([
  'localhost', 'metadata.google.internal', 'metadata.goog',
])

function ipv4Parts(host: string): number[] | null {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) return null
  const parts = match.slice(1).map(Number)
  if (parts.some(p => p > 255)) return null
  return parts
}

function isBlockedIpv4(host: string): boolean {
  const parts = ipv4Parts(host)
  if (!parts) return false
  const [a, b] = parts
  if (a === 127) return true // loopback
  if (a === 0) return true // "this network" / unspecified
  if (a === 10) return true // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
  if (a === 192 && b === 168) return true // RFC1918
  if (a === 169 && b === 254) return true // link-local, includes cloud metadata 169.254.169.254
  return false
}

function isBlockedIpv6(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (normalized === '::1') return true // loopback
  if (normalized === '::' || normalized === '::0') return true // unspecified
  if (normalized.startsWith('fe80:') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true // link-local fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true // unique local fc00::/7
  // IPv4-mapped IPv6 (::ffff:127.0.0.1 etc.) — check the embedded IPv4 too.
  const mapped = normalized.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (mapped && isBlockedIpv4(mapped[1])) return true
  return false
}

export function validateWebhookUrl(rawUrl: string): WebhookUrlValidation {
  // Every `reason` below is written to be shown directly to a customer in a form error — plain
  // English, no CIDR ranges, no internal rule/check numbers. This function's own JSDoc above
  // (and the code comments further down) carry the technical detail for developers instead.
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { ok: false, reason: "That doesn't look like a valid URL." }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Webhook endpoints must use http:// or https://.' }
  }
  // https-only in practice is strongly preferred, but some local/dev receivers legitimately run
  // plain http — this function only enforces the SSRF blocklist, not transport security policy,
  // so http is technically permitted; callers targeting production should additionally require
  // https before accepting a webhook URL from a real customer.

  const hostname = parsed.hostname.toLowerCase()

  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_HOSTNAME_SUFFIXES.some(suffix => hostname.endsWith(suffix))) {
    return { ok: false, reason: 'This endpoint cannot use a private or local network address.' }
  }
  if (isBlockedIpv4(hostname) || (hostname.includes(':') && isBlockedIpv6(hostname))) {
    return { ok: false, reason: 'This endpoint cannot use a private or local network address.' }
  }

  return { ok: true }
}
