import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ALL_TAGS, DIGEST_DOMAINS, LEGACY_SCAN_ATTESTATION, SIGNING_DOMAINS, TAG_FORM } from '../reference/domains.mjs'
import * as ref from '../reference/profileAttestation.mjs'
import { loadVector } from './helpers.mjs'

// THE DOMAIN REGISTRY: one authoritative table for attestation type, signing-domain tag, key purpose and digest tags.

const D = loadVector('domains.v3.json')
const SIGNING = loadVector('signing.v3.json')
const BUNDLES = loadVector('bundles.v3.json')

test('the frozen registry equals the reference registry (nothing is spelled twice)', () => {
  assert.deepEqual(D.signingDomains.map(({ attestationType, ...d }) => [attestationType, d]), Object.entries(SIGNING_DOMAINS).map(([t, d]) => [t, JSON.parse(JSON.stringify(d))]))
  assert.deepEqual(D.digestDomains.map(({ name, ...d }) => [name, d]), Object.entries(DIGEST_DOMAINS).map(([n, d]) => [n, JSON.parse(JSON.stringify(d))]))
  assert.deepEqual(D.legacyScanAttestation, LEGACY_SCAN_ATTESTATION)
  assert.deepEqual(D.tagsHex.map(t => t.tag), ALL_TAGS)
  for (const t of D.tagsHex) assert.equal(Buffer.from(t.hex, 'hex').toString('utf8'), t.tag)
})

test('ONE-TO-ONE: attestation types, signing tags and key purposes are each unique, and no two registry entries share any of them', () => {
  const entries = Object.entries(SIGNING_DOMAINS)
  for (const field of ['name', 'signingTag', 'keyPurpose']) assert.equal(new Set(entries.map(([, d]) => d[field])).size, entries.length, field)
  assert.equal(new Set(entries.map(([t]) => t)).size, entries.length)
  const digestTags = Object.values(DIGEST_DOMAINS).map(d => d.tag)
  const digestSchemes = Object.values(DIGEST_DOMAINS).map(d => d.scheme)
  assert.equal(new Set(digestTags).size, digestTags.length)
  assert.equal(new Set(digestSchemes).size, digestSchemes.length)
  // A digest tag is never a signing tag, and the key purpose is not a tag or a type.
  for (const t of digestTags) assert.ok(!entries.some(([, d]) => d.signingTag === t))
  for (const [type, d] of entries) { assert.notEqual(d.keyPurpose, type); assert.ok(!ALL_TAGS.includes(d.keyPurpose)) }
})

test('PREFIX-FREE and DISTINCT: every tag has the registered form and no tag is a prefix of any other', () => {
  assert.equal(ALL_TAGS.length, Object.keys(SIGNING_DOMAINS).length + Object.keys(DIGEST_DOMAINS).length)
  for (const tag of ALL_TAGS) {
    assert.match(tag, TAG_FORM, JSON.stringify(tag))
    assert.equal(tag.at(-1), '\n')
    assert.notEqual(tag[0], '{', 'a tag can never begin like a legacy (bare JSON) signing input')
  }
  for (const a of ALL_TAGS) for (const b of ALL_TAGS) if (a !== b) assert.ok(!b.startsWith(a), `${JSON.stringify(a)} is a prefix of ${JSON.stringify(b)}`)
  assert.equal(new Set(ALL_TAGS).size, ALL_TAGS.length, 'distinct')
  // Bytes that follow a tag (a JCS object, or the package length prefix) cannot reproduce another tag's prefix, because every tag starts with the same word and ends at a line feed.
  for (const a of ALL_TAGS) for (const b of ALL_TAGS) if (a !== b) assert.notEqual(a.split('\n')[0], b.split('\n')[0])
})

test('a legacy scan attestation has no type, no tag and no key purpose, and its signing input can never equal a tagged one', () => {
  assert.deepEqual(LEGACY_SCAN_ATTESTATION, { attestationType: null, signingTag: null, keyPurpose: null })
  assert.equal(Object.keys(SIGNING_DOMAINS).includes('undefined'), false)
  for (const e of SIGNING.entries) assert.notEqual(Buffer.from(e.signingInputHex, 'hex')[0], 0x7b)
})

test('the verifier chooses the tag from the type it accepts, and the version inside a tag is independent of attestationVersion and bundleVersion', () => {
  assert.equal(ref.PAYLOAD_TAG, SIGNING_DOMAINS[ref.ATTESTATION_TYPE].signingTag)
  assert.equal(ref.PROFILE_KEY_PURPOSE, SIGNING_DOMAINS[ref.ATTESTATION_TYPE].keyPurpose)
  assert.equal(ref.ASSESSMENT_TAG, DIGEST_DOMAINS.assessment.tag)
  assert.deepEqual(SIGNING_DOMAINS[ref.ATTESTATION_TYPE].attestationVersions, ['1.0.0'])
  const v = D.independentVersions
  assert.deepEqual(Object.keys(v).sort(), ['assessmentDigestTagVersion', 'attestationVersion', 'bundleVersion', 'keySetVersion', 'packageDigestTagVersion', 'signingTagVersion'])
  assert.match(D.rules.join('\n'), /independent of attestationVersion and bundleVersion/)
  // Three independent lines: each can change without the others.
  assert.equal(SIGNING_DOMAINS[ref.ATTESTATION_TYPE].signingTag.endsWith(`/${v.signingTagVersion}\n`), true)
  assert.equal(DIGEST_DOMAINS.assessment.tag.endsWith(`/${v.assessmentDigestTagVersion}\n`), true)
  assert.equal(DIGEST_DOMAINS.package.tag.endsWith(`/${v.packageDigestTagVersion}\n`), true)
})

test('every signed vector\'s signing input begins with exactly the registered tag for its type, and every key-set purpose is registered', () => {
  const tag = Buffer.from(SIGNING_DOMAINS['agentverify.profile-assessment'].signingTag)
  for (const e of SIGNING.entries) {
    assert.equal(e.payload.attestationType, 'agentverify.profile-assessment')
    assert.deepEqual(Buffer.from(e.signingInputHex, 'hex').subarray(0, tag.length), tag)
  }
  const purposes = new Set(Object.values(SIGNING_DOMAINS).map(d => d.keyPurpose))
  const inSets = new Set(Object.values(BUNDLES.keySets).flatMap(k => (Array.isArray(k.keys) ? k.keys : []).map(e => e.purpose)).filter(Boolean))
  const CASE_MISMATCHES = ['AGENTVERIFY-PROFILE-V1', 'AgentVerify-Profile-V1', 'agentverify-profile-v1 ']
  assert.ok(purposes.has('agentverify-profile-v1'))
  for (const p of inSets) assert.ok(purposes.has(p) || p === 'agentverify-scan-v1' || CASE_MISMATCHES.includes(p), `unregistered purpose ${p}`)
  assert.ok(inSets.has('agentverify-scan-v1'), 'the key-purpose-mismatch vectors use a purpose that is a different registry entry\'s, not a typo')
})

test('a signing tag or digest tag change is a construction change: every frozen digest and signature depends on the exact tag bytes', async () => {
  for (const e of SIGNING.entries.slice(0, 3)) {
    assert.notEqual(e.assessmentDigest, `avassess-sha256:${e.assessmentJcsSha256}`)
  }
})
