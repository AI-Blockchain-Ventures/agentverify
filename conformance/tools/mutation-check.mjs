// MUTATION TESTING of the conformance reference. TEST-ONLY. Slow (about two minutes); not part of the gate.
//
//   node conformance/tools/mutation-check.mjs [--only "mutation name|another name"]
//
// It copies conformance/ to a scratch directory, applies ONE small mutation at a time to the REFERENCE (the repository is never
// modified), runs the conformance tests against the mutant, and requires them to FAIL. A mutation the tests do not notice is a
// SURVIVOR.
//
// A survivor is not automatically a reference defect: an EQUIVALENT mutant (one that cannot change observable behaviour) and a weak
// mutation operator both survive. But EVERY survivor must be investigated and explained. Equivalent mutants are listed below WITH the
// reason; any survivor not listed there makes this tool exit non-zero, and so does a mutation whose target text no longer exists.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const scratch = mkdtempSync(path.join(tmpdir(), 'agentverify-mutation-'))
const copy = path.join(scratch, 'conformance')
cpSync(root, copy, { recursive: true })
const R = path.join(copy, 'reference')
const files = ['profileAttestation.mjs', 'jcs.mjs', 'strictJson.mjs', 'numberProfile.mjs', 'domains.mjs']
const orig = Object.fromEntries(files.map(f => [f, readFileSync(path.join(R, f), 'utf8')]))
const TESTS = ['jcs', 'profileAttestation', 'domains'].map(t => path.join(copy, 'test', `${t}.test.mjs`))
const run = () => spawnSync(process.execPath, ['--test', ...TESTS], { encoding: 'utf8' })

const M = []
const m = (name, file, from, to) => M.push({ name, file, from, to })
const A = 'profileAttestation.mjs'
const N = 'numberProfile.mjs'

// ── signatures, digests, domains ────────────────────────────────────────────────────────────
m('signing input drops the domain tag', A, 'return concat(enc.encode(PAYLOAD_TAG), signedBytes(payload))', 'return signedBytes(payload)')
m('assessment digest drops its tag', A, 'concat(enc.encode(ASSESSMENT_TAG), signedBytes(assessment))', 'signedBytes(assessment)')
m('low-S rule removed', A, "if (s > P256_HALF_ORDER) return 'signature.high-s'", "if (false) return 'signature.high-s'")
m('low-S boundary off by one (rejects floor(n/2))', A, "if (s > P256_HALF_ORDER) return 'signature.high-s'", "if (s >= P256_HALF_ORDER) return 'signature.high-s'")
m('low-S boundary off by one (admits floor(n/2)+1)', A, "if (s > P256_HALF_ORDER) return 'signature.high-s'", "if (s > P256_HALF_ORDER + 1n) return 'signature.high-s'")
m('r/s range check removed', A, "if (r < 1n || r >= P256_ORDER || s < 1n || s >= P256_ORDER) return 'signature.range'", '')
m('r/s range check misses s = n', A, 's >= P256_ORDER) return', 's > P256_ORDER) return')
m('signature length not checked', A, "if (bytes.length !== 64) return 'signature.range'", '')
m('signature failure ignored', A, "if (!await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, payloadInput)) return fail('INVALID_SIGNATURE', 'signature')", '')
m('keyId not compared to the embedded key', A, "if (await keyIdOf(attestation.publicKey) !== payload.keyId) return fail('INVALID_SIGNATURE', 'keyId.does-not-match-embedded-key')", '')
m('assessment digest not compared', A, "if (digest !== payload.assessment.digest) return fail('BINDING_MISMATCH', 'binding', { binding: DIGEST_BINDING })", '')
m('cross-checks all skipped', A, 'if (!check.always && !schemaSupported) continue', 'continue')
m('assessment digest tag changed', 'domains.mjs', "tag: 'agentverify-assessment-digest/v1\\n'", "tag: 'agentverify-assessment-digest/v2\\n'")
m('package digest tag is a prefix of the assessment tag', 'domains.mjs', "tag: 'agentverify-skill-package-digest/v1\\n'", "tag: 'agentverify-assessment-digest/v1\\n'")

// ── structure, versions, size ───────────────────────────────────────────────────────────────
m('unknown attestation type accepted', A, "if (payload.attestationType !== ATTESTATION_TYPE) return fail('UNSUPPORTED_TYPE', 'payload.attestationType')", '')
m('unknown payload fields accepted', A, "if (!exactKeys(p, REQUIRED_PAYLOAD_KEYS, ['workspaceId'])) {", 'if (false) {')
m('workspaceId null accepted', A, "if ('workspaceId' in p && (!isNonEmptyString(p.workspaceId)", "if ('workspaceId' in p && p.workspaceId !== null && (!isNonEmptyString(p.workspaceId)")
m('size ceiling removed', A, "if (Buffer.byteLength(input, 'utf8') > maxBundleBytes) return fail('MALFORMED', 'bundle.too-large')", '')
m('size counted in characters, not bytes', A, "Buffer.byteLength(input, 'utf8') > maxBundleBytes", 'input.length > maxBundleBytes')
m('bundleVersion type check removed', A, "if (typeof bundle.bundleVersion !== 'string') return fail('MALFORMED', 'bundle.bundleVersion')", '')
m('unsupported bundleVersion reported as malformed', A, "return fail('UNSUPPORTED_BUNDLE_VERSION', 'bundle.bundleVersion')", "return fail('MALFORMED', 'bundle.bundleVersion')")
m('unsupported bundleVersion accepted', A, "if (!supportedBundleVersions.includes(bundle.bundleVersion)) return fail('UNSUPPORTED_BUNDLE_VERSION', 'bundle.bundleVersion')", '')
m('non-canonical JWK coordinates accepted', A, 'if (!isCanonicalCoordinate(jwk.x) || !isCanonicalCoordinate(jwk.y))', "if (!/^[A-Za-z0-9_-]{43}$/.test(jwk.x) || !/^[A-Za-z0-9_-]{43}$/.test(jwk.y))")
m('keyId thumbprint includes every JWK member', A, 'members = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }', 'members = { ...jwk }')

// ── interpretation and policy ───────────────────────────────────────────────────────────────
m('unknown assessment schema treated as supported', A, "if (!supportedAssessmentSchemas.includes(assessment.schemaVersion)) return 'UNSUPPORTED_SCHEMA'", '')
m('unknown profile framework accepted', A, "if (!registered || registered.framework !== payload.framework) return 'UNSUPPORTED_PROFILE'", "if (!registered) return 'UNSUPPORTED_PROFILE'")
m('unknown profile version accepted', A, "if (!registered.profileVersions.includes(payload.profileVersion)) return 'UNSUPPORTED_PROFILE_VERSION'", '')
m('profile registry inherits from Object.prototype', A, 'Object.hasOwn(supportedProfiles, payload.profile) ? supportedProfiles[payload.profile] : undefined', 'supportedProfiles[payload.profile]')
m('unsupported interpretation can satisfy a policy', A, "if (interpretation !== 'SUPPORTED') failures.push('INTERPRETATION_UNSUPPORTED')", '')
m('revoked can be accepted by a policy', A, "export const ACCEPTABLE_KEY_STATES = Object.freeze(['KEY_ACTIVE', 'KEY_RETIRED'])", "export const ACCEPTABLE_KEY_STATES = Object.freeze(['KEY_ACTIVE', 'KEY_RETIRED', 'KEY_REVOKED'])")
m('default accepts retired keys', A, "export const DEFAULT_ACCEPTED_KEY_STATES = Object.freeze(['KEY_ACTIVE'])", "export const DEFAULT_ACCEPTED_KEY_STATES = Object.freeze(['KEY_ACTIVE', 'KEY_RETIRED'])")
m('NOT_EVALUATED can be accepted', A, "export const ACCEPTABLE_KEY_STATES = Object.freeze(['KEY_ACTIVE', 'KEY_RETIRED'])", "export const ACCEPTABLE_KEY_STATES = Object.freeze(['KEY_ACTIVE', 'KEY_RETIRED', 'NOT_EVALUATED'])")

// ── key state ────────────────────────────────────────────────────────────────────────────────
m('retired reported as active', A, 'return withSequence(KEY_STATE_BY_STATUS[entry.status], check)', "return withSequence(entry.status === 'retired' ? 'KEY_ACTIVE' : KEY_STATE_BY_STATUS[entry.status], check)")
m('issuedAt compared with retiredAt', A, 'return withSequence(KEY_STATE_BY_STATUS[entry.status], check)', "if (entry.status === 'retired' && Date.parse(payload.issuedAt) > Date.parse(entry.retiredAt)) return withSequence('KEY_UNKNOWN', check)\n  return withSequence(KEY_STATE_BY_STATUS[entry.status], check)")
m('issuedAt compared with revokedAt', A, 'return withSequence(KEY_STATE_BY_STATUS[entry.status], check)', "if (entry.status === 'revoked' && Date.parse(payload.issuedAt) < Date.parse(entry.revokedAt)) return withSequence('KEY_ACTIVE', check)\n  return withSequence(KEY_STATE_BY_STATUS[entry.status], check)")
m('key purpose ignored', A, "if (entry.purpose !== PROFILE_KEY_PURPOSE) return withSequence('KEY_PURPOSE_MISMATCH', check)", '')
m('key set issuer not compared', A, "if (payload.issuer !== keySet.issuer) return { keyState: 'KEY_UNKNOWN', keySetSequence: keySet.sequence }", '')
m('key set sequence not validated', A, "if (!isNonNegativeInteger(keySet.sequence) || keySet.sequence < 1) return 'keySet.sequence'", '')
m('key set version not validated', A, "if (keySet.keySetVersion !== KEY_SET_VERSION) return 'keySet.version'", '')
m('key set generatedAt not validated', A, "if (!isCanonicalIso(keySet.generatedAt)) return 'keySet.generatedAt'", '')
m('key set entry purpose not validated', A, "if (!isNonEmptyString(e.purpose)) return 'keySet.entry.purpose'", '')
m('key set entry notBefore not validated', A, "if (!isCanonicalIso(e.notBefore)) return 'keySet.entry.notBefore'", '')
m('key set entry keyId not checked against its key', A, "if (await keyIdOf(e.jwk) !== e.keyId) return 'keySet.entry.keyId-does-not-match-jwk'", '')

// ── ISSUER-SCOPED rollback state ─────────────────────────────────────────────────────────────
m('rollback state ignores the issuer (first value wins)', A, "else if (typeof retained === 'object') value = Object.hasOwn(retained, issuer) ? retained[issuer] : undefined", "else if (typeof retained === 'object') value = Object.values(retained)[0]")
m('rollback state read through the prototype chain', A, "Object.hasOwn(retained, issuer) ? retained[issuer] : undefined", 'retained[issuer]')
m('rollback comparison is off by one (equal counts as behind)', A, "keySet.sequence < retained ? 'BEHIND_RETAINED'", "keySet.sequence <= retained ? 'BEHIND_RETAINED'")
m('rollback detection removed', A, "if (check === 'BEHIND_RETAINED') return withSequence('KEY_SET_ROLLBACK_DETECTED', check)", '')
m('no retained state reported as not-behind (indistinguishable)', A, "retained === undefined ? 'NO_RETAINED_STATE' :", "retained === undefined ? 'NOT_BEHIND_RETAINED' :")
m('a key set for another issuer still consults retained state', A, "if (payload.issuer !== keySet.issuer) return { keyState: 'KEY_UNKNOWN', keySetSequence: keySet.sequence }", "if (payload.issuer !== keySet.issuer) return { keyState: retainedSequenceFor(retainedSequenceByIssuer, payload.issuer) > keySet.sequence ? 'KEY_SET_ROLLBACK_DETECTED' : 'KEY_UNKNOWN', keySetSequence: keySet.sequence }")
m('the removed bare-number option is silently accepted', A, "if ('highestAcceptedKeySetSequence' in options) throw", "if (false) throw")
m('malformed retained state is silently ignored', A, "if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(", 'if (false) throw new TypeError(')

// ── every individual cross-check ─────────────────────────────────────────────────────────────
for (const l of orig[A].split('\n').filter(l => /^\s{2}\{ binding: '[^']+', always/.test(l))) m(`cross-check removed: ${l.match(/binding: '([^']+)'/)[1]}`, A, `${l}\n`, '')
m('cross-check removed: the five interpretation versions', A, "  ...INTERPRETATION_VERSION_KEYS.map(k => ({ binding: `interpretationVersions.${k}`, always: false, payload: p => p.interpretationVersions[k], assessment: a => a.profile?.[k] })),\n", '')

// ── the numeric profile (value-based) ───────────────────────────────────────────────────────
m('numeric rule admits fractions (in-memory)', N, "if (!Number.isInteger(value)) return 'NON_INTEGER'", '')
m('numeric rule admits negative zero (in-memory)', N, "if (Object.is(value, -0)) return 'NEGATIVE_ZERO'", '')
m('numeric rule admits unsafe integers (in-memory)', N, "if (!Number.isSafeInteger(value)) return 'UNSAFE_INTEGER'", '')
m('token: fractions admitted as zero, not refused', N, "return { problem: Number(token) === 0 ? 'UNDERFLOW' : 'NON_INTEGER' }", 'return { value: 0 }')
m('token: fractions admitted as their integer part', N, "return { problem: Number(token) === 0 ? 'UNDERFLOW' : 'NON_INTEGER' }", 'return { value: Math.trunc(Number(token)) }')
m('token: magnitude limit removed', N, "if (integer > MAX_SAFE) return { problem: 'UNSAFE_INTEGER' }", '')
m('token: underflow to zero is not reported', N, "return { problem: Number(token) === 0 ? 'UNDERFLOW' : 'NON_INTEGER' }", "return { problem: 'NON_INTEGER' }")
m('token: negative zero admitted as zero', N, 'return negative ? { problem: \'NEGATIVE_ZERO\' } : { value: 0 }', 'return { value: 0 }')
m('token: exponent length limit lowered (spelling-dependent)', N, 'const DOMINANT_EXPONENT_DIGITS = 30', 'const DOMINANT_EXPONENT_DIGITS = 2')
m('token: exponent read as a double', N, "const exp = expDigits === '' ? 0n : (expNegative ? -BigInt(expDigits) : BigInt(expDigits))", "const exp = BigInt(Math.trunc(Number(expText)))")
m('token: trailing zeros not moved into the exponent', N, 'const significant = noLeading.replace(/0+$/, \'\')', 'const significant = noLeading')
m('token: leading zeros of the exponent count as digits', N, ".replace(/^[+-]/, '').replace(/^0+/, '')", ".replace(/^[+-]/, '')")
m('token: BigInt of the whole digit string (quadratic)', N, 'if (digits + scale > 16n) return { problem: \'UNSAFE_INTEGER\' }', 'BigInt(noLeading)')
m('token: judged through a double (spelling-based, the old approach)', 'strictJson.mjs', 'const r = numberTokenProblem(literal)', "const v0 = Number(literal); const p0 = v0 === 0 && /[1-9]/.test(literal.split(/[eE]/)[0]) ? 'UNDERFLOW' : (Number.isSafeInteger(v0) ? null : (Number.isInteger(v0) ? 'UNSAFE_INTEGER' : 'NON_INTEGER')); const r = p0 ? { problem: p0 } : { value: v0 }")
m('token: only canonical integer spellings admitted (over-strict)', 'strictJson.mjs', 'const r = numberTokenProblem(literal)', "const r = /^-?(0|[1-9][0-9]*)$/.test(literal) ? numberTokenProblem(literal) : { problem: 'NON_INTEGER' }")
m('canonicalizer admission removed', 'jcs.mjs', 'if (admitNumber) {', 'if (false) {')
m('canonicalizer normalizes Unicode strings', 'jcs.mjs', 'return JSON.stringify(v)', "return JSON.stringify(v.normalize('NFC'))")
m('canonicalizer sorts keys by code point', 'jcs.mjs', 'for (const key of [...own].sort()) {', 'for (const key of [...own].sort((x, y) => { const a = [...x].map(c => c.codePointAt(0)), b = [...y].map(c => c.codePointAt(0)); for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length })) {')
m('canonicalizer coerces undefined to null', 'jcs.mjs', "case 'undefined': throw new JcsError('JCS_UNDEFINED', `undefined at ${where}`)", "case 'undefined': return 'null'")
m('parser accepts duplicate keys', 'strictJson.mjs', "if (seen.has(key)) fail('JSON_DUPLICATE_KEY', `duplicate object key ${JSON.stringify(key)}`)", '')

// EQUIVALENT MUTANTS: each of these was investigated and CANNOT change observable behaviour. They are expected to survive.
const EQUIVALENT = {
  'token: size guard loosened (16 -> 22 digits)': 'numberProfile.mjs: the guard only avoids building an integer that the following "integer > MAX_SAFE" check rejects anyway. Raising it to 22 digits still builds only integers of at most 10^22 and rejects the same values; it changes cost, not the result.',
  'token: exponent read as a double': 'numberProfile.mjs: a double is exact for every exponent below 2^53. An exponent of 2^53 or more, which a double cannot hold exactly, has a magnitude that dominates the whole token (a token in a bundle is under 2^25 characters, because bundle text is limited to 16 MiB), so the outcome is decided by its sign alone and rounding the exponent cannot change it. Equivalent under that text-length bound; the exact BigInt reading is kept because it does not depend on the bound.',
  'rollback lookup uses the key set issuer instead of the payload issuer': 'profileAttestation.mjs: at that point payload.issuer === keySet.issuer (a mismatch already returned KEY_UNKNOWN), so the two are the same string.',
}
m('token: size guard loosened (16 -> 22 digits)', N, 'if (digits + scale > 16n)', 'if (digits + scale > 22n)')
m('token: size guard removed (a huge scale reaches BigInt exponentiation)', N, "if (digits + scale > 16n) return { problem: 'UNSAFE_INTEGER' }", '')
m('rollback lookup uses the key set issuer instead of the payload issuer', A, 'retainedSequenceFor(retainedSequenceByIssuer, payload.issuer)', 'retainedSequenceFor(retainedSequenceByIssuer, keySet.issuer)')

// ── run ─────────────────────────────────────────────────────────────────────────────────────
const onlyIdx = process.argv.indexOf('--only')
const only = onlyIdx > 0 ? new Set(process.argv[onlyIdx + 1].split('|')) : null
const selected = M.filter(x => !only || only.has(x.name))

let caught = 0
const survivors = [], missing = []
const baseline = run()
console.log(`baseline on the scratch copy: ${baseline.status === 0 ? 'passes' : 'FAILS'}`)
if (baseline.status !== 0) {
  // With a failing baseline EVERY mutant would look "caught": the result would be meaningless, so stop instead of reporting it.
  console.log(baseline.stdout.split('\n').filter(l => l.startsWith('\u2716')).slice(0, 10).join('\n'))
  rmSync(scratch, { recursive: true, force: true })
  process.exit(2)
}
for (const x of selected) {
  const src = orig[x.file]
  if (!src.includes(x.from)) { missing.push(x.name); console.log('NO TARGET', x.name); continue }
  writeFileSync(path.join(R, x.file), src.replace(x.from, x.to))
  const r = run()
  writeFileSync(path.join(R, x.file), src)
  if (r.status !== 0) { caught++; console.log('CAUGHT  ', x.name) } else { survivors.push(x.name); console.log('SURVIVED', x.name) }
}
rmSync(scratch, { recursive: true, force: true })

const unexplained = survivors.filter(n => !(n in EQUIVALENT))
console.log(`\n${caught}/${selected.length - missing.length} mutations caught`)
for (const n of survivors) console.log(n in EQUIVALENT ? `  equivalent (investigated): ${n}\n    why: ${EQUIVALENT[n]}` : `  UNEXPLAINED SURVIVOR: ${n}`)
if (missing.length) console.log('mutations whose target text no longer exists:', missing.join(' | '))
process.exit(unexplained.length || missing.length ? 1 : 0)
