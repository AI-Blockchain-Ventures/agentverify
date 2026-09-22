import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { canonicalizeSigned } from '../reference/jcs.mjs'
import * as ref from '../reference/profileAttestation.mjs'
import { applyPatch, assertSubset, caseOptions, loadVector, resolveSource, toInputBytes } from './helpers.mjs'

const BUNDLES = loadVector('bundles.v3.json')
const SIGNING = loadVector('signing.v3.json')
const DIGESTS = loadVector('assessment-digest.v3.json')
const KEYIDS = loadVector('keyid.v3.json')
const AVPKG = loadVector('avpkg.v3.json')
const LEGACY = loadVector('legacy-attestation.v3.json')

const here = path.dirname(fileURLToPath(import.meta.url))
/** Every verification goes through the NORMATIVE entry point: bytes. An object or string is first turned into the UTF-8 bytes a real caller would hold. */
const verify = (input, options) => ref.verifyProfileBundleBytes(toInputBytes(input), options)
const subtle = globalThis.crypto.subtle
const sha256Hex = data => createHash('sha256').update(data).digest('hex')
const signedBundle = name => structuredClone(BUNDLES.signed[name].bundle)
const s256 = b64 => BigInt(`0x${Buffer.from(b64, 'base64').subarray(32).toString('hex')}`)

// ── Exact bytes ──────────────────────────────────────────────────────────────────────────────

test('signing input: the registered domain tag, then the JCS payload, byte for byte', () => {
  assert.ok(SIGNING.entries.length >= 10)
  const tag = Buffer.from(ref.PAYLOAD_TAG, 'utf8')
  assert.equal(ref.PAYLOAD_TAG, 'agentverify-attestation/profile-assessment/v1\n')
  for (const e of SIGNING.entries) {
    assert.equal(canonicalizeSigned(e.payload), e.payloadJcs, e.name)
    const input = ref.signingInput(e.payload)
    assert.equal(Buffer.from(input).toString('hex'), e.signingInputHex, e.name)
    assert.equal(sha256Hex(input), e.signingInputSha256, e.name)
    assert.deepEqual(Buffer.from(input).subarray(0, tag.length), tag, `${e.name}: starts with the tag`)
    assert.equal(Buffer.from(input).subarray(tag.length).toString('utf8'), e.payloadJcs, `${e.name}: the rest is the JCS payload`)
    assert.notEqual(Buffer.from(input)[0], 0x7b, `${e.name}: the tagged input never starts with "{" the way a legacy input does`)
    assert.ok(!('bundleVersion' in e.payload), `${e.name}: bundleVersion is unsigned framing, not part of the payload`)
  }
})

test('signatures: every frozen signature is LOW-S, verifies over the tagged input with the embedded key, and only over that input', async () => {
  for (const e of SIGNING.entries) {
    assert.equal(e.lowS, true, e.name)
    assert.ok(s256(e.signature) <= ref.P256_HALF_ORDER, `${e.name}: s <= floor(n/2)`)
    assert.equal(ref.signatureProblem(new Uint8Array(Buffer.from(e.signature, 'base64'))), null, e.name)
    const key = await subtle.importKey('jwk', e.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    const signature = Buffer.from(e.signature, 'base64')
    assert.equal(signature.length, 64, `${e.name}: raw r||s`)
    const verifies = data => subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, data)
    assert.equal(await verifies(ref.signingInput(e.payload)), true, e.name)
    assert.equal(await verifies(new TextEncoder().encode(e.payloadJcs)), false, `${e.name}: untagged input`)
    assert.equal(await verifies(new TextEncoder().encode(`agentverify-attestation/profile-assessment/v2\n${e.payloadJcs}`)), false, `${e.name}: wrong tag version`)
    assert.equal(e.keyId, await ref.keyIdOf(e.publicKey), `${e.name}: keyId is the thumbprint of the embedded key`)
  }
})

test('assessment digest: the frozen digests, and what does and does not change them', async () => {
  const by = Object.fromEntries(DIGESTS.cases.map(c => [c.name, c]))
  for (const c of DIGESTS.cases) {
    assert.equal(canonicalizeSigned(c.assessment), c.canonical, c.name)
    assert.equal(await ref.assessmentDigest(c.assessment), c.digest, c.name)
    assert.match(c.digest, /^avassess-sha256:[0-9a-f]{64}$/)
    assert.notEqual(c.digest, `avassess-sha256:${c.canonicalSha256}`, `${c.name}: the domain tag makes it differ from a plain hash of the JCS text`)
  }
  assert.equal(by['key-order-independent-a'].digest, by['key-order-independent-b'].digest, 'object key order does not change the digest')
  assert.notEqual(by['array-order-matters-a'].digest, by['array-order-matters-b'].digest, 'array order DOES change the digest')
  assert.notEqual(by['nfc-string'].digest, by['nfd-string'].digest, 'canonically equivalent Unicode is NOT normalized: different digests')
  assert.notEqual(by['synthetic-assessment-base'].digest, by['synthetic-assessment-other'].digest)
})

test('assessment digest: numbers outside the signed-content profile cannot be digested at all', async () => {
  for (const bad of [{ a: 0.5 }, { a: -0 }, { a: 2 ** 60 }, { a: 1e21 }]) await assert.rejects(() => ref.assessmentDigest(bad), e => e.code === 'JCS_NUMBER_NOT_ADMITTED')
})

test('assessment digest: nothing but the JCS bytes and the tag feed it', async () => {
  const base = SIGNING.entries.find(e => e.name === 'B1')
  assert.equal(base.assessmentDigest, await ref.assessmentDigest(signedBundle('B1').assessment))
  assert.notEqual(base.assessmentDigest.slice('avassess-sha256:'.length), base.assessmentJcsSha256)
})

// ── keyId (RFC 7638) and canonical coordinates ───────────────────────────────────────────────

test('keyId: RFC 7638 thumbprints, including the RFC\'s own published example; use, kid, ext, key_ops and purpose never affect it', async () => {
  for (const t of KEYIDS.thumbprints) assert.equal(await ref.rfc7638Thumbprint(t.jwk), t.thumbprint, t.name)
  assert.equal(KEYIDS.thumbprints.find(t => t.source === 'RFC 7638 3.1').thumbprint, 'NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs')
  const base = KEYIDS.thumbprints.find(t => t.name === 'throwaway profile key')
  for (const t of KEYIDS.thumbprints.filter(x => /extra members|purpose is not a JWK/.test(x.name))) assert.equal(t.thumbprint, base.thumbprint, t.name)
})

test('keyId: recomputed by a second, structurally different method (hand-built string + node:crypto)', () => {
  for (const t of KEYIDS.thumbprints.filter(x => x.jwk.kty === 'EC')) {
    const manual = `{"crv":"${t.jwk.crv}","kty":"EC","x":"${t.jwk.x}","y":"${t.jwk.y}"}`
    assert.equal(createHash('sha256').update(manual, 'utf8').digest('base64url'), t.thumbprint, t.name)
    assert.match(t.thumbprint, /^[A-Za-z0-9_-]{43}$/)
  }
})

test('public key checks: exactly {kty, crv, x, y} with CANONICAL coordinates; everything else is refused', () => {
  for (const c of KEYIDS.jwkChecks) assertSubset(assert, ref.checkP256PublicJwk(c.jwk), c.expected, c.name)
})

test('ONE PUBLIC KEY, ONE keyId: a non-canonical spelling of the same point is refused everywhere, so it can never mint a second keyId', async () => {
  const a = KEYIDS.aliasing
  assert.equal(a.sameBytes, true, 'the two spellings decode to the same 32 bytes')
  assert.equal(a.differentThumbprints, true, 'and would hash to different thumbprints')
  assert.equal(ref.checkP256PublicJwk(a.canonical).ok, true)
  assert.equal(ref.checkP256PublicJwk(a.alias).ok, false)
  // Every possible last character of every coordinate of the throwaway keys. A character whose two low bits are set is a NON-CANONICAL spelling of the same bytes and must be
  // refused; a character whose low bits are zero spells DIFFERENT bytes (a different point), which is canonical and is judged on the curve later, not here.
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  for (const k of Object.values(BUNDLES.publicKeys)) for (const coordinate of ['x', 'y']) {
    for (const ch of ALPHABET) {
      const spelled = { ...k.jwk, [coordinate]: `${k.jwk[coordinate].slice(0, 42)}${ch}` }
      const sameBytes = Buffer.from(spelled[coordinate], 'base64url').equals(Buffer.from(k.jwk[coordinate], 'base64url'))
      assert.equal(ref.checkP256PublicJwk(spelled).ok, ALPHABET.indexOf(ch) % 4 === 0, `${coordinate} ending in ${ch}`)
      if (sameBytes && ch !== k.jwk[coordinate][42]) assert.equal(ref.checkP256PublicJwk(spelled).ok, false, `a second spelling of the same bytes (${ch}) is refused`)
    }
  }
  assert.equal(ref.isCanonicalCoordinate('A'.repeat(43)), true)
  assert.equal(ref.isCanonicalCoordinate(`${'A'.repeat(42)}B`), false)
})

// ── Package identity (avpkg-sha256) ──────────────────────────────────────────────────────────

test('package identity: frozen preimages and digests', async () => {
  for (const c of AVPKG.cases) {
    assert.equal(Buffer.from(ref.packagePreimage(c.files)).toString('hex'), c.preimageHex, c.name)
    assert.equal(await ref.packageDigest(c.files), c.digest, c.name)
    assert.match(c.digest, /^avpkg-sha256:[0-9a-f]{64}$/)
    assert.ok(Buffer.from(c.preimageHex, 'hex').toString('utf8').startsWith('agentverify-skill-package-digest/v1\n'), `${c.name}: scheme tag`)
  }
})

test('package identity: submission order does not matter, but the byte-order sort is essential', async () => {
  for (const c of AVPKG.cases.filter(x => x.files.length > 1)) assert.equal(await ref.packageDigest([...c.files].reverse()), c.digest, `${c.name}: reversed submission order`)
  const c = AVPKG.cases.find(x => x.name === 'byte-order-not-code-unit-order')
  const naive = [...c.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const enc = new TextEncoder()
  let out = enc.encode('agentverify-skill-package-digest/v1\n')
  for (const f of naive) { const p = enc.encode(f.path), body = enc.encode(f.content); out = ref.concat(ref.concat(ref.concat(ref.concat(ref.concat(out, enc.encode(`${p.length}:`)), p), enc.encode(`\n${body.length}:`)), body), enc.encode('\n')) }
  assert.notEqual(`avpkg-sha256:${sha256Hex(out)}`, c.digest, 'sorting by UTF-16 code units gives a different digest than sorting by UTF-8 bytes')
})

test('package identity: lengths are BYTE counts, the encoding is unambiguous, and NFC/NFD are never normalized', () => {
  assert.match(Buffer.from(AVPKG.cases.find(x => x.name === 'multibyte-content-length').preimageHex, 'hex').toString('utf8'), /\n11:/)
  const by = Object.fromEntries(AVPKG.cases.map(c => [c.name, c]))
  assert.notEqual(by['length-prefix-single'].digest, by['length-prefix-double'].digest)
  assert.notEqual(by['nfc-path'].digest, by['nfd-path'].digest)
})

test('package identity: the package inside the synthetic bundles is the one whose digest they state', async () => {
  const pkg = BUNDLES.packages.synthetic
  assert.equal(await ref.packageDigest(pkg.files), pkg.digest)
  assert.equal(signedBundle('B1').assessment.package.digest, pkg.digest)
  assert.equal(signedBundle('B1').attestation.payload.package.digest, pkg.digest)
  for (const f of pkg.files) assert.equal(f.path, f.path.normalize('NFC'), `${f.path} is NFC`)
})

// ── The bundle cases (every expected result was predicted by hand, then confirmed against this reference) ──

const runCase = c => verify(resolveSource(BUNDLES, c.source), caseOptions(BUNDLES, c))

test('every bundle case produces exactly its frozen result', async () => {
  assert.ok(BUNDLES.cases.length >= 240, `only ${BUNDLES.cases.length} cases`)
  for (const c of BUNDLES.cases) assertSubset(assert, await runCase(c), c.expected, c.name)
})

test('case names are unique and every case states an integrity result', () => {
  const names = BUNDLES.cases.map(c => c.name)
  assert.equal(new Set(names).size, names.length)
  for (const c of BUNDLES.cases) assert.ok(c.expected.integrity, c.name)
})

test('coverage: every result a verifier can report appears in at least one vector', () => {
  const integrity = new Set(BUNDLES.cases.map(c => c.expected.integrity))
  for (const s of ['VALID', 'MALFORMED', 'UNSUPPORTED_BUNDLE_VERSION', 'UNSUPPORTED_TYPE', 'UNSUPPORTED_VERSION', 'UNSUPPORTED_ALGORITHM', 'INVALID_SIGNATURE', 'BINDING_MISMATCH']) assert.ok(integrity.has(s), `integrity ${s}`)
  const state = new Set(BUNDLES.cases.map(c => c.expected.keyState).filter(Boolean))
  for (const s of ['KEY_ACTIVE', 'KEY_RETIRED', 'KEY_REVOKED', 'KEY_UNKNOWN', 'KEY_PURPOSE_MISMATCH', 'KEY_SET_INVALID', 'KEY_SET_ROLLBACK_DETECTED', 'NOT_EVALUATED']) assert.ok(state.has(s), `keyState ${s}`)
  const interp = new Set(BUNDLES.cases.map(c => c.expected.interpretation).filter(Boolean))
  assert.deepEqual([...interp].sort(), ['INVALID_ASSESSMENT', 'PROFILE_DEFINITION_MISMATCH', 'SUPPORTED', 'UNSUPPORTED_PROFILE', 'UNSUPPORTED_PROFILE_VERSION', 'UNSUPPORTED_SCHEMA'])
  const checks = new Set(BUNDLES.cases.map(c => c.expected.keySetSequenceCheck).filter(Boolean))
  assert.deepEqual([...checks].sort(), ['BEHIND_RETAINED', 'NOT_BEHIND_RETAINED', 'NO_RETAINED_STATE'])
  const policy = new Set(BUNDLES.cases.map(c => c.expected.policy?.status).filter(Boolean))
  assert.deepEqual([...policy].sort(), ['INVALID_POLICY', 'NOT_SATISFIED', 'SATISFIED'])
})

test('there is no TRUSTED key state anywhere: not in the reference, not in any vector', () => {
  const refSrc = readFileSync(path.join(here, '..', 'reference', 'profileAttestation.mjs'), 'utf8')
  assert.doesNotMatch(refSrc.replace(/^\s*\/\/.*$/gm, ''), /'TRUSTED|TRUSTED_RETIRED|keyTrust/)
  const vector = JSON.parse(readFileSync(path.join(here, '..', 'vectors', 'bundles.v3.json'), 'utf8'))
  const namesTrusted = vector.cases.filter(c => JSON.stringify(c.policy ?? null).includes('TRUSTED'))
  assert.deepEqual(namesTrusted.map(c => c.name).sort(), ['policy.accepted-key-states.invalid.unknown-state', 'policy.invalid-unknown-state'], 'only vectors that prove TRUSTED is NOT a valid state may name it')
  for (const c of namesTrusted) assert.equal(c.expected.policy.status, 'INVALID_POLICY')
  assert.doesNotMatch(JSON.stringify({ ...vector, cases: vector.cases.filter(c => !namesTrusted.includes(c) && c.name !== 'key-state.no-key-set') }), /"keyTrust"|TRUSTED/)
})

// ── THE CROSS-CHECK REGISTRY: one-to-one coverage ────────────────────────────────────────────

test('CROSS-CHECK REGISTRY: exported by the reference, frozen in the vectors, and every entry has a "signer lied" vector', () => {
  const registry = ref.CROSS_CHECKS.map(c => c.binding)
  assert.ok(registry.length >= 15)
  assert.equal(new Set(registry).size, registry.length)
  assert.deepEqual(BUNDLES.crossChecks.map(c => c.binding), registry, 'the frozen list is exactly the reference registry, in order')
  assert.deepEqual(BUNDLES.crossChecks, ref.CROSS_CHECKS.map(({ binding, payloadField, assessmentPath, runsWhen }) => ({ binding, payloadField, assessmentPath, runsWhen })))
  const lied = BUNDLES.cases.filter(c => c.name.startsWith('binding.signer-lied.'))
  for (const binding of registry) assert.ok(lied.some(c => c.expected.binding === binding), `no signer-lied vector for cross-check ${binding}`)
  for (const c of lied) assert.ok(registry.includes(c.expected.binding), `${c.name} names a binding that is not in the registry`)
  // Each vector is attributable to exactly one entry: its name ends with the binding it exercises.
  for (const c of lied) assert.ok(c.name.slice('binding.signer-lied.'.length).startsWith(c.expected.binding), `${c.name} is named for ${c.expected.binding}`)
  assert.ok(registry.includes('profileId'), 'the profile id is a cross-check now that the assessment carries it')
  assert.equal(ref.DIGEST_BINDING, 'assessment.digest')
})

test('coverage: every field of the signed payload has a post-signing tamper vector', () => {
  const leaves = (v, prefix = '') => Object.entries(v).flatMap(([k, x]) => (x && typeof x === 'object' && !Array.isArray(x) ? leaves(x, `${prefix}${k}.`) : [`${prefix}${k}`]))
  const covered = new Set(BUNDLES.cases.filter(c => c.name.startsWith('tamper.payload.')).map(c => c.name.slice('tamper.payload.'.length)))
  for (const p of leaves(signedBundle('B2').attestation.payload).filter(x => !['attestationType', 'attestationVersion'].includes(x))) {
    const name = p === 'workspaceId' ? 'workspace.' : p
    assert.ok([...covered].some(c => c === p || c.startsWith(name)), `no tamper vector for payload.${p}`)
  }
  const names = new Set(BUNDLES.cases.map(c => c.name))
  for (const n of ['strict.type-unknown', 'strict.type-null', 'strict.version-1.1.0', 'strict.version-2.0.0', 'malformed.version-missing']) assert.ok(names.has(n), n)
})

// ── Exhaustive mutation matrices, computed here rather than listed in a vector ───────────────

const leafPaths = (value, base = '') => {
  if (Array.isArray(value)) return value.flatMap((v, i) => leafPaths(v, `${base}/${i}`))
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => leafPaths(v, `${base}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`))
  return [base]
}
const mutateLeaf = v => (typeof v === 'string' ? `${v}x` : typeof v === 'number' ? v + 1 : typeof v === 'boolean' ? !v : 'x')
const at = (doc, pointer) => pointer.split('/').slice(1).map(p => p.replace(/~1/g, '/').replace(/~0/g, '~')).reduce((a, k) => a[k], doc)

// FORMAT-PRESERVING mutations of every signed payload field: the mutated payload is still well-formed, so the ONLY thing that can
// stop it is the signature. (The blunt "+x" matrix below cannot prove that for fields it makes malformed.)
const flipLast = s => `${s.slice(0, -1)}${s.at(-1) === '0' ? '1' : '0'}`
const FORMAT_PRESERVING = [
  [/^profile$/, () => 'owasp-agentic-skills-2027'], [/^profileVersion$/, () => '1.0.0-alpha.2'], [/^framework$/, s => `${s}X`],
  [/^upstream\/repo$/, s => `${s}x`], [/^upstream\/commit$/, flipLast], [/^upstream\/license$/, s => `${s}x`],
  [/^implementedControls\/\d+$/, s => `${s}x`], [/^assessmentSchemaVersion$/, () => '9.9.9'], [/^interpretationVersions\/\w+$/, () => '9.9.9'],
  [/^package\/digest$/, flipLast], [/^package\/fileCount$/, n => n + 1], [/^assessment\/digest$/, flipLast],
  [/^workspaceId$/, s => `${s}x`], [/^issuer$/, s => `${s}x`], [/^keyId$/, s => `${s[0] === 'A' ? 'B' : 'A'}${s.slice(1)}`], [/^issuedAt$/, () => '2026-01-15T12:00:01.000Z'],
]
// Decided BEFORE the signature is examined, by design; each has its own status and its own vectors.
const DECIDED_BEFORE_SIGNATURE = { attestationType: 'UNSUPPORTED_TYPE', attestationVersion: 'UNSUPPORTED_VERSION', 'assessment/canonicalization': 'MALFORMED' }

for (const name of ['B1', 'B2']) {
  test(`FORMAT-PRESERVING matrix: every signed payload field of ${name}, changed to another well-formed value, is stopped by the SIGNATURE`, async () => {
    const bundle = signedBundle(name)
    let signatureStops = 0
    for (const leaf of leafPaths(bundle.attestation.payload)) {
      const rel = leaf.slice(1)
      if (rel in DECIDED_BEFORE_SIGNATURE) {
        const mutated = applyPatch(bundle, [{ op: 'replace', path: `/attestation/payload${leaf}`, value: mutateLeaf(at(bundle.attestation.payload, leaf)) }])
        assert.equal((await verify(mutated)).integrity, DECIDED_BEFORE_SIGNATURE[rel], rel)
        continue
      }
      const rule = FORMAT_PRESERVING.find(([re]) => re.test(rel))
      assert.ok(rule, `payload field ${rel} has no format-preserving mutation: add one (a new payload field must be proven signature-covered)`)
      const mutated = applyPatch(bundle, [{ op: 'replace', path: `/attestation/payload${leaf}`, value: rule[1](at(bundle.attestation.payload, leaf)) }])
      const r = await verify(mutated)
      assert.equal(r.integrity, 'INVALID_SIGNATURE', `${rel}: a well-formed change must be caught by the signature, got ${r.integrity} ${r.reasonCode}`)
      signatureStops++
    }
    assert.ok(signatureStops >= 20, `only ${signatureStops} fields`)
  })

  test(`exhaustive: changing ANY single value in ${name} (bundleVersion, payload, signature, key or assessment) is never VALID`, async () => {
    const bundle = signedBundle(name)
    const paths = leafPaths(bundle)
    assert.ok(paths.length > 100)
    for (const p of paths) {
      const mutated = applyPatch(bundle, [{ op: 'replace', path: p, value: mutateLeaf(at(bundle, p)) }])
      const r = await verify(mutated)
      assert.notEqual(r.integrity, 'VALID', `changing ${p} still verified`)
      if (p.startsWith('/assessment/')) assert.equal(r.integrity, 'BINDING_MISMATCH', `changing ${p} must break the assessment digest`)
      if (p === '/bundleVersion') assert.equal(r.integrity, 'UNSUPPORTED_BUNDLE_VERSION')
    }
  })

  test(`exhaustive: removing ANY single member from ${name} is never VALID`, async () => {
    const bundle = signedBundle(name)
    for (const p of leafPaths(bundle)) assert.notEqual((await verify(applyPatch(bundle, [{ op: 'remove', path: p }]))).integrity, 'VALID', `removing ${p} still verified`)
  })

  test(`exhaustive: adding an unknown member to ANY object in ${name} is never VALID`, async () => {
    const bundle = signedBundle(name)
    const objects = []
    const walk = (v, p) => { if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}/${i}`)); else if (v && typeof v === 'object') { objects.push(p); for (const [k, x] of Object.entries(v)) walk(x, `${p}/${k}`) } }
    walk(bundle, '')
    for (const p of objects) assert.notEqual((await verify(applyPatch(bundle, [{ op: 'add', path: `${p}/zzUnknown`, value: 'x' }]))).integrity, 'VALID', `an unknown member at ${p || '(root)'} still verified`)
  })

  test(`exhaustive: swapping any two items of any array in ${name}'s assessment is never VALID (order is signed)`, async () => {
    const bundle = signedBundle(name)
    const arrays = []
    const walk = (v, p) => { if (Array.isArray(v)) { arrays.push([p, v]); v.forEach((x, i) => walk(x, `${p}/${i}`)) } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${p}/${k}`) }
    walk(bundle.assessment, '/assessment')
    let swaps = 0
    for (const [p, arr] of arrays) for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      if (canonicalizeSigned(arr[i]) === canonicalizeSigned(arr[j])) continue
      swaps++
      assert.equal((await verify(applyPatch(bundle, [{ op: 'swap', path: p, i, j }]))).integrity, 'BINDING_MISMATCH', `swapping ${i}<->${j} in ${p} still verified`)
    }
    assert.ok(swaps >= 10, `only ${swaps} swaps were exercised`)
  })
}

test('a valid signature never overrides a failed semantic cross-check, for EVERY registry entry, however the mismatch is introduced', async () => {
  // Re-sign nothing: take each "signer lied" bundle, whose signature and digest are correct, and confirm the verdict is the binding failure.
  for (const b of ref.CROSS_CHECKS.map(c => c.binding)) {
    const c = BUNDLES.cases.find(x => x.name.startsWith(`binding.signer-lied.${b}`) )
    const r = await runCase(c)
    assert.equal(r.integrity, 'BINDING_MISMATCH', b)
    assert.equal(r.binding, b)
    assert.equal(r.keyState, 'NOT_EVALUATED', 'no key trust conclusion is drawn from a bundle that failed a cross-check')
  }
})

test('key order in transport does not matter but array order does', async () => {
  const b = signedBundle('B1')
  assert.equal((await verify(BUNDLES.cases.find(c => c.name === 'equivalent.object-keys-reordered').source.text)).integrity, 'VALID')
  const swapped = applyPatch(b, [{ op: 'swap', path: '/assessment/evidence', i: 0, j: 1 }]).assessment
  assert.notEqual(await ref.assessmentDigest(swapped), await ref.assessmentDigest(b.assessment))
})

// ── D10 ──────────────────────────────────────────────────────────────────────────────────────

function diffLeaves(a, b, base = '') {
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.flatMap((v, i) => diffLeaves(v, b[i], `${base}/${i}`))
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(k => diffLeaves(a[k], b[k], `${base}/${k}`))
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [base]
}

test('D10: changing ONLY one interpretation version changes the assessment digest, the signing input and the signature, and nothing else', async () => {
  assert.equal(BUNDLES.d10.length, 6, 'the five interpretation versions and the profile version')
  const base = signedBundle('B1')
  const baseEntry = SIGNING.entries.find(e => e.name === 'B1')
  for (const d of BUNDLES.d10) {
    const variant = signedBundle(d.signed)
    const variantEntry = SIGNING.entries.find(e => e.name === d.signed)
    const payloadField = d.field === 'agentverifyProfileVersion' ? '/profileVersion' : `/interpretationVersions/${d.field}`
    assert.deepEqual(diffLeaves(base.assessment, variant.assessment), [`/profile/${d.field}`], `${d.field}: the assessments differ in that one leaf only`)
    assert.equal(variant.assessment.package.digest, base.assessment.package.digest, `${d.field}: the package identity is unchanged`)
    assert.deepEqual(diffLeaves(base.attestation.payload, variant.attestation.payload).sort(), [payloadField, '/assessment/digest'].sort(), `${d.field}: payload differences`)
    assert.notEqual(variant.attestation.payload.assessment.digest, base.attestation.payload.assessment.digest, `${d.field}: assessment digest`)
    assert.notEqual(variantEntry.signingInputHex, baseEntry.signingInputHex, `${d.field}: signing input`)
    assert.notEqual(variant.attestation.signature, base.attestation.signature, `${d.field}: signature`)
    const key = await subtle.importKey('jwk', base.attestation.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    const subtleVerify = (bundle, input) => subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(bundle.attestation.signature, 'base64'), input)
    assert.equal(await subtleVerify(base, ref.signingInput(base.attestation.payload)), true)
    assert.equal(await subtleVerify(variant, ref.signingInput(variant.attestation.payload)), true)
    assert.equal(await subtleVerify(base, ref.signingInput(variant.attestation.payload)), false, `${d.field}: the ORIGINAL signature does not cover the changed version`)
    assert.equal(await subtleVerify(variant, ref.signingInput(base.attestation.payload)), false, `${d.field}: the NEW signature does not cover the original version`)
    assert.equal((await verify(base)).integrity, 'VALID')
    assert.equal((await verify(variant)).integrity, 'VALID', `${d.field}: integrity is VALID even when the profile version is one this verifier cannot interpret`)
  }
})

test('D10: the transplant vectors show the same thing through the verifier', async () => {
  for (const name of ['d10.signature-transplant', 'd10.assessment-reverted', 'd10.payload-reverted']) {
    const c = BUNDLES.cases.find(x => x.name === name)
    assertSubset(assert, await runCase(c), c.expected, name)
  }
})

// ── Bundle version ───────────────────────────────────────────────────────────────────────────

test('bundleVersion is independent unsigned framing: not in the payload, not in any digest, not in any signing input', async () => {
  const b = signedBundle('B1')
  assert.equal(b.bundleVersion, '1.0.0')
  assert.equal(BUNDLES.constants.bundleVersion, ref.BUNDLE_VERSION)
  assert.equal(Object.keys(b)[0], 'bundleVersion')
  const original = Buffer.from(ref.signingInput(b.attestation.payload)).toString('hex')
  b.bundleVersion = '9.9.9'
  assert.equal(Buffer.from(ref.signingInput(b.attestation.payload)).toString('hex'), original)
  assert.equal(await ref.assessmentDigest(b.assessment), b.attestation.payload.assessment.digest)
  assert.equal((await verify(b)).integrity, 'UNSUPPORTED_BUNDLE_VERSION', 'refused, and NOT reported as a signature problem')
  const supported = await verify(signedBundle('B1'), { supportedBundleVersions: ['1.0.0', '9.9.9'] })
  assert.equal(supported.integrity, 'VALID')
})

test('a verifier can widen its supported bundle versions without touching attestation support, and vice versa', async () => {
  const b = signedBundle('B1'); b.bundleVersion = '1.1.0'
  assert.equal((await verify(b, { supportedBundleVersions: ['1.0.0', '1.1.0'] })).integrity, 'VALID')
  const p = signedBundle('S_version-1.1.0')
  assert.equal((await verify(p, { supportedBundleVersions: ['1.0.0', '1.1.0'] })).integrity, 'UNSUPPORTED_VERSION')
})

// ── Workspace ────────────────────────────────────────────────────────────────────────────────

test('workspace: present or omitted are two different signed byte strings, and null is neither', async () => {
  const b1 = SIGNING.entries.find(e => e.name === 'B1'), b2 = SIGNING.entries.find(e => e.name === 'B2')
  assert.equal('workspaceId' in b1.payload, false, 'omitted, not null')
  assert.equal(b2.payload.workspaceId, 'ws_conformance_0001')
  assert.notEqual(b1.signingInputHex, b2.signingInputHex)
  assert.equal(b1.assessmentDigest, b2.assessmentDigest, 'workspace context is not part of the assessment')
  for (const n of ['strict.workspace-null', 'strict.workspace-empty', 'strict.workspace-number', 'strict.workspace-too-long']) assert.equal((await runCase(BUNDLES.cases.find(x => x.name === n))).integrity, 'MALFORMED', n)
})

test('offline and portable: verification needs no workspace, no network and no key set', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('network access attempted during verification') }
  try {
    const r = await verify(signedBundle('B2'))
    assert.equal(r.integrity, 'VALID')
    assert.equal(r.keyState, 'NOT_EVALUATED')
  } finally { globalThis.fetch = realFetch }
})

// ── Key state, purpose and key-set metadata ──────────────────────────────────────────────────

const byName = n => BUNDLES.cases.find(c => c.name === n)

test('key purpose: a purpose mismatch is its own state, distinct from a bad signature and from an unknown key', async () => {
  const mismatch = await runCase(byName('key-state.purpose-mismatch'))
  const badSig = await runCase(byName('tamper.signature.from-another-bundle'))
  const unknown = await runCase(byName('key-state.unknown-key'))
  assert.equal(mismatch.integrity, 'VALID')
  assert.equal(mismatch.keyState, 'KEY_PURPOSE_MISMATCH')
  assert.equal(badSig.integrity, 'INVALID_SIGNATURE')
  assert.equal(unknown.keyState, 'KEY_UNKNOWN')
  assert.equal(BUNDLES.constants.keyPurpose, 'agentverify-profile-v1')
})

test('key purpose is a property of the KEY SET entry, never of the attestation', async () => {
  const b = signedBundle('B1'); b.attestation.publicKey = { ...b.attestation.publicKey, purpose: ref.PROFILE_KEY_PURPOSE }
  assert.equal((await verify(b)).integrity, 'MALFORMED')
  const p = signedBundle('B1'); p.attestation.payload.keyPurpose = ref.PROFILE_KEY_PURPOSE
  assert.equal((await verify(p)).integrity, 'MALFORMED')
})

test('retired key, BOTH date orders: the same state, the same result, and nothing time-derived is reported', async () => {
  const before = await runCase(byName('key-state.retired.issuedAt-after-retiredAt'))
  const after = await runCase(byName('key-state.retired.issuedAt-before-retiredAt'))
  assert.deepEqual(before, after, 'identical results in both orders')
  assert.equal(before.keyState, 'KEY_RETIRED')
  const ks = BUNDLES.keySets
  const retiredAt = k => k.keys.find(e => e.status === 'retired').retiredAt
  assert.ok(retiredAt(ks.retiredBeforeIssuedAt) < BUNDLES.constants.issuedAt, 'one vector has retiredAt before issuedAt')
  assert.ok(retiredAt(ks.retiredAfterIssuedAt) > BUNDLES.constants.issuedAt, 'the other has it after')
  assert.deepEqual(Object.keys(before).filter(k => /time|age|date|before|after|anomal|predate|claim/i.test(k)), [], 'no time-derived output, no anomaly flag, no claim about when the signature was made')
  // Policy: retired is refused by default and accepted only by explicit opt-in, identically in both orders.
  for (const n of ['policy.retired-opt-in.issuedAt-after-retiredAt', 'policy.retired-opt-in.issuedAt-before-retiredAt']) assert.equal((await runCase(byName(n))).policy.status, 'SATISFIED', n)
  assert.deepEqual((await runCase(byName('policy.retired-refused-by-default'))).policy.failures, ['KEY_STATE_NOT_ACCEPTED'])
})

test('revoked key: KEY_REVOKED whatever issuedAt says, never accepted by any policy, and a policy that lists it is invalid', async () => {
  for (const n of ['key-state.revoked.revokedAt-after-issuedAt', 'key-state.revoked.revokedAt-before-issuedAt']) assert.equal((await runCase(byName(n))).keyState, 'KEY_REVOKED', n)
  const r = await runCase(byName('policy.revoked-never-accepted'))
  assert.equal(r.integrity, 'VALID', 'the signature mathematics are valid')
  assert.equal(r.keyState, 'KEY_REVOKED')
  assert.equal(r.policy.status, 'NOT_SATISFIED')
  assert.equal((await runCase(byName('policy.invalid-lists-revoked'))).policy.status, 'INVALID_POLICY')
  assert.deepEqual(ref.ACCEPTABLE_KEY_STATES, ['KEY_ACTIVE', 'KEY_RETIRED'])
  assert.deepEqual(ref.DEFAULT_ACCEPTED_KEY_STATES, ['KEY_ACTIVE'], 'the reference default is ACTIVE only')
})

// ── Rollback state is ISSUER-SCOPED ──────────────────────────────────────────────────────────

const ISSUER_A = 'agentverify-conformance'
const ISSUER_B = 'agentverify-other'

test('ROLLBACK: retained state is keyed by issuer, and the bare-number option no longer exists', async () => {
  await assert.rejects(() => verify(signedBundle('B1'), { keySet: BUNDLES.keySets.active, highestAcceptedKeySetSequence: 5 }), e => e instanceof TypeError && /keyed by issuer/.test(e.message))
  const src = readFileSync(path.join(here, '..', 'reference', 'profileAttestation.mjs'), 'utf8')
  assert.match(src, /retainedSequenceByIssuer/)
  // The only mention of the removed option is the guard that refuses it.
  assert.equal((src.match(/highestAcceptedKeySetSequence/g) ?? []).length, 2, 'the guard and its message, nothing else')
})

test('ROLLBACK: issuer A\'s retained sequence cannot affect issuer B, and B\'s own state applies to B', async () => {
  const cross = await runCase(byName('key-state.rollback.issuer-a-state-cannot-affect-issuer-b'))
  assert.equal(cross.keyState, 'KEY_ACTIVE'); assert.equal(cross.keySetSequenceCheck, 'NO_RETAINED_STATE')
  const own = await runCase(byName('key-state.rollback.issuer-b-own-state-applies'))
  assert.equal(own.keyState, 'KEY_SET_ROLLBACK_DETECTED'); assert.equal(own.keySetSequenceCheck, 'BEHIND_RETAINED')
  // And the mirror image, computed here: A's bundle with only B's state is unaffected however high B's number is.
  const a = await verify(signedBundle('B1'), { keySet: BUNDLES.keySets.sequence3, retainedSequenceByIssuer: { [ISSUER_B]: 1_000_000 } })
  assert.equal(a.keyState, 'KEY_ACTIVE'); assert.equal(a.keySetSequenceCheck, 'NO_RETAINED_STATE')
})

test('ROLLBACK: a stale key set for the CORRECT issuer is detected', async () => {
  const r = await runCase(byName('key-state.rollback.stale-key-set-for-the-correct-issuer'))
  assert.equal(r.integrity, 'VALID')
  assert.equal(r.keyState, 'KEY_SET_ROLLBACK_DETECTED'); assert.equal(r.keySetSequence, 3); assert.equal(r.keySetSequenceCheck, 'BEHIND_RETAINED')
  assert.equal((await runCase(byName('policy.rollback-detected-refused'))).policy.status, 'NOT_SATISFIED', 'and no policy accepts it')
})

test('ROLLBACK: retained state for an UNRELATED issuer is ignored, even alongside the correct issuer\'s', async () => {
  const ignored = await runCase(byName('key-state.rollback.other-issuers-state-is-ignored'))
  assert.equal(ignored.keyState, 'KEY_ACTIVE'); assert.equal(ignored.keySetSequenceCheck, 'NO_RETAINED_STATE')
  const both = await runCase(byName('key-state.rollback.only-the-payload-issuer-counts'))
  assert.equal(both.keyState, 'KEY_ACTIVE'); assert.equal(both.keySetSequenceCheck, 'NOT_BEHIND_RETAINED')
})

test('ROLLBACK: NO retained state is distinguishable from "not behind retained state", and neither is called current or fresh', async () => {
  const none = await runCase(byName('key-state.rollback.no-retained-state'))
  const equal = await runCase(byName('key-state.rollback.sequence-equal-to-retained'))
  const above = await runCase(byName('key-state.rollback.sequence-above-retained'))
  const empty = await runCase(byName('key-state.rollback.empty-retained-state'))
  assert.equal(none.keySetSequenceCheck, 'NO_RETAINED_STATE')
  assert.equal(empty.keySetSequenceCheck, 'NO_RETAINED_STATE', 'an empty state object is the same as none')
  assert.equal(equal.keySetSequenceCheck, 'NOT_BEHIND_RETAINED'); assert.equal(above.keySetSequenceCheck, 'NOT_BEHIND_RETAINED')
  assert.notEqual(none.keySetSequenceCheck, equal.keySetSequenceCheck)
  // The same key state, different meaning: the caller can tell the two apart.
  assert.equal(none.keyState, equal.keyState)
  const vocabulary = JSON.stringify(Object.values({ none, equal, above, empty }))
  assert.doesNotMatch(vocabulary, /CURRENT|FRESH|CONFIRMED|LATEST/i, 'no result claims the key set is current')
  const stale = await runCase(byName('key-state.rollback.low-sequence-with-no-state-is-accepted'))
  assert.equal(stale.keyState, 'KEY_ACTIVE'); assert.equal(stale.keySetSequenceCheck, 'NO_RETAINED_STATE', 'a low sequence with no retained state is used, and says so')
})

test('ROLLBACK: the issuer is taken from the bundle\'s OWN payload; a key set for another issuer consults no state at all', async () => {
  const calls = []
  const lookup = issuer => { calls.push(issuer); return 99 }
  const r = await verify(signedBundle('B1'), { keySet: BUNDLES.keySets.issuerMismatch, retainedSequenceByIssuer: lookup })
  assert.equal(r.keyState, 'KEY_UNKNOWN'); assert.equal(r.keySetSequenceCheck, undefined)
  assert.deepEqual(calls, [], 'the lookup was never called for a key set that is not this issuer\'s')
  const s = await verify(signedBundle('B1'), { keySet: BUNDLES.keySets.sequence3, retainedSequenceByIssuer: lookup })
  assert.deepEqual(calls, [ISSUER_A], 'called exactly once, with the payload issuer and nothing else')
  assert.equal(s.keyState, 'KEY_SET_ROLLBACK_DETECTED')
  const m = await verify(signedBundle('B_issuerOther'), { keySet: BUNDLES.keySets.otherIssuer, retainedSequenceByIssuer: new Map([[ISSUER_A, 99], [ISSUER_B, 1]]) })
  assert.equal(m.keySetSequenceCheck, 'NOT_BEHIND_RETAINED', 'a Map keyed by issuer works the same way')
})

test('ROLLBACK: retained state is read by OWN key only, and malformed retained state fails loudly', async () => {
  assert.equal(ref.retainedSequenceFor({}, 'constructor'), undefined)
  assert.equal(ref.retainedSequenceFor({}, 'toString'), undefined)
  assert.equal(ref.retainedSequenceFor({}, '__proto__'), undefined)
  assert.equal(ref.retainedSequenceFor(Object.create({ inherited: 5 }), 'inherited'), undefined, 'an inherited entry is not retained state')
  assert.equal(ref.retainedSequenceFor({ constructor: 9 }, 'constructor'), 9)
  assert.equal(ref.retainedSequenceFor(undefined, ISSUER_A), undefined)
  assert.equal(ref.retainedSequenceFor(null, ISSUER_A), undefined)
  for (const bad of [0, -1, 1.5, '5', NaN, Infinity, 2 ** 60, null]) {
    assert.throws(() => ref.retainedSequenceFor({ [ISSUER_A]: bad }, ISSUER_A), TypeError, String(bad))
  }
  assert.throws(() => ref.retainedSequenceFor(5, ISSUER_A), TypeError, 'a bare number is not retained state')
  assert.throws(() => ref.retainedSequenceFor('5', ISSUER_A), TypeError)
  const proto = await runCase(byName('key-state.rollback.issuer-named-like-a-prototype-member'))
  assert.equal(proto.keySetSequenceCheck, 'NO_RETAINED_STATE')
  assert.equal((await runCase(byName('key-state.rollback.prototype-named-issuer-with-real-state'))).keyState, 'KEY_SET_ROLLBACK_DETECTED')
})

test('ROLLBACK WORDING: sequence metadata is rollback DETECTION support that needs retained issuer state; it is not freshness or protection', async () => {
  const forged = structuredClone(BUNDLES.keySets.active); forged.sequence = 1_000_000
  // An attacker who can present a key set can present any sequence: a verifier with retained state can be walked forward, one without learns nothing.
  assert.equal((await verify(signedBundle('B1'), { keySet: forged, retainedSequenceByIssuer: { [ISSUER_A]: 5 } })).keyState, 'KEY_ACTIVE')
  assert.equal((await verify(signedBundle('B1'), { keySet: forged })).keySetSequenceCheck, 'NO_RETAINED_STATE')
  for (const generatedAt of ['1999-01-01T00:00:00.000Z', '2999-01-01T00:00:00.000Z']) {
    const odd = structuredClone(BUNDLES.keySets.active); odd.generatedAt = generatedAt
    assert.equal((await verify(signedBundle('B1'), { keySet: odd })).keyState, 'KEY_ACTIVE', 'generatedAt is informational: never evaluated')
  }
  const src = readFileSync(path.join(here, '..', 'reference', 'profileAttestation.mjs'), 'utf8')
  assert.match(src, /rollback DETECTION support that works only when the verifier actually retains prior issuer state/)
  assert.match(src, /not rollback[\s*]*PROTECTION and not a freshness[\s*]+guarantee/)
  assert.match(src, /generatedAt` is informational/)
  const readme = readFileSync(path.join(here, '..', 'README.md'), 'utf8')
  assert.match(readme, /rollback DETECTION support[\s\S]*not rollback PROTECTION/)
  assert.match(readme, /RETAINS the\s+highest sequence it accepted for that issuer/)
  assert.match(readme, /ISSUER-SCOPED/)
  assert.match(readme, /NOT "current" and NOT "fresh"/)
})

// ── No key set: fail closed, and the three layers stay separate ──────────────────────────────

test('NO KEY SET: integrity can be VALID, the key state is NOT_EVALUATED, and NO policy is satisfied. Nothing becomes a trust conclusion', async () => {
  for (const name of ['B1', 'B2']) {
    const bare = await verify(signedBundle(name))
    assert.equal(bare.integrity, 'VALID', 'layer 1: cryptographic integrity')
    assert.equal(bare.keyState, 'NOT_EVALUATED', 'layer 2: key state, not evaluated')
    assert.equal(bare.policy, undefined, 'layer 3: no policy was asked for, so none is reported')
    for (const policy of [{}, { acceptedKeyStates: ['KEY_ACTIVE', 'KEY_RETIRED'] }, { requiredProfile: 'owasp-agentic-skills-2026' }]) {
      const r = await verify(signedBundle(name), { policy })
      assert.equal(r.integrity, 'VALID'); assert.equal(r.keyState, 'NOT_EVALUATED')
      assert.equal(r.policy.status, 'NOT_SATISFIED', JSON.stringify(policy))
      assert.ok(r.policy.failures.includes('KEY_STATE_NOT_ACCEPTED'), 'the reason is the missing key state, not the signature')
    }
  }
  assert.equal((await runCase(byName('policy.no-key-set-fails-default'))).policy.status, 'NOT_SATISFIED')
  assert.equal(Object.keys(ref.DEFAULT_ACCEPTED_KEY_STATES).length, 1)
  assert.ok(!ref.ACCEPTABLE_KEY_STATES.includes('NOT_EVALUATED'), 'NOT_EVALUATED can never be accepted')
})

test('KEY-SET INVALIDITY: every reason keySetProblem can return has at least one vector', () => {
  assert.ok(ref.KEY_SET_PROBLEM_CODES.length >= 12)
  const seen = new Set(BUNDLES.cases.map(c => c.expected.keyStateReason).filter(Boolean))
  for (const code of ref.KEY_SET_PROBLEM_CODES) assert.ok(seen.has(code), `no vector for key-set problem ${code}`)
  for (const code of seen) assert.ok(ref.KEY_SET_PROBLEM_CODES.includes(code), `${code} is not a registered problem code`)
  for (const n of ['key-state.key-set-invalid.entry-purpose-empty', 'key-state.key-set-invalid.entry-notBefore-not-canonical']) assert.ok(byName(n), n)
})

test('every key-set entry\'s purpose comes from the domain registry, and no signature path reads a purpose from the attestation', () => {
  const CASE_MISMATCHES = ['AGENTVERIFY-PROFILE-V1', 'AgentVerify-Profile-V1', 'agentverify-profile-v1 ']
  for (const ks of Object.values(BUNDLES.keySets)) for (const e of Array.isArray(ks.keys) ? ks.keys : []) if (e.purpose) assert.ok([ref.PROFILE_KEY_PURPOSE, 'agentverify-scan-v1', ...CASE_MISMATCHES].includes(e.purpose), e.purpose)
})

// ── Signature form: low-S, an Agent Verify canonical-signature rule ──────────────────────────

const N = ref.P256_ORDER
const HALF = ref.P256_HALF_ORDER

test('low-S constants: n is the P-256 group order, n is odd, and floor(n/2) is the largest admitted s', () => {
  assert.equal(N.toString(16).toUpperCase(), 'FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551')
  assert.equal(HALF.toString(16).toUpperCase(), '7FFFFFFF800000007FFFFFFFFFFFFFFFDE737D56D38BCF4279DCE5617E3192A8')
  assert.equal(N % 2n, 1n)
  assert.equal(HALF * 2n + 1n, N)
})

test('signatureProblem: the exact boundaries', () => {
  const sig = (r, s) => new Uint8Array(Buffer.concat([Buffer.from(r.toString(16).padStart(64, '0'), 'hex'), Buffer.from(s.toString(16).padStart(64, '0'), 'hex')]))
  assert.equal(ref.signatureProblem(sig(1n, 1n)), null)
  assert.equal(ref.signatureProblem(sig(N - 1n, HALF)), null)
  assert.equal(ref.signatureProblem(sig(1n, HALF + 1n)), 'signature.high-s')
  assert.equal(ref.signatureProblem(sig(1n, N - 1n)), 'signature.high-s')
  for (const [r, s] of [[0n, 1n], [1n, 0n], [N, 1n], [1n, N], [N + 1n, 1n], [1n, N + 1n]]) assert.equal(ref.signatureProblem(sig(r, s)), 'signature.range', `${r} ${s}`)
  assert.equal(ref.signatureProblem(new Uint8Array(63).fill(1)), 'signature.range', 'a 63-byte value with in-range halves is still refused')
  assert.equal(ref.signatureProblem(new Uint8Array(65).fill(1)), 'signature.range')
  assert.equal(ref.signatureProblem(new Uint8Array(0)), 'signature.range')
})

test('LIVE low-S proof with a throwaway in-memory key: WebCrypto emits both forms, the verifier accepts only low-S, and the high-S twin is a mathematically VALID signature', async () => {
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await subtle.exportKey('jwk', kp.publicKey)
  const pub = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }
  const keyId = await ref.keyIdOf(pub)
  const base = signedBundle('B1')
  base.attestation.payload.keyId = keyId; base.attestation.publicKey = pub
  const bytes = ref.signingInput(base.attestation.payload)
  let sawHigh = false, sawLow = false
  for (let i = 0; i < 40 && !(sawHigh && sawLow); i++) {
    const raw = Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, bytes))
    const r = BigInt(`0x${raw.subarray(0, 32).toString('hex')}`), s = BigInt(`0x${raw.subarray(32).toString('hex')}`)
    const twin = Buffer.concat([raw.subarray(0, 32), Buffer.from((N - s).toString(16).padStart(64, '0'), 'hex')])
    assert.equal(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, twin, bytes), true, 'the twin is a valid signature')
    const [lo, hi] = s <= HALF ? [raw, twin] : [twin, raw]
    sawHigh ||= s > HALF; sawLow ||= s <= HALF
    // The digest binding is over the ORIGINAL assessment, so only the signature varies here.
    const low = structuredClone(base); low.attestation.signature = lo.toString('base64')
    const high = structuredClone(base); high.attestation.signature = hi.toString('base64')
    assert.equal((await verify(low)).integrity, 'VALID')
    const h = await verify(high)
    assert.equal(h.integrity, 'MALFORMED'); assert.equal(h.reasonCode, 'signature.high-s')
    void r
  }
  assert.ok(sawHigh && sawLow, 'WebCrypto produced both forms')
})

test('low-S applies to the profile type ONLY: the legacy vectors keep both forms VALID (see legacyAttestation.test.mjs)', () => {
  const forms = Object.values(LEGACY.attestations).map(a => a.form)
  assert.ok(forms.includes('low-s') && forms.includes('high-s'))
  assert.equal(LEGACY.cases.find(c => c.name === 'valid.high-s').expected.status, 'VALID')
  const src = readFileSync(path.join(here, '..', 'reference', 'profileAttestation.mjs'), 'utf8')
  assert.match(src, /NOT an RFC 7518 \(JWA\) or RFC 7515 requirement/)
  assert.match(src, /NEW profile-attestation type only/)
})

// ── Closed profile registry and interpretation ───────────────────────────────────────────────

test('the profile registry is CLOSED, own-key only, and interpretation never turns into a signature failure', async () => {
  assert.deepEqual(Object.keys(ref.PROFILE_REGISTRY), ['owasp-agentic-skills-2026'])
  assert.ok(Object.isFrozen(ref.PROFILE_REGISTRY) && Object.isFrozen(ref.PROFILE_REGISTRY['owasp-agentic-skills-2026'].versions))
  for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) assert.equal(Object.hasOwn(ref.PROFILE_REGISTRY, id), false, id)
  for (const n of ['interpretation.unknown-profile', 'interpretation.unknown-profile-version', 'interpretation.framework-not-pinned', 'interpretation.registry-is-closed', 'interpretation.future-schema', 'interpretation.schema-decided-before-profile']) {
    const r = await runCase(byName(n))
    assert.equal(r.integrity, 'VALID', n)
    assert.notEqual(r.interpretation, 'SUPPORTED', n)
  }
  for (const n of ['policy.unsupported-profile-cannot-satisfy', 'policy.unsupported-profile-version-cannot-satisfy', 'policy.unsupported-schema-cannot-satisfy']) {
    const r = await runCase(byName(n))
    assert.equal(r.policy.status, 'NOT_SATISFIED', n)
    assert.deepEqual(r.policy.failures, ['INTERPRETATION_UNSUPPORTED'], n)
  }
})

test('the assessment carries its own profile id and the payload copy is cross-checked against it (no bare claim)', async () => {
  assert.equal(signedBundle('B1').assessment.profile.profileId, signedBundle('B1').attestation.payload.profile)
  assert.equal((await runCase(byName('binding.signer-lied.profileId'))).binding, 'profileId')
  assert.equal((await runCase(byName('assessment.profile-id-changed'))).binding, 'assessment.digest')
})

// ── Size ceiling ─────────────────────────────────────────────────────────────────────────────

test('a bundle over the byte ceiling is refused BEFORE it is decoded or parsed (the ceiling is on BYTES)', async () => {
  assert.equal(ref.MAX_BUNDLE_TEXT_BYTES, 16 * 1024 * 1024)
  const huge = new Uint8Array(ref.MAX_BUNDLE_TEXT_BYTES + 1).fill(0x20)
  const RealDecoder = globalThis.TextDecoder
  globalThis.TextDecoder = class { constructor() { throw new Error('a decoder was constructed for an oversized input') } }
  try {
    const started = performance.now()
    const r = await verify(huge)
    assert.equal(r.integrity, 'MALFORMED'); assert.equal(r.reasonCode, 'bundle.too-large')
    assert.ok(performance.now() - started < 500, 'refused without decoding or parsing')
  } finally { globalThis.TextDecoder = RealDecoder }
})

// ── Routing and cross-type ───────────────────────────────────────────────────────────────────

test('routing: a BARE scan attestation (no attestationType) is routed to the legacy verifier; a legacy payload inside a bundle is malformed', async () => {
  const legacy = LEGACY.attestations.base.attestation
  const bare = await verify(structuredClone(legacy))
  assert.equal(bare.route, 'LEGACY_SCAN_ATTESTATION'); assert.notEqual(bare.integrity, 'VALID')
  const wrapped = await verify({ bundleVersion: '1.0.0', attestation: structuredClone(legacy), assessment: {} })
  assert.equal(wrapped.route, 'PROFILE_ASSESSMENT'); assert.equal(wrapped.integrity, 'MALFORMED')
  assert.equal((await verify(signedBundle('B1'))).route, 'PROFILE_ASSESSMENT')
  const noVersion = signedBundle('B1'); delete noVersion.bundleVersion
  assert.equal((await verify(noVersion)).integrity, 'MALFORMED')
})

test('cross-type: a profile payload without its type is malformed inside a bundle, and a legacy payload given a profile type is never accepted', async () => {
  const b = signedBundle('B1'); delete b.attestation.payload.attestationType
  const r = await verify(b)
  assert.equal(r.integrity, 'MALFORMED'); assert.notEqual(r.route, 'LEGACY_SCAN_ATTESTATION')
  const dressed = { bundleVersion: '1.0.0', attestation: { ...structuredClone(LEGACY.attestations.base.attestation), payload: { ...LEGACY.attestations.base.attestation.payload, attestationType: ref.ATTESTATION_TYPE } }, assessment: {} }
  const d = await verify(dressed)
  assert.notEqual(d.integrity, 'VALID')
})

test('determinism: verifying twice gives identical results', async () => {
  for (const c of BUNDLES.cases.slice(0, 60)) assert.deepEqual(await runCase(c), await runCase(c), c.name)
})

test('the reference never reads a signing tag, attestation type or key purpose from anywhere but the domain registry', () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const src = strip(readFileSync(path.join(here, '..', 'reference', 'profileAttestation.mjs'), 'utf8'))
  for (const literal of ['agentverify-attestation/', 'agentverify-assessment-digest/', 'agentverify-skill-package-digest/', 'agentverify-profile-v1', 'agentverify.profile-assessment']) assert.ok(!src.includes(`'${literal}`) && !src.includes(`"${literal}`), `${literal} is spelled outside domains.mjs`)
})

test('LIVE closed-registry proof with a throwaway in-memory key: an INHERITED registry entry is not a registered profile', async () => {
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await subtle.exportKey('jwk', kp.publicKey)
  const pub = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }
  const b = signedBundle('B1')
  b.assessment.profile.profileId = 'inherited'
  b.attestation.publicKey = pub
  b.attestation.payload.keyId = await ref.keyIdOf(pub)
  b.attestation.payload.profile = 'inherited'
  b.attestation.payload.assessment.digest = await ref.assessmentDigest(b.assessment)
  const bytes = ref.signingInput(b.attestation.payload)
  let raw
  do { raw = Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, bytes)) } while (ref.signatureProblem(new Uint8Array(raw)) !== null)
  b.attestation.signature = raw.toString('base64')
  // A registry whose entry exists only on the PROTOTYPE, and matches this bundle exactly.
  const definition = ref.PROFILE_REGISTRY['owasp-agentic-skills-2026'].versions['1.0.0-alpha.1']
  const inheritedOnly = Object.create({ inherited: { versions: { '1.0.0-alpha.1': definition } } })
  const r = await verify(b, { profileRegistry: inheritedOnly })
  assert.equal(r.integrity, 'VALID')
  assert.equal(r.interpretation, 'UNSUPPORTED_PROFILE', 'an inherited entry is not in the closed registry')
  const own = await verify(b, { profileRegistry: { inherited: { versions: { '1.0.0-alpha.1': definition } } } })
  assert.equal(own.interpretation, 'SUPPORTED', 'the same entry as an OWN key is supported: the rule is ownership, nothing else')
})

// ── IN-MEMORY objects with hidden shape (JSON text cannot produce these, but verifyParsedBundle can be handed them) ──

test('HIDDEN SHAPE: a symbol-keyed property, an array subclass, an accessor and an inherited property are never accepted as data', async () => {
  const sym = Symbol('hidden')
  for (const where of [b => b, b => b.attestation, b => b.attestation.payload, b => b.attestation.payload.upstream, b => b.attestation.publicKey]) {
    const b = signedBundle('B1'); where(b)[sym] = 'x'
    const r = await ref.verifyParsedBundle(b)
    assert.notEqual(r.integrity, 'VALID', 'a symbol-keyed property is never ignored')
  }
  const inAssessment = signedBundle('B1'); inAssessment.assessment[sym] = 'x'
  assert.equal((await ref.verifyParsedBundle(inAssessment)).integrity, 'MALFORMED', 'not canonicalizable, so not digestible')
  class Sub extends Array {}
  const keySet = structuredClone(BUNDLES.keySets.active); keySet.keys = Sub.from(keySet.keys)
  assert.equal((await ref.verifyParsedBundle(signedBundle('B1'), { keySet })).keyStateReason, 'keySet.keys', 'an array subclass is not a JSON array')
  const sparse = structuredClone(BUNDLES.keySets.active); sparse.keys = new Array(1)
  assert.equal((await ref.verifyParsedBundle(signedBundle('B1'), { keySet: sparse })).keyStateReason, 'keySet.keys', 'a sparse array is not a JSON array')
  const extra = structuredClone(BUNDLES.keySets.active); extra.keys.zz = 1
  assert.equal((await ref.verifyParsedBundle(signedBundle('B1'), { keySet: extra })).keyStateReason, 'keySet.keys', 'an array with a non-index property is not a JSON array')
  // An assessment whose schemaVersion is only INHERITED is not a 1.1.0 assessment.
  const inherited = Object.create({ schemaVersion: '1.1.0' })
  assert.deepEqual(ref.interpretationOf(inherited), { interpretation: 'UNSUPPORTED_SCHEMA' })
  assert.equal(ref.interpretationOf(Object.assign(Object.create(null), structuredClone(BUNDLES.signed.B1.bundle.assessment))).interpretation, 'SUPPORTED', 'a null-prototype copy of the same data is fine')
})
