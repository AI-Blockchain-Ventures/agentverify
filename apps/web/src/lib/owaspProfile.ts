import type { SkillCheckStatus, SkillControl, SkillControlCoverage, SkillUpstreamSeverity } from '@/types/profileAssessment'

/**
 * Pure DISPLAY metadata and formatting for the OWASP Agentic Skills Top 10 profile. Nothing here parses skill
 * content, infers a status, derives an OWASP mapping, or recomputes evidence/digests — the backend
 * (workers/api/src/profiles.ts, packages/scanner) is the sole source of that. What lives here is exactly the
 * kind of thing any API consumer's presentation layer legitimately owns: labels for a well-known public
 * taxonomy (the OWASP Agentic Skills Top 10 control list itself, cited from docs/owasp-agentic-skills-
 * evidence-matrix.md — the same document the backend's own control titles come from) and string formatting of
 * numbers the API already returned.
 */

export const OWASP_PROFILE_ID = 'owasp-agentic-skills-2026'

/** The exact three controls this profile version implements — pinned in the closed registry (packages/scanner/src/profileAttestation.ts / conformance/v4). Everything else in the OWASP Agentic Skills Top 10 is NOT_ASSESSED by this profile version, not hidden. */
export const IMPLEMENTED_CONTROL_IDS: readonly string[] = ['AST02', 'AST03', 'AST04']

/**
 * The full, public OWASP Agentic Skills Top 10 taxonomy (all ten controls), titles and severities exactly as
 * published upstream (see docs/owasp-agentic-skills-evidence-matrix.md, itself pinned to the same upstream
 * commit the assessment cites). Used ONLY to label the seven controls this profile version does not assess —
 * for AST02/AST03/AST04 the assessment response's own `title`/`upstreamSeverity` fields are used instead,
 * never this table, so a real assessment is always shown exactly as the backend stated it.
 */
export const OWASP_AST_CATALOG: ReadonlyArray<{ id: string; title: string; severity: SkillUpstreamSeverity }> = [
  { id: 'AST01', title: 'Malicious Skills', severity: 'Critical' },
  { id: 'AST02', title: 'Supply Chain Compromise', severity: 'Critical' },
  { id: 'AST03', title: 'Over-Privileged Skills', severity: 'High' },
  { id: 'AST04', title: 'Insecure Metadata', severity: 'High' },
  { id: 'AST05', title: 'Untrusted External Instructions', severity: 'High' },
  { id: 'AST06', title: 'Weak Isolation', severity: 'High' },
  { id: 'AST07', title: 'Update Drift', severity: 'Medium' },
  { id: 'AST08', title: 'Poor Scanning', severity: 'Medium' },
  { id: 'AST09', title: 'No Governance', severity: 'Medium' },
  { id: 'AST10', title: 'Cross-Platform Reuse', severity: 'Medium' },
]

export type ControlRow =
  | { id: string; implemented: true; control: SkillControl }
  | { id: string; implemented: false; title: string; severity: SkillUpstreamSeverity }

/**
 * Builds all ten rows for display, in catalog order: the three from the real assessment where present
 * (matched by controlId — never assumed to be in any particular order in the API response), the rest as
 * explicit NOT_ASSESSED placeholders. A control the backend returns that this catalog doesn't recognize is
 * still included (via its own id/title) rather than silently dropped — additive backend changes are never
 * hidden.
 */
export function buildControlRows(controls: SkillControl[]): ControlRow[] {
  const byId = new Map(controls.map(c => [c.controlId, c]))
  const seen = new Set<string>()
  const rows: ControlRow[] = OWASP_AST_CATALOG.map(entry => {
    seen.add(entry.id)
    const real = byId.get(entry.id)
    return real ? { id: entry.id, implemented: true as const, control: real } : { id: entry.id, implemented: false as const, title: entry.title, severity: entry.severity }
  })
  for (const c of controls) {
    if (!seen.has(c.controlId)) rows.push({ id: c.controlId, implemented: true, control: c })
  }
  return rows
}

export const STATUS_LABEL: Record<SkillCheckStatus, string> = {
  EVIDENCE_OBSERVED: 'Evidence observed',
  GAP_IDENTIFIED: 'Gap identified',
  NOT_ASSESSED: 'Not assessed',
}

/** What each status means, worded so it can never be read as pass/fail/certification (requirement 3). */
export const STATUS_MEANING: Record<SkillCheckStatus, string> = {
  EVIDENCE_OBSERVED: 'Evidence supporting the expected security property was observed.',
  GAP_IDENTIFIED: 'Agent Verify observed evidence of a security gap.',
  NOT_ASSESSED: 'Agent Verify did not have sufficient evidence to reach a determination. This is not a pass.',
}

/** Tailwind/CSS-variable classes per status, kept visually distinct without implying pass=green/fail=red certainty language. */
export const STATUS_STYLE: Record<SkillCheckStatus, { dot: string; text: string; badgeBg: string; badgeBorder: string }> = {
  EVIDENCE_OBSERVED: { dot: 'bg-[#00B37E]', text: 'text-[color:var(--accent-green-text)]', badgeBg: 'bg-[#00B37E]/10', badgeBorder: 'border-[#00B37E]/25' },
  GAP_IDENTIFIED: { dot: 'bg-[#EF4444]', text: 'text-[color:var(--accent-red-text)]', badgeBg: 'bg-[#EF4444]/10', badgeBorder: 'border-[#EF4444]/25' },
  NOT_ASSESSED: { dot: 'bg-[#8A94A6]', text: 'text-[var(--text-muted)]', badgeBg: 'bg-[var(--surface)]', badgeBorder: 'border-[var(--border)]' },
}

export const SEVERITY_LABEL: Record<SkillUpstreamSeverity, string> = { Critical: 'Critical', High: 'High', Medium: 'Medium' }

/** "7 of 8 checks assessed" — pure string formatting of numbers the API already computed (coverage.total / (evidenceObserved + gapIdentified)). Never recomputed from the check list itself. */
export function formatCoverage(coverage: SkillControlCoverage): string {
  const assessed = coverage.evidenceObserved + coverage.gapIdentified
  return `${assessed} of ${coverage.total} check${coverage.total === 1 ? '' : 's'} assessed`
}

/** Confidence label used verbatim from the API's own `confidence` enum — never re-derived. */
export function formatConfidence(confidence: string): string {
  return confidence.charAt(0).toUpperCase() + confidence.slice(1)
}

// ── Required, verbatim wording (requirement 4) ───────────────────────────────────────────────────────────

export const IMPLEMENTED_CONTROLS_DISCLAIMER =
  'Only AST02, AST03 and AST04 are implemented in this profile version. Every other control is not assessed, which is not a pass.'

export const OWASP_ATTRIBUTION_DISCLAIMER =
  'Assessed against the OWASP Agentic Skills Top 10 (CC-BY-SA-4.0) at the pinned upstream commit. Not an OWASP certification or endorsement.'

export const SIGNATURE_SCOPE_DISCLAIMER =
  'The signature proves this exact assessment was issued by Agent Verify and has not been altered. It does not independently prove that every finding is correct or complete.'

export const PUBLIC_KEY_VERIFICATION_GUIDANCE =
  "Verify the signing key independently using Agent Verify's published profile-attestation public key."

export const PUBLIC_KEY_ROUTE = 'GET /v1/profile-attestation/public-key'

/** Clarifies the profile MAPPING's own "1.0.0-alpha.1" version is unrelated to Agent Verify's own release maturity (requirement 5). Agent Verify itself ships as v1.5.0. */
export const PROFILE_VERSION_CLARIFICATION =
  "This is the version of the OWASP Agentic Skills profile mapping itself, not of Agent Verify. Agent Verify is released as v1.5.0."
