/**
 * Public demo scans: repeat scans of the same code reuse the saved result.
 *
 * The Live Demo and the homepage examples send the same fixed code every time. Saving those
 * results means they cost no scanner time and never use up a visitor's demo allowance, so a
 * reviewer clicking around can't "break" the demo. New code still goes through the per-network
 * limit (DEMO_SCANS_PER_HOUR).
 *
 * Two layers: a small in-memory map (per Worker isolate, instant) and the Cloudflare edge cache
 * (shared within a data center). Both are best-effort; a miss just runs a normal scan.
 */

export const DEMO_SCANS_PER_HOUR = 20
const MEMORY_MAX = 200
const TTL_SECONDS = 6 * 60 * 60

const memory = new Map<string, { at: number; body: string }>()

export async function demoCacheKey(content: string, fileName: string, platform: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([content, fileName, platform]))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// Never a real host: only used as the edge-cache key.
const cacheUrl = (key: string) => `https://demo-cache.agentverify.invalid/${key}`

type EdgeCache = { match(req: string): Promise<Response | undefined>; put(req: string, res: Response): Promise<void> }
function edgeCache(): EdgeCache | null {
  const c = (globalThis as { caches?: { default?: EdgeCache } }).caches
  return c?.default ?? null
}

/** Saved JSON for this exact demo input, or null. */
export async function readDemoCache(key: string, now = Date.now()): Promise<string | null> {
  const hit = memory.get(key)
  if (hit && now - hit.at < TTL_SECONDS * 1000) return hit.body
  if (hit) memory.delete(key)
  try {
    const res = await edgeCache()?.match(cacheUrl(key))
    if (res && res.ok) {
      const body = await res.text()
      remember(key, body, now)
      return body
    }
  } catch { /* cache unavailable: run a normal scan */ }
  return null
}

export async function writeDemoCache(key: string, body: string, now = Date.now()): Promise<void> {
  remember(key, body, now)
  try {
    await edgeCache()?.put(cacheUrl(key), new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${TTL_SECONDS}` } }))
  } catch { /* best-effort */ }
}

function remember(key: string, body: string, now: number) {
  if (memory.size >= MEMORY_MAX && !memory.has(key)) {
    const oldest = memory.keys().next().value
    if (oldest !== undefined) memory.delete(oldest)
  }
  memory.set(key, { at: now, body })
}

/** Test helper. */
export function clearDemoMemoryCache() { memory.clear() }
