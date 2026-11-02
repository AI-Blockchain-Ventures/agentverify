import data from '@/data/checkLibrary.json'

export type CheckSeverity = 'critical' | 'high' | 'medium' | 'low'

export interface LibraryCheck {
  id: string
  slug: string
  code: string
  name: string
  category: string
  severity: CheckSeverity
  pack: string
  addedIn: string
  family: boolean
  detectionType: string
  evidenceType: string
  supportedContent: string
  whatItDetects: string
  whyItMatters: string
  remediation: string
  impact?: string
  compliance?: { owasp?: string[]; nist?: string[]; soc2?: string[] }
}

export const checkLibrary = data as { generatedAt: string; scannerVersion: string; total: number; checks: LibraryCheck[] }

export const CATEGORY_LABELS: Record<string, string> = {
  'execution-authorization': 'Execution authorization',
  identity: 'Identity',
  permissions: 'Permissions',
  tools: 'Tools',
  mcp: 'MCP',
  secrets: 'Secrets & data exposure',
  runtime: 'Runtime safety',
  network: 'Network',
  dependencies: 'Supply chain',
  auditability: 'Audit & logging',
  'human-oversight': 'Human oversight',
}

export const CATEGORY_ORDER = ['mcp', 'runtime', 'secrets', 'permissions', 'human-oversight', 'tools', 'network', 'identity', 'dependencies', 'auditability', 'execution-authorization']

export const SEVERITY_ORDER: Record<CheckSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 }

export const SEVERITY_STYLE: Record<CheckSeverity, { label: string; color: string; bg: string }> = {
  critical: { label: 'Critical', color: 'var(--accent-red-text)', bg: 'rgba(217,45,32,0.10)' },
  high: { label: 'High', color: 'var(--accent-orange-text)', bg: 'rgba(247,144,9,0.12)' },
  medium: { label: 'Medium', color: 'var(--text-primary)', bg: 'rgba(253,176,34,0.16)' },
  low: { label: 'Low', color: 'var(--text-secondary)', bg: 'var(--surface)' },
}

export const PACK_LABELS: Record<string, string> = { core: 'Core', framework: 'Framework', mcp: 'MCP config' }

export function getCheck(slug: string): LibraryCheck | undefined {
  return checkLibrary.checks.find(c => c.slug === slug)
}

/**
 * The help-page slug for a finding code from a scan report. Exact codes first; per-type secret
 * and MCP-tool codes fall back to their family's page when there is one.
 */
export function checkSlugForCode(code: string): string | null {
  const exact = checkLibrary.checks.find(c => c.code === code)
  if (exact) return exact.slug
  const family = checkLibrary.checks.find(c => c.family && code.startsWith(c.code))
  return family ? family.slug : null
}
