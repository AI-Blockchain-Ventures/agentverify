// REFERENCE / TEST-ONLY (vector set v4). Not the product implementation. See conformance/v4/README.md.
//
// THE AGENT VERIFY SIGNED-CONTENT NUMERIC PROFILE, version 1.
//
// This is an Agent Verify admission rule. It is NOT RFC 8785 and must never be described as JCS behaviour. RFC 8785 defines how
// an IEEE-754 double is SERIALIZED, and it allows every finite double, including values a decimal-preserving runtime would read
// differently. The generic JCS serializer in jcs.mjs keeps that full domain so its own conformance table can be tested. Anything
// hashed or signed goes through THIS profile as well, and is much narrower on purpose.
//
// THE RULE IS ABOUT THE MATHEMATICAL VALUE, NOT THE SPELLING:
//
//   A signed number is an integer, |n| <= 2^53 - 1, that is not negative zero.
//
// `98`, `98.0`, `9.8e1` and `0.98e2` are spellings of the same exact safe integer and are all admitted. `0.5`, `98e-1`,
// `9007199254740993.0`, `1e-400` and `-0.0` are refused. A token is never converted through a double, so no spelling can round into a
// different admitted integer, and a nonzero value can never collapse to zero: it is simply not an integer, and is refused as such.
//
// LINEAR TIME, BY CONSTRUCTION (this is the property the v2 review found false, and v3 fixes):
//   * numberTokenProblem makes ONE left-to-right pass over the token. Every character is examined a constant number of times.
//   * Nothing in this file uses a regular expression, String.replace, exec, test, match, Number(token) or parseFloat, so there is
//     no operation whose cost depends on the shape of the digits (for example a long run of zeros in the middle).
//   * The pass records only INDEXES AND COUNTS: the sign, where the integer and fraction digits are, the position of the first and
//     last nonzero digit, and the exponent (as a number when it has at most 15 significant digits, otherwise as "huge").
//   * A BigInt is built only AFTER the token has been reduced, by counting, to a candidate that can fit in the safe-integer range:
//     at most 16 significant digits and a bounded decimal scale. An attacker-sized token never reaches BigInt.
//
// ONE RULE, EVERY CALL SITE. Two entry points onto the same rule:
//   numberTokenProblem(token)  the strict parser, for the text of a JSON number
//   numberProblem(value)       the canonicalizer's admission check and the signer's pre-check, for an in-memory number
// A token is admitted if and only if the double for the integer it denotes is admitted by numberProblem.

export const NUMBER_PROFILE_ID = 'agentverify-signed-content-numbers/v1'
export const MAX_SAFE = 9007199254740991n

// An exponent with more than this many significant digits is at least 10^15, which is larger than any string a JavaScript engine
// can hold (the maximum string length is below 2^30), so it dominates the whole token and its sign alone decides the outcome.
const EXPONENT_DIGITS_EXACT = 15

const MINUS = 45, PLUS = 43, DOT = 46, ZERO = 48, ONE = 49, NINE = 57, UPPER_E = 69, LOWER_E = 101
const isDigit = c => c >= ZERO && c <= NINE

/**
 * Returns null when the in-memory value is admitted, otherwise a stable reason:
 *   NOT_A_NUMBER, NON_FINITE, NEGATIVE_ZERO, NON_INTEGER, UNSAFE_INTEGER
 */
export function numberProblem(value) {
  if (typeof value !== 'number') return 'NOT_A_NUMBER'
  if (!Number.isFinite(value)) return 'NON_FINITE'
  if (Object.is(value, -0)) return 'NEGATIVE_ZERO'
  if (!Number.isInteger(value)) return 'NON_INTEGER'
  if (!Number.isSafeInteger(value)) return 'UNSAFE_INTEGER'
  return null
}

/**
 * Finds the end of the JSON number token that starts at `start` (the longest prefix matching the JSON number grammar), or -1 if no
 * number starts there. One pass, no regular expression. Used by the parser to find where a token ends.
 * `stats` (optional) counts character reads so tests can prove the scan is linear.
 */
export function scanNumberToken(text, start = 0, stats) {
  const at = i => { if (stats) stats.charReads++; return text.charCodeAt(i) }
  let i = start
  if (at(i) === MINUS) i++
  const first = at(i)
  if (first === ZERO) i++
  else if (first >= ONE && first <= NINE) { i++; while (isDigit(at(i))) i++ }
  else return -1
  if (at(i) === DOT && isDigit(at(i + 1))) { i++; while (isDigit(at(i))) i++ }
  const e = at(i)
  if (e === UPPER_E || e === LOWER_E) {
    let j = i + 1
    const s = at(j)
    if (s === PLUS || s === MINUS) j++
    if (isDigit(at(j))) { while (isDigit(at(j))) j++; i = j }
  }
  return i
}

/**
 * Exact evaluation of one JSON number token. Returns { value } (a safe-integer JavaScript number, never coerced) when admitted,
 * otherwise { problem } with one of:
 *   NOT_A_NUMBER    the string is not exactly one JSON number
 *   NEGATIVE_ZERO   a zero written with a minus sign, in any spelling (-0, -0.0, -0e5)
 *   NON_INTEGER     the exact value is not an integer (0.5, 98e-1, 9007199254740992.5, and any nonzero value too small to be an integer)
 *   UNSAFE_INTEGER  the exact value is an integer beyond 2^53 - 1 in magnitude (9007199254740993.0, 1e21, 1e999)
 * `stats` (optional) records charReads and the number of digits ever handed to BigInt, so tests can prove linear cost and
 * that no attacker-sized digit string reaches BigInt.
 */
export function numberTokenProblem(token, stats) {
  const at = i => { if (stats) stats.charReads++; return token.charCodeAt(i) }
  const length = token.length
  const bad = { problem: 'NOT_A_NUMBER' }
  let i = 0

  // sign
  const negative = at(0) === MINUS
  if (negative) i = 1

  // integer part, remembering where its digits are and the first and last NONZERO digit (counting digits across int + fraction)
  const intStart = i
  let digitIndex = 0, firstNonzero = -1, lastNonzero = -1
  const c0 = at(i)
  if (c0 === ZERO) { i++; digitIndex = 1 }
  else if (c0 >= ONE && c0 <= NINE) {
    firstNonzero = 0; lastNonzero = 0; i++; digitIndex = 1
    for (let c = at(i); isDigit(c); c = at(i)) { if (c !== ZERO) lastNonzero = digitIndex; digitIndex++; i++ }
  } else return bad
  const integerLength = digitIndex
  if (integerLength === 1 && c0 === ZERO && isDigit(at(i))) return bad // a leading zero may not be followed by a digit

  // fraction part
  let fractionStart = i, fractionLength = 0
  if (at(i) === DOT) {
    i++; fractionStart = i
    if (!isDigit(at(i))) return bad
    for (let c = at(i); isDigit(c); c = at(i)) {
      if (c !== ZERO) { if (firstNonzero < 0) firstNonzero = digitIndex; lastNonzero = digitIndex }
      digitIndex++; fractionLength++; i++
    }
  }
  const totalDigits = digitIndex

  // exponent: sign, and its magnitude as a number while it has at most EXPONENT_DIGITS_EXACT significant digits
  let exponentNegative = false, exponent = 0, exponentHuge = false
  const e = at(i)
  if (e === UPPER_E || e === LOWER_E) {
    i++
    const s = at(i)
    if (s === PLUS || s === MINUS) { exponentNegative = s === MINUS; i++ }
    if (!isDigit(at(i))) return bad
    let significant = 0
    for (let c = at(i); isDigit(c); c = at(i)) {
      if (significant > 0 || c !== ZERO) { significant++; if (significant <= EXPONENT_DIGITS_EXACT) exponent = exponent * 10 + (c - ZERO); else exponentHuge = true }
      i++
    }
  }
  if (i !== length) return bad // the whole token must have been one number

  // every digit is zero: the value is zero, and only the sign can make it a refused negative zero
  if (firstNonzero < 0) return negative ? { problem: 'NEGATIVE_ZERO' } : { value: 0 }

  // value = S x 10^scale exactly, where S is the run of digits from the first to the last nonzero digit (no leading or trailing
  // zero, so S is not divisible by 10), and scale counts the decimal places between the end of S and the decimal point.
  const significantDigits = lastNonzero - firstNonzero + 1
  const trailingZeros = totalDigits - 1 - lastNonzero
  if (exponentHuge) return { problem: exponentNegative ? 'NON_INTEGER' : 'UNSAFE_INTEGER' } // |exponent| >= 10^15 dominates every possible token length
  const scale = (exponentNegative ? -exponent : exponent) - fractionLength + trailingZeros // exact: all terms are far below 2^53

  // S is not divisible by 10, so S x 10^scale with scale < 0 is never an integer (this covers every value below 1, however tiny)
  if (scale < 0) return { problem: 'NON_INTEGER' }
  // with scale >= 0 the value has significantDigits + scale digits; 17 or more is beyond 2^53 - 1, decided by counting alone
  if (significantDigits + scale > 16) return { problem: 'UNSAFE_INTEGER' }

  // the candidate now has at most 16 digits: read S by index and only now build a BigInt
  let digits = ''
  for (let k = firstNonzero; k <= lastNonzero; k++) {
    const charIndex = k < integerLength ? intStart + k : fractionStart + (k - integerLength)
    if (stats) stats.charReads++
    digits += token[charIndex]
  }
  if (stats) stats.bigIntDigits = (stats.bigIntDigits ?? 0) + digits.length
  const integer = BigInt(digits) * 10n ** BigInt(scale)
  if (integer > MAX_SAFE) return { problem: 'UNSAFE_INTEGER' }
  const value = Number(negative ? -integer : integer)
  // the two entry points must agree; if they ever did not, that is a defect here, so fail closed rather than admit
  return numberProblem(value) === null ? { value } : { problem: 'NON_INTEGER' }
}
