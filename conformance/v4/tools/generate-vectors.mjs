// ONE-SHOT vector generator for VECTOR SET v4. TEST-ONLY. Not part of any product build.
//
//   node conformance/v4/tools/generate-vectors.mjs --new-vector-set
//
// The vectors are FROZEN. This script generates throwaway P-256 keys IN MEMORY, signs the fixtures, and writes only the
// public keys and the signatures. It never writes a private key anywhere, so it cannot reproduce the same signatures:
// running it again produces a different, equally valid vector set. That is a deliberate version change of the vector set,
// not a refresh, which is why it refuses to run without --new-vector-set and refuses to overwrite existing vectors.
//
// Every expected result below is written by hand (a prediction) and then checked against the reference implementation
// while generating. A mismatch stops generation: it means either the prediction or the reference is wrong.
//
// v4 supersedes v3 (v3 is FROZEN and untouched; its manifest hash remains the reviewed historical artifact of the third review).
// v4 is a NARROW correction pass for exactly the three blockers that review found, and nothing else:
//   1. Evidence-accounting completeness: assessmentSchemaProblem now requires every evidence item to be accounted for exactly
//      one way (referenced by a check, or listed unmapped, never both, never neither). See assessmentSchema.mjs.
//   2. Normative key-set sequence discipline, added to docs/attestation-profile-design.md (a documentation change; no vector
//      or reference code implements a publisher, since none exists to implement).
//   3. Normative admission-to-signing identity rule, added to the same document (also documentation; tested here as far as
//      the pure admission predicate allows without any signing code existing).
// Every OTHER v3 decision (the O(n) numeric classifier, strict policy, the closed profile registry, the shared depth model,
// bytes as the normative input, the strict timestamp parser, the payload-field classification registry) is UNCHANGED and is
// carried forward into v4 only because the assessment-schema change requires a new vector set (schema semantics changed).

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { ALL_TAGS, DIGEST_DOMAINS, LEGACY_SCAN_ATTESTATION, SIGNING_DOMAINS, TAG_FORM } from '../reference/domains.mjs'
import { ASSESSMENT_SCHEMA_PROBLEM_CODES, assessmentSchemaProblem } from '../reference/assessmentSchema.mjs'
import { ASSESSMENT_BASE_DEPTH, MAX_JSON_DEPTH } from '../reference/limits.mjs'
import { INVALID_POLICY_CODES, POLICY_FAILURE_CODES } from '../reference/policy.mjs'
import { PROFILE_REGISTRY } from '../reference/profileRegistry.mjs'
import { civilFromDays, formatTimestamp, parseTimestamp } from '../reference/timestamp.mjs'
import { canonicalize, canonicalizeSigned, canonicalizeText, numberFromIeeeHex } from '../reference/jcs.mjs'
import { NUMBER_PROFILE_ID, numberTokenProblem } from '../reference/numberProfile.mjs'
import * as ref from '../reference/profileAttestation.mjs'
import { StrictJsonError, parseStrictJson } from '../reference/strictJson.mjs'
import { ADVERSARIAL_KINDS, adversarialToken, applyPatch, assertSubset, caseOptions, resolveSource, reviveNumbers, toInputBytes } from '../test/helpers.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..', '..', '..')
const OUT = path.join(here, '..', 'vectors')

if (!process.argv.includes('--new-vector-set')) {
  console.error('Refusing to run: the vectors are frozen. Pass --new-vector-set to create a NEW vector set (new keys, new signatures).')
  process.exit(2)
}
if (existsSync(path.join(OUT, 'manifest.v4.json')) && !process.argv.includes('--overwrite')) {
  console.error('Refusing to overwrite an existing vector set. Pass --overwrite as well if a new set is really intended.')
  process.exit(2)
}
mkdirSync(OUT, { recursive: true })

const subtle = globalThis.crypto.subtle
const sha256Hex = data => createHash('sha256').update(data).digest('hex')
const VECTOR_SET = 'agentverify-profile-attestation-conformance'
const VERSION = '4.0.0'
const NOTE = 'CONFORMANCE VECTOR. Synthetic data and throwaway keys: nothing here is a real customer, scan, key or credential. Do not treat any key in this file as an Agent Verify signing key.'

// Vector files must contain no raw invisible characters (BOM, DEL, line separators, bidi controls, and so on).
// JSON.stringify leaves several of them raw; they are written as \uXXXX escapes here, which is the same JSON value.
const isHiddenCode = n => (n < 32 && n !== 10 && n !== 9) || (n >= 0x7f && n <= 0xa0) || n === 0xad || n === 0x61c || (n >= 0x200b && n <= 0x200f) || (n >= 0x2028 && n <= 0x202e) || (n >= 0x2060 && n <= 0x2064) || (n >= 0x2066 && n <= 0x206f) || n === 0xfeff || (n >= 0xfff9 && n <= 0xfffb)
const escapeHiddenChars = text => [...text].map(c => (isHiddenCode(c.codePointAt(0)) ? String.fromCharCode(92) + 'u' + c.codePointAt(0).toString(16).padStart(4, '0') : c)).join('')
const write = (name, value) => writeFileSync(path.join(OUT, name), escapeHiddenChars(JSON.stringify(value, null, 2)) + '\n')
const head = (extra = {}) => ({ vectorSet: VECTOR_SET, version: VERSION, supersedes: 'vector set v3 (frozen, unchanged; v4 is a NEW set, not a patch of v3)', note: NOTE, ...extra })

const ISSUER = 'agentverify-conformance'
const PROFILE_ID = 'owasp-agentic-skills-2026'
const ISSUED_AT = '2026-01-15T12:00:00.000Z'

// ── P-256 signature helpers ──────────────────────────────────────────────────────────────────

const N = ref.P256_ORDER
const HALF = ref.P256_HALF_ORDER
const be32 = x => Buffer.from(x.toString(16).padStart(64, '0'), 'hex')
const rOf = b => BigInt(`0x${b.subarray(0, 32).toString('hex')}`)
const sOf = b => BigInt(`0x${b.subarray(32).toString('hex')}`)
const makeSig = (r, s) => Buffer.concat([be32(r), be32(s)]).toString('base64')
const partsOf = b64 => { const b = Buffer.from(b64, 'base64'); return { r: rOf(b), s: sOf(b) } }
const twinOf = b64 => { const { r, s } = partsOf(b64); return makeSig(r, N - s) }

// ── Keys (in memory only) ────────────────────────────────────────────────────────────────────

async function newKey() {
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await subtle.exportKey('jwk', kp.publicKey)
  return { privateKey: kp.privateKey, publicJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, webCryptoJwk: jwk }
}
/** WebCrypto emits high-S about half the time. Every signature in this vector set is normalized to LOW-S (s -> n - s), which needs no private key. */
async function signB64(privateKey, bytes) {
  const raw = Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, bytes))
  const r = rOf(raw), s = sOf(raw)
  return makeSig(r, s > HALF ? N - s : s)
}
const K = { profile: await newKey(), rotated: await newKey(), attacker: await newKey(), legacy: await newKey(), legacyOther: await newKey() }
const keyIds = Object.fromEntries(await Promise.all(Object.entries(K).map(async ([n, k]) => [n, await ref.keyIdOf(k.publicJwk)])))
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
/** A non-canonical spelling of the same 32 bytes: the last character's two unused bits set. */
const aliasCoordinate = c => `${c.slice(0, 42)}${B64URL[B64URL.indexOf(c[42]) + 1]}`

// ── Synthetic package and assessment (schema 1.1.0 shape; the CONTENT is invented) ───────────

const PACKAGE_FILES = [
  { path: 'SKILL.md', content: '---\nname: conformance-skill\ndescription: "Synthetic package used only by conformance vectors"\nrisk_tier: L1\n---\n# Conformance skill\n' },
  { path: 'src/index.js', content: "export const run = () => 'synthetic'\n" },
  { path: 'docs/résumé-🙂.md', content: 'Synthetic non-ASCII path.\n' },
]
const PACKAGE_DIGEST = await ref.packageDigest(PACKAGE_FILES)

const baseAssessment = () => ({
  schemaVersion: '1.1.0',
  profile: {
    profileId: PROFILE_ID,
    framework: 'OWASP_AGENTIC_SKILLS_TOP_10',
    upstreamRepo: 'OWASP/www-project-agentic-skills-top-10',
    upstreamCommit: 'd6f7d7d0de314f52a83a85d1828e06ab096e595c',
    upstreamStatus: 'public-review',
    upstreamLicense: 'CC-BY-SA-4.0',
    agentverifyProfileVersion: '1.0.0-alpha.1',
    implementedControls: ['AST02', 'AST03', 'AST04'],
    scannerVersion: '1.4.0',
    assessmentEngineVersion: '1.0.1',
    riskRubricVersion: '1.0.0',
    keyAllowlistVersion: '1.0.0',
    normalizationVersion: '1.0.0',
  },
  controls: ['AST02', 'AST03', 'AST04'].map((id, n) => ({
    controlId: id, framework: 'OWASP_AGENTIC_SKILLS_TOP_10', title: `Synthetic control ${id}`, upstreamSeverity: 'High',
    status: n === 1 ? 'GAP_IDENTIFIED' : 'EVIDENCE_OBSERVED', confidence: 'medium', explanation: `Synthetic explanation for ${id}.`,
    coverage: { total: 1, evidenceObserved: n === 1 ? 0 : 1, gapIdentified: n === 1 ? 1 : 0, notAssessed: 0 },
    checks: [{ checkId: `${n + 2}.1`, title: `Synthetic check ${n + 2}.1`, status: n === 1 ? 'GAP_IDENTIFIED' : 'EVIDENCE_OBSERVED', confidence: 'medium', explanation: 'Synthetic.', provenance: ['STATICALLY_OBSERVED'], supportingEvidenceIds: [`ev-000${n + 1}`] }],
  })),
  notImplementedControls: ['AST01', 'AST05', 'AST06', 'AST07', 'AST08', 'AST09', 'AST10'],
  evidence: [
    { id: 'ev-0001', kind: 'conformance.example-positive', axis: 'manifest', polarity: 'positive', severity: 'low', confidence: 'high', provenance: ['STATICALLY_OBSERVED'], summary: 'Synthetic positive observation for AST02.', expected: 'n/a', remediation: 'n/a', facts: { present: true, count: 3 }, locations: [{ file: 'SKILL.md', line: 2 }] },
    { id: 'ev-0002', kind: 'conformance.example-gap', axis: 'filesystem', polarity: 'gap', severity: 'high', confidence: 'medium', provenance: ['STATICALLY_OBSERVED', 'INFERRED'], summary: 'Synthetic gap on a non-ASCII path: résumé 🙂', expected: 'n/a', remediation: 'n/a', facts: { printablePercent: 98, note: 'quote " backslash \\ slash / tab\t newline\n' }, locations: [{ file: 'docs/résumé-🙂.md', line: 1 }, { file: 'src/index.js' }] },
    { id: 'ev-0003', kind: 'conformance.example-context', axis: 'network', polarity: 'context', severity: 'low', confidence: 'low', provenance: ['DECLARED'], summary: 'Synthetic context item.', expected: 'n/a', remediation: 'n/a', facts: { hosts: ['b.example.test', 'a.example.test'], empty: [] }, locations: [] },
  ],
  unmappedEvidenceIds: [],
  package: { digest: PACKAGE_DIGEST, fileCount: PACKAGE_FILES.length, manifestFiles: ['SKILL.md'] },
  notes: ['Synthetic assessment for conformance vectors. Not scanner output.'],
})
const otherAssessment = () => {
  const a = baseAssessment()
  a.evidence[2].summary = 'A different synthetic context item.'
  // A genuinely unmapped evidence item: NOT ev-0003 (which AST04's check already cites), because reusing a referenced id here
  // would itself violate the v4 evidence-accounting completeness rule (referenced and unmapped are disjoint, by design).
  a.evidence.push({ id: 'ev-0004', kind: 'conformance.example-unmapped', axis: 'metadata', polarity: 'context', severity: 'low', confidence: 'low', provenance: ['DECLARED'], summary: 'Synthetic evidence no check cites.', expected: 'n/a', remediation: 'n/a', facts: {}, locations: [] })
  a.unmappedEvidenceIds = ['ev-0004']
  a.notes.push('A different synthetic assessment.')
  return a
}
assert.equal(assessmentSchemaProblem(baseAssessment()), null, 'the synthetic base assessment is schema-valid')
assert.equal(assessmentSchemaProblem(otherAssessment()), null, 'the synthetic other assessment is schema-valid')

// ── Building and signing bundles ─────────────────────────────────────────────────────────────

async function buildPayload(assessment, { keyId, workspaceId, mutate, issuer } = {}) {
  const p = assessment.profile
  const payload = {
    attestationType: ref.ATTESTATION_TYPE,
    attestationVersion: ref.ATTESTATION_VERSION,
    profile: p.profileId,
    profileVersion: p.agentverifyProfileVersion,
    framework: p.framework,
    upstream: { repo: p.upstreamRepo, commit: p.upstreamCommit, license: p.upstreamLicense },
    implementedControls: [...p.implementedControls],
    assessmentSchemaVersion: assessment.schemaVersion,
    interpretationVersions: Object.fromEntries(ref.INTERPRETATION_VERSION_KEYS.map(k => [k, p[k]])),
    package: { digest: assessment.package.digest, fileCount: assessment.package.fileCount },
    assessment: { digest: await ref.assessmentDigest(assessment), canonicalization: 'RFC8785' },
    issuer: issuer ?? ISSUER,
    keyId,
    issuedAt: ISSUED_AT,
  }
  if (workspaceId !== undefined) payload.workspaceId = workspaceId
  if (mutate) mutate(payload)
  return payload
}

/** Signs whatever payload it is given, INCLUDING deliberately wrong ones: this is how "the signer lied" vectors are made. */
async function signBundle(assessment, opts = {}) {
  const key = opts.key ?? K.profile
  const keyId = keyIds[Object.keys(K).find(n => K[n] === key)]
  const payload = await buildPayload(assessment, { ...opts, keyId })
  const input = opts.signWith === 'untagged' ? new TextEncoder().encode(canonicalizeSigned(payload)) : ref.signingInput(payload)
  return {
    bundleVersion: ref.BUNDLE_VERSION,
    attestation: { payload, signature: await signB64(key.privateKey, input), algorithm: ref.ALGORITHM, publicKey: key.publicJwk },
    assessment: structuredClone(assessment),
  }
}

const signed = {}
const cases = []
const keySets = {}
const addSigned = async (name, description, assessment, opts) => { signed[name] = { description, bundle: await signBundle(assessment, opts) } }
const addCase = (name, description, source, expected, extra = {}) => cases.push({ name, description, source, ...extra, expected })

await addSigned('B1', 'Base bundle: workspace ABSENT (the field is omitted). Signed by the profile key. Low-S.', baseAssessment())
await addSigned('B2', 'Base bundle with a workspace: workspaceId is present.', baseAssessment(), { workspaceId: 'ws_conformance_0001' })
await addSigned('B_other', 'A different assessment, validly signed, used to test substitution.', otherAssessment())
await addSigned('B_rotated', 'Same content as B1, signed by the second (rotated-in) profile key.', baseAssessment(), { key: K.rotated })
await addSigned('B_attacker', 'Internally consistent bundle signed by a key that is in no key set.', baseAssessment(), { key: K.attacker })
await addSigned('B_issuerOther', 'Same content as B1 but issued under ANOTHER issuer namespace (agentverify-other), used to prove rollback state is issuer-scoped.', baseAssessment(), { issuer: 'agentverify-other' })
await addSigned('B_issuerConstructor', 'Issued under an issuer named "constructor", a member name of Object.prototype: retained state must be looked up by OWN key only.', baseAssessment(), { issuer: 'constructor' })

const B1 = signed.B1.bundle
const P = '/attestation/payload'
const A = '/assessment'
const SIGPATH = '/attestation/signature'
const flipBase64 = b64 => { const bytes = Buffer.from(b64, 'base64'); bytes[10] ^= 0x01; return bytes.toString('base64') }
const zeros = n => '0'.repeat(n)
const rep = (p, value) => ({ op: 'replace', path: p, value })
for (const [n, s] of Object.entries(signed)) assert.ok(partsOf(s.bundle.attestation.signature).s <= HALF, `${n}: every signature in the set is low-S`)

// ── Section 1: valid bundles and equivalent encodings ─────────────────────────────────────────

const VALID = { integrity: 'VALID', interpretation: 'SUPPORTED', reasonCode: 'ok' }
addCase('valid.workspace-absent', 'The base bundle verifies. The payload has no workspaceId member.', { signed: 'B1' }, VALID)
addCase('valid.workspace-present', 'A bundle whose payload carries workspaceId verifies. workspaceId is context, not a restriction.', { signed: 'B2' }, VALID)
addCase('valid.workspace-present-any-verifier', 'Verification needs no workspace, no network and no key set: the same bundle verifies with nothing else supplied.', { signed: 'B2' }, { ...VALID, keyState: 'NOT_EVALUATED' })

const textOf = obj => JSON.stringify(obj)
const reverseKeys = v => Array.isArray(v) ? v.map(reverseKeys) : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().reverse().map(k => [k, reverseKeys(v[k])])) : v
const escapeNonAscii = s => [...s].map(ch => { const cp = ch.codePointAt(0); if (cp < 0x80) return ch; if (cp > 0xffff) { const off = cp - 0x10000; return `\\u${(0xd800 + (off >> 10)).toString(16)}\\u${(0xdc00 + (off & 0x3ff)).toString(16)}` } return `\\u${cp.toString(16).padStart(4, '0')}` }).join('')
const b1Text = textOf(B1)
const once = (needle, label) => assert.equal(b1Text.split(needle).length, 2, `${label}: needs exactly one occurrence`)
once('"printablePercent":98', 'printablePercent')
once('"count":3', 'count')

addCase('equivalent.pretty-printed', 'Insignificant whitespace does not change what was signed.', { text: JSON.stringify(B1, null, 2) }, VALID)
addCase('equivalent.crlf-whitespace', 'CRLF between tokens is insignificant whitespace.', { text: JSON.stringify(B1, null, 2).replace(/\n/g, '\r\n') }, VALID)
addCase('equivalent.object-keys-reordered', 'Object key order in transport is irrelevant: JCS sorts keys, so the digest and the signed bytes are unchanged. (Array order is NOT irrelevant; see the reorder vectors.)', { text: textOf(reverseKeys(B1)) }, VALID)
addCase('equivalent.unicode-escaped', 'Non-ASCII written as \\uXXXX escapes (with surrogate pairs) is the same value as the literal characters. (Escapes are not normalization: see the NFC/NFD vectors.)', { text: escapeNonAscii(b1Text) }, VALID)

// ── Section 2: bundle version (unsigned outer framing, independent of attestationVersion) ─────

const BV = p => rep('/bundleVersion', p)
addCase('bundle-version.missing', 'A bundle with no bundleVersion is malformed.', { signed: 'B1', patch: [{ op: 'remove', path: '/bundleVersion' }] }, { integrity: 'MALFORMED', reasonCode: 'bundle.bundleVersion' })
addCase('bundle-version.number', 'bundleVersion must be a string.', { signed: 'B1', patch: [BV(1)] }, { integrity: 'MALFORMED', reasonCode: 'bundle.bundleVersion' })
addCase('bundle-version.null', 'bundleVersion: null is malformed.', { signed: 'B1', patch: [BV(null)] }, { integrity: 'MALFORMED', reasonCode: 'bundle.bundleVersion' })
for (const v of ['1.1.0', '2.0.0', '0.9.0', '1.0.1', '', '1.0.0 ']) {
  addCase(`bundle-version.unsupported.${JSON.stringify(v)}`, `bundleVersion ${JSON.stringify(v)} is UNSUPPORTED_BUNDLE_VERSION. It is unsigned, so this is NOT INVALID_SIGNATURE: changing it can only make a verifier refuse.`, { signed: 'B1', patch: [BV(v)] }, { integrity: 'UNSUPPORTED_BUNDLE_VERSION', reasonCode: 'bundle.bundleVersion' })
}
addCase('bundle-version.decided-first', 'A future bundleVersion with unknown fields, a missing assessment and a broken attestation is still UNSUPPORTED_BUNDLE_VERSION: the version is decided before anything else is read.', { signed: 'B1', patch: [BV('2.0.0'), { op: 'add', path: '/futureContainerField', value: 'x' }, { op: 'remove', path: '/assessment' }] }, { integrity: 'UNSUPPORTED_BUNDLE_VERSION' })
addCase('bundle-version.independent-of-attestation-version', 'Nothing links the two versions: bundleVersion 1.0.0 with an attestationVersion this verifier does not support is UNSUPPORTED_VERSION (see strict.version-1.1.0), and an unsupported bundleVersion with a supported attestation is UNSUPPORTED_BUNDLE_VERSION.', { signed: 'B1', patch: [BV('1.1.0')] }, { integrity: 'UNSUPPORTED_BUNDLE_VERSION' })

// ── Section 3: tampering with every signed binding (payload mutated after signing => the SIGNATURE fails) ──

const SIG = { integrity: 'INVALID_SIGNATURE' }
const tamper = (name, description, patch, expected = SIG, from = 'B1') => addCase(`tamper.${name}`, description, { signed: from, patch }, expected)

tamper('payload.profile', 'profile id changed after signing (format-preserving)', [rep(`${P}/profile`, 'owasp-agentic-skills-2027')])
tamper('payload.profileVersion', 'profile version changed after signing', [rep(`${P}/profileVersion`, '1.0.0-alpha.2')])
tamper('payload.framework', 'framework changed after signing', [rep(`${P}/framework`, 'OTHER_FRAMEWORK')])
tamper('payload.upstream.repo', 'OWASP repo changed after signing', [rep(`${P}/upstream/repo`, 'example/other-repo')])
tamper('payload.upstream.commit', 'pinned OWASP commit changed after signing', [rep(`${P}/upstream/commit`, 'f'.repeat(40))])
tamper('payload.upstream.license', 'licence changed after signing', [rep(`${P}/upstream/license`, 'MIT')])
tamper('payload.implementedControls', 'DOWNGRADE: a control removed from implementedControls after signing', [rep(`${P}/implementedControls`, ['AST02', 'AST03'])])
tamper('payload.assessmentSchemaVersion', 'assessment schema version changed after signing', [rep(`${P}/assessmentSchemaVersion`, '1.2.0')])
for (const k of ref.INTERPRETATION_VERSION_KEYS) tamper(`payload.interpretationVersions.${k}`, `${k} changed in the payload after signing`, [rep(`${P}/interpretationVersions/${k}`, '9.9.9')])
tamper('payload.package.digest', 'package digest changed after signing', [rep(`${P}/package/digest`, `avpkg-sha256:${zeros(64)}`)])
tamper('payload.package.fileCount', 'package file count changed after signing', [rep(`${P}/package/fileCount`, PACKAGE_FILES.length + 1)])
tamper('payload.assessment.digest', 'assessment digest changed after signing', [rep(`${P}/assessment/digest`, `avassess-sha256:${zeros(64)}`)])
tamper('payload.assessment.canonicalization', 'the canonicalization name changed after signing; the payload is checked for shape before its signature, so this is MALFORMED rather than INVALID_SIGNATURE (there is no other valid value to change it to)', [rep(`${P}/assessment/canonicalization`, 'JCS')], { integrity: 'MALFORMED', reasonCode: 'payload.assessment' })
tamper('payload.issuer', 'issuer changed after signing', [rep(`${P}/issuer`, 'agentverify-conformance-other')])
tamper('payload.keyId', 'keyId changed after signing (no longer the thumbprint of the embedded key)', [rep(`${P}/keyId`, 'A'.repeat(43))])
tamper('payload.issuedAt', 'issuedAt changed by one second after signing', [rep(`${P}/issuedAt`, '2026-01-15T12:00:01.000Z')])
tamper('payload.workspace.added', 'a workspaceId added to a bundle that was signed without one', [{ op: 'add', path: `${P}/workspaceId`, value: 'ws_conformance_0001' }])
tamper('payload.workspace.removed', 'the workspaceId removed from a bundle that was signed with one', [{ op: 'remove', path: `${P}/workspaceId` }], SIG, 'B2')
tamper('payload.workspace.changed', 'the workspaceId changed on a bundle that was signed with another', [rep(`${P}/workspaceId`, 'ws_conformance_0002')], SIG, 'B2')
tamper('signature.bit-flipped', 'one bit of the signature flipped (the result is either still low-S and fails verification, or fails the form check; see signature.* for the form rules)', [rep(SIGPATH, flipBase64(B1.attestation.signature))], (() => { const f = partsOf(flipBase64(B1.attestation.signature)); return f.s > HALF ? { integrity: 'MALFORMED', reasonCode: 'signature.high-s' } : SIG })())
tamper('signature.from-another-bundle', 'the signature of a different bundle (B2) on this payload', [rep(SIGPATH, signed.B2.bundle.attestation.signature)])
tamper('publicKey.swapped-keyId-unchanged', 'the embedded key replaced by an attacker key while keyId still names the original: keyId no longer matches the embedded key', [rep('/attestation/publicKey', K.attacker.publicJwk)], { integrity: 'INVALID_SIGNATURE', reasonCode: 'keyId.does-not-match-embedded-key' })
tamper('publicKey.and-keyId-swapped', 'the embedded key AND the payload keyId both replaced by the attacker key: consistent, but the signature was made by another key', [rep('/attestation/publicKey', K.attacker.publicJwk), rep(`${P}/keyId`, keyIds.attacker)], { integrity: 'INVALID_SIGNATURE', reasonCode: 'signature' })

await addSigned('X_untagged', 'Signature made over the bare JCS payload (the legacy input shape, no domain tag) by the correct key. Low-S, so the failure is the domain tag and nothing else.', baseAssessment(), { signWith: 'untagged' })
addCase('cross-type.untagged-signature', 'A signature over the untagged JCS bytes does not verify against the tagged signing input, even with the right key.', { signed: 'X_untagged' }, { integrity: 'INVALID_SIGNATURE', reasonCode: 'signature' })

// ── Section 4: signature FORM (Agent Verify canonical-signature rule: low-S; not an RFC 7518 requirement) ──

{
  const { r, s } = partsOf(B1.attestation.signature)
  const MALF = reasonCode => ({ integrity: 'MALFORMED', reasonCode })
  const sigCase = (name, description, sig, expected) => addCase(`signature.${name}`, description, { signed: 'B1', patch: [rep(SIGPATH, sig)] }, expected)
  sigCase('high-s-twin', 'The valid signature (r, s) turned into its twin (r, n - s). It is a mathematically valid signature; the profile type refuses it. Legacy verification is unchanged and accepts both forms (see the legacy vectors).', twinOf(B1.attestation.signature), MALF('signature.high-s'))
  sigCase('high-s-boundary-plus-one', 's = floor(n/2) + 1, the smallest rejected value. Rejected on FORM, before any cryptography.', makeSig(r, HALF + 1n), MALF('signature.high-s'))
  sigCase('low-s-boundary-inclusive', 's = floor(n/2), the largest admitted value: admitted on form, and then (not being a real signature) INVALID_SIGNATURE. Pins that the boundary is inclusive.', makeSig(r, HALF), { integrity: 'INVALID_SIGNATURE', reasonCode: 'signature' })
  sigCase('s-one', 's = 1, the smallest admitted value: admitted on form, INVALID_SIGNATURE.', makeSig(r, 1n), { integrity: 'INVALID_SIGNATURE', reasonCode: 'signature' })
  sigCase('s-zero', 's = 0 is out of range.', makeSig(r, 0n), MALF('signature.range'))
  sigCase('r-zero', 'r = 0 is out of range.', makeSig(0n, s), MALF('signature.range'))
  sigCase('r-equals-n', 'r = n is out of range.', makeSig(N, s), MALF('signature.range'))
  sigCase('s-equals-n', 's = n is out of range (range is checked before low-S, so this is not reported as high-S).', makeSig(r, N), MALF('signature.range'))
  sigCase('r-max', 'r = 2^256 - 1 is out of range.', makeSig((1n << 256n) - 1n, s), MALF('signature.range'))
  sigCase('s-max', 's = 2^256 - 1 is out of range.', makeSig(r, (1n << 256n) - 1n), MALF('signature.range'))
  sigCase('r-just-below-n', 'r = n - 1 is in range (and, not being a real signature, INVALID_SIGNATURE).', makeSig(N - 1n, s), { integrity: 'INVALID_SIGNATURE', reasonCode: 'signature' })
  addCase('signature.high-s-twin.workspace-bundle', 'The same rule on the workspace bundle.', { signed: 'B2', patch: [rep(SIGPATH, twinOf(signed.B2.bundle.attestation.signature))] }, MALF('signature.high-s'))
  addCase('signature.form-checked-before-key-id', 'The signature form is checked before the key id: a high-S signature on a bundle whose keyId is also wrong is reported as high-S.', { signed: 'B1', patch: [rep(SIGPATH, twinOf(B1.attestation.signature)), rep(`${P}/keyId`, 'A'.repeat(43))] }, MALF('signature.high-s'))
}

// ── Section 5: assessment mutated after signing (the DIGEST binding fails) ────────────────────

const DIGEST = { integrity: 'BINDING_MISMATCH', binding: 'assessment.digest' }
const assessTamper = (name, description, patch) => addCase(`assessment.${name}`, description, { signed: 'B1', patch }, DIGEST)
assessTamper('string-changed', 'one evidence summary changed', [rep(`${A}/evidence/0/summary`, 'Synthetic positive observation for AST02!')])
assessTamper('status-changed', 'a control status changed', [rep(`${A}/controls/1/status`, 'EVIDENCE_OBSERVED')])
assessTamper('number-changed', 'a line number changed', [rep(`${A}/evidence/0/locations/0/line`, 3)])
assessTamper('percent-changed', 'an integer-scaled fact changed', [rep(`${A}/evidence/1/facts/printablePercent`, 99)])
assessTamper('boolean-changed', 'a boolean fact changed', [rep(`${A}/evidence/0/facts/present`, false)])
assessTamper('field-added', 'an unknown field added to the assessment', [{ op: 'add', path: `${A}/extra`, value: 'x' }])
assessTamper('field-removed', 'the notes field removed', [{ op: 'remove', path: `${A}/notes` }])
assessTamper('evidence-appended', 'an evidence item appended', [{ op: 'add', path: `${A}/evidence/-`, value: structuredClone(B1.assessment.evidence[0]) }])
assessTamper('evidence-removed', 'an evidence item removed', [{ op: 'remove', path: `${A}/evidence/2` }])
assessTamper('package-digest-changed', 'the package digest inside the assessment changed', [rep(`${A}/package/digest`, `avpkg-sha256:${zeros(64)}`)])
assessTamper('profile-id-changed', 'the profile id INSIDE the assessment changed (the payload still states the original)', [rep(`${A}/profile/profileId`, 'owasp-agentic-skills-2027')])
assessTamper('upstream-commit-changed', 'the OWASP commit inside the assessment changed', [rep(`${A}/profile/upstreamCommit`, 'f'.repeat(40))])
assessTamper('schema-version-changed', 'the assessment schemaVersion changed', [rep(`${A}/schemaVersion`, '1.1.1')])
for (const k of ref.INTERPRETATION_VERSION_KEYS) assessTamper(`interpretation.${k}`, `${k} changed INSIDE the assessment only (the payload still states the original)`, [rep(`${A}/profile/${k}`, '9.9.9')])
assessTamper('substituted', 'the whole assessment replaced by another validly signed bundle\'s assessment', [rep(A, signed.B_other.bundle.assessment)])
assessTamper('reorder.evidence', 'two evidence items swapped', [{ op: 'swap', path: `${A}/evidence`, i: 0, j: 1 }])
assessTamper('reorder.controls', 'two controls swapped', [{ op: 'swap', path: `${A}/controls`, i: 0, j: 1 }])
assessTamper('reorder.profile-implementedControls', 'two entries of profile.implementedControls swapped', [{ op: 'swap', path: `${A}/profile/implementedControls`, i: 0, j: 1 }])
assessTamper('reorder.notImplementedControls', 'two entries of notImplementedControls swapped', [{ op: 'swap', path: `${A}/notImplementedControls`, i: 0, j: 1 }])
assessTamper('reorder.nested-array', 'two items of a nested string array swapped', [{ op: 'swap', path: `${A}/evidence/2/facts/hosts`, i: 0, j: 1 }])

// ── Section 6: the signer lied. Validly signed and digest-correct, but a duplicated field disagrees with the assessment ──
//
// One vector per entry of the reference's CROSS_CHECKS registry (and more for some). The generator REFUSES to run if the registry
// and this table disagree, and the tests fail if a vector names a binding that is not in the registry.

const LIE_MUTATORS = {
  assessmentSchemaVersion: [['', p => { p.assessmentSchemaVersion = '1.9.9' }]],
  profileId: [['', p => { p.profile = 'owasp-agentic-skills-2027' }]],
  profileVersion: [['', p => { p.profileVersion = '1.0.0-alpha.2' }]],
  framework: [['', p => { p.framework = 'OTHER_FRAMEWORK' }]],
  'upstream.repo': [['', p => { p.upstream.repo = 'example/other-repo' }]],
  'upstream.commit': [['', p => { p.upstream.commit = 'f'.repeat(40) }]],
  'upstream.license': [['', p => { p.upstream.license = 'MIT' }]],
  implementedControls: [['', p => { p.implementedControls = ['AST03'] }], ['.order', p => { p.implementedControls = ['AST03', 'AST02', 'AST04'] }]],
  ...Object.fromEntries(ref.INTERPRETATION_VERSION_KEYS.map(k => [`interpretationVersions.${k}`, [['', p => { p.interpretationVersions[k] = '9.9.9' }]]])),
  'package.digest': [['', p => { p.package.digest = `avpkg-sha256:${zeros(64)}` }]],
  'package.fileCount': [['', p => { p.package.fileCount = PACKAGE_FILES.length + 1 }]],
}
assert.deepEqual(Object.keys(LIE_MUTATORS).sort(), ref.CROSS_CHECKS.map(c => c.binding).sort(), 'the lied-vector table and the reference CROSS_CHECKS registry must list exactly the same bindings')
for (const [binding, variants] of Object.entries(LIE_MUTATORS)) {
  for (const [suffix, mutate] of variants) {
    const name = `${binding}${suffix}`
    await addSigned(`L_${name}`, `Signed payload whose ${name} disagrees with the assessment (signature and assessment digest are both correct).`, baseAssessment(), { mutate })
    addCase(`binding.signer-lied.${name}`, `A correct signature does not excuse a duplicated field that disagrees with the assessment: ${name}.`, { signed: `L_${name}` }, { integrity: 'BINDING_MISMATCH', binding })
  }
}

// ── Section 7: D10. Same package, same everything, ONE interpretation version changed ─────────

const bumps = { scannerVersion: '1.4.1', assessmentEngineVersion: '1.0.2', riskRubricVersion: '1.0.1', keyAllowlistVersion: '1.0.1', normalizationVersion: '1.0.1', agentverifyProfileVersion: '1.0.0-alpha.2' }
const d10 = []
for (const [field, value] of Object.entries(bumps)) {
  const a = baseAssessment(); a.profile[field] = value
  await addSigned(`D10_${field}`, `Identical to B1 except profile.${field} = ${value}, in the assessment and (correspondingly) in the payload.`, a)
  // agentverifyProfileVersion is a version this verifier's closed registry does not know: still a fully valid attestation, but not interpretable.
  addCase(`d10.${field}`, `Changing only ${field} yields a different, fully valid attestation.`, { signed: `D10_${field}` }, field === 'agentverifyProfileVersion' ? { integrity: 'VALID', interpretation: 'UNSUPPORTED_PROFILE_VERSION' } : VALID)
  d10.push({ field, from: 'B1', signed: `D10_${field}` })
}
{
  const f = 'riskRubricVersion'
  addCase('d10.signature-transplant', 'B1\'s signature on the rubric-bumped payload does not verify.', { signed: `D10_${f}`, patch: [rep(SIGPATH, B1.attestation.signature)] }, SIG)
  addCase('d10.assessment-reverted', 'The rubric-bumped payload with the assessment put back to the original rubric version: the digest no longer matches.', { signed: `D10_${f}`, patch: [rep(`${A}/profile/${f}`, '1.0.0')] }, DIGEST)
  addCase('d10.payload-reverted', 'The rubric-bumped assessment with the payload put back to the original rubric version: the signature no longer matches.', { signed: `D10_${f}`, patch: [rep(`${P}/interpretationVersions/${f}`, '1.0.0')] }, SIG)
}

// ── Section 8: strictness, type, version (all validly SIGNED, so the rule under test is not the signature) ──

const MAL = reasonCode => ({ integrity: 'MALFORMED', reasonCode })
const strict = async (name, description, mutate, expected, workspaceId) => { await addSigned(`S_${name}`, description, baseAssessment(), { mutate, workspaceId }); addCase(`strict.${name}`, description, { signed: `S_${name}` }, expected) }
await strict('unknown-payload-field', 'A signed payload with an extra field (verdict) is rejected: an unknown field could be a constraint the signer intended.', p => { p.verdict = 'PASS' }, MAL('payload.unknown-field'))
await strict('workspace-null', 'workspaceId: null is rejected. The field is omitted or a non-empty string; never null.', p => { p.workspaceId = null }, MAL('payload.workspaceId'))
await strict('workspace-empty', 'workspaceId: "" is rejected.', p => { p.workspaceId = '' }, MAL('payload.workspaceId'))
await strict('workspace-number', 'workspaceId as a number is rejected.', p => { p.workspaceId = 7 }, MAL('payload.workspaceId'))
await strict('workspace-too-long', 'workspaceId longer than 128 characters is rejected.', p => { p.workspaceId = 'w'.repeat(129) }, MAL('payload.workspaceId'))
await strict('upstream-extra-field', 'An unknown field inside upstream is rejected.', p => { p.upstream.status = 'public-review' }, MAL('payload.upstream'))
await strict('interpretation-key-missing', 'interpretationVersions missing one of the five required keys is rejected.', p => { delete p.interpretationVersions.riskRubricVersion }, MAL('payload.interpretationVersions'))
await strict('interpretation-key-extra', 'interpretationVersions with an unknown extra key is rejected.', p => { p.interpretationVersions.futureVersion = '1.0.0' }, MAL('payload.interpretationVersions'))
await strict('issuedAt-not-canonical', 'issuedAt without milliseconds is rejected: one canonical spelling per instant.', p => { p.issuedAt = '2026-01-15T12:00:00Z' }, MAL('payload.issuedAt'))
await strict('issuedAt-offset', 'issuedAt with a numeric offset is rejected.', p => { p.issuedAt = '2026-01-15T12:00:00.000+00:00' }, MAL('payload.issuedAt'))
await strict('canonicalization-name', 'assessment.canonicalization other than RFC8785 is rejected.', p => { p.assessment.canonicalization = 'JCS' }, MAL('payload.assessment'))
await strict('profile-id-format', 'A profile id that is not lowercase words joined by hyphens is rejected.', p => { p.profile = 'Not A Profile' }, MAL('payload.profile'))
await strict('type-null', 'attestationType: null is malformed, not legacy.', p => { p.attestationType = null }, MAL('payload.attestationType'))
await strict('type-unknown', 'An unknown attestationType is UNSUPPORTED_TYPE, with no partial verification.', p => { p.attestationType = 'agentverify.other-assessment' }, { integrity: 'UNSUPPORTED_TYPE' })
await strict('version-1.1.0', 'attestationVersion 1.1.0 is UNSUPPORTED_VERSION, checked before any other payload field.', p => { p.attestationVersion = '1.1.0' }, { integrity: 'UNSUPPORTED_VERSION' })
await strict('version-2.0.0', 'attestationVersion 2.0.0 is UNSUPPORTED_VERSION.', p => { p.attestationVersion = '2.0.0' }, { integrity: 'UNSUPPORTED_VERSION' })
await strict('version-and-unknown-field', 'A future version that also carries unknown fields is still UNSUPPORTED_VERSION: the version is decided first.', p => { p.attestationVersion = '1.1.0'; p.newConstraint = true }, { integrity: 'UNSUPPORTED_VERSION' })

// ── Section 9: interpretation is separate from integrity (closed schema and profile registries) ─────

const UNSUP = interpretation => ({ integrity: 'VALID', interpretation, reasonCode: 'ok' })
{
  const future = baseAssessment(); future.schemaVersion = '1.2.0'
  await addSigned('S_future-schema', 'A validly signed bundle whose assessment schema (1.2.0) this verifier cannot interpret.', future)
  addCase('interpretation.future-schema', 'Integrity is still VALID (the digest is over opaque JSON), but interpretation is UNSUPPORTED_SCHEMA: show raw JSON only, never a rendered status.', { signed: 'S_future-schema' }, UNSUP('UNSUPPORTED_SCHEMA'))
  const both = baseAssessment(); both.schemaVersion = '1.2.0'; both.profile.profileId = 'some-other-profile'
  await addSigned('S_future-schema-unknown-profile', 'An unsupported schema AND an unknown profile id (the assessment structure cannot be read, so cross-checks that read it are skipped).', both)
  addCase('interpretation.schema-decided-before-profile', 'An unsupported schema is reported as UNSUPPORTED_SCHEMA, not UNSUPPORTED_PROFILE: the schema is decided first.', { signed: 'S_future-schema-unknown-profile' }, UNSUP('UNSUPPORTED_SCHEMA'))
  const up = baseAssessment(); up.profile.profileId = 'some-other-profile'
  await addSigned('S_unknown-profile', 'A validly signed, fully consistent bundle for a profile id that is not in this verifier\'s closed registry.', up)
  addCase('interpretation.unknown-profile', 'INTEGRITY is VALID (never INVALID_SIGNATURE); INTERPRETATION is UNSUPPORTED_PROFILE. Nothing may be rendered or concluded from it.', { signed: 'S_unknown-profile' }, UNSUP('UNSUPPORTED_PROFILE'))
  const uv = baseAssessment(); uv.profile.agentverifyProfileVersion = '9.9.9'
  await addSigned('S_unknown-profile-version', 'A known profile id at a profile version this verifier does not list.', uv)
  addCase('interpretation.unknown-profile-version', 'Known profile, unknown profile version: INTEGRITY VALID, INTERPRETATION UNSUPPORTED_PROFILE_VERSION.', { signed: 'S_unknown-profile-version' }, UNSUP('UNSUPPORTED_PROFILE_VERSION'))
  const fw = baseAssessment(); fw.profile.framework = 'OTHER_FRAMEWORK'; fw.controls.forEach(c => { c.framework = 'OTHER_FRAMEWORK' })
  await addSigned('S_framework-mismatch', 'A known profile id and version whose framework is not the pinned one (payload and assessment agree with each other, and the assessment is structurally valid).', fw)
  addCase('interpretation.framework-not-pinned', 'CHANGED FROM v2 (was UNSUPPORTED_PROFILE): the profile id and version are known but the framework differs from the pinned definition: PROFILE_DEFINITION_MISMATCH, reason profile.framework.', { signed: 'S_framework-mismatch' }, { ...UNSUP('PROFILE_DEFINITION_MISMATCH'), interpretationReason: 'profile.framework' })
  const ctor = baseAssessment(); ctor.profile.profileId = 'constructor'
  await addSigned('S_profile-constructor', 'A profile id that is also an Object.prototype member name: the registry is a closed table looked up by own key, so it is simply unknown.', ctor)
  addCase('interpretation.registry-is-closed', 'profile "constructor" is unknown, not inherited from Object.prototype.', { signed: 'S_profile-constructor' }, UNSUP('UNSUPPORTED_PROFILE'))
  addCase('interpretation.unsupported-never-invalid-signature', 'An unsupported interpretation is never turned into INVALID_SIGNATURE: the same signature verifies whether or not this verifier can read the assessment.', { signed: 'S_unknown-profile' }, { integrity: 'VALID' })
  const down = baseAssessment(); down.profile.implementedControls = ['AST03']; down.controls = down.controls.filter(c => c.controlId === 'AST03')
  // Dropping AST02 and AST04 also drops their checks' only references to ev-0001 and ev-0003; both must move to
  // unmappedEvidenceIds or this would fail the v4 evidence-accounting rule instead of reaching the intended registry check.
  down.unmappedEvidenceIds = ['ev-0001', 'ev-0003']
  await addSigned('S_only-ast03', 'A validly signed, structurally valid bundle that claims profile version 1.0.0-alpha.1 but implements only AST03 (used for the downgrade vectors).', down)
}

const structural = [
  ['payload-field-missing', 'issuedAt removed', [{ op: 'remove', path: `${P}/issuedAt` }], 'payload.missing-field'],
  ['version-missing', 'attestationVersion removed', [{ op: 'remove', path: `${P}/attestationVersion` }], 'payload.attestationVersion'],
  ['type-missing', 'attestationType removed from a payload INSIDE a bundle: a bundle never carries a legacy attestation, so this is malformed rather than routed', [{ op: 'remove', path: `${P}/attestationType` }], 'payload.attestationType'],
  ['fileCount-string', 'package.fileCount as a string', [rep(`${P}/package/fileCount`, '3')], 'payload.package'],
  ['fileCount-negative', 'package.fileCount negative', [rep(`${P}/package/fileCount`, -1)], 'payload.package'],
  ['implementedControls-string', 'implementedControls as a string', [rep(`${P}/implementedControls`, 'AST02')], 'payload.implementedControls'],
  ['implementedControls-duplicate', 'implementedControls containing a duplicate', [rep(`${P}/implementedControls`, ['AST02', 'AST02'])], 'payload.implementedControls'],
  ['package-digest-prefix', 'package digest with the OWASP-style sha256: prefix instead of avpkg-sha256:', [rep(`${P}/package/digest`, `sha256:${zeros(64)}`)], 'payload.package'],
  ['assessment-digest-uppercase', 'assessment digest in uppercase hex', [rep(`${P}/assessment/digest`, `avassess-sha256:${'A'.repeat(64)}`)], 'payload.assessment'],
  ['commit-short', 'OWASP commit shorter than 40 hex characters', [rep(`${P}/upstream/commit`, 'd6f7d7d')], 'payload.upstream'],
  ['profileVersion-not-semver', 'profileVersion not a semantic version', [rep(`${P}/profileVersion`, 'latest')], 'payload.profileVersion'],
  ['keyId-shape', 'keyId not 43 base64url characters', [rep(`${P}/keyId`, 'short')], 'payload.keyId'],
  ['attestation-unknown-field', 'an unknown field on the attestation object', [{ op: 'add', path: '/attestation/note', value: 'x' }], 'attestation.shape'],
  ['bundle-unknown-field', 'an unknown field on the bundle', [{ op: 'add', path: '/note', value: 'x' }], 'bundle.shape'],
  ['bundle-assessment-missing', 'the assessment removed from the bundle', [{ op: 'remove', path: '/assessment' }], 'bundle.shape'],
  ['assessment-not-object', 'the assessment replaced by an array', [rep(A, [])], 'assessment.shape'],
  ['algorithm-missing', 'the algorithm removed', [{ op: 'remove', path: '/attestation/algorithm' }], 'attestation.shape'],
  ['signature-empty', 'an empty signature', [rep(SIGPATH, '')], 'attestation.signature'],
  ['signature-not-base64', 'a signature that is not base64', [rep(SIGPATH, '!!!not-base64!!!')], 'attestation.signature'],
  ['signature-truncated', 'a truncated signature', [rep(SIGPATH, B1.attestation.signature.slice(0, 40))], 'attestation.signature'],
  ['signature-unpadded', 'a signature without its base64 padding (one canonical encoding only)', [rep(SIGPATH, B1.attestation.signature.replace(/=+$/, ''))], 'attestation.signature'],
  ['signature-with-whitespace', 'a signature with a newline inside it', [rep(SIGPATH, `${B1.attestation.signature.slice(0, 44)}\n${B1.attestation.signature.slice(44)}`)], 'attestation.signature'],
  ['signature-wrong-length', 'a 32-byte value that is valid base64', [rep(SIGPATH, Buffer.alloc(32, 1).toString('base64'))], 'attestation.signature'],
  ['publicKey-private-material', 'an embedded key carrying private material (d)', [{ op: 'add', path: '/attestation/publicKey/d', value: 'A'.repeat(43) }], 'jwk.private-key-material'],
  ['publicKey-extra-member', 'an embedded key with WebCrypto-style extra members (ext, key_ops): the new type is stricter than the legacy one', [{ op: 'add', path: '/attestation/publicKey/ext', value: true }], 'jwk.members'],
  ['publicKey-coordinate-length', 'an embedded key with a short x coordinate', [rep('/attestation/publicKey/x', 'AAAA')], 'jwk.coordinates'],
  ['publicKey-coordinate-padded', 'an embedded key whose x is padded with "=" (44 characters)', [rep('/attestation/publicKey/x', `${K.profile.publicJwk.x}=`)], 'jwk.coordinates'],
  ['publicKey-x-noncanonical', 'an embedded key whose x is a NON-CANONICAL spelling of the same 32 bytes: the same key would otherwise get a second keyId', [rep('/attestation/publicKey/x', aliasCoordinate(K.profile.publicJwk.x))], 'jwk.coordinates'],
  ['publicKey-y-noncanonical', 'the same for y', [rep('/attestation/publicKey/y', aliasCoordinate(K.profile.publicJwk.y))], 'jwk.coordinates'],
  ['publicKey-not-object', 'an embedded key that is a string', [rep('/attestation/publicKey', 'key')], 'jwk.shape'],
]
for (const [name, description, patch, reasonCode] of structural) addCase(`malformed.${name}`, description, { signed: 'B1', patch }, MAL(reasonCode))
addCase('unsupported.algorithm-name', 'algorithm ES256 (a real JOSE name, but not this verifier\'s)', { signed: 'B1', patch: [rep('/attestation/algorithm', 'ES256')] }, { integrity: 'UNSUPPORTED_ALGORITHM', reasonCode: 'attestation.algorithm' })
addCase('unsupported.curve', 'an embedded P-384 key', { signed: 'B1', patch: [rep('/attestation/publicKey/crv', 'P-384')] }, { integrity: 'UNSUPPORTED_ALGORITHM', reasonCode: 'jwk.not-p256' })
{
  const offCurve = { ...K.profile.publicJwk, x: 'A'.repeat(43) }
  addCase('malformed.publicKey-not-on-curve', 'a well-shaped, canonical key that is not a point on P-256 (payload keyId set to its thumbprint so the check is reached)', { signed: 'B1', patch: [rep('/attestation/publicKey', offCurve), rep(`${P}/keyId`, await ref.keyIdOf(offCurve))] }, MAL('jwk.not-on-curve'))
}

// ── Section 10: text-level strictness and the signed-content numeric profile ──────────────────

const insertAtBundleAssessment = insertion => { const marker = '"assessment":{'; const at = b1Text.lastIndexOf(marker); return b1Text.slice(0, at + marker.length) + insertion + b1Text.slice(at + marker.length) }
const textMal = (name, description, text, code) => addCase(`text.${name}`, description, { text }, MAL(code))
textMal('duplicate-key-payload', 'a duplicate key in the payload', b1Text.replace('"issuer":"agentverify-conformance"', '"issuer":"x","issuer":"agentverify-conformance"'), 'JSON_DUPLICATE_KEY')
textMal('duplicate-key-assessment', 'a duplicate key in the assessment', insertAtBundleAssessment('"schemaVersion":"1.1.0",'), 'JSON_DUPLICATE_KEY')
textMal('duplicate-key-bundle', 'a duplicate top-level key', b1Text.slice(0, -1) + ',"assessment":{}}', 'JSON_DUPLICATE_KEY')
textMal('duplicate-key-escaped', 'a duplicate key written once literally and once with an escape', insertAtBundleAssessment('"\\u0073chemaVersion":"1.1.0",'), 'JSON_DUPLICATE_KEY')
textMal('lone-surrogate-escape', 'a lone surrogate written as an escape inside the assessment', b1Text.replace('Synthetic assessment for conformance vectors.', 'Synthetic \\ud800 assessment'), 'JSON_ILL_FORMED_STRING')
textMal('nan-literal', 'a NaN literal', insertAtBundleAssessment('"n":NaN,'), 'JSON_SYNTAX')
textMal('trailing-comma', 'a trailing comma', b1Text.replace(/\}$/, ',}'), 'JSON_SYNTAX')
textMal('leading-zero', 'a number with a leading zero', insertAtBundleAssessment('"n":01,'), 'JSON_SYNTAX')
textMal('control-character', 'a raw newline inside a string', b1Text.replace('Synthetic context item.', 'Synthetic\ncontext item.'), 'JSON_SYNTAX')
textMal('bom', 'a byte order mark before the JSON', `\ufeff${b1Text}`, 'JSON_BOM')
textMal('trailing-content', 'content after the JSON value', `${b1Text} x`, 'JSON_TRAILING')
textMal('too-deep', 'nesting deeper than 64', insertAtBundleAssessment(`"deep":${'['.repeat(70)}${']'.repeat(70)},`), 'JSON_TOO_DEEP')
textMal('empty', 'empty input', '', 'JSON_SYNTAX')
// The Agent Verify signed-content numeric profile. NOT an RFC 8785 rule. The rule is about the exact mathematical VALUE: an integer,
// |n| <= 2^53 - 1, not negative zero. Different spellings of the same exact safe integer are the same number; nothing is ever
// converted through a double before it is judged.
const spelled = (from, to, label) => { once(from, label); return b1Text.replace(from, to) }
addCase('equivalent.integer-spelled-with-decimal-point', 'The integer 98 written 98.0 is the same exact safe integer: admitted, canonicalized as 98, and the digest and signature are unchanged.', { text: spelled('"printablePercent":98', '"printablePercent":98.0', 'printablePercent') }, VALID)
addCase('equivalent.integer-spelled-with-exponent', 'The integer 98 written 9.8e1.', { text: spelled('"printablePercent":98', '"printablePercent":9.8e1', 'printablePercent') }, VALID)
addCase('equivalent.integer-spelled-with-zero-exponent', 'The integer 98 written 98e0.', { text: spelled('"printablePercent":98', '"printablePercent":98e0', 'printablePercent') }, VALID)
addCase('equivalent.integer-spelled-with-leading-fraction', 'The integer 98 written 0.98e2.', { text: spelled('"printablePercent":98', '"printablePercent":0.98e2', 'printablePercent') }, VALID)
addCase('equivalent.integer-spelled-with-signed-exponent', 'The integer 98 written 9.8E+1.', { text: spelled('"printablePercent":98', '"printablePercent":9.8E+1', 'printablePercent') }, VALID)
addCase('equivalent.integer-spelled-by-cancelling-exponent', 'The integer 3 written 300e-2: an exactly integral value reached through a negative exponent.', { text: spelled('"count":3', '"count":300e-2', 'count') }, VALID)
addCase('equivalent.largest-safe-integer-as-decimal', 'The largest safe integer written 9007199254740991.0 in an inserted field parses (the digest then differs because the assessment gained a field).', { text: insertAtBundleAssessment('"big":9007199254740991.0,') }, { integrity: 'BINDING_MISMATCH', binding: 'assessment.digest' })
textMal('number-fraction', 'a genuine decimal (0.98) where the scaled integer belongs', b1Text.replace('"printablePercent":98', '"printablePercent":0.98'), 'JSON_NUMBER_NOT_INTEGRAL')
textMal('number-fraction-by-exponent', '98e-1 is 9.8: not an integer, refused, not rounded', b1Text.replace('"printablePercent":98', '"printablePercent":98e-1'), 'JSON_NUMBER_NOT_INTEGRAL')
textMal('number-fraction-half', '98.5 is not an integer: refused, not rounded to 98 or 99', b1Text.replace('"printablePercent":98', '"printablePercent":98.5'), 'JSON_NUMBER_NOT_INTEGRAL')
textMal('number-fraction-beyond-2-53', '9007199254740992.5 would round to ...992 as a double; its exact value is not an integer, so it is refused', insertAtBundleAssessment('"big":9007199254740992.5,'), 'JSON_NUMBER_NOT_INTEGRAL')
textMal('number-unsafe-via-decimal-point', '9007199254740993.0 is an integer, but beyond 2^53 - 1: refused, not silently rounded to ...992', insertAtBundleAssessment('"big":9007199254740993.0,'), 'JSON_NUMBER_UNSAFE_INTEGER')
textMal('number-unsafe-via-exponent', '9.007199254740993e15 is the same value: refused', insertAtBundleAssessment('"big":9.007199254740993e15,'), 'JSON_NUMBER_UNSAFE_INTEGER')
textMal('number-underflow', 'a nonzero literal that a double would silently turn into zero (1e-400): refused', insertAtBundleAssessment('"tiny":1e-400,'), 'JSON_NUMBER_NOT_INTEGRAL')
textMal('number-underflow-huge-exponent', '1e-99999999999 is nonzero: refused without doing any arithmetic on the exponent', insertAtBundleAssessment('"tiny":1e-99999999999,'), 'JSON_NUMBER_NOT_INTEGRAL')
textMal('number-negative-zero', 'negative zero', b1Text.replace('"count":3', '"count":-0'), 'JSON_NUMBER_NEGATIVE_ZERO')
textMal('number-negative-zero-decimal', 'negative zero spelled -0.0', b1Text.replace('"count":3', '"count":-0.0'), 'JSON_NUMBER_NEGATIVE_ZERO')
textMal('number-negative-zero-exponent', 'negative zero spelled -0e5', b1Text.replace('"count":3', '"count":-0e5'), 'JSON_NUMBER_NEGATIVE_ZERO')
textMal('number-unsafe-integer', 'an integer literal beyond 2^53 - 1', insertAtBundleAssessment('"big":9007199254740993,'), 'JSON_NUMBER_UNSAFE_INTEGER')
textMal('number-unsafe-boundary', '2^53 itself is not a safe integer', insertAtBundleAssessment('"big":9007199254740992,'), 'JSON_NUMBER_UNSAFE_INTEGER')
textMal('number-overflow', 'a number literal that overflows a double: an exact integer beyond the safe range', insertAtBundleAssessment('"big":1e999,'), 'JSON_NUMBER_UNSAFE_INTEGER')
textMal('number-overflow-huge-exponent', '1e99999999999: refused without doing any arithmetic on the exponent', insertAtBundleAssessment('"big":1e99999999999,'), 'JSON_NUMBER_UNSAFE_INTEGER')
textMal('number-huge-integer', 'a 40-digit integer literal', insertAtBundleAssessment(`"big":${'9'.repeat(40)},`), 'JSON_NUMBER_UNSAFE_INTEGER')
textMal('number-very-long-integer', 'a 500-digit integer literal is judged as ONE token (it is not truncated into a misleading syntax error)', insertAtBundleAssessment(`"big":${'9'.repeat(500)},`), 'JSON_NUMBER_UNSAFE_INTEGER')
textMal('number-very-long-fraction', 'a fraction with 450 leading zeros is a nonzero value that underflows: refused', insertAtBundleAssessment(`"tiny":0.${'0'.repeat(450)}1,`), 'JSON_NUMBER_NOT_INTEGRAL')
addCase('text.number-safe-boundary-accepted', 'The largest safe integer (2^53 - 1) is admitted in text; the digest then no longer matches because the assessment gained a field, which is the point: it parsed.', { text: insertAtBundleAssessment('"big":9007199254740991,') }, { integrity: 'BINDING_MISMATCH', binding: 'assessment.digest' })

// ── Section 11: size ceiling on bundle text ───────────────────────────────────────────────────

{
  const L = Buffer.byteLength(b1Text, 'utf8')
  addCase('size.at-limit-accepted', 'Text exactly as large as the ceiling is accepted (the ceiling is inclusive).', { text: b1Text }, VALID, { options: { maxBundleBytes: L } })
  addCase('size.one-over-refused', 'One byte over the ceiling is refused BEFORE parsing.', { text: b1Text }, MAL('bundle.too-large'), { options: { maxBundleBytes: L - 1 } })
  addCase('size.tiny-ceiling', 'A small ceiling refuses the bundle.', { text: b1Text }, MAL('bundle.too-large'), { options: { maxBundleBytes: 100 } })
  addCase('size.counted-in-bytes-not-characters', 'The ceiling counts UTF-8 BYTES: this text has more bytes than characters, and a ceiling equal to its character count refuses it.', { text: b1Text }, MAL('bundle.too-large'), { options: { maxBundleBytes: b1Text.length } })
  assert.ok(L > b1Text.length, 'the base bundle contains multi-byte characters')
}

// ── Section 12: Unicode is never normalized ───────────────────────────────────────────────────

{
  const nfc = 'résumé', nfd = 'résumé'
  assert.notEqual(nfc, nfd); assert.equal(nfc.normalize('NFC'), nfd.normalize('NFC'))
  const two = baseAssessment(); two.evidence[2].facts = { [nfc]: 1, [nfd]: 2, both: [nfc, nfd] }
  await addSigned('U_two-spellings', 'An assessment whose facts have two members whose keys are canonically equivalent (NFC and NFD) but not identical, and a string array holding both spellings. They are two members and two strings.', two)
  addCase('unicode.nfc-and-nfd-are-distinct', 'NFC and NFD spellings are different keys and different strings: both are kept, neither is normalized, and the bundle verifies.', { signed: 'U_two-spellings' }, VALID)
  addCase('unicode.normalizing-a-value-changes-the-digest', 'Replacing a path with its canonically equivalent NFD spelling is a DIFFERENT assessment: the digest no longer matches. (A verifier that normalized would have accepted it.)', { signed: 'B1', patch: [rep(`${A}/evidence/1/locations/0/file`, B1.assessment.evidence[1].locations[0].file.normalize('NFD'))] }, DIGEST)
  assert.notEqual(B1.assessment.evidence[1].locations[0].file, B1.assessment.evidence[1].locations[0].file.normalize('NFD'))
  addCase('unicode.swapping-the-two-spellings-changes-the-digest', 'Exchanging the two spellings inside the string array is a different assessment.', { signed: 'U_two-spellings', patch: [{ op: 'swap', path: `${A}/evidence/2/facts/both`, i: 0, j: 1 }] }, DIGEST)
}

// ── Section 13: key state, key purpose, key-set metadata ──────────────────────────────────────

const KS_GEN = '2026-01-14T00:00:00.000Z'
const entry = (name, overrides = {}) => ({ keyId: keyIds[name], jwk: K[name].publicJwk, purpose: ref.PROFILE_KEY_PURPOSE, status: 'active', notBefore: '2026-01-01T00:00:00.000Z', ...overrides })
const set = (keys, overrides = {}) => ({ keySetVersion: ref.KEY_SET_VERSION, sequence: 7, generatedAt: KS_GEN, issuer: ISSUER, keys, ...overrides })
keySets.active = set([entry('profile')])
// The SAME bundle (issuedAt 2026-01-15T12:00:00.000Z) against a retired key, in BOTH orders. The state is KEY_RETIRED in both.
keySets.retiredBeforeIssuedAt = set([entry('profile', { status: 'retired', retiredAt: '2026-01-10T00:00:00.000Z' }), entry('rotated')])
keySets.retiredAfterIssuedAt = set([entry('profile', { status: 'retired', retiredAt: '2026-02-01T00:00:00.000Z' }), entry('rotated')])
keySets.revokedAfterIssuedAt = set([entry('profile', { status: 'revoked', revokedAt: '2026-01-20T00:00:00.000Z' })])
keySets.revokedBeforeIssuedAt = set([entry('profile', { status: 'revoked', revokedAt: '2026-01-01T00:00:00.000Z' })])
keySets.revokedWrongPurpose = set([entry('profile', { status: 'revoked', revokedAt: '2026-01-20T00:00:00.000Z', purpose: 'agentverify-scan-v1' })])
keySets.retiredWrongPurpose = set([entry('profile', { status: 'retired', retiredAt: '2026-02-01T00:00:00.000Z', purpose: 'agentverify-scan-v1' })])
keySets.wrongPurpose = set([entry('profile', { purpose: 'agentverify-scan-v1' })])
keySets.unknownKey = set([entry('rotated')])
keySets.issuerMismatch = set([entry('profile')], { issuer: 'agentverify-other' })
keySets.missingPurpose = set([(() => { const e = entry('profile'); delete e.purpose; return e })()])
keySets.keyIdMismatch = set([entry('profile', { keyId: keyIds.rotated })])
keySets.duplicateEntry = set([entry('profile'), entry('profile')])
keySets.privateMaterial = set([entry('profile', { jwk: { ...K.profile.publicJwk, d: 'A'.repeat(43) } })])
keySets.badStatus = set([entry('profile', { status: 'suspended' })])
keySets.retiredWithoutDate = set([entry('profile', { status: 'retired' })])
keySets.unknownField = set([entry('profile', { comment: 'x' })])
keySets.nonCanonicalCoordinate = set([entry('profile', { jwk: { ...K.profile.publicJwk, x: aliasCoordinate(K.profile.publicJwk.x) } })])
keySets.unknownVersion = set([entry('profile')], { keySetVersion: '2.0.0' })
keySets.missingSequence = (() => { const k = set([entry('profile')]); delete k.sequence; return k })()
keySets.sequenceZero = set([entry('profile')], { sequence: 0 })
keySets.sequenceString = set([entry('profile')], { sequence: '7' })
keySets.badGeneratedAt = set([entry('profile')], { generatedAt: '2026-01-14' })
keySets.unknownTopLevelField = set([entry('profile')], { signature: 'x' })
keySets.sequence3 = set([entry('profile')], { sequence: 3 })
keySets.badPurposeEmpty = set([entry('profile', { purpose: '' })])
keySets.badNotBefore = set([entry('profile', { notBefore: '2026-01-01' })])
keySets.otherIssuer = set([entry('profile')], { issuer: 'agentverify-other', sequence: 2 })
keySets.constructorIssuer = set([entry('profile')], { issuer: 'constructor', sequence: 4 })

const state = (name, description, source, keySet, expected, options) => addCase(`key-state.${name}`, description, source, expected, { ...(keySet === undefined ? {} : { keySet }), ...(options ? { options } : {}) })
state('no-key-set', 'With no key set the result is explicitly NOT_EVALUATED: internal consistency only. There is no "trusted" state anywhere.', { signed: 'B1' }, undefined, { integrity: 'VALID', keyState: 'NOT_EVALUATED' })
state('active', 'Listed as an active key for the profile purpose in the supplied key set. This records what the key set says; it is not a trust decision.', { signed: 'B1' }, 'active', { integrity: 'VALID', keyState: 'KEY_ACTIVE', keySetSequence: 7 })
state('retired.issuedAt-after-retiredAt', 'The key set records the key as retired on 2026-01-10; the payload CLAIMS issuedAt 2026-01-15. The state is KEY_RETIRED. No anomaly is flagged and nothing is concluded about when the signature was really made.', { signed: 'B1' }, 'retiredBeforeIssuedAt', { integrity: 'VALID', keyState: 'KEY_RETIRED' })
state('retired.issuedAt-before-retiredAt', 'The key set records the key as retired on 2026-02-01; the payload claims issuedAt 2026-01-15. Also KEY_RETIRED: identical to the other order, so no time inference is made either way. issuedAt is a signer claim, not trusted time.', { signed: 'B1' }, 'retiredAfterIssuedAt', { integrity: 'VALID', keyState: 'KEY_RETIRED' })
state('rotated-in-active', 'The same content signed by the rotated-in key, which is active.', { signed: 'B_rotated' }, 'retiredBeforeIssuedAt', { integrity: 'VALID', keyState: 'KEY_ACTIVE' })
state('revoked.revokedAt-after-issuedAt', 'Revoked on 2026-01-20; claimed issuedAt is earlier. KEY_REVOKED regardless: after a compromise every signature under the key is suspect, whatever it says about time.', { signed: 'B1' }, 'revokedAfterIssuedAt', { integrity: 'VALID', keyState: 'KEY_REVOKED' })
state('revoked.revokedAt-before-issuedAt', 'Revoked on 2026-01-01; claimed issuedAt is later. KEY_REVOKED, identically.', { signed: 'B1' }, 'revokedBeforeIssuedAt', { integrity: 'VALID', keyState: 'KEY_REVOKED' })
state('purpose-mismatch', 'The key is in the key set but declared for another purpose: KEY_PURPOSE_MISMATCH, distinct from a bad signature and from an unknown key. Integrity is unaffected.', { signed: 'B1' }, 'wrongPurpose', { integrity: 'VALID', keyState: 'KEY_PURPOSE_MISMATCH' })
state('purpose-checked-before-revocation', 'A revoked key with the wrong purpose reports KEY_PURPOSE_MISMATCH: the purpose is checked first. (Both are refused by every policy.)', { signed: 'B1' }, 'revokedWrongPurpose', { integrity: 'VALID', keyState: 'KEY_PURPOSE_MISMATCH' })
state('purpose-checked-before-retirement', 'A retired key with the wrong purpose reports KEY_PURPOSE_MISMATCH, not KEY_RETIRED.', { signed: 'B1' }, 'retiredWrongPurpose', { integrity: 'VALID', keyState: 'KEY_PURPOSE_MISMATCH' })
state('unknown-key', 'keyId absent from the key set.', { signed: 'B1' }, 'unknownKey', { integrity: 'VALID', keyState: 'KEY_UNKNOWN' })
state('self-signed-attacker', 'An internally consistent bundle signed by a key nobody published.', { signed: 'B_attacker' }, 'active', { integrity: 'VALID', keyState: 'KEY_UNKNOWN' })
state('issuer-mismatch', 'Payload issuer is not the key set\'s issuer namespace.', { signed: 'B1' }, 'issuerMismatch', { integrity: 'VALID', keyState: 'KEY_UNKNOWN' })
const invalidSet = (name, description, keySetName, reason) => state(`key-set-invalid.${name}`, description, { signed: 'B1' }, keySetName, { integrity: 'VALID', keyState: 'KEY_SET_INVALID', keyStateReason: reason })
invalidSet('missing-purpose', 'A key set entry with no purpose is not a usable key set: purpose must be explicit.', 'missingPurpose', 'keySet.entry.shape')
invalidSet('keyId-mismatch', 'A key set entry whose keyId is not the thumbprint of its own key.', 'keyIdMismatch', 'keySet.entry.keyId-does-not-match-jwk')
invalidSet('duplicate', 'Two key set entries with the same keyId.', 'duplicateEntry', 'keySet.entry.duplicate')
invalidSet('private-material', 'A key set entry carrying private key material.', 'privateMaterial', 'keySet.entry.jwk')
invalidSet('bad-status', 'A key set entry with an unknown status.', 'badStatus', 'keySet.entry.status')
invalidSet('retired-without-date', 'A retired entry without retiredAt.', 'retiredWithoutDate', 'keySet.entry.dates')
invalidSet('unknown-field', 'A key set entry with an unknown field.', 'unknownField', 'keySet.entry.shape')
invalidSet('non-canonical-coordinate', 'A key set entry whose x is a non-canonical spelling: one key, one accepted spelling, one keyId.', 'nonCanonicalCoordinate', 'keySet.entry.jwk')
invalidSet('unknown-version', 'An unknown keySetVersion fails closed.', 'unknownVersion', 'keySet.version')
invalidSet('missing-sequence', 'A key set without a sequence.', 'missingSequence', 'keySet.shape')
invalidSet('sequence-zero', 'sequence must be a positive integer.', 'sequenceZero', 'keySet.sequence')
invalidSet('sequence-string', 'sequence must be an integer, not a string.', 'sequenceString', 'keySet.sequence')
invalidSet('bad-generatedAt', 'generatedAt must be a canonical timestamp (it is informational, but its form is strict).', 'badGeneratedAt', 'keySet.generatedAt')
invalidSet('unknown-top-level-field', 'An unknown field on the key set itself.', 'unknownTopLevelField', 'keySet.shape')
invalidSet('entry-purpose-empty', 'A key set entry whose purpose is present but EMPTY: purpose must be explicit and non-empty.', 'badPurposeEmpty', 'keySet.entry.purpose')
invalidSet('entry-notBefore-not-canonical', 'A key set entry whose notBefore is not a canonical timestamp (2026-01-01 instead of 2026-01-01T00:00:00.000Z).', 'badNotBefore', 'keySet.entry.notBefore')
const RETAINED = (obj) => ({ retainedSequenceByIssuer: obj })
const OTHER = 'agentverify-other'
state('rollback.stale-key-set-for-the-correct-issuer', 'The verifier retained sequence 5 FOR THIS ISSUER (agentverify-conformance, the issuer named in the bundle\'s own payload) and is offered a key set with sequence 3: KEY_SET_ROLLBACK_DETECTED. This is rollback DETECTION, and it works only because the verifier retained prior state for this issuer.', { signed: 'B1' }, 'sequence3', { integrity: 'VALID', keyState: 'KEY_SET_ROLLBACK_DETECTED', keySetSequence: 3, keySetSequenceCheck: 'BEHIND_RETAINED' }, RETAINED({ [ISSUER]: 5 }))
state('rollback.sequence-equal-to-retained', 'The same sequence as retained (7) is not behind it. The check says NOT_BEHIND_RETAINED: "not older than something already seen", which is not freshness.', { signed: 'B1' }, 'active', { integrity: 'VALID', keyState: 'KEY_ACTIVE', keySetSequence: 7, keySetSequenceCheck: 'NOT_BEHIND_RETAINED' }, RETAINED({ [ISSUER]: 7 }))
state('rollback.sequence-above-retained', 'A higher sequence than retained is not behind it.', { signed: 'B1' }, 'active', { integrity: 'VALID', keyState: 'KEY_ACTIVE', keySetSequenceCheck: 'NOT_BEHIND_RETAINED' }, RETAINED({ [ISSUER]: 2 }))
state('rollback.no-retained-state', 'No retained state at all: the result says NO_RETAINED_STATE. The sequence could not be checked, and that is NOT the same as "sequence confirmed": a verifier with no state learns nothing from the number.', { signed: 'B1' }, 'active', { integrity: 'VALID', keyState: 'KEY_ACTIVE', keySetSequence: 7, keySetSequenceCheck: 'NO_RETAINED_STATE' })
state('rollback.empty-retained-state', 'An empty retained-state object is the same as none.', { signed: 'B1' }, 'active', { integrity: 'VALID', keyState: 'KEY_ACTIVE', keySetSequenceCheck: 'NO_RETAINED_STATE' }, RETAINED({}))
state('rollback.low-sequence-with-no-state-is-accepted', 'The same low-sequence (3) key set with no retained state is simply used, and reported as NO_RETAINED_STATE. The numbers alone protect nothing.', { signed: 'B1' }, 'sequence3', { integrity: 'VALID', keyState: 'KEY_ACTIVE', keySetSequence: 3, keySetSequenceCheck: 'NO_RETAINED_STATE' })
state('rollback.other-issuers-state-is-ignored', 'Retained state exists, but only for ANOTHER issuer (agentverify-other, sequence 99). It cannot affect this bundle: NO_RETAINED_STATE, and the low-sequence key set is not flagged.', { signed: 'B1' }, 'sequence3', { integrity: 'VALID', keyState: 'KEY_ACTIVE', keySetSequenceCheck: 'NO_RETAINED_STATE' }, RETAINED({ [OTHER]: 99 }))
state('rollback.only-the-payload-issuer-counts', 'Retained state for two issuers: the unrelated one (99) is ignored and the payload issuer\'s own (2) is used: not behind.', { signed: 'B1' }, 'sequence3', { integrity: 'VALID', keyState: 'KEY_ACTIVE', keySetSequenceCheck: 'NOT_BEHIND_RETAINED' }, RETAINED({ [OTHER]: 99, [ISSUER]: 2 }))
state('rollback.issuer-a-state-cannot-affect-issuer-b', 'A bundle issued under agentverify-other, with its own key set (sequence 2). Issuer A\'s retained sequence (99) cannot affect it.', { signed: 'B_issuerOther' }, 'otherIssuer', { integrity: 'VALID', keyState: 'KEY_ACTIVE', keySetSequence: 2, keySetSequenceCheck: 'NO_RETAINED_STATE' }, RETAINED({ [ISSUER]: 99 }))
state('rollback.issuer-b-own-state-applies', 'The same issuer-B bundle, with retained state for issuer B (5): now the stale key set is detected.', { signed: 'B_issuerOther' }, 'otherIssuer', { integrity: 'VALID', keyState: 'KEY_SET_ROLLBACK_DETECTED', keySetSequence: 2, keySetSequenceCheck: 'BEHIND_RETAINED' }, RETAINED({ [OTHER]: 5 }))
state('rollback.key-set-for-another-issuer-consults-no-state', 'A key set whose issuer is not the payload\'s issuer is not this issuer\'s key set: KEY_UNKNOWN, and NO retained state is consulted (no sequence check is reported).', { signed: 'B1' }, 'issuerMismatch', { integrity: 'VALID', keyState: 'KEY_UNKNOWN' }, RETAINED({ [ISSUER]: 99, [OTHER]: 99 }))
state('rollback.issuer-named-like-a-prototype-member', 'An issuer literally named "constructor": retained state is read by OWN key only, so an empty state object has nothing for it (an inherited lookup would return a function).', { signed: 'B_issuerConstructor' }, 'constructorIssuer', { integrity: 'VALID', keyState: 'KEY_ACTIVE', keySetSequence: 4, keySetSequenceCheck: 'NO_RETAINED_STATE' }, RETAINED({}))
state('rollback.prototype-named-issuer-with-real-state', 'The same issuer with real retained state (9): it is used, and the key set (sequence 4) is behind it.', { signed: 'B_issuerConstructor' }, 'constructorIssuer', { integrity: 'VALID', keyState: 'KEY_SET_ROLLBACK_DETECTED', keySetSequenceCheck: 'BEHIND_RETAINED' }, RETAINED({ constructor: 9 }))
state('not-evaluated-when-integrity-fails', 'Key state is never evaluated for a bundle whose integrity failed, even with a matching key set.', { signed: 'B1', patch: [rep(`${P}/issuedAt`, '2026-01-15T12:00:01.000Z')] }, 'active', { integrity: 'INVALID_SIGNATURE', keyState: 'NOT_EVALUATED' })

// ── Section 14: policy is verifier-owned and separate ─────────────────────────────────────────

const policy = (name, description, source, keySet, pol, expected) => addCase(`policy.${name}`, description, source, expected, { ...(keySet ? { keySet } : {}), policy: pol })
const ALL3 = ['AST02', 'AST03', 'AST04']
const SAT = { status: 'SATISFIED', failures: [] }
const NOT = (...failures) => ({ status: 'NOT_SATISFIED', failures })
policy('satisfied', 'A policy that the bundle satisfies (default: only KEY_ACTIVE is accepted).', { signed: 'B1' }, 'active', { requiredProfile: PROFILE_ID, allowedUpstreamCommits: ['d6f7d7d0de314f52a83a85d1828e06ab096e595c'], requiredControls: ALL3, requiredPackageDigest: PACKAGE_DIGEST }, { integrity: 'VALID', policy: SAT })
policy('wrong-profile', 'A different profile was required.', { signed: 'B1' }, 'active', { requiredProfile: 'owasp-agentic-skills-2027' }, { integrity: 'VALID', policy: NOT('PROFILE_NOT_ALLOWED') })
policy('commit-not-allowed', 'The OWASP commit is not in the verifier\'s allowed list.', { signed: 'B1' }, 'active', { allowedUpstreamCommits: ['f'.repeat(40)] }, { integrity: 'VALID', policy: NOT('UPSTREAM_COMMIT_NOT_ALLOWED') })
policy('downgrade', 'DOWNGRADE DEFENCE (two independent gates): an attestation that implements only AST03 fails the pinned profile definition (interpretation) AND the verifier required controls.', { signed: 'S_only-ast03' }, 'active', { requiredControls: ALL3 }, { integrity: 'VALID', interpretation: 'PROFILE_DEFINITION_MISMATCH', policy: NOT('INTERPRETATION_UNSUPPORTED', 'CONTROLS_NOT_COVERED') })
policy('package-digest-mismatch', 'The package on disk is not the one assessed.', { signed: 'B1' }, 'active', { requiredPackageDigest: `avpkg-sha256:${zeros(64)}` }, { integrity: 'VALID', policy: NOT('PACKAGE_DIGEST_MISMATCH') })
policy('fresh-enough', 'Within the maximum age (verifier-supplied clock).', { signed: 'B1' }, 'active', { maxAgeSeconds: 7200, now: '2026-01-15T13:00:00.000Z' }, { integrity: 'VALID', policy: SAT })
policy('too-old', 'Older than the maximum age.', { signed: 'B1' }, 'active', { maxAgeSeconds: 7200, now: '2026-01-15T15:00:00.000Z' }, { integrity: 'VALID', policy: NOT('TOO_OLD') })
policy('retired-refused-by-default', 'The reference default accepts KEY_ACTIVE only: a retired key is refused unless the policy opts in.', { signed: 'B1' }, 'retiredBeforeIssuedAt', {}, { integrity: 'VALID', keyState: 'KEY_RETIRED', policy: NOT('KEY_STATE_NOT_ACCEPTED') })
policy('retired-opt-in.issuedAt-after-retiredAt', 'Historical or offline verification explicitly opts into KEY_RETIRED. This is a policy choice, and says nothing about when the signature was made.', { signed: 'B1' }, 'retiredBeforeIssuedAt', { acceptedKeyStates: ['KEY_ACTIVE', 'KEY_RETIRED'] }, { integrity: 'VALID', keyState: 'KEY_RETIRED', policy: SAT })
policy('retired-opt-in.issuedAt-before-retiredAt', 'The same opt-in with the dates the other way round: the same result.', { signed: 'B1' }, 'retiredAfterIssuedAt', { acceptedKeyStates: ['KEY_ACTIVE', 'KEY_RETIRED'] }, { integrity: 'VALID', keyState: 'KEY_RETIRED', policy: SAT })
policy('revoked-never-accepted', 'KEY_REVOKED is never accepted, even with valid signature mathematics and a policy that accepts everything acceptable.', { signed: 'B1' }, 'revokedAfterIssuedAt', { acceptedKeyStates: ['KEY_ACTIVE', 'KEY_RETIRED'] }, { integrity: 'VALID', keyState: 'KEY_REVOKED', policy: NOT('KEY_STATE_NOT_ACCEPTED') })
policy('invalid-lists-revoked', 'A policy that LISTS KEY_REVOKED as acceptable is invalid, and fails closed.', { signed: 'B1' }, 'active', { acceptedKeyStates: ['KEY_ACTIVE', 'KEY_REVOKED'] }, { integrity: 'VALID', policy: { status: 'INVALID_POLICY', failures: ['ACCEPTED_KEY_STATES_INVALID'] } })
policy('invalid-empty', 'An empty acceptedKeyStates is invalid.', { signed: 'B1' }, 'active', { acceptedKeyStates: [] }, { integrity: 'VALID', policy: { status: 'INVALID_POLICY', failures: ['ACCEPTED_KEY_STATES_INVALID'] } })
policy('invalid-unknown-state', 'A state that is not an acceptable key state (there is no TRUSTED state) is invalid.', { signed: 'B1' }, 'active', { acceptedKeyStates: ['TRUSTED'] }, { integrity: 'VALID', policy: { status: 'INVALID_POLICY', failures: ['ACCEPTED_KEY_STATES_INVALID'] } })
policy('invalid-lists-unknown-key', 'KEY_UNKNOWN cannot be listed as acceptable either.', { signed: 'B1' }, 'active', { acceptedKeyStates: ['KEY_UNKNOWN'] }, { integrity: 'VALID', policy: { status: 'INVALID_POLICY', failures: ['ACCEPTED_KEY_STATES_INVALID'] } })
policy('no-key-set-fails-default', 'Without a key set the key state is NOT_EVALUATED, which no policy accepts.', { signed: 'B1' }, undefined, {}, { integrity: 'VALID', keyState: 'NOT_EVALUATED', policy: NOT('KEY_STATE_NOT_ACCEPTED') })
policy('purpose-mismatch-refused', 'KEY_PURPOSE_MISMATCH is refused by every policy.', { signed: 'B1' }, 'wrongPurpose', { acceptedKeyStates: ['KEY_ACTIVE', 'KEY_RETIRED'] }, { integrity: 'VALID', keyState: 'KEY_PURPOSE_MISMATCH', policy: NOT('KEY_STATE_NOT_ACCEPTED') })
policy('rollback-detected-refused', 'KEY_SET_ROLLBACK_DETECTED is refused by every policy.', { signed: 'B1' }, 'sequence3', { acceptedKeyStates: ['KEY_ACTIVE', 'KEY_RETIRED'] }, { integrity: 'VALID', keyState: 'KEY_SET_ROLLBACK_DETECTED', policy: NOT('KEY_STATE_NOT_ACCEPTED') })
cases.find(c => c.name === 'policy.rollback-detected-refused').options = { retainedSequenceByIssuer: { [ISSUER]: 5 } }
addCase('policy.unsupported-profile-cannot-satisfy', 'Unknown profile fails closed for any security conclusion: integrity is VALID and the key is active, but the policy is NOT satisfied.', { signed: 'S_unknown-profile' }, { integrity: 'VALID', interpretation: 'UNSUPPORTED_PROFILE', keyState: 'KEY_ACTIVE', policy: NOT('INTERPRETATION_UNSUPPORTED') }, { keySet: 'active', policy: {} })
addCase('policy.unsupported-profile-version-cannot-satisfy', 'Unknown profile version fails closed for any security conclusion.', { signed: 'S_unknown-profile-version' }, { integrity: 'VALID', interpretation: 'UNSUPPORTED_PROFILE_VERSION', policy: NOT('INTERPRETATION_UNSUPPORTED') }, { keySet: 'active', policy: {} })
addCase('policy.unsupported-schema-cannot-satisfy', 'Unknown assessment schema fails closed for any security conclusion.', { signed: 'S_future-schema' }, { integrity: 'VALID', interpretation: 'UNSUPPORTED_SCHEMA', policy: NOT('INTERPRETATION_UNSUPPORTED') }, { keySet: 'active', policy: {} })

// ══ VECTOR SET v4 ADDITIONS (bundle-level) ═══════════════════════════════════════════════════
//
// Each group below answers a finding of the second independent review. The section comments say which.

const encoder = new TextEncoder()
const B64STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const nest = k => { let v = 'x'; for (let i = 0; i < k; i++) v = [v]; return v }
const b1Bytes = Buffer.from(b1Text, 'utf8')
const bytesWith = (needle, replacement) => { const at = b1Bytes.indexOf(Buffer.from(needle, 'utf8')); assert.ok(at >= 0, `needle ${needle}`); return Buffer.concat([b1Bytes.subarray(0, at), Buffer.from(replacement), b1Bytes.subarray(at + Buffer.byteLength(needle, 'utf8'))]) }

// ── v3-1: impossible calendar dates and one strict timestamp form (review item: decorative dates / Date.parse rollover) ──
//
// Every one of these is a SIGNED payload, so the rule under test is the timestamp parser and nothing else.

for (const [name, ts, why] of [
  ['feb-30', '2026-02-30T00:00:00.000Z', 'February 30 does not exist (Date.parse-style parsers roll it into March)'],
  ['apr-31', '2026-04-31T00:00:00.000Z', 'April has 30 days'],
  ['jun-31', '2026-06-31T00:00:00.000Z', 'June has 30 days'],
  ['feb-29-non-leap', '2025-02-29T00:00:00.000Z', 'February 29 in a common year'],
  ['feb-29-century-non-leap', '2100-02-29T00:00:00.000Z', '2100 is divisible by 100 but not 400, so it is not a leap year'],
  ['hour-24', '2026-01-15T24:00:00.000Z', '24:00 is not admitted (some parsers roll it to the next day)'],
  ['leap-second', '2026-06-30T23:59:60.000Z', 'a leap second (:60) is not admitted'],
  ['minute-60', '2026-01-15T12:60:00.000Z', 'minute 60'],
  ['month-13', '2026-13-01T00:00:00.000Z', 'month 13'],
  ['month-00', '2026-00-10T00:00:00.000Z', 'month 00'],
  ['day-00', '2026-01-00T00:00:00.000Z', 'day 00'],
  ['year-0000', '0000-01-01T00:00:00.000Z', 'year 0000 is outside the admitted 0001-9999 range'],
  ['lowercase-t-z', '2026-01-15t12:00:00.000z', 'lowercase T and Z'],
  ['space-separator', '2026-01-15 12:00:00.000Z', 'a space instead of T'],
  ['four-fraction-digits', '2026-01-15T12:00:00.0000Z', 'four fractional digits'],
  ['expanded-year', '+002026-01-15T12:00:00.000Z', 'an expanded year with a sign'],
  ['trailing-space', '2026-01-15T12:00:00.000Z ', 'trailing whitespace'],
  ['fullwidth-digits', '２０２６-01-15T12:00:00.000Z', 'fullwidth digits (Date and regex \\d may disagree about these)'],
]) await strict(`issuedAt-${name}`, `issuedAt ${JSON.stringify(ts)}: ${why}. Rejected by the one strict timestamp parser, not by Date.parse.`, p => { p.issuedAt = ts }, MAL('payload.issuedAt'))
for (const [name, ts, why] of [['leap-day', '2024-02-29T12:00:00.000Z', 'February 29 in a leap year'], ['century-leap-day', '2000-02-29T12:00:00.000Z', '2000 is divisible by 400, so it is a leap year'], ['last-instant', '9999-12-31T23:59:59.999Z', 'the largest admitted instant'], ['first-instant', '0001-01-01T00:00:00.000Z', 'the smallest admitted instant']]) {
  await addSigned(`T_${name}`, `A signed bundle whose issuedAt is ${ts}: ${why}.`, baseAssessment(), { mutate: p => { p.issuedAt = ts } })
  addCase(`timestamp.valid.${name}`, `issuedAt ${ts} (${why}) is admitted.`, { signed: `T_${name}` }, VALID)
}

// ── v3-1b: a cross-check compares TYPES as well as text (a string is not a list, and "3" is not 3) ──
{
  const strFileCount = baseAssessment(); strFileCount.package.fileCount = '3'
  await addSigned('L_package.fileCount.assessment-has-a-string', 'The payload states fileCount 3 (a number); the assessment states "3" (a string). The assessment digest covers the string, so only the cross-check can notice.', strFileCount, { mutate: p => { p.package.fileCount = 3 } })
  addCase('binding.signer-lied.package.fileCount.assessment-has-a-string', 'A number in the payload and the same digits as a STRING in the assessment are not the same value: BINDING_MISMATCH on package.fileCount (no loose equality).', { signed: 'L_package.fileCount.assessment-has-a-string' }, { integrity: 'BINDING_MISMATCH', binding: 'package.fileCount' })
  const strControls = baseAssessment(); strControls.profile.implementedControls = 'AST02,AST03,AST04'
  await addSigned('L_implementedControls.assessment-has-a-string', 'The payload lists the implemented controls as an array; the assessment states them as ONE comma-joined string (its String() equals the array\'s).', strControls, { mutate: p => { p.implementedControls = ['AST02', 'AST03', 'AST04'] } })
  addCase('binding.signer-lied.implementedControls.assessment-has-a-string', 'An array and its comma-joined string are not the same value: BINDING_MISMATCH on implementedControls.', { signed: 'L_implementedControls.assessment-has-a-string' }, { integrity: 'BINDING_MISMATCH', binding: 'implementedControls' })
}

// ── v3-2: signature base64 aliases (review item: non-canonical / trailing-bit signature spellings) ──

{
  const sig = B1.attestation.signature
  const last = sig[85], bits = B64STD.indexOf(last)
  assert.equal(bits & 0x0f, 0, 'the four unused bits of the last data character are zero in a canonical signature')
  const alias1 = `${sig.slice(0, 85)}${B64STD[bits | 0x01]}==`
  const aliasAll = `${sig.slice(0, 85)}${B64STD[bits | 0x0f]}==`
  assert.ok(Buffer.from(alias1, 'base64').equals(Buffer.from(sig, 'base64')), 'a lenient decoder reads the alias as the SAME 64 bytes')
  assert.ok(Buffer.from(aliasAll, 'base64').equals(Buffer.from(sig, 'base64')))
  const M = (name, description, value) => addCase(`malformed.signature-${name}`, description, { signed: 'B1', patch: [rep(SIGPATH, value)] }, MAL('attestation.signature'))
  M('trailing-bits-alias', 'One unused trailing bit set in the last base64 character: a lenient decoder reads exactly the same 64 bytes (so the same valid signature), but the spelling is not canonical: refused.', alias1)
  M('trailing-bits-alias-all-set', 'All four unused trailing bits set: the same 64 bytes, a different spelling, refused.', aliasAll)
  M('extra-padding', 'The canonical text plus one more "=".', `${sig}=`)
  M('single-padding', 'Only one "=" of padding where two are required.', sig.slice(0, -1))
  M('url-safe-alphabet-character', 'A character from the URL-safe alphabet ("-") where the standard alphabet is required.', `${sig.slice(0, 10)}-${sig.slice(11)}`)
  M('url-safe-underscore', 'The other URL-safe character ("_").', `${sig.slice(0, 10)}_${sig.slice(11)}`)
  M('leading-space', 'A leading space.', ` ${sig.slice(1)}`)
  M('not-a-string', 'A number where the signature string belongs.', 7)
  addCase('malformed.signature-null', 'null where the signature belongs.', { signed: 'B1', patch: [rep(SIGPATH, null)] }, MAL('attestation.signature'))
}

// ── v3-3: unsupported schema versus payload disagreement (review item: which cross-checks run under an unsupported schema) ──
//
// THE RULE (pinned by these vectors): the assessment's top-level `schemaVersion` is ALWAYS cross-checked against the payload's
// assessmentSchemaVersion, and the digest is ALWAYS checked. Every check that reads the assessment's STRUCTURE is skipped under a
// schema this verifier cannot interpret, because nothing can be inferred from a structure that cannot be read.

{
  const future = () => { const a = baseAssessment(); a.schemaVersion = '1.2.0'; return a }
  await addSigned('S_future-schema-payload-says-supported', 'The assessment says schemaVersion 1.2.0 (unsupported) but the SIGNED payload says assessmentSchemaVersion 1.1.0.', future(), { mutate: p => { p.assessmentSchemaVersion = '1.1.0' } })
  addCase('unsupported-schema.payload-disagrees', 'An unsupported schema that also disagrees with the payload: the schemaVersion cross-check runs for EVERY schema, so this is BINDING_MISMATCH (not UNSUPPORTED_SCHEMA): the signer contradicted itself.', { signed: 'S_future-schema-payload-says-supported' }, { integrity: 'BINDING_MISMATCH', binding: 'assessmentSchemaVersion' })
  await addSigned('S_supported-schema-payload-says-future', 'The assessment says 1.1.0 (supported) but the signed payload says 1.2.0.', baseAssessment(), { mutate: p => { p.assessmentSchemaVersion = '1.2.0' } })
  addCase('unsupported-schema.payload-claims-future-assessment-supported', 'The mirror image: BINDING_MISMATCH on assessmentSchemaVersion.', { signed: 'S_supported-schema-payload-says-future' }, { integrity: 'BINDING_MISMATCH', binding: 'assessmentSchemaVersion' })
  for (const [name, mutate, what] of [
    ['profile', p => { p.profile = 'owasp-agentic-skills-2027' }, 'the payload profile id'],
    ['upstream-commit', p => { p.upstream.commit = 'f'.repeat(40) }, 'the payload upstream commit'],
    ['implemented-controls', p => { p.implementedControls = ['AST03'] }, 'the payload implementedControls'],
    ['package-digest', p => { p.package.digest = `avpkg-sha256:${zeros(64)}` }, 'the payload package digest'],
    ['interpretation-version', p => { p.interpretationVersions.riskRubricVersion = '9.9.9' }, 'a payload interpretation version'],
  ]) {
    await addSigned(`S_future-schema-skips-${name}`, `Unsupported schema (1.2.0, payload agrees) and ${what} disagrees with the assessment's structure.`, future(), { mutate })
    addCase(`unsupported-schema.structure-check-skipped.${name}`, `Under an unsupported schema the structure-dependent cross-check for ${what} is SKIPPED (the structure cannot be read), so integrity is VALID and the interpretation is UNSUPPORTED_SCHEMA. The same lie under a SUPPORTED schema is BINDING_MISMATCH (see binding.signer-lied.*).`, { signed: `S_future-schema-skips-${name}` }, UNSUP('UNSUPPORTED_SCHEMA'))
  }
  addCase('unsupported-schema.digest-still-checked', 'The digest binding is never skipped: changing an unsupported-schema assessment after signing is BINDING_MISMATCH on the digest.', { signed: 'S_future-schema', patch: [{ op: 'add', path: `${A}/futureField`, value: 1 }] }, DIGEST)
}

// ── v3-4: key purpose is compared exactly ─────────────────────────────────────────────────────

keySets.purposeUpperCase = set([entry('profile', { purpose: 'AGENTVERIFY-PROFILE-V1' })])
keySets.purposeMixedCase = set([entry('profile', { purpose: 'AgentVerify-Profile-V1' })])
keySets.purposeTrailingSpace = set([entry('profile', { purpose: 'agentverify-profile-v1 ' })])
state('purpose-case-mismatch.upper', 'Purpose "AGENTVERIFY-PROFILE-V1" is not "agentverify-profile-v1": purposes are compared exactly, case-sensitively.', { signed: 'B1' }, 'purposeUpperCase', { integrity: 'VALID', keyState: 'KEY_PURPOSE_MISMATCH' })
state('purpose-case-mismatch.mixed', 'Purpose "AgentVerify-Profile-V1": still a mismatch.', { signed: 'B1' }, 'purposeMixedCase', { integrity: 'VALID', keyState: 'KEY_PURPOSE_MISMATCH' })
state('purpose-trailing-whitespace', 'A purpose with a trailing space is a different string: mismatch.', { signed: 'B1' }, 'purposeTrailingSpace', { integrity: 'VALID', keyState: 'KEY_PURPOSE_MISMATCH' })

// ── v3-5: bare attestation routing with null / empty attestationType ──────────────────────────

{
  const bare = t => { const a = structuredClone(B1.attestation); if (t === undefined) delete a.payload.attestationType; else a.payload.attestationType = t; return { text: JSON.stringify(a) } }
  addCase('route.bare-attestation-without-type-is-legacy', 'A BARE attestation (no bundle) whose payload has no attestationType key is the legacy scan type by definition: it is routed, not verified here.', bare(undefined), { route: 'LEGACY_SCAN_ATTESTATION', integrity: 'NOT_EVALUATED', reasonCode: 'route.legacy' })
  addCase('route.bare-attestation-null-type-is-malformed', 'A bare attestation carrying attestationType: null claims to be typed. Typed attestations only travel inside a bundle, so this is MALFORMED, never routed to the legacy verifier.', bare(null), { route: 'PROFILE_ASSESSMENT', integrity: 'MALFORMED', reasonCode: 'bundle.bare-typed-attestation' })
  addCase('route.bare-attestation-empty-type-is-malformed', 'The same for attestationType: "".', bare(''), { route: 'PROFILE_ASSESSMENT', integrity: 'MALFORMED', reasonCode: 'bundle.bare-typed-attestation' })
  addCase('route.bare-attestation-valid-type-is-malformed', 'A bare attestation with the CORRECT type string but no bundle is still not a bundle.', bare(ref.ATTESTATION_TYPE), { route: 'PROFILE_ASSESSMENT', integrity: 'MALFORMED', reasonCode: 'bundle.bare-typed-attestation' })
  addCase('route.no-bundleVersion-no-payload', 'An object with neither a bundleVersion nor an attestation payload.', { text: '{"x":1}' }, MAL('bundle.bundleVersion'))
  addCase('route.array-is-not-a-bundle', 'A top-level array.', { text: '[]' }, MAL('bundle.shape'))
}

// ── v3-6: key-set shape (keys not an array; empty issuer; impossible key-set dates) ────────────

keySets.keysNotArrayObject = { ...set([entry('profile')]), keys: {} }
keySets.keysNull = { ...set([entry('profile')]), keys: null }
keySets.keysString = { ...set([entry('profile')]), keys: 'abc' }
keySets.issuerEmpty = set([entry('profile')], { issuer: '' })
keySets.issuerNumber = set([entry('profile')], { issuer: 7 })
keySets.emptyKeyList = set([])
keySets.impossibleGeneratedAt = set([entry('profile')], { generatedAt: '2026-02-30T00:00:00.000Z' })
keySets.impossibleNotBefore = set([entry('profile', { notBefore: '2026-04-31T00:00:00.000Z' })])
keySets.impossibleRetiredAt = set([entry('profile', { status: 'retired', retiredAt: '2026-02-29T00:00:00.000Z' })])
keySets.impossibleRevokedAt = set([entry('profile', { status: 'revoked', revokedAt: '2026-01-15T24:00:00.000Z' })])
keySets.retiredAtWithActive = set([entry('profile', { retiredAt: '2026-02-01T00:00:00.000Z' })])
invalidSet('keys-not-an-array.object', 'keys is an object, not an array.', 'keysNotArrayObject', 'keySet.keys')
invalidSet('keys-not-an-array.null', 'keys is null.', 'keysNull', 'keySet.keys')
invalidSet('keys-not-an-array.string', 'keys is a string.', 'keysString', 'keySet.keys')
invalidSet('issuer-empty', 'An empty issuer string is invalid (it would match nothing, and a verifier must not treat it as a wildcard).', 'issuerEmpty', 'keySet.issuer')
invalidSet('issuer-not-a-string', 'A numeric issuer.', 'issuerNumber', 'keySet.issuer')
invalidSet('impossible-generatedAt', 'generatedAt February 30: informational, but its FORM is strict.', 'impossibleGeneratedAt', 'keySet.generatedAt')
invalidSet('impossible-notBefore', 'notBefore April 31.', 'impossibleNotBefore', 'keySet.entry.notBefore')
invalidSet('impossible-retiredAt', 'retiredAt February 29 of a non-leap year.', 'impossibleRetiredAt', 'keySet.entry.dates')
invalidSet('impossible-revokedAt', 'revokedAt 24:00.', 'impossibleRevokedAt', 'keySet.entry.dates')
invalidSet('retiredAt-on-an-active-key', 'retiredAt present on a key whose status is active.', 'retiredAtWithActive', 'keySet.entry.dates')
state('empty-key-list', 'A valid key set that lists no keys: every key is unknown.', { signed: 'B1' }, 'emptyKeyList', { integrity: 'VALID', keyState: 'KEY_UNKNOWN' })

// ── v3-7: EC coordinates must be field elements (x, y < p) ─────────────────────────────────────

{
  const FP = ref.P256_FIELD_PRIME
  const coord = n => be32(n).toString('base64url')
  const pk = K.profile.publicJwk
  const badPoints = [
    ['x-equals-p', { x: coord(FP) }], ['x-equals-p-plus-1', { x: coord(FP + 1n) }], ['x-all-ones', { x: coord((1n << 256n) - 1n) }],
    ['y-equals-p', { y: coord(FP) }], ['y-all-ones', { y: coord((1n << 256n) - 1n) }],
  ]
  for (const [name, change] of badPoints) {
    assert.ok(ref.isCanonicalCoordinate(Object.values(change)[0]), 'a 32-byte value is a canonical spelling, so only the RANGE rule can refuse it')
    addCase(`malformed.publicKey-${name}`, `An embedded key coordinate that is a canonical 32-byte spelling but is not below the field prime p (${name}). Refused for range, before keyId or curve checks.`, { signed: 'B1', patch: Object.entries(change).map(([k, v]) => rep(`/attestation/publicKey/${k}`, v)) }, MAL('jwk.coordinate-range'))
    keySets[`coordinate_${name}`] = set([entry('profile', { jwk: { ...pk, ...change } })])
    invalidSet(`coordinate-${name}`, `A key-set entry whose key has a coordinate not below p (${name}).`, `coordinate_${name}`, 'keySet.entry.jwk')
  }
  addCase('malformed.publicKey-x-p-minus-1-not-on-curve', 'x = p - 1 IS below p (in range) but is not the x of a point on the curve: reaches the curve check (payload keyId set to its thumbprint so that check is reached).', { signed: 'B1', patch: [rep('/attestation/publicKey/x', coord(FP - 1n)), rep(`${P}/keyId`, await ref.keyIdOf({ ...pk, x: coord(FP - 1n) }))] }, MAL('jwk.not-on-curve'))
}

// ── v3-8: depth (one shared absolute-depth model) ─────────────────────────────────────────────
//
// The bundle root is depth 1, so the assessment root is depth 2. A nested array under an assessment field of k levels reaches
// absolute depth 2 + k. Parser, canonicalizer and digest agree on the limit (64): depth 64 parses AND digests; depth 65 does neither.

{
  const deep = k => { const a = baseAssessment(); a.deep = nest(k); return a }
  await addSigned('D_depth-64', 'A signed bundle whose assessment nests to EXACTLY absolute depth 64 (62 nested arrays under an unknown top-level field). Digestible, signable, and parseable inside its bundle.', deep(62))
  addCase('depth.at-the-limit-parses-digests-and-verifies', 'Absolute depth 64 in the assessment: parsed, digested and signature-verified. Integrity is VALID; the interpretation is INVALID_ASSESSMENT only because of the unknown field `deep`.', { signed: 'D_depth-64' }, { integrity: 'VALID', interpretation: 'INVALID_ASSESSMENT', interpretationReason: 'assessment.schema.top-level' })
  addCase('depth.one-over-fails-to-parse', 'The same text with ONE more level (absolute depth 65). Refused at parse time.', { text: insertAtBundleAssessment(`"deep":${'['.repeat(63)}"x"${']'.repeat(63)},`) }, MAL('JSON_TOO_DEEP'))
  addCase('depth.at-the-limit-text-parses', 'Depth 64 by text (unsigned addition): it PARSES (so the failure is the digest, not depth).', { text: insertAtBundleAssessment(`"deep":${'['.repeat(62)}"x"${']'.repeat(62)},`) }, { integrity: 'BINDING_MISMATCH', binding: 'assessment.digest' })
  addCase('depth.bundle-root-counts', 'Depth is measured from the bundle root, not from the assessment: an object nested 63 levels under the bundle ROOT itself is depth 64 and parses (unknown top-level field => MALFORMED bundle.shape); 64 levels is depth 65 and does not parse.', { text: `{"x":${'['.repeat(63)}${']'.repeat(63)}}` }, MAL('bundle.bundleVersion'))
  addCase('depth.bundle-root-over', 'One level deeper than the previous vector.', { text: `{"x":${'['.repeat(64)}${']'.repeat(64)}}` }, MAL('JSON_TOO_DEEP'))
}

// ── v3-9: bytes are the verifier input (strict UTF-8, no BOM) ──────────────────────────────────

{
  const hexOf = buf => Buffer.from(buf).toString('hex')
  const BY = (name, description, buf, expected) => addCase(`bytes.${name}`, description, { bytesHex: hexOf(buf) }, expected)
  BY('valid-multibyte-equals-text', 'The base bundle as raw UTF-8 bytes (it contains 2-byte, 3-byte and 4-byte sequences: é, ～ and 🙂). Same result as the text and object forms.', b1Bytes, VALID)
  BY('invalid-utf8.stray-continuation', 'A lone continuation byte (0x80) inside a string. A lenient decoder substitutes U+FFFD and continues; the verifier refuses the bytes.', bytesWith('Synthetic context item.', Buffer.from([0x53, 0x80, 0x79])), MAL('bundle.invalid-utf8'))
  BY('invalid-utf8.invalid-second-byte', '0xC3 followed by an ASCII byte (a truncated 2-byte sequence).', bytesWith('Synthetic context item.', Buffer.from([0x53, 0xc3, 0x28])), MAL('bundle.invalid-utf8'))
  BY('invalid-utf8.overlong', 'The overlong encoding C0 AF of "/".', bytesWith('Synthetic context item.', Buffer.from([0x53, 0xc0, 0xaf])), MAL('bundle.invalid-utf8'))
  BY('invalid-utf8.encoded-surrogate', 'ED A0 80: a UTF-8 encoding of the lone surrogate U+D800 (WTF-8 / CESU-style). Not well-formed UTF-8.', bytesWith('Synthetic context item.', Buffer.from([0x53, 0xed, 0xa0, 0x80])), MAL('bundle.invalid-utf8'))
  BY('invalid-utf8.truncated-four-byte', 'F0 9F 98 followed by the closing quote: a 4-byte sequence cut short.', bytesWith('Synthetic context item.', Buffer.from([0x53, 0xf0, 0x9f, 0x98])), MAL('bundle.invalid-utf8'))
  BY('invalid-utf8.above-max-code-point', 'F4 90 80 80 is U+110000, above the Unicode maximum.', bytesWith('Synthetic context item.', Buffer.from([0x53, 0xf4, 0x90, 0x80, 0x80])), MAL('bundle.invalid-utf8'))
  BY('invalid-utf8.byte-ff', 'The byte 0xFF, which never occurs in UTF-8.', bytesWith('Synthetic context item.', Buffer.from([0x53, 0xff])), MAL('bundle.invalid-utf8'))
  BY('invalid-utf8.in-a-key', 'Invalid UTF-8 inside an object key rather than a value.', bytesWith('"notes":', Buffer.from([0x22, 0xc3, 0x28, 0x22, 0x3a])), MAL('bundle.invalid-utf8'))
  BY('bom', 'A UTF-8 byte order mark (EF BB BF) before the JSON. One accepted transport encoding: no BOM.', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), b1Bytes]), MAL('JSON_BOM'))
  BY('bom-only', 'A byte order mark and nothing else.', Buffer.from([0xef, 0xbb, 0xbf]), MAL('JSON_BOM'))
  BY('feff-inside-a-string-is-a-character', 'U+FEFF INSIDE a string is an ordinary character and is not stripped: the assessment text changed, so the digest no longer matches. (A decoder that stripped every U+FEFF would report VALID.)', bytesWith('Synthetic context item.', Buffer.from('Synthetic\ufeffcontext item.', 'utf8')), { integrity: 'BINDING_MISMATCH', binding: 'assessment.digest' })
  BY('utf16-le-ascii-is-not-json', 'ASCII JSON encoded as UTF-16LE (no BOM): the interleaved NUL bytes are valid UTF-8 but are not JSON.', Buffer.from('{"bundleVersion":"1.0.0"}', 'utf16le'), MAL('JSON_SYNTAX'))
  BY('utf16-le-with-bom', 'UTF-16LE with its byte order mark FF FE: 0xFF never occurs in UTF-8.', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{}', 'utf16le')]), MAL('bundle.invalid-utf8'))
  BY('empty', 'Zero bytes.', Buffer.alloc(0), MAL('JSON_SYNTAX'))
  BY('nul-byte-in-string', 'A raw NUL byte inside a string is an unescaped control character.', bytesWith('Synthetic context item.', Buffer.from([0x53, 0x00, 0x79])), MAL('JSON_SYNTAX'))
  BY('valid-utf8-lone-surrogate-escape', 'Well-formed UTF-8 bytes containing the ESCAPE \\ud800: the bytes are valid, the JSON string is ill-formed.', bytesWith('Synthetic context item.', Buffer.from('S\\ud800y')), MAL('JSON_ILL_FORMED_STRING'))
}

// ── v3-10: SUPPORTED is strong: INVALID_ASSESSMENT, the pinned profile definition, and their effect on policy ──

// The assessment-schema mutation table. It is used twice: here (a sample, signed, end to end) and in assessment-schema.v4.json (every case, direct).
const HEX = { half: '3fe0000000000000', negZero: '8000000000000000', two53: '4340000000000000', nan: '7ff8000000000000', inf: '7ff0000000000000', e21: '444b1ae4d6e2ef50' }
const num = h => ({ $ieeeHex: h })
const rmv = p => ({ op: 'remove', path: p })
const add = (p, value) => ({ op: 'add', path: p, value })
const swp = (p, i, j) => ({ op: 'swap', path: p, i, j })
const A0 = '/controls/0', C00 = '/controls/0/checks/0', E0 = '/evidence/0'
// Control 0 has one observed check. These add a NOT_ASSESSED check, and a GAP check, and keep coverage and status consistent.
const mkCheck = (id, status, evidence) => ({ checkId: id, title: `Synthetic check ${id}`, status, confidence: 'medium', explanation: 'Synthetic.', provenance: status === 'NOT_ASSESSED' ? [] : ['STATICALLY_OBSERVED'], supportingEvidenceIds: evidence })
const MIXED_NA = [add(`${A0}/checks/-`, mkCheck('2.2', 'NOT_ASSESSED', [])), rep(`${A0}/coverage`, { total: 2, evidenceObserved: 1, gapIdentified: 0, notAssessed: 1 }), rep(`${A0}/status`, 'NOT_ASSESSED')]
const MIXED_GAP = [add(`${A0}/checks/-`, mkCheck('2.2', 'NOT_ASSESSED', [])), add(`${A0}/checks/-`, mkCheck('2.3', 'GAP_IDENTIFIED', ['ev-0002'])), rep(`${A0}/coverage`, { total: 3, evidenceObserved: 1, gapIdentified: 1, notAssessed: 1 }), rep(`${A0}/status`, 'GAP_IDENTIFIED')]
const SCHEMA_CASES = [
  // [name, patch, expected code]
  ['valid.base', [], null],
  ['top.unknown-field', [add('/extra', 'x')], 'assessment.schema.top-level'],
  ['top.missing-notes', [rmv('/notes')], 'assessment.schema.top-level'],
  ['top.missing-package', [rmv('/package')], 'assessment.schema.top-level'],
  ['schema-version.unsupported', [rep('/schemaVersion', '1.2.0')], 'assessment.schema.schema-version'],
  ['profile.unknown-field', [add('/profile/extra', 'x')], 'assessment.schema.profile'],
  ['profile.missing-field', [rmv('/profile/scannerVersion')], 'assessment.schema.profile'],
  ['profile.id-uppercase', [rep('/profile/profileId', 'OWASP')], 'assessment.schema.profile'],
  ['profile.commit-short', [rep('/profile/upstreamCommit', 'd6f7d7d')], 'assessment.schema.profile'],
  ['profile.commit-uppercase', [rep('/profile/upstreamCommit', 'D6F7D7D0DE314F52A83A85D1828E06AB096E595C')], 'assessment.schema.profile'],
  ['profile.version-not-semver', [rep('/profile/agentverifyProfileVersion', 'latest')], 'assessment.schema.profile'],
  ['profile.interpretation-version-not-semver', [rep('/profile/riskRubricVersion', 'v1')], 'assessment.schema.profile'],
  ['profile.status-empty', [rep('/profile/upstreamStatus', '')], 'assessment.schema.profile'],
  ['profile.implemented-empty', [rep('/profile/implementedControls', [])], 'assessment.schema.profile.implemented-controls'],
  ['profile.implemented-duplicate', [rep('/profile/implementedControls', ['AST02', 'AST02', 'AST04'])], 'assessment.schema.profile.implemented-controls'],
  ['profile.implemented-bad-id', [rep('/profile/implementedControls', ['ast02', 'AST03', 'AST04'])], 'assessment.schema.profile.implemented-controls'],
  ['profile.implemented-not-array', [rep('/profile/implementedControls', 'AST02')], 'assessment.schema.profile.implemented-controls'],
  ['controls.not-array', [rep('/controls', {})], 'assessment.schema.controls'],
  ['controls.duplicate-control', [rep('/controls/1/controlId', 'AST02')], 'assessment.schema.controls'],
  ['controls.reordered-against-implemented', [swp('/controls', 0, 1)], 'assessment.schema.controls'],
  ['controls.one-missing', [rmv('/controls/2')], 'assessment.schema.controls'],
  ['controls.one-extra', [add('/controls/-', { ...structuredClone(baseAssessment().controls[2]), controlId: 'AST05' })], 'assessment.schema.controls'],
  ['control.unknown-field', [add(`${A0}/extra`, 'x')], 'assessment.schema.control'],
  ['control.severity-case', [rep(`${A0}/upstreamSeverity`, 'high')], 'assessment.schema.control'],
  ['control.framework-differs', [rep(`${A0}/framework`, 'OTHER_FRAMEWORK')], 'assessment.schema.control'],
  ['control.title-empty', [rep(`${A0}/title`, '')], 'assessment.schema.control'],
  ['control.status-not-enum', [rep(`${A0}/status`, 'PASS')], 'assessment.schema.control'],
  ['control.confidence-not-enum', [rep(`${A0}/confidence`, 'certain')], 'assessment.schema.control'],
  ['control.bad-id', [rep(`${A0}/controlId`, 'ast02')], 'assessment.schema.control'],
  ['checks.empty', [rep(`${A0}/checks`, [])], 'assessment.schema.checks'],
  ['checks.not-array', [rep(`${A0}/checks`, {})], 'assessment.schema.checks'],
  ['check.unknown-field', [add(`${C00}/extra`, 'x')], 'assessment.schema.check'],
  ['check.status-not-enum', [rep(`${C00}/status`, 'PASS')], 'assessment.schema.check'],
  ['check.duplicate-id', [add(`${A0}/checks/-`, structuredClone(baseAssessment().controls[0].checks[0]))], 'assessment.schema.check'],
  ['check.provenance-not-enum', [rep(`${C00}/provenance`, ['GUESSED'])], 'assessment.schema.check'],
  ['check.provenance-duplicate', [rep(`${C00}/provenance`, ['DECLARED', 'DECLARED'])], 'assessment.schema.check'],
  ['check.evidence-ids-duplicate', [rep(`${C00}/supportingEvidenceIds`, ['ev-0001', 'ev-0001'])], 'assessment.schema.check'],
  ['check.evidence-id-empty', [rep(`${C00}/supportingEvidenceIds`, [''])], 'assessment.schema.check'],
  ['check.id-empty', [rep(`${C00}/checkId`, '')], 'assessment.schema.check'],
  ['check.title-empty', [rep(`${C00}/title`, '')], 'assessment.schema.check'],
  ['check.explanation-not-string', [rep(`${C00}/explanation`, 7)], 'assessment.schema.check'],
  ['check.confidence-not-enum', [rep(`${C00}/confidence`, 'certain')], 'assessment.schema.check'],
  ['control.explanation-not-string', [rep(`${A0}/explanation`, 7)], 'assessment.schema.control'],
  ['valid.control-with-gap-and-not-assessed-checks', MIXED_GAP, null],
  ['valid.control-with-only-not-assessed-and-observed-checks', MIXED_NA, null],
  ['control-status.gap-present-but-shown-as-not-assessed', [...MIXED_GAP, rep(`${A0}/status`, 'NOT_ASSESSED')], 'assessment.schema.control-status'],
  ['control-status.gap-present-but-shown-as-observed', [...MIXED_GAP, rep(`${A0}/status`, 'EVIDENCE_OBSERVED')], 'assessment.schema.control-status'],
  ['control-status.not-assessed-present-but-shown-as-observed', [...MIXED_NA, rep(`${A0}/status`, 'EVIDENCE_OBSERVED')], 'assessment.schema.control-status'],
  ['control-status.not-assessed-present-but-shown-as-gap', [...MIXED_NA, rep(`${A0}/status`, 'GAP_IDENTIFIED')], 'assessment.schema.control-status'],
  ['evidence-reference.unresolved', [rep(`${C00}/supportingEvidenceIds`, ['ev-9999'])], 'assessment.schema.evidence-reference'],
  ['coverage.total-wrong', [rep(`${A0}/coverage/total`, 2)], 'assessment.schema.coverage'],
  ['coverage.observed-wrong', [rep(`${A0}/coverage/evidenceObserved`, 0), rep(`${A0}/coverage/notAssessed`, 1)], 'assessment.schema.coverage'],
  ['coverage.unknown-field', [add(`${A0}/coverage/extra`, 1)], 'assessment.schema.coverage'],
  ['coverage.negative', [rep(`${A0}/coverage/gapIdentified`, -1)], 'assessment.schema.coverage'],
  ['coverage.string-count', [rep(`${A0}/coverage/total`, '1')], 'assessment.schema.coverage'],
  ['coverage.fractional-count', [rep(`${A0}/coverage/total`, num(HEX.half))], 'assessment.schema.coverage'],
  ['control-status.gap-shown-as-observed', [rep('/controls/1/status', 'EVIDENCE_OBSERVED')], 'assessment.schema.control-status'],
  ['control-status.observed-shown-as-gap', [rep(`${A0}/status`, 'GAP_IDENTIFIED')], 'assessment.schema.control-status'],
  ['control-status.observed-shown-as-not-assessed', [rep(`${A0}/status`, 'NOT_ASSESSED')], 'assessment.schema.control-status'],
  ['evidence.not-array', [rep('/evidence', {})], 'assessment.schema.evidence'],
  ['evidence.unknown-field', [add(`${E0}/extra`, 'x')], 'assessment.schema.evidence'],
  ['evidence.axis-not-enum', [rep(`${E0}/axis`, 'network2')], 'assessment.schema.evidence'],
  ['evidence.polarity-not-enum', [rep(`${E0}/polarity`, 'good')], 'assessment.schema.evidence'],
  ['evidence.severity-not-enum', [rep(`${E0}/severity`, 'critical')], 'assessment.schema.evidence'],
  ['evidence.kind-empty', [rep(`${E0}/kind`, '')], 'assessment.schema.evidence'],
  ['evidence.summary-not-string', [rep(`${E0}/summary`, 7)], 'assessment.schema.evidence'],
  ['evidence.facts-nested-object', [rep(`${E0}/facts`, { a: { b: 1 } })], 'assessment.schema.evidence'],
  ['evidence.facts-null', [rep(`${E0}/facts`, { a: null })], 'assessment.schema.evidence'],
  ['evidence.facts-fraction', [rep(`${E0}/facts`, { a: num(HEX.half) })], 'assessment.schema.evidence'],
  ['evidence.facts-negative-zero', [rep(`${E0}/facts`, { a: num(HEX.negZero) })], 'assessment.schema.evidence'],
  ['evidence.facts-unsafe-integer', [rep(`${E0}/facts`, { a: num(HEX.two53) })], 'assessment.schema.evidence'],
  ['evidence.facts-mixed-array', [rep(`${E0}/facts`, { a: ['x', 1] })], 'assessment.schema.evidence'],
  ['evidence.location-line-zero', [rep(`${E0}/locations/0/line`, 0)], 'assessment.schema.evidence'],
  ['evidence.location-line-string', [rep(`${E0}/locations/0/line`, '2')], 'assessment.schema.evidence'],
  ['evidence.location-unknown-field', [add(`${E0}/locations/0/extra`, 'x')], 'assessment.schema.evidence'],
  ['evidence.location-file-empty', [rep(`${E0}/locations/0/file`, '')], 'assessment.schema.evidence'],
  ['evidence.provenance-not-enum', [rep(`${E0}/provenance`, ['GUESSED'])], 'assessment.schema.evidence'],
  ['evidence.duplicate-id', [rep('/evidence/1/id', 'ev-0001')], 'assessment.schema.evidence.duplicate-id'],
  ['unmapped.unresolved', [rep('/unmappedEvidenceIds', ['ev-9999'])], 'assessment.schema.unmapped-evidence'],
  ['unmapped.duplicate', [rep('/unmappedEvidenceIds', ['ev-0001', 'ev-0001'])], 'assessment.schema.unmapped-evidence'],
  ['unmapped.not-array', [rep('/unmappedEvidenceIds', 'ev-0001')], 'assessment.schema.unmapped-evidence'],
  // ── v4-1: EVIDENCE-ACCOUNTING COMPLETENESS (the third review's blocker #1) ──────────────────
  // allEvidenceIds === referencedEvidenceIds UNION unmappedEvidenceIds, and the two sides are disjoint.
  ['evidence.orphaned-omitted-from-unmapped', [rep('/controls/2/checks/0/supportingEvidenceIds', [])], 'assessment.schema.evidence-unaccounted'],
  ['evidence.referenced-and-also-marked-unmapped', [rep('/unmappedEvidenceIds', ['ev-0003'])], 'assessment.schema.evidence-mapping-conflict'],
  ['valid.evidence-referenced-by-multiple-checks', [
    add(`${A0}/checks/-`, { checkId: '2.2', title: 'Synthetic check 2.2 (shares evidence with 2.1)', status: 'EVIDENCE_OBSERVED', confidence: 'medium', explanation: 'Synthetic; many-to-many is valid.', provenance: ['STATICALLY_OBSERVED'], supportingEvidenceIds: ['ev-0001'] }),
    rep(`${A0}/coverage`, { total: 2, evidenceObserved: 2, gapIdentified: 0, notAssessed: 0 }),
  ], null],
  ['valid.evidence-truly-unmapped', [
    add('/evidence/-', { id: 'ev-0004', kind: 'conformance.example-unmapped', axis: 'metadata', polarity: 'context', severity: 'low', confidence: 'low', provenance: ['DECLARED'], summary: 'Synthetic evidence no check cites.', expected: 'n/a', remediation: 'n/a', facts: {}, locations: [] }),
    rep('/unmappedEvidenceIds', ['ev-0004']),
  ], null],
  // Unresolved ids are caught by the EARLIER resolve checks, never by the new completeness codes (order matters: a
  // reference that does not even name a real evidence item is malformed before "is it accounted for" can be asked).
  ['evidence.check-references-unresolved-id-not-completeness', [rep(`${C00}/supportingEvidenceIds`, ['ev-9999'])], 'assessment.schema.evidence-reference'],
  ['evidence.unmapped-references-unresolved-id-not-completeness', [rep('/unmappedEvidenceIds', ['ev-9999'])], 'assessment.schema.unmapped-evidence'],
  ['not-implemented.overlaps-implemented', [rep('/notImplementedControls', ['AST01', 'AST02', 'AST05', 'AST06', 'AST07', 'AST08', 'AST09', 'AST10'])], 'assessment.schema.not-implemented'],
  ['not-implemented.duplicate', [rep('/notImplementedControls', ['AST01', 'AST01'])], 'assessment.schema.not-implemented'],
  ['not-implemented.bad-id', [rep('/notImplementedControls', ['ast01'])], 'assessment.schema.not-implemented'],
  ['not-implemented.not-array', [rep('/notImplementedControls', 'AST01')], 'assessment.schema.not-implemented'],
  ['package.digest-prefix', [rep('/package/digest', `sha256:${zeros(64)}`)], 'assessment.schema.package'],
  ['package.file-count-negative', [rep('/package/fileCount', -1)], 'assessment.schema.package'],
  ['package.file-count-string', [rep('/package/fileCount', '3')], 'assessment.schema.package'],
  ['package.manifest-not-array', [rep('/package/manifestFiles', 'SKILL.md')], 'assessment.schema.package'],
  ['package.unknown-field', [add('/package/extra', 1)], 'assessment.schema.package'],
  ['notes.not-array', [rep('/notes', 'x')], 'assessment.schema.notes'],
  ['notes.item-not-string', [rep('/notes', [7])], 'assessment.schema.notes'],
]
const buildSchemaCase = patch => reviveNumbers(applyPatch(baseAssessment(), patch))
for (const [name, patch, code] of SCHEMA_CASES) assert.equal(assessmentSchemaProblem(buildSchemaCase(patch)), code, `schema case ${name}`)
const covered = new Set(SCHEMA_CASES.map(c => c[2]).filter(Boolean))
for (const code of ASSESSMENT_SCHEMA_PROBLEM_CODES) assert.ok(covered.has(code), `no schema vector for ${code}`)

// A sample of them, signed and verified end to end: the signature is valid, the assessment is structurally wrong.
for (const name of ['top.unknown-field', 'control.severity-case', 'coverage.total-wrong', 'control-status.gap-shown-as-observed', 'evidence-reference.unresolved', 'evidence.duplicate-id', 'not-implemented.overlaps-implemented', 'controls.one-missing', 'package.manifest-not-array']) {
  const [, patch, code] = SCHEMA_CASES.find(c => c[0] === name)
  const bad = buildSchemaCase(patch)
  // The payload copies of profile fields must still agree with the assessment for the bindings to pass; buildPayload derives them from it.
  await addSigned(`I_${name}`, `A validly signed bundle whose assessment fails the exact schema: ${name}.`, bad)
  addCase(`invalid-assessment.${name}`, `Integrity is VALID (the signature and digest are correct) but the assessment is not structurally valid (${code}): INVALID_ASSESSMENT, never SUPPORTED, and it cannot satisfy a policy.`, { signed: `I_${name}` }, { integrity: 'VALID', interpretation: 'INVALID_ASSESSMENT', interpretationReason: code })
}
addCase('invalid-assessment.cannot-satisfy-policy', 'An INVALID_ASSESSMENT with an active key and an empty (valid) policy: NOT_SATISFIED, INTERPRETATION_UNSUPPORTED.', { signed: 'I_top.unknown-field' }, { integrity: 'VALID', interpretation: 'INVALID_ASSESSMENT', keyState: 'KEY_ACTIVE', policy: NOT('INTERPRETATION_UNSUPPORTED') }, { keySet: 'active', policy: {} })
{
  const both = baseAssessment(); both.profile.profileId = 'some-other-profile'; both.extra = 'x'
  await addSigned('I_unknown-profile-and-bad-structure', 'An unknown profile id AND a structural fault.', both)
  addCase('invalid-assessment.structure-decided-before-profile', 'A structurally invalid assessment for an UNKNOWN profile is INVALID_ASSESSMENT, not UNSUPPORTED_PROFILE: the exact schema is decided first.', { signed: 'I_unknown-profile-and-bad-structure' }, { integrity: 'VALID', interpretation: 'INVALID_ASSESSMENT', interpretationReason: 'assessment.schema.top-level' })
}

// Profile-definition pins. Each is a STRUCTURALLY VALID assessment whose pinned value differs, signed consistently.
const DEFINITION_CASES = [
  ['framework', [rep('/profile/framework', 'OTHER_FRAMEWORK'), rep('/controls/0/framework', 'OTHER_FRAMEWORK'), rep('/controls/1/framework', 'OTHER_FRAMEWORK'), rep('/controls/2/framework', 'OTHER_FRAMEWORK')], 'profile.framework'],
  ['upstream-repo', [rep('/profile/upstreamRepo', 'example/other-repo')], 'profile.upstream.repo'],
  ['upstream-commit', [rep('/profile/upstreamCommit', 'f'.repeat(40))], 'profile.upstream.commit'],
  ['upstream-license', [rep('/profile/upstreamLicense', 'MIT')], 'profile.upstream.license'],
  ['upstream-status', [rep('/profile/upstreamStatus', 'final')], 'profile.upstream.status'],
  // Removing control AST04 also removes its check's only reference to ev-0003; the patch must mark ev-0003 unmapped in the
  // same step, or the assessment would fail the v4 evidence-accounting rule and never reach the registry-level check being tested.
  ['implemented-controls-subset', [rep('/profile/implementedControls', ['AST02', 'AST03']), rmv('/controls/2'), rep('/unmappedEvidenceIds', ['ev-0003'])], 'profile.implemented-controls'],
  ['implemented-controls-reordered', [rep('/profile/implementedControls', ['AST03', 'AST02', 'AST04']), swp('/controls', 0, 1)], 'profile.implemented-controls'],
  ['not-implemented-controls-missing-one', [rmv('/notImplementedControls/6')], 'profile.not-implemented-controls'],
  ['not-implemented-controls-reordered', [swp('/notImplementedControls', 0, 1)], 'profile.not-implemented-controls'],
]
for (const [name, patch, code] of DEFINITION_CASES) {
  const a = buildSchemaCase(patch)
  assert.equal(assessmentSchemaProblem(a), null, `definition case ${name} must be structurally valid`)
  await addSigned(`PD_${name}`, `A validly signed, structurally valid assessment for the KNOWN profile id and version whose pinned value differs: ${name}.`, a)
  addCase(`profile-definition.${name}`, `The registry pins ${name}; a different value is PROFILE_DEFINITION_MISMATCH (reason ${code}): integrity VALID, not SUPPORTED, cannot satisfy a policy.`, { signed: `PD_${name}` }, { integrity: 'VALID', interpretation: 'PROFILE_DEFINITION_MISMATCH', interpretationReason: code })
}
addCase('profile-definition.allow-listing-a-wrong-commit-does-not-help', 'A verifier policy that ALLOWS the wrong upstream commit still cannot satisfy: the profile definition pins the commit, so the interpretation is PROFILE_DEFINITION_MISMATCH.', { signed: 'PD_upstream-commit' }, { integrity: 'VALID', interpretation: 'PROFILE_DEFINITION_MISMATCH', keyState: 'KEY_ACTIVE', policy: NOT('INTERPRETATION_UNSUPPORTED') }, { keySet: 'active', policy: { allowedUpstreamCommits: ['f'.repeat(40)] } })
addCase('profile-definition.interpretation-versions-are-not-pinned', 'The five interpretation versions are NOT pinned by the registry (a new engine or rubric changes the assessment without changing the profile); each is bound independently by the cross-check registry. A different scannerVersion is still SUPPORTED.', { signed: 'D10_scannerVersion' }, VALID)

// ── v3-11: strict, fail-closed policy ─────────────────────────────────────────────────────────

const PK = (name, description, pol, expected, extra = {}) => addCase(`policy.${name}`, description, { signed: 'B1' }, { integrity: 'VALID', ...expected }, { keySet: 'active', policy: pol, ...extra })
const INV = (...codes) => ({ policy: { status: 'INVALID_POLICY', failures: codes } })
const NOW = '2026-01-15T13:00:00.000Z' // issuedAt is 2026-01-15T12:00:00.000Z, so one hour later
PK('age.exact-boundary-satisfies', 'age == maxAgeSeconds satisfies the bound (the boundary is INCLUSIVE): issuedAt 12:00:00.000, now 13:00:00.000, max 3600.', { maxAgeSeconds: 3600, now: NOW }, { policy: SAT })
PK('age.one-millisecond-over-fails', 'age one millisecond over the maximum fails: the comparison is on exact milliseconds.', { maxAgeSeconds: 3600, now: '2026-01-15T13:00:00.001Z' }, { policy: NOT('TOO_OLD') })
PK('age.one-second-over-fails', 'age one SECOND over the maximum fails.', { maxAgeSeconds: 3600, now: '2026-01-15T13:00:01.000Z' }, { policy: NOT('TOO_OLD') })
PK('age.zero-max-age-same-instant', 'maxAgeSeconds 0 with now == issuedAt: age 0 <= 0, satisfied.', { maxAgeSeconds: 0, now: ISSUED_AT }, { policy: SAT })
PK('age.zero-max-age-one-millisecond', 'maxAgeSeconds 0 with now one millisecond after issuedAt: too old.', { maxAgeSeconds: 0, now: '2026-01-15T12:00:00.001Z' }, { policy: NOT('TOO_OLD') })
PK('age.future-issuedAt-fails', 'A future-dated issuedAt (now is one millisecond BEFORE it) fails the max-age policy: ISSUED_AT_IN_FUTURE. issuedAt is the signer\'s claim and a signer must not be able to post-date its way to freshness.', { maxAgeSeconds: 3600, now: '2026-01-15T11:59:59.999Z' }, { policy: NOT('ISSUED_AT_IN_FUTURE') })
PK('age.future-issuedAt-huge-window-still-fails', 'A huge (but valid) maxAgeSeconds does not rescue a future issuedAt.', { maxAgeSeconds: 9007199254740991, now: '2025-01-01T00:00:00.000Z' }, { policy: NOT('ISSUED_AT_IN_FUTURE') })
PK('age.huge-window-old-bundle-satisfied', 'The largest safe integer as the window: any real age satisfies it (and nothing overflows).', { maxAgeSeconds: 9007199254740991, now: '9999-12-31T23:59:59.999Z' }, { policy: SAT })
PK('age.missing-now', 'maxAgeSeconds without now: INVALID_POLICY, never SATISFIED. This reference has no clock to fall back on, and a missing clock must not mean "no age limit".', { maxAgeSeconds: 7200 }, INV('NOW_REQUIRED'))
for (const [name, now] of [['date-only', '2026-01-15'], ['words', 'yesterday'], ['empty', ''], ['no-milliseconds', '2026-01-15T13:00:00Z'], ['offset', '2026-01-15T13:00:00.000+00:00'], ['impossible-date', '2026-02-30T13:00:00.000Z'], ['hour-24', '2026-01-15T24:00:00.000Z'], ['number', 1768482000000], ['null', null], ['boolean', true], ['object', {}], ['lowercase', '2026-01-15t13:00:00.000z']]) {
  PK(`age.malformed-now.${name}`, `A garbage clock (${name}) is INVALID_POLICY, not "age unknown, so satisfied".`, { maxAgeSeconds: 3600, now }, INV('NOW_INVALID'))
}
PK('age.now-without-max-age-is-validated', 'A `now` with no maxAgeSeconds is unused but still must be a canonical timestamp.', { now: 'yesterday' }, INV('NOW_INVALID'))
PK('age.now-without-max-age-valid', 'A valid `now` with no maxAgeSeconds is harmless.', { now: NOW }, { policy: SAT })
for (const [name, value] of [['string', '3600'], ['negative', -1], ['fraction', 1.5], ['null', null], ['nan', num(HEX.nan)], ['infinity', num(HEX.inf)], ['unsafe-2-53', num(HEX.two53)], ['1e21', num(HEX.e21)], ['negative-zero', num(HEX.negZero)], ['array', [3600]], ['boolean', true]]) {
  PK(`max-age.invalid.${name}`, `maxAgeSeconds must be a nonnegative safe integer; ${name} is INVALID_POLICY.`, { maxAgeSeconds: value, now: NOW }, INV('MAX_AGE_SECONDS_INVALID'))
}
PK('unknown-key.misspelled', 'A misspelled key (requiredProfil) is INVALID_POLICY: the caller believes a constraint is active that is not.', { requiredProfil: 'owasp-agentic-skills-2026' }, INV('POLICY_UNKNOWN_KEY'))
PK('unknown-key.plausible', 'A plausible but unknown key (maxAge).', { maxAge: 3600 }, INV('POLICY_UNKNOWN_KEY'))
PK('unknown-key.alongside-valid-key', 'An unknown key next to a valid one: still INVALID_POLICY.', { requiredProfile: PROFILE_ID, minScore: 90 }, INV('POLICY_UNKNOWN_KEY'))
PK('unknown-key.__proto__-own-property', 'An OWN property named __proto__ (from JSON) is an unknown key.', JSON.parse('{"__proto__":{"requiredProfile":"x"}}'), INV('POLICY_UNKNOWN_KEY'))
for (const [name, value] of [['string', 'KEY_ACTIVE'], ['null', null], ['object', {}], ['empty', []], ['duplicate', ['KEY_ACTIVE', 'KEY_ACTIVE']], ['unknown-state', ['TRUSTED']], ['revoked', ['KEY_ACTIVE', 'KEY_REVOKED']], ['unknown-key-state', ['KEY_UNKNOWN']], ['nested', [['KEY_ACTIVE']]], ['number', [1]]]) {
  PK(`accepted-key-states.invalid.${name}`, `acceptedKeyStates ${name}: INVALID_POLICY.`, { acceptedKeyStates: value }, INV('ACCEPTED_KEY_STATES_INVALID'))
}
for (const [name, value] of [['number', 5], ['null', null], ['array', ['owasp-agentic-skills-2026']], ['format', 'Not A Profile'], ['empty', ''], ['object', {}]]) {
  PK(`required-profile.invalid.${name}`, `requiredProfile ${name}: INVALID_POLICY.`, { requiredProfile: value }, INV('REQUIRED_PROFILE_INVALID'))
}
const COMMIT_OK = 'd6f7d7d0de314f52a83a85d1828e06ab096e595c'
for (const [name, value] of [['string-instead-of-array', COMMIT_OK], ['empty-array', []], ['short', ['d6f7d7d']], ['uppercase', [COMMIT_OK.toUpperCase()]], ['number', [123]], ['duplicate', [COMMIT_OK, COMMIT_OK]], ['null', null], ['nested', [[COMMIT_OK]]], ['object', { 0: COMMIT_OK }], ['too-long', [`${COMMIT_OK}0`]], ['one-valid-one-bad', [COMMIT_OK, 'abc']]]) {
  PK(`allowed-upstream-commits.invalid.${name}`, `allowedUpstreamCommits ${name}: INVALID_POLICY. A bare string is not accepted even when it CONTAINS the commit (no substring matching, ever).`, { allowedUpstreamCommits: value }, INV('ALLOWED_UPSTREAM_COMMITS_INVALID'))
}
PK('allowed-upstream-commits.exact-equality-match', 'An exact 40-hex match is allowed.', { allowedUpstreamCommits: ['f'.repeat(40), COMMIT_OK] }, { policy: SAT })
PK('allowed-upstream-commits.one-character-off', 'One character different is NOT allowed: exact equality, no prefix or substring semantics.', { allowedUpstreamCommits: [`${COMMIT_OK.slice(0, 39)}d`] }, { policy: NOT('UPSTREAM_COMMIT_NOT_ALLOWED') })
for (const [name, value] of [['string', 'AST02'], ['null', null], ['lowercase', ['ast02']], ['number', [2]], ['duplicate', ['AST02', 'AST02']], ['object', {}], ['bad-format', ['AST2']]]) {
  PK(`required-controls.invalid.${name}`, `requiredControls ${name}: INVALID_POLICY.`, { requiredControls: value }, INV('REQUIRED_CONTROLS_INVALID'))
}
PK('required-controls.empty-list-is-vacuously-satisfied', 'An empty requiredControls list requires nothing (valid, and satisfied).', { requiredControls: [] }, { policy: SAT })
PK('required-controls.not-covered', 'A required control the attestation does not list.', { requiredControls: ['AST01'] }, { policy: NOT('CONTROLS_NOT_COVERED') })
for (const [name, value] of [['number', 5], ['null', null], ['sha256-prefix', `sha256:${zeros(64)}`], ['uppercase', `avpkg-sha256:${'A'.repeat(64)}`], ['short', 'avpkg-sha256:abc'], ['array', [PACKAGE_DIGEST]]]) {
  PK(`required-package-digest.invalid.${name}`, `requiredPackageDigest ${name}: INVALID_POLICY.`, { requiredPackageDigest: value }, INV('REQUIRED_PACKAGE_DIGEST_INVALID'))
}
PK('several-problems-are-all-reported', 'Several invalid constraints are all reported, in a fixed order.', { acceptedKeyStates: [], requiredProfile: 5, maxAgeSeconds: -1, bogus: 1 }, INV('POLICY_UNKNOWN_KEY', 'ACCEPTED_KEY_STATES_INVALID', 'REQUIRED_PROFILE_INVALID', 'MAX_AGE_SECONDS_INVALID', 'NOW_REQUIRED'))
for (const [builder, description, expected] of [
  ['inherited-requiredProfile', 'A policy object whose ONLY constraint is INHERITED from its prototype. Reading it as a constraint would apply a rule nobody wrote on the policy; ignoring it would silently drop a rule the caller thought applied. Either way is wrong, so a policy with a non-default prototype is INVALID.', INV('POLICY_NOT_PLAIN')],
  ['inherited-with-own-valid-key', 'A valid own constraint plus an inherited one: still INVALID (the prototype cannot be trusted to be empty).', INV('POLICY_NOT_PLAIN')],
  ['class-instance', 'A class instance is not a plain object.', INV('POLICY_NOT_PLAIN')],
  ['symbol-key', 'A symbol-keyed property.', INV('POLICY_NOT_PLAIN')],
  ['null', 'A null policy.', INV('POLICY_NOT_PLAIN')],
  ['array', 'An array as the policy.', INV('POLICY_NOT_PLAIN')],
  ['string', 'A string as the policy.', INV('POLICY_NOT_PLAIN')],
  ['undefined-value', 'An own key whose value is undefined is a wrong-typed constraint (not "absent").', INV('REQUIRED_PROFILE_INVALID')],
  ['sparse-array', 'A sparse array as acceptedKeyStates.', INV('ACCEPTED_KEY_STATES_INVALID')],
  ['null-prototype-valid', 'A null-prototype object with one valid own constraint IS a plain object and is evaluated normally.', { policy: SAT }],
]) addCase(`policy.non-plain.${builder}`, description, { signed: 'B1' }, { integrity: 'VALID', ...expected }, { keySet: 'active', policyBuilder: builder })
PK('invalid-policy-is-never-satisfied-even-with-everything-else-perfect', 'An active key, SUPPORTED interpretation, valid integrity and an invalid policy: INVALID_POLICY. There is no path from an invalid policy to SATISFIED.', { requiredProfile: PROFILE_ID, allowedUpstreamCommits: COMMIT_OK }, INV('ALLOWED_UPSTREAM_COMMITS_INVALID'))

// ── Check every prediction against the reference before anything is written ──────────────────

const vectorForCheck = { signed }
const optsFor = c => caseOptions({ keySets }, c)
for (const c of cases) {
  const actual = await ref.verifyProfileBundleBytes(toInputBytes(resolveSource(vectorForCheck, c.source)), optsFor(c))
  try { assertSubset(assert, actual, c.expected, c.name) } catch (e) { console.error(`PREDICTION MISMATCH in ${c.name}\n  expected ${JSON.stringify(c.expected)}\n  actual   ${JSON.stringify(actual)}`); throw e }
}
const names = cases.map(c => c.name)
assert.equal(new Set(names).size, names.length, 'case names must be unique')

write('bundles.v4.json', head({
  constants: { issuer: ISSUER, profileId: PROFILE_ID, keyPurpose: ref.PROFILE_KEY_PURPOSE, issuedAt: ISSUED_AT, bundleVersion: ref.BUNDLE_VERSION, keySetVersion: ref.KEY_SET_VERSION, maxBundleBytes: ref.MAX_BUNDLE_TEXT_BYTES },
  publicKeys: { profile: { keyId: keyIds.profile, jwk: K.profile.publicJwk }, rotated: { keyId: keyIds.rotated, jwk: K.rotated.publicJwk }, attacker: { keyId: keyIds.attacker, jwk: K.attacker.publicJwk } },
  packages: { synthetic: { files: PACKAGE_FILES, digest: PACKAGE_DIGEST } },
  crossChecks: ref.CROSS_CHECKS.map(({ binding, payloadField, assessmentPath, runsWhen }) => ({ binding, payloadField, assessmentPath, runsWhen })),
  payloadFields: ref.PAYLOAD_FIELDS.map(({ path, code, required, kind, binding, reason }) => ({ path, code, required, kind, ...(binding ? { binding } : {}), ...(reason ? { reason } : {}) })),
  limits: { maxJsonDepth: MAX_JSON_DEPTH, bundleRootDepth: 1, assessmentBaseDepth: ASSESSMENT_BASE_DEPTH, payloadBaseDepth: 2, maxBundleBytes: ref.MAX_BUNDLE_TEXT_BYTES },
  policyCodes: { invalid: [...INVALID_POLICY_CODES], notSatisfied: [...POLICY_FAILURE_CODES] },
  keySets, d10, signed, cases,
}))

// ── signing.v4.json ──────────────────────────────────────────────────────────────────────────

const signingEntries = []
for (const name of ['B1', 'B2', 'B_other', 'B_rotated', ...Object.keys(bumps).map(f => `D10_${f}`)]) {
  const b = signed[name].bundle
  const input = ref.signingInput(b.attestation.payload)
  const { r, s } = partsOf(b.attestation.signature)
  signingEntries.push({
    name,
    payload: b.attestation.payload,
    payloadJcs: canonicalizeSigned(b.attestation.payload),
    signingInputHex: Buffer.from(input).toString('hex'),
    signingInputSha256: sha256Hex(input),
    assessmentJcsSha256: sha256Hex(canonicalizeSigned(b.assessment)),
    assessmentDigest: b.attestation.payload.assessment.digest,
    signature: b.attestation.signature,
    signatureRHex: r.toString(16).padStart(64, '0'),
    signatureSHex: s.toString(16).padStart(64, '0'),
    lowS: s <= HALF,
    publicKey: b.attestation.publicKey,
    keyId: b.attestation.payload.keyId,
  })
}
write('signing.v4.json', head({
  formulas: {
    signingInput: 'UTF8("agentverify-attestation/profile-assessment/v1\\n") || UTF8(JCS(payload)), JCS under the signed-content numeric profile',
    signature: 'base64( ECDSA-P256-SHA256( privateKey, signingInput ) ), raw r||s (64 bytes), standard base64 with padding, LOW-S (s <= floor(n/2)): an Agent Verify canonical-signature rule, not an RFC 7518 requirement',
    assessmentDigest: '"avassess-sha256:" + hex( SHA-256( UTF8("agentverify-assessment-digest/v1\\n") || UTF8(JCS(assessment)) ) )',
    keyId: 'base64url( SHA-256( JCS({ crv, kty, x, y }) ) )  (RFC 7638); x and y must be canonical unpadded base64url of exactly 32 bytes',
    bundleVersion: 'NOT part of the signing input or any digest: the outer bundle is unsigned framing in v1',
  },
  p256Order: N.toString(16), p256HalfOrder: HALF.toString(16),
  entries: signingEntries,
}))

// ── assessment-digest.v4.json ────────────────────────────────────────────────────────────────

const digestInputs = [
  ['empty-object', {}], ['empty-array', []], ['nested-empty', { a: {}, b: [], c: [[], {}] }],
  ['key-order-independent-a', { b: 1, a: 2 }], ['key-order-independent-b', { a: 2, b: 1 }],
  ['array-order-matters-a', { list: [1, 2, 3] }], ['array-order-matters-b', { list: [3, 2, 1] }],
  ['unicode', { s: 'é🙂\u2028\u007f' }], ['integers', { n1: 0, n2: -1, n3: 9007199254740991, n4: 100, n5: -9007199254740991 }],
  ['nfc-string', { s: 'café' }], ['nfd-string', { s: 'café' }],
  ['synthetic-assessment-base', baseAssessment()], ['synthetic-assessment-other', otherAssessment()],
]
const digestCases = []
for (const [name, value] of digestInputs) {
  const canonical = canonicalizeSigned(value)
  digestCases.push({ name, assessment: value, canonical, canonicalSha256: sha256Hex(canonical), digest: await ref.assessmentDigest(value) })
}
write('assessment-digest.v4.json', head({ formula: 'avassess-sha256: + hex(SHA-256(UTF8("agentverify-assessment-digest/v1\\n") || UTF8(JCS(assessment)))), JCS under the signed-content numeric profile', cases: digestCases }))

// ── keyid.v4.json ────────────────────────────────────────────────────────────────────────────

const RFC7638_RSA = { kty: 'RSA', n: '0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw', e: 'AQAB', alg: 'RS256', kid: '2011-04-29' }
const RFC7515_EC = { kty: 'EC', crv: 'P-256', x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU', y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0' }
const px = K.profile.publicJwk
write('keyid.v4.json', head({
  formula: 'keyId = base64url( SHA-256( JCS of the required members, lexicographic ) ). EC: {crv,kty,x,y}. RSA: {e,kty,n}. Nothing else (no use, kid, purpose, key_ops, ext) ever affects it.',
  thumbprints: [
    { name: 'RFC 7638 section 3.1 example (RSA)', source: 'RFC 7638 3.1', jwk: RFC7638_RSA, thumbprint: 'NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs', independent: 'published in the RFC' },
    { name: 'RFC 7515 appendix A.3 key (EC P-256)', source: 'RFC 7515 A.3 (key only; the thumbprint is computed, not published)', jwk: RFC7515_EC, thumbprint: await ref.keyIdOf(RFC7515_EC), independent: 'recomputed in the test by a second method (manual string, node:crypto)' },
    { name: 'throwaway profile key', jwk: px, thumbprint: keyIds.profile },
    { name: 'throwaway rotated key', jwk: K.rotated.publicJwk, thumbprint: keyIds.rotated },
    { name: 'throwaway attacker key', jwk: K.attacker.publicJwk, thumbprint: keyIds.attacker },
    { name: 'extra members do not change the thumbprint (use, kid, ext, key_ops)', jwk: { ...px, use: 'sig', kid: 'anything', ext: true, key_ops: ['verify'] }, thumbprint: keyIds.profile },
    { name: 'a key-set purpose is not a JWK member and cannot change the thumbprint', jwk: { ...px, purpose: 'agentverify-profile-v1' }, thumbprint: keyIds.profile },
  ],
  jwkChecks: [
    { name: 'exact four members', jwk: px, expected: { ok: true } },
    { name: 'private material', jwk: { ...px, d: 'A'.repeat(43) }, expected: { ok: false, integrity: 'MALFORMED', reasonCode: 'jwk.private-key-material' } },
    { name: 'extra member', jwk: { ...px, ext: true }, expected: { ok: false, integrity: 'MALFORMED', reasonCode: 'jwk.members' } },
    { name: 'purpose member', jwk: { ...px, purpose: 'agentverify-profile-v1' }, expected: { ok: false, integrity: 'MALFORMED', reasonCode: 'jwk.members' } },
    { name: 'missing y', jwk: { kty: 'EC', crv: 'P-256', x: px.x }, expected: { ok: false, integrity: 'MALFORMED', reasonCode: 'jwk.members' } },
    { name: 'P-384', jwk: { ...px, crv: 'P-384' }, expected: { ok: false, integrity: 'UNSUPPORTED_ALGORITHM', reasonCode: 'jwk.not-p256' } },
    { name: 'RSA', jwk: { kty: 'RSA', crv: 'P-256', x: px.x, y: px.y }, expected: { ok: false, integrity: 'UNSUPPORTED_ALGORITHM', reasonCode: 'jwk.not-p256' } },
    { name: 'coordinate with padding', jwk: { ...px, x: `${px.x}=` }, expected: { ok: false, integrity: 'MALFORMED', reasonCode: 'jwk.coordinates' } },
    { name: 'coordinate too short', jwk: { ...px, y: 'AAAA' }, expected: { ok: false, integrity: 'MALFORMED', reasonCode: 'jwk.coordinates' } },
    { name: 'coordinate with a character outside the base64url alphabet', jwk: { ...px, x: `${px.x.slice(0, 42)}+` }, expected: { ok: false, integrity: 'MALFORMED', reasonCode: 'jwk.coordinates' } },
    { name: 'x: non-canonical spelling of the same 32 bytes (trailing bits set)', jwk: { ...px, x: aliasCoordinate(px.x) }, expected: { ok: false, integrity: 'MALFORMED', reasonCode: 'jwk.coordinates' } },
    { name: 'y: non-canonical spelling of the same 32 bytes (trailing bits set)', jwk: { ...px, y: aliasCoordinate(px.y) }, expected: { ok: false, integrity: 'MALFORMED', reasonCode: 'jwk.coordinates' } },
    { name: 'x = p (canonical 32-byte spelling, not below the field prime)', jwk: { ...px, x: be32(ref.P256_FIELD_PRIME).toString('base64url') }, expected: { ok: false, integrity: 'MALFORMED', reasonCode: 'jwk.coordinate-range' } },
    { name: 'x = 2^256 - 1', jwk: { ...px, x: be32((1n << 256n) - 1n).toString('base64url') }, expected: { ok: false, integrity: 'MALFORMED', reasonCode: 'jwk.coordinate-range' } },
    { name: 'y = p', jwk: { ...px, y: be32(ref.P256_FIELD_PRIME).toString('base64url') }, expected: { ok: false, integrity: 'MALFORMED', reasonCode: 'jwk.coordinate-range' } },
    { name: 'x = p - 1 (in range; the curve check, not this one, refuses it later)', jwk: { ...px, x: be32(ref.P256_FIELD_PRIME - 1n).toString('base64url') }, expected: { ok: true } },
    { name: 'not an object', jwk: 'key', expected: { ok: false, integrity: 'MALFORMED', reasonCode: 'jwk.shape' } },
  ],
  aliasing: { description: 'One public key must have ONE accepted keyId. These two JWKs decode to the same point; only the canonical one is accepted, so only its thumbprint can ever be a keyId.', canonical: px, alias: { ...px, x: aliasCoordinate(px.x) }, sameBytes: Buffer.from(px.x, 'base64url').equals(Buffer.from(aliasCoordinate(px.x), 'base64url')), differentThumbprints: (await ref.keyIdOf(px)) !== (await ref.keyIdOf({ ...px, x: aliasCoordinate(px.x) })) },
}))

// ── avpkg.v4.json (package identity) ─────────────────────────────────────────────────────────

const avpkgInputs = [
  ['single-file', [{ path: 'SKILL.md', content: '# hello\n' }], 'One file.'],
  ['two-files-sorted', [{ path: 'a.txt', content: 'A' }, { path: 'b.txt', content: 'B' }], 'Two files; order of submission must not matter.'],
  ['byte-order-not-code-unit-order', [{ path: 'dir/\u{1F600}.md', content: 'emoji' }, { path: 'dir/～.md', content: 'fullwidth tilde' }], 'Paths sort by UTF-8 BYTES. U+FF5E is EF BD 9E and U+1F600 is F0 9F 98 80, so U+FF5E sorts first; by UTF-16 code units the emoji (D83D DE00) would sort first. An implementation that sorts JavaScript strings gets a different digest.'],
  ['multibyte-content-length', [{ path: 'a.txt', content: 'héllo \u{1F642}' }], 'Content length is in BYTES (11), not characters (7).'],
  ['byte-exact-content', [{ path: 'a.txt', content: '\ufeffline1\r\nline2  \r\n\t' }], 'A leading U+FEFF, CRLF and trailing whitespace are hashed exactly as given.'],
  ['empty-content', [{ path: 'empty.txt', content: '' }], 'A zero-length file.'],
  ['length-prefix-single', [{ path: 'a', content: 'x\n1:b\n1:y' }], 'Length prefixes make the encoding unambiguous: this one file...'],
  ['length-prefix-double', [{ path: 'a', content: 'x' }, { path: 'b', content: 'y' }], '...must not collide with these two files.'],
  ['nfc-path', [{ path: 'café.txt', content: 'x' }], 'Precomposed e-acute (NFC).'],
  ['nfd-path', [{ path: 'café.txt', content: 'x' }], 'Decomposed e + combining acute (NFD): a different digest. Identity is over bytes and is never normalized; the ingester (not the digest function) rejects non-NFC paths.'],
  ['no-files', [], 'The digest function over zero files (ingestion policy is separate).'],
]
const avpkgCases = []
for (const [name, files, note] of avpkgInputs) {
  avpkgCases.push({ name, note, files, preimageHex: Buffer.from(ref.packagePreimage(files)).toString('hex'), digest: await ref.packageDigest(files) })
}
write('avpkg.v4.json', head({ formula: '"avpkg-sha256:" + hex(SHA-256(UTF8("agentverify-skill-package-digest/v1\\n") || for each file sorted by UTF-8 path bytes: UTF8(len(path)) ":" path "\\n" UTF8(len(content)) ":" content "\\n"))  (lengths are decimal byte counts)', cases: avpkgCases }))

// ── domains.v4.json: the registry, frozen ─────────────────────────────────────────────────────

{
  const signingDomains = Object.entries(SIGNING_DOMAINS).map(([attestationType, d]) => ({ attestationType, ...d }))
  const digestDomains = Object.entries(DIGEST_DOMAINS).map(([name, d]) => ({ name, ...d }))
  for (const tag of ALL_TAGS) assert.match(tag, TAG_FORM)
  for (const a of ALL_TAGS) for (const b of ALL_TAGS) if (a !== b) assert.ok(!b.startsWith(a), `tag ${JSON.stringify(a)} is a prefix of ${JSON.stringify(b)}`)
  write('domains.v4.json', head({
    rules: [
      'attestation type, signing tag and key purpose are each unique across the registry',
      'every tag has the form agentverify-<scope>/vN followed by a line feed, and no tag is a prefix of another',
      'no tag begins with "{": a legacy scan attestation signs bare JSON, so a tagged input can never equal a legacy input',
      'the verifier chooses the tag from the accepted type; it is never read from the payload',
      'the version inside a tag changes only when the construction of the signing input or digest preimage changes; it is independent of attestationVersion and bundleVersion',
      'a key has one purpose, and the purpose is read from the key set, never from the attestation',
    ],
    signingDomains, digestDomains, legacyScanAttestation: LEGACY_SCAN_ATTESTATION,
    tagsHex: ALL_TAGS.map(t => ({ tag: t, hex: Buffer.from(t, 'utf8').toString('hex') })),
    independentVersions: { attestationVersion: ref.ATTESTATION_VERSION, bundleVersion: ref.BUNDLE_VERSION, keySetVersion: ref.KEY_SET_VERSION, signingTagVersion: 'v1', assessmentDigestTagVersion: 'v1', packageDigestTagVersion: 'v1' },
  }))
}

// ── jcs.v4.json ──────────────────────────────────────────────────────────────────────────────

const RFC_EXAMPLE_INPUT = '{"numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001], "string": "\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"/", "literals": [null, true, false]}'
const RFC_EXAMPLE_CANONICAL = '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}'
const SORT_KEYS = ['€ Euro Sign', '\r Carriage Return', 'דּ Hebrew Letter Dalet With Dagesh', '1 One', '\u{1F600} Emoji: Grinning Face', '\u0080 Control', 'ö Latin Small Letter O With Diaeresis']
const SORT_EXPECTED_ORDER = ['\r Carriage Return', '1 One', '\u0080 Control', 'ö Latin Small Letter O With Diaeresis', '€ Euro Sign', '\u{1F600} Emoji: Grinning Face', 'דּ Hebrew Letter Dalet With Dagesh']
const sortInput = `{${SORT_KEYS.map(k => `${JSON.stringify(k)}:${JSON.stringify(k)}`).join(',')}}`

// GENERIC RFC 8785 serializer cases (full double domain). These test the serializer only; nothing here is admitted into signed content.
const canonicalCases = [
  ['rfc8785-section-3.2.3-example', 'The worked example from RFC 8785 section 3.2.3 (hand-written expected output).', RFC_EXAMPLE_INPUT, RFC_EXAMPLE_CANONICAL],
  ['utf16-key-order', 'RFC 8785 section 3.2.3 key sorting: by UTF-16 code units, so U+1F600 (D83D) sorts BEFORE U+FB33 even though its code point is larger.', sortInput, null],
  ['whitespace-removed', 'Insignificant whitespace is removed.', ' {\n "b" : [ 1 , 2 ] ,\t"a" : { } } ', '{"a":{},"b":[1,2]}'],
  ['empty-containers', 'Empty containers.', '{"a":[],"b":{},"c":[[],{}]}', '{"a":[],"b":{},"c":[[],{}]}'],
  ['negative-zero', 'Generic JCS: -0 serializes as 0. (The signed-content profile REJECTS negative zero.)', '[-0, 0, -0.0]', '[0,0,0]'],
  ['exponent-forms', 'Generic JCS: 1e21 and friends use the ECMAScript form. (Not admitted in signed content.)', '[1e21, 1E+21, 1e-7, 0.000001, 1.2345678901234568e20, 1e0]', '[1e+21,1e+21,1e-7,0.000001,123456789012345680000,1]'],
  ['integers', 'Integers, including the largest safe integer.', '[0, 1, -1, 100, 9007199254740991, -9007199254740991]', '[0,1,-1,100,9007199254740991,-9007199254740991]'],
  ['decimals', 'Generic JCS: shortest round-trip decimals. (Not admitted in signed content.)', '[0.98, 4.50, 0.1, 0.30000000000000004, 1.7976931348623157e308]', '[0.98,4.5,0.1,0.30000000000000004,1.7976931348623157e+308]'],
  ['string-escapes', 'Only the required escapes; control characters as lowercase \\u00xx; DEL, U+2028 and non-ASCII are literal.', '["\\u0000\\u001f\\b\\t\\n\\f\\r\\"\\\\\\/ \\u007f\\u2028\\u00e9\\ud83d\\ude00"]', '["\\u0000\\u001f\\b\\t\\n\\f\\r\\"\\\\/ \u007f\u2028é\u{1F600}"]'],
  ['nested', 'Nested objects sort at every level.', '{"z":{"b":1,"a":{"d":1,"c":2}},"y":[{"b":1,"a":2}]}', '{"y":[{"a":2,"b":1}],"z":{"a":{"c":2,"d":1},"b":1}}'],
  ['literals', 'true, false, null.', '{"t":true,"f":false,"n":null}', '{"f":false,"n":null,"t":true}'],
  ['escaped-key-same-as-literal', 'A key written with an escape is the same key.', '{"\\u0061":1}', '{"a":1}'],
  ['depth-64-accepted', 'Nesting of exactly 64 arrays is accepted.', `${'['.repeat(64)}${']'.repeat(64)}`, `${'['.repeat(64)}${']'.repeat(64)}`],
].map(([name, description, input, expected]) => {
  const canonical = canonicalizeText(input)
  if (expected !== null) assert.equal(canonical, expected, `hand-written expectation for ${name}`)
  return { name, description, mode: 'generic-rfc8785', input, canonical, canonicalSha256: sha256Hex(canonical) }
})
assert.deepEqual(Object.keys(JSON.parse(canonicalCases.find(c => c.name === 'utf16-key-order').canonical)), SORT_EXPECTED_ORDER, 'RFC 8785 key ordering example')

const NUMBERS = [
  ['0000000000000000', '0'], ['8000000000000000', '0'], ['0000000000000001', '5e-324'], ['8000000000000001', '-5e-324'],
  ['7fefffffffffffff', '1.7976931348623157e+308'], ['ffefffffffffffff', '-1.7976931348623157e+308'],
  ['4340000000000000', '9007199254740992'], ['c340000000000000', '-9007199254740992'], ['4430000000000000', '295147905179352830000'],
  ['7fffffffffffffff', null], ['7ff0000000000000', null], ['fff0000000000000', null],
  ['44b52d02c7e14af5', '9.999999999999997e+22'], ['44b52d02c7e14af6', '1e+23'], ['44b52d02c7e14af7', '1.0000000000000001e+23'],
  ['444b1ae4d6e2ef4e', '999999999999999700000'], ['444b1ae4d6e2ef4f', '999999999999999900000'], ['444b1ae4d6e2ef50', '1e+21'],
  ['3eb0c6f7a0b5ed8c', '9.999999999999997e-7'], ['3eb0c6f7a0b5ed8d', '0.000001'],
  ['41b3de4355555553', '333333333.3333332'], ['41b3de4355555554', '333333333.33333325'], ['41b3de4355555555', '333333333.3333333'],
  ['41b3de4355555556', '333333333.3333334'], ['41b3de4355555557', '333333333.33333343'],
  ['becbf647612f3696', '-0.0000033333333333333333'], ['43143ff3c1cb0959', '1424953923781206.2'],
]
for (const [h, expected] of NUMBERS) if (expected !== null) assert.equal(canonicalize(numberFromIeeeHex(h)), expected, `RFC 8785 appendix B ${h}`)

// Structural rejections: identical in EVERY numeric mode.
const parseRejections = [
  ['duplicate-key', '{"a":1,"a":2}', 'JSON_DUPLICATE_KEY'], ['duplicate-key-nested', '{"o":{"a":1,"a":1}}', 'JSON_DUPLICATE_KEY'],
  ['duplicate-key-escape', '{"a":1,"\\u0061":2}', 'JSON_DUPLICATE_KEY'], ['duplicate-key-proto', '{"__proto__":1,"__proto__":2}', 'JSON_DUPLICATE_KEY'],
  ['lone-high-surrogate-escape', '"\\ud800"', 'JSON_ILL_FORMED_STRING'], ['lone-low-surrogate-escape', '"\\udc00"', 'JSON_ILL_FORMED_STRING'],
  ['reversed-surrogate-pair', '"\\udc00\\ud800"', 'JSON_ILL_FORMED_STRING'], ['lone-surrogate-in-key', '{"\\ud800":1}', 'JSON_ILL_FORMED_STRING'],
  ['nan', '[NaN]', 'JSON_SYNTAX'], ['infinity', '[Infinity]', 'JSON_SYNTAX'],
  ['leading-zero', '[01]', 'JSON_SYNTAX'], ['plus-sign', '[+1]', 'JSON_SYNTAX'], ['trailing-dot', '[1.]', 'JSON_SYNTAX'], ['bare-dot', '[.5]', 'JSON_SYNTAX'], ['hex', '[0x10]', 'JSON_SYNTAX'],
  ['trailing-comma-array', '[1,]', 'JSON_SYNTAX'], ['trailing-comma-object', '{"a":1,}', 'JSON_SYNTAX'], ['single-quotes', "{'a':1}", 'JSON_SYNTAX'],
  ['unquoted-key', '{a:1}', 'JSON_SYNTAX'], ['comment', '[1 /* x */]', 'JSON_SYNTAX'], ['raw-control-char', '"a\u0001b"', 'JSON_SYNTAX'], ['raw-newline-in-string', '"a\nb"', 'JSON_SYNTAX'],
  ['bad-escape', '"\\x"', 'JSON_SYNTAX'], ['short-unicode-escape', '"\\u12"', 'JSON_SYNTAX'], ['unterminated-string', '"abc', 'JSON_SYNTAX'],
  ['empty', '', 'JSON_SYNTAX'], ['whitespace-only', '  ', 'JSON_SYNTAX'], ['bom', '\ufeff{}', 'JSON_BOM'], ['trailing-content', '{} x', 'JSON_TRAILING'], ['two-values', '{}{}', 'JSON_TRAILING'],
  ['vertical-tab-whitespace', '[1,\u000b2]', 'JSON_SYNTAX'], ['nbsp-whitespace', '[1,\u00a02]', 'JSON_SYNTAX'],
  ['depth-65', `${'['.repeat(65)}${']'.repeat(65)}`, 'JSON_TOO_DEEP'], ['depth-65-objects', `${'{"a":'.repeat(65)}1${'}'.repeat(65)}`, 'JSON_TOO_DEEP'],
]
for (const [name, text, code] of parseRejections) for (const numbers of ['signed-content', 'ieee']) assert.throws(() => parseStrictJson(text, { numbers }), e => e instanceof StrictJsonError && e.code === code, `parse rejection ${name} (${numbers})`)

// The signed-content numeric profile (Agent Verify, NOT RFC 8785): the EXACT value must be a safe integer, not negative zero.
// Groups of spellings that denote the same exact safe integer, and the canonical text JCS then gives them.
const admittedSpellings = [
  { value: 98, spellings: ['98', '98.0', '98.000', '9.8e1', '9.8E+1', '98e0', '0.98e2', '980e-1', '9800e-2'], canonical: '98' },
  { value: 0, spellings: ['0', '0.0', '0e5', '0.000', '0e0'], canonical: '0' },
  { value: 1, spellings: ['1', '1.0', '1e0', '10e-1', '100e-2', '0.1e1', `0.${'0'.repeat(1000)}1e1001`, `1${'0'.repeat(1010)}e-1010`, `1e${'0'.repeat(34)}`, `1e-${'0'.repeat(34)}`, `1.${'0'.repeat(500)}`], canonical: '1' },
  { value: 100000, spellings: ['100000', '1e5', '1e+5', '1E5', '10e4', '0.1e6', `1e${'0'.repeat(34)}5`, `1e+${'0'.repeat(40)}5`], canonical: '100000' },
  { value: -98, spellings: ['-98', '-98.0', '-9.8e1', '-980e-1'], canonical: '-98' },
  { value: 100, spellings: ['100', '1e2', '1E2', '1.0e2', '10e1', '1000e-1'], canonical: '100' },
  { value: 9007199254740991, spellings: ['9007199254740991', '9007199254740991.0', '9.007199254740991e15', '900719925474099.1e1', '90071992547409910e-1'], canonical: '9007199254740991' },
  { value: -9007199254740991, spellings: ['-9007199254740991', '-9007199254740991.0', '-9.007199254740991e15'], canonical: '-9007199254740991' },
]
const admitted = ['[0,1,-1,98,100,9007199254740991,-9007199254740991]', '{"count":3,"line":12,"printablePercent":98}', '[[],{"a":[7]}]', '[98.0,9.8e1,0.98e2]']
const rejectedTexts = [
  ['decimal', '[0.5]', 'JSON_NUMBER_NOT_INTEGRAL'], ['decimal-98', '[0.98]', 'JSON_NUMBER_NOT_INTEGRAL'], ['negative-decimal', '[-0.5]', 'JSON_NUMBER_NOT_INTEGRAL'],
  ['fraction-by-exponent', '[98e-1]', 'JSON_NUMBER_NOT_INTEGRAL'], ['fraction-half', '[98.5]', 'JSON_NUMBER_NOT_INTEGRAL'], ['fraction-half-exponent', '[9.85e1]', 'JSON_NUMBER_NOT_INTEGRAL'],
  ['over-precise-decimal', '[0.1000000000000000055511151231257827]', 'JSON_NUMBER_NOT_INTEGRAL'], ['double-noise', '[0.30000000000000004]', 'JSON_NUMBER_NOT_INTEGRAL'],
  ['smallest-subnormal', '[5e-324]', 'JSON_NUMBER_NOT_INTEGRAL'], ['tiny-decimal', '[1e-7]', 'JSON_NUMBER_NOT_INTEGRAL'],
  ['fraction-beyond-2-53', '[9007199254740992.5]', 'JSON_NUMBER_NOT_INTEGRAL'],
  ['underflow-to-zero', '[1e-400]', 'JSON_NUMBER_NOT_INTEGRAL'], ['underflow-huge-exponent', '[1e-99999999999]', 'JSON_NUMBER_NOT_INTEGRAL'], ['underflow-long-fraction', `[0.${'0'.repeat(450)}1]`, 'JSON_NUMBER_NOT_INTEGRAL'],
  ['huge-exponent', '[1.5e300]', 'JSON_NUMBER_UNSAFE_INTEGER'], ['1e21', '[1e21]', 'JSON_NUMBER_UNSAFE_INTEGER'], ['1e23', '[1e23]', 'JSON_NUMBER_UNSAFE_INTEGER'], ['overflow', '[1e999]', 'JSON_NUMBER_UNSAFE_INTEGER'], ['overflow-huge-exponent', '[1e99999999999]', 'JSON_NUMBER_UNSAFE_INTEGER'],
  ['unsafe-via-decimal', '[9007199254740993.0]', 'JSON_NUMBER_UNSAFE_INTEGER'], ['unsafe-via-exponent', '[9.007199254740993e15]', 'JSON_NUMBER_UNSAFE_INTEGER'], ['unsafe-2-53-via-decimal', '[9007199254740992.0]', 'JSON_NUMBER_UNSAFE_INTEGER'], ['huge-via-decimal', '[123456789012345678901234567890.0]', 'JSON_NUMBER_UNSAFE_INTEGER'],
  ['negative-zero', '[-0]', 'JSON_NUMBER_NEGATIVE_ZERO'], ['negative-zero-decimal', '[-0.0]', 'JSON_NUMBER_NEGATIVE_ZERO'], ['negative-zero-exponent', '[-0e5]', 'JSON_NUMBER_NEGATIVE_ZERO'], ['negative-zero-long', '[-0.000]', 'JSON_NUMBER_NEGATIVE_ZERO'],
  ['two-to-the-53', '[9007199254740992]', 'JSON_NUMBER_UNSAFE_INTEGER'], ['two-to-the-53-plus-1', '[9007199254740993]', 'JSON_NUMBER_UNSAFE_INTEGER'], ['negative-unsafe', '[-9007199254740992]', 'JSON_NUMBER_UNSAFE_INTEGER'],
  ['twenty-digits', '[12345678901234567890]', 'JSON_NUMBER_UNSAFE_INTEGER'], ['forty-digits', `[${'9'.repeat(40)}]`, 'JSON_NUMBER_UNSAFE_INTEGER'], ['five-hundred-digits', `[${'9'.repeat(500)}]`, 'JSON_NUMBER_UNSAFE_INTEGER'],
  ['dominant-exponent-positive', `[1e${'9'.repeat(40)}]`, 'JSON_NUMBER_UNSAFE_INTEGER'], ['dominant-exponent-negative', `[1e-${'9'.repeat(40)}]`, 'JSON_NUMBER_NOT_INTEGRAL'],
  ['exponent-with-leading-zeros-fraction', `[1e-${'0'.repeat(34)}5]`, 'JSON_NUMBER_NOT_INTEGRAL'], ['long-exponent-still-unsafe', `[1e${'0'.repeat(34)}17]`, 'JSON_NUMBER_UNSAFE_INTEGER'],
  ['zero-padded-fraction-not-integral', `[0.${'0'.repeat(1000)}1e999]`, 'JSON_NUMBER_NOT_INTEGRAL'],
]
for (const g of admittedSpellings) for (const sp of g.spellings) {
  const out = canonicalizeSigned(parseStrictJson(`[${sp}]`))
  assert.equal(out, `[${g.canonical}]`, `${sp} must denote ${g.value}`)
  assert.equal(JSON.parse(`[${sp}]`)[0] === g.value, true, `independent check of ${sp}`)
}
for (const t of admitted) assert.doesNotThrow(() => canonicalizeSigned(parseStrictJson(t)), t)
for (const [name, text, code] of rejectedTexts) assert.throws(() => parseStrictJson(text), e => e instanceof StrictJsonError && e.code === code, `signed-content rejection ${name}: ${text}`)
// What the GENERIC reading does with the same texts: it coerces silently. That is exactly why the profile exists.
const coerced = rejectedTexts.filter(([, text]) => { try { parseStrictJson(text, { numbers: 'ieee' }); return true } catch { return false } })
const genericCoercions = coerced.map(([name, text]) => ({ name, text, genericCanonical: canonicalizeText(text) }))
assert.ok(genericCoercions.length >= 15)
assert.equal(genericCoercions.find(c => c.name === 'unsafe-via-decimal').genericCanonical, '[9007199254740992]')
assert.equal(genericCoercions.find(c => c.name === 'underflow-to-zero').genericCanonical, '[0]')

const valueRejections = [
  ['undefined-property', 'JCS_UNDEFINED', 'an object member whose value is undefined'], ['undefined-array-item', 'JCS_UNDEFINED', 'an array item that is undefined'], ['undefined-top-level', 'JCS_UNDEFINED', 'undefined itself'],
  ['nan', 'JCS_NON_FINITE', 'NaN'], ['infinity', 'JCS_NON_FINITE', 'Infinity'], ['negative-infinity', 'JCS_NON_FINITE', '-Infinity'],
  ['function', 'JCS_UNSUPPORTED_TYPE', 'a function'], ['symbol', 'JCS_UNSUPPORTED_TYPE', 'a symbol'], ['bigint', 'JCS_UNSUPPORTED_TYPE', 'a BigInt'],
  ['map', 'JCS_NOT_PLAIN', 'a Map'], ['set', 'JCS_NOT_PLAIN', 'a Set'], ['date', 'JCS_NOT_PLAIN', 'a Date'], ['class-instance', 'JCS_NOT_PLAIN', 'an instance of a class'], ['typed-array', 'JCS_NOT_PLAIN', 'a Uint8Array'],
  ['boxed-string', 'JCS_NOT_PLAIN', 'new String("x")'], ['regexp', 'JCS_NOT_PLAIN', 'a RegExp'], ['symbol-key', 'JCS_NOT_PLAIN', 'an object with a symbol-keyed property'],
  ['getter', 'JCS_NOT_PLAIN', 'an accessor property'], ['non-enumerable', 'JCS_NOT_PLAIN', 'a non-enumerable own property (hidden data)'],
  ['sparse-array', 'JCS_NOT_PLAIN', 'an array with a hole'], ['array-extra-property', 'JCS_NOT_PLAIN', 'an array with a non-index property'],
  ['lone-surrogate-string', 'JCS_ILL_FORMED_STRING', 'a string containing a lone surrogate'], ['lone-surrogate-key', 'JCS_ILL_FORMED_STRING', 'an object key containing a lone surrogate'],
  ['cycle', 'JCS_CYCLE', 'an object that contains itself'], ['too-deep', 'JCS_TOO_DEEP', 'nesting deeper than 64'],
].map(([builder, code, description]) => ({ builder, code, description }))
// In-memory VALUES rejected by the signed-content admission check (the canonicalizer's call site of the shared predicate). Generic canonicalize() accepts every one of these.
const admissionRejections = [
  ['fraction', 'NON_INTEGER', 'the double 0.5'], ['negative-zero', 'NEGATIVE_ZERO', 'the double -0'], ['two-to-the-53', 'UNSAFE_INTEGER', 'the double 2^53'],
  ['two-to-the-60', 'UNSAFE_INTEGER', 'the double 2^60 (its JavaScript text, 1152921504606847000, is not the exact value 1152921504606846976 that other runtimes print)'],
  ['1e21', 'UNSAFE_INTEGER', 'the double 1e21'], ['smallest-subnormal', 'NON_INTEGER', 'the double 5e-324'], ['max-double', 'UNSAFE_INTEGER', 'Number.MAX_VALUE'], ['negative-unsafe', 'UNSAFE_INTEGER', 'the double -(2^53)'],
].map(([builder, reason, description]) => ({ builder, reason, description }))

const unicodeCases = [
  { name: 'nfc-and-nfd-keys-are-two-members', description: 'Two keys that are canonically equivalent but not identical are two members, in code-unit order, un-normalized.', input: `{"${'é'}":1,"${'é'}":2}`, canonical: `{"é":2,"é":1}` },
  { name: 'nfc-and-nfd-strings-are-different', description: 'The two spellings of a string are different strings.', input: `["${'café'}","${'café'}"]`, canonical: `["café","café"]` },
  { name: 'compatibility-forms-are-untouched', description: 'NFKC would change these; nothing is normalized.', input: '["ﬁ","①","Ａ"]', canonical: '["ﬁ","①","Ａ"]' },
  { name: 'escape-is-not-normalization', description: 'An escaped combining sequence stays a combining sequence.', input: '["e\\u0301"]', canonical: '["é"]' },
]
for (const u of unicodeCases) assert.equal(canonicalizeSigned(parseStrictJson(u.input)), u.canonical, u.name)

const ADVERSARIAL_SIZES = [3, 14, 15, 16, 17, 1000, 100000]
const adversarialCases = []
for (const kind of Object.keys(ADVERSARIAL_KINDS)) for (const N of ADVERSARIAL_SIZES) {
  const expected = ADVERSARIAL_KINDS[kind].expected(N)
  const actual = numberTokenProblem(adversarialToken(kind, N))
  assert.deepEqual(actual, expected, `adversarial ${kind} N=${N}`)
  adversarialCases.push({ kind, N, expected })
}
write('jcs.v4.json', head({
  numericProfile: { id: NUMBER_PROFILE_ID, statement: 'The Agent Verify signed-content numeric profile. NOT RFC 8785. The rule is about the exact mathematical VALUE: a signed number is an integer with |n| <= 2^53 - 1 that is not negative zero. Spellings of the same exact safe integer (98, 98.0, 9.8e1) are the same number, and JCS then canonicalizes it as 98. A token is evaluated exactly, with arbitrary-precision integer arithmetic, and never through a double: 9007199254740993.0 is refused (not rounded to ...992), 1e-400 is refused (not turned into 0), 0.1 is refused. A naturally fractional quantity is a scaled integer under an explicit name (for example printablePercent). The parser (numberTokenProblem), the canonicalizer admission check and the signer pre-check (numberProblem) implement the same rule.' },
  canonical: canonicalCases,
  keyOrder: { input: sortInput, expectedOrder: SORT_EXPECTED_ORDER },
  numbers: NUMBERS.map(([ieeeHex, expected]) => ({ ieeeHex, expected, error: expected === null ? 'JCS_NON_FINITE' : undefined })),
  parseRejections: parseRejections.map(([name, text, code]) => ({ name, text, code })),
  numberProfile: { admittedSpellings, admitted, rejectedTexts: rejectedTexts.map(([name, text, code]) => ({ name, text, code })), genericCoercions, admissionRejections },
  adversarialNumbers: { note: 'Long runs of zeros in the MIDDLE of integer, fractional and exponent forms. The token is rebuilt by adversarialToken(kind, N) (conformance/v4/test/helpers.mjs); expected is the exact value or the refusal. The v2 classifier was quadratic on these.', sizes: ADVERSARIAL_SIZES, cases: adversarialCases },
  depthModel: { maxJsonDepth: MAX_JSON_DEPTH, rule: 'ABSOLUTE depth from the bundle root: the bundle object is depth 1, the assessment root is depth 2, the payload root is depth 3. A container over 64 is refused by the parser AND by the canonicalizer (given baseDepth = the depth of the sub-object parent), so nothing that parses cannot be digested and nothing that digests cannot parse.' },
  valueRejections,
  unicode: unicodeCases,
  f1RoundTrip: { description: 'F1: an in-memory object with an undefined member is REJECTED; its serialized form (no such key) canonicalizes. The old canonicalizer turned undefined into null, so signer and verifier could hash different bytes.', builder: 'undefined-property', code: 'JCS_UNDEFINED', serializedText: '{"a":1}', serializedCanonical: '{"a":1}' },
}))

// ── legacy-attestation.v4.json: frozen scan attestations, verified by scanner, web port and CI stub ──
//
// Legacy verification is UNCHANGED by everything above: no low-S rule, no numeric profile, no bundle. Both the low-S and the
// high-S form of the SAME attestation are frozen and must both verify as VALID (the twin needs no private key).

const scannerUrl = pathToFileURL(path.join(repoRoot, 'packages', 'scanner', 'dist', 'index.js')).href
const scanner = await import(scannerUrl)
const legacyPayload = withPolicy => scanner.buildAttestationPayload({
  artifactHash: sha256Hex('conformance-artifact'), artifactHashAlgorithm: 'SHA-256', artifactFingerprintVersion: '1.0.0',
  scanId: 'conformance-scan-0001', reportHash: sha256Hex('conformance-report'), verdict: 'REVIEW', score: 42,
  ...(withPolicy ? { policyProfile: 'conformance-policy', policyResult: 'FAIL' } : {}),
  scannerVersion: '1.4.0', schemaVersion: '1.3.0', issuer: ISSUER, issuedAt: ISSUED_AT,
})
const legacySigned = {}
const attestationFor = (payload, signature) => ({ payload, signature, algorithm: 'ECDSA-P256-SHA256', publicKey: K.legacy.webCryptoJwk })
for (const [name, withPolicy] of [['base', false], ['withPolicy', true]]) {
  const payload = legacyPayload(withPolicy)
  const canonicalText = scanner.canonicalAttestationJson(payload)
  const lowS = await signB64(K.legacy.privateKey, new TextEncoder().encode(canonicalText))
  legacySigned[name] = { form: 'low-s', attestation: attestationFor(payload, lowS), canonicalText, canonicalSha256: sha256Hex(canonicalText) }
  legacySigned[`${name}HighS`] = { form: 'high-s', attestation: attestationFor(structuredClone(payload), twinOf(lowS)), canonicalText, canonicalSha256: sha256Hex(canonicalText) }
}
{
  const payload = legacyPayload(false)
  const tagged = new TextEncoder().encode(`${ref.PAYLOAD_TAG}${scanner.canonicalAttestationJson(payload)}`)
  legacySigned.taggedSignature = { form: 'low-s', attestation: attestationFor(payload, await signB64(K.legacy.privateKey, tagged)), canonicalText: scanner.canonicalAttestationJson(payload), canonicalSha256: sha256Hex(scanner.canonicalAttestationJson(payload)) }
}
for (const [n, s] of Object.entries(legacySigned)) assert.equal(partsOf(s.attestation.signature).s <= HALF, s.form === 'low-s', `${n} is recorded as ${s.form}`)

const LP = '/payload'
const lreplace = (field, value) => rep(`${LP}/${field}`, value)
const legacyCases = []
const lc = (name, description, from, patch, status, extra = {}) => legacyCases.push({ name, description, from, ...(patch ? { patch } : {}), ...extra, expected: { status } })
lc('valid.base', 'A scan attestation with no policy fields (low-S signature).', 'base', null, 'VALID')
lc('valid.with-policy', 'A scan attestation with policyProfile and policyResult (low-S).', 'withPolicy', null, 'VALID')
lc('valid.low-s', 'DELIBERATE: a low-S signature verifies under legacy semantics.', 'base', null, 'VALID')
lc('valid.high-s', 'DELIBERATE: the (r, n - s) twin of the SAME signature also verifies under legacy semantics. The low-S rule applies to the profile-attestation type only; legacy verification is unchanged.', 'baseHighS', null, 'VALID')
lc('valid.with-policy.high-s', 'The same for an attestation with policy fields.', 'withPolicyHighS', null, 'VALID')
lc('valid.expected-key-matches', 'Verified against the expected public key it embeds.', 'base', null, 'VALID', { expectedPublicKey: 'legacy' })
lc('valid.high-s.expected-key-matches', 'A high-S legacy signature verified against the expected key.', 'baseHighS', null, 'VALID', { expectedPublicKey: 'legacy' })
for (const [field, value] of [['artifactHash', 'a'.repeat(64)], ['scanId', 'conformance-scan-0002'], ['reportHash', 'b'.repeat(64)], ['verdict', 'PASS'], ['score', 43], ['scannerVersion', '1.4.1'], ['rulesetVersion', '1.4.1'], ['schemaVersion', '1.3.1'], ['artifactHashAlgorithm', 'SHA-512'], ['artifactFingerprintVersion', '1.0.1'], ['issuedAt', '2026-01-15T12:00:01.000Z'], ['issuer', 'agentverify-conformance-other']]) {
  lc(`tamper.${field}`, `${field} changed after signing`, 'base', [lreplace(field, value)], 'INVALID_SIGNATURE')
}
lc('tamper.high-s.verdict', 'A high-S legacy signature over a changed payload still fails: legacy accepts the twin form, not a wrong message.', 'baseHighS', [lreplace('verdict', 'PASS')], 'INVALID_SIGNATURE')
lc('tamper.policyResult', 'policyResult flipped', 'withPolicy', [lreplace('policyResult', 'PASS')], 'INVALID_SIGNATURE')
lc('tamper.policyProfile', 'policyProfile changed', 'withPolicy', [lreplace('policyProfile', 'other-policy')], 'INVALID_SIGNATURE')
lc('tamper.policy-removed', 'policy fields removed', 'withPolicy', [{ op: 'remove', path: `${LP}/policyResult` }, { op: 'remove', path: `${LP}/policyProfile` }], 'INVALID_SIGNATURE')
lc('tamper.policy-added', 'policy fields added', 'base', [{ op: 'add', path: `${LP}/policyProfile`, value: 'conformance-policy' }, { op: 'add', path: `${LP}/policyResult`, value: 'PASS' }], 'INVALID_SIGNATURE')
lc('tamper.unknown-field-added', 'an unknown payload field added (the legacy signature covers every field present)', 'base', [{ op: 'add', path: `${LP}/extra`, value: 'x' }], 'INVALID_SIGNATURE')
lc('tamper.signature-bit-flipped', 'one bit of the signature flipped', 'base', [rep('/signature', flipBase64(legacySigned.base.attestation.signature))], 'INVALID_SIGNATURE')
lc('tamper.signature-zeros', 'a well-formed but wrong signature (64 zero bytes)', 'base', [rep('/signature', Buffer.alloc(64).toString('base64'))], 'INVALID_SIGNATURE')
lc('tamper.embedded-key-swapped', 'the embedded key replaced by another key', 'base', [rep('/publicKey', K.legacyOther.webCryptoJwk)], 'INVALID_SIGNATURE')
lc('expected-key.mismatch', 'the embedded key is not the expected key', 'base', null, 'INVALID_SIGNATURE', { expectedPublicKey: 'legacyOther' })
lc('version.unsupported', 'attestationVersion 1.0.1', 'base', [lreplace('attestationVersion', '1.0.1')], 'UNSUPPORTED_VERSION')
lc('version.unsupported-checked-before-signature', 'attestationVersion 2.0.0 is UNSUPPORTED_VERSION even though the signature would also fail', 'base', [lreplace('attestationVersion', '2.0.0')], 'UNSUPPORTED_VERSION')
for (const field of ['verdict', 'score', 'issuedAt', 'artifactHash', 'issuer']) lc(`malformed.missing-${field}`, `${field} removed`, 'base', [{ op: 'remove', path: `${LP}/${field}` }], 'MALFORMED')
lc('malformed.null-verdict', 'verdict is null', 'base', [lreplace('verdict', null)], 'MALFORMED')
lc('malformed.algorithm', 'algorithm ES256', 'base', [rep('/algorithm', 'ES256')], 'MALFORMED')
lc('malformed.signature-empty', 'empty signature', 'base', [rep('/signature', '')], 'MALFORMED')
lc('malformed.signature-not-base64', 'signature that is not base64', 'base', [rep('/signature', '!!!not-base64!!!')], 'MALFORMED')
lc('malformed.publicKey-missing', 'embedded key removed', 'base', [{ op: 'remove', path: '/publicKey' }], 'MALFORMED')
lc('malformed.publicKey-garbage', 'embedded key that is not a key', 'base', [rep('/publicKey', { kty: 'EC', crv: 'P-256', x: 'AAAA', y: 'AAAA' })], 'MALFORMED')
lc('cross-type.tagged-signature', 'A signature over the TAGGED (profile-style) input does not verify as a legacy attestation, even with the right key.', 'taggedSignature', null, 'INVALID_SIGNATURE')
legacyCases.push({ name: 'cross-type.profile-attestation-is-malformed', description: 'The legacy verifier given a profile attestation fails closed: the required scan fields are absent. (The attestation object is taken from bundles.v4.json, B1.)', fromBundle: 'B1', expected: { status: 'MALFORMED' } })

const applyLegacy = c => (c.fromBundle ? structuredClone(signed[c.fromBundle].bundle.attestation) : (c.patch ? applyPatch(legacySigned[c.from].attestation, c.patch) : structuredClone(legacySigned[c.from].attestation)))
const legacyKeys = { legacy: K.legacy.webCryptoJwk, legacyOther: K.legacyOther.webCryptoJwk }
for (const c of legacyCases) {
  const actual = await scanner.verifyAttestation(applyLegacy(c), c.expectedPublicKey ? legacyKeys[c.expectedPublicKey] : undefined)
  if (actual.status !== c.expected.status) { console.error(`LEGACY PREDICTION MISMATCH in ${c.name}: expected ${c.expected.status}, the current scanner says ${actual.status} (${actual.reason})`); process.exit(1) }
}
for (const [name, s] of Object.entries(legacySigned)) assert.equal(canonicalize(s.attestation.payload), s.canonicalText, `legacy canonical form equals strict JCS for ${name}: the design's claim that the old canonicalizer is JCS-compatible for ordinary JSON`)

write('legacy-attestation.v4.json', head({
  purpose: 'Frozen scan attestations (attestationVersion 1.0.0, no attestationType). They must verify with exactly these results in the scanner, the web port and the CI stub for as long as the product exists. They freeze the EXISTING behaviour; they change nothing about it. Both the low-S and high-S forms of the same attestation are pinned deliberately: the low-S rule does NOT apply to legacy attestations.',
  publicKeys: { legacy: K.legacy.webCryptoJwk, legacyOther: K.legacyOther.webCryptoJwk },
  attestations: legacySigned, cases: legacyCases,
}))

// ══ VECTOR SET v4: NEW VECTOR FILES ═══════════════════════════════════════════════════════════

// ── assessment-schema.v4.json ─────────────────────────────────────────────────────────────────
write('assessment-schema.v4.json', head({
  purpose: 'The exact schema of a profile assessment, schema version 1.1.0. A case is the synthetic base assessment with a patch applied (values written { "$ieeeHex": "<16 hex digits>" } are rebuilt as the exact IEEE-754 double before validation). expected is null (valid) or the first problem, by stable code.',
  schemaVersion: '1.1.0',
  enums: { confidence: ['high', 'medium', 'low'], severity: ['high', 'medium', 'low'], polarity: ['gap', 'positive', 'context'], axis: ['manifest', 'tools', 'network', 'shell', 'filesystem', 'identity', 'sensitive', 'dependencies', 'lockfile', 'execution-config', 'sbom', 'metadata'], provenance: ['DECLARED', 'STATICALLY_OBSERVED', 'RECOMPUTED', 'CRYPTOGRAPHICALLY_VERIFIED', 'BEHAVIORALLY_OBSERVED', 'EXTERNAL_EVIDENCE', 'INFERRED'], upstreamSeverity: ['Critical', 'High', 'Medium'], checkStatus: ['EVIDENCE_OBSERVED', 'GAP_IDENTIFIED', 'NOT_ASSESSED'] },
  controlStatusRule: 'any check GAP_IDENTIFIED => GAP_IDENTIFIED; otherwise any NOT_ASSESSED => NOT_ASSESSED; otherwise EVIDENCE_OBSERVED. There is no "passed" status.',
  problemCodes: [...ASSESSMENT_SCHEMA_PROBLEM_CODES],
  base: baseAssessment(),
  cases: SCHEMA_CASES.map(([name, patch, expected]) => ({ name, patch, expected })),
}))

// ── profile-registry.v4.json ──────────────────────────────────────────────────────────────────
const lookups = [
  ['owasp-agentic-skills-2026', '1.0.0-alpha.1', { found: true }],
  ['owasp-agentic-skills-2026', '1.0.0-alpha.2', { problem: 'UNSUPPORTED_PROFILE_VERSION' }],
  ['owasp-agentic-skills-2026', '1.0.0', { problem: 'UNSUPPORTED_PROFILE_VERSION' }],
  ['owasp-agentic-skills-2026', '', { problem: 'UNSUPPORTED_PROFILE_VERSION' }],
  ['owasp-agentic-skills-2027', '1.0.0-alpha.1', { problem: 'UNSUPPORTED_PROFILE' }],
  ['some-other-profile', '1.0.0-alpha.1', { problem: 'UNSUPPORTED_PROFILE' }],
  ['constructor', '1.0.0-alpha.1', { problem: 'UNSUPPORTED_PROFILE' }],
  ['__proto__', '1.0.0-alpha.1', { problem: 'UNSUPPORTED_PROFILE' }],
  ['toString', '1.0.0-alpha.1', { problem: 'UNSUPPORTED_PROFILE' }],
  ['hasOwnProperty', '1.0.0-alpha.1', { problem: 'UNSUPPORTED_PROFILE' }],
  ['owasp-agentic-skills-2026', 'constructor', { problem: 'UNSUPPORTED_PROFILE_VERSION' }],
  ['owasp-agentic-skills-2026', '__proto__', { problem: 'UNSUPPORTED_PROFILE_VERSION' }],
  ['owasp-agentic-skills-2026', 'versions', { problem: 'UNSUPPORTED_PROFILE_VERSION' }],
]
write('profile-registry.v4.json', head({
  purpose: 'The CLOSED profile registry. For each profileId + profileVersion it pins the framework, the upstream repository, the pinned upstream commit, the upstream licence and status, the control universe, the implemented control set and the assessment schema version. A structurally valid assessment whose profile metadata differs from the pin is PROFILE_DEFINITION_MISMATCH, never SUPPORTED. The five interpretation versions (scanner, engine, rubric, key allowlist, normalization) are deliberately NOT pinned: they are bound independently in payload and assessment.',
  registry: PROFILE_REGISTRY,
  notImplementedControlsRule: 'notImplementedControls is DEFINED as controlUniverse minus implementedControls, in controlUniverse order.',
  problemCodes: ['profile.framework', 'profile.upstream.repo', 'profile.upstream.commit', 'profile.upstream.license', 'profile.upstream.status', 'profile.implemented-controls', 'profile.not-implemented-controls', 'profile.assessment-schema-version'],
  lookups: lookups.map(([profileId, profileVersion, expected]) => ({ profileId, profileVersion, expected })),
  baseAssessment: 'assessment-schema.v4.json#/base',
  definitionCases: DEFINITION_CASES.map(([name, patch, code]) => ({ name, patch, expected: { interpretation: 'PROFILE_DEFINITION_MISMATCH', interpretationReason: code } })),
  interpretationOrder: ['UNSUPPORTED_SCHEMA', 'INVALID_ASSESSMENT', 'UNSUPPORTED_PROFILE', 'UNSUPPORTED_PROFILE_VERSION', 'PROFILE_DEFINITION_MISMATCH', 'SUPPORTED'],
}))

// ── admission.v4.json: the signer-side admission predicate (verification logic; no signing) ────
{
  const ADM = []
  const adm = (name, description, patch, expected) => { ADM.push({ name, description, patch, expected }) }
  const admitted = { admitted: true }
  adm('base', 'The synthetic base assessment is admitted.', [], admitted)
  adm('fraction', 'A fractional number (0.5) in a fact: refused before any digest or signature.', [rep(`${E0}/facts`, { a: num(HEX.half) })], { admitted: false, reason: 'assessment.not-canonicalizable:JCS_NUMBER_NOT_ADMITTED' })
  adm('negative-zero', 'Negative zero.', [rep(`${E0}/facts`, { a: num(HEX.negZero) })], { admitted: false, reason: 'assessment.not-canonicalizable:JCS_NUMBER_NOT_ADMITTED' })
  adm('two-to-the-53', '2^53.', [rep(`${E0}/facts`, { a: num(HEX.two53) })], { admitted: false, reason: 'assessment.not-canonicalizable:JCS_NUMBER_NOT_ADMITTED' })
  adm('1e21', '1e21.', [rep(`${E0}/facts`, { a: num(HEX.e21) })], { admitted: false, reason: 'assessment.not-canonicalizable:JCS_NUMBER_NOT_ADMITTED' })
  adm('nan', 'NaN.', [rep(`${E0}/facts`, { a: num(HEX.nan) })], { admitted: false, reason: 'assessment.not-canonicalizable:JCS_NON_FINITE' })
  adm('infinity', 'Infinity.', [rep(`${E0}/facts`, { a: num(HEX.inf) })], { admitted: false, reason: 'assessment.not-canonicalizable:JCS_NON_FINITE' })
  adm('depth-at-limit-but-not-schema-valid', 'Absolute depth 64 (62 nested arrays under an unknown top-level field): canonicalizes, but the exact schema refuses the unknown field.', [add('/deep', { $nested: 62 })], { admitted: false, reason: 'assessment.schema.top-level' })
  adm('depth-fits-alone-but-not-embedded', 'The v2 GAP: 63 nested arrays reach depth 64 measured from the assessment alone, but 65 measured from the bundle root, where the assessment actually lives. v3 measures from the bundle root, so it is refused here and could not be parsed inside its bundle either.', [add('/deep', { $nested: 63 })], { admitted: false, reason: 'assessment.not-canonicalizable:JCS_TOO_DEEP' })
  adm('depth-way-over', '200 nested arrays.', [add('/deep', { $nested: 200 })], { admitted: false, reason: 'assessment.not-canonicalizable:JCS_TOO_DEEP' })
  adm('schema-unknown-field', 'An unknown field: canonicalizable but not schema-valid.', [add('/extra', 'x')], { admitted: false, reason: 'assessment.schema.top-level' })
  adm('coverage-inconsistent', 'Inconsistent coverage.', [rep(`${A0}/coverage/total`, 2)], { admitted: false, reason: 'assessment.schema.coverage' })
  adm('unsupported-schema', 'An unsupported schema version.', [rep('/schemaVersion', '1.2.0')], { admitted: false, reason: 'UNSUPPORTED_SCHEMA' })
  adm('unknown-profile', 'A profile id outside the closed registry.', [rep('/profile/profileId', 'some-other-profile')], { admitted: false, reason: 'UNSUPPORTED_PROFILE' })
  adm('unknown-profile-version', 'A profile version outside the registry.', [rep('/profile/agentverifyProfileVersion', '9.9.9')], { admitted: false, reason: 'UNSUPPORTED_PROFILE_VERSION' })
  for (const [name, patch, code] of DEFINITION_CASES) adm(`definition.${name}`, `Pinned profile value differs (${name}): a signer must not sign it.`, patch, { admitted: false, reason: code })
  for (const c of ADM) {
    const actual = ref.admitAssessment(reviveNumbers(applyPatch(baseAssessment(), c.patch)))
    assert.deepEqual(actual, c.expected, `admission case ${c.name}`)
  }
  write('admission.v4.json', head({
    purpose: 'The signer-side ADMISSION predicate, as a pure verification-side function. A signing service must run it on the assessment it just generated AFTER generation and BEFORE any private-key operation, and must refuse to sign anything not admitted (see docs/attestation-profile-design.md, section "Product signing boundary"). Admitted means: canonicalizes under the signed-content numeric profile within the shared depth limit (measured from the BUNDLE root) AND is SUPPORTED (exact schema + pinned profile definition). This file specifies the predicate; it implements no signing.',
    baseAssessment: 'assessment-schema.v4.json#/base',
    cases: ADM,
  }))
}

// ── timestamps.v4.json ─────────────────────────────────────────────────────────────────────────
{
  const validTimestamps = ['0001-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z', '1969-12-31T23:59:59.999Z', '2000-02-29T00:00:00.000Z', '2024-02-29T23:59:59.999Z', '2026-01-15T12:00:00.000Z', '2026-12-31T23:59:59.999Z', '2100-03-01T00:00:00.000Z', '2038-01-19T03:14:07.000Z', '9999-12-31T23:59:59.999Z', '1900-02-28T12:00:00.000Z', '1600-02-29T00:00:00.000Z']
  const invalidTimestamps = [
    ['feb-30', '2026-02-30T00:00:00.000Z'], ['feb-29-common-year', '2025-02-29T00:00:00.000Z'], ['feb-29-1900', '1900-02-29T00:00:00.000Z'], ['feb-29-2100', '2100-02-29T00:00:00.000Z'],
    ['apr-31', '2026-04-31T00:00:00.000Z'], ['jun-31', '2026-06-31T00:00:00.000Z'], ['sep-31', '2026-09-31T00:00:00.000Z'], ['nov-31', '2026-11-31T00:00:00.000Z'],
    ['jan-32', '2026-01-32T00:00:00.000Z'], ['month-13', '2026-13-01T00:00:00.000Z'], ['month-00', '2026-00-01T00:00:00.000Z'], ['day-00', '2026-01-00T00:00:00.000Z'],
    ['hour-24', '2026-01-15T24:00:00.000Z'], ['hour-24-with-minutes', '2026-01-15T24:30:00.000Z'], ['minute-60', '2026-01-15T12:60:00.000Z'], ['second-60', '2026-01-15T12:00:60.000Z'], ['leap-second', '2016-12-31T23:59:60.000Z'],
    ['year-0000', '0000-06-15T00:00:00.000Z'], ['no-milliseconds', '2026-01-15T12:00:00Z'], ['one-fraction-digit', '2026-01-15T12:00:00.0Z'], ['four-fraction-digits', '2026-01-15T12:00:00.0000Z'],
    ['offset-z-replaced', '2026-01-15T12:00:00.000+00:00'], ['offset-minus', '2026-01-15T12:00:00.000-05:00'], ['lowercase-t', '2026-01-15t12:00:00.000Z'], ['lowercase-z', '2026-01-15T12:00:00.000z'], ['space', '2026-01-15 12:00:00.000Z'],
    ['date-only', '2026-01-15'], ['empty', ''], ['leading-space', ' 2026-01-15T12:00:00.000Z'], ['trailing-space', '2026-01-15T12:00:00.000Z '], ['trailing-newline', '2026-01-15T12:00:00.000Z\n'],
    ['expanded-year', '+002026-01-15T12:00:00.000Z'], ['negative-year', '-000001-01-15T12:00:00.000Z'], ['fullwidth-digits', '２０２６-01-15T12:00:00.000Z'], ['arabic-indic-digits', '٢٠٢٦-01-15T12:00:00.000Z'],
    ['slashes', '2026/01/15T12:00:00.000Z'], ['week-date', '2026-W03-4T12:00:00.000Z'], ['ordinal-date', '2026-015T12:00:00.000Z'], ['basic-format', '20260115T120000.000Z'], ['comma-fraction', '2026-01-15T12:00:00,000Z'],
    ['plus-in-digit-field', '2026-+1-15T12:00:00.000Z'], ['hex-digit-field', '2026-0x-15T12:00:00.000Z'],
    ['wrong-first-date-separator-only', '2026.01-15T12:00:00.000Z'], ['wrong-second-date-separator-only', '2026-01.15T12:00:00.000Z'], ['wrong-first-time-separator-only', '2026-01-15T12.00:00.000Z'], ['wrong-second-time-separator-only', '2026-01-15T12:00.00.000Z'],
    ['nondigit-year', '20x6-01-15T12:00:00.000Z'], ['nondigit-month', '2026-x1-15T12:00:00.000Z'], ['nondigit-day', '2026-01-1xT12:00:00.000Z'], ['nondigit-hour', '2026-01-15Tx2:00:00.000Z'], ['nondigit-minute', '2026-01-15T12:x0:00.000Z'], ['nondigit-second', '2026-01-15T12:00:x0.000Z'], ['nondigit-fraction', '2026-01-15T12:00:00.00xZ'],
    ['colon-in-digit-field', '2026-01-15T12:00:0:.000Z'], ['space-in-digit-field', '2026-01-15T12:00: 0.000Z'], ['minus-in-digit-field', '2026-01-15T12:-0:00.000Z'], ['tab-separator', '2026-01-15\t12:00:00.000Z'], ['wrong-date-separator', '2026.01.15T12:00:00.000Z'], ['wrong-time-separator', '2026-01-15T12.00.00.000Z'], ['wrong-fraction-separator', '2026-01-15T12:00:00:000Z'], ['wrong-terminator', '2026-01-15T12:00:00.000Y'], ['embedded-nul', '2026-01-15T12:00:00.000\u0000'], ['long-garbage', 'x'.repeat(24)],
  ]
  for (const t of validTimestamps) { const r = parseTimestamp(t); assert.ok(r, t); assert.equal(r.ms, new Date(t).getTime(), `independent oracle: ${t}`); assert.equal(formatTimestamp(r.ms), t) }
  for (const [n, t] of invalidTimestamps) assert.equal(parseTimestamp(t), null, n)
  const notStrings = [['undefined', null], ['null', null], ['number', 1768478400000], ['object', {}], ['array', ['2026-01-15T12:00:00.000Z']], ['boolean', true]]
  write('timestamps.v4.json', head({
    purpose: 'THE ONE STRICT CANONICAL TIMESTAMP PARSER, tested directly. The canonical form is YYYY-MM-DDTHH:MM:SS.mmmZ (24 characters, UTC). It does not use Date.parse or a Date round trip: the calendar is validated by arithmetic (Gregorian leap years; 24:00 and :60 are not admitted; years 0001-9999) so an impossible date is never rolled forward into a real one. Every timestamp in the bundle, the key set and the policy clock goes through it.',
    valid: validTimestamps.map(ts => ({ ts, epochMs: new Date(ts).getTime(), note: 'epochMs computed by the independent oracle new Date(ts).getTime(), valid for canonical ISO text' })),
    invalid: invalidTimestamps.map(([name, ts]) => ({ name, ts })),
    notStrings: notStrings.map(([name]) => ({ name })),
    epochRange: { firstMs: parseTimestamp('0001-01-01T00:00:00.000Z').ms, lastMs: parseTimestamp('9999-12-31T23:59:59.999Z').ms },
  }))
}

// ── manifest ─────────────────────────────────────────────────────────────────────────────────

const manifest = {}
for (const f of readdirSync(OUT).filter(f => f.endsWith('.v4.json') && f !== 'manifest.v4.json').sort()) manifest[f] = sha256Hex(readFileSync(path.join(OUT, f)))
write('manifest.v4.json', { note: 'SHA-256 of every vector file in vector set v4. If a vector changes, this changes, and the change is visible in review.', files: manifest })

console.log(`Wrote ${Object.keys(manifest).length + 1} vector files: ${cases.length} bundle cases, ${legacyCases.length} legacy cases, ${digestCases.length} digest cases, ${avpkgCases.length} package cases, ${canonicalCases.length + parseRejections.length + valueRejections.length + rejectedTexts.length} JCS/number cases.`)
console.log('Private keys were held in memory only and are now discarded.')
