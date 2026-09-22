// REFERENCE / TEST-ONLY. Not the product implementation. See conformance/README.md.
//
// THE AGENT VERIFY SIGNED-CONTENT NUMERIC PROFILE, version 1.
//
// This is an Agent Verify admission rule. It is NOT RFC 8785 and must never be described as JCS behaviour. RFC 8785 defines how
// an IEEE-754 double is SERIALIZED, and it allows every finite double, including values a decimal-preserving runtime would read
// differently (integers beyond 2^53, decimals with more digits than a double holds). The generic JCS serializer in jcs.mjs
// keeps that full RFC domain so its own conformance table can be tested. Anything that is hashed or signed goes through THIS
// profile as well, and is much narrower on purpose.
//
// THE RULE IS ABOUT THE MATHEMATICAL VALUE, NOT THE SPELLING.
//
//   A signed number is an integer, |n| <= 2^53 - 1, that is not negative zero.
//
// `98`, `98.0`, `9.8e1` and `0.98e2` are four spellings of the same exact safe integer and are all admitted; JCS then
// canonicalizes the admitted value as `98`. `0.5`, `98e-1`, `9007199254740993.0`, `1e-400` and `-0.0` are refused. What is NOT
// allowed is deciding by first converting the text to a double: `9007199254740993.0` would silently become ...992 and
// `1e-400` would silently become 0. So a NUMERIC TOKEN IS EVALUATED EXACTLY, with arbitrary-precision integer arithmetic, and only
// an exactly-known safe integer is ever turned into a JavaScript number. A quantity that is naturally fractional is encoded by
// the producer as a scaled integer under an explicit name (for example `printablePercent`, a whole percent).
//
// ONE RULE, EVERY CALL SITE. There are two entry points onto the same rule:
//   numberTokenProblem(token)  the strict parser, for the text of a JSON number
//   numberProblem(value)       the canonicalizer's admission check and the signer's pre-check, for an in-memory number
// They agree exactly: a token is admitted if and only if the double for the integer it denotes is admitted by numberProblem, and
// numberProblem admits exactly the safe integers other than negative zero. Neither ever consults any other test.

export const NUMBER_PROFILE_ID = 'agentverify-signed-content-numbers/v1'

export const MAX_SAFE = 9007199254740991n

/** The JSON number grammar, as a sticky pattern so the parser can match at an offset without slicing the text. */
export const NUMBER_TOKEN = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y

const TOKEN_PARTS = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/
// An exponent written with MORE than this many significant digits has a magnitude of at least 10^30. The mantissa and the fraction can
// never be that long (bundle text is bounded to 16 MiB, so a token has fewer than 2^25 characters), so such an exponent dominates the
// token completely and its sign alone decides the outcome: exact, not an approximation. Every exponent with fewer digits is handled
// with exact BigInt arithmetic, so NO spelling of an admitted integer is ever refused because of how long its exponent was written.
const DOMINANT_EXPONENT_DIGITS = 30

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
 * Exact evaluation of one JSON number token. Returns { value } (a safe-integer JavaScript number, never coerced) when admitted,
 * otherwise { problem } with one of:
 *   NEGATIVE_ZERO   the token is a zero written with a minus sign, in any spelling (-0, -0.0, -0e5)
 *   UNDERFLOW       a NONZERO token that a double would silently turn into zero (1e-400)
 *   NON_INTEGER     the exact value is not an integer (0.5, 98e-1, 9007199254740992.5)
 *   UNSAFE_INTEGER  the exact value is an integer beyond 2^53 - 1 in magnitude (9007199254740993.0, 1e21, 1e999)
 */
export function numberTokenProblem(token) {
  const m = TOKEN_PARTS.exec(token)
  if (!m) return { problem: 'NOT_A_NUMBER' }
  const [, sign, intDigits, fracDigits = '', expText = '0'] = m
  const negative = sign === '-'

  // Normalize the digit string with plain string operations (linear time, however long the token): drop leading zeros, and move
  // trailing zeros into the exponent. What remains, `significant`, is nonzero with no leading or trailing zero.
  const noLeading = (intDigits + fracDigits).replace(/^0+/, '')
  if (noLeading === '') return negative ? { problem: 'NEGATIVE_ZERO' } : { value: 0 }
  const significant = noLeading.replace(/0+$/, '')
  const trailingZeros = noLeading.length - significant.length

  // The exponent is read EXACTLY (never as a double): leading zeros are ignored and its sign and digits are kept.
  const expNegative = expText.startsWith('-')
  const expDigits = expText.replace(/^[+-]/, '').replace(/^0+/, '')
  if (expDigits.length > DOMINANT_EXPONENT_DIGITS) return { problem: expNegative ? 'UNDERFLOW' : 'UNSAFE_INTEGER' } // the value is nonzero here
  const exp = expDigits === '' ? 0n : (expNegative ? -BigInt(expDigits) : BigInt(expDigits))

  // value = significant x 10^scale exactly, and `significant` does not end in 0.
  const scale = exp - BigInt(fracDigits.length) + BigInt(trailingZeros)
  const digits = BigInt(significant.length)

  if (scale < 0n) {
    // A nonzero integer with no trailing zero is not divisible by 10, so dividing by 10^|scale| never leaves an integer.
    return { problem: Number(token) === 0 ? 'UNDERFLOW' : 'NON_INTEGER' }
  }
  // An integer with this many digits is beyond 2^53 - 1 (about 9.007e15): decided WITHOUT building it, so long tokens cost linear time.
  if (digits + scale > 16n) return { problem: 'UNSAFE_INTEGER' }
  const integer = BigInt(significant) * 10n ** scale // at most 16 digits
  if (integer > MAX_SAFE) return { problem: 'UNSAFE_INTEGER' }
  const value = Number(negative ? -integer : integer)
  // The two entry points must agree; if they ever did not, that is a defect here, so fail closed rather than admit.
  return numberProblem(value) === null ? { value } : { problem: 'NON_INTEGER' }
}
