// NOT part of the frozen v4 tree (see CHANGELOG.md in this directory). This is the REPLACEMENT for the one
// v4 test this implementation phase makes inapplicable ('THE SIGNING GATE' in conformance/v4/test/docs.test.mjs,
// which asserted the profile attestation was NOT implemented anywhere in product code). That assertion has
// done its job; this file asserts the real requirements for the implementation that exists now instead.
//
// Run via `conformance/implementation/run-v4-post-authorization.mjs`, or directly with `node --test`.
//
// Some checks below can only be written meaningfully once their subject exists (the signing module, the
// Worker's attest:true wiring). Those are `test.todo(...)`, not omitted and not faked as passing — Node's
// test runner reports them as TODO, separately from pass/fail, so their absence is always visible in the run
// output rather than silently missing.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.join(here, '..', '..')
const read = (...p) => readFileSync(path.join(repo, ...p), 'utf8')
const rel = abs => path.relative(repo, abs).split(path.sep).join('/')

const walk = dir => readdirSync(dir).flatMap(e => {
  const p = path.join(dir, e)
  return statSync(p).isDirectory() ? (['node_modules', 'dist', '.next', '.git'].includes(e) ? [] : walk(p)) : [p]
})

// The product paths the old tripwire swept. Same list, same directories — only the verdict changes.
const PRODUCT_DIRS = [['workers', 'api', 'src'], ['packages', 'cli', 'src'], ['packages', 'scanner', 'src'], ['apps', 'web', 'src']]
const DOMAIN_CONSTANTS = /agentverify\.profile-assessment|agentverify-attestation\/profile-assessment|agentverify-profile-v1|PROFILE_KEY_PURPOSE|avassess-sha256/

// The ONLY non-test source files allowed to spell the profile-attestation's domain constants. Grows only when
// a new module is deliberately part of this implementation (the public-safe module and, later, the one
// Worker-only signing module — see docs/attestation-profile-design.md §10.1 for why the split exists).
const INTENDED_DOMAIN_MODULES = [
  'packages/scanner/src/profileAttestation.ts',
  'workers/api/src/profileAttestationSigning.ts',
  // The package's public export barrel: it re-exports PROFILE_KEY_PURPOSE by name (renaming every other
  // profileAttestation.ts export to avoid collisions with unrelated existing exports), so the bare identifier
  // legitimately appears in its source text without this file implementing anything itself.
  'packages/scanner/src/index.ts',
]

function productFiles() {
  const out = []
  for (const dir of PRODUCT_DIRS) {
    const full = path.join(repo, ...dir)
    let files
    try { files = walk(full) } catch { continue } // packages/scanner is a private, gitignored package; absent in public CI
    out.push(...files.filter(f => /\.(ts|tsx|mjs|js)$/.test(f)))
  }
  return out
}

// packages/scanner is entirely gitignored: public CI generates a MINIMAL stub in its place
// (scripts/create-ci-scanner-stub.mjs — package.json, src/index.ts, dist/index.{js,d.ts} only, no test/
// directory, no profileAttestation.ts by that name). The three checks below need the REAL private module and
// its own test suite, not the stub, so they gate on the one thing only the real package ever creates: a
// packages/scanner/test/ directory. This mirrors the same HAS_REAL_SCANNER / realOnly pattern already used
// throughout workers/api's and packages/cli's own test suites for exactly this distinction.
const HAS_PRIVATE_SCANNER_PACKAGE = existsSync(path.join(repo, 'packages', 'scanner', 'test'))
const privateScannerOnly = { skip: HAS_PRIVATE_SCANNER_PACKAGE ? false : 'private scanner package not present (public CI stub); covered by the local security release gate' }

test('IMPLEMENTATION LOCATION: the profile-attestation domain constants appear only in the intended modules, never elsewhere in product code', () => {
  const found = []
  for (const f of productFiles()) {
    const r = rel(f)
    if (r.includes('/test/') || /\.test\.[mc]?js$/.test(r) || /\.test\.tsx?$/.test(r)) continue // test files legitimately assert against these constants
    if (DOMAIN_CONSTANTS.test(readFileSync(f, 'utf8')) && !INTENDED_DOMAIN_MODULES.includes(r)) found.push(r)
  }
  assert.deepEqual(found, [], `unexpected file(s) spelling the profile-attestation domain constants: ${found.join(', ')}`)
})

test('IMPLEMENTATION EXISTS: the public-safe module is present (the signing module is checked once it exists; see the todo below)', privateScannerOnly, () => {
  assert.ok(existsSync(path.join(repo, 'packages', 'scanner', 'src', 'profileAttestation.ts')), 'packages/scanner/src/profileAttestation.ts must exist post-authorization')
})

test('DOMAIN CONSTANTS MATCH: the product module\'s domain constants are byte-identical to the frozen v4 reference', privateScannerOnly, async () => {
  const productSrc = read('packages', 'scanner', 'src', 'profileAttestation.ts')
  const refDomains = await import(pathToFileURL(path.join(repo, 'conformance', 'v4', 'reference', 'domains.mjs')).href)
  for (const [name, value] of [
    ['ATTESTATION_TYPE', refDomains.ATTESTATION_TYPE],
    ['PAYLOAD_TAG', refDomains.PAYLOAD_TAG],
    ['PROFILE_KEY_PURPOSE', refDomains.PROFILE_KEY_PURPOSE],
    ['ASSESSMENT_TAG', refDomains.ASSESSMENT_TAG],
    ['PACKAGE_TAG', refDomains.PACKAGE_TAG],
  ]) {
    // The product file is TypeScript, not importable here without a build step, so this is a literal-match
    // check on source text rather than a runtime import — deliberately conservative (a renamed export or a
    // changed literal both fail it), not a substitute for the runtime cross-check in packages/scanner/test/.
    // Checked as SOURCE TEXT: TypeScript quotes with '...' not "...", and a tag's trailing \n is a two-
    // character escape (backslash, n) in source, not the runtime string's actual newline byte.
    const asSourceLiteral = value.replace(/\n/g, '\\n')
    assert.ok(productSrc.includes(asSourceLiteral), `product source must contain the literal ${name} = ${JSON.stringify(value)}`)
  }
})

test('NO PRIVATE KEY MATERIAL: no source file or committed fixture contains an actual PEM/PKCS8 private-key body or a real-looking JWK private "d" member', () => {
  // Requires a PEM marker WITH a base64 body between BEGIN and END (a bare marker string, e.g. inside a regex
  // that strips PEM headers from an env value, has no body between them and correctly does not match).
  const pemWithBody = /-----BEGIN (EC )?PRIVATE KEY-----\s*[\r\n]+[A-Za-z0-9+/=\s]{40,}-----END (EC )?PRIVATE KEY-----/
  // Scoped to product code and this implementation's own (currently empty) fixture area — deliberately NOT the
  // frozen conformance/v2, v3, v4 vector sets, which legitimately contain adversarial JWKs with a "d" member as
  // NEGATIVE test fixtures (proving a verifier refuses private-key material presented as a public key); those
  // are not secrets and were already reviewed as part of freezing those vector sets.
  const dirsToScan = [...PRODUCT_DIRS, ['conformance', 'implementation']]
  const offenders = []
  for (const dir of dirsToScan) {
    const full = path.join(repo, ...dir)
    let files
    try { files = walk(full) } catch { continue }
    for (const f of files.filter(x => /\.(ts|tsx|mjs|js|json|md)$/.test(x))) {
      if (pemWithBody.test(readFileSync(f, 'utf8'))) offenders.push(rel(f))
    }
  }
  assert.deepEqual(offenders, [], `possible private-key material found in: ${offenders.join(', ')}`)
})

test('SIGNING ISOLATION: no product file outside the intended signing module calls a private-key sign operation for the profile-attestation key', () => {
  const signOps = /subtle\.sign\(|createSign\(|createPrivateKey\(/
  const signingModulePath = 'workers/api/src/profileAttestationSigning.ts'
  // Pre-existing, already-shipped signing boundaries unrelated to the profile-attestation key: Firebase
  // service-account JWT signing (firebaseAuth.ts), webhook delivery HMAC signing (webhooks.ts), Stripe webhook
  // HMAC verification (billing.ts), and the legacy scan-attestation signer (attestationSigning.ts). None of
  // these can produce a profile-attestation signature; excluding them keeps this test about the NEW boundary.
  const knownUnrelatedSigners = new Set([
    'workers/api/src/attestationSigning.ts',
    'workers/api/src/firebaseAuth.ts',
    'workers/api/src/webhooks.ts',
    'workers/api/src/billing.ts',
  ])
  const offenders = []
  for (const f of productFiles()) {
    const r = rel(f)
    if (r.includes('/test/') || r === signingModulePath || knownUnrelatedSigners.has(r)) continue
    if (signOps.test(readFileSync(f, 'utf8'))) offenders.push(r)
  }
  assert.deepEqual(offenders, [], `unexpected sign operation outside the signing module: ${offenders.join(', ')}`)
})

test('CLI/WEB NEVER TOUCH KEYS: neither packages/cli/src nor apps/web/src imports a signing operation or private-key JWK member', () => {
  const suspect = /subtle\.sign\(|createSign\(|createPrivateKey\(|PRIVATE_KEY_JWK/
  for (const dir of [['packages', 'cli', 'src'], ['apps', 'web', 'src']]) {
    const full = path.join(repo, ...dir)
    let files
    try { files = walk(full) } catch { continue }
    for (const f of files.filter(x => /\.(ts|tsx|mjs|js)$/.test(x))) {
      assert.doesNotMatch(readFileSync(f, 'utf8'), suspect, `${rel(f)} must not reference signing or private-key material`)
    }
  }
})

// ── Behavioral requirements: now that the signer and Worker wiring exist, each has a real, substantial test
// in its own module (the natural place for a runtime/worker harness), part of the 15-item test list the
// signer implementation was required to deliver. This section proves those tests actually exist with the
// expected names, rather than re-implementing a second copy of a worker harness here. If the referenced file
// or test name ever goes missing, THIS assertion fails loudly instead of the coverage silently disappearing.
const hasTest = (relPath, nameSubstring) => {
  let src
  try { src = read(...relPath.split('/')) } catch { return false }
  return readTestNames(src).some(n => n.includes(nameSubstring))
}
function readTestNames(src) {
  const names = []
  const re = /(?:^|\n)test\(\s*(['"`])/g
  let m
  while ((m = re.exec(src))) {
    const quote = m[1]
    let i = m.index + m[0].length
    let name = ''
    while (i < src.length && src[i] !== quote) {
      if (src[i] === '\\') { name += src[i + 1]; i += 2 } else { name += src[i]; i += 1 }
    }
    names.push(name)
  }
  return names
}

test('BEHAVIORAL: WORKER REQUEST-INPUT ISOLATION has a real test in workers/api/test/profileAttestationSigning.test.mjs', () => {
  assert.ok(hasTest('workers/api/test/profileAttestationSigning.test.mjs', 'request fields cannot control issuer, keyId, issuedAt, workspaceId'))
})
test('BEHAVIORAL: ADMISSION BEFORE KEY USE has a real test in workers/api/test/profileAttestationSigning.test.mjs', () => {
  assert.ok(hasTest('workers/api/test/profileAttestationSigning.test.mjs', 'admission runs before any key material'))
})
test('BEHAVIORAL: WRONG-PURPOSE KEY REFUSED has a real test in workers/api/test/profileAttestationSigning.test.mjs', () => {
  assert.ok(hasTest('workers/api/test/profileAttestationSigning.test.mjs', 'purpose is refused'))
})
test('BEHAVIORAL: OUTPUT VERIFIES AGAINST FROZEN V4 has a real test in workers/api/test/profileAttestationSigning.test.mjs, cross-checked against the frozen v4 reference verifier', () => {
  assert.ok(hasTest('workers/api/test/profileAttestationSigning.test.mjs', 'VALID + SUPPORTED against the frozen v4 reference verifier'))
})
test('BEHAVIORAL: the product port itself is cross-checked against the frozen v4 vectors in packages/scanner/test/profileAttestationPort.test.mjs', privateScannerOnly, () => {
  assert.ok(hasTest('packages/scanner/test/profileAttestationPort.test.mjs', 'ADMISSION: every frozen v4 case'))
  assert.ok(hasTest('packages/scanner/test/profileAttestationPort.test.mjs', 'ASSESSMENT SCHEMA: every frozen v4 case'))
})
