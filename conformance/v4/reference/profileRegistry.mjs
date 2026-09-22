// REFERENCE / TEST-ONLY (vector set v4). Not the product implementation. See conformance/v4/README.md.
//
// THE AUTHORITATIVE, CLOSED PROFILE REGISTRY.
//
// In v2 the registry pinned only (profileId, framework, profileVersion). Everything else about a profile, including WHICH upstream
// document and commit it was assessed against, was whatever the signer wrote, so a validly signed assessment against the wrong
// (or an attacker-chosen) upstream commit, or with fewer implemented controls, could still be called SUPPORTED.
//
// In v3 each (profileId, profileVersion) pair pins everything that DEFINES the profile:
//
//   framework                   the framework identifier
//   upstream.repo / commit / license / status    the exact upstream repository, the exact pinned commit, its licence, its status
//   controlUniverse             every control the framework defines, in order
//   implementedControls         the controls this profile version assesses, in order
//                               (notImplementedControls is then DEFINED as controlUniverse minus implementedControls, in order)
//   assessmentSchemaVersion     the assessment schema this profile version is expressed in
//
// Any pinned value that differs makes the interpretation PROFILE_DEFINITION_MISMATCH: not SUPPORTED, and it cannot satisfy a policy.
//
// WHAT IS NOT PINNED, ON PURPOSE: scannerVersion, assessmentEngineVersion, riskRubricVersion, keyAllowlistVersion and
// normalizationVersion. They are the interpretation versions (design D10): a new engine or rubric changes the assessment WITHOUT
// changing the profile definition, and each must be bound INDEPENDENTLY in the payload and in the assessment (that is the
// cross-check registry's job), so that changing any one of them changes the signed bytes.
//
// The registry is a closed table looked up by OWN key: "constructor", "__proto__" and every other inherited name are unknown.

const deepFreeze = o => { for (const v of Object.values(o)) if (typeof v === 'object' && v !== null) deepFreeze(v); return Object.freeze(o) }

export const PROFILE_REGISTRY = deepFreeze({
  'owasp-agentic-skills-2026': {
    versions: {
      '1.0.0-alpha.1': {
        framework: 'OWASP_AGENTIC_SKILLS_TOP_10',
        upstream: {
          repo: 'OWASP/www-project-agentic-skills-top-10',
          commit: 'd6f7d7d0de314f52a83a85d1828e06ab096e595c',
          license: 'CC-BY-SA-4.0',
          status: 'public-review',
        },
        controlUniverse: ['AST01', 'AST02', 'AST03', 'AST04', 'AST05', 'AST06', 'AST07', 'AST08', 'AST09', 'AST10'],
        implementedControls: ['AST02', 'AST03', 'AST04'],
        assessmentSchemaVersion: '1.1.0',
      },
    },
  },
})

/** The stable reasons profileDefinitionProblem can return. The tests require a vector (or a unit test, for non-JSON options) per code. */
export const PROFILE_DEFINITION_PROBLEM_CODES = Object.freeze([
  'profile.framework', 'profile.upstream.repo', 'profile.upstream.commit', 'profile.upstream.license', 'profile.upstream.status',
  'profile.implemented-controls', 'profile.not-implemented-controls', 'profile.assessment-schema-version',
])

/** Own-key lookup. Returns { definition } or { problem: 'UNSUPPORTED_PROFILE' | 'UNSUPPORTED_PROFILE_VERSION' }. */
export function lookupProfile(registry, profileId, profileVersion) {
  const entry = typeof profileId === 'string' && Object.hasOwn(registry, profileId) ? registry[profileId] : undefined
  if (!entry) return { problem: 'UNSUPPORTED_PROFILE' }
  const definition = typeof profileVersion === 'string' && Object.hasOwn(entry.versions, profileVersion) ? entry.versions[profileVersion] : undefined
  if (!definition) return { problem: 'UNSUPPORTED_PROFILE_VERSION' }
  return { definition }
}

const sameList = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i])

/**
 * Compares a STRUCTURALLY VALID assessment (assessmentSchemaProblem returned null) with the registry definition. Returns null when
 * every pinned value matches, otherwise the first differing reason. Only the assessment is read: the payload's duplicated fields are
 * bound to it by the cross-check registry, so they cannot differ once the bindings have passed.
 */
export function profileDefinitionProblem(definition, assessment) {
  const p = assessment.profile
  if (p.framework !== definition.framework) return 'profile.framework'
  if (p.upstreamRepo !== definition.upstream.repo) return 'profile.upstream.repo'
  if (p.upstreamCommit !== definition.upstream.commit) return 'profile.upstream.commit'
  if (p.upstreamLicense !== definition.upstream.license) return 'profile.upstream.license'
  if (p.upstreamStatus !== definition.upstream.status) return 'profile.upstream.status'
  if (!sameList(p.implementedControls, definition.implementedControls)) return 'profile.implemented-controls'
  const expectedNotImplemented = definition.controlUniverse.filter(c => !definition.implementedControls.includes(c))
  if (!sameList(assessment.notImplementedControls, expectedNotImplemented)) return 'profile.not-implemented-controls'
  if (assessment.schemaVersion !== definition.assessmentSchemaVersion) return 'profile.assessment-schema-version'
  return null
}
