// MUTATION TESTING of the conformance reference (vector set v3). TEST-ONLY. Slow (several minutes); not part of the gate.
//
//   node conformance/v3/tools/mutation-check.mjs [--only "mutation name|another name"]
//
// It copies conformance/v3 to a scratch directory, applies ONE small mutation at a time to the REFERENCE (the repository is never
// modified), runs the conformance tests against the mutant, and requires them to FAIL. A mutation the tests do not notice is a
// SURVIVOR. A mutant that hangs (a quadratic or exponential regression) is killed by a timeout and counts as caught.
//
// A survivor is not automatically a reference defect: an EQUIVALENT mutant (one that cannot change observable behaviour) and a weak
// mutation operator both survive. But EVERY survivor must be investigated and explained. Equivalent mutants are listed below WITH the
// reason; any survivor not listed there makes this tool exit non-zero, and so does a mutation whose target text no longer exists.
//
// v3 adds mutation classes for: the O(n) numeric classifier, the shared depth model, the bytes decoder, the strict timestamp parser,
// the strict policy, the exact assessment schema (every check is mutated automatically), the pinned profile registry, the payload
// field classification, and the cross-check registry.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const scratch = mkdtempSync(path.join(tmpdir(), 'agentverify-mutation-v3-'))
const copy = path.join(scratch, 'v3')
cpSync(root, copy, { recursive: true })
// the tests reach the scanner and the repo root through relative paths; the mutation run needs neither (it runs only the reference tests)
const R = path.join(copy, 'reference')
const files = ['profileAttestation.mjs', 'jcs.mjs', 'strictJson.mjs', 'numberProfile.mjs', 'domains.mjs', 'timestamp.mjs', 'policy.mjs', 'assessmentSchema.mjs', 'profileRegistry.mjs', 'plain.mjs', 'limits.mjs']
const orig = Object.fromEntries(files.map(f => [f, readFileSync(path.join(R, f), 'utf8')]))
const TESTS = ['jcs', 'limits', 'timestamp', 'policy', 'assessment', 'profileAttestation', 'domains'].map(t => path.join(copy, 'test', `${t}.test.mjs`))
const run = () => spawnSync(process.execPath, ['--test', ...TESTS], { encoding: 'utf8', timeout: 120000, killSignal: 'SIGKILL' })

const M = []
const m = (name, file, from, to) => M.push({ name, file, from, to })
const A = 'profileAttestation.mjs', N = 'numberProfile.mjs', J = 'strictJson.mjs', C = 'jcs.mjs', T = 'timestamp.mjs', P = 'policy.mjs', S = 'assessmentSchema.mjs', G = 'profileRegistry.mjs', L = 'limits.mjs', PL = 'plain.mjs', D = 'domains.mjs'

// ── signatures, digests, domains ────────────────────────────────────────────────────────────
m('signing input drops the domain tag', A, 'return concat(enc.encode(PAYLOAD_TAG), signedBytes(payload, { baseDepth: PAYLOAD_BASE_DEPTH }))', 'return signedBytes(payload, { baseDepth: PAYLOAD_BASE_DEPTH })')
m('assessment digest drops its tag', A, 'concat(enc.encode(ASSESSMENT_TAG), signedBytes(assessment, { baseDepth: ASSESSMENT_BASE_DEPTH }))', 'signedBytes(assessment, { baseDepth: ASSESSMENT_BASE_DEPTH })')
m('assessment digest ignores the bundle depth (v2 defect)', A, 'concat(enc.encode(ASSESSMENT_TAG), signedBytes(assessment, { baseDepth: ASSESSMENT_BASE_DEPTH }))', 'concat(enc.encode(ASSESSMENT_TAG), signedBytes(assessment, { baseDepth: 0 }))')
m('signing input ignores the bundle depth', A, '{ baseDepth: PAYLOAD_BASE_DEPTH }', '{ baseDepth: 0 }')
m('admission ignores the bundle depth', A, 'try { signedBytes(assessment, { baseDepth: ASSESSMENT_BASE_DEPTH }) }', 'try { signedBytes(assessment, { baseDepth: 0 }) }')
m('admission skips canonicalization', A, 'try { signedBytes(assessment, { baseDepth: ASSESSMENT_BASE_DEPTH }) }', 'try { void assessment }')
m('admission admits everything', A, "return interpretation === 'SUPPORTED' ? { admitted: true } : { admitted: false, reason: interpretationReason ?? interpretation }", 'return { admitted: true }')
m('low-S rule removed', A, "if (s > P256_HALF_ORDER) return 'signature.high-s'", "if (false) return 'signature.high-s'")
m('low-S boundary off by one (rejects floor(n/2))', A, "if (s > P256_HALF_ORDER) return 'signature.high-s'", "if (s >= P256_HALF_ORDER) return 'signature.high-s'")
m('low-S boundary off by one (admits floor(n/2)+1)', A, "if (s > P256_HALF_ORDER) return 'signature.high-s'", "if (s > P256_HALF_ORDER + 1n) return 'signature.high-s'")
m('r/s range check removed', A, "if (r < 1n || r >= P256_ORDER || s < 1n || s >= P256_ORDER) return 'signature.range'", '')
m('r/s range check misses s = n', A, 's >= P256_ORDER) return', 's > P256_ORDER) return')
m('r/s range check misses r = n', A, 'r >= P256_ORDER ||', 'r > P256_ORDER ||')
m('signature length not checked', A, "if (bytes.length !== 64) return 'signature.range'", '')
m('signature accepted in a non-canonical base64 spelling', A, 'return bytes.length === 64 && bytes.toString(\'base64\') === s ? new Uint8Array(bytes) : null', 'return bytes.length === 64 ? new Uint8Array(bytes) : null')
m('signature alphabet not enforced', A, "!/^[A-Za-z0-9+/]{86}==$/.test(s)", "!/^[A-Za-z0-9+/_-]{86}==$/.test(s)")
m('signature failure ignored', A, "if (!await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, payloadInput)) return fail('INVALID_SIGNATURE', 'signature')", '')
m('keyId not compared to the embedded key', A, "if (await keyIdOf(attestation.publicKey) !== payload.keyId) return fail('INVALID_SIGNATURE', 'keyId.does-not-match-embedded-key')", '')
m('assessment digest not compared', A, "if (digest !== payload.assessment.digest) return fail('BINDING_MISMATCH', 'binding', { binding: DIGEST_BINDING })", '')
m('cross-checks all skipped', A, "if (check.runsWhen === 'schema-supported' && !schemaSupported) continue", 'continue')
m('structure cross-checks run under an unsupported schema', A, "if (check.runsWhen === 'schema-supported' && !schemaSupported) continue", 'if (false) continue')
m('schemaVersion cross-check skipped under an unsupported schema', A, "assessmentPath: 'schemaVersion', runsWhen: 'always' }", "assessmentPath: 'schemaVersion', runsWhen: 'schema-supported' }")
m('assessment digest tag changed', D, "tag: 'agentverify-assessment-digest/v1\\n'", "tag: 'agentverify-assessment-digest/v2\\n'")
m('package digest tag is a prefix of the assessment tag', D, "tag: 'agentverify-skill-package-digest/v1\\n'", "tag: 'agentverify-assessment-digest/v1\\n'")

// ── structure, versions, bytes ──────────────────────────────────────────────────────────────
m('unknown attestation type accepted', A, "if (payload.attestationType !== ATTESTATION_TYPE) return fail('UNSUPPORTED_TYPE', 'payload.attestationType')", '')
m('unknown payload fields accepted', A, 'if (!exactKeys(p, REQUIRED_TOP, OPTIONAL_TOP)) return', 'if (false) return')
m('nested payload objects not closed', A, 'if (!isPlain(value) || !exactKeys(value, children)) return', 'if (false) return')
m('payload field validators skipped', A, 'if (!f.valid(value)) return f.code', '')
m('a missing required payload field is tolerated', A, 'if (value === undefined) { if (f.required) return f.code; continue }', 'if (value === undefined) { continue }')
m('workspaceId null accepted', A, "v => notEmpty(v) && v.length <= 128", "v => v === null || (notEmpty(v) && v.length <= 128)")
m('workspaceId length limit removed', A, 'v.length <= 128', 'v.length <= 100000')
m('payload issuedAt not validated', A, "row('issuedAt', 'payload.issuedAt', v => parseTimestamp(v) !== null,", "row('issuedAt', 'payload.issuedAt', v => true,")
m('payload commit not validated', A, "row('upstream.commit', 'payload.upstream', isCommit,", "row('upstream.commit', 'payload.upstream', v => true,")
m('payload package digest not validated', A, "row('package.digest', 'payload.package', v => typeof v === 'string' && PACKAGE_DIGEST.test(v),", "row('package.digest', 'payload.package', v => true,")
m('payload canonicalization name not enforced', A, "v => v === 'RFC8785'", 'v => true')
m('payload keyId form not enforced', A, "v => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v)", 'v => true')
m('the byte ceiling is not applied', J, "if (bytes.length > maxBytes) return { problem: 'TOO_LARGE' }", '')
m('the byte ceiling is exclusive', J, 'if (bytes.length > maxBytes)', 'if (bytes.length >= maxBytes)')
m('a non-bytes input is coerced', J, "if (!(bytes instanceof Uint8Array)) return { problem: 'NOT_BYTES' }", '')
m('a BOM is decoded past before the size and content checks', J, "if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { problem: 'BOM' }", '')
m('invalid UTF-8 is replaced with U+FFFD (lenient decoding)', J, "{ fatal: true, ignoreBOM: true }", "{ fatal: false, ignoreBOM: true }")
m('the parser accepts a BOM in text', J, "if (text.charCodeAt(0) === 0xfeff) throw new StrictJsonError('JSON_BOM', 'a byte order mark is not allowed', 0)", '')
m('bundleVersion type check removed', A, "if (typeof bundle.bundleVersion !== 'string') return fail('MALFORMED', 'bundle.bundleVersion')", '')
m('unsupported bundleVersion reported as malformed', A, "return fail('UNSUPPORTED_BUNDLE_VERSION', 'bundle.bundleVersion')", "return fail('MALFORMED', 'bundle.bundleVersion')")
m('unsupported bundleVersion accepted', A, "if (!supportedBundleVersions.includes(bundle.bundleVersion)) return fail('UNSUPPORTED_BUNDLE_VERSION', 'bundle.bundleVersion')", '')
m('a bare typed attestation is routed to the legacy verifier', A, "if (!Object.hasOwn(bundle.payload, 'attestationType')) {", "if (!bundle.payload.attestationType) {")
m('non-canonical JWK coordinates accepted', A, 'if (!isCanonicalCoordinate(jwk.x) || !isCanonicalCoordinate(jwk.y))', "if (!/^[A-Za-z0-9_-]{43}$/.test(jwk.x) || !/^[A-Za-z0-9_-]{43}$/.test(jwk.y))")
m('EC coordinate range not checked', A, 'if (!isCoordinateInRange(jwk.x) || !isCoordinateInRange(jwk.y)) return', 'if (false) return')
m('EC coordinate range is inclusive of p', A, '< P256_FIELD_PRIME', '<= P256_FIELD_PRIME')
m('EC y coordinate range not checked', A, '!isCoordinateInRange(jwk.x) || !isCoordinateInRange(jwk.y)', '!isCoordinateInRange(jwk.x)')
m('keyId thumbprint includes every JWK member', A, 'members = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }', 'members = { ...jwk }')
m('unknown verifier options accepted', A, 'if (unknown.length > 0) throw new TypeError(', 'if (false) throw new TypeError(')
m('an unvalidated schema version may be declared supported', A, 'options.supportedAssessmentSchemas !== undefined &&', 'false &&')

// ── interpretation and registry ─────────────────────────────────────────────────────────────
m('unknown assessment schema treated as supported', A, "if (typeof schema !== 'string' || !supportedAssessmentSchemas.includes(schema) || !Object.hasOwn(ASSESSMENT_VALIDATORS, schema)) return { interpretation: 'UNSUPPORTED_SCHEMA' }", "if (typeof schema !== 'string' || !Object.hasOwn(ASSESSMENT_VALIDATORS, schema)) return { interpretation: 'UNSUPPORTED_SCHEMA' }")
m('assessment structure not validated', A, 'const structural = ASSESSMENT_VALIDATORS[schema](assessment)', 'const structural = null')
m('unknown profile / version not refused', A, 'if (found.problem) return { interpretation: found.problem }', 'if (found.problem === "x") return { interpretation: found.problem }')
m('profile definition mismatch ignored', A, "if (mismatch) return { interpretation: 'PROFILE_DEFINITION_MISMATCH', interpretationReason: mismatch }", '')
m('the profile registry is looked up through the prototype chain', G, "typeof profileId === 'string' && Object.hasOwn(registry, profileId) ? registry[profileId] : undefined", "typeof profileId === 'string' ? registry[profileId] : undefined")
m('the profile version is looked up through the prototype chain', G, "typeof profileVersion === 'string' && Object.hasOwn(entry.versions, profileVersion) ? entry.versions[profileVersion] : undefined", "typeof profileVersion === 'string' ? entry.versions[profileVersion] : undefined")
m('the registry is mutable', G, 'return Object.freeze(o)', 'return o')
m('not-implemented controls are not derived from the universe', G, 'const expectedNotImplemented = definition.controlUniverse.filter(c => !definition.implementedControls.includes(c))', 'const expectedNotImplemented = assessment.notImplementedControls')
m('control lists compared without their length', G, 'Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i])', 'Array.isArray(a) && a.every((x, i) => x === b[i])')
m('control lists compared without their order', G, 'a.every((x, i) => x === b[i])', 'a.every(x => b.includes(x))')
for (const line of orig[G].split('\n').filter(l => /^\s+if \(.*\) return 'profile\./.test(l))) {
  const mutated = line.replace(/^(\s*)if \((.*)\) return '/, "$1if (false && ($2)) return '")
  m(`registry pin not enforced: ${line.match(/return '([^']+)'/)[1]}`, G, line, mutated)
}

// ── policy ──────────────────────────────────────────────────────────────────────────────────
m('a non-plain policy is accepted', P, "if (!isPlain(policy) || Object.getOwnPropertySymbols(policy).length > 0) return ['POLICY_NOT_PLAIN']", "if (Object.getOwnPropertySymbols(policy).length > 0) return ['POLICY_NOT_PLAIN']")
m('a symbol-keyed policy is accepted', P, "if (!isPlain(policy) || Object.getOwnPropertySymbols(policy).length > 0) return ['POLICY_NOT_PLAIN']", "if (!isPlain(policy)) return ['POLICY_NOT_PLAIN']")
for (const code of ['POLICY_UNKNOWN_KEY', 'ACCEPTED_KEY_STATES_INVALID', 'REQUIRED_PROFILE_INVALID', 'ALLOWED_UPSTREAM_COMMITS_INVALID', 'REQUIRED_CONTROLS_INVALID', 'REQUIRED_PACKAGE_DIGEST_INVALID', 'MAX_AGE_SECONDS_INVALID', 'NOW_INVALID', 'NOW_REQUIRED']) m(`policy check removed: ${code}`, P, `problems.push('${code}')`, 'void 0')
m('an empty acceptedKeyStates is valid', P, ' && policy.acceptedKeyStates.length > 0', '')
m('an empty allowedUpstreamCommits is valid', P, ' && policy.allowedUpstreamCommits.length > 0', '')
m('policy lists may contain duplicates', PL, 'new Set(a).size === a.length', 'true')
m('policy lists need not be dense arrays', PL, 'isDenseArray(a) && a.every(itemOk)', 'Array.isArray(a) && a.every(itemOk)')
m('an own key is read through the prototype (has = in)', P, 'const has = (o, k) => Object.hasOwn(o, k)', 'const has = (o, k) => k in o')
m('future issuedAt not detected', P, "if (ageMs < 0) failures.push('ISSUED_AT_IN_FUTURE')", 'if (false) failures.push(\'ISSUED_AT_IN_FUTURE\')')
m('the age boundary is exclusive', P, 'else if (ageMs > policy.maxAgeSeconds * 1000)', 'else if (ageMs >= policy.maxAgeSeconds * 1000)')
m('the age boundary is a second too generous', P, 'else if (ageMs > policy.maxAgeSeconds * 1000)', 'else if (ageMs > policy.maxAgeSeconds * 1000 + 1000)')
m('age compared in seconds (drops milliseconds)', P, 'else if (ageMs > policy.maxAgeSeconds * 1000)', 'else if (Math.floor(ageMs / 1000) > policy.maxAgeSeconds)')
m('unsupported interpretation can satisfy a policy', P, "if (interpretation !== 'SUPPORTED') failures.push('INTERPRETATION_UNSUPPORTED')", '')
m('key state not checked against the accepted list', P, 'if (!accepted.includes(keyState)) failures.push', 'if (false) failures.push')
m('required profile not enforced', P, "if (has(policy, 'requiredProfile') && payload.profile !== policy.requiredProfile)", "if (false)")
m('allowed commits not enforced', P, "!policy.allowedUpstreamCommits.includes(payload.upstream.commit)", 'false')
m('required controls need only ONE match', P, 'policy.requiredControls.every(c => payload.implementedControls.includes(c))', 'policy.requiredControls.some(c => payload.implementedControls.includes(c))')
m('required package digest not enforced', P, 'payload.package.digest !== policy.requiredPackageDigest', 'false')
m('revoked can be accepted by a policy', P, "export const ACCEPTABLE_KEY_STATES = Object.freeze(['KEY_ACTIVE', 'KEY_RETIRED'])", "export const ACCEPTABLE_KEY_STATES = Object.freeze(['KEY_ACTIVE', 'KEY_RETIRED', 'KEY_REVOKED'])")
m('default accepts retired keys', P, "export const DEFAULT_ACCEPTED_KEY_STATES = Object.freeze(['KEY_ACTIVE'])", "export const DEFAULT_ACCEPTED_KEY_STATES = Object.freeze(['KEY_ACTIVE', 'KEY_RETIRED'])")
m('NOT_EVALUATED can be accepted', P, "export const ACCEPTABLE_KEY_STATES = Object.freeze(['KEY_ACTIVE', 'KEY_RETIRED'])", "export const ACCEPTABLE_KEY_STATES = Object.freeze(['KEY_ACTIVE', 'KEY_RETIRED', 'NOT_EVALUATED'])")

// ── key state ───────────────────────────────────────────────────────────────────────────────
m('retired reported as active', A, 'return withSequence(KEY_STATE_BY_STATUS[entry.status], check)', "return withSequence(entry.status === 'retired' ? 'KEY_ACTIVE' : KEY_STATE_BY_STATUS[entry.status], check)")
m('issuedAt compared with retiredAt', A, 'return withSequence(KEY_STATE_BY_STATUS[entry.status], check)', "if (entry.status === 'retired' && parseTimestamp(payload.issuedAt).ms > parseTimestamp(entry.retiredAt).ms) return withSequence('KEY_UNKNOWN', check)\n  return withSequence(KEY_STATE_BY_STATUS[entry.status], check)")
m('issuedAt compared with revokedAt', A, 'return withSequence(KEY_STATE_BY_STATUS[entry.status], check)', "if (entry.status === 'revoked' && parseTimestamp(payload.issuedAt).ms < parseTimestamp(entry.revokedAt).ms) return withSequence('KEY_ACTIVE', check)\n  return withSequence(KEY_STATE_BY_STATUS[entry.status], check)")
m('key purpose ignored', A, "if (entry.purpose !== PROFILE_KEY_PURPOSE) return withSequence('KEY_PURPOSE_MISMATCH', check)", '')
m('key purpose compared case-insensitively', A, 'if (entry.purpose !== PROFILE_KEY_PURPOSE)', 'if (entry.purpose.toLowerCase() !== PROFILE_KEY_PURPOSE)')
m('key purpose compared after trimming', A, 'if (entry.purpose !== PROFILE_KEY_PURPOSE)', 'if (entry.purpose.trim() !== PROFILE_KEY_PURPOSE)')
m('key set issuer not compared', A, "if (payload.issuer !== keySet.issuer) return { keyState: 'KEY_UNKNOWN', keySetSequence: keySet.sequence }", '')
for (const [name, from] of [
  ['sequence', "if (!isPositiveSafeInteger(keySet.sequence)) return 'keySet.sequence'"], ['version', "if (keySet.keySetVersion !== KEY_SET_VERSION) return 'keySet.version'"],
  ['generatedAt', "if (parseTimestamp(keySet.generatedAt) === null) return 'keySet.generatedAt'"], ['issuer', "if (!isNonEmptyString(keySet.issuer)) return 'keySet.issuer'"], ['keys array', "if (!isDenseArray(keySet.keys)) return 'keySet.keys'"],
  ['entry purpose', "if (!isNonEmptyString(e.purpose)) return 'keySet.entry.purpose'"], ['entry status', "if (!KEY_STATUSES.includes(e.status)) return 'keySet.entry.status'"], ['entry notBefore', "if (parseTimestamp(e.notBefore) === null) return 'keySet.entry.notBefore'"],
  ['entry date presence', "if ((e.status === 'retired') !== Object.hasOwn(e, 'retiredAt') || (e.status === 'revoked') !== Object.hasOwn(e, 'revokedAt')) return 'keySet.entry.dates'"],
  ['entry retiredAt form', "if (Object.hasOwn(e, 'retiredAt') && parseTimestamp(e.retiredAt) === null) return 'keySet.entry.dates'"], ['entry revokedAt form', "if (Object.hasOwn(e, 'revokedAt') && parseTimestamp(e.revokedAt) === null) return 'keySet.entry.dates'"],
  ['entry jwk', "if (!checkP256PublicJwk(e.jwk).ok) return 'keySet.entry.jwk'"], ['entry keyId', "if (await keyIdOf(e.jwk) !== e.keyId) return 'keySet.entry.keyId-does-not-match-jwk'"], ['entry duplicate', "if (seen.has(e.keyId)) return 'keySet.entry.duplicate'"],
]) m(`key set check removed: ${name}`, A, from, '')

// ── ISSUER-SCOPED rollback state ────────────────────────────────────────────────────────────
m('rollback state ignores the issuer (first value wins)', A, "else if (typeof retained === 'object') value = Object.hasOwn(retained, issuer) ? retained[issuer] : undefined", "else if (typeof retained === 'object') value = Object.values(retained)[0]")
m('rollback state read through the prototype chain', A, 'Object.hasOwn(retained, issuer) ? retained[issuer] : undefined', 'retained[issuer]')
m('rollback comparison is off by one (equal counts as behind)', A, "keySet.sequence < retained ? 'BEHIND_RETAINED'", "keySet.sequence <= retained ? 'BEHIND_RETAINED'")
m('rollback detection removed', A, "if (check === 'BEHIND_RETAINED') return withSequence('KEY_SET_ROLLBACK_DETECTED', check)", '')
m('no retained state reported as not-behind (indistinguishable)', A, "retained === undefined ? 'NO_RETAINED_STATE' :", "retained === undefined ? 'NOT_BEHIND_RETAINED' :")
m('a key set for another issuer still consults retained state', A, "if (payload.issuer !== keySet.issuer) return { keyState: 'KEY_UNKNOWN', keySetSequence: keySet.sequence }", "if (payload.issuer !== keySet.issuer) return { keyState: retainedSequenceFor(retainedSequenceByIssuer, payload.issuer) > keySet.sequence ? 'KEY_SET_ROLLBACK_DETECTED' : 'KEY_UNKNOWN', keySetSequence: keySet.sequence }")
m('the removed bare-number option is silently accepted', A, "if (Object.hasOwn(options, 'highestAcceptedKeySetSequence')) throw", 'if (false) throw')
m('malformed retained state is silently ignored', A, 'if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(', 'if (false) throw new TypeError(')

// ── every individual cross-check, and the payload classification ────────────────────────────
for (const l of orig[A].split('\n').filter(l => /^\s{2}\{ binding: '[^']+', payloadField/.test(l))) m(`cross-check removed: ${l.match(/binding: '([^']+)'/)[1]}`, A, `${l}\n`, '')
m('cross-check removed: the five interpretation versions', A, "  ...INTERPRETATION_VERSION_KEYS.map(k => ({ binding: `interpretationVersions.${k}`, payloadField: `interpretationVersions.${k}`, assessmentPath: `profile.${k}`, runsWhen: 'schema-supported' })),\n", '')
m('cross-check reads the wrong assessment field (fileCount)', A, "assessmentPath: 'package.fileCount'", "assessmentPath: 'package.digest'")
m('a cross-checked row names a check that does not exist', A, "row('profileVersion', 'payload.profileVersion', isSemver, CROSS('profileVersion'))", "row('profileVersion', 'payload.profileVersion', isSemver, CROSS('profileVersionX'))")
m('an independent row loses its reason', A, "row('issuer', 'payload.issuer', notEmpty, INDEPENDENT('The signer namespace claim. It scopes key-set lookup and retained sequence state; it is not a property of the assessment.'))", "row('issuer', 'payload.issuer', notEmpty, INDEPENDENT(''))")
m('a payload field is added without classification', A, "row('keyId', 'payload.keyId',", "row('extraUnclassified', 'payload.extra', v => true, { kind: 'unclassified' }),\n  row('keyId', 'payload.keyId',")
m('cross-check comparison ignores type (loose equality)', A, 'const sameValue = (x, y) => x !== undefined && JSON.stringify(x) === JSON.stringify(y)', 'const sameValue = (x, y) => x !== undefined && String(x) == String(y)')
m('a cross-check with an undefined assessment value passes', A, 'const sameValue = (x, y) => x !== undefined && JSON.stringify(x) === JSON.stringify(y)', 'const sameValue = (x, y) => JSON.stringify(x) === JSON.stringify(y)')

// ── the exact assessment schema: EVERY check is mutated (automatically) ─────────────────────
for (const line of orig[S].split('\n').filter(l => /^\s+if \(.*\) return '/.test(l) && /assessment\.schema\./.test(l))) {
  const mutated = line.replace(/^(\s*)if \((.*)\) return '/, "$1if (false && ($2)) return '")
  m(`schema check removed: ${line.trim().slice(0, 90)}`, S, line, mutated)
}
m('schema: control status rule mutated (gap wins over not-assessed)', S, "const expectedStatus = counts.GAP_IDENTIFIED > 0 ? 'GAP_IDENTIFIED' : counts.NOT_ASSESSED > 0 ? 'NOT_ASSESSED' : 'EVIDENCE_OBSERVED'", "const expectedStatus = counts.NOT_ASSESSED > 0 ? 'NOT_ASSESSED' : counts.GAP_IDENTIFIED > 0 ? 'GAP_IDENTIFIED' : 'EVIDENCE_OBSERVED'")
m('schema: control set compared without order', S, 'controlIds.some((id, i) => id !== p.implementedControls[i])', 'controlIds.some(id => !p.implementedControls.includes(id))')
m('schema: an enum admits an extra value (axis)', S, "'sbom', 'metadata'])", "'sbom', 'metadata', 'other'])")
m('schema: an enum admits an extra value (upstream severity)', S, "['Critical', 'High', 'Medium']", "['Critical', 'High', 'Medium', 'Low']")
m('schema: an enum admits an extra value (confidence)', S, "export const CONFIDENCES = Object.freeze(['high', 'medium', 'low'])", "export const CONFIDENCES = Object.freeze(['high', 'medium', 'low', 'certain'])")
m('schema: facts admit nested values', S, "const isFact = v => typeof v === 'boolean' || isString(v) || (typeof v === 'number' && numberProblem(v) === null) || (isDenseArray(v) && v.every(isString))", 'const isFact = v => true')
m('schema: facts admit non-integer numbers', S, "(typeof v === 'number' && numberProblem(v) === null)", "typeof v === 'number'")
m('schema: location line may be zero', PL, 'export const isPositiveSafeInteger = n => typeof n === \'number\' && numberProblem(n) === null && n >= 1', "export const isPositiveSafeInteger = n => typeof n === 'number' && numberProblem(n) === null && n >= 0")
m('schema: counts may be negative', PL, 'numberProblem(n) === null && n >= 0', 'numberProblem(n) === null')
m('helpers: unknown keys allowed', PL, 'keys.every(k => required.includes(k) || optional.includes(k))', 'true')
m('helpers: required keys not required', PL, 'required.every(k => Object.hasOwn(o, k))', 'true')
m('helpers: symbol keys allowed', PL, 'if (Object.getOwnPropertySymbols(o).length > 0) return false', '')
m('helpers: non-plain objects accepted', PL, 'export const isPlain = v => typeof v === \'object\' && v !== null && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)', "export const isPlain = v => typeof v === 'object' && v !== null && !Array.isArray(v)")
m('helpers: array subclasses and extra properties accepted', PL, "if (!Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype) return false", 'if (!Array.isArray(v)) return false')
m('helpers: sparse arrays accepted', PL, 'return keys.length === v.length && keys.every((k, i) => k === String(i))', 'return true')
m('helpers: an inherited property is read (own)', PL, "export const own = (o, key) => (typeof o === 'object' && o !== null && Object.hasOwn(o, key) ? o[key] : undefined)", "export const own = (o, key) => (typeof o === 'object' && o !== null ? o[key] : undefined)")

// ── timestamps ──────────────────────────────────────────────────────────────────────────────
m('timestamp: leap years mistaken (every fourth year)', T, 'export const isLeapYear = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0', 'export const isLeapYear = y => y % 4 === 0')
m('timestamp: century rule mistaken (no 400 exception)', T, 'export const isLeapYear = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0', 'export const isLeapYear = y => y % 4 === 0 && y % 100 !== 0')
m('timestamp: every month has 31 days', T, 'd > daysInMonth(y, mo)', 'd > 31')
m('timestamp: month 13 admitted', T, 'mo > 12 ||', 'mo > 13 ||')
m('timestamp: hour 24 admitted', T, 'h > 23 ||', 'h > 24 ||')
m('timestamp: minute 60 admitted', T, 'mi > 59 ||', 'mi > 60 ||')
m('timestamp: leap second admitted', T, 'sec > 59)', 'sec > 60)')
m('timestamp: year 0 admitted', T, 'if (y < 1 ||', 'if (y < 0 ||')
m('timestamp: month 0 admitted', T, '|| mo < 1 ||', '|| mo < 0 ||')
m('timestamp: day 0 admitted', T, '|| d < 1 ||', '|| d < 0 ||')
for (const f of ['h', 'mi', 'sec', 'ms']) m(`timestamp: a non-digit in the ${f} field is not refused`, T, ` ${f} < 0`, ' false')
m('timestamp: a non-digit in the year field is not refused', T, 'if (y < 1 ||', 'if (false ||')
m('timestamp: a non-digit in the day field is not refused', T, '|| d < 1 ||', '|| false ||')
m('timestamp: length not checked', T, "typeof s !== 'string' || s.length !== 24", "typeof s !== 'string'")
for (const [i, ch] of [[4, '-'], [7, '-'], [10, 'T'], [13, ':'], [16, ':'], [19, '.'], [23, 'Z']]) m(`timestamp: separator at ${i} not checked`, T, `s[${i}] !== '${ch}'`, 'false')
m('timestamp: a boxed or non-string is coerced', T, "typeof s !== 'string' ||", 'false ||')
m('timestamp: days-from-civil month offset wrong', T, 'm + (m > 2 ? -3 : 9)', 'm + (m > 2 ? -2 : 9)')
m('timestamp: milliseconds dropped', T, '+ sec * 1000 + ms }', '+ sec * 1000 }')

// ── the numeric profile: the O(n) classifier ────────────────────────────────────────────────
m('numeric rule admits fractions (in-memory)', N, "if (!Number.isInteger(value)) return 'NON_INTEGER'", '')
m('numeric rule admits negative zero (in-memory)', N, "if (Object.is(value, -0)) return 'NEGATIVE_ZERO'", '')
m('numeric rule admits unsafe integers (in-memory)', N, "if (!Number.isSafeInteger(value)) return 'UNSAFE_INTEGER'", '')
m('numeric rule admits non-finite numbers (in-memory)', N, "if (!Number.isFinite(value)) return 'NON_FINITE'", '')
m('token: a leading zero followed by digits is accepted', N, 'if (integerLength === 1 && c0 === ZERO && isDigit(at(i))) return bad', '')
m('token: an empty fraction is accepted', N, "i++; fractionStart = i\n    if (!isDigit(at(i))) return bad", 'i++; fractionStart = i')
m('token: an empty exponent is accepted', N, "if (!isDigit(at(i))) return bad\n    let significant = 0", 'let significant = 0')
m('token: trailing garbage is accepted', N, "if (i !== length) return bad // the whole token must have been one number", '')
m('token: negative zero admitted as zero', N, "if (firstNonzero < 0) return negative ? { problem: 'NEGATIVE_ZERO' } : { value: 0 }", 'if (firstNonzero < 0) return { value: 0 }')
m('token: every zero is refused (positive zero too)', N, "if (firstNonzero < 0) return negative ? { problem: 'NEGATIVE_ZERO' } : { value: 0 }", "if (firstNonzero < 0) return { problem: 'NEGATIVE_ZERO' }")
m('token: huge exponent signs swapped', N, "if (exponentHuge) return { problem: exponentNegative ? 'NON_INTEGER' : 'UNSAFE_INTEGER' }", "if (exponentHuge) return { problem: exponentNegative ? 'UNSAFE_INTEGER' : 'NON_INTEGER' }")
m('token: huge exponent not handled', N, "if (exponentHuge) return { problem: exponentNegative ? 'NON_INTEGER' : 'UNSAFE_INTEGER' }", '')
m('token: a negative scale is admitted (fractions rounded)', N, "if (scale < 0) return { problem: 'NON_INTEGER' }", '')
m('token: only scale below -1 is refused', N, "if (scale < 0) return { problem: 'NON_INTEGER' }", "if (scale < -1) return { problem: 'NON_INTEGER' }")
m('token: digit-count bound too tight (15)', N, 'if (significantDigits + scale > 16)', 'if (significantDigits + scale > 15)')
m('token: digit-count bound removed (attacker-sized scale reaches BigInt)', N, "if (significantDigits + scale > 16) return { problem: 'UNSAFE_INTEGER' }", '')
m('token: magnitude limit removed', N, "if (integer > MAX_SAFE) return { problem: 'UNSAFE_INTEGER' }", '')
m('token: magnitude limit is inclusive of 2^53', N, 'if (integer > MAX_SAFE)', 'if (integer > MAX_SAFE + 1n)')
m('token: magnitude limit is exclusive of 2^53 - 1', N, 'if (integer > MAX_SAFE)', 'if (integer >= MAX_SAFE)')
m('token: scale ignores trailing zeros', N, '- fractionLength + trailingZeros', '- fractionLength')
m('token: scale ignores the fraction length', N, '- fractionLength + trailingZeros', '+ trailingZeros')
m('token: exponent sign ignored', N, '(exponentNegative ? -exponent : exponent)', 'exponent')
m('token: trailing zero count off by one', N, 'const trailingZeros = totalDigits - 1 - lastNonzero', 'const trailingZeros = totalDigits - lastNonzero')
m('token: significant digit count off by one', N, 'const significantDigits = lastNonzero - firstNonzero + 1', 'const significantDigits = lastNonzero - firstNonzero')
m('token: trailing zeros are not tracked in the integer part', N, 'for (let c = at(i); isDigit(c); c = at(i)) { if (c !== ZERO) lastNonzero = digitIndex; digitIndex++; i++ }', 'for (let c = at(i); isDigit(c); c = at(i)) { lastNonzero = digitIndex; digitIndex++; i++ }')
m('token: trailing zeros are not tracked in the fraction', N, 'if (c !== ZERO) { if (firstNonzero < 0) firstNonzero = digitIndex; lastNonzero = digitIndex }', 'if (c !== ZERO) { if (firstNonzero < 0) firstNonzero = digitIndex }\n      lastNonzero = digitIndex')
m('token: the first nonzero digit is not tracked in the fraction', N, 'if (firstNonzero < 0) firstNonzero = digitIndex; lastNonzero = digitIndex', 'lastNonzero = digitIndex')
m('token: fraction digits read from the integer offset', N, 'k < integerLength ? intStart + k : fractionStart + (k - integerLength)', 'intStart + k')
m('token: the value ignores its scale', N, 'BigInt(digits) * 10n ** BigInt(scale)', 'BigInt(digits)')
m('token: the sign is ignored', N, 'const value = Number(negative ? -integer : integer)', 'const value = Number(integer)')
m('token: the minus sign is not detected', N, 'const negative = at(0) === MINUS', 'const negative = false')
m('token: exponent digit count limit too low (spelling-dependent)', N, 'const EXPONENT_DIGITS_EXACT = 15', 'const EXPONENT_DIGITS_EXACT = 3')
m('token: leading zeros of the exponent count as significant', N, 'if (significant > 0 || c !== ZERO) {', 'if (true) {')
m('token: interior zeros of the exponent dropped', N, 'if (significant > 0 || c !== ZERO) {', 'if (c !== ZERO) {')
m('token: an explicit plus in the exponent is a minus', N, 'if (s === PLUS || s === MINUS) { exponentNegative = s === MINUS; i++ }', 'if (s === PLUS || s === MINUS) { exponentNegative = true; i++ }')
m('token: the scan does not stop at the end of the number', N, "if (at(i) === DOT && isDigit(at(i + 1))) { i++; while (isDigit(at(i))) i++ }", 'if (at(i) === DOT) { i++; while (isDigit(at(i))) i++ }')
m('token: the scan accepts a leading plus', N, 'if (at(i) === MINUS) i++\n  const first = at(i)', 'if (at(i) === MINUS || at(i) === PLUS) i++\n  const first = at(i)')
m('token: the scan accepts leading zeros', N, "if (first === ZERO) i++\n  else if (first >= ONE && first <= NINE) { i++; while (isDigit(at(i))) i++ }", 'if (first === ZERO) { i++; while (isDigit(at(i))) i++ }\n  else if (first >= ONE && first <= NINE) { i++; while (isDigit(at(i))) i++ }')
m('token: the classifier uses a regular expression (a quadratic trailing-zero strip)', N, "const integerLength = digitIndex", "const integerLength = digitIndex; void '1000'.replace(/0+$/, '')")
m('the parser: negative zero not refused', J, "if (r.problem === 'NEGATIVE_ZERO') fail('JSON_NUMBER_NEGATIVE_ZERO', 'negative zero is not admitted in signed content')", '')
m('the parser: unsafe integers reported as not integral', J, "if (r.problem === 'UNSAFE_INTEGER') fail('JSON_NUMBER_UNSAFE_INTEGER', 'the exact integer value is outside +/-(2^53 - 1)')", '')
m('the parser: numbers judged through a double', J, 'const r = numberTokenProblem(literal)', "const v0 = Number(literal); const r = Number.isSafeInteger(v0) && !Object.is(v0, -0) ? { value: v0 } : { problem: Number.isInteger(v0) ? 'UNSAFE_INTEGER' : 'NON_INTEGER' }")
m('the parser: only canonical integer spellings admitted (over-strict)', J, 'const r = numberTokenProblem(literal)', "const r = /^-?(0|[1-9][0-9]*)$/.test(literal) ? numberTokenProblem(literal) : { problem: 'NON_INTEGER' }")
m('the parser: duplicate keys accepted', J, "if (seen.has(key)) fail('JSON_DUPLICATE_KEY', `duplicate object key ${JSON.stringify(key)}`)", '')
m('the parser: lone surrogates accepted', J, "if (!isWellFormedString(out)) fail('JSON_ILL_FORMED_STRING', 'string contains a lone surrogate')", '')
m('the parser: trailing content accepted', J, "if (i < text.length) fail('JSON_TRAILING', 'unexpected content after the JSON value')", '')

// ── the shared depth model ──────────────────────────────────────────────────────────────────
m('depth limit is 65', L, 'export const MAX_JSON_DEPTH = 64', 'export const MAX_JSON_DEPTH = 65')
m('depth limit is exclusive', L, 'absoluteDepth > MAX_JSON_DEPTH', 'absoluteDepth >= MAX_JSON_DEPTH')
m('assessment base depth is zero', L, 'export const ASSESSMENT_BASE_DEPTH = BUNDLE_ROOT_DEPTH', 'export const ASSESSMENT_BASE_DEPTH = 0')
m('payload base depth equals the bundle root', L, 'export const PAYLOAD_BASE_DEPTH = BUNDLE_ROOT_DEPTH + 1', 'export const PAYLOAD_BASE_DEPTH = BUNDLE_ROOT_DEPTH')
m('bundle byte ceiling changed', L, 'export const MAX_BUNDLE_BYTES = 16 * 1024 * 1024', 'export const MAX_BUNDLE_BYTES = 32 * 1024 * 1024')
m('the parser does not count an array level', J, "if (ch === '[') return parseArray(depth + 1)", "if (ch === '[') return parseArray(depth)")
m('the parser does not count an object level', J, "if (ch === '{') return parseObject(depth + 1)", "if (ch === '{') return parseObject(depth)")
m('the parser has no array depth limit', J, 'function parseArray(depth) {\n    if (exceedsDepth(depth)) fail(', 'function parseArray(depth) {\n    if (false) fail(')
m('the parser has no object depth limit', J, 'function parseObject(depth) {\n    if (exceedsDepth(depth)) fail(', 'function parseObject(depth) {\n    if (false) fail(')
m('the parser ignores its base depth', J, 'const value = parseValue(baseDepth)', 'const value = parseValue(0)')
m('the canonicalizer ignores its base depth', C, "return ser(value, baseDepth + 1, '$')", "return ser(value, 1, '$')")
m('the canonicalizer has no depth limit', C, "if (exceedsDepth(depth)) throw new JcsError('JCS_TOO_DEEP'", "if (false) throw new JcsError('JCS_TOO_DEEP'")
m('the canonicalizer does not count array levels', C, "ser(item, depth + 1, `${where}[${idx}]`)", "ser(item, depth, `${where}[${idx}]`)")
m('the canonicalizer does not count object levels', C, 'ser(d.value, depth + 1, `${where}.${key}`)', 'ser(d.value, depth, `${where}.${key}`)')

// ── the serializer ──────────────────────────────────────────────────────────────────────────
m('canonicalizer admission removed', C, 'if (admitNumber) {', 'if (false) {')
m('canonicalizer normalizes Unicode strings', C, 'return JSON.stringify(v)', "return JSON.stringify(v.normalize('NFC'))")
m('canonicalizer sorts keys by code point', C, 'for (const key of [...own].sort()) {', 'for (const key of [...own].sort((x, y) => { const a = [...x].map(c => c.codePointAt(0)), b = [...y].map(c => c.codePointAt(0)); for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length })) {')
m('canonicalizer coerces undefined to null', C, "case 'undefined': throw new JcsError('JCS_UNDEFINED', `undefined at ${where}`)", "case 'undefined': return 'null'")

// EQUIVALENT MUTANTS: each of these was investigated and CANNOT change observable behaviour. They are expected to survive.
const EQUIVALENT = {
  'signature alphabet not enforced': 'profileAttestation.mjs: widening the alphabet of the pre-check regular expression to admit the URL-safe characters changes nothing, because Node\'s base64 decoder reads "-" and "_" as their standard counterparts and the following canonical re-encoding test (bytes.toString("base64") === s) then refuses the text (it re-encodes with "+" and "/"). The pre-check is a cheap early refusal; the re-encoding test is the authoritative one, and the url-safe vectors reach it.',
  'a missing required payload field is tolerated': 'profileAttestation.mjs: by the time the per-field loop runs, exactKeys has already refused a payload that lacks a required top-level key and the container check has refused one that lacks a required nested key, so a required leaf is never undefined there. The in-loop test is defence in depth; the missing-field vectors are refused earlier.',
  'a cross-check with an undefined assessment value passes': 'profileAttestation.mjs: the payload value x is never undefined (the payload validator requires every cross-checked field), so "x !== undefined" is always true; an undefined ASSESSMENT value is still refused because JSON.stringify(undefined) is undefined, which never equals the string a defined payload value stringifies to.',
  "schema check removed: if (seenControls.has(c.controlId)) return 'assessment.schema.controls'": 'assessmentSchema.mjs: a duplicated control id is still refused, with the SAME reason code, by the later comparison of the control ids with profile.implementedControls (which is a duplicate-free list, checked in order). The early exit is a clearer refusal, not an additional one.',
  'token: a leading zero followed by digits is accepted': 'numberProfile.mjs: after a leading "0" the integer loop consumes nothing, so a following digit is left over and the final "i !== length" test refuses the token as NOT_A_NUMBER anyway. The explicit test only names the case earlier.',
  'token: huge exponent not handled': 'numberProfile.mjs: with the shortcut removed, the exponent keeps its first 15 significant digits, which is still at least 10^14, larger than any string a JavaScript engine can hold, so the same dominance decision (UNSAFE_INTEGER for a positive exponent, NON_INTEGER for a negative one) falls out of the scale arithmetic. The shortcut states the reason explicitly and avoids arithmetic on a truncated value.',
  'rollback lookup uses the key set issuer instead of the payload issuer': 'profileAttestation.mjs: at that point payload.issuer === keySet.issuer (a mismatch already returned KEY_UNKNOWN), so the two are the same string.',
  'token: exponent digit count limit raised (15 -> 25)': 'numberProfile.mjs: an exponent of 16 or more significant digits is at least 10^15, larger than any string a JavaScript engine can hold (maximum string length below 2^30), so it dominates the whole token and its sign alone decides the outcome; a double that no longer represents it exactly changes neither the sign nor the dominance. Equivalent under that engine bound.',
  'token: the final numberProblem cross-check is skipped': 'numberProfile.mjs: at that point the value is an exact safe integer other than negative zero (the non-zero digit run and a positive scale were established, and the magnitude was compared with MAX_SAFE), so numberProblem(value) is always null. It is a defensive assertion that the two entry points agree.',
  'the decoder does not strip a leading BOM (ignoreBOM true -> false)': 'strictJson.mjs: any input beginning with the BOM bytes is already refused as BOM before the decoder runs, so the decoder never sees a leading BOM and ignoreBOM cannot matter. (Kept true so a U+FEFF that is not first is never stripped either.)',
  'signature length regex check is redundant': 'profileAttestation.mjs: the regular expression /^[A-Za-z0-9+/]{86}==$/ already fixes the length at 88, so the explicit length test cannot change the outcome.',
}
m('token: exponent digit count limit raised (15 -> 25)', N, 'const EXPONENT_DIGITS_EXACT = 15', 'const EXPONENT_DIGITS_EXACT = 25')
m('token: digit-count bound loosened (16 -> 17)', N, 'if (significantDigits + scale > 16)', 'if (significantDigits + scale > 17)')
m('token: the final numberProblem cross-check is skipped', N, "return numberProblem(value) === null ? { value } : { problem: 'NON_INTEGER' }", 'return { value }')
m('the decoder does not strip a leading BOM (ignoreBOM true -> false)', J, "{ fatal: true, ignoreBOM: true }", "{ fatal: true, ignoreBOM: false }")
m('rollback lookup uses the key set issuer instead of the payload issuer', A, 'retainedSequenceFor(retainedSequenceByIssuer, payload.issuer)', 'retainedSequenceFor(retainedSequenceByIssuer, keySet.issuer)')
m('signature length regex check is redundant', A, "s.length !== 88 || ", '')
m('allowed commits use startsWith instead of equality', P, '!policy.allowedUpstreamCommits.includes(payload.upstream.commit)', '!policy.allowedUpstreamCommits.some(c => payload.upstream.commit.startsWith(c))')

// ── run ─────────────────────────────────────────────────────────────────────────────────────
const onlyIdx = process.argv.indexOf('--only')
const only = onlyIdx > 0 ? new Set(process.argv[onlyIdx + 1].split('|')) : null
// --match "text": a plain-text substring filter (mutation names may contain "|", which --only uses as its separator)
const matchIdx = process.argv.indexOf('--match')
const match = matchIdx > 0 ? process.argv[matchIdx + 1] : null
const selected = M.filter(x => (!only || only.has(x.name)) && (!match || x.name.includes(match)))

let caught = 0
const survivors = [], missing = [], duplicates = []
const seenNames = new Set()
for (const x of M) { if (seenNames.has(x.name)) duplicates.push(x.name); seenNames.add(x.name) }
const baseline = run()
console.log(`baseline on the scratch copy: ${baseline.status === 0 ? 'passes' : 'FAILS'}`)
if (baseline.status !== 0) {
  // With a failing baseline EVERY mutant would look "caught": the result would be meaningless, so stop instead of reporting it.
  console.log((baseline.stdout ?? '').split('\n').filter(l => l.startsWith('✖')).slice(0, 10).join('\n'))
  rmSync(scratch, { recursive: true, force: true })
  process.exit(2)
}
for (const x of selected) {
  const src = orig[x.file]
  if (!src.includes(x.from)) { missing.push(x.name); console.log('NO TARGET', x.name); continue }
  writeFileSync(path.join(R, x.file), src.replace(x.from, () => x.to))
  const r = run()
  writeFileSync(path.join(R, x.file), src)
  const killedByTimeout = r.error && r.error.code === 'ETIMEDOUT'
  if (r.status !== 0 || killedByTimeout) { caught++; console.log(killedByTimeout ? 'CAUGHT (timeout)' : 'CAUGHT  ', x.name) } else { survivors.push(x.name); console.log('SURVIVED', x.name) }
}
rmSync(scratch, { recursive: true, force: true })

const unexplained = survivors.filter(n => !(n in EQUIVALENT))
const notSurvivedButListed = Object.keys(EQUIVALENT).filter(n => selected.some(x => x.name === n) && !survivors.includes(n))
console.log(`\n${caught}/${selected.length - missing.length} mutations caught`)
for (const n of survivors) console.log(n in EQUIVALENT ? `  equivalent (investigated): ${n}\n    why: ${EQUIVALENT[n]}` : `  UNEXPLAINED SURVIVOR: ${n}`)
if (missing.length) console.log('mutations whose target text no longer exists:', missing.join(' | '))
if (duplicates.length) console.log('duplicate mutation names:', duplicates.join(' | '))
if (notSurvivedButListed.length) console.log('listed as equivalent but CAUGHT (remove from the list):', notSurvivedButListed.join(' | '))
process.exit(unexplained.length || missing.length || duplicates.length ? 1 : 0)
