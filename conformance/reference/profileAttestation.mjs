// REFERENCE / TEST-ONLY. Not the product implementation and not for import from product code. See conformance/README.md.
//
// A verification-only reference for the profile-assessment attestation described in docs/attestation-profile-design.md.
// It contains NO signing code and touches no private key. It exists so that every conformance vector has an executable,
// independently reviewable statement of what "correct" means, and so the product implementation (later) has something to
// be checked against that it did not write itself.
//
// Result model (design D8): integrity, key state, interpretation and policy are separate results. There is no boolean.
//
//   integrity      VALID | MALFORMED | UNSUPPORTED_BUNDLE_VERSION | UNSUPPORTED_TYPE | UNSUPPORTED_VERSION
//                  | UNSUPPORTED_ALGORITHM | INVALID_SIGNATURE | BINDING_MISMATCH
//   keyState       KEY_ACTIVE | KEY_RETIRED | KEY_REVOKED
//                  | KEY_UNKNOWN | KEY_PURPOSE_MISMATCH | KEY_SET_INVALID | KEY_SET_ROLLBACK_DETECTED
//                  | NOT_EVALUATED                     (no key set supplied, or integrity was not VALID)
//                  A key STATE says what the supplied key set records about the key. It does not say the key is trusted, and it
//                  says nothing about WHEN the signature was made: issuedAt is a signer claim and is never compared to a key date.
//   interpretation SUPPORTED | UNSUPPORTED_SCHEMA | UNSUPPORTED_PROFILE | UNSUPPORTED_PROFILE_VERSION | NOT_EVALUATED
//   policy         { status: SATISFIED | NOT_SATISFIED | INVALID_POLICY, failures: [...] }   (only when a policy was supplied and integrity is VALID)
//
// Integrity is cryptographic and structural. Interpretation is whether this verifier may READ the assessment. They are separate,
// and an unsupported interpretation is never turned into INVALID_SIGNATURE. But nothing unsupported can satisfy a policy.
//
// A legacy scan attestation (a bare attestation with no `attestationType` in its payload) is not verified here; it is ROUTED
// to the unchanged legacy verifier (route LEGACY_SCAN_ATTESTATION), as design section 3.3 requires.

import { ASSESSMENT_TAG, ATTESTATION_TYPE, PACKAGE_TAG, PAYLOAD_TAG, PROFILE_DOMAIN, PROFILE_KEY_PURPOSE } from './domains.mjs'
import { canonicalize, canonicalizeSigned, signedBytes } from './jcs.mjs'
import { numberProblem } from './numberProfile.mjs'
import { isWellFormedString, parseStrictJson } from './strictJson.mjs'

export { ASSESSMENT_TAG, ATTESTATION_TYPE, PAYLOAD_TAG, PROFILE_KEY_PURPOSE }
export const ATTESTATION_VERSION = '1.0.0'
export const ALGORITHM = 'ECDSA-P256-SHA256'
export const BUNDLE_VERSION = '1.0.0'
export const SUPPORTED_BUNDLE_VERSIONS = Object.freeze(['1.0.0'])
export const KEY_SET_VERSION = '1.0.0'
export const SUPPORTED_ASSESSMENT_SCHEMAS = Object.freeze(['1.1.0'])
/** Bundle text larger than this is refused before it is parsed (16 MiB of UTF-8). Objects must be bounded by the caller before parsing. */
export const MAX_BUNDLE_TEXT_BYTES = 16 * 1024 * 1024
export const INTERPRETATION_VERSION_KEYS = Object.freeze(['scannerVersion', 'assessmentEngineVersion', 'riskRubricVersion', 'keyAllowlistVersion', 'normalizationVersion'])

/** The CLOSED registry of profiles this verifier can interpret. An id, framework or version outside it is never interpreted. */
export const SUPPORTED_PROFILES = Object.freeze({
  'owasp-agentic-skills-2026': Object.freeze({ framework: 'OWASP_AGENTIC_SKILLS_TOP_10', profileVersions: Object.freeze(['1.0.0-alpha.1']) }),
})

const enc = new TextEncoder()
const subtle = globalThis.crypto.subtle
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
const concat = (a, b) => { const out = new Uint8Array(a.length + b.length); out.set(a, 0); out.set(b, a.length); return out }
const toBase64 = bytes => Buffer.from(bytes).toString('base64')
const toBase64Url = bytes => Buffer.from(bytes).toString('base64url')

// ── P-256 signatures: the Agent Verify canonical form ────────────────────────────────────────
//
// LOW-S IS AN AGENT VERIFY CANONICAL-SIGNATURE RULE. It is NOT an RFC 7518 (JWA) or RFC 7515 requirement: ES256 as specified
// there accepts both (r, s) and (r, n - s). This rule is applied to the NEW profile-attestation type only; the legacy scan
// attestation verifier is unchanged and accepts both forms. What it does: removes the third-party malleability of a given
// signature (anyone can turn (r, s) into (r, n - s)). What it does not do: make signatures unique. ECDSA is randomized, so
// two signatures of the same message differ; nothing may use a signature as an identity.
export const P256_ORDER = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n
/** floor(n / 2): the largest admitted s. */
export const P256_HALF_ORDER = P256_ORDER / 2n

/** null when 1 <= r < n and 1 <= s <= floor(n/2); otherwise the reason. Runs BEFORE any cryptographic verification. */
export function signatureProblem(bytes) {
  if (bytes.length !== 64) return 'signature.range'
  const r = BigInt(`0x${Buffer.from(bytes.subarray(0, 32)).toString('hex')}`)
  const s = BigInt(`0x${Buffer.from(bytes.subarray(32)).toString('hex')}`)
  if (r < 1n || r >= P256_ORDER || s < 1n || s >= P256_ORDER) return 'signature.range'
  if (s > P256_HALF_ORDER) return 'signature.high-s'
  return null
}

// ── Digests, signing input, key id ───────────────────────────────────────────────────────────

/** "avassess-sha256:" + hex( SHA-256( UTF8(tag) || UTF8(JCS(assessment)) ) ), JCS under the signed-content numeric profile. */
export async function assessmentDigest(assessment) {
  return `avassess-sha256:${hex(await subtle.digest('SHA-256', concat(enc.encode(ASSESSMENT_TAG), signedBytes(assessment))))}`
}

/** UTF8("agentverify-attestation/profile-assessment/v1\n") || UTF8(JCS(payload)) */
export function signingInput(payload) {
  return concat(enc.encode(PAYLOAD_TAG), signedBytes(payload))
}

/** RFC 7638: base64url( SHA-256( JCS of the required members in lexicographic order ) ). EC: crv, kty, x, y. RSA: e, kty, n. Nothing else, ever. */
export async function rfc7638Thumbprint(jwk) {
  let members
  if (jwk?.kty === 'EC') members = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }
  else if (jwk?.kty === 'RSA') members = { e: jwk.e, kty: jwk.kty, n: jwk.n }
  else throw new Error('unsupported key type for a thumbprint')
  return toBase64Url(await subtle.digest('SHA-256', enc.encode(canonicalize(members))))
}

/** The Agent Verify key id: the RFC 7638 thumbprint of a P-256 public JWK whose coordinates were already checked canonical. */
export const keyIdOf = rfc7638Thumbprint

const isPlain = v => typeof v === 'object' && v !== null && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)
const exactKeys = (o, required, optional = []) => {
  const keys = Object.keys(o)
  return required.every(k => keys.includes(k)) && keys.every(k => required.includes(k) || optional.includes(k))
}
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
const PROFILE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/
const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const isCanonicalIso = s => typeof s === 'string' && ISO_UTC_MS.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString() === s
const isNonEmptyString = s => typeof s === 'string' && s.length > 0 && isWellFormedString(s)
const isNonNegativeInteger = n => typeof n === 'number' && numberProblem(n) === null && n >= 0

/**
 * A P-256 coordinate is exactly 32 bytes in canonical unpadded base64url: decode, require 32 bytes, re-encode, require the same
 * string. So one public key has one spelling, and therefore one keyId.
 */
export function isCanonicalCoordinate(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(s)) return false
  const bytes = Buffer.from(s, 'base64url')
  return bytes.length === 32 && bytes.toString('base64url') === s
}

/** Validates the public JWK shape shared by the attestation and the key set. Exactly { kty, crv, x, y }; never private material. */
export function checkP256PublicJwk(jwk) {
  if (!isPlain(jwk)) return { ok: false, integrity: 'MALFORMED', reasonCode: 'jwk.shape' }
  if (!exactKeys(jwk, ['kty', 'crv', 'x', 'y'])) return { ok: false, integrity: 'MALFORMED', reasonCode: Object.keys(jwk).includes('d') ? 'jwk.private-key-material' : 'jwk.members' }
  if (typeof jwk.kty !== 'string' || typeof jwk.crv !== 'string') return { ok: false, integrity: 'MALFORMED', reasonCode: 'jwk.types' }
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') return { ok: false, integrity: 'UNSUPPORTED_ALGORITHM', reasonCode: 'jwk.not-p256' }
  if (!isCanonicalCoordinate(jwk.x) || !isCanonicalCoordinate(jwk.y)) return { ok: false, integrity: 'MALFORMED', reasonCode: 'jwk.coordinates' }
  return { ok: true }
}

// ── Payload validation (D13: strict) ─────────────────────────────────────────────────────────

const REQUIRED_PAYLOAD_KEYS = ['attestationType', 'attestationVersion', 'profile', 'profileVersion', 'framework', 'upstream', 'implementedControls', 'assessmentSchemaVersion', 'interpretationVersions', 'package', 'assessment', 'issuer', 'keyId', 'issuedAt']

function payloadProblem(p) {
  if (!exactKeys(p, REQUIRED_PAYLOAD_KEYS, ['workspaceId'])) {
    const extra = Object.keys(p).filter(k => !REQUIRED_PAYLOAD_KEYS.includes(k) && k !== 'workspaceId')
    return extra.length ? 'payload.unknown-field' : 'payload.missing-field'
  }
  for (const k of ['profile', 'profileVersion', 'framework', 'issuer']) if (!isNonEmptyString(p[k])) return `payload.${k}`
  if (!PROFILE_ID.test(p.profile)) return 'payload.profile'
  if (!SEMVER.test(p.profileVersion)) return 'payload.profileVersion'
  if (!isPlain(p.upstream) || !exactKeys(p.upstream, ['repo', 'commit', 'license'])) return 'payload.upstream'
  if (!isNonEmptyString(p.upstream.repo) || !/^[0-9a-f]{40}$/.test(String(p.upstream.commit)) || !isNonEmptyString(p.upstream.license)) return 'payload.upstream'
  if (!Array.isArray(p.implementedControls) || !p.implementedControls.every(isNonEmptyString) || new Set(p.implementedControls).size !== p.implementedControls.length) return 'payload.implementedControls'
  if (typeof p.assessmentSchemaVersion !== 'string' || !SEMVER.test(p.assessmentSchemaVersion)) return 'payload.assessmentSchemaVersion'
  if (!isPlain(p.interpretationVersions) || !exactKeys(p.interpretationVersions, INTERPRETATION_VERSION_KEYS)) return 'payload.interpretationVersions'
  if (!INTERPRETATION_VERSION_KEYS.every(k => typeof p.interpretationVersions[k] === 'string' && SEMVER.test(p.interpretationVersions[k]))) return 'payload.interpretationVersions'
  if (!isPlain(p.package) || !exactKeys(p.package, ['digest', 'fileCount'])) return 'payload.package'
  if (!/^avpkg-sha256:[0-9a-f]{64}$/.test(String(p.package.digest)) || !isNonNegativeInteger(p.package.fileCount)) return 'payload.package'
  if (!isPlain(p.assessment) || !exactKeys(p.assessment, ['digest', 'canonicalization'])) return 'payload.assessment'
  if (!/^avassess-sha256:[0-9a-f]{64}$/.test(String(p.assessment.digest)) || p.assessment.canonicalization !== 'RFC8785') return 'payload.assessment'
  // workspaceId: present only when there is a workspace. Omitted otherwise, never null, never empty (RD-3).
  if ('workspaceId' in p && (!isNonEmptyString(p.workspaceId) || p.workspaceId.length > 128)) return 'payload.workspaceId'
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(p.keyId))) return 'payload.keyId'
  if (!isCanonicalIso(p.issuedAt)) return 'payload.issuedAt'
  return null
}

const bytesFromCanonicalBase64 = s => {
  if (typeof s !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(s)) return null
  const bytes = Buffer.from(s, 'base64')
  return bytes.length === 64 && bytes.toString('base64') === s ? new Uint8Array(bytes) : null
}

// ── The semantic cross-checks: THE REGISTRY ──────────────────────────────────────────────────
//
// Every payload field that duplicates something the assessment states is listed here, once. The verifier iterates exactly this
// list, and the tests require one "the signer lied" vector per entry and no vector for anything not listed. A field added to
// the payload that duplicates the assessment must be added here, or the coverage test fails. A correct signature never
// overrides a failed entry.
//
// `always: false` entries read the assessment's own structure, so they run only for an assessment schema this verifier supports.
export const DIGEST_BINDING = 'assessment.digest'
export const CROSS_CHECKS = Object.freeze([
  { binding: 'assessmentSchemaVersion', always: true, payload: p => p.assessmentSchemaVersion, assessment: a => a.schemaVersion },
  { binding: 'profileId', always: false, payload: p => p.profile, assessment: a => a.profile?.profileId },
  { binding: 'profileVersion', always: false, payload: p => p.profileVersion, assessment: a => a.profile?.agentverifyProfileVersion },
  { binding: 'framework', always: false, payload: p => p.framework, assessment: a => a.profile?.framework },
  { binding: 'upstream.repo', always: false, payload: p => p.upstream.repo, assessment: a => a.profile?.upstreamRepo },
  { binding: 'upstream.commit', always: false, payload: p => p.upstream.commit, assessment: a => a.profile?.upstreamCommit },
  { binding: 'upstream.license', always: false, payload: p => p.upstream.license, assessment: a => a.profile?.upstreamLicense },
  { binding: 'implementedControls', always: false, payload: p => p.implementedControls, assessment: a => a.profile?.implementedControls },
  ...INTERPRETATION_VERSION_KEYS.map(k => ({ binding: `interpretationVersions.${k}`, always: false, payload: p => p.interpretationVersions[k], assessment: a => a.profile?.[k] })),
  { binding: 'package.digest', always: false, payload: p => p.package.digest, assessment: a => a.package?.digest },
  { binding: 'package.fileCount', always: false, payload: p => p.package.fileCount, assessment: a => a.package?.fileCount },
])

const sameValue = (x, y) => x !== undefined && JSON.stringify(x) === JSON.stringify(y)

function interpretationOf(assessment, payload, { supportedAssessmentSchemas, supportedProfiles }) {
  if (!supportedAssessmentSchemas.includes(assessment.schemaVersion)) return 'UNSUPPORTED_SCHEMA'
  const registered = Object.hasOwn(supportedProfiles, payload.profile) ? supportedProfiles[payload.profile] : undefined
  if (!registered || registered.framework !== payload.framework) return 'UNSUPPORTED_PROFILE'
  if (!registered.profileVersions.includes(payload.profileVersion)) return 'UNSUPPORTED_PROFILE_VERSION'
  return 'SUPPORTED'
}

// ── Verification ─────────────────────────────────────────────────────────────────────────────

export async function verifyProfileBundle(input, options = {}) {
  // The draft option `highestAcceptedKeySetSequence` (a bare number with no issuer) no longer exists. Refuse it loudly rather than
  // ignore it: silently ignoring it would turn "the caller believes it has rollback detection" into "it has none".
  if ('highestAcceptedKeySetSequence' in options) throw new TypeError('highestAcceptedKeySetSequence was removed: retained key-set state must be keyed by issuer (retainedSequenceByIssuer)')
  const {
    keySet, policy, retainedSequenceByIssuer,
    supportedAssessmentSchemas = SUPPORTED_ASSESSMENT_SCHEMAS, supportedProfiles = SUPPORTED_PROFILES,
    supportedBundleVersions = SUPPORTED_BUNDLE_VERSIONS, maxBundleBytes = MAX_BUNDLE_TEXT_BYTES,
  } = options
  const base = { route: 'PROFILE_ASSESSMENT', keyState: 'NOT_EVALUATED', interpretation: 'NOT_EVALUATED' }
  const fail = (integrity, reasonCode, extra = {}) => ({ ...base, integrity, reasonCode, ...extra })

  let bundle = input
  if (typeof input === 'string') {
    // The size ceiling comes first: an oversized text is refused before any parsing work is done.
    if (Buffer.byteLength(input, 'utf8') > maxBundleBytes) return fail('MALFORMED', 'bundle.too-large')
    try { bundle = parseStrictJson(input) } catch (e) { return fail('MALFORMED', e.code ?? 'JSON_SYNTAX') }
  }
  if (!isPlain(bundle)) return fail('MALFORMED', 'bundle.shape')

  // A BARE attestation whose payload has no `attestationType` IS the legacy scan type, by definition (design 3.2). It is routed, not verified.
  if (!('bundleVersion' in bundle)) {
    if (isPlain(bundle.payload) && !('attestationType' in bundle.payload)) {
      return { route: 'LEGACY_SCAN_ATTESTATION', integrity: 'NOT_EVALUATED', keyState: 'NOT_EVALUATED', interpretation: 'NOT_EVALUATED', reasonCode: 'route.legacy' }
    }
    return fail('MALFORMED', 'bundle.bundleVersion')
  }
  // The bundle version is decided before anything else about the bundle is read (it is unsigned framing in v1, so changing it
  // can only make a verifier refuse; it never changes what a verifier that accepts it would verify).
  if (typeof bundle.bundleVersion !== 'string') return fail('MALFORMED', 'bundle.bundleVersion')
  if (!supportedBundleVersions.includes(bundle.bundleVersion)) return fail('UNSUPPORTED_BUNDLE_VERSION', 'bundle.bundleVersion')

  if (!exactKeys(bundle, ['bundleVersion', 'attestation', 'assessment'])) return fail('MALFORMED', 'bundle.shape')
  const { attestation, assessment } = bundle
  if (!isPlain(attestation) || !exactKeys(attestation, ['payload', 'signature', 'algorithm', 'publicKey'])) return fail('MALFORMED', 'attestation.shape')
  if (!isPlain(assessment)) return fail('MALFORMED', 'assessment.shape')
  const payload = attestation.payload
  if (!isPlain(payload)) return fail('MALFORMED', 'payload.shape')

  // Type and version are decided before any other payload field is read (design 3.3). The signing tag comes from the registry entry, never from the payload.
  if (typeof payload.attestationType !== 'string') return fail('MALFORMED', 'payload.attestationType')
  if (payload.attestationType !== ATTESTATION_TYPE) return fail('UNSUPPORTED_TYPE', 'payload.attestationType')
  if (typeof payload.attestationVersion !== 'string') return fail('MALFORMED', 'payload.attestationVersion')
  if (!PROFILE_DOMAIN.attestationVersions.includes(payload.attestationVersion)) return fail('UNSUPPORTED_VERSION', 'payload.attestationVersion')

  const problem = payloadProblem(payload)
  if (problem) return fail('MALFORMED', problem)

  if (typeof attestation.algorithm !== 'string') return fail('MALFORMED', 'attestation.algorithm')
  if (attestation.algorithm !== ALGORITHM) return fail('UNSUPPORTED_ALGORITHM', 'attestation.algorithm')
  const jwkCheck = checkP256PublicJwk(attestation.publicKey)
  if (!jwkCheck.ok) return fail(jwkCheck.integrity, jwkCheck.reasonCode)

  // Signature form, BEFORE any cryptographic verification: canonical base64, 1 <= r < n, and low-S.
  const signature = bytesFromCanonicalBase64(attestation.signature)
  if (!signature) return fail('MALFORMED', 'attestation.signature')
  const signatureForm = signatureProblem(signature)
  if (signatureForm) return fail('MALFORMED', signatureForm)

  // The signed key identity and the verifying key cannot diverge.
  if (await keyIdOf(attestation.publicKey) !== payload.keyId) return fail('INVALID_SIGNATURE', 'keyId.does-not-match-embedded-key')

  let publicKey
  try { publicKey = await subtle.importKey('jwk', attestation.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']) } catch { return fail('MALFORMED', 'jwk.not-on-curve') }
  let payloadInput
  try { payloadInput = signingInput(payload) } catch { return fail('MALFORMED', 'payload.not-canonicalizable') }
  if (!await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, payloadInput)) return fail('INVALID_SIGNATURE', 'signature')

  // Bindings. A digest is over the parsed value, so a verifier and a signer that parsed differently cannot agree by accident.
  let digest
  try { digest = await assessmentDigest(assessment) } catch { return fail('MALFORMED', 'assessment.not-canonicalizable') }
  if (digest !== payload.assessment.digest) return fail('BINDING_MISMATCH', 'binding', { binding: DIGEST_BINDING })
  const schemaSupported = supportedAssessmentSchemas.includes(assessment.schemaVersion)
  for (const check of CROSS_CHECKS) {
    if (!check.always && !schemaSupported) continue
    if (!sameValue(check.payload(payload), check.assessment(assessment))) return fail('BINDING_MISMATCH', 'binding', { binding: check.binding })
  }

  const result = { route: 'PROFILE_ASSESSMENT', integrity: 'VALID', reasonCode: 'ok', keyState: 'NOT_EVALUATED', interpretation: interpretationOf(assessment, payload, { supportedAssessmentSchemas, supportedProfiles }) }
  if (keySet !== undefined) Object.assign(result, await evaluateKeyState(payload, keySet, { retainedSequenceByIssuer }))
  if (policy !== undefined) result.policy = evaluatePolicy(payload, result.keyState, result.interpretation, policy)
  return result
}

// ── Key state (design 7.1, 7.2) ──────────────────────────────────────────────────────────────

/** Every reason keySetProblem can return. The tests require at least one vector per code. */
export const KEY_SET_PROBLEM_CODES = Object.freeze(['keySet.shape', 'keySet.version', 'keySet.sequence', 'keySet.generatedAt', 'keySet.entry.shape', 'keySet.entry.purpose', 'keySet.entry.status', 'keySet.entry.notBefore', 'keySet.entry.dates', 'keySet.entry.jwk', 'keySet.entry.keyId-does-not-match-jwk', 'keySet.entry.duplicate'])

const KEY_STATUSES = ['active', 'retired', 'revoked']
const KEY_STATE_BY_STATUS = { active: 'KEY_ACTIVE', retired: 'KEY_RETIRED', revoked: 'KEY_REVOKED' }

async function keySetProblem(keySet) {
  if (!isPlain(keySet) || !exactKeys(keySet, ['keySetVersion', 'sequence', 'generatedAt', 'issuer', 'keys'])) return 'keySet.shape'
  if (keySet.keySetVersion !== KEY_SET_VERSION) return 'keySet.version'
  if (!isNonNegativeInteger(keySet.sequence) || keySet.sequence < 1) return 'keySet.sequence'
  if (!isCanonicalIso(keySet.generatedAt)) return 'keySet.generatedAt'
  if (!isNonEmptyString(keySet.issuer) || !Array.isArray(keySet.keys)) return 'keySet.shape'
  const seen = new Set()
  for (const e of keySet.keys) {
    if (!isPlain(e) || !exactKeys(e, ['keyId', 'jwk', 'purpose', 'status', 'notBefore'], ['retiredAt', 'revokedAt'])) return 'keySet.entry.shape'
    if (!isNonEmptyString(e.purpose)) return 'keySet.entry.purpose'
    if (!KEY_STATUSES.includes(e.status)) return 'keySet.entry.status'
    if (!isCanonicalIso(e.notBefore)) return 'keySet.entry.notBefore'
    if ((e.status === 'retired') !== ('retiredAt' in e) || (e.status === 'revoked') !== ('revokedAt' in e)) return 'keySet.entry.dates'
    if ('retiredAt' in e && !isCanonicalIso(e.retiredAt)) return 'keySet.entry.dates'
    if ('revokedAt' in e && !isCanonicalIso(e.revokedAt)) return 'keySet.entry.dates'
    if (!checkP256PublicJwk(e.jwk).ok) return 'keySet.entry.jwk'
    if (await keyIdOf(e.jwk) !== e.keyId) return 'keySet.entry.keyId-does-not-match-jwk'
    if (seen.has(e.keyId)) return 'keySet.entry.duplicate'
    seen.add(e.keyId)
  }
  return null
}

/**
 * The retained key-set sequence for ONE issuer, from verifier state the CALLER keeps. `retained` is a plain object keyed by issuer
 * (own keys only: an issuer named "constructor" or "__proto__" cannot read the prototype), a Map, or a lookup function called with
 * the issuer. The verifier passes the issuer taken from the bundle's own payload; state for any other issuer is never consulted.
 * Returns undefined when there is no retained state for that issuer. A retained value that is not a positive safe integer is a
 * caller bug and throws: state the verifier itself keeps is never silently ignored.
 */
export function retainedSequenceFor(retained, issuer) {
  if (retained === undefined || retained === null) return undefined
  let value
  if (typeof retained === 'function') value = retained(issuer)
  else if (retained instanceof Map) value = retained.get(issuer)
  else if (typeof retained === 'object') value = Object.hasOwn(retained, issuer) ? retained[issuer] : undefined
  else throw new TypeError('retainedSequenceByIssuer must be an object, a Map or a function')
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`retained key-set sequence for ${JSON.stringify(issuer)} must be a positive safe integer`)
  return value
}

/**
 * Only ever called after integrity is VALID. The purpose is a property of the KEY SET entry, never of the attestation: an
 * attacker controls everything inside the attestation.
 *
 * What the key set's metadata does and does not do. `sequence` is monotonic per issuer. A verifier that RETAINS the highest
 * sequence it has accepted FOR AN ISSUER supplies it through `retainedSequenceByIssuer`; the verifier looks it up with the ISSUER
 * NAMED IN THE BUNDLE'S OWN PAYLOAD (never a bare number, never another issuer's state), and a lower sequence is reported as
 * KEY_SET_ROLLBACK_DETECTED. The result says which case applied, in `keySetSequenceCheck`:
 *   NO_RETAINED_STATE     the verifier holds nothing for this issuer: the sequence could not be checked at all
 *   NOT_BEHIND_RETAINED   the sequence is not lower than what this verifier last saw for this issuer. That is ALL it means: it is
 *                         not "current" and not "fresh", only "not older than something the verifier already saw"
 *   BEHIND_RETAINED       rollback detected
 * This is rollback DETECTION support that works only when the verifier actually retains prior issuer state. It is not rollback
 * PROTECTION and not a freshness guarantee: the key set is unsigned, so anyone who can present one can present any sequence, and
 * a verifier with no retained state learns nothing from the number. `generatedAt` is informational: validated for form, never
 * evaluated, because without an authenticating mechanism (a signed key set, or a signed freshness statement) it is only a claim.
 *
 * A key set whose issuer is not the payload's issuer is simply not this issuer's key set: KEY_UNKNOWN, and no retained state is consulted.
 *
 * `notBefore`, `retiredAt` and `revokedAt` are recorded and validated, and are NEVER compared with the payload's `issuedAt`.
 */
export async function evaluateKeyState(payload, keySet, { retainedSequenceByIssuer } = {}) {
  const problem = await keySetProblem(keySet)
  if (problem) return { keyState: 'KEY_SET_INVALID', keyStateReason: problem }
  if (payload.issuer !== keySet.issuer) return { keyState: 'KEY_UNKNOWN', keySetSequence: keySet.sequence }
  const retained = retainedSequenceFor(retainedSequenceByIssuer, payload.issuer)
  const withSequence = (keyState, keySetSequenceCheck) => ({ keyState, keySetSequence: keySet.sequence, keySetSequenceCheck })
  const check = retained === undefined ? 'NO_RETAINED_STATE' : keySet.sequence < retained ? 'BEHIND_RETAINED' : 'NOT_BEHIND_RETAINED'
  if (check === 'BEHIND_RETAINED') return withSequence('KEY_SET_ROLLBACK_DETECTED', check)
  const entry = keySet.keys.find(k => k.keyId === payload.keyId)
  if (!entry) return withSequence('KEY_UNKNOWN', check)
  if (entry.purpose !== PROFILE_KEY_PURPOSE) return withSequence('KEY_PURPOSE_MISMATCH', check)
  return withSequence(KEY_STATE_BY_STATUS[entry.status], check)
}

// ── Policy (verifier-owned, optional; uses payload fields only, so no assessment parsing is needed) ──

/** Only these key states can ever be ACCEPTED. KEY_REVOKED can never be accepted, so a policy that lists it is invalid. */
export const ACCEPTABLE_KEY_STATES = Object.freeze(['KEY_ACTIVE', 'KEY_RETIRED'])
/** The reference verifier's default: current keys only. Historical or offline verification opts into KEY_RETIRED explicitly. */
export const DEFAULT_ACCEPTED_KEY_STATES = Object.freeze(['KEY_ACTIVE'])

export function evaluatePolicy(payload, keyState, interpretation, policy) {
  const accepted = policy.acceptedKeyStates ?? DEFAULT_ACCEPTED_KEY_STATES
  if (!Array.isArray(accepted) || accepted.length === 0 || !accepted.every(s => ACCEPTABLE_KEY_STATES.includes(s))) return { status: 'INVALID_POLICY', failures: ['ACCEPTED_KEY_STATES_INVALID'] }
  const failures = []
  if (interpretation !== 'SUPPORTED') failures.push('INTERPRETATION_UNSUPPORTED')
  if (!accepted.includes(keyState)) failures.push('KEY_STATE_NOT_ACCEPTED')
  if (policy.requiredProfile !== undefined && payload.profile !== policy.requiredProfile) failures.push('PROFILE_NOT_ALLOWED')
  if (policy.allowedUpstreamCommits !== undefined && !policy.allowedUpstreamCommits.includes(payload.upstream.commit)) failures.push('UPSTREAM_COMMIT_NOT_ALLOWED')
  if (policy.requiredControls !== undefined && !policy.requiredControls.every(c => payload.implementedControls.includes(c))) failures.push('CONTROLS_NOT_COVERED')
  if (policy.requiredPackageDigest !== undefined && payload.package.digest !== policy.requiredPackageDigest) failures.push('PACKAGE_DIGEST_MISMATCH')
  if (policy.maxAgeSeconds !== undefined && (Date.parse(policy.now) - Date.parse(payload.issuedAt)) / 1000 > policy.maxAgeSeconds) failures.push('TOO_OLD')
  return { status: failures.length === 0 ? 'SATISFIED' : 'NOT_SATISFIED', failures }
}

// ── avpkg-sha256 package identity (design 6) ─────────────────────────────────────────────────

const compareBytes = (a, b) => {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return a.length - b.length
}

/** The exact bytes hashed for a package digest, so an implementer can compare preimages rather than only digests. */
export function packagePreimage(files) {
  const entries = files.map(f => ({ p: enc.encode(f.path), c: enc.encode(f.content) }))
  entries.sort((x, y) => compareBytes(x.p, y.p))
  let out = enc.encode(PACKAGE_TAG)
  for (const e of entries) {
    out = concat(out, enc.encode(`${e.p.length}:`)); out = concat(out, e.p)
    out = concat(out, enc.encode(`\n${e.c.length}:`)); out = concat(out, e.c)
    out = concat(out, enc.encode('\n'))
  }
  return out
}

export async function packageDigest(files) {
  return `avpkg-sha256:${hex(await subtle.digest('SHA-256', packagePreimage(files)))}`
}

export { toBase64, toBase64Url, hex, concat }
