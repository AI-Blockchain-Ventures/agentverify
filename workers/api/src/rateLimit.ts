/**
 * Best-effort, in-memory, per-isolate rate limiter for the unauthenticated public demo route and
 * the lightly-scoped fix-verification route.
 *
 * HONEST LIMITATION: this is NOT a substitute for a real Cloudflare Rate Limiting rule bound to
 * the route at the account/dashboard level — Workers isolates are not a single shared process, so
 * a determined attacker distributing requests across many colos/isolates can exceed this. It DOES
 * stop the common case (a script hammering the route from one connection/isolate) and bounds
 * worst-case per-isolate memory. The real production requirement — configuring Cloudflare Rate
 * Limiting for `/v1/demo/scan` and `/v1/verify-fix` — cannot be done from code and is documented
 * as a REQUIRES PRODUCTION ACCESS item.
 */

const buckets = new Map<string, number[]>()
const MAX_TRACKED_KEYS = 5000 // bounds memory if abused from many distinct keys/IPs

export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const windowStart = now - windowMs
  let hits = buckets.get(key)
  if (!hits) {
    if (buckets.size >= MAX_TRACKED_KEYS) {
      const oldestKey = buckets.keys().next().value
      if (oldestKey !== undefined) buckets.delete(oldestKey)
    }
    hits = []
  }
  const recent = hits.filter(t => t > windowStart)
  recent.push(now)
  buckets.set(key, recent)
  return recent.length > limit
}

/** Best-effort caller identity for rate-limit keying — Cloudflare sets CF-Connecting-IP in
 * production; falls back to the first X-Forwarded-For hop, then a constant (fails open to "one
 * shared bucket" locally rather than crashing, never fails closed on a missing header). */
export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP')
    ?? request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    ?? 'unknown'
}
