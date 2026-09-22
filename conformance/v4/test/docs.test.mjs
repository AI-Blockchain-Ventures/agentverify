import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// The design document and the READMEs are part of the contract: the second review found stale wording that contradicted the vectors, and a
// signing boundary that existed only as intent. These tests keep the prose, the reference and the product paths from drifting apart.

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.join(here, '..', '..', '..')
const read = (...p) => readFileSync(path.join(repo, ...p), 'utf8')
const DESIGN = read('docs', 'attestation-profile-design.md')
const README4 = read('conformance', 'v4', 'README.md')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const walk = dir => readdirSync(dir).flatMap(e => { const p = path.join(dir, e); return statSync(p).isDirectory() ? (['node_modules', 'dist', '.next', '.git'].includes(e) ? [] : walk(p)) : [p] })

test('WORDING: no stale claim survives: retired keys are not "trusted", there is no "key trust" result, nothing says a signature predates a retirement', () => {
  for (const [name, text] of [['design doc', DESIGN], ['v4 README', README4]]) {
    assert.doesNotMatch(text, /retired keys? (stay|remain)s? trusted/i, `${name}: "retired keys stay trusted"`)
    assert.doesNotMatch(text, /Key trust result/, `${name}: "Key trust result"`)
    assert.doesNotMatch(text, /key-trust\s+result/i, `${name}: "key-trust result"`)
    assert.doesNotMatch(text, /signed before (its |the )?(key'?s? )?retire/i, `${name}: implies signing-before-retirement`)
    assert.doesNotMatch(text, /signing before retirement/i, `${name}`)
    assert.doesNotMatch(text, /TRUSTED_RETIRED|keyTrust/, `${name}: a TRUSTED key state`)
  }
  assert.doesNotMatch(DESIGN, /\| D8 \|[^\n]*key trust/i, 'D8 no longer says "key trust"')
  assert.match(DESIGN, /\| D8 \| Verification result \| Integrity, key state, interpretation and policy reported separately \|/)
  assert.match(DESIGN, /\| Situation \| Integrity \| Key state \|/)
})

test('WORDING: notBefore, retiredAt and revokedAt are metadata in v1; only a verifier policy with a TRUSTED time source could use them', () => {
  assert.match(DESIGN, /`notBefore`, `retiredAt` and `revokedAt` are METADATA in v1/)
  assert.match(DESIGN, /no verifier result or policy in v1 uses them/)
  assert.match(README4, /METADATA in v1/)
  assert.match(README4, /never compared with `issuedAt` or any clock/)
})

test('RETAINED SEQUENCE: the caller requirements are documented (trusted channel only, never a presented key set, scope by source and issuer, detection not freshness)', () => {
  for (const [name, text] of [['design doc', DESIGN], ['v4 README', README4]]) {
    assert.match(text, /AUTHENTICATED, TRUSTED key-set distribution channel/, name)
    assert.match(text, /presented inside or alongside a bundle/, name)
    assert.match(text, /unsigned,? presented key set into persistent trusted state/, name)
    assert.match(text, /(TRUSTED SOURCE|trusted source) (AND|and) issuer/, name)
    assert.match(text, /NO_RETAINED_STATE/, name)
  }
  assert.match(README4, /rollback DETECTION support[\s\S]*not rollback PROTECTION/)
  assert.match(README4, /RETAINS the\s+highest sequence it accepted for that issuer/)
  assert.match(README4, /ISSUER-SCOPED/)
  assert.match(README4, /NOT "current" and NOT "fresh"/)
  const src = read('conformance', 'v4', 'reference', 'profileAttestation.mjs')
  assert.match(src, /WHAT THE CALLER MUST DO/)
  assert.match(src, /NEVER\s+(\*\s+)?from a key set presented inside or alongside a bundle/)
})

test('SIGNING BOUNDARY: the normative contract is written down, and lists every rule the review required', () => {
  const at = DESIGN.indexOf('### 10.1 The product signing boundary (NORMATIVE')
  assert.ok(at > 0, 'the section exists')
  const section = DESIGN.slice(at, DESIGN.indexOf('## 11.', at))
  for (const need of [
    /`workspaceId`[\s\S]{0,120}authenticated server-side workspace context[\s\S]{0,80}Never a request field/,
    /`issuer`[\s\S]{0,60}Server-side configuration/,
    /`keyId`[\s\S]{0,60}PUBLIC key of the private key actually used/,
    /`issuedAt`[\s\S]{0,60}signing service's own clock/,
    /CLOSED profile registry/,
    /`profileVersion`[\s\S]{0,60}registry/,
    /Constants of the registry/,
    /`package.digest`[\s\S]{0,80}Computed from the package actually assessed/,
    /`assessment.digest`[\s\S]{0,80}Computed from the assessment actually being attested/,
    /refuse to sign with a key whose declared purpose is not the profile-attestation purpose/,
    /before any private-key operation/,
    /never signed/,
    /No request-controlled override/,
    /issuer, keyId, issuedAt, workspaceId, profile version, signing domain or algorithm/,
    /Worker's unsigned `profile` route remains transparent and unsigned/,
  ]) assert.match(section, need, String(need))
  assert.match(README4, /NORMATIVE; not implemented/)
})

test('THE SIGNING GATE: no signing or private-key handling exists in the reference or in any product path', () => {
  // The reference is verification-only.
  const refDir = path.join(here, '..', 'reference')
  for (const f of readdirSync(refDir)) {
    const src = strip(readFileSync(path.join(refDir, f), 'utf8'))
    assert.doesNotMatch(src, /subtle\.sign|\.sign\(|generateKey|privateKey|pkcs8|createSign|createPrivateKey|ATTESTATION_SIGNING/i, `reference/${f} must contain no signing or private-key code`)
    assert.doesNotMatch(src, /\[\s*'sign'\s*\]|'sign'/, `reference/${f} must not request the sign usage`)
  }
  // No product path mentions the profile-assessment attestation's type, tag or key purpose: none of it is implemented there.
  const forbidden = /agentverify\.profile-assessment|agentverify-attestation\/profile-assessment|agentverify-profile-v1|PROFILE_KEY_PURPOSE|avassess-sha256/
  for (const dir of [['workers', 'api', 'src'], ['packages', 'cli', 'src'], ['packages', 'scanner', 'src'], ['apps', 'web', 'src']]) {
    const full = path.join(repo, ...dir)
    let files
    try { files = walk(full) } catch { continue } // the private scanner is absent in public CI
    for (const f of files.filter(x => /\.(ts|tsx|mjs|js)$/.test(x))) assert.doesNotMatch(readFileSync(f, 'utf8'), forbidden, `${path.relative(repo, f)} must not implement the profile attestation`)
  }
})

test('THE WORKER PROFILE ROUTE stays a transparent, unsigned pass-through (attestation is null and nothing is saved)', () => {
  const dir = path.join(repo, 'workers', 'api', 'src')
  const profiles = readFileSync(path.join(dir, 'profiles.ts'), 'utf8')
  assert.match(profiles, /attestation: null/)
  assert.match(profiles, /saved: false/)
})

test('the v4 README lists what changed externally from v3, and says v3 is frozen and untouched', () => {
  assert.match(README4, /Vector set v3 is frozen and untouched/)
  assert.match(README4, /Externally observable changes from v3/)
  // v4's own delta (it deliberately does not repeat the full v2->v3 table; see conformance/v3/README.md for that history).
  for (const row of ['PROFILE_DEFINITION_MISMATCH', 'INVALID_ASSESSMENT', 'INVALID_POLICY', 'jwk.coordinate-range', 'evidence-unaccounted', 'evidence-mapping-conflict']) assert.ok(README4.includes(row), row)
})

// ── The three v4 blockers, from the third independent review ──────────────────────────────────

test("BLOCKER 1 (EVIDENCE ACCOUNTING): allEvidenceIds === referenced UNION unmapped, and the two are disjoint, is documented and implemented, not just tested", () => {
  const src = read('conformance', 'v4', 'reference', 'assessmentSchema.mjs')
  assert.match(src, /referencedEvidenceIds/)
  assert.match(src, /assessment\.schema\.evidence-mapping-conflict/)
  assert.match(src, /assessment\.schema\.evidence-unaccounted/)
  assert.match(src, /Many-to-many/i, 'many-to-many references remain valid, stated explicitly')
  for (const [name, text] of [['design doc', DESIGN], ['v4 README', README4]]) {
    assert.match(text, /referenced by (a|at least one) check|referenced by at least one check/i, name)
  }
})

test('BLOCKER 2 (KEY-SET SEQUENCE DISCIPLINE): the design doc states MUST-level requirements for the publisher, distinct from the reference verifier\'s own (caller-side) rules', () => {
  const at = DESIGN.indexOf('### 10.1 The product signing boundary')
  assert.ok(at > 0)
  const boundary = DESIGN.slice(at, DESIGN.indexOf('## 11.', at))
  for (const need of [
    /monotonic per trusted (key-set )?source (\+|and|plus) issuer/i,
    /one authoritative serialized source of truth/i,
    /never emit a lower sequence/i,
    /key rotation must not reset sequence/i,
    /redeploy[\s\S]{0,20}restart must not reset sequence|restart must not reset sequence/i,
    /regional failover must not allocate sequence independently/i,
    /retained verifier state may only be advanced from an authenticated[\s\S]{0,40}trusted key-set distribution channel/i,
    /arbitrary bundle-adjacent[\s\S]{0,40}presented key sets must never advance retained state/i,
    /rollback-detection support, not freshness proof/i,
    /deployment infrastructure work/i,
  ]) assert.match(boundary, need, String(need))
})

test('BLOCKER 3 (ADMISSION-TO-SIGNING IDENTITY): the design doc states the admitted object and the signed object must be identical, with no regeneration step named explicitly', () => {
  const at = DESIGN.indexOf('### 10.1 The product signing boundary')
  const boundary = DESIGN.slice(at, DESIGN.indexOf('## 11.', at))
  assert.match(boundary, /exact assessment object admitted by `admitAssessment`\s+MUST be the exact assessment object/)
  for (const forbidden of ['regeneration', 'rescanning', 'reconstruction', 'semantic normalization', 'mutation', 'field insertion', 'removal', 'reordering of semantically ordered arrays', 'second independently-built assessment']) {
    assert.ok(boundary.toLowerCase().includes(forbidden.toLowerCase()), forbidden)
  }
  assert.match(boundary, /admission produces or retains the canonical assessment bytes\/digest that the signing operation consumes directly/)
  assert.match(boundary, /must not admit object A and then sign reconstructed object B/)
})

test('CONSUMER RULE: the integrity-and-interpretation rule is stated verbatim, where a consumer will find it', () => {
  const rule = "A consumer may render, count, or act on an assessment only when integrity === 'VALID' AND interpretation === 'SUPPORTED'. Neither one alone is sufficient."
  assert.ok(DESIGN.includes(rule), 'design doc carries the exact consumer rule sentence')
  assert.ok(README4.includes(rule), 'v4 README carries the exact consumer rule sentence')
})
