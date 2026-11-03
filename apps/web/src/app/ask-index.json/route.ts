import { mcpSafety, RATING_COPY } from '@/lib/mcpSafety'
import { checkLibrary } from '@/lib/checkLibrary'

// A slim copy of the MCP directory for the Ask box, built with the site (static file, loaded only when Ask opens).
export const dynamic = 'force-static'

export function GET() {
  const servers = mcpSafety.servers.map(s => ({
    n: s.name,
    s: s.slug,
    r: RATING_COPY[s.rating].label,
    d: (s.description ?? '').slice(0, 160),
    c: s.capabilities.map(c => c.label),
    f: s.findings.length,
    w: s.weeklyDownloads,
  }))
  const checks = checkLibrary.checks.map(c => ({ s: c.slug, n: c.name, i: c.id, k: c.code.toLowerCase().replace(/_/g, ' '), v: c.severity, d: c.whatItDetects.slice(0, 220), r: c.remediation.slice(0, 220) }))
  return Response.json({ generatedAt: mcpSafety.generatedAt, servers, checks })
}
