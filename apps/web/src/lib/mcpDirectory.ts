import type { McpRating, McpServerEntry } from './mcpSafety'

/** What one card needs. Kept small on purpose: all 500+ servers are sent to the browser for search. */
export interface McpDirectoryItem { slug: string; name: string; description: string; rating: McpRating; caps: string[] } // capability ids; labels come once from capabilityLabels()

export function toDirectoryItem(s: McpServerEntry): McpDirectoryItem {
  const d = s.description ?? ''
  // The card shows two lines, so a short description is all that's needed (search still matches its start).
  return { slug: s.slug, name: s.name, description: d.length > 120 ? `${d.slice(0, 117).trimEnd()}…` : d, rating: s.rating, caps: s.capabilities.map(c => c.id) }
}


/** Capability id → label, sent once instead of repeating each label on every server. */
export function capabilityLabels(servers: McpServerEntry[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const s of servers) for (const c of s.capabilities) out[c.id] = c.label
  return out
}
