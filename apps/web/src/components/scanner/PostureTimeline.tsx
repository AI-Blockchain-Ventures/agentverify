'use client'

import { compareReports } from '@/lib/compareReports'
import { derivePostureEvents, derivePolicyChangeEvent, type PostureEvent } from '@/lib/postureEvents'
import type { StoredReport } from '@/types'

const SEVERITY_DOT: Record<PostureEvent['severity'], string> = {
  critical: '#E03E3E',
  high: '#F59E0B',
  medium: '#EAB308',
  low: '#06B6D4',
  info: '#00B37E',
}

interface TimelineGroup {
  scannedAt: string
  events: PostureEvent[]
}

/**
 * Security Posture Timeline — every event here is derived from real compareReports() output
 * between consecutive real scans (see postureEvents.ts). No synthetic/placeholder events: a scan
 * pair with nothing to report simply contributes no entries.
 */
export function PostureTimeline({ reports }: { reports: StoredReport[] }) {
  // reports is newest-first (see AgentGroup); walk consecutive pairs oldest-adjacent to build
  // one event group per transition, then render newest-first to match the rest of the page.
  const groups: TimelineGroup[] = []
  for (let i = 0; i < reports.length - 1; i += 1) {
    const newer = reports[i]
    const older = reports[i + 1]
    const comparison = compareReports(older, newer)
    const events = derivePostureEvents(comparison, newer.scannedAt ?? '')
    const policyEvent = derivePolicyChangeEvent(
      typeof older.policyResult === 'string' ? older.policyResult : null,
      typeof newer.policyResult === 'string' ? newer.policyResult : null,
      newer.scannedAt ?? ''
    )
    if (policyEvent) events.push(policyEvent)
    if (events.length > 0) groups.push({ scannedAt: newer.scannedAt ?? '', events })
  }

  if (groups.length === 0) return null

  return (
    <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mb-6 rounded-3xl p-6 shadow-xl shadow-black/5">
      <p style={{ color: 'var(--text-primary)' }} className="mb-1 text-sm font-semibold">Security posture timeline</p>
      <p style={{ color: 'var(--text-muted)' }} className="mb-4 text-xs">What changed, scan to scan — derived directly from real comparisons, newest first.</p>
      <div className="av-stagger space-y-4">
        {groups.map((group, gi) => (
          <div key={`${group.scannedAt}-${gi}`} className="flex gap-3">
            <div className="flex shrink-0 flex-col items-center pt-1">
              <span style={{ color: 'var(--text-muted)' }} className="whitespace-nowrap text-[11px] font-medium">
                {group.scannedAt ? new Date(group.scannedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}
              </span>
            </div>
            <div style={{ borderLeft: '2px solid var(--border)' }} className="flex-1 space-y-2 pb-1 pl-4">
              {group.events.map((event, ei) => (
                <div key={ei} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: SEVERITY_DOT[event.severity] }} aria-hidden="true" />
                  <p style={{ color: 'var(--text-primary)' }} className="text-sm leading-snug">{event.label}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
