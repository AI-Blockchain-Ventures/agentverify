import type { ScanComparisonSummary } from './compareReports'

/**
 * Continuous Verification — Security Posture Change Events.
 *
 * These are DERIVED, never independently computed: every event below reads directly off a
 * `ScanComparisonSummary` already produced by compareReports() (see compareReports.ts) — this
 * file contains no diffing logic of its own, on purpose, so there is exactly one place that
 * decides what changed between two scans.
 *
 * This is the data model + a pure derivation function — the "continuous" part is conceptual, not
 * a running daemon: an event set is produced whenever a NEW scan is compared to the PREVIOUS one
 * for the same agent (already how the dashboard/agent-detail pages work via findPreviousReport +
 * compareReports). There is no background process watching anything; presenting this as if there
 * were would be dishonest about what actually runs.
 */

export type PostureEventType =
  | 'NEW_CRITICAL_FINDING'
  | 'NEW_HIGH_FINDING'
  | 'FINDING_RESOLVED'
  | 'SCORE_INCREASED'
  | 'SCORE_DECREASED'
  | 'VERDICT_CHANGED'
  | 'CAPABILITY_ADDED'
  | 'CAPABILITY_REMOVED'
  | 'MCP_SERVER_ADDED'
  | 'MCP_SERVER_REMOVED'
  | 'PERMISSION_EXPANDED'
  | 'CONTROL_ADDED'
  | 'CONTROL_REMOVED'
  | 'POLICY_FAILURE'
  | 'POLICY_RECOVERED'
  | 'ARTIFACT_CHANGED'

export interface PostureEvent {
  type: PostureEventType
  /** Plain-English, ready to render directly — no further templating needed. */
  label: string
  /** 'critical' | 'high' | 'medium' | 'low' | 'info' — drives icon/color; 'info' for neutral/positive events. */
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  timestamp: string
}

const BOM_EXPANSION_FIELDS: Record<string, { good: string; bad: string }> = {
  toolAccessLevel: { good: 'Restricted', bad: 'Unrestricted' },
  credentialExposure: { good: 'Not Detected', bad: 'Detected' },
  memoryPersistence: { good: 'Bounded', bad: 'Unbounded' },
}

/**
 * Pure function: a ScanComparisonSummary in, a chronologically-neutral list of posture events
 * out (the caller supplies `timestamp`, normally the newer scan's scannedAt, since this function
 * has no I/O and no clock dependency of its own).
 */
export function derivePostureEvents(comparison: ScanComparisonSummary, timestamp: string): PostureEvent[] {
  const events: PostureEvent[] = []

  if (comparison.artifactChanged) {
    events.push({ type: 'ARTIFACT_CHANGED', label: 'Artifact changed', severity: 'info', timestamp })
  }

  for (const f of comparison.findings.new) {
    if (f.severity === 'critical') {
      events.push({ type: 'NEW_CRITICAL_FINDING', label: `New critical risk: ${f.title}`, severity: 'critical', timestamp })
    } else if (f.severity === 'high') {
      events.push({ type: 'NEW_HIGH_FINDING', label: `New high risk: ${f.title}`, severity: 'high', timestamp })
    }
  }
  for (const f of comparison.findings.resolved) {
    events.push({ type: 'FINDING_RESOLVED', label: `Resolved: ${f.title}`, severity: 'info', timestamp })
  }

  if (comparison.scoreChange > 0) {
    events.push({ type: 'SCORE_INCREASED', label: `Score improved: ${comparison.previous.riskScore} → ${comparison.current.riskScore}`, severity: 'info', timestamp })
  } else if (comparison.scoreChange < 0) {
    events.push({ type: 'SCORE_DECREASED', label: `Score dropped: ${comparison.previous.riskScore} → ${comparison.current.riskScore}`, severity: 'medium', timestamp })
  }

  if (comparison.verdictChanged) {
    events.push({
      type: 'VERDICT_CHANGED',
      label: `Verdict ${comparison.verdictImproved ? 'improved' : 'worsened'}: ${comparison.previous.verdict} → ${comparison.current.verdict}`,
      severity: comparison.verdictImproved ? 'info' : 'high',
      timestamp,
    })
  }

  for (const c of comparison.capabilities.new) {
    events.push({ type: 'CAPABILITY_ADDED', label: `New capability: ${c.label}`, severity: 'medium', timestamp })
  }
  for (const c of comparison.capabilities.resolved) {
    events.push({ type: 'CAPABILITY_REMOVED', label: `Capability removed: ${c.label}`, severity: 'info', timestamp })
  }

  for (const m of comparison.mcpExposures.new) {
    events.push({ type: 'MCP_SERVER_ADDED', label: `New MCP tool exposure: ${m.toolName}`, severity: m.riskLevel === 'critical' || m.riskLevel === 'high' ? 'high' : 'medium', timestamp })
  }
  for (const m of comparison.mcpExposures.resolved) {
    events.push({ type: 'MCP_SERVER_REMOVED', label: `MCP tool exposure removed: ${m.toolName}`, severity: 'info', timestamp })
  }

  for (const change of comparison.bomChanges) {
    const expansion = BOM_EXPANSION_FIELDS[change.field]
    if (expansion && change.from === expansion.good && change.to === expansion.bad) {
      events.push({ type: 'PERMISSION_EXPANDED', label: `${change.label}: ${change.from} → ${change.to}`, severity: 'high', timestamp })
    }
  }

  for (const c of comparison.controls.added) {
    events.push({ type: 'CONTROL_ADDED', label: `New control detected: ${c.label}`, severity: 'info', timestamp })
  }
  for (const c of comparison.controls.removed) {
    events.push({ type: 'CONTROL_REMOVED', label: `Control no longer detected: ${c.label}`, severity: 'medium', timestamp })
  }

  return events
}

/** For a policy result pair (previous scan's policyResult, current scan's) — same derive-only philosophy, kept as a separate small function since policy results aren't part of ScanComparisonSummary (they're evaluated per-policy, not part of the scanner's own evidence diff). */
export function derivePolicyChangeEvent(previousResult: string | null, currentResult: string | null, timestamp: string): PostureEvent | null {
  if (!previousResult || !currentResult || previousResult === currentResult) return null
  if (currentResult === 'FAIL') return { type: 'POLICY_FAILURE', label: 'Policy check started failing', severity: 'high', timestamp }
  if (currentResult === 'PASS') return { type: 'POLICY_RECOVERED', label: 'Policy check recovered', severity: 'info', timestamp }
  return null
}
