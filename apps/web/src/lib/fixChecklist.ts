import type { Finding } from '@/types'

/** Shape of the normalized report's fix plan (see normalizeReport.ts). */
export interface ChecklistItem { title: string; severity: string; priority: string; reason?: string }

/**
 * Builds a Markdown task list from a report's prioritized fix plan — pasteable straight into a
 * GitHub issue, Jira ticket, Slack, or a doc. Ordering and priority come from the scanner's own
 * fixPriority list; the fix text is the finding's own recommendedFix. Nothing is invented here.
 */
export function buildFixChecklist(opts: {
  fileName: string
  reportId?: string
  riskScore: number
  verdictLabel: string
  findings: Finding[]
  fixPriority: ChecklistItem[]
  reportUrl?: string
  /** Include each finding's fix text (Pro). Free checklists list the items without the fixes. */
  includeFixes?: boolean
}): string {
  const { fileName, reportId, riskScore, verdictLabel, findings, fixPriority, reportUrl, includeFixes = true } = opts
  const byTitle = new Map(findings.map(f => [f.title, f]))
  const groups: Array<[string, string]> = [
    ['fix_first', 'Fix first'],
    ['fix_next', 'Fix next'],
    ['nice_to_have', 'Nice to have'],
  ]
  const lines: string[] = [
    `## Agent Verify fix checklist — ${fileName}`,
    '',
    `Verdict: **${verdictLabel}** · Security score: **${riskScore}/100**${reportId ? ` · Report: ${reportId}` : ''}`,
    '',
  ]
  for (const [priority, heading] of groups) {
    const items = fixPriority.filter(item => item.priority === priority)
    if (!items.length) continue
    lines.push(`### ${heading}`)
    for (const item of items) {
      const finding = byTitle.get(item.title)
      const where = typeof finding?.line === 'number' ? ` (line ${finding.line})` : ''
      lines.push(`- [ ] **${item.title}** — ${item.severity}${where}`)
      if (includeFixes && finding?.recommendedFix) lines.push(`  - How to fix: ${finding.recommendedFix.replace(/\s+/g, ' ').trim()}`)
    }
    lines.push('')
  }
  lines.push('- [ ] Re-scan with Agent Verify to confirm every item above is resolved')
  if (reportUrl) lines.push('', `Report: ${reportUrl}`)
  return lines.join('\n')
}
