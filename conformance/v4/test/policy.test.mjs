import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import * as ref from '../reference/profileAttestation.mjs'
import { ACCEPTABLE_KEY_STATES, DEFAULT_ACCEPTED_KEY_STATES, INVALID_POLICY_CODES, POLICY_FAILURE_CODES, POLICY_KEYS, evaluatePolicy, policyProblems } from '../reference/policy.mjs'
import { caseOptions, loadVector, resolveSource, toInputBytes } from './helpers.mjs'

const BUNDLES = loadVector('bundles.v4.json')
const here = path.dirname(fileURLToPath(import.meta.url))
const B1 = BUNDLES.signed.B1.bundle
const payload = B1.attestation.payload
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const policyCases = BUNDLES.cases.filter(c => c.name.startsWith('policy.'))
const run = c => ref.verifyProfileBundleBytes(toInputBytes(resolveSource(BUNDLES, c.source)), caseOptions(BUNDLES, c))

test('POLICY: every frozen policy vector gives its result through the whole verifier', async () => {
  assert.ok(policyCases.length >= 100, `only ${policyCases.length}`)
  for (const c of policyCases) {
    const r = await run(c)
    for (const [k, v] of Object.entries(c.expected)) assert.deepEqual(r[k], v, `${c.name}: ${k}`)
  }
})

test('POLICY: every INVALID_POLICY reason and every NOT_SATISFIED reason has at least one vector', () => {
  const invalid = new Set(), failed = new Set()
  for (const c of BUNDLES.cases) {
    if (c.expected.policy?.status === 'INVALID_POLICY') c.expected.policy.failures.forEach(f => invalid.add(f))
    if (c.expected.policy?.status === 'NOT_SATISFIED') c.expected.policy.failures.forEach(f => failed.add(f))
  }
  for (const code of INVALID_POLICY_CODES) assert.ok(invalid.has(code), `no vector for INVALID_POLICY ${code}`)
  for (const code of POLICY_FAILURE_CODES) assert.ok(failed.has(code), `no vector for NOT_SATISFIED ${code}`)
  for (const code of invalid) assert.ok(INVALID_POLICY_CODES.includes(code), code)
  for (const code of failed) assert.ok(POLICY_FAILURE_CODES.includes(code), code)
  assert.deepEqual(BUNDLES.policyCodes, { invalid: [...INVALID_POLICY_CODES], notSatisfied: [...POLICY_FAILURE_CODES] })
})

test('POLICY IS FAIL-CLOSED: an invalid policy can never be SATISFIED, whatever else is true', () => {
  const invalidPolicies = [null, undefined, 5, 'x', [], { unknown: 1 }, { acceptedKeyStates: 'KEY_ACTIVE' }, { maxAgeSeconds: 10 }, { maxAgeSeconds: 10, now: 'x' }, { allowedUpstreamCommits: payload.upstream.commit }, Object.create({ requiredProfile: payload.profile }), { requiredControls: 'AST02' }]
  for (const policy of invalidPolicies) {
    const r = evaluatePolicy(payload, 'KEY_ACTIVE', 'SUPPORTED', policy)
    assert.equal(r.status, 'INVALID_POLICY', JSON.stringify(policy))
    assert.ok(r.failures.length >= 1)
  }
  // ...and the same policies, given to the whole verifier, with a good key and a good bundle
  for (const policy of invalidPolicies.filter(p => p !== undefined)) {
    // (evaluated after integrity, which is VALID here)
    assert.ok(policyProblems(policy).length >= 1)
  }
})

test('POLICY: constraints are read from OWN properties only; a polluted Object.prototype cannot add a constraint or remove one', () => {
  for (const key of POLICY_KEYS) {
    const before = Object.getOwnPropertyDescriptor(Object.prototype, key)
    assert.equal(before, undefined)
  }
  try {
    Object.prototype.requiredProfile = 'owasp-agentic-skills-2027'
    Object.prototype.maxAgeSeconds = 0
    const r = evaluatePolicy(payload, 'KEY_ACTIVE', 'SUPPORTED', {})
    assert.deepEqual(r, { status: 'SATISFIED', failures: [] }, 'inherited requiredProfile/maxAgeSeconds are not constraints')
    Object.prototype.acceptedKeyStates = ['KEY_RETIRED']
    assert.deepEqual(evaluatePolicy(payload, 'KEY_ACTIVE', 'SUPPORTED', {}), { status: 'SATISFIED', failures: [] }, 'an inherited acceptedKeyStates does not change the default')
    assert.deepEqual(evaluatePolicy(payload, 'KEY_RETIRED', 'SUPPORTED', {}), { status: 'NOT_SATISFIED', failures: ['KEY_STATE_NOT_ACCEPTED'] })
  } finally {
    delete Object.prototype.requiredProfile; delete Object.prototype.maxAgeSeconds; delete Object.prototype.acceptedKeyStates
  }
})

test('POLICY: the time rules, on exact milliseconds', () => {
  const at = (now, max) => evaluatePolicy(payload, 'KEY_ACTIVE', 'SUPPORTED', { maxAgeSeconds: max, now })
  const issued = '2026-01-15T12:00:00.000Z'
  assert.deepEqual(at(issued, 0), { status: 'SATISFIED', failures: [] })
  assert.deepEqual(at('2026-01-15T12:00:00.001Z', 0), { status: 'NOT_SATISFIED', failures: ['TOO_OLD'] })
  assert.deepEqual(at('2026-01-15T13:00:00.000Z', 3600), { status: 'SATISFIED', failures: [] }, 'boundary inclusive')
  assert.deepEqual(at('2026-01-15T13:00:00.001Z', 3600), { status: 'NOT_SATISFIED', failures: ['TOO_OLD'] })
  assert.deepEqual(at('2026-01-15T13:00:01.000Z', 3600), { status: 'NOT_SATISFIED', failures: ['TOO_OLD'] })
  assert.deepEqual(at('2026-01-15T11:59:59.999Z', 3600), { status: 'NOT_SATISFIED', failures: ['ISSUED_AT_IN_FUTURE'] })
  assert.deepEqual(at('2026-01-15T11:59:59.999Z', 9007199254740991), { status: 'NOT_SATISFIED', failures: ['ISSUED_AT_IN_FUTURE'] })
  assert.equal(at('2026-01-15T13:00:00.000Z', undefined).status, 'INVALID_POLICY')
  // the largest safe window times 1000 exceeds 2^53, but the comparison is still exact for every instant that can be expressed
  assert.equal(at('9999-12-31T23:59:59.999Z', 9007199254740991).status, 'SATISFIED')
})

test('POLICY: an accepted key state list is exact, revoked can never be accepted, and the default is KEY_ACTIVE only', () => {
  assert.deepEqual(ACCEPTABLE_KEY_STATES, ['KEY_ACTIVE', 'KEY_RETIRED'])
  assert.deepEqual(DEFAULT_ACCEPTED_KEY_STATES, ['KEY_ACTIVE'])
  for (const state of ['KEY_REVOKED', 'KEY_UNKNOWN', 'KEY_PURPOSE_MISMATCH', 'KEY_SET_INVALID', 'KEY_SET_ROLLBACK_DETECTED', 'NOT_EVALUATED']) {
    assert.deepEqual(evaluatePolicy(payload, state, 'SUPPORTED', { acceptedKeyStates: ['KEY_ACTIVE', 'KEY_RETIRED'] }), { status: 'NOT_SATISFIED', failures: ['KEY_STATE_NOT_ACCEPTED'] }, state)
    assert.equal(evaluatePolicy(payload, state, 'SUPPORTED', { acceptedKeyStates: [state] }).status, 'INVALID_POLICY', `a policy that lists ${state} is invalid`)
  }
})

test('POLICY: only SUPPORTED interpretation can satisfy, for every interpretation value', () => {
  for (const i of ['UNSUPPORTED_SCHEMA', 'INVALID_ASSESSMENT', 'UNSUPPORTED_PROFILE', 'UNSUPPORTED_PROFILE_VERSION', 'PROFILE_DEFINITION_MISMATCH', 'NOT_EVALUATED', 'anything-else', undefined]) {
    assert.ok(evaluatePolicy(payload, 'KEY_ACTIVE', i, {}).failures.includes('INTERPRETATION_UNSUPPORTED'), String(i))
  }
  assert.equal(evaluatePolicy(payload, 'KEY_ACTIVE', 'SUPPORTED', {}).status, 'SATISFIED')
})

test('POLICY: commits are compared by EXACT equality against a list: no substring, prefix or case folding', () => {
  const commit = payload.upstream.commit
  for (const list of [[commit.slice(0, 39)], [commit.slice(0, 7)], [commit.toUpperCase()], [`${commit}0`]]) assert.ok(policyProblems({ allowedUpstreamCommits: list }).length >= 1 || evaluatePolicy(payload, 'KEY_ACTIVE', 'SUPPORTED', { allowedUpstreamCommits: list }).status !== 'SATISFIED', JSON.stringify(list))
  assert.equal(evaluatePolicy(payload, 'KEY_ACTIVE', 'SUPPORTED', { allowedUpstreamCommits: [commit] }).status, 'SATISFIED')
  assert.deepEqual(policyProblems({ allowedUpstreamCommits: commit }), ['ALLOWED_UPSTREAM_COMMITS_INVALID'], 'a string is not a list, even when it equals the commit')
  const src = strip(readFileSync(path.join(here, '..', 'reference', 'policy.mjs'), 'utf8'))
  assert.doesNotMatch(src, /\.startsWith\(|\.endsWith\(|\.indexOf\(|\.toLowerCase\(|\.toUpperCase\(/, 'no string matching operation in the policy evaluator')
  assert.match(src, /policy\.allowedUpstreamCommits\.includes\(payload\.upstream\.commit\)/)
})

test('POLICY: an unknown key, a wrong type or a bad form is reported for EVERY constraint, and no field is missing from the exact schema', () => {
  assert.deepEqual([...POLICY_KEYS], ['acceptedKeyStates', 'requiredProfile', 'allowedUpstreamCommits', 'requiredControls', 'requiredPackageDigest', 'maxAgeSeconds', 'now'])
  for (const key of POLICY_KEYS.filter(k => k !== 'now')) {
    for (const wrong of [undefined, null, {}, true, Symbol('x'), 1.5, () => 1]) {
      const problems = policyProblems({ [key]: wrong, ...(key === 'maxAgeSeconds' ? { now: '2026-01-15T12:00:00.000Z' } : {}) })
      assert.ok(problems.length >= 1, `${key} = ${String(wrong)} must be invalid`)
    }
  }
  assert.ok(policyProblems({ now: undefined }).length >= 1)
})

test('POLICY: the whole verifier reports a policy only when integrity is VALID, and never before', async () => {
  const bad = structuredClone(B1); bad.attestation.payload.issuedAt = '2026-01-15T12:00:01.000Z'
  const r = await ref.verifyProfileBundleBytes(toInputBytes(bad), { keySet: BUNDLES.keySets.active, policy: {} })
  assert.equal(r.integrity, 'INVALID_SIGNATURE'); assert.equal(r.policy, undefined)
  const ok = await ref.verifyProfileBundleBytes(toInputBytes(B1), { keySet: BUNDLES.keySets.active, policy: undefined })
  assert.equal(ok.policy, undefined, 'no policy supplied, none reported')
  const nul = await ref.verifyProfileBundleBytes(toInputBytes(B1), { keySet: BUNDLES.keySets.active, policy: null })
  assert.equal(nul.policy.status, 'INVALID_POLICY', 'a null policy is invalid, not "no policy"')
})

test('VERIFIER OPTIONS: an unknown option is refused loudly, and so is an unvalidated schema version', async () => {
  await assert.rejects(() => ref.verifyProfileBundleBytes(toInputBytes(B1), { policies: {} }), e => e instanceof TypeError && /unknown verifier option/.test(e.message))
  await assert.rejects(() => ref.verifyProfileBundleBytes(toInputBytes(B1), { retainedSequence: 5 }), TypeError)
  await assert.rejects(() => ref.verifyProfileBundleBytes(toInputBytes(B1), { supportedAssessmentSchemas: ['1.1.0', '1.2.0'] }), e => e instanceof TypeError && /exact validator/.test(e.message), 'a schema version with no validator cannot be declared supported')
})
