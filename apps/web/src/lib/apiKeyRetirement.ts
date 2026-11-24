/**
 * API keys made before this time are refused by the API (workers/api wrangler.toml
 * API_KEYS_ISSUED_AFTER — keep the two equal). On 2026-11-24 we found the key list could be read
 * by others, fixed the database rules, and retired every key made before the fix.
 */
export const API_KEYS_ISSUED_AFTER = '2026-11-24T18:17:00Z'

/** True when a key with this creation time was retired. A missing or unreadable time counts as retired. */
export function isRetiredApiKey(createdAt: unknown, cutoff: string = API_KEYS_ISSUED_AFTER): boolean {
  const cut = Date.parse(cutoff)
  if (Number.isNaN(cut)) return false
  const made = typeof createdAt === 'string' ? Date.parse(createdAt) : NaN
  return Number.isNaN(made) || made < cut
}
