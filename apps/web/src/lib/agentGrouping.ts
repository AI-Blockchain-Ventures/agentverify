import type { StoredReport } from '@/types'

// Deliberately not importing sortReports from ./scanStore: that module initializes the Firebase
// app as a side effect of import, which this pure grouping logic has no need for (and which
// makes it harder to unit-test in isolation). The sort itself is identical to scanStore's.
const byScannedAtDesc = (reports: StoredReport[]): StoredReport[] =>
  [...reports].sort((a, b) => {
    const dateA = new Date(a?.scannedAt ?? a?.createdAt ?? 0).getTime()
    const dateB = new Date(b?.scannedAt ?? b?.createdAt ?? 0).getTime()
    return dateB - dateA
  })

/**
 * Groups scan reports into "agents" for the dashboard and the agent detail view.
 *
 * Identity rule: reports are only grouped together when they share a real, non-empty,
 * scanner-detected agent name. Agent Verify never groups by filename alone — two unrelated
 * projects can easily share a filename (agent.py, main.ts, config.json), and silently
 * merging their history would misattribute findings and score trends to the wrong project.
 *
 * When a report has no reliable agent name, it is shown as its own standalone entry rather
 * than guessed into a group. This intentionally means the same un-named file scanned twice
 * will not be linked automatically — that's the honest tradeoff for never fabricating identity.
 */

export interface AgentGroup {
  /** Stable React/link key. Not a display value. */
  key: string
  /** The real detected agent name, or null for a standalone (unidentified) report. */
  agentName: string | null
  /** What to show in the UI. */
  displayName: string
  /** 'named' = grouped by a real detected agent name. 'standalone' = shown alone, not merged. */
  identityConfidence: 'named' | 'standalone'
  /** Newest-first. */
  reports: StoredReport[]
}

const isRealAgentName = (name: string | null | undefined): name is string =>
  typeof name === 'string' && name.trim().length > 0 && name.trim().toLowerCase() !== 'unknown'

/** URL-safe, stable identifier for a named group — derived from the agent name itself. */
export const agentGroupSlug = (agentName: string): string =>
  encodeURIComponent(agentName.trim())

const reportDateMs = (report: StoredReport): number => {
  const raw = report.scannedAt ?? report.createdAt
  const ms = raw ? new Date(raw).getTime() : NaN
  return Number.isFinite(ms) ? ms : 0
}

export function groupReportsByAgent(reports: StoredReport[]): AgentGroup[] {
  const sorted = byScannedAtDesc(reports)
  const named = new Map<string, StoredReport[]>()
  const standalone: AgentGroup[] = []

  for (const r of sorted) {
    if (isRealAgentName(r.agentName)) {
      const key = r.agentName.trim()
      const list = named.get(key)
      if (list) list.push(r)
      else named.set(key, [r])
    } else {
      standalone.push({
        key: `standalone:${r.reportId}`,
        agentName: null,
        displayName: r.fileName || 'Unnamed agent',
        identityConfidence: 'standalone',
        reports: [r],
      })
    }
  }

  const namedGroups: AgentGroup[] = [...named.entries()].map(([key, list]) => ({
    key: `named:${key}`,
    agentName: key,
    displayName: key,
    identityConfidence: 'named' as const,
    reports: list, // `sorted` was already newest-first, so insertion order is preserved
  }))

  return [...namedGroups, ...standalone].sort(
    (a, b) => reportDateMs(b.reports[0]) - reportDateMs(a.reports[0])
  )
}

/** Find a named group by its slug (from a URL param). Returns null if not found or ambiguous-empty. */
export function findAgentGroup(reports: StoredReport[], slug: string): AgentGroup | null {
  const groups = groupReportsByAgent(reports)
  return groups.find(g => g.agentName !== null && agentGroupSlug(g.agentName) === slug) ?? null
}
