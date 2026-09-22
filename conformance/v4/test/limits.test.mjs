import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { canonicalize, canonicalizeSigned } from '../reference/jcs.mjs'
import { ASSESSMENT_BASE_DEPTH, BUNDLE_ROOT_DEPTH, MAX_BUNDLE_BYTES, MAX_JSON_DEPTH, PAYLOAD_BASE_DEPTH, exceedsDepth } from '../reference/limits.mjs'
import { numberProblem, numberTokenProblem, scanNumberToken } from '../reference/numberProfile.mjs'
import * as ref from '../reference/profileAttestation.mjs'
import { decodeStrictUtf8, parseStrictJson } from '../reference/strictJson.mjs'
import { ADVERSARIAL_KINDS, adversarialToken, loadVector, toInputBytes } from './helpers.mjs'

const V = loadVector('jcs.v4.json')
const BUNDLES = loadVector('bundles.v4.json')
const here = path.dirname(fileURLToPath(import.meta.url))
const read = f => readFileSync(path.join(here, '..', 'reference', f), 'utf8')
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const code = f => { try { f(); return null } catch (e) { return e.code ?? e.message } }
const verify = (input, options) => ref.verifyProfileBundleBytes(toInputBytes(input), options)
const nest = k => { let v = 'x'; for (let i = 0; i < k; i++) v = [v]; return v }

// ══ 1. THE NUMERIC CLASSIFIER IS LINEAR: proved by STRUCTURE (counted operations), not only by a clock ════════════

// A wall-clock test is flaky and proves little: a quadratic algorithm can still finish quickly on a short input. These tests count
// what the classifier DOES: every character read (charReads) and every digit ever given to BigInt (bigIntDigits).

const SIZES = [1000, 4000, 16000, 64000]

test('STRUCTURAL: for every adversarial shape, character reads are at most the token length plus a constant, at every size', () => {
  assert.ok(Object.keys(ADVERSARIAL_KINDS).length >= 15)
  for (const kind of Object.keys(ADVERSARIAL_KINDS)) {
    for (const N of SIZES) {
      const token = adversarialToken(kind, N)
      const stats = { charReads: 0, bigIntDigits: 0 }
      numberTokenProblem(token, stats)
      assert.ok(stats.charReads <= token.length + 32, `${kind} N=${N}: ${stats.charReads} reads for a ${token.length}-character token`)
      assert.ok(stats.charReads >= token.length - 32, `${kind} N=${N}: the whole token was read (${stats.charReads} of ${token.length})`)
      const scan = { charReads: 0 }
      scanNumberToken(token, 0, scan)
      assert.ok(scan.charReads <= token.length + 8, `${kind} N=${N}: the token scan reads ${scan.charReads} for ${token.length}`)
    }
  }
})

test('STRUCTURAL: the work grows LINEARLY: quadrupling the token quadruples the reads (within 2%), for every shape', () => {
  for (const kind of Object.keys(ADVERSARIAL_KINDS)) {
    const reads = SIZES.map(N => { const s = { charReads: 0 }; numberTokenProblem(adversarialToken(kind, N), s); return s.charReads })
    for (let i = 1; i < reads.length; i++) {
      const ratio = reads[i] / reads[i - 1]
      assert.ok(ratio > 3.9 && ratio < 4.1, `${kind}: ${SIZES[i - 1]} -> ${SIZES[i]} reads ${reads[i - 1]} -> ${reads[i]} (x${ratio.toFixed(3)}), expected x4`)
    }
  }
})

test('STRUCTURAL: no attacker-sized digit string ever reaches BigInt: at most 16 digits, for every shape and size, admitted or refused', () => {
  for (const kind of Object.keys(ADVERSARIAL_KINDS)) {
    for (const N of [3, 15, 16, 17, ...SIZES, 100000]) {
      const stats = { charReads: 0, bigIntDigits: 0 }
      numberTokenProblem(adversarialToken(kind, N), stats)
      assert.ok((stats.bigIntDigits ?? 0) <= 16, `${kind} N=${N}: ${stats.bigIntDigits} digits reached BigInt`)
    }
  }
  // An enormous nine-run and an enormous exponent never build a BigInt at all.
  for (const t of ['9'.repeat(1_000_000), `1e${'9'.repeat(1_000_000)}`, `1e-${'9'.repeat(1_000_000)}`, `0.${'0'.repeat(1_000_000)}1`]) {
    const stats = { charReads: 0, bigIntDigits: 0 }
    numberTokenProblem(t, stats)
    assert.equal(stats.bigIntDigits ?? 0, 0, t.slice(0, 20))
  }
})

test('STRUCTURAL: the classifier calls no operation whose cost depends on the shape of the digits (no regular expression, no replace, no Number(token))', () => {
  const src = strip(read('numberProfile.mjs'))
  for (const forbidden of [/\.replace\(/, /\.replaceAll\(/, /\.match\(/, /\.matchAll\(/, /\.exec\(/, /\.test\(/, /\.search\(/, /\.split\(/, /RegExp/, /parseFloat/, /parseInt/, /Number\(token/, /Number\(digits/, /\.repeat\(/, /\.padStart\(/, /\.padEnd\(/, /toString\(/, /\.indexOf\(/, /\.includes\(/, /\.slice\(/, /\.substring\(/, /\.trim/]) {
    assert.doesNotMatch(src, forbidden, `numberProfile.mjs must not use ${forbidden}`)
  }
  // No regular-expression literal at all. (A literal is a slash that follows an operator or an opening bracket.)
  assert.doesNotMatch(src, /[=(,:!&|?{}[;]\s*\/[^/*\n]+\/[gimsuy]*/, 'no regular expression literal in the classifier')
  // The number path of the parser is the hand scan plus the classifier; it uses no regular expression either.
  const parser = strip(read('strictJson.mjs'))
  const body = parser.slice(parser.indexOf('function parseNumber'), parser.indexOf('function parseString'))
  assert.ok(body.length > 200)
  assert.doesNotMatch(body, /\.replace\(|\.match\(|\.exec\(|\.test\(|RegExp|\/[^/\n]+\/[gimsuy]*\.test/, 'parseNumber uses no regular expression')
})

test('STRUCTURAL: BigInt is only constructed after the token was reduced to a bounded candidate (at most 16 significant digits, a bounded scale)', () => {
  const src = strip(read('numberProfile.mjs'))
  const at = src.indexOf('BigInt(')
  assert.ok(at > 0)
  const before = src.slice(0, at)
  assert.match(before, /significantDigits \+ scale > 16/, 'the digit-count bound precedes the BigInt')
  assert.match(before, /scale < 0/, 'the negative-scale refusal precedes the BigInt')
  assert.match(before, /exponentHuge/, 'the huge-exponent decision precedes the BigInt')
  assert.equal((src.match(/BigInt\(/g) ?? []).length, 2, 'BigInt appears twice: the digit run and the scale')
})

test('WALL CLOCK (a coarse backstop only): 16 million characters of zeros in the middle of a token are judged in well under a second', () => {
  const started = performance.now()
  assert.equal(numberTokenProblem('1' + '0'.repeat(16_000_000) + '1').problem, 'UNSAFE_INTEGER')
  assert.equal(numberTokenProblem('1.' + '0'.repeat(16_000_000) + '2').problem, 'NON_INTEGER')
  assert.deepEqual(numberTokenProblem('1' + '0'.repeat(16_000_000) + 'e-16000000'), { value: 1 })
  assert.ok(performance.now() - started < 3000)
})

// ── the adversarial vectors ──

test('ADVERSARIAL VECTORS: zero runs in the MIDDLE of integer, fractional and exponent forms give the frozen result, through the classifier, the parser and the canonicalizer', () => {
  const cases = V.adversarialNumbers.cases
  assert.equal(cases.length, Object.keys(ADVERSARIAL_KINDS).length * V.adversarialNumbers.sizes.length)
  assert.ok(V.adversarialNumbers.sizes.includes(100000))
  for (const c of cases) {
    const token = adversarialToken(c.kind, c.N)
    assert.deepEqual(numberTokenProblem(token), c.expected, `${c.kind} N=${c.N}`)
    const text = `[${token}]`
    if ('value' in c.expected) {
      assert.deepEqual(parseStrictJson(text), [c.expected.value], `${c.kind} N=${c.N}: parsed`)
      assert.equal(canonicalizeSigned(parseStrictJson(text)), `[${c.expected.value}]`, `${c.kind} N=${c.N}: canonical`)
    } else {
      const expectedCode = { NON_INTEGER: 'JSON_NUMBER_NOT_INTEGRAL', UNSAFE_INTEGER: 'JSON_NUMBER_UNSAFE_INTEGER', NEGATIVE_ZERO: 'JSON_NUMBER_NEGATIVE_ZERO' }[c.expected.problem]
      assert.equal(code(() => parseStrictJson(text)), expectedCode, `${c.kind} N=${c.N}: refused`)
    }
  }
})

test('ADVERSARIAL VECTORS: an independent BigInt/string oracle agrees for every shape up to N = 3000', () => {
  // Exact rational check with no shared code: value = digits * 10^(exp - fractionLength), tested for integrality and the safe range.
  const oracle = token => {
    const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token)
    const [, sign, ip, fp = '', ex = '0'] = m
    const digits = BigInt(ip + fp)
    const shift = BigInt(ex) - BigInt(fp.length)
    if (digits === 0n) return sign ? { problem: 'NEGATIVE_ZERO' } : { value: 0 }
    let value
    if (shift >= 0n) { if (shift > 40n) return { problem: 'UNSAFE_INTEGER' }; value = digits * 10n ** shift } else {
      const d = 10n ** BigInt(-shift)
      if (digits % d !== 0n) return { problem: 'NON_INTEGER' }
      value = digits / d
    }
    return value > 9007199254740991n ? { problem: 'UNSAFE_INTEGER' } : { value: Number(sign ? -value : value) }
  }
  for (const kind of Object.keys(ADVERSARIAL_KINDS)) for (const N of [3, 14, 15, 16, 17, 100, 1000, 3000]) {
    const token = adversarialToken(kind, N)
    assert.deepEqual(numberTokenProblem(token), oracle(token), `${kind} N=${N}`)
  }
})

test('ADMITTED AND REFUSED SHAPES ARE BOTH LINEAR: a refusal is not cheaper because it stops early, and an admission is not dearer', () => {
  for (const [kind, expectAdmitted] of Object.entries({ 'int-zeros-cancelled-by-exponent': true, 'frac-trailing-zeros': true, 'exp-leading-zeros-positive': true, 'int-middle-zeros': false, 'frac-middle-zeros': false, 'exp-leading-zeros-negative': false })) {
    const token = adversarialToken(kind, 64000)
    const stats = { charReads: 0, bigIntDigits: 0 }
    const r = numberTokenProblem(token, stats)
    assert.equal(r.value !== undefined, expectAdmitted, kind)
    assert.ok(stats.charReads <= token.length + 32, kind)
  }
})

// ══ 2. ONE SHARED DEPTH MODEL ════════════════════════════════════════════════════════════════════════════════════

test('DEPTH: one limit, one comparison. No other file spells 64 or compares a depth', () => {
  assert.equal(MAX_JSON_DEPTH, 64)
  assert.equal(exceedsDepth(64), false); assert.equal(exceedsDepth(65), true)
  assert.deepEqual([BUNDLE_ROOT_DEPTH, ASSESSMENT_BASE_DEPTH, PAYLOAD_BASE_DEPTH], [1, 1, 2])
  for (const f of ['strictJson.mjs', 'jcs.mjs', 'profileAttestation.mjs', 'numberProfile.mjs', 'assessmentSchema.mjs', 'policy.mjs']) {
    const src = strip(read(f))
    // (profileAttestation.mjs legitimately spells 64 for the byte length of a raw signature, so the literal is only forbidden where it could only mean a depth.)
    if (['strictJson.mjs', 'jcs.mjs', 'numberProfile.mjs', 'assessmentSchema.mjs', 'policy.mjs'].includes(f)) assert.doesNotMatch(src, /\b64\b/, `${f} must not spell the depth limit`)
    assert.doesNotMatch(src, /depth\s*[<>]=?\s*\d|MAX_JSON_DEPTH\s*[<>]|[<>]=?\s*MAX_JSON_DEPTH/, `${f} must not compare a depth itself`)
  }
  assert.match(strip(read('strictJson.mjs')), /exceedsDepth\(depth\)/)
  assert.match(strip(read('jcs.mjs')), /exceedsDepth\(depth\)/)
  assert.equal(V.depthModel.maxJsonDepth, 64)
  assert.equal(BUNDLES.limits.maxJsonDepth, 64)
})

test('DEPTH: the parser and the canonicalizer agree at EVERY depth around the limit (standalone)', () => {
  for (let d = 60; d <= 68; d++) {
    const parsed = code(() => parseStrictJson(JSON.stringify(nest(d))))
    const canonical = code(() => canonicalizeSigned(nest(d)))
    const generic = code(() => canonicalize(nest(d)))
    assert.equal(parsed === null, d <= 64, `parse at depth ${d}`)
    assert.equal(canonical === null, d <= 64, `canonicalize at depth ${d}`)
    assert.equal(generic === null, d <= 64, `generic canonicalize at depth ${d}`)
  }
})

test('DEPTH: an assessment is measured from the BUNDLE root: whatever can be digested also parses inside its bundle, and the reverse, at every depth', async () => {
  for (let k = 58; k <= 66; k++) {
    // k nested arrays under a top-level assessment field: absolute depth 2 + k.
    const assessment = { deep: nest(k) }
    const digestible = await ref.assessmentDigest(assessment).then(() => true, () => false)
    const bundleText = JSON.stringify({ bundleVersion: '1.0.0', attestation: {}, assessment })
    const parseable = code(() => parseStrictJson(bundleText)) === null
    assert.equal(digestible, parseable, `k=${k}: digestible ${digestible}, parseable inside a bundle ${parseable}`)
    assert.equal(digestible, 2 + k <= 64, `k=${k}`)
  }
  // The v2 defect, stated exactly: depth 64 measured from the assessment alone (63 arrays) was digestible but could not be parsed inside its bundle.
  const v2Case = { deep: nest(63) }
  assert.equal(code(() => canonicalizeSigned(v2Case)), null, 'standalone (base depth 0) it would still canonicalize')
  await assert.rejects(() => ref.assessmentDigest(v2Case), e => e.code === 'JCS_TOO_DEEP', 'but it is now refused as an assessment digest input')
  assert.equal(code(() => parseStrictJson(JSON.stringify({ a: v2Case }))), 'JSON_TOO_DEEP')
})

test('DEPTH: the payload is measured from the bundle root too (bundle -> attestation -> payload)', () => {
  const payloadAt = k => ({ a: nest(k) })
  assert.equal(code(() => ref.signingInput(payloadAt(61))), null, 'root of payload is depth 3; a field with 61 arrays reaches 64')
  assert.equal(code(() => ref.signingInput(payloadAt(62))), 'JCS_TOO_DEEP')
  assert.equal(code(() => parseStrictJson(JSON.stringify({ attestation: { payload: payloadAt(61) } }))), null)
  assert.equal(code(() => parseStrictJson(JSON.stringify({ attestation: { payload: payloadAt(62) } }))), 'JSON_TOO_DEEP')
})

test('DEPTH VECTORS: exactly at the limit the signed bundle parses, digests and verifies; one over does not parse', async () => {
  for (const n of ['depth.at-the-limit-parses-digests-and-verifies', 'depth.one-over-fails-to-parse', 'depth.at-the-limit-text-parses', 'depth.bundle-root-counts', 'depth.bundle-root-over']) {
    const c = BUNDLES.cases.find(x => x.name === n)
    assert.ok(c, n)
  }
  const signed = BUNDLES.signed['D_depth-64'].bundle
  const text = JSON.stringify(signed)
  assert.equal(code(() => parseStrictJson(text)), null)
  assert.equal(await ref.assessmentDigest(signed.assessment), signed.attestation.payload.assessment.digest)
  const r = await verify(text)
  assert.equal(r.integrity, 'VALID')
  assert.equal(r.interpretation, 'INVALID_ASSESSMENT')
})

// ══ 3. BYTES ARE THE VERIFIER INPUT ═════════════════════════════════════════════════════════════════════════════

test('BYTES: decodeStrictUtf8: type, size, BOM and well-formedness, in that order', () => {
  const enc = s => new TextEncoder().encode(s)
  assert.deepEqual(decodeStrictUtf8('{}', 100), { problem: 'NOT_BYTES' })
  assert.deepEqual(decodeStrictUtf8([123, 125], 100), { problem: 'NOT_BYTES' })
  assert.deepEqual(decodeStrictUtf8(new ArrayBuffer(2), 100), { problem: 'NOT_BYTES' })
  assert.deepEqual(decodeStrictUtf8(null, 100), { problem: 'NOT_BYTES' })
  assert.deepEqual(decodeStrictUtf8(enc('{}'), 2), { text: '{}' }, 'the size limit is inclusive')
  assert.deepEqual(decodeStrictUtf8(enc('{}'), 1), { problem: 'TOO_LARGE' })
  assert.deepEqual(decodeStrictUtf8(Buffer.from('{}'), 100), { text: '{}' }, 'a Buffer is a Uint8Array')
  // size is judged before the content: an oversized INVALID input is TOO_LARGE, not INVALID_UTF8
  assert.deepEqual(decodeStrictUtf8(new Uint8Array([0xff, 0xff, 0xff]), 2), { problem: 'TOO_LARGE' })
  assert.deepEqual(decodeStrictUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), 100), { problem: 'BOM' })
  assert.deepEqual(decodeStrictUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0xff]), 100), { problem: 'BOM' }, 'the BOM is judged before the rest of the bytes')
  assert.deepEqual(decodeStrictUtf8(new Uint8Array([0xef, 0xbb]), 100), { problem: 'INVALID_UTF8' }, 'two bytes of a BOM are just a truncated sequence')
  for (const bad of [[0x80], [0xc3, 0x28], [0xc0, 0xaf], [0xe0, 0x80, 0xaf], [0xed, 0xa0, 0x80], [0xf0, 0x9f, 0x98], [0xf4, 0x90, 0x80, 0x80], [0xff], [0xfe], [0xc1, 0xbf], [0xf5, 0x80, 0x80, 0x80]]) {
    assert.deepEqual(decodeStrictUtf8(new Uint8Array(bad), 100), { problem: 'INVALID_UTF8' }, bad.map(b => b.toString(16)).join(' '))
  }
})

test('BYTES: nothing is replaced, stripped or normalized: a REAL U+FFFD stays, U+FEFF inside stays, multibyte round-trips', () => {
  const bytes = new Uint8Array([0x22, 0xef, 0xbf, 0xbd, 0x22]) // "<U+FFFD>" written as its valid UTF-8 encoding
  assert.equal(decodeStrictUtf8(bytes, 100).text, '"�"', 'a genuine U+FFFD character is data, not an error marker')
  assert.equal(decodeStrictUtf8(new TextEncoder().encode('a\ufeffb'), 100).text, 'a\ufeffb', 'a U+FEFF that is not first is a character')
  const text = 'é～\u{1F642}'
  assert.equal(decodeStrictUtf8(new TextEncoder().encode(text), 100).text, text)
  assert.notEqual(new TextDecoder().decode(new Uint8Array([0x53, 0x80])), 'S', 'a LENIENT decoder substitutes U+FFFD; that is exactly what the verifier does not do')
})

test('BYTES: the verifier takes BYTES: a string, an array or a Buffer-less value is refused, never coerced', async () => {
  const good = JSON.stringify(BUNDLES.signed.B1.bundle)
  assert.equal((await ref.verifyProfileBundleBytes(new TextEncoder().encode(good))).integrity, 'VALID')
  for (const notBytes of [good, [...new TextEncoder().encode(good)], new ArrayBuffer(8), {}, null, undefined, 5]) {
    const r = await ref.verifyProfileBundleBytes(notBytes)
    assert.equal(r.integrity, 'MALFORMED'); assert.equal(r.reasonCode, 'bundle.not-bytes')
  }
  assert.equal((await ref.verifyProfileBundleBytes(new TextEncoder().encode(good), { maxBundleBytes: good.length - 1 })).reasonCode, 'bundle.too-large')
})

test('BYTES VECTORS: every byte-level case gives its frozen result, and the multibyte bytes equal the text form', async () => {
  const cases = BUNDLES.cases.filter(c => c.name.startsWith('bytes.'))
  assert.ok(cases.length >= 15)
  for (const c of cases) {
    const r = await ref.verifyProfileBundleBytes(new Uint8Array(Buffer.from(c.source.bytesHex, 'hex')))
    for (const [k, v] of Object.entries(c.expected)) assert.deepEqual(r[k], v, `${c.name}: ${k}`)
  }
  const multibyte = BUNDLES.cases.find(c => c.name === 'bytes.valid-multibyte-equals-text')
  assert.equal(Buffer.from(multibyte.source.bytesHex, 'hex').toString('utf8'), JSON.stringify(BUNDLES.signed.B1.bundle))
  const reasons = new Set(cases.map(c => c.expected.reasonCode))
  for (const need of ['bundle.invalid-utf8', 'JSON_BOM', 'JSON_SYNTAX', 'JSON_ILL_FORMED_STRING']) assert.ok(reasons.has(need), need)
})

test('LIMITS: the byte ceiling is shared, and the bundle text ceiling is expressed in bytes', () => {
  assert.equal(MAX_BUNDLE_BYTES, 16 * 1024 * 1024)
  assert.equal(ref.MAX_BUNDLE_TEXT_BYTES, MAX_BUNDLE_BYTES)
  assert.equal(BUNDLES.limits.maxBundleBytes, MAX_BUNDLE_BYTES)
})

// ══ 4. THE TOKEN GRAMMAR: exactly one JSON number, judged by the same single pass ═══════════════════════════════

test('TOKEN GRAMMAR: anything that is not exactly one JSON number is NOT_A_NUMBER; the scan stops where the grammar stops', () => {
  for (const bad of ['', '-', '+1', '01', '00', '-01', '1.', '.5', '-.5', '1e', '1e+', '1e-', '1e5.5', '1.5.5', '--1', '0x10', '1 ', ' 1', 'NaN', 'Infinity', '1_000', '\uff11', '1,2', '1e5e5', '0e', '1.e5', 'e5', '-e5']) {
    assert.deepEqual(numberTokenProblem(bad), { problem: 'NOT_A_NUMBER' }, JSON.stringify(bad))
  }
  const ends = [['0', 1], ['01', 1], ['-0', 2], ['1.5', 3], ['1.', 1], ['1.e5', 1], ['1e5', 3], ['1e', 1], ['1e+', 1], ['1e+5', 4], ['-', -1], ['x', -1], ['.5', -1], ['+1', -1], ['-.5', -1], ['1E5', 3], ['1.5e-3x', 6], ['12345', 5], ['1.50', 4], ['0.0e0', 5]]
  for (const [text, end] of ends) assert.equal(scanNumberToken(text, 0), end, JSON.stringify(text))
  assert.equal(scanNumberToken('[12]', 1), 3, 'the scan starts at the given offset')
  // A token the scan accepts is always judged as a whole: the classifier and the scan agree on where a number ends.
  for (const good of ['0', '-5', '12', '1.5', '1e5', '1E+5', '0.0e0', '98.0', '9.8e1']) assert.equal(scanNumberToken(good, 0), good.length, good)
})

test('DEPTH: parseStrictJson honours its base depth (the depth of the parent), and numberProblem names non-finite numbers', () => {
  const arrays = k => '['.repeat(k) + ']'.repeat(k)
  assert.equal(code(() => parseStrictJson(arrays(64))), null)
  assert.equal(code(() => parseStrictJson(arrays(64), { baseDepth: 0 })), null)
  assert.equal(code(() => parseStrictJson(arrays(64), { baseDepth: 1 })), 'JSON_TOO_DEEP', 'a parent at depth 1 leaves 63 levels')
  assert.equal(code(() => parseStrictJson(arrays(63), { baseDepth: 1 })), null)
  assert.equal(code(() => parseStrictJson(arrays(69), { baseDepth: -5 })), null, 'a negative base depth widens the allowance (used only to load the vector files)')
  assert.equal(code(() => parseStrictJson(arrays(70), { baseDepth: -5 })), 'JSON_TOO_DEEP')
  for (const [v, reason] of [[NaN, 'NON_FINITE'], [Infinity, 'NON_FINITE'], [-Infinity, 'NON_FINITE'], [-0, 'NEGATIVE_ZERO'], ['1', 'NOT_A_NUMBER'], [null, 'NOT_A_NUMBER'], [undefined, 'NOT_A_NUMBER'], [0.5, 'NON_INTEGER'], [2 ** 53, 'UNSAFE_INTEGER'], [2 ** 53 - 1, null], [0, null], [-(2 ** 53 - 1), null]]) {
    assert.equal(numberProblem(v), reason, String(v))
  }
})
