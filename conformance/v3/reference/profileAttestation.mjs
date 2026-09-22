// REFERENCE / TEST-ONLY (vector set v3). Not the product implementation and not for import from product code. See conformance/v3/README.md.
//
// A verification-only reference for the profile-assessment attestation described in docs/attestation-profile-design.md.
// It contains NO signing code and touches no private key. It exists so that every conformance vector has an executable,
// independently reviewable statement of what "correct" means, and so the product implementation (later) has something to
// be checked against that it did not write itself.
//
// INPUT IS BYTES. The normative verifier input is a Uint8Array of the bundle's UTF-8 encoding (verifyProfileBundleBytes). It is
// decoded strictly: invalid UTF-8 is refused (never replaced with U+FFFD), a UTF-8 byte order mark is refused, and the size
// ceiling is checked on the BYTES before anything is decoded or parsed. There is no string entry point that is normative. (A
// runtime that hands a verifier a string has already decided how to decode; that decision cannot be checked from the string.)
//
// Result model (design D8): integrity, key state, interpretation and policy are separate results. There is no boolean.
//
//   integrity      VALID | MALFORMED | UNSUPPORTED_BUNDLE_VERSION | UNSUPPORTED_TYPE | UNSUPPORTED_VERSION
//                  | UNSUPPORTED_ALGORITHM | INVALID_SIGNATURE | BINDING_MISMATCH
//   keyState       KEY_ACTIVE | KEY_RETIRED | KEY_REVOKED
//                  | KEY_UNKNOWN | KEY_PURPOSE_MISMATCH | KEY_SET_INVALID | KEY_SET_ROLLBACK_DETECTED
//                  | NOT_EVALUATED                     (no key set supplied, or integrity was not VALID)
//                  A key STATE records what the supplied key set says about the key. It is not a trust decision, and it says
//                  nothing about WHEN the signature was made: issuedAt is a signer claim and is never compared to a key date.
//   interpretation SUPPORTED | UNSUPPORTED_SCHEMA | INVALID_ASSESSMENT | UNSUPPORTED_PROFILE | UNSUPPORTED_PROFILE_VERSION
//                  | PROFILE_DEFINITION_MISMATCH | NOT_EVALUATED
//   policy         { status: SATISFIED | NOT_SATISFIED | INVALID_POLICY, failures: [...] }   (only when a policy was supplied and integrity is VALID)
//
// Integrity is cryptographic and structural. Interpretation is whether this verifier may READ the assessment as a statement about
// a known profile. They are separate, and an unsupported or malformed interpretation is never turned into INVALID_SIGNATURE. But
// nothing that is not SUPPORTED can satisfy a policy.
//
// A legacy scan attestation (a bare attestation with no `attestationType` in its payload) is not verified here; it is ROUTED
// to the unchanged legacy verifier (route LEGACY_SCAN_ATTESTATION), as design section 3.3 requires.

import { ASSESSMENT_TAG, ATTESTATION_TYPE, INTERPRETATION_VERSION_KEYS, PACKAGE_TAG, PAYLOAD_TAG, PROFILE_DOMAIN, PROFILE_KEY_PURPOSE } from './domains.mjs'
import { canonicalize, signedBytes } from './jcs.mjs'
import { ASSESSMENT_BASE_DEPTH, MAX_BUNDLE_BYTES, PAYLOAD_BASE_DEPTH } from './limits.mjs'
import { ASSESSMENT_SCHEMA_VERSION, assessmentSchemaProblem } from './assessmentSchema.mjs'
import { ACCEPTABLE_KEY_STATES, DEFAULT_ACCEPTED_KEY_STATES, evaluatePolicy } from './policy.mjs'
import { ASSESSMENT_DIGEST, PACKAGE_DIGEST, PROFILE_ID, exactKeys, isCommit, isNonEmptyString, isNonNegativeSafeInteger, isPlain, isPositiveSafeInteger, isSemver, isDenseArray, isUniqueStringArray, own } from './plain.mjs'
import { PROFILE_REGISTRY, lookupProfile, profileDefinitionProblem } from './profileRegistry.mjs'
import { decodeStrictUtf8, parseStrictJson } from './strictJson.mjs'
import { parseTimestamp } from './timestamp.mjs'

export { ASSESSMENT_TAG, ATTESTATION_TYPE, INTERPRETATION_VERSION_KEYS, PAYLOAD_TAG, PROFILE_KEY_PURPOSE, ACCEPTABLE_KEY_STATES, DEFAULT_ACCEPTED_KEY_STATES, evaluatePolicy }
export const ATTESTATION_VERSION = '1.0.0'
export const ALGORITHM = 'ECDSA-P256-SHA256'
export const BUNDLE_VERSION = '1.0.0'
export const SUPPORTED_BUNDLE_VERSIONS = Object.freeze(['1.0.0'])
export const KEY_SET_VERSION = '1.0.0'
/** The assessment schema versions this verifier has an exact validator for. A schema without a validator here is UNSUPPORTED, never "probably fine". */
export const ASSESSMENT_VALIDATORS = Object.freeze({ [ASSESSMENT_SCHEMA_VERSION]: assessmentSchemaProblem })
export const SUPPORTED_ASSESSMENT_SCHEMAS = Object.freeze(Object.keys(ASSESSMENT_VALIDATORS))
export const MAX_BUNDLE_TEXT_BYTES = MAX_BUNDLE_BYTES
export { PROFILE_REGISTRY }

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
/** The prime of the P-256 base field: a public-key coordinate is an integer in [0, p). */
export const P256_FIELD_PRIME = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFFn

/** null when 1 <= r < n and 1 <= s <= floor(n/2); otherwise the reason. Runs BEFORE any cryptographic verification. */
export function signatureProblem(bytes) {
  if (bytes.length !== 64) return 'signature.range'
  const r = BigInt(`0x${Buffer.from(bytes.subarray(0, 32)).toString('hex')}`)
  const s = BigInt(`0x${Buffer.from(bytes.subarray(32)).toString('hex')}`)
  if (r < 1n || r >= P256_ORDER || s < 1n || s >= P256_ORDER) return 'signature.range'
  if (s > P256_HALF_ORDER) return 'signature.high-s'
  return null
}

/**
 * The signature is exactly 64 bytes in CANONICAL padded standard base64: 88 characters, "==" padding, and the four unused bits of
 * the last data character all zero. So one signature has one spelling. A non-canonical alias (trailing bits set, URL-safe alphabet,
 * missing or extra padding, whitespace) is refused even though a lenient decoder would read the same 64 bytes.
 */
export function bytesFromCanonicalBase64(s) {
  if (typeof s !== 'string' || s.length !== 88 || !/^[A-Za-z0-9+/]{86}==$/.test(s)) return null
  const bytes = Buffer.from(s, 'base64')
  return bytes.length === 64 && bytes.toString('base64') === s ? new Uint8Array(bytes) : null
}

// ── Digests, signing input, key id ───────────────────────────────────────────────────────────
//
// DEPTH. The assessment sits INSIDE the bundle (bundle root = depth 1, so the assessment is at depth 2) and the payload sits at
// depth 3. Both are canonicalized with that base depth, so anything that can be digested or signed also parses inside its bundle
// and the reverse; there is no assessment that is digestible or signable but impossible to parse when embedded.

/** "avassess-sha256:" + hex( SHA-256( UTF8(tag) || UTF8(JCS(assessment)) ) ), JCS under the signed-content numeric profile. Throws JcsError if not admitted. */
export async function assessmentDigest(assessment) {
  return `avassess-sha256:${hex(await subtle.digest('SHA-256', concat(enc.encode(ASSESSMENT_TAG), signedBytes(assessment, { baseDepth: ASSESSMENT_BASE_DEPTH }))))}`
}

/** UTF8("agentverify-attestation/profile-assessment/v1\n") || UTF8(JCS(payload)). Throws JcsError if not admitted. */
export function signingInput(payload) {
  return concat(enc.encode(PAYLOAD_TAG), signedBytes(payload, { baseDepth: PAYLOAD_BASE_DEPTH }))
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

/**
 * A P-256 coordinate is exactly 32 bytes in canonical unpadded base64url: decode, require 32 bytes, re-encode, require the same
 * string. So one public key has one spelling, and therefore one keyId.
 */
export function isCanonicalCoordinate(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(s)) return false
  const bytes = Buffer.from(s, 'base64url')
  return bytes.length === 32 && bytes.toString('base64url') === s
}

/** A canonical coordinate is an integer in [0, p). 32 bytes can express values up to 2^256 - 1, which are not field elements. */
export const isCoordinateInRange = s => BigInt(`0x${Buffer.from(s, 'base64url').toString('hex')}`) < P256_FIELD_PRIME

/** Validates the public JWK shape shared by the attestation and the key set. Exactly { kty, crv, x, y }; never private material. */
export function checkP256PublicJwk(jwk) {
  if (!isPlain(jwk)) return { ok: false, integrity: 'MALFORMED', reasonCode: 'jwk.shape' }
  if (!exactKeys(jwk, ['kty', 'crv', 'x', 'y'])) return { ok: false, integrity: 'MALFORMED', reasonCode: Object.hasOwn(jwk, 'd') ? 'jwk.private-key-material' : 'jwk.members' }
  if (typeof jwk.kty !== 'string' || typeof jwk.crv !== 'string') return { ok: false, integrity: 'MALFORMED', reasonCode: 'jwk.types' }
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') return { ok: false, integrity: 'UNSUPPORTED_ALGORITHM', reasonCode: 'jwk.not-p256' }
  if (!isCanonicalCoordinate(jwk.x) || !isCanonicalCoordinate(jwk.y)) return { ok: false, integrity: 'MALFORMED', reasonCode: 'jwk.coordinates' }
  if (!isCoordinateInRange(jwk.x) || !isCoordinateInRange(jwk.y)) return { ok: false, integrity: 'MALFORMED', reasonCode: 'jwk.coordinate-range' }
  return { ok: true }
}

// ── The payload: THE FIELD CLASSIFICATION REGISTRY ───────────────────────────────────────────
//
// EVERY signed payload field appears here exactly once, and each is classified:
//
//   kind 'cross-checked'  the payload duplicates something the assessment (or its digest) states, and a registered check compares
//                         them. `binding` names that check (an entry of CROSS_CHECKS, or DIGEST_BINDING for the assessment digest).
//   kind 'independent'    signed metadata that is NOT derivable from the assessment. `reason` says why it is safe to leave
//                         unchecked against it (what else constrains it).
//
// The payload validator below is DERIVED from this table (required keys, nested exact key sets, per-field validators), so a field
// cannot be admitted to the payload without a row here, and a row cannot exist without a classification. The tests enforce:
//   * a cross-checked row has a registered check and a vector that proves the check fires ("the signer lied")
//   * an independent row has a reason
//   * every leaf of every vector payload is a row (a new payload field makes the suite fail until it is classified)

export const DIGEST_BINDING = 'assessment.digest'
const notEmpty = isNonEmptyString
const row = (path, code, valid, klass, { required = true } = {}) => ({ path, code, valid, required, ...klass })
const CROSS = binding => ({ kind: 'cross-checked', binding })
const INDEPENDENT = reason => ({ kind: 'independent', reason })

export const PAYLOAD_FIELDS = Object.freeze([
  row('attestationType', 'payload.attestationType', v => v === ATTESTATION_TYPE, INDEPENDENT('The domain selector. It is a constant chosen from the registry BEFORE any other payload field is read, so it can never disagree with the assessment.')),
  row('attestationVersion', 'payload.attestationVersion', v => PROFILE_DOMAIN.attestationVersions.includes(v), INDEPENDENT('A constant of the attestation format, decided before any other field is read; it says nothing about the assessment.')),
  row('profile', 'payload.profile', v => typeof v === 'string' && PROFILE_ID.test(v), CROSS('profileId')),
  row('profileVersion', 'payload.profileVersion', isSemver, CROSS('profileVersion')),
  row('framework', 'payload.framework', notEmpty, CROSS('framework')),
  row('issuer', 'payload.issuer', notEmpty, INDEPENDENT('The signer namespace claim. It scopes key-set lookup and retained sequence state; it is not a property of the assessment.')),
  row('upstream.repo', 'payload.upstream', notEmpty, CROSS('upstream.repo')),
  row('upstream.commit', 'payload.upstream', isCommit, CROSS('upstream.commit')),
  row('upstream.license', 'payload.upstream', notEmpty, CROSS('upstream.license')),
  row('implementedControls', 'payload.implementedControls', v => isUniqueStringArray(v, notEmpty), CROSS('implementedControls')),
  row('assessmentSchemaVersion', 'payload.assessmentSchemaVersion', isSemver, CROSS('assessmentSchemaVersion')),
  ...INTERPRETATION_VERSION_KEYS.map(k => row(`interpretationVersions.${k}`, 'payload.interpretationVersions', isSemver, CROSS(`interpretationVersions.${k}`))),
  row('package.digest', 'payload.package', v => typeof v === 'string' && PACKAGE_DIGEST.test(v), CROSS('package.digest')),
  row('package.fileCount', 'payload.package', isNonNegativeSafeInteger, CROSS('package.fileCount')),
  row('assessment.digest', 'payload.assessment', v => typeof v === 'string' && ASSESSMENT_DIGEST.test(v), CROSS(DIGEST_BINDING)),
  row('assessment.canonicalization', 'payload.assessment', v => v === 'RFC8785', INDEPENDENT('A constant naming the canonicalization the digest used; there is exactly one admitted value, so nothing can differ.')),
  row('workspaceId', 'payload.workspaceId', v => notEmpty(v) && v.length <= 128, INDEPENDENT('Context only: the workspace the signing service acted for. Not derivable from the assessment, and never a verification restriction.'), { required: false }),
  row('keyId', 'payload.keyId', v => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v), INDEPENDENT('Bound to the embedded public key by the keyId derivation check, and to the key set by lookup; it is not derivable from the assessment.')),
  row('issuedAt', 'payload.issuedAt', v => parseTimestamp(v) !== null, INDEPENDENT('The signer\'s claimed time. It is not trusted time and is compared to nothing but a verifier-supplied policy clock.')),
])

const topLevelOf = path => path.split('.')[0]
const PAYLOAD_TOP_KEYS = [...new Set(PAYLOAD_FIELDS.map(f => topLevelOf(f.path)))]
const PAYLOAD_CONTAINERS = Object.freeze(Object.fromEntries(PAYLOAD_TOP_KEYS.filter(k => PAYLOAD_FIELDS.some(f => f.path.startsWith(`${k}.`))).map(k => [k, PAYLOAD_FIELDS.filter(f => f.path.startsWith(`${k}.`)).map(f => f.path.slice(k.length + 1))])))
const REQUIRED_TOP = PAYLOAD_TOP_KEYS.filter(k => PAYLOAD_FIELDS.some(f => topLevelOf(f.path) === k && f.required))
const OPTIONAL_TOP = PAYLOAD_TOP_KEYS.filter(k => !REQUIRED_TOP.includes(k))

/** Reads a dotted path through OWN properties only; undefined when any step is missing or not an object. */
export function getPath(obj, dotted) {
  let cur = obj
  for (const part of dotted.split('.')) { if (typeof cur !== 'object' || cur === null || !Object.hasOwn(cur, part)) return undefined; cur = cur[part] }
  return cur
}

function payloadProblem(p) {
  if (!exactKeys(p, REQUIRED_TOP, OPTIONAL_TOP)) return Object.keys(p).some(k => !PAYLOAD_TOP_KEYS.includes(k)) ? 'payload.unknown-field' : 'payload.missing-field'
  for (const [container, children] of Object.entries(PAYLOAD_CONTAINERS)) {
    const value = p[container]
    if (!isPlain(value) || !exactKeys(value, children)) return PAYLOAD_FIELDS.find(f => f.path.startsWith(`${container}.`)).code
  }
  for (const f of PAYLOAD_FIELDS) {
    const value = getPath(p, f.path)
    if (value === undefined) { if (f.required) return f.code; continue }
    if (!f.valid(value)) return f.code
  }
  return null
}

// ── The semantic cross-checks: THE REGISTRY ──────────────────────────────────────────────────
//
// Every payload field classified 'cross-checked' above is compared with the assessment here, once, declaratively. The verifier
// iterates exactly this list, and the tests require one "the signer lied" vector per entry and no entry without a payload row. A
// correct signature never overrides a failed entry.
//
// RULE FOR UNSUPPORTED SCHEMAS. `runsWhen: 'always'` entries read only the assessment's top-level `schemaVersion` (the very field
// that decides whether the schema is supported), so they run for every assessment. `runsWhen: 'schema-supported'` entries read
// the assessment's STRUCTURE, which this verifier cannot interpret under a schema it does not know, so they are skipped there:
// the digest binding still holds, the assessment is opaque, and the interpretation is UNSUPPORTED_SCHEMA. Nothing is inferred from
// a structure that cannot be read.
export const CROSS_CHECKS = Object.freeze([
  { binding: 'assessmentSchemaVersion', payloadField: 'assessmentSchemaVersion', assessmentPath: 'schemaVersion', runsWhen: 'always' },
  { binding: 'profileId', payloadField: 'profile', assessmentPath: 'profile.profileId', runsWhen: 'schema-supported' },
  { binding: 'profileVersion', payloadField: 'profileVersion', assessmentPath: 'profile.agentverifyProfileVersion', runsWhen: 'schema-supported' },
  { binding: 'framework', payloadField: 'framework', assessmentPath: 'profile.framework', runsWhen: 'schema-supported' },
  { binding: 'upstream.repo', payloadField: 'upstream.repo', assessmentPath: 'profile.upstreamRepo', runsWhen: 'schema-supported' },
  { binding: 'upstream.commit', payloadField: 'upstream.commit', assessmentPath: 'profile.upstreamCommit', runsWhen: 'schema-supported' },
  { binding: 'upstream.license', payloadField: 'upstream.license', assessmentPath: 'profile.upstreamLicense', runsWhen: 'schema-supported' },
  { binding: 'implementedControls', payloadField: 'implementedControls', assessmentPath: 'profile.implementedControls', runsWhen: 'schema-supported' },
  ...INTERPRETATION_VERSION_KEYS.map(k => ({ binding: `interpretationVersions.${k}`, payloadField: `interpretationVersions.${k}`, assessmentPath: `profile.${k}`, runsWhen: 'schema-supported' })),
  { binding: 'package.digest', payloadField: 'package.digest', assessmentPath: 'package.digest', runsWhen: 'schema-supported' },
  { binding: 'package.fileCount', payloadField: 'package.fileCount', assessmentPath: 'package.fileCount', runsWhen: 'schema-supported' },
])

const sameValue = (x, y) => x !== undefined && JSON.stringify(x) === JSON.stringify(y)

// ── Interpretation ───────────────────────────────────────────────────────────────────────────
//
// SUPPORTED is a strong statement. In this order, the first failure decides:
//   1. UNSUPPORTED_SCHEMA            the assessment's schema version has no exact validator here
//   2. INVALID_ASSESSMENT            the assessment does not validate against the exact schema for that version (reason: assessment.schema.*)
//   3. UNSUPPORTED_PROFILE           the profile id is not in the closed registry (looked up by OWN key)
//   4. UNSUPPORTED_PROFILE_VERSION   the id is known but not this profile version
//   5. PROFILE_DEFINITION_MISMATCH   framework, upstream repo/commit/licence/status, implemented controls (and so the not-implemented
//                                    controls) or expected schema version differ from the pinned definition (reason: profile.*)
//   6. SUPPORTED
// An interpretation other than SUPPORTED never changes integrity, and can never satisfy a policy.
export function interpretationOf(assessment, payload, { supportedAssessmentSchemas = SUPPORTED_ASSESSMENT_SCHEMAS, profileRegistry = PROFILE_REGISTRY } = {}) {
  const schema = own(assessment, 'schemaVersion')
  if (typeof schema !== 'string' || !supportedAssessmentSchemas.includes(schema) || !Object.hasOwn(ASSESSMENT_VALIDATORS, schema)) return { interpretation: 'UNSUPPORTED_SCHEMA' }
  const structural = ASSESSMENT_VALIDATORS[schema](assessment)
  if (structural) return { interpretation: 'INVALID_ASSESSMENT', interpretationReason: structural }
  const found = lookupProfile(profileRegistry, assessment.profile.profileId, assessment.profile.agentverifyProfileVersion)
  if (found.problem) return { interpretation: found.problem }
  const mismatch = profileDefinitionProblem(found.definition, assessment)
  if (mismatch) return { interpretation: 'PROFILE_DEFINITION_MISMATCH', interpretationReason: mismatch }
  void payload // the payload's copies were already bound to the assessment by the cross-check registry
  return { interpretation: 'SUPPORTED' }
}

/**
 * The signer-side ADMISSION predicate (verification logic only; nothing here signs). A signing service must call this on the
 * assessment it just generated, AFTER generation and BEFORE any private-key operation, and must refuse to sign anything that is
 * not admitted. Admitted means: the assessment canonicalizes under the signed-content numeric profile within the shared depth
 * limit AND is SUPPORTED (exact schema + pinned profile definition). Returns { admitted: true } or { admitted: false, reason }.
 */
export function admitAssessment(assessment, options = {}) {
  try { signedBytes(assessment, { baseDepth: ASSESSMENT_BASE_DEPTH }) } catch (e) { return { admitted: false, reason: `assessment.not-canonicalizable:${e.code ?? 'ERROR'}` } }
  const { interpretation, interpretationReason } = interpretationOf(assessment, undefined, options)
  return interpretation === 'SUPPORTED' ? { admitted: true } : { admitted: false, reason: interpretationReason ?? interpretation }
}

// ── Verification ─────────────────────────────────────────────────────────────────────────────

const KNOWN_OPTIONS = ['keySet', 'policy', 'retainedSequenceByIssuer', 'supportedAssessmentSchemas', 'profileRegistry', 'supportedBundleVersions', 'maxBundleBytes']

/**
 * THE NORMATIVE ENTRY POINT. `bytes` is a Uint8Array holding the UTF-8 text of the bundle.
 * Refusals before any parsing: NOT_BYTES (bundle.not-bytes), too large (bundle.too-large, checked on the byte length FIRST),
 * a UTF-8 BOM (JSON_BOM), invalid UTF-8 (bundle.invalid-utf8, decoding is fatal; U+FFFD substitution never happens).
 */
export async function verifyProfileBundleBytes(bytes, options = {}) {
  assertKnownOptions(options)
  const { maxBundleBytes = MAX_BUNDLE_BYTES } = options
  const base = { route: 'PROFILE_ASSESSMENT', keyState: 'NOT_EVALUATED', interpretation: 'NOT_EVALUATED' }
  const refuse = reasonCode => ({ ...base, integrity: 'MALFORMED', reasonCode })
  const decoded = decodeStrictUtf8(bytes, maxBundleBytes)
  if (decoded.problem) return refuse({ NOT_BYTES: 'bundle.not-bytes', TOO_LARGE: 'bundle.too-large', BOM: 'JSON_BOM', INVALID_UTF8: 'bundle.invalid-utf8' }[decoded.problem])
  let bundle
  try { bundle = parseStrictJson(decoded.text) } catch (e) { return refuse(e.code ?? 'JSON_SYNTAX') }
  return verifyParsedBundle(bundle, options)
}

function assertKnownOptions(options) {
  if (Object.hasOwn(options, 'highestAcceptedKeySetSequence')) throw new TypeError('highestAcceptedKeySetSequence was removed: retained key-set state must be keyed by issuer (retainedSequenceByIssuer)')
  const unknown = Object.keys(options).filter(k => !KNOWN_OPTIONS.includes(k))
  // A misspelled option must not silently turn "the caller believes it configured X" into "X is off".
  if (unknown.length > 0) throw new TypeError(`unknown verifier option(s): ${unknown.join(', ')}`)
  if (options.supportedAssessmentSchemas !== undefined && !options.supportedAssessmentSchemas.every(v => Object.hasOwn(ASSESSMENT_VALIDATORS, v))) throw new TypeError('supportedAssessmentSchemas may only list schema versions this verifier has an exact validator for')
}

/** The verification after decoding and parsing. Exported for tests and for a signer's own pre-flight; the normative input is bytes. */
export async function verifyParsedBundle(bundle, options = {}) {
  assertKnownOptions(options)
  const {
    keySet, policy, retainedSequenceByIssuer,
    supportedAssessmentSchemas = SUPPORTED_ASSESSMENT_SCHEMAS, profileRegistry = PROFILE_REGISTRY,
    supportedBundleVersions = SUPPORTED_BUNDLE_VERSIONS,
  } = options
  const base = { route: 'PROFILE_ASSESSMENT', keyState: 'NOT_EVALUATED', interpretation: 'NOT_EVALUATED' }
  const fail = (integrity, reasonCode, extra = {}) => ({ ...base, integrity, reasonCode, ...extra })

  if (!isPlain(bundle)) return fail('MALFORMED', 'bundle.shape')

  // A BARE attestation whose payload has no `attestationType` IS the legacy scan type, by definition (design 3.2). It is routed, not verified.
  // A bare attestation that DOES carry an attestationType key (even null or "") claims to be typed, and a typed attestation only
  // ever travels inside a bundle: it is malformed, not legacy.
  if (!Object.hasOwn(bundle, 'bundleVersion')) {
    if (isPlain(bundle.payload)) {
      if (!Object.hasOwn(bundle.payload, 'attestationType')) {
        return { route: 'LEGACY_SCAN_ATTESTATION', integrity: 'NOT_EVALUATED', keyState: 'NOT_EVALUATED', interpretation: 'NOT_EVALUATED', reasonCode: 'route.legacy' }
      }
      return fail('MALFORMED', 'bundle.bare-typed-attestation')
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
  const schemaSupported = typeof assessment.schemaVersion === 'string' && supportedAssessmentSchemas.includes(assessment.schemaVersion)
  for (const check of CROSS_CHECKS) {
    if (check.runsWhen === 'schema-supported' && !schemaSupported) continue
    if (!sameValue(getPath(payload, check.payloadField), getPath(assessment, check.assessmentPath))) return fail('BINDING_MISMATCH', 'binding', { binding: check.binding })
  }

  const result = { route: 'PROFILE_ASSESSMENT', integrity: 'VALID', reasonCode: 'ok', keyState: 'NOT_EVALUATED', ...interpretationOf(assessment, payload, { supportedAssessmentSchemas, profileRegistry }) }
  if (keySet !== undefined) Object.assign(result, await evaluateKeyState(payload, keySet, { retainedSequenceByIssuer }))
  if (policy !== undefined) result.policy = evaluatePolicy(payload, result.keyState, result.interpretation, policy)
  return result
}

// ── Key state (design 7.1, 7.2) ──────────────────────────────────────────────────────────────

/** Every reason keySetProblem can return. The tests require at least one vector per code. */
export const KEY_SET_PROBLEM_CODES = Object.freeze(['keySet.shape', 'keySet.version', 'keySet.sequence', 'keySet.generatedAt', 'keySet.issuer', 'keySet.keys', 'keySet.entry.shape', 'keySet.entry.purpose', 'keySet.entry.status', 'keySet.entry.notBefore', 'keySet.entry.dates', 'keySet.entry.jwk', 'keySet.entry.keyId-does-not-match-jwk', 'keySet.entry.duplicate'])

const KEY_STATUSES = ['active', 'retired', 'revoked']
const KEY_STATE_BY_STATUS = { active: 'KEY_ACTIVE', retired: 'KEY_RETIRED', revoked: 'KEY_REVOKED' }

async function keySetProblem(keySet) {
  if (!isPlain(keySet) || !exactKeys(keySet, ['keySetVersion', 'sequence', 'generatedAt', 'issuer', 'keys'])) return 'keySet.shape'
  if (keySet.keySetVersion !== KEY_SET_VERSION) return 'keySet.version'
  if (!isPositiveSafeInteger(keySet.sequence)) return 'keySet.sequence'
  if (parseTimestamp(keySet.generatedAt) === null) return 'keySet.generatedAt'
  if (!isNonEmptyString(keySet.issuer)) return 'keySet.issuer'
  if (!isDenseArray(keySet.keys)) return 'keySet.keys'
  const seen = new Set()
  for (const e of keySet.keys) {
    if (!isPlain(e) || !exactKeys(e, ['keyId', 'jwk', 'purpose', 'status', 'notBefore'], ['retiredAt', 'revokedAt'])) return 'keySet.entry.shape'
    if (!isNonEmptyString(e.purpose)) return 'keySet.entry.purpose'
    if (!KEY_STATUSES.includes(e.status)) return 'keySet.entry.status'
    if (parseTimestamp(e.notBefore) === null) return 'keySet.entry.notBefore'
    if ((e.status === 'retired') !== Object.hasOwn(e, 'retiredAt') || (e.status === 'revoked') !== Object.hasOwn(e, 'revokedAt')) return 'keySet.entry.dates'
    if (Object.hasOwn(e, 'retiredAt') && parseTimestamp(e.retiredAt) === null) return 'keySet.entry.dates'
    if (Object.hasOwn(e, 'revokedAt') && parseTimestamp(e.revokedAt) === null) return 'keySet.entry.dates'
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
 *
 * WHAT THE CALLER MUST DO (this reference is pure and persists nothing; see also docs/attestation-profile-design.md):
 *   * Update retained state ONLY from a key set that arrived over an AUTHENTICATED, TRUSTED key-set distribution channel. NEVER
 *     from a key set presented inside or alongside a bundle being verified: a bundle's author controls that key set.
 *   * NEVER turn an unsigned, presented key set into persistent trusted state.
 *   * Scope retained state by TRUSTED SOURCE and issuer. If more than one authenticated source may claim the same issuer name,
 *     keep separate state per (source, issuer); this function's per-issuer lookup is only correct for state that is already
 *     scoped to one trusted source.
 *   * The sequence is rollback DETECTION support, not freshness. Loss of retained state is NO_RETAINED_STATE, which learns nothing.
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
 * attacker controls everything inside the attestation. The purpose is compared EXACTLY (case-sensitive).
 *
 * What the key set's metadata does and does not do. `sequence` is monotonic per issuer. A verifier that RETAINS the highest
 * sequence it has accepted FOR AN ISSUER supplies it through `retainedSequenceByIssuer`; the verifier looks it up with the ISSUER
 * NAMED IN THE BUNDLE'S OWN PAYLOAD (never a bare number, never another issuer's state), and a lower sequence is reported as
 * KEY_SET_ROLLBACK_DETECTED. The result says which case applied, in `keySetSequenceCheck`:
 *   NO_RETAINED_STATE     the verifier holds nothing for this issuer: the sequence could not be checked at all
 *   NOT_BEHIND_RETAINED   the sequence is not lower than what this verifier last saw for this issuer. That is ALL it means: it is
 *                         not "current" and not "fresh", only "not older than something the verifier already saw"
 *   BEHIND_RETAINED       rollback detected
 * This is rollback DETECTION support that works only when the verifier actually retains prior issuer state (and only if that
 * state was itself recorded from a trusted channel: see retainedSequenceFor). It is not rollback PROTECTION and not a freshness
 * guarantee: the key set is unsigned, so anyone who can present one can present any sequence, and a verifier with no retained
 * state learns nothing from the number. `generatedAt` is informational: validated for form, never evaluated.
 *
 * A key set whose issuer is not the payload's issuer is simply not this issuer's key set: KEY_UNKNOWN, and no retained state is consulted.
 *
 * `notBefore`, `retiredAt` and `revokedAt` are METADATA in this version: recorded and validated for form, and NEVER compared with
 * the payload's `issuedAt` or with any clock. They imply nothing about when a signature was made (issuedAt is the signer's own
 * claim), so no result here says "signed before retirement" or "too old". A verifier policy that WANTS to use them must first
 * obtain a TRUSTED time from a source this reference does not have (a signed timestamp, a transparency log); until then they are
 * information for a human and nothing more.
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
