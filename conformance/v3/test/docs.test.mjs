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
const README3 = read('conformance', 'v3', 'README.md')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const walk = dir => readdirSync(dir).flatMap(e => { const p = path.join(dir, e); return statSync(p).isDirectory() ? (['node_modules', 'dist', '.next', '.git'].includes(e) ? [] : walk(p)) : [p] })

test('WORDING: no stale claim survives: retired keys are not "trusted", there is no "key trust" result, nothing says a signature predates a retirement', () => {
  for (const [name, text] of [['design doc', DESIGN], ['v3 README', README3]]) {
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
  assert.match(README3, /METADATA in v1/)
  assert.match(README3, /never compared with `issuedAt` or any clock/)
})

test('RETAINED SEQUENCE: the caller requirements are documented (trusted channel only, never a presented key set, scope by source and issuer, detection not freshness)', () => {
  for (const [name, text] of [['design doc', DESIGN], ['v3 README', README3]]) {
    assert.match(text, /AUTHENTICATED, TRUSTED key-set distribution channel/, name)
    assert.match(text, /presented inside or alongside a bundle/, name)
    assert.match(text, /unsigned,? presented key set into persistent trusted state/, name)
    assert.match(text, /(TRUSTED SOURCE|trusted source) (AND|and) issuer/, name)
    assert.match(text, /NO_RETAINED_STATE/, name)
  }
  assert.match(README3, /rollback DETECTION support[\s\S]*not rollback PROTECTION/)
  assert.match(README3, /RETAINS the\s+highest sequence it accepted for that issuer/)
  assert.match(README3, /ISSUER-SCOPED/)
  assert.match(README3, /NOT "current" and NOT "fresh"/)
  const src = read('conformance', 'v3', 'reference', 'profileAttestation.mjs')
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
  assert.match(README3, /NORMATIVE; not implemented/)
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

test('the v3 README lists what changed externally from v2, and says v2 is frozen and untouched', () => {
  assert.match(README3, /Vector set v2 is frozen and untouched/)
  assert.match(README3, /Externally observable changes from v2/)
  for (const row of ['PROFILE_DEFINITION_MISMATCH', 'INVALID_ASSESSMENT', 'INVALID_POLICY', 'bundle.bare-typed-attestation', 'verifyProfileBundleBytes', 'jwk.coordinate-range', 'keySet.keys']) assert.ok(README3.includes(row), row)
})
