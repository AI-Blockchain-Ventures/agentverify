import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { canonicalize, canonicalizeSigned, canonicalizeSignedText, canonicalizeText, JcsError, numberFromIeeeHex } from '../reference/jcs.mjs'
import { numberProblem, numberTokenProblem } from '../reference/numberProfile.mjs'
import { parseStrictJson, StrictJsonError } from '../reference/strictJson.mjs'
import { loadVector } from './helpers.mjs'

const V = loadVector('jcs.v3.json')
const here = path.dirname(fileURLToPath(import.meta.url))
const sha256Hex = s => createHash('sha256').update(s, 'utf8').digest('hex')
const code = f => { try { f(); return null } catch (e) { return e.code ?? String(e) } }

// ── Generic RFC 8785 serializer (the FULL double domain). Nothing here is admitted into signed content. ──

test('generic RFC 8785 cases: strict parse (IEEE reading) then canonicalization gives exactly the frozen text and hash', () => {
  assert.ok(V.canonical.length >= 12)
  for (const c of V.canonical) {
    assert.equal(c.mode, 'generic-rfc8785')
    assert.equal(canonicalizeText(c.input), c.canonical, c.name)
    assert.equal(sha256Hex(c.canonical), c.canonicalSha256, c.name)
  }
})

test('RFC 8785 section 3.2.3: the worked example canonicalizes to the published output', () => {
  const c = V.canonical.find(x => x.name === 'rfc8785-section-3.2.3-example')
  assert.equal(c.canonical, '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}')
  assert.equal(canonicalizeText(c.input), c.canonical)
})

test('object keys sort by UTF-16 code units (not code points, not UTF-8 bytes)', () => {
  const order = Object.keys(JSON.parse(canonicalizeText(V.keyOrder.input)))
  assert.deepEqual(order, V.keyOrder.expectedOrder)
  assert.ok(order.findIndex(k => k.startsWith('\u{1F600}')) < order.findIndex(k => k.startsWith('דּ')), 'U+1F600 (D83D DE00) sorts before U+FB33 although its code point is larger')
})

test('number serialization: every IEEE 754 case from RFC 8785 appendix B (serializer only)', () => {
  assert.ok(V.numbers.length >= 27)
  for (const n of V.numbers) {
    const value = numberFromIeeeHex(n.ieeeHex)
    if (n.expected === null) assert.equal(code(() => canonicalize(value)), n.error, n.ieeeHex)
    else assert.equal(canonicalize(value), n.expected, n.ieeeHex)
  }
})

test('structural parse rejections are identical in EVERY numeric mode', () => {
  assert.ok(V.parseRejections.length >= 30)
  for (const r of V.parseRejections) {
    for (const numbers of ['signed-content', 'ieee']) {
      assert.throws(() => parseStrictJson(r.text, { numbers }), e => e instanceof StrictJsonError && e.code === r.code, `${r.name} (${numbers})`)
    }
  }
})

// One builder per value rejection. The vector names the case; the value itself cannot be written as JSON.
const nested = depth => { let v = []; for (let i = 1; i < depth; i++) v = [v]; return v }
const BUILDERS = {
  'undefined-property': () => ({ a: 1, b: undefined }),
  'undefined-array-item': () => [1, undefined],
  'undefined-top-level': () => undefined,
  nan: () => NaN,
  infinity: () => Infinity,
  'negative-infinity': () => -Infinity,
  function: () => () => 1,
  symbol: () => Symbol('x'),
  bigint: () => 1n,
  map: () => new Map(),
  set: () => new Set(),
  date: () => new Date(0),
  'class-instance': () => new (class Foo { constructor() { this.a = 1 } })(),
  'typed-array': () => new Uint8Array(2),
  'boxed-string': () => new String('x'), // eslint-disable-line no-new-wrappers
  regexp: () => /x/,
  'symbol-key': () => ({ [Symbol('k')]: 1 }),
  getter: () => ({ get a() { return 1 } }),
  'non-enumerable': () => Object.defineProperty({}, 'hidden', { value: 1, enumerable: false }),
  'sparse-array': () => { const a = new Array(3); a[0] = 1; a[2] = 3; return a },
  'array-extra-property': () => Object.assign([1], { extra: 1 }),
  'lone-surrogate-string': () => `a${String.fromCharCode(0xd800)}b`,
  'lone-surrogate-key': () => ({ [String.fromCharCode(0xd800)]: 1 }),
  cycle: () => { const o = {}; o.self = o; return o },
  'too-deep': () => nested(66),
}
const ADMISSION_BUILDERS = {
  fraction: () => 0.5,
  'negative-zero': () => -0,
  'two-to-the-53': () => 2 ** 53,
  'two-to-the-60': () => 2 ** 60,
  '1e21': () => 1e21,
  'smallest-subnormal': () => 5e-324,
  'max-double': () => Number.MAX_VALUE,
  'negative-unsafe': () => -(2 ** 53),
}

test('value rejections: the canonicalizer refuses what the old canonicalizer coerced, and every vector case has a builder', () => {
  assert.deepEqual(V.valueRejections.map(r => r.builder).sort(), Object.keys(BUILDERS).sort(), 'the vector and the builders describe exactly the same cases')
  for (const r of V.valueRejections) {
    for (const f of [canonicalize, canonicalizeSigned]) {
      assert.throws(() => f(BUILDERS[r.builder]()), e => e instanceof JcsError && e.code === r.code, `${r.builder}: ${r.description}`)
    }
  }
})

test('F1: an in-memory object with an undefined member is rejected; its serialized form canonicalizes', () => {
  const f1 = V.f1RoundTrip
  assert.equal(code(() => canonicalize(BUILDERS[f1.builder]())), f1.code)
  assert.equal(canonicalizeSignedText(f1.serializedText), f1.serializedCanonical)
  assert.equal(JSON.stringify(BUILDERS[f1.builder]()), f1.serializedText, 'JSON.stringify silently drops the undefined member, which is why signer and verifier could otherwise disagree')
})

// ── The Agent Verify signed-content numeric profile. NOT RFC 8785. ───────────────────────────

test('the numeric profile is described as an Agent Verify admission rule and never as RFC 8785 or JCS behaviour', () => {
  assert.match(V.numericProfile.statement, /NOT RFC 8785/)
  assert.match(V.numericProfile.statement, /exact mathematical VALUE/)
  assert.equal(V.numericProfile.id, 'agentverify-signed-content-numbers/v1')
  for (const c of V.canonical) assert.equal(c.mode, 'generic-rfc8785', 'serializer cases are labelled generic')
  const src = readFileSync(path.join(here, '..', 'reference', 'numberProfile.mjs'), 'utf8')
  assert.match(src, /It is NOT RFC 8785/)
  assert.match(src, /THE RULE IS ABOUT THE MATHEMATICAL VALUE, NOT THE SPELLING/)
})

test('SPELLING IS RELAXED, VALUE SAFETY IS NOT: every spelling of the same exact safe integer is admitted and canonicalizes identically', () => {
  assert.ok(V.numberProfile.admittedSpellings.length >= 7)
  for (const g of V.numberProfile.admittedSpellings) {
    assert.ok(g.spellings.length >= 3)
    for (const sp of g.spellings) {
      assert.deepEqual(numberTokenProblem(sp), { value: g.value }, sp)
      assert.equal(canonicalizeSignedText(`[${sp}]`), `[${g.canonical}]`, sp)
      assert.equal(JSON.parse(`[${sp}]`)[0], g.value, `independent JSON.parse agrees for ${sp}`)
    }
  }
  // The three examples from the review, verbatim:
  assert.equal(canonicalizeSignedText('[98.0]'), '[98]')
  assert.equal(canonicalizeSignedText('[9.8e1]'), '[98]')
  assert.equal(code(() => canonicalizeSignedText('[9007199254740993.0]')), 'JSON_NUMBER_UNSAFE_INTEGER')
  assert.equal(code(() => canonicalizeSignedText('[1e-400]')), 'JSON_NUMBER_NOT_INTEGRAL', 'a nonzero value below 1 is simply not an integer (there is no separate underflow status)')
  assert.equal(code(() => canonicalizeSignedText('[0.1]')), 'JSON_NUMBER_NOT_INTEGRAL')
})

test('admitted texts parse and canonicalize under the signed profile', () => {
  for (const t of V.numberProfile.admitted) assert.doesNotThrow(() => canonicalizeSignedText(t), t)
  assert.equal(canonicalizeSignedText('[0,1,-1,98,9007199254740991,-9007199254740991]'), '[0,1,-1,98,9007199254740991,-9007199254740991]')
  assert.equal(canonicalizeSignedText('[98.0,9.8e1,0.98e2]'), '[98,98,98]')
})

test('rejected texts: every non-integral value, negative zero, underflow and unsafe integer is REFUSED, never coerced', () => {
  assert.ok(V.numberProfile.rejectedTexts.length >= 30)
  for (const r of V.numberProfile.rejectedTexts) {
    assert.throws(() => parseStrictJson(r.text), e => e instanceof StrictJsonError && e.code === r.code, `${r.name}: ${r.text.slice(0, 40)}`)
    assert.throws(() => canonicalizeSignedText(r.text), e => e.code === r.code, r.name)
  }
  const codes = new Set(V.numberProfile.rejectedTexts.map(r => r.code))
  assert.deepEqual([...codes].sort(), ['JSON_NUMBER_NEGATIVE_ZERO', 'JSON_NUMBER_NOT_INTEGRAL', 'JSON_NUMBER_UNSAFE_INTEGER'])
})

test('the same texts under the GENERIC reading are silently coerced: that is exactly the ambiguity the profile removes', () => {
  assert.ok(V.numberProfile.genericCoercions.length >= 15)
  for (const c of V.numberProfile.genericCoercions) assert.equal(canonicalizeText(c.text), c.genericCanonical, c.name)
  const by = Object.fromEntries(V.numberProfile.genericCoercions.map(c => [c.name, c.genericCanonical]))
  assert.equal(by['unsafe-via-decimal'], '[9007199254740992]', '9007199254740993.0 silently became ...992')
  assert.equal(by['fraction-beyond-2-53'], '[9007199254740992]', '9007199254740992.5 silently became ...992')
  assert.equal(by['underflow-to-zero'], '[0]', '1e-400 silently became 0')
  assert.equal(by['negative-zero'], '[0]', '-0 silently became 0')
})

test('in-memory admission: values the generic canonicalizer accepts are refused by the signed canonicalizer, with the shared rule\'s reason', () => {
  assert.deepEqual(V.numberProfile.admissionRejections.map(r => r.builder).sort(), Object.keys(ADMISSION_BUILDERS).sort())
  for (const r of V.numberProfile.admissionRejections) {
    const value = ADMISSION_BUILDERS[r.builder]()
    assert.doesNotThrow(() => canonicalize([value]), `${r.builder}: generic JCS accepts it`)
    assert.equal(numberProblem(value), r.reason, r.builder)
    assert.throws(() => canonicalizeSigned([value]), e => e instanceof JcsError && e.code === 'JCS_NUMBER_NOT_ADMITTED' && e.message.includes(r.reason), r.builder)
  }
  assert.equal(canonicalize([2 ** 60]), '[1152921504606847000]')
  assert.notEqual(BigInt(2 ** 60).toString(), '1152921504606847000')
})

test('ONE RULE: the parser, the canonicalizer admission check and the (future) signer pre-check all take their decision from numberProfile.mjs, and nothing else decides', () => {
  const read = f => readFileSync(path.join(here, '..', 'reference', f), 'utf8')
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(strip(read('strictJson.mjs')), /import \{ numberTokenProblem, scanNumberToken \} from '\.\/numberProfile\.mjs'/)
  assert.match(strip(read('jcs.mjs')), /import \{ numberProblem \} from '\.\/numberProfile\.mjs'/)
  assert.match(strip(read('jcs.mjs')), /canonicalizeSigned = \(value, \{ baseDepth = 0 \} = \{\}\) => canonicalize\(value, \{ baseDepth, admitNumber: numberProblem \}\)/)
  for (const f of ['strictJson.mjs', 'jcs.mjs']) assert.doesNotMatch(strip(read(f)), /isSafeInteger|Object\.is\(|Number\.isInteger/, `${f} must not decide number admission itself`)
  // In signed-content mode the parser never converts the token itself; it takes the value the shared rule returns.
  const parser = strip(read('strictJson.mjs'))
  assert.match(parser, /value = r\.value/)
  assert.equal((parser.match(/(?<![A-Za-z])Number\(/g) ?? []).length, 1, 'the ONLY Number( call in the parser is the generic (ieee) reading')
  assert.match(parser, /numbers === 'ieee'\) \{\s*value = Number\(literal\)/)
  const att = strip(read('profileAttestation.mjs'))
  assert.doesNotMatch(att, /canonicalize\(payload\)|canonicalize\(assessment\)/)
  assert.match(att, /signedBytes\(assessment, \{ baseDepth: ASSESSMENT_BASE_DEPTH \}\)/); assert.match(att, /signedBytes\(payload, \{ baseDepth: PAYLOAD_BASE_DEPTH \}\)/)
})

// An INDEPENDENT oracle: pure string arithmetic on the token (shift the decimal point, then compare digit strings). It shares no code
// and no technique with numberTokenProblem, which uses BigInt.
function oracle(token) {
  const m = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(token)
  const [, sign, ip, fp = '', ex = '0'] = m
  const digits = ip + fp
  const point = ip.length + Number(ex)
  const allZero = /^0*$/
  if (allZero.test(digits)) return sign === '-' ? 'NEGATIVE_ZERO' : 0
  let integerText
  if (point >= digits.length) {
    if (point - digits.length > 20) return 'UNSAFE_INTEGER'
    integerText = digits + '0'.repeat(point - digits.length)
  } else if (point <= 0) {
    return 'NON_INTEGER'
  } else {
    if (!allZero.test(digits.slice(point))) return 'NON_INTEGER'
    integerText = digits.slice(0, point)
  }
  integerText = integerText.replace(/^0+/, '') || '0'
  const max = '9007199254740991'
  if (integerText.length > max.length || (integerText.length === max.length && integerText > max)) return 'UNSAFE_INTEGER'
  return Number(sign + integerText)
}

test('PROPERTY (independent oracle): the exact evaluator agrees with a string-arithmetic oracle on thousands of generated tokens', () => {
  const rnd = n => Math.floor(Math.random() * n)
  const digits = n => Array.from({ length: n }, () => rnd(10)).join('')
  let checked = 0
  const check = token => {
    const expected = oracle(token)
    const actual = numberTokenProblem(token)
    if (typeof expected === 'number') assert.deepEqual(actual, { value: expected }, token)
    else assert.equal(actual.problem, expected, token)
    checked++
  }
  for (let i = 0; i < 4000; i++) {
    const int = rnd(3) === 0 ? '0' : String(1 + rnd(9)) + digits(rnd(18))
    const frac = rnd(2) ? '.' + digits(1 + rnd(6)) : ''
    const exp = rnd(2) ? 'e' + ['', '+', '-'][rnd(3)] + rnd(25) : ''
    check(['', '-'][rnd(2)] + int + frac + exp)
  }
  // PATHOLOGICAL spellings of small values: very long zero runs and very long exponents. The value decides; the length of the text never does.
  for (let i = 0; i < 300; i++) {
    const zeros = rnd(1200), lead = digits(1 + rnd(3)).replace(/^0+/, '') || '7'
    check(`0.${'0'.repeat(zeros)}${lead}e${zeros + lead.length + rnd(3) - 1}`)
    check(`${lead}${'0'.repeat(zeros)}e-${zeros + rnd(3)}`)
    check(`${lead}e${['', '+', '-'][rnd(3)]}${'0'.repeat(rnd(60))}${rnd(20)}`)
  }
  // Targeted: safe-range boundaries in many spellings, and trailing-zero fractions.
  for (const t of ['9007199254740991', '9007199254740991.0', '9007199254740991.00000', '9007199254740992', '9007199254740992.0', '9007199254740993.0', '9007199254740992.5', '900719925474099.1e1', '900719925474099.2e1', '90071992547409910e-1', '90071992547409911e-1', '1e15', '1e16', '9e15', '9.007e15', '9.008e15', '0.00e5', '-0.00e5', '5e-1', '50e-2', '500e-2']) check(t)
  assert.ok(checked > 4000)
})

test('THE VALUE DECIDES, NEVER THE LENGTH OF THE TEXT: an admitted integer is admitted however many zeros or exponent digits spell it', () => {
  const cases = [
    ['0.' + '0'.repeat(1000) + '1e1001', 1], ['1' + '0'.repeat(1010) + 'e-1010', 1], ['1e' + '0'.repeat(34) + '5', 100000], ['1e+' + '0'.repeat(60) + '5', 100000],
    ['1.' + '0'.repeat(5000), 1], ['0.' + '0'.repeat(5000) + '1e5001', 1], ['9007199254740991.' + '0'.repeat(5000), 9007199254740991], ['1e-' + '0'.repeat(40), 1], ['1e' + '0'.repeat(40), 1],
  ]
  for (const [token, value] of cases) assert.deepEqual(numberTokenProblem(token), { value }, token.slice(0, 30))
  // The same length does not rescue a value that is not admitted:
  assert.equal(numberTokenProblem('0.' + '0'.repeat(5000) + '1e5000').problem, 'NON_INTEGER')
  assert.equal(numberTokenProblem('1e' + '9'.repeat(40)).problem, 'UNSAFE_INTEGER')
  assert.equal(numberTokenProblem('1e-' + '9'.repeat(40)).problem, 'NON_INTEGER')
  assert.equal(numberTokenProblem('1e-' + '0'.repeat(40) + '5').problem, 'NON_INTEGER')
  assert.equal(numberTokenProblem('1e' + '0'.repeat(40) + '17').problem, 'UNSAFE_INTEGER')
})

test('A HUGE TOKEN IS JUDGED IN LINEAR TIME: a single multi-megabyte number cannot tie up a verifier', () => {
  const started = performance.now()
  assert.equal(numberTokenProblem('9'.repeat(5_000_000)).problem, 'UNSAFE_INTEGER')
  assert.deepEqual(numberTokenProblem('1' + '0'.repeat(5_000_000) + 'e-5000000'), { value: 1 })
  assert.equal(numberTokenProblem('0.' + '0'.repeat(5_000_000) + '1').problem, 'NON_INTEGER')
  assert.ok(performance.now() - started < 2000, 'three 5-million-character tokens were judged in well under two seconds')
  assert.equal(code(() => parseStrictJson('[' + '9'.repeat(2_000_000) + ']')), 'JSON_NUMBER_UNSAFE_INTEGER')
})

test('PROPERTY: the two entry points agree. A token is admitted exactly when the double for that integer is admitted by numberProblem', () => {
  const samples = [0, 1, -1, 2, 10, 98, 100, 255, 65535, 2 ** 31, 2 ** 32, 2 ** 52, 2 ** 53 - 1, -(2 ** 53 - 1), 2 ** 53, 2 ** 53 + 2, -(2 ** 53), 2 ** 60, 1e15, 1e16, 1e21, 1e23, 0.5, -0.5, 0.1, 98.6, 1e-7, 5e-324, Number.MAX_VALUE, Number.MIN_VALUE]
  for (let i = 0; i < 400; i++) samples.push(Math.floor(Math.random() * 2 ** 53) * (Math.random() < 0.5 ? -1 : 1), Math.random() * 1000, (Math.random() - 0.5) * 2 ** 60)
  for (const v of samples) {
    const token = JSON.stringify(v) // shortest round-trip spelling: 1e+21, 5e-324, 0.5, 1e-7, ...
    const byToken = numberTokenProblem(token)
    const admittedByValue = numberProblem(v) === null
    assert.equal(byToken.value !== undefined, admittedByValue, `${token}: token path vs value path`)
    if (byToken.value !== undefined) assert.ok(Object.is(byToken.value, v), `${token} round-trips exactly`)
    assert.equal(code(() => canonicalizeSigned([v])) === null, admittedByValue, `canonicalizer admission for ${v}`)
    assert.equal(code(() => parseStrictJson(`[${token}]`)) === null, admittedByValue, `parser for ${token}`)
  }
  // Negative zero has no shortest spelling of its own ("0" is positive zero); its spellings are refused and its value is refused.
  assert.equal(numberProblem(-0), 'NEGATIVE_ZERO')
  for (const t of ['-0', '-0.0', '-0e0', '-0.000e9']) assert.equal(numberTokenProblem(t).problem, 'NEGATIVE_ZERO', t)
  assert.deepEqual(numberTokenProblem('0.0'), { value: 0 })
  // The admitted set is exactly the safe integers other than negative zero.
  for (const v of [2 ** 53 - 2, 2 ** 53 - 1, 2 ** 53, 2 ** 53 + 2]) assert.equal(code(() => parseStrictJson(`[${v}]`)) === null, v <= 2 ** 53 - 1)
})

test('the numeric profile is exactly as narrow as the real schema needs: the private scanner\'s assessments contain only safe integers (checked by that repo\'s own test); the only former decimal is printablePercent', () => {
  const canonical = canonicalizeSigned({ facts: { printablePercent: 98, length: 120, hasUrl: true } })
  assert.equal(canonical, '{"facts":{"hasUrl":true,"length":120,"printablePercent":98}}')
  assert.equal(code(() => canonicalizeSigned({ facts: { printableRatio: 0.98 } })), 'JCS_NUMBER_NOT_ADMITTED')
})

// ── Unicode is never normalized ─────────────────────────────────────────────────────────────

test('Unicode: nothing is normalized. NFC and NFD spellings stay distinct keys and distinct strings, in code-unit order', () => {
  assert.ok(V.unicode.length >= 4)
  for (const u of V.unicode) assert.equal(canonicalizeSigned(parseStrictJson(u.input)), u.canonical, u.name)
  const two = parseStrictJson(V.unicode[0].input)
  assert.equal(Object.keys(two).length, 2, 'two members, not one')
  assert.notEqual(canonicalizeSigned('café'), canonicalizeSigned('café'))
  assert.equal(code(() => parseStrictJson('{"é":1,"é":2}')), null, 'canonically equivalent keys are NOT duplicates')
  assert.equal(code(() => parseStrictJson('{"a":1,"\\u0061":2}')), 'JSON_DUPLICATE_KEY', 'identical code units written two ways ARE duplicates')
  const src = readFileSync(path.join(here, '..', 'reference', 'jcs.mjs'), 'utf8') + readFileSync(path.join(here, '..', 'reference', 'strictJson.mjs'), 'utf8')
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /\.normalize\(/, 'the canonicalizer and the parser never call normalize()')
})

test('a __proto__ key is an ordinary member, never a prototype assignment', () => {
  const parsed = parseStrictJson('{"__proto__":{"polluted":1},"a":1}')
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype)
  assert.equal({}.polluted, undefined)
  assert.equal(canonicalizeSigned(parsed), '{"__proto__":{"polluted":1},"a":1}')
})

test('null-prototype objects are accepted as plain, and shared (non-cyclic) references are fine', () => {
  assert.equal(canonicalize(Object.assign(Object.create(null), { b: 1, a: 2 })), '{"a":2,"b":1}')
  const shared = { x: 1 }
  const value = { a: shared, b: shared, c: [shared, shared] }
  assert.equal(canonicalizeSigned(value), canonicalizeSigned(JSON.parse(JSON.stringify(value))))
})
