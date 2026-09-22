// REFERENCE / TEST-ONLY (vector set v4). Not the product implementation. See conformance/v4/README.md.
//
// VERIFIER POLICY: strict and FAIL-CLOSED.
//
// A policy is what the VERIFIER requires. It is supplied by the verifier's own code or configuration, never by the bundle. The v2
// evaluator trusted its input: a policy with a misspelled key, a string where a list belongs, a missing or garbage clock, or a
// property inherited from a prototype silently produced SATISFIED (fail-open). In v3 nothing about a policy is assumed:
//
//   * The policy must be a PLAIN object with an exact schema. An unknown key, a non-plain object (a class instance, or an object
//     with a non-default prototype, so that an inherited value could stand in for a constraint) and any symbol-keyed property make
//     the policy INVALID. Constraints are read from OWN properties only.
//   * Every constraint has an exact type and form. A wrong type, an empty allowlist, a duplicate, a malformed commit or digest,
//     a non-integer or negative maxAgeSeconds, a missing or non-canonical `now` when maxAgeSeconds is present: INVALID.
//   * An INVALID policy yields { status: 'INVALID_POLICY', failures: [...] } and can NEVER yield SATISFIED.
//
// AGE. maxAgeSeconds bounds (now - issuedAt), where `now` is a canonical timestamp supplied by the verifier (this reference has no
// clock of its own) and issuedAt is the SIGNER'S CLAIM, not trusted time. age <= maxAgeSeconds satisfies the bound (the boundary is
// inclusive); age > maxAgeSeconds fails (TOO_OLD); an issuedAt AFTER now is ISSUED_AT_IN_FUTURE and fails the policy. Both
// timestamps are judged by the one strict timestamp parser (timestamp.mjs); there is no Date.parse anywhere.

import { COMMIT, CONTROL_ID, PACKAGE_DIGEST, PROFILE_ID, isNonNegativeSafeInteger, isPlain, isUniqueStringArray } from './plain.mjs'
import { parseTimestamp } from './timestamp.mjs'

export const POLICY_KEYS = Object.freeze(['acceptedKeyStates', 'requiredProfile', 'allowedUpstreamCommits', 'requiredControls', 'requiredPackageDigest', 'maxAgeSeconds', 'now'])
/** Only these key states can ever be ACCEPTED. KEY_REVOKED can never be accepted, so a policy that lists it is invalid. */
export const ACCEPTABLE_KEY_STATES = Object.freeze(['KEY_ACTIVE', 'KEY_RETIRED'])
/** The reference default: current keys only. Historical or offline verification opts into KEY_RETIRED explicitly. */
export const DEFAULT_ACCEPTED_KEY_STATES = Object.freeze(['KEY_ACTIVE'])

/** Every INVALID_POLICY reason. The tests require at least one vector per code. */
export const INVALID_POLICY_CODES = Object.freeze([
  'POLICY_NOT_PLAIN', 'POLICY_UNKNOWN_KEY', 'ACCEPTED_KEY_STATES_INVALID', 'REQUIRED_PROFILE_INVALID', 'ALLOWED_UPSTREAM_COMMITS_INVALID',
  'REQUIRED_CONTROLS_INVALID', 'REQUIRED_PACKAGE_DIGEST_INVALID', 'MAX_AGE_SECONDS_INVALID', 'NOW_INVALID', 'NOW_REQUIRED',
])
/** Every NOT_SATISFIED reason. */
export const POLICY_FAILURE_CODES = Object.freeze([
  'INTERPRETATION_UNSUPPORTED', 'KEY_STATE_NOT_ACCEPTED', 'PROFILE_NOT_ALLOWED', 'UPSTREAM_COMMIT_NOT_ALLOWED', 'CONTROLS_NOT_COVERED',
  'PACKAGE_DIGEST_MISMATCH', 'TOO_OLD', 'ISSUED_AT_IN_FUTURE',
])

const has = (o, k) => Object.hasOwn(o, k)

/** Returns an array of INVALID_POLICY codes (empty when the policy is valid), in a fixed order. */
export function policyProblems(policy) {
  if (!isPlain(policy) || Object.getOwnPropertySymbols(policy).length > 0) return ['POLICY_NOT_PLAIN']
  const problems = []
  if (Object.keys(policy).some(k => !POLICY_KEYS.includes(k))) problems.push('POLICY_UNKNOWN_KEY')
  if (has(policy, 'acceptedKeyStates') && !(isUniqueStringArray(policy.acceptedKeyStates, s => ACCEPTABLE_KEY_STATES.includes(s)) && policy.acceptedKeyStates.length > 0)) problems.push('ACCEPTED_KEY_STATES_INVALID')
  if (has(policy, 'requiredProfile') && !(typeof policy.requiredProfile === 'string' && PROFILE_ID.test(policy.requiredProfile))) problems.push('REQUIRED_PROFILE_INVALID')
  if (has(policy, 'allowedUpstreamCommits') && !(isUniqueStringArray(policy.allowedUpstreamCommits, c => typeof c === 'string' && COMMIT.test(c)) && policy.allowedUpstreamCommits.length > 0)) problems.push('ALLOWED_UPSTREAM_COMMITS_INVALID')
  if (has(policy, 'requiredControls') && !isUniqueStringArray(policy.requiredControls, c => typeof c === 'string' && CONTROL_ID.test(c))) problems.push('REQUIRED_CONTROLS_INVALID')
  if (has(policy, 'requiredPackageDigest') && !(typeof policy.requiredPackageDigest === 'string' && PACKAGE_DIGEST.test(policy.requiredPackageDigest))) problems.push('REQUIRED_PACKAGE_DIGEST_INVALID')
  if (has(policy, 'maxAgeSeconds') && !isNonNegativeSafeInteger(policy.maxAgeSeconds)) problems.push('MAX_AGE_SECONDS_INVALID')
  if (has(policy, 'now') && parseTimestamp(policy.now) === null) problems.push('NOW_INVALID')
  if (has(policy, 'maxAgeSeconds') && !has(policy, 'now')) problems.push('NOW_REQUIRED')
  return problems
}

/** Policy evaluation. `payload.issuedAt` is already known canonical (the payload was validated before this runs). */
export function evaluatePolicy(payload, keyState, interpretation, policy) {
  const problems = policyProblems(policy)
  if (problems.length > 0) return { status: 'INVALID_POLICY', failures: problems }

  const accepted = has(policy, 'acceptedKeyStates') ? policy.acceptedKeyStates : DEFAULT_ACCEPTED_KEY_STATES
  const failures = []
  if (interpretation !== 'SUPPORTED') failures.push('INTERPRETATION_UNSUPPORTED')
  if (!accepted.includes(keyState)) failures.push('KEY_STATE_NOT_ACCEPTED')
  if (has(policy, 'requiredProfile') && payload.profile !== policy.requiredProfile) failures.push('PROFILE_NOT_ALLOWED')
  if (has(policy, 'allowedUpstreamCommits') && !policy.allowedUpstreamCommits.includes(payload.upstream.commit)) failures.push('UPSTREAM_COMMIT_NOT_ALLOWED')
  if (has(policy, 'requiredControls') && !policy.requiredControls.every(c => payload.implementedControls.includes(c))) failures.push('CONTROLS_NOT_COVERED')
  if (has(policy, 'requiredPackageDigest') && payload.package.digest !== policy.requiredPackageDigest) failures.push('PACKAGE_DIGEST_MISMATCH')
  if (has(policy, 'maxAgeSeconds')) {
    const ageMs = parseTimestamp(policy.now).ms - parseTimestamp(payload.issuedAt).ms
    if (ageMs < 0) failures.push('ISSUED_AT_IN_FUTURE')
    else if (ageMs > policy.maxAgeSeconds * 1000) failures.push('TOO_OLD')
  }
  return { status: failures.length === 0 ? 'SATISFIED' : 'NOT_SATISFIED', failures }
}

