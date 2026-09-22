// Conformance: the web app's INDEPENDENT client-side port of the scan-attestation verifier
// (src/lib/verifyAttestation.ts) must give exactly the frozen results in conformance/vectors/legacy-attestation.v2.json AND in
// conformance/v3/vectors/legacy-attestation.v3.json, the same files the scanner and the CI stub are checked against. The three
// implementations must agree, in both sets (legacy behaviour is unchanged by v3).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import { legacyCaseInput, loadVector } from '../../../conformance/test/helpers.mjs'
import { legacyCaseInput as legacyCaseInputV3, loadVector as loadVectorV3 } from '../../../conformance/v3/test/helpers.mjs'
import { legacyCaseInput as legacyCaseInputV4, loadVector as loadVectorV4 } from '../../../conformance/v4/test/helpers.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(__dirname, '..', 'src', 'lib', 'verifyAttestation.ts'), 'utf8')
const { code } = transformSync(source, { loader: 'ts', format: 'esm', target: 'node20' })
const { verifyAttestation } = await import('data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64'))

const LEGACY = loadVector('legacy-attestation.v2.json')
const BUNDLES = loadVector('bundles.v2.json')

assert.ok(LEGACY.cases.length >= 40)
for (const c of LEGACY.cases) {
  const { attestation, expectedPublicKey } = legacyCaseInput(LEGACY, BUNDLES, c)
  const result = await verifyAttestation(attestation, expectedPublicKey)
  assert.equal(result.status, c.expected.status, `web port: ${c.name}: ${result.reason ?? ''}`)
}
const LEGACY_V3 = loadVectorV3('legacy-attestation.v3.json')
const BUNDLES_V3 = loadVectorV3('bundles.v3.json')
assert.ok(LEGACY_V3.cases.length >= 40)
for (const c of LEGACY_V3.cases) {
  const { attestation, expectedPublicKey } = legacyCaseInputV3(LEGACY_V3, BUNDLES_V3, c)
  const result = await verifyAttestation(attestation, expectedPublicKey)
  assert.equal(result.status, c.expected.status, `web port (v3): ${c.name}: ${result.reason ?? ''}`)
}
console.log(`conformanceLegacy.test.mjs: web port agrees with ${LEGACY.cases.length} frozen v2 and ${LEGACY_V3.cases.length} v3 legacy vectors`)

const LEGACY_V4 = loadVectorV4('legacy-attestation.v4.json')
const BUNDLES_V4 = loadVectorV4('bundles.v4.json')
assert.ok(LEGACY_V4.cases.length >= 40)
for (const c of LEGACY_V4.cases) {
  const { attestation, expectedPublicKey } = legacyCaseInputV4(LEGACY_V4, BUNDLES_V4, c)
  const result = await verifyAttestation(attestation, expectedPublicKey)
  assert.equal(result.status, c.expected.status, `web port (v4): ${c.name}: ${result.reason ?? ''}`)
}
console.log(`conformanceLegacy.test.mjs: web port also agrees with ${LEGACY_V4.cases.length} v4 legacy vectors`)
