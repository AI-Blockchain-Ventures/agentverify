/**
 * Bounded request-body reading for /v1/scan.
 *
 * The body is read as bytes with a hard ceiling BEFORE any JSON parsing or any per-field work, so an
 * oversized request costs at most the ceiling in memory and is refused before the expensive part. The
 * ceiling is set far above anything a legitimate request reaches (the largest legitimate content is
 * 5 MB and the largest package 5 MiB, even with JSON escaping overhead), so it never changes the
 * outcome of a request that was previously accepted or rejected for its own content limits.
 *
 * Decoding matches `request.json()` exactly (lenient UTF-8, byte-order mark stripped), so existing
 * requests parse identically. Strictness about malformed UTF-8 is applied separately, and only to
 * profile requests, via `isValidUtf8`.
 */

export const MAX_SCAN_REQUEST_BODY_BYTES = 32 * 1024 * 1024

export type BoundedBody = { ok: true; bytes: Uint8Array } | { ok: false; reason: 'too_large' }

export async function readBoundedBody(request: Request, maxBytes: number = MAX_SCAN_REQUEST_BODY_BYTES): Promise<BoundedBody> {
  const declared = request.headers.get('content-length')
  if (declared !== null) {
    const n = Number(declared)
    if (Number.isFinite(n) && n > maxBytes) return { ok: false, reason: 'too_large' }
  }
  if (!request.body) return { ok: true, bytes: new Uint8Array(0) }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      return { ok: false, reason: 'too_large' }
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return { ok: true, bytes }
}

/** Lenient decode, identical to what `request.json()` does before parsing. */
export function decodeBody(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

/** Strict check used only for profile requests: malformed UTF-8 is refused rather than silently repaired. */
export function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}
