import type { AgentCapability, Finding, McpToolExposure, RuntimeBOM, SecurityControl, Severity, StoredReport, Verdict } from '@/types'

/**
 * Scan-to-scan comparison — the strongest retention feature in Agent Verify: "what changed
 * since last time?" Matching is deliberately conservative: findings/capabilities/MCP tools are
 * matched by their stable identifier only (finding.code, capability.id, exposure.toolName) —
 * never by title text or evidence content, which can vary between scans without the underlying
 * risk changing. Two findings with the same code are always the "same" finding, even if their
 * evidence/line number shifted; two different codes are never merged, even if their titles look
 * similar. This avoids ever falsely matching two unrelated findings.
 *
 * Handles older/partial reports gracefully: every field read is optional-chained with a safe
 * fallback, so a report from before this feature existed (missing capabilities/mcpExposures/etc.)
 * simply shows those sections as having no prior data, rather than throwing or fabricating a
 * comparison that isn't there.
 */

export type ChangeStatus = 'new' | 'resolved' | 'unchanged'

export interface FindingChange {
  code: string
  title: string
  severity: Severity
  category: 'A' | 'B'
  status: ChangeStatus
}

export interface CapabilityChange {
  id: string
  label: string
  status: ChangeStatus
}

export interface McpChange {
  toolName: string
  riskLevel: Severity
  status: ChangeStatus
}

export interface BomFieldChange {
  field: string
  label: string
  from: string
  to: string
}

export interface ControlChange {
  id: string
  label: string
  status: ChangeStatus
}

export interface ScanComparisonSummary {
  previous: { reportId: string; scannedAt: string; verdict: Verdict; riskScore: number }
  current: { reportId: string; scannedAt: string; verdict: Verdict; riskScore: number }
  scoreChange: number
  verdictChanged: boolean
  /** true = got better (NOT_VERIFIED -> VERIFIED), false = got worse, null = unchanged */
  verdictImproved: boolean | null
  findings: { new: FindingChange[]; resolved: FindingChange[]; unchanged: FindingChange[] }
  newCriticalCount: number
  resolvedCriticalCount: number
  newHighCount: number
  resolvedHighCount: number
  capabilities: { new: CapabilityChange[]; resolved: CapabilityChange[] }
  mcpExposures: { new: McpChange[]; resolved: McpChange[] }
  controls: { added: ControlChange[]; removed: ControlChange[] }
  bomChanges: BomFieldChange[]
  /** True when the two reports' artifact fingerprints differ — both sides must have a real fingerprint to say so (never true/false from missing data, only from an actual comparison). */
  artifactChanged: boolean | null
}

const findingCode = (f: Partial<Finding> | string): string | null => {
  if (typeof f === 'string') return null // legacy string-only findings have no stable identity
  return typeof f.code === 'string' && !f.code.startsWith('LEGACY_FINDING_') ? f.code : null
}

const toFindingArray = (findings: unknown): Finding[] =>
  Array.isArray(findings) ? findings.filter((f): f is Finding => typeof f === 'object' && f !== null) : []

const toCapabilityArray = (value: unknown): AgentCapability[] =>
  Array.isArray(value) ? value.filter((c): c is AgentCapability => typeof c === 'object' && c !== null && typeof (c as AgentCapability).id === 'string') : []

const toMcpArray = (value: unknown): McpToolExposure[] =>
  Array.isArray(value) ? value.filter((m): m is McpToolExposure => typeof m === 'object' && m !== null && typeof (m as McpToolExposure).toolName === 'string') : []

const toControlArray = (value: unknown): SecurityControl[] =>
  Array.isArray(value) ? value.filter((c): c is SecurityControl => typeof c === 'object' && c !== null && typeof (c as SecurityControl).id === 'string') : []

function diffByKey<T, K extends string>(
  previous: T[],
  current: T[],
  keyOf: (item: T) => K | null
): { new: T[]; resolved: T[]; unchanged: T[] } {
  const prevMap = new Map<K, T>()
  for (const item of previous) {
    const key = keyOf(item)
    if (key) prevMap.set(key, item)
  }
  const curMap = new Map<K, T>()
  for (const item of current) {
    const key = keyOf(item)
    if (key) curMap.set(key, item)
  }
  const newItems: T[] = []
  const unchangedItems: T[] = []
  for (const [key, item] of curMap) {
    if (prevMap.has(key)) unchangedItems.push(item)
    else newItems.push(item)
  }
  const resolvedItems: T[] = []
  for (const [key, item] of prevMap) {
    if (!curMap.has(key)) resolvedItems.push(item)
  }
  return { new: newItems, resolved: resolvedItems, unchanged: unchangedItems }
}

// Only "risk-relevant" BOM fields are diffed — detectedLanguage/agentName/detectedFramework are
// descriptive, not a security signal, so a change there isn't reported as a "risk change".
const BOM_RISK_FIELDS: Array<{ field: keyof RuntimeBOM; label: string }> = [
  { field: 'toolAccessLevel', label: 'Tool access' },
  { field: 'credentialExposure', label: 'Credential exposure' },
  { field: 'memoryPersistence', label: 'Memory persistence' },
  { field: 'auditLogging', label: 'Audit logging' },
  { field: 'humanGates', label: 'Human approval gates' },
  { field: 'rateLimiting', label: 'Rate limiting' },
  { field: 'promptInjectionSurface', label: 'Prompt injection surface' },
  { field: 'delegationScope', label: 'Delegation scope' },
]

function diffBom(previous: RuntimeBOM | undefined, current: RuntimeBOM | undefined): BomFieldChange[] {
  if (!previous || !current) return []
  const changes: BomFieldChange[] = []
  for (const { field, label } of BOM_RISK_FIELDS) {
    const from = previous[field]
    const to = current[field]
    if (typeof from === 'string' && typeof to === 'string' && from !== to && from !== 'Unknown' && to !== 'Unknown') {
      changes.push({ field, label, from, to })
    }
  }
  return changes
}

const normalizeVerdict = (v: unknown): Verdict => (v === 'VERIFIED' ? 'VERIFIED' : v === 'NOT_ASSESSED' ? 'NOT_ASSESSED' : 'NOT_VERIFIED')

export function compareReports(previous: StoredReport, current: StoredReport): ScanComparisonSummary {
  const prevFindings = toFindingArray(previous.findings ?? previous.result?.findings)
  const curFindings = toFindingArray(current.findings ?? current.result?.findings)
  const findingDiff = diffByKey(prevFindings, curFindings, findingCode)

  const toChange = (f: Finding, status: ChangeStatus): FindingChange => ({
    code: f.code, title: f.title, severity: f.severity, category: f.category, status,
  })

  const prevCaps = toCapabilityArray(previous.capabilities ?? previous.result?.capabilities)
  const curCaps = toCapabilityArray(current.capabilities ?? current.result?.capabilities)
  const capDiff = diffByKey(prevCaps, curCaps, (c) => c.id as string)

  const prevMcp = toMcpArray(previous.mcpExposures ?? previous.result?.mcpExposures)
  const curMcp = toMcpArray(current.mcpExposures ?? current.result?.mcpExposures)
  const mcpDiff = diffByKey(prevMcp, curMcp, (m) => m.toolName as string)

  const prevControls = toControlArray(previous.securityControlsDetected ?? previous.result?.securityControlsDetected)
  const curControls = toControlArray(current.securityControlsDetected ?? current.result?.securityControlsDetected)
  const controlDiff = diffByKey(prevControls, curControls, (c) => c.id as string)

  const prevArtifactHash = previous.artifactHash
  const curArtifactHash = current.artifactHash
  const artifactChanged = (typeof prevArtifactHash === 'string' && prevArtifactHash && typeof curArtifactHash === 'string' && curArtifactHash)
    ? prevArtifactHash !== curArtifactHash
    : null

  const prevVerdict = normalizeVerdict(previous.verdict ?? previous.result?.verdict)
  const curVerdict = normalizeVerdict(current.verdict ?? current.result?.verdict)
  const prevScore = typeof previous.riskScore === 'number' ? previous.riskScore : previous.result?.riskScore ?? 0
  const curScore = typeof current.riskScore === 'number' ? current.riskScore : current.result?.riskScore ?? 0

  const newFindings = findingDiff.new.map(f => toChange(f, 'new'))
  const resolvedFindings = findingDiff.resolved.map(f => toChange(f, 'resolved'))

  return {
    previous: { reportId: previous.reportId, scannedAt: previous.scannedAt ?? '', verdict: prevVerdict, riskScore: prevScore },
    current: { reportId: current.reportId, scannedAt: current.scannedAt ?? '', verdict: curVerdict, riskScore: curScore },
    scoreChange: curScore - prevScore,
    verdictChanged: prevVerdict !== curVerdict,
    verdictImproved: prevVerdict === curVerdict ? null : curVerdict === 'VERIFIED',
    findings: {
      new: newFindings,
      resolved: resolvedFindings,
      unchanged: findingDiff.unchanged.map(f => toChange(f, 'unchanged')),
    },
    newCriticalCount: newFindings.filter(f => f.severity === 'critical').length,
    resolvedCriticalCount: resolvedFindings.filter(f => f.severity === 'critical').length,
    newHighCount: newFindings.filter(f => f.severity === 'high').length,
    resolvedHighCount: resolvedFindings.filter(f => f.severity === 'high').length,
    capabilities: {
      new: capDiff.new.map(c => ({ id: c.id, label: c.label, status: 'new' as const })),
      resolved: capDiff.resolved.map(c => ({ id: c.id, label: c.label, status: 'resolved' as const })),
    },
    mcpExposures: {
      new: mcpDiff.new.map(m => ({ toolName: m.toolName, riskLevel: m.riskLevel, status: 'new' as const })),
      resolved: mcpDiff.resolved.map(m => ({ toolName: m.toolName, riskLevel: m.riskLevel, status: 'resolved' as const })),
    },
    controls: {
      added: controlDiff.new.map(c => ({ id: c.id, label: c.label, status: 'new' as const })),
      removed: controlDiff.resolved.map(c => ({ id: c.id, label: c.label, status: 'resolved' as const })),
    },
    bomChanges: diffBom(
      (previous.bom as RuntimeBOM | undefined) ?? previous.result?.bom,
      (current.bom as RuntimeBOM | undefined) ?? current.result?.bom
    ),
    artifactChanged,
  }
}

const hasRealAgentName = (name: string | null | undefined): name is string =>
  typeof name === 'string' && name.trim().length > 0 && name.trim().toLowerCase() !== 'unknown'

/**
 * Which prior report (if any) should "previous scan" mean for this report? Matched within the
 * same owner by a real, scanner-detected agent name only — never by filename alone. Unrelated
 * projects can easily share a filename (agent.py, main.ts, config.json); falsely linking their
 * history as "previous scan" would misreport one project's score/finding changes as belonging
 * to a different, unrelated one. When the current report has no reliable agent name, there is no
 * confident "previous scan" to compare to, so this returns null rather than a weak guess.
 */
export function findPreviousReport(current: StoredReport, history: StoredReport[]): StoredReport | null {
  if (!hasRealAgentName(current.agentName)) return null
  const currentTime = new Date(current.scannedAt ?? current.createdAt ?? 0).getTime()
  const candidates = history.filter(r => {
    if (r.reportId === current.reportId) return false
    if (!hasRealAgentName(r.agentName) || r.agentName !== current.agentName) return false
    const t = new Date(r.scannedAt ?? r.createdAt ?? 0).getTime()
    return Number.isFinite(t) && t < currentTime
  })
  if (candidates.length === 0) return null
  return candidates.reduce((latest, r) => {
    const t = new Date(r.scannedAt ?? r.createdAt ?? 0).getTime()
    const latestT = new Date(latest.scannedAt ?? latest.createdAt ?? 0).getTime()
    return t > latestT ? r : latest
  })
}
