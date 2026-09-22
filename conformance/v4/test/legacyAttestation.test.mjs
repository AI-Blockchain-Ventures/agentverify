import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalize } from '../reference/jcs.mjs'
import { legacyCaseInput, loadVector } from './helpers.mjs'

// LEGACY SCAN ATTESTATIONS: the guarantee that existing signatures keep their meaning.
//
// This file runs against whatever `packages/scanner/dist` is present: the real private scanner on a developer machine,
// and the generated public stub in public CI. Both must give exactly the frozen results. The web port is checked by
// apps/web/test/conformanceLegacy.test.mjs against the same vector file.
//
// These vectors freeze the EXISTING behaviour, as observed from today's code. They prove that the profile-attestation work
// (and anything after it) does not change how a scan attestation verifies. They cannot prove what older builds did.

const here = path.dirname(fileURLToPath(import.meta.url))
const scanner = await import(pathToFileURL(path.join(here, '..', '..', '..', 'packages', 'scanner', 'dist', 'index.js')).href)
const LEGACY = loadVector('legacy-attestation.v4.json')
const BUNDLES = loadVector('bundles.v4.json')
const sha256Hex = s => createHash('sha256').update(s, 'utf8').digest('hex')

test('the legacy vector set is substantial and covers the statuses the legacy verifier can return', () => {
  assert.ok(LEGACY.cases.length >= 40)
  const statuses = new Set(LEGACY.cases.map(c => c.expected.status))
  assert.deepEqual([...statuses].sort(), ['INVALID_SIGNATURE', 'MALFORMED', 'UNSUPPORTED_VERSION', 'VALID'])
})

test('the signed bytes are unchanged: canonicalAttestationJson reproduces the frozen text, which equals strict RFC 8785 JCS', () => {
  for (const [name, s] of Object.entries(LEGACY.attestations)) {
    assert.equal(scanner.canonicalAttestationJson(s.attestation.payload), s.canonicalText, `${name}: exact signed text`)
    assert.equal(sha256Hex(s.canonicalText), s.canonicalSha256, name)
    assert.equal(canonicalize(s.attestation.payload), s.canonicalText, `${name}: the legacy canonicalizer agrees with JCS for these (ordinary JSON) payloads`)
    assert.ok(s.canonicalText.startsWith('{'), `${name}: the legacy signing input is the bare JSON, with no domain tag`)
  }
})

test('every legacy case verifies with exactly its frozen status', async () => {
  for (const c of LEGACY.cases) {
    const { attestation, expectedPublicKey } = legacyCaseInput(LEGACY, BUNDLES, c)
    const result = await scanner.verifyAttestation(attestation, expectedPublicKey)
    assert.equal(result.status, c.expected.status, `${c.name}: ${result.reason ?? ''}`)
  }
})

test('the two payload shapes (with and without policy fields) both verify, and absent policy fields are absent, not null', () => {
  assert.equal('policyProfile' in LEGACY.attestations.base.attestation.payload, false)
  assert.equal('policyResult' in LEGACY.attestations.withPolicy.attestation.payload, true)
  assert.ok(!LEGACY.attestations.base.canonicalText.includes('null'))
})

test('cross-type: the legacy verifier fails closed on a profile attestation and on a tagged signature', async () => {
  const profile = BUNDLES.signed.B1.bundle.attestation
  const r = await scanner.verifyAttestation(structuredClone(profile))
  assert.equal(r.status, 'MALFORMED')
  const tagged = LEGACY.attestations.taggedSignature.attestation
  assert.equal((await scanner.verifyAttestation(structuredClone(tagged))).status, 'INVALID_SIGNATURE')
})

test('the legacy vectors are not signed by any key that a profile key set could contain', () => {
  const profileKeys = new Set(Object.values(BUNDLES.publicKeys).map(k => k.jwk.x))
  for (const k of Object.values(LEGACY.publicKeys)) assert.ok(!profileKeys.has(k.x), 'legacy and profile vectors use different throwaway keys')
})

test('LEGACY IS UNCHANGED BY THE PROFILE LOW-S RULE: the low-S and the high-S form of the same attestation both verify, deliberately', async () => {
  const N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n
  const sOf = b64 => BigInt('0x' + Buffer.from(b64, 'base64').subarray(32).toString('hex'))
  for (const [name, a] of Object.entries(LEGACY.attestations)) assert.equal(sOf(a.attestation.signature) <= N / 2n, a.form === 'low-s', name + ' is recorded as ' + a.form)
  for (const pair of [['base', 'baseHighS'], ['withPolicy', 'withPolicyHighS']]) {
    const [lo, hi] = pair.map(n => LEGACY.attestations[n].attestation)
    assert.deepEqual(hi.payload, lo.payload, 'same payload')
    assert.equal(Buffer.from(hi.signature, 'base64').subarray(0, 32).toString('hex'), Buffer.from(lo.signature, 'base64').subarray(0, 32).toString('hex'), 'same r')
    assert.equal(sOf(lo.signature) + sOf(hi.signature), N, 's and n - s')
    for (const a of [lo, hi]) assert.equal((await scanner.verifyAttestation(structuredClone(a))).status, 'VALID')
  }
  for (const n of ['valid.low-s', 'valid.high-s', 'valid.with-policy.high-s', 'valid.high-s.expected-key-matches']) assert.ok(LEGACY.cases.some(c => c.name === n && c.expected.status === 'VALID'), n)
})
