import data from '@/data/mcpSafety.json'

export type McpRating = 'lower' | 'review' | 'higher'

export interface McpServerEntry {
  slug: string
  name: string
  version: string
  description: string
  repository: string | null
  homepage: string | null
  license: string | null
  publishedAt: string | null
  capabilities: Array<{ id: string; label: string; risk: number }>
  tools: string[]
  findings: Array<{ code: string; title: string; severity: 'critical' | 'high' | 'medium' | 'low'; whatIsWrong: string; file: string | null; line: number | null }>
  counts: Record<'critical' | 'high' | 'medium' | 'low', number>
  rating: McpRating
  reasons: string[]
  filesScanned: number
  weeklyDownloads: number
}

export interface McpSafetyData {
  generatedAt: string
  scannerVersion: string
  count: number
  servers: McpServerEntry[]
}

export const mcpSafety = data as unknown as McpSafetyData

export function getMcpServer(slug: string): McpServerEntry | undefined {
  return mcpSafety.servers.find(s => s.slug === slug)
}

export const RATING_COPY: Record<McpRating, { label: string; short: string; color: string; bg: string; explain: string }> = {
  lower: {
    label: 'Limited access',
    short: 'Limited',
    color: 'var(--accent-green-text)',
    bg: 'rgba(0,179,126,0.12)',
    explain: 'If an AI agent using this server were tricked, the damage it could do through this server is limited.',
  },
  review: {
    label: 'Review before use',
    short: 'Review',
    color: 'var(--accent-orange-text)',
    bg: 'rgba(245,158,11,0.12)',
    explain: 'This server can change things — files, a browser, a database, or paid online services. Limit what it can reach.',
  },
  higher: {
    label: 'Broad access',
    short: 'Broad',
    color: 'var(--accent-red-text)',
    bg: 'rgba(224,62,62,0.12)',
    explain: 'This server can run commands on your computer. An agent that is tricked could use it to do almost anything you can.',
  },
}

/** Practical advice per capability, shown on each server page. */
export const CAPABILITY_ADVICE: Record<string, string> = {
  shell: 'Run it in a container or VM, and keep "approve each tool call" turned on.',
  spawn: 'It starts another program (often a browser for sign-in, or a bundled binary). Install it only from the official package.',
  'fs-write': 'Point it at one project folder, never your home directory or a whole drive.',
  'fs-read': 'Only give it the folders it needs; files it reads can end up in the AI’s context.',
  browser: 'Use a separate browser profile without your logged-in accounts.',
  network: 'Content it fetches from the internet can carry prompt-injection instructions.',
  database: 'Give it a read-only database user unless writes are required.',
  secrets: 'Use a key with the smallest permissions available, and never paste a production key into a shared config.',
}

/** Neutral badge for maintainers' READMEs: says the server has a public safety page, in the brand colour. */
export const REVIEWED_BADGE_URL = 'https://img.shields.io/badge/MCP%20safety-reviewed%20by%20Agent%20Verify-7C3AED'

export function badgeUrl(entry: McpServerEntry): string {
  const color = entry.rating === 'lower' ? 'brightgreen' : entry.rating === 'review' ? 'orange' : 'red'
  return `https://img.shields.io/badge/Agent%20Verify-${encodeURIComponent(RATING_COPY[entry.rating].label).replace(/-/g, '--')}-${color}`
}

// ── Categories, comparisons, and new servers ──

export const CATEGORY_LABELS: Record<string, string> = {
  browser: 'Browser & web scraping',
  files: 'Files & desktop',
  'code-hosting': 'GitHub & code hosting',
  database: 'Databases',
  search: 'Web search',
  'docs-memory': 'Docs, notes & memory',
  'cloud-devops': 'Cloud & DevOps',
  productivity: 'Work apps',
  other: 'Other',
}

export function categoryOf(s: McpServerEntry): string {
  return (s as McpServerEntry & { category?: string }).category ?? 'other'
}

export interface McpComparison { slug: string; a: McpServerEntry; b: McpServerEntry; category: string }

/** The most-downloaded servers in each category, compared two at a time (factual, side by side). */
export function mcpComparisons(perCategory = 4): McpComparison[] {
  const out: McpComparison[] = []
  for (const category of Object.keys(CATEGORY_LABELS)) {
    if (category === 'other') continue
    const top = mcpSafety.servers.filter(s => categoryOf(s) === category).sort((x, y) => y.weeklyDownloads - x.weeklyDownloads).slice(0, perCategory)
    for (let i = 0; i < top.length; i++) {
      for (let j = i + 1; j < top.length; j++) out.push({ slug: `${top[i].slug}-vs-${top[j].slug}`, a: top[i], b: top[j], category })
    }
  }
  return out
}

export function getComparison(slug: string): McpComparison | undefined {
  return mcpComparisons().find(c => c.slug === slug)
}

/** Servers first published in the 45 days before the data was built, newest first. */
export function newMcpServers(days = 45): McpServerEntry[] {
  const cutoff = new Date(mcpSafety.generatedAt).getTime() - days * 86400_000
  return mcpSafety.servers
    .filter(s => {
      const first = (s as McpServerEntry & { firstPublishedAt?: string | null }).firstPublishedAt
      return first ? new Date(first).getTime() >= cutoff : false
    })
    .sort((a, b) => new Date((b as McpServerEntry & { firstPublishedAt?: string }).firstPublishedAt ?? 0).getTime() - new Date((a as McpServerEntry & { firstPublishedAt?: string }).firstPublishedAt ?? 0).getTime())
}

const RATING_ORDER: Record<McpRating, number> = { lower: 0, review: 1, higher: 2 }
export function compareReach(a: McpServerEntry, b: McpServerEntry): string {
  if (RATING_ORDER[a.rating] === RATING_ORDER[b.rating]) {
    return `${a.name} and ${b.name} have the same access level (${RATING_COPY[a.rating].label.toLowerCase()}). Choose on features, and apply the same safety steps to either.`
  }
  const [wide, narrow] = RATING_ORDER[a.rating] > RATING_ORDER[b.rating] ? [a, b] : [b, a]
  return `${wide.name} has broader access than ${narrow.name} — ${wide.reasons.join('; ')}. If ${narrow.name} does what you need, it gives an AI agent less to misuse.`
}
