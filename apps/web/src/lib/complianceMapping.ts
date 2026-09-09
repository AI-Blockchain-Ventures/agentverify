import type { Finding, SecurityCategoryStatus, SecurityCategoryId } from '@/types'

/**
 * Compliance Engine — a real evidence-mapping layer between canonical scan evidence and framework
 * controls, NOT a re-render of finding labels (see ComplianceReportView.tsx for the prior,
 * simpler version this supersedes).
 *
 * The honesty constraint driving every decision below: in the actual scanner (packages/scanner/src
 * /findings.ts), a `finding.compliance.{owasp,nist,soc2}` citation is attached ONLY to findings
 * that describe something WRONG — there is currently no code path anywhere that tags a POSITIVE
 * control detection with a framework citation. That means, from real evidence alone:
 *
 *   - A control cited by a finding that fired in this scan can honestly be GAP_IDENTIFIED — that's
 *     a direct, unambiguous fact: the finding fired, its citation says which controls it implicates.
 *   - A control can almost never be honestly called EVIDENCE_OBSERVED purely from "the finding
 *     that would have cited it didn't fire" — the rest of this codebase already says exactly why:
 *     "a clean report is not a guarantee of safety" (docs Limitations section). Absence of evidence
 *     of a gap is not evidence of a control.
 *
 * So EVIDENCE_OBSERVED here is reserved for the ONE genuinely defensible inference available: a
 * SecurityCategoryStatus of 'strong' means the scanner ran every check it has for that category
 * (a real, counted set of checks — see docs #catalog) against the submitted content and found
 * nothing wrong. That's real, checked, negative-result evidence, not silence. Every such mapping
 * below is deliberately narrow and documented with which checks it stands on, and always carries
 * confidence: 'medium' (never 'high' — a clean static scan of THIS category is still not a
 * guarantee) to keep it visibly distinct from a GAP_IDENTIFIED tied to one exact firing finding.
 *
 * Every other control — real, cited somewhere in the scanner's own catalog, but neither fired nor
 * inferable this way for this specific scan — is NOT_ASSESSED. Never "compliant", never "passed",
 * never invented.
 */

export type ComplianceFramework = 'NIST_AI_RMF' | 'OWASP_LLM' | 'SOC2'
export type ComplianceStatus = 'EVIDENCE_OBSERVED' | 'GAP_IDENTIFIED' | 'NOT_ASSESSED' | 'NOT_APPLICABLE'

export interface ControlMapping {
  framework: ComplianceFramework
  /** Verbatim control identifier, exactly as cited in the real scanner source — never invented. */
  controlId: string
  status: ComplianceStatus
  /** Real finding IDs from THIS scan that justify the status — empty for NOT_ASSESSED/NOT_APPLICABLE. */
  supportingFindingIds: string[]
  explanation: string
  confidence: 'high' | 'medium' | 'low'
}

const FRAMEWORK_KEY: Record<ComplianceFramework, 'owasp' | 'nist' | 'soc2'> = {
  NIST_AI_RMF: 'nist',
  OWASP_LLM: 'owasp',
  SOC2: 'soc2',
}
const ALL_FRAMEWORKS: ComplianceFramework[] = ['NIST_AI_RMF', 'OWASP_LLM', 'SOC2']

// The narrow, documented category -> control EVIDENCE_OBSERVED inferences described above. Adding
// a row here is a deliberate claim that a 'strong' status for that category is real, checked
// evidence for that specific control — keep this list short and reviewed, exactly like
// check-private-boundary.mjs's ALLOWED_VALUE_IMPORT_FILES convention elsewhere in this codebase.
const STRONG_CATEGORY_EVIDENCE: Array<{ category: SecurityCategoryId; framework: ComplianceFramework; controlId: string; rationale: string }> = [
  { category: 'secrets', framework: 'OWASP_LLM', controlId: 'LLM06 - Sensitive Information Disclosure', rationale: 'The scanner ran its full secret-detection check set (12 checks — see docs #catalog) against the submitted content and found no hardcoded credential or exposed sensitive value.' },
  { category: 'secrets', framework: 'SOC2', controlId: 'CC6.1 - Logical Access Controls', rationale: 'No hardcoded credential was found across the full secret-detection check set.' },
  { category: 'human-oversight', framework: 'SOC2', controlId: 'CC6.1 - Logical Access Controls', rationale: 'The human-oversight check set found scoped, non-wildcard permissions and/or a human approval gate present.' },
  { category: 'auditability', framework: 'SOC2', controlId: 'CC7.2 - Monitoring', rationale: 'The auditability check found audit logging present.' },
]

/**
 * Builds the real control-mapping table for one scan's findings. Deterministic and pure — same
 * findings + securityCategories in, same mapping out, every time.
 */
export function buildComplianceMapping(findings: Finding[], securityCategories: SecurityCategoryStatus[]): ControlMapping[] {
  const byKey = new Map<string, ControlMapping>()

  const keyFor = (framework: ComplianceFramework, controlId: string) => `${framework}::${controlId}`

  // 1. GAP_IDENTIFIED — every control actually cited by a finding that fired in this scan.
  for (const finding of findings) {
    if (!finding.compliance) continue
    for (const framework of ALL_FRAMEWORKS) {
      const tags = finding.compliance[FRAMEWORK_KEY[framework]]
      if (!tags) continue
      for (const controlId of tags) {
        const key = keyFor(framework, controlId)
        const existing = byKey.get(key)
        if (existing) {
          existing.supportingFindingIds.push(finding.id)
        } else {
          byKey.set(key, {
            framework, controlId, status: 'GAP_IDENTIFIED',
            supportingFindingIds: [finding.id],
            explanation: `A real finding in this scan (${finding.title}) implicates this control.`,
            confidence: 'high',
          })
        }
      }
    }
  }

  // 2. EVIDENCE_OBSERVED — only the narrow, documented inferences above, and only where that
  // control wasn't ALREADY marked GAP_IDENTIFIED by a real finding (a firing finding always wins —
  // you cannot be both "evidence of a gap" and "evidence observed" for the same control at once).
  const categoryById = new Map(securityCategories.map(c => [c.id, c]))
  for (const rule of STRONG_CATEGORY_EVIDENCE) {
    const category = categoryById.get(rule.category)
    if (!category || category.status !== 'strong') continue
    const key = keyFor(rule.framework, rule.controlId)
    if (byKey.has(key)) continue // a real gap already exists for this control — never overridden
    byKey.set(key, {
      framework: rule.framework, controlId: rule.controlId, status: 'EVIDENCE_OBSERVED',
      supportingFindingIds: [], explanation: rule.rationale, confidence: 'medium',
    })
  }

  return [...byKey.values()].sort((a, b) => a.framework.localeCompare(b.framework) || a.controlId.localeCompare(b.controlId))
}

/** Every distinct real control ID that CAN appear (drawn from the actual finding compliance tags in this report + the STRONG_CATEGORY_EVIDENCE table) — used only to render a "not assessed" row for a real, known control this scan happened not to touch, never to invent a new one. */
export function notAssessedControls(mapping: ControlMapping[], knownControls: Array<{ framework: ComplianceFramework; controlId: string }>): ControlMapping[] {
  const covered = new Set(mapping.map(m => `${m.framework}::${m.controlId}`))
  return knownControls
    .filter(c => !covered.has(`${c.framework}::${c.controlId}`))
    .map(c => ({
      framework: c.framework, controlId: c.controlId, status: 'NOT_ASSESSED' as const,
      supportingFindingIds: [],
      explanation: 'No finding in this scan implicated this control, and no strong-category evidence was available to infer it either way. This does not mean the control is met.',
      confidence: 'low' as const,
    }))
}
