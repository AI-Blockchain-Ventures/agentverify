// REFERENCE / TEST-ONLY (vector set v3). Not the product implementation. See conformance/v3/README.md.
//
// A strict JSON parser. JSON.parse is not usable for verification input because it silently accepts things that make two parties
// disagree about what was signed: duplicate object keys (last one wins), lone surrogate escapes, and number literals that lose
// precision. This parser rejects all of them, so a text either parses to exactly one value that every conforming parser agrees
// on, or it is refused.
//
// Error codes (stable, asserted by the vectors):
//   JSON_SYNTAX, JSON_BOM, JSON_TRAILING, JSON_DUPLICATE_KEY, JSON_ILL_FORMED_STRING, JSON_NON_FINITE_NUMBER, JSON_TOO_DEEP
// and, in the default 'signed-content' numeric mode only (see numberProfile.mjs):
//   JSON_NUMBER_NOT_INTEGRAL, JSON_NUMBER_UNSAFE_INTEGER, JSON_NUMBER_NEGATIVE_ZERO
//
// NUMERIC MODES. 'signed-content' (the default, and the only mode verification uses) admits exactly the Agent Verify signed
// numeric profile: any spelling whose EXACT mathematical value is a safe integer, evaluated without passing through a double.
// 'ieee' is the generic JSON reading (a literal is the nearest IEEE-754 double); it exists so the RFC 8785 serializer can be tested
// on its full domain and must never be used on anything that is hashed or signed.
//
// DEPTH is ABSOLUTE and shared with the canonicalizer (limits.mjs): the root container is at depth baseDepth + 1 (baseDepth is 0
// for a whole bundle), and a container over MAX_JSON_DEPTH is refused.

import { exceedsDepth, MAX_JSON_DEPTH } from './limits.mjs'
import { numberTokenProblem, scanNumberToken } from './numberProfile.mjs'

export class StrictJsonError extends Error {
  constructor(code, message, offset) {
    super(`${code}: ${message}${offset === undefined ? '' : ` (at offset ${offset})`}`)
    this.name = 'StrictJsonError'
    this.code = code
    this.offset = offset
  }
}

export { MAX_JSON_DEPTH }

export function isWellFormedString(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1)
      if (n >= 0xdc00 && n <= 0xdfff) { i++; continue }
      return false
    }
    if (c >= 0xdc00 && c <= 0xdfff) return false
  }
  return true
}

export function parseStrictJson(text, { numbers = 'signed-content', baseDepth = 0 } = {}) {
  if (numbers !== 'signed-content' && numbers !== 'ieee') throw new Error(`unknown numeric mode: ${numbers}`)
  if (typeof text !== 'string') throw new StrictJsonError('JSON_SYNTAX', 'input is not a string')
  if (text.charCodeAt(0) === 0xfeff) throw new StrictJsonError('JSON_BOM', 'a byte order mark is not allowed', 0)
  let i = 0

  const fail = (code, message) => { throw new StrictJsonError(code, message, i) }
  const skipWs = () => { while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++ }

  // `depth` is the absolute depth of the CONTAINER about to be entered (the root container is baseDepth + 1).
  function parseValue(depth) {
    skipWs()
    if (i >= text.length) fail('JSON_SYNTAX', 'unexpected end of input')
    const ch = text[i]
    if (ch === '{') return parseObject(depth + 1)
    if (ch === '[') return parseArray(depth + 1)
    if (ch === '"') return parseString()
    if (text.startsWith('true', i)) { i += 4; return true }
    if (text.startsWith('false', i)) { i += 5; return false }
    if (text.startsWith('null', i)) { i += 4; return null }
    return parseNumber()
  }

  function parseNumber() {
    // Found by a hand-written scan (no regular expression), then judged as ONE token.
    const end = scanNumberToken(text, i)
    if (end < 0) fail('JSON_SYNTAX', 'unexpected character')
    const literal = text.slice(i, end)
    // "01", "1." and "+1" are not JSON: the scan stops early and the following character is then rejected by the caller.
    let value
    if (numbers === 'ieee') {
      value = Number(literal)
      if (!Number.isFinite(value)) fail('JSON_NON_FINITE_NUMBER', 'number literal is not a finite IEEE 754 double')
    } else {
      // Signed-content profile: the token is evaluated EXACTLY (numberTokenProblem); only an exactly-known safe integer becomes a number.
      const r = numberTokenProblem(literal)
      if (r.problem === 'NEGATIVE_ZERO') fail('JSON_NUMBER_NEGATIVE_ZERO', 'negative zero is not admitted in signed content')
      if (r.problem === 'UNSAFE_INTEGER') fail('JSON_NUMBER_UNSAFE_INTEGER', 'the exact integer value is outside +/-(2^53 - 1)')
      if (r.problem) fail('JSON_NUMBER_NOT_INTEGRAL', 'the exact value is not an integer')
      value = r.value
    }
    i = end
    return value
  }

  function parseString() {
    i++ // opening quote
    let out = ''
    for (;;) {
      if (i >= text.length) fail('JSON_SYNTAX', 'unterminated string')
      const c = text.charCodeAt(i)
      if (c === 0x22) { i++; break }
      if (c < 0x20) fail('JSON_SYNTAX', 'unescaped control character in string')
      if (c === 0x5c) {
        const e = text[i + 1]
        const simple = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
        if (e in simple) { out += simple[e]; i += 2; continue }
        if (e === 'u') {
          const hex = text.slice(i + 2, i + 6)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('JSON_SYNTAX', 'bad \\u escape')
          out += String.fromCharCode(parseInt(hex, 16))
          i += 6
          continue
        }
        fail('JSON_SYNTAX', 'bad escape')
      }
      out += text[i]
      i++
    }
    if (!isWellFormedString(out)) fail('JSON_ILL_FORMED_STRING', 'string contains a lone surrogate')
    return out
  }

  function parseArray(depth) {
    if (exceedsDepth(depth)) fail('JSON_TOO_DEEP', `nesting deeper than ${MAX_JSON_DEPTH}`)
    i++
    const out = []
    skipWs()
    if (text[i] === ']') { i++; return out }
    for (;;) {
      out.push(parseValue(depth))
      skipWs()
      if (text[i] === ',') { i++; continue }
      if (text[i] === ']') { i++; return out }
      fail('JSON_SYNTAX', 'expected , or ]')
    }
  }

  function parseObject(depth) {
    if (exceedsDepth(depth)) fail('JSON_TOO_DEEP', `nesting deeper than ${MAX_JSON_DEPTH}`)
    i++
    const out = {}
    const seen = new Set()
    skipWs()
    if (text[i] === '}') { i++; return out }
    for (;;) {
      skipWs()
      if (text[i] !== '"') fail('JSON_SYNTAX', 'expected a string key')
      const key = parseString()
      if (seen.has(key)) fail('JSON_DUPLICATE_KEY', `duplicate object key ${JSON.stringify(key)}`)
      seen.add(key)
      skipWs()
      if (text[i] !== ':') fail('JSON_SYNTAX', 'expected :')
      i++
      // defineProperty so a key named "__proto__" is an ordinary own property, never a prototype assignment.
      Object.defineProperty(out, key, { value: parseValue(depth), enumerable: true, writable: true, configurable: true })
      skipWs()
      if (text[i] === ',') { i++; continue }
      if (text[i] === '}') { i++; return out }
      fail('JSON_SYNTAX', 'expected , or }')
    }
  }

  const value = parseValue(baseDepth)
  skipWs()
  if (i < text.length) fail('JSON_TRAILING', 'unexpected content after the JSON value')
  return value
}

/**
 * THE NORMATIVE VERIFIER INPUT CONTRACT: bytes, not "whatever string the caller produced".
 * Returns { text } or { problem } with one of:
 *   NOT_BYTES   the input is not a Uint8Array (a string, a Buffer of another view type, an array, ...)
 *   TOO_LARGE   more than `maxBytes` bytes (checked FIRST, before any decoding)
 *   BOM         the bytes begin with a UTF-8 byte order mark (EF BB BF). One accepted transport encoding: no BOM.
 *   INVALID_UTF8  the bytes are not well-formed UTF-8 (overlong forms, encoded surrogates, truncated or stray bytes, code points
 *                 above U+10FFFF). Decoding is FATAL: invalid sequences are refused, never replaced with U+FFFD.
 */
export function decodeStrictUtf8(bytes, maxBytes) {
  if (!(bytes instanceof Uint8Array)) return { problem: 'NOT_BYTES' }
  if (bytes.length > maxBytes) return { problem: 'TOO_LARGE' }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { problem: 'BOM' }
  try {
    // ignoreBOM: true keeps a U+FEFF that is NOT at the start of the input as a character (it is never stripped silently).
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  } catch {
    return { problem: 'INVALID_UTF8' }
  }
}
