// REFERENCE / TEST-ONLY (vector set v3). Not the product implementation. See conformance/v3/README.md.
//
// THE EXACT SCHEMA OF A PROFILE ASSESSMENT, schema version 1.1.0.
//
// "SUPPORTED" used to mean only "the schema version string and profile id are ones I know". That is far too weak to be the gate
// for rendering an attested assessment or for satisfying a policy: a signer (or an attacker holding a signing key) could sign an
// assessment whose structure is nonsense, and a verifier would call it SUPPORTED. In v3 an assessment is SUPPORTED only if it
// passes assessmentSchemaProblem, which checks:
//
//   * required fields, and CLOSED objects: an unknown field anywhere is a failure, not something to ignore
//   * exact types and enum values
//   * every evidence id is unique, and every reference to one (a check's supportingEvidenceIds, unmappedEvidenceIds) resolves
//   * coverage counts equal the checks they summarize, and each control's status follows from its checks
//   * the controls are exactly the profile's implemented controls, and implemented / notImplemented never overlap
//
// It does NOT check anything the scanner does not make deterministic (the text of a title or explanation, which evidence kinds
// exist). Whether the profile metadata matches the pinned profile definition is a SEPARATE step (profileRegistry.mjs).
//
// Returns null when the assessment is valid for schema 1.1.0, otherwise one stable reason code (ASSESSMENT_SCHEMA_PROBLEM_CODES).
// The first problem found is reported; the order of the checks below is part of the contract the vectors pin.

import { PACKAGE_DIGEST, CONTROL_ID, PROFILE_ID, exactKeys, isDenseArray, isNonEmptyString, isNonNegativeSafeInteger, isCommit, isPlain, isPositiveSafeInteger, isSemver, isString, isUniqueStringArray, own } from './plain.mjs'
import { numberProblem } from './numberProfile.mjs'
import { INTERPRETATION_VERSION_KEYS } from './domains.mjs'

export const ASSESSMENT_SCHEMA_VERSION = '1.1.0'

/** Every reason assessmentSchemaProblem can return. The tests require at least one vector per code. */
export const ASSESSMENT_SCHEMA_PROBLEM_CODES = Object.freeze([
  'assessment.schema.top-level',
  'assessment.schema.schema-version',
  'assessment.schema.profile',
  'assessment.schema.profile.implemented-controls',
  'assessment.schema.controls',
  'assessment.schema.control',
  'assessment.schema.checks',
  'assessment.schema.check',
  'assessment.schema.coverage',
  'assessment.schema.control-status',
  'assessment.schema.evidence',
  'assessment.schema.evidence.duplicate-id',
  'assessment.schema.evidence-reference',
  'assessment.schema.unmapped-evidence',
  'assessment.schema.not-implemented',
  'assessment.schema.package',
  'assessment.schema.notes',
])

export const CONFIDENCES = Object.freeze(['high', 'medium', 'low'])
export const SEVERITIES = Object.freeze(['high', 'medium', 'low'])
export const POLARITIES = Object.freeze(['gap', 'positive', 'context'])
export const AXES = Object.freeze(['manifest', 'tools', 'network', 'shell', 'filesystem', 'identity', 'sensitive', 'dependencies', 'lockfile', 'execution-config', 'sbom', 'metadata'])
export const PROVENANCES = Object.freeze(['DECLARED', 'STATICALLY_OBSERVED', 'RECOMPUTED', 'CRYPTOGRAPHICALLY_VERIFIED', 'BEHAVIORALLY_OBSERVED', 'EXTERNAL_EVIDENCE', 'INFERRED'])
export const UPSTREAM_SEVERITIES = Object.freeze(['Critical', 'High', 'Medium'])
export const CHECK_STATUSES = Object.freeze(['EVIDENCE_OBSERVED', 'GAP_IDENTIFIED', 'NOT_ASSESSED'])

const TOP = ['schemaVersion', 'profile', 'controls', 'notImplementedControls', 'evidence', 'unmappedEvidenceIds', 'package', 'notes']
const PROFILE = ['profileId', 'framework', 'upstreamRepo', 'upstreamCommit', 'upstreamStatus', 'upstreamLicense', 'agentverifyProfileVersion', 'implementedControls', ...INTERPRETATION_VERSION_KEYS]
const CONTROL = ['controlId', 'framework', 'title', 'upstreamSeverity', 'status', 'confidence', 'explanation', 'checks', 'coverage']
const CHECK = ['checkId', 'title', 'status', 'confidence', 'provenance', 'supportingEvidenceIds', 'explanation']
const COVERAGE = ['total', 'evidenceObserved', 'gapIdentified', 'notAssessed']
const EVIDENCE = ['id', 'kind', 'axis', 'polarity', 'severity', 'confidence', 'provenance', 'summary', 'expected', 'remediation', 'locations', 'facts']
const PACKAGE = ['digest', 'fileCount', 'manifestFiles']

const inEnum = (list, v) => typeof v === 'string' && list.includes(v)
const isFact = v => typeof v === 'boolean' || isString(v) || (typeof v === 'number' && numberProblem(v) === null) || (isDenseArray(v) && v.every(isString))
const isLocation = l => isPlain(l) && exactKeys(l, ['file'], ['line', 'keyPath']) && isNonEmptyString(l.file) && (!Object.hasOwn(l, 'line') || isPositiveSafeInteger(l.line)) && (!Object.hasOwn(l, 'keyPath') || isNonEmptyString(l.keyPath))

export function assessmentSchemaProblem(a) {
  if (!isPlain(a) || !exactKeys(a, TOP)) return 'assessment.schema.top-level'
  if (a.schemaVersion !== ASSESSMENT_SCHEMA_VERSION) return 'assessment.schema.schema-version'

  // profile
  const p = a.profile
  if (!isPlain(p) || !exactKeys(p, PROFILE)) return 'assessment.schema.profile'
  if (!(typeof p.profileId === 'string' && PROFILE_ID.test(p.profileId))) return 'assessment.schema.profile'
  for (const k of ['framework', 'upstreamRepo', 'upstreamStatus', 'upstreamLicense']) if (!isNonEmptyString(p[k])) return 'assessment.schema.profile'
  if (!isCommit(p.upstreamCommit) || !isSemver(p.agentverifyProfileVersion)) return 'assessment.schema.profile'
  if (!INTERPRETATION_VERSION_KEYS.every(k => isSemver(p[k]))) return 'assessment.schema.profile'
  if (!isUniqueStringArray(p.implementedControls, c => typeof c === 'string' && CONTROL_ID.test(c)) || p.implementedControls.length === 0) return 'assessment.schema.profile.implemented-controls'

  // evidence (validated before the controls, because checks refer to it)
  if (!isDenseArray(a.evidence)) return 'assessment.schema.evidence'
  const evidenceIds = new Set()
  for (const e of a.evidence) {
    if (!isPlain(e) || !exactKeys(e, EVIDENCE)) return 'assessment.schema.evidence'
    if (!isNonEmptyString(e.id) || !isNonEmptyString(e.kind)) return 'assessment.schema.evidence'
    if (!inEnum(AXES, e.axis) || !inEnum(POLARITIES, e.polarity) || !inEnum(SEVERITIES, e.severity) || !inEnum(CONFIDENCES, e.confidence)) return 'assessment.schema.evidence'
    if (!isUniqueStringArray(e.provenance, x => inEnum(PROVENANCES, x))) return 'assessment.schema.evidence'
    if (!isString(e.summary) || !isString(e.expected) || !isString(e.remediation)) return 'assessment.schema.evidence'
    if (!isDenseArray(e.locations) || !e.locations.every(isLocation)) return 'assessment.schema.evidence'
    if (!isPlain(e.facts) || !Object.keys(e.facts).every(k => isFact(e.facts[k])) || Object.getOwnPropertySymbols(e.facts).length > 0) return 'assessment.schema.evidence'
    if (evidenceIds.has(e.id)) return 'assessment.schema.evidence.duplicate-id'
    evidenceIds.add(e.id)
  }

  // controls
  if (!isDenseArray(a.controls)) return 'assessment.schema.controls'
  const seenControls = new Set()
  for (const c of a.controls) {
    if (!isPlain(c) || !exactKeys(c, CONTROL)) return 'assessment.schema.control'
    if (typeof c.controlId !== 'string' || !CONTROL_ID.test(c.controlId)) return 'assessment.schema.control'
    if (c.framework !== p.framework) return 'assessment.schema.control'
    if (!isNonEmptyString(c.title) || !isString(c.explanation)) return 'assessment.schema.control'
    if (!inEnum(UPSTREAM_SEVERITIES, c.upstreamSeverity) || !inEnum(CHECK_STATUSES, c.status) || !inEnum(CONFIDENCES, c.confidence)) return 'assessment.schema.control'
    if (seenControls.has(c.controlId)) return 'assessment.schema.controls'
    seenControls.add(c.controlId)

    if (!isDenseArray(c.checks) || c.checks.length === 0) return 'assessment.schema.checks'
    const seenChecks = new Set()
    const counts = { EVIDENCE_OBSERVED: 0, GAP_IDENTIFIED: 0, NOT_ASSESSED: 0 }
    for (const k of c.checks) {
      if (!isPlain(k) || !exactKeys(k, CHECK)) return 'assessment.schema.check'
      if (!isNonEmptyString(k.checkId) || !isNonEmptyString(k.title) || !isString(k.explanation)) return 'assessment.schema.check'
      if (!inEnum(CHECK_STATUSES, k.status) || !inEnum(CONFIDENCES, k.confidence)) return 'assessment.schema.check'
      if (!isUniqueStringArray(k.provenance, x => inEnum(PROVENANCES, x))) return 'assessment.schema.check'
      if (!isUniqueStringArray(k.supportingEvidenceIds, isNonEmptyString)) return 'assessment.schema.check'
      if (seenChecks.has(k.checkId)) return 'assessment.schema.check'
      seenChecks.add(k.checkId)
      if (!k.supportingEvidenceIds.every(id => evidenceIds.has(id))) return 'assessment.schema.evidence-reference'
      counts[k.status]++
    }

    const cov = c.coverage
    if (!isPlain(cov) || !exactKeys(cov, COVERAGE) || !COVERAGE.every(f => isNonNegativeSafeInteger(cov[f]))) return 'assessment.schema.coverage'
    if (cov.total !== c.checks.length || cov.evidenceObserved !== counts.EVIDENCE_OBSERVED || cov.gapIdentified !== counts.GAP_IDENTIFIED || cov.notAssessed !== counts.NOT_ASSESSED) return 'assessment.schema.coverage'

    // The control status follows from its checks: any gap is a gap; otherwise anything not assessed leaves the control not
    // assessed; only when every check has evidence is the control EVIDENCE_OBSERVED. (No control status is ever "passed".)
    const expectedStatus = counts.GAP_IDENTIFIED > 0 ? 'GAP_IDENTIFIED' : counts.NOT_ASSESSED > 0 ? 'NOT_ASSESSED' : 'EVIDENCE_OBSERVED'
    if (c.status !== expectedStatus) return 'assessment.schema.control-status'
  }
  const controlIds = a.controls.map(c => c.controlId)
  if (controlIds.length !== p.implementedControls.length || controlIds.some((id, i) => id !== p.implementedControls[i])) return 'assessment.schema.controls'

  // implemented / not implemented
  if (!isUniqueStringArray(a.notImplementedControls, c => typeof c === 'string' && CONTROL_ID.test(c))) return 'assessment.schema.not-implemented'
  if (a.notImplementedControls.some(c => p.implementedControls.includes(c))) return 'assessment.schema.not-implemented'

  // unmapped evidence
  if (!isUniqueStringArray(a.unmappedEvidenceIds, isNonEmptyString) || !a.unmappedEvidenceIds.every(id => evidenceIds.has(id))) return 'assessment.schema.unmapped-evidence'

  // package
  const pk = a.package
  if (!isPlain(pk) || !exactKeys(pk, PACKAGE)) return 'assessment.schema.package'
  if (typeof pk.digest !== 'string' || !PACKAGE_DIGEST.test(pk.digest) || !isNonNegativeSafeInteger(pk.fileCount)) return 'assessment.schema.package'
  if (!isDenseArray(pk.manifestFiles) || !pk.manifestFiles.every(isNonEmptyString)) return 'assessment.schema.package'

  // notes
  if (!isDenseArray(a.notes) || !a.notes.every(isString)) return 'assessment.schema.notes'
  return null
}

/** Read helper for callers that only need a top-level own property without trusting the shape. */
export const assessmentField = (a, key) => own(a, key)
