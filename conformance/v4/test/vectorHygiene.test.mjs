import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { VECTOR_DIR, loadVector } from './helpers.mjs'

// The vectors are public, frozen and shared with third parties. These checks make sure they stay safe to publish and
// that nobody edits or regenerates them by accident.

const here = path.dirname(fileURLToPath(import.meta.url))
const files = readdirSync(VECTOR_DIR).filter(f => f.endsWith('.json') && f !== 'manifest.v4.json').sort()
const text = f => readFileSync(path.join(VECTOR_DIR, f), 'utf8')

test('the manifest lists exactly the vector files, with their current SHA-256: any edit or regeneration is visible', () => {
  const manifest = loadVector('manifest.v4.json')
  assert.deepEqual(Object.keys(manifest.files).sort(), files)
  for (const f of files) assert.equal(createHash('sha256').update(readFileSync(path.join(VECTOR_DIR, f))).digest('hex'), manifest.files[f], `${f} changed since the manifest was written`)
})

test('no private key material: every member named "d" is the obvious placeholder, and no PEM or PKCS#8 marker exists', () => {
  const found = []
  const walk = (v, where) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${where}[${i}]`))
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === 'd') found.push([where, x]); walk(x, `${where}.${k}`) }
  }
  for (const f of files) walk(JSON.parse(text(f)), f)
  assert.ok(found.length >= 2, 'the negative vectors that carry a fake "d" as a member are present (key set and key checks)')
  const patched = loadVector('bundles.v4.json').cases.filter(c => (c.source.patch ?? []).some(op => op.path.endsWith('/d')))
  assert.ok(patched.length >= 1, 'and the bundle case that adds one by patch')
  for (const c of patched) for (const op of c.source.patch.filter(o => o.path.endsWith('/d'))) assert.equal(op.value, 'A'.repeat(43), c.name)
  for (const [where, value] of found) assert.equal(value, 'A'.repeat(43), `${where}: a "d" value that is not the placeholder could be real private key material`)
  for (const f of files) assert.doesNotMatch(text(f), /-----BEGIN|PRIVATE KEY|"pkcs8"|ATTESTATION_SIGNING_PRIVATE_KEY/, f)
})

test('every embedded public key is exactly a P-256 public JWK', () => {
  const bundles = loadVector('bundles.v4.json')
  for (const [name, k] of Object.entries(bundles.publicKeys)) assert.deepEqual(Object.keys(k.jwk).sort(), ['crv', 'kty', 'x', 'y'], name)
  for (const [name, s] of Object.entries(bundles.signed)) {
    const k = s.bundle.attestation.publicKey
    assert.deepEqual(Object.keys(k).sort(), ['crv', 'kty', 'x', 'y'], name)
  }
})

test('every identifier is a throwaway: the issuer is the conformance issuer, never a real Agent Verify environment', () => {
  for (const f of files) {
    const t = text(f)
    assert.doesNotMatch(t, /agentverify-prod|agentverify-dev/, `${f}: a real issuer name`)
    assert.doesNotMatch(t, /sk_live|sk_test|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|xox[bp]-|eyJ[A-Za-z0-9_-]{20,}\./, `${f}: something that looks like a credential`)
  }
  const bundles = loadVector('bundles.v4.json')
  assert.equal(bundles.constants.issuer, 'agentverify-conformance')
  // Issuers used by the vectors: the conformance issuer, a second obviously-fake namespace (issuer-scoping vectors), and a prototype-member name (own-key lookup vectors).
  const ISSUERS = new Set(['agentverify-conformance', 'agentverify-conformance-other', 'agentverify-other', 'constructor'])
  for (const s of Object.values(bundles.signed)) assert.ok(ISSUERS.has(s.bundle.attestation.payload.issuer) || /^agentverify-conformance/.test(s.bundle.attestation.payload.issuer), s.bundle.attestation.payload.issuer)
  // (Two negative key sets carry an empty and a numeric issuer on purpose.)
  for (const ks of Object.values(bundles.keySets)) assert.ok(ISSUERS.has(ks.issuer) || ks.issuer === '' || typeof ks.issuer === 'number', String(ks.issuer))
})

test('every vector file says it is synthetic and must not be treated as a real key', () => {
  for (const f of files) assert.match(loadVector(f).note ?? '', /synthetic|frozen scan attestations|CONFORMANCE VECTOR/i, f)
})

test('the throwaway keys are all different, and none is reused between the legacy and profile vectors', () => {
  const bundles = loadVector('bundles.v4.json'), legacy = loadVector('legacy-attestation.v4.json')
  const xs = [...Object.values(bundles.publicKeys).map(k => k.jwk.x), ...Object.values(legacy.publicKeys).map(k => k.x)]
  assert.equal(new Set(xs).size, xs.length)
})

test('vector files are reasonably sized and are plain, valid JSON with no duplicate keys', async () => {
  const { parseStrictJson } = await import('../reference/strictJson.mjs')
  for (const f of files) {
    assert.ok(statSync(path.join(VECTOR_DIR, f)).size < 2 * 1024 * 1024, `${f} is over 2 MiB`)
    // The deep-nesting vectors (a signed assessment at absolute depth 64) sit several levels down inside a vector file, so the FILE nests past 64.
    // The strict parser is used here only for its duplicate-key and syntax checks, with the depth allowance widened by baseDepth. A loader of
    // these files must not apply the 64-level verifier limit to the vector file itself (the README says so).
    assert.doesNotThrow(() => parseStrictJson(text(f), { baseDepth: -8, numbers: 'ieee' }), f)
  }
})

test('the README exists and states the rules for changing vectors', () => {
  const readme = readFileSync(path.join(here, '..', 'README.md'), 'utf8')
  for (const phrase of ['frozen', 'throwaway', 'reference', 'not the product implementation']) assert.match(readme, new RegExp(phrase, 'i'), phrase)
})

test('the generator refuses to run without an explicit flag, so a stray invocation cannot replace the vectors', async () => {
  const { spawnSync } = await import('node:child_process')
  const r = spawnSync(process.execPath, [path.join(here, '..', 'tools', 'generate-vectors.mjs')], { encoding: 'utf8' })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /frozen/i)
  const r2 = spawnSync(process.execPath, [path.join(here, '..', 'tools', 'generate-vectors.mjs'), '--new-vector-set'], { encoding: 'utf8' })
  assert.equal(r2.status, 2, 'an existing vector set is not overwritten without --overwrite')
  assert.match(r2.stderr, /overwrite/i)
})

test('no file under conformance/ (nor the conformance tests elsewhere) contains a raw invisible or bidirectional character: they are all written as escapes', () => {
  const isHidden = n => (n < 32 && n !== 10 && n !== 9 && n !== 13) || (n >= 0x7f && n <= 0xa0) || n === 0xad || n === 0x61c || (n >= 0x200b && n <= 0x200f) || (n >= 0x2028 && n <= 0x202e) || (n >= 0x2060 && n <= 0x2064) || (n >= 0x2066 && n <= 0x206f) || n === 0xfeff || (n >= 0xfff9 && n <= 0xfffb) || (n >= 0xe0000 && n <= 0xe01ef)
  const walk = dir => readdirSync(dir).flatMap(e => { const p = path.join(dir, e); return statSync(p).isDirectory() ? walk(p) : [p] })
  const all = [...walk(path.join(here, '..')), path.join(here, '..', '..', '..', 'apps', 'web', 'test', 'conformanceLegacy.test.mjs')]
  assert.ok(all.length >= 15)
  for (const f of all) {
    const bad = []
    let lineNo = 1
    for (const ch of readFileSync(f, 'utf8')) { const n = ch.codePointAt(0); if (n === 10) lineNo++; else if (isHidden(n) || (n >= 0xd800 && n <= 0xdfff)) bad.push(`U+${n.toString(16).toUpperCase().padStart(4, '0')} on line ${lineNo}`) }
    assert.deepEqual(bad, [], `${path.relative(path.join(here, '..', '..'), f)} contains raw invisible characters`)
  }
})
