import { assessSkillPackageAst } from '@agentverify/scanner'
import type { SkillAstAssessment, SkillAstAssessmentResult, SkillPackageFileInput } from '@agentverify/scanner'
import { isRateLimited } from './rateLimit'

/**
 * Assessment profiles for /v1/scan.
 *
 * A profile is an EXPLICIT, opt-in request parameter. Absence of `profile` leaves /v1/scan exactly as it
 * was: same behavior, same response shape. This module is orchestration only. It validates the request's
 * shape, hands the file list to the private scanner, and returns the scanner's frozen assessment object.
 * It does no parsing, detection, mapping or scoring of skill content — all of that lives in the private
 * scanner package, and none of it is reimplemented here.
 *
 * Design rules:
 *  - CLOSED REGISTRY. The public `profile` string is only ever used as an exact key into PROFILE_REGISTRY. It
 *    never selects a module, path or function dynamically, and an unknown value is rejected with a clear
 *    error, never silently mapped to a default.
 *  - PINNED CONTRACT. Each registry entry pins the assessment schema version it serves. If the scanner ever
 *    returns a different one, the request fails closed rather than exposing an unpinned shape.
 *  - EXPLICIT RESPONSE ALLOWLIST. The response is built from named fields only. Anything else the scanner
 *    returns (for example its normalized package model) is never forwarded.
 *  - NOT A SAVED SCAN. A profile assessment is not persisted, not counted against the monthly scan quota,
 *    does not touch the audit log or webhooks, and is NOT signed (attestation stays untouched; signed
 *    inclusion belongs to a deliberate attestation schema bump). It has its own rate limit, like verify-fix.
 */

/** The public identifier leaves room for future OWASP revisions; the pinned commit and Agent Verify profile version are carried in the response. */
export const OWASP_AGENTIC_SKILLS_PROFILE_ID = 'owasp-agentic-skills-2026'

export interface ProfileDefinition {
  readonly id: string
  /** The assessment schema version this profile serves; a mismatch from the scanner fails closed. */
  readonly assessmentSchemaVersion: string
  readonly assess: (files: SkillPackageFileInput[]) => Promise<SkillAstAssessmentResult>
}

export type ProfileRegistry = ReadonlyMap<string, ProfileDefinition>

export const PROFILE_REGISTRY: ProfileRegistry = new Map<string, ProfileDefinition>([
  [OWASP_AGENTIC_SKILLS_PROFILE_ID, { id: OWASP_AGENTIC_SKILLS_PROFILE_ID, assessmentSchemaVersion: '1.1.0', assess: assessSkillPackageAst }],
])

/** Mirrors the scanner's own file-count limit so an absurd array is refused before it is handed over. The scanner enforces the real limits. */
export const MAX_PROFILE_FILES = 500
export const PROFILE_RATE_LIMIT = { limit: 30, windowMs: 60 * 60 * 1000 }
export const PROFILE_ASSESSMENT_TIMEOUT_MS = 10_000

/** Scanner rejection codes that are SIZE limits: reported as 413, like the file-count limit and the body ceiling. */
const SIZE_REJECTION_CODES: ReadonlySet<string> = new Set(['too_many_files', 'file_too_large', 'package_too_large'])

/** Fields that would silently change what a request means; a profile request must not carry them. */
const UNSUPPORTED_WITH_PROFILE = ['content', 'policyId', 'organizationId'] as const

export interface ProfileResponse {
  status: number
  body: Record<string, unknown>
}

const fail = (status: number, body: Record<string, unknown>): ProfileResponse => ({ status, body })

/**
 * Handles a /v1/scan request that carries an explicit `profile`. The caller has already authenticated the
 * request and decided a profile was requested (`body.profile !== undefined`).
 */
export async function handleProfileRequest(
  body: Record<string, unknown>,
  uid: string,
  registry: ProfileRegistry = PROFILE_REGISTRY,
  options: { timeoutMs?: number } = {},
): Promise<ProfileResponse> {
  // 1. The profile must be a string that is an exact key of the closed registry.
  const requested = body.profile
  const supported = [...registry.keys()]
  if (typeof requested !== 'string' || !registry.has(requested)) {
    return fail(400, { error: 'Unknown or invalid profile', supportedProfiles: supported })
  }
  const definition = registry.get(requested)!

  // 2. Reject fields that would make the request ambiguous or trigger persistence this path does not perform.
  const conflicting = UNSUPPORTED_WITH_PROFILE.filter(key => body[key] !== undefined)
  if (conflicting.length > 0) {
    return fail(400, { error: `A profile request cannot include: ${conflicting.join(', ')}` })
  }

  // 3. Shape of the package. Only structure is checked here; paths and contents are the scanner's to judge.
  const rawFiles = body.files
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    return fail(400, { error: 'files is required for a profile request: a non-empty array of { path, content }' })
  }
  if (rawFiles.length > MAX_PROFILE_FILES) {
    return fail(413, { error: `files exceeds the ${MAX_PROFILE_FILES}-file limit` })
  }
  const files: SkillPackageFileInput[] = []
  for (const entry of rawFiles) {
    if (entry === null || typeof entry !== 'object' || typeof (entry as { path?: unknown }).path !== 'string' || typeof (entry as { content?: unknown }).content !== 'string') {
      return fail(400, { error: 'every entry in files must be an object with string path and string content' })
    }
    // Only path and content are passed on. Extra fields (including an archive-layer `kind`) are dropped.
    files.push({ path: (entry as { path: string }).path, content: (entry as { content: string }).content })
  }

  // 4. Independent, per-user rate limit (a package assessment is not a metered scan, but it is not unbounded either).
  if (isRateLimited(`profile-assessment:${uid}`, PROFILE_RATE_LIMIT.limit, PROFILE_RATE_LIMIT.windowMs)) {
    return fail(429, { error: 'Too many profile assessments this hour. Try again later.' })
  }

  // 5. Hand the package to the private scanner; return its frozen assessment through an explicit allowlist.
  // Anything that goes wrong from here is a generic 500 — including a hung assessor, a malformed result and
  // a schema mismatch — and never surfaces as a client error or leaks internal detail.
  const internalFailure = (why: string): ProfileResponse => {
    console.error('Profile assessment failed:', why) // reason only; never request content
    return fail(500, { error: 'Profile assessment failed' })
  }
  try {
    const result = await withTimeout(definition.assess(files), options.timeoutMs ?? PROFILE_ASSESSMENT_TIMEOUT_MS)
    if (result === null || typeof result !== 'object' || typeof (result as { ok?: unknown }).ok !== 'boolean') return internalFailure('malformed assessor result')
    if (!result.ok) {
      const rejection = result.rejection
      if (rejection === null || typeof rejection !== 'object' || typeof rejection.code !== 'string' || typeof rejection.message !== 'string') return internalFailure('malformed rejection')
      const { code, message, path } = rejection
      // Size limits are 413; every other package rejection (paths, duplicates, entry kinds, encoding) is 422.
      return fail(SIZE_REJECTION_CODES.has(code) ? 413 : 422, { error: 'Package rejected', rejection: { code, message, ...(path !== undefined ? { path } : {}) } })
    }
    const assessment: SkillAstAssessment = result.assessment
    if (assessment === null || typeof assessment !== 'object' || assessment.schemaVersion !== definition.assessmentSchemaVersion) {
      return internalFailure(`schema mismatch for ${definition.id}`)
    }
    // The assessment states which interpretation it is (profile.profileId); it must be the one that was requested. A mismatch is a
    // scanner or registry bug and fails closed: it is never returned, because a signature over it could not be trusted to mean what it says.
    const stated = (assessment.profile as { profileId?: unknown } | null | undefined)?.profileId
    if (stated !== definition.id) return internalFailure(`profile mismatch for ${definition.id}`)
    return {
      status: 200,
      body: {
        profile: definition.id,
        // Returned exactly as the scanner produced it: not reinterpreted, enriched, reordered or filtered.
        // THE WORKER IS NOT THE SIGNING BOUNDARY. This unsigned response may contain values outside the signed-content numeric
        // profile (safe integers only) and that is deliberate. When `attest: true` exists, the admission check MUST run on the
        // assessment after it is generated and BEFORE any signing operation, and an assessment that is not admitted must never be
        // signed (see docs/attestation-profile-design.md, section 10). Nothing here signs, admits or rejects numbers.
        assessment,
        // Unsigned by design in this version: signed inclusion waits for a deliberate attestation schema bump.
        attestation: null,
        saved: false,
      },
    }
  } catch (e) {
    return internalFailure(e instanceof Error ? e.message : 'unknown error')
  }
}

/** Rejects if `work` has not settled in time. Cannot preempt synchronous CPU work (the runtime's own CPU limit does that); it bounds a hung await. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('assessment timed out')), ms) })
  return Promise.race([work, timeout]).finally(() => { if (timer !== undefined) clearTimeout(timer) })
}
