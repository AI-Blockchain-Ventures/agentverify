// REFERENCE / TEST-ONLY. Not the product implementation. See conformance/README.md.
//
// A strict JSON parser. JSON.parse is not usable for verification input because it silently accepts things that make
// two parties disagree about what was signed: duplicate object keys (last one wins), lone surrogate escapes, and
// number literals that lose precision. This parser rejects all of them, so a text either parses to exactly one value
// that every conforming parser agrees on, or it is refused.
//
// Error codes (stable, asserted by the vectors):
//   JSON_SYNTAX, JSON_BOM, JSON_TRAILING, JSON_DUPLICATE_KEY, JSON_ILL_FORMED_STRING,
//   JSON_NON_FINITE_NUMBER, JSON_TOO_DEEP
// and, in the default 'signed-content' numeric mode only (see numberProfile.mjs):
//   JSON_NUMBER_NOT_INTEGRAL, JSON_NUMBER_UNSAFE_INTEGER, JSON_NUMBER_NEGATIVE_ZERO, JSON_NUMBER_UNDERFLOW
//
// NUMERIC MODES. 'signed-content' (the default, and the only mode verification uses) admits exactly the Agent Verify signed
// numeric profile: any spelling whose EXACT mathematical value is a safe integer (98, 98.0, 9.8e1), evaluated without ever passing through a double. 'ieee' is the generic JSON reading (a literal is the nearest
// IEEE-754 double) and exists so the RFC 8785 serializer can be tested on its full domain. It must never be used on anything
// that is hashed or signed.

import { NUMBER_TOKEN, numberTokenProblem } from './numberProfile.mjs'

export class StrictJsonError extends Error {
  constructor(code, message, offset) {
    super(`${code}: ${message}${offset === undefined ? '' : ` (at offset ${offset})`}`)
    this.name = 'StrictJsonError'
    this.code = code
    this.offset = offset
  }
}

export const MAX_DEPTH = 64

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

export function parseStrictJson(text, { maxDepth = MAX_DEPTH, numbers = 'signed-content' } = {}) {
  if (numbers !== 'signed-content' && numbers !== 'ieee') throw new Error(`unknown numeric mode: ${numbers}`)
  if (typeof text !== 'string') throw new StrictJsonError('JSON_SYNTAX', 'input is not a string')
  if (text.charCodeAt(0) === 0xfeff) throw new StrictJsonError('JSON_BOM', 'a byte order mark is not allowed', 0)
  let i = 0

  const fail = (code, message) => { throw new StrictJsonError(code, message, i) }
  const skipWs = () => { while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++ }

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
    // Matched at the current offset on the FULL text (never a slice), so a very long literal is one token, judged as a whole.
    NUMBER_TOKEN.lastIndex = i
    const m = NUMBER_TOKEN.exec(text)
    if (!m) fail('JSON_SYNTAX', 'unexpected character')
    const literal = m[0]
    // "01", "1." and "+1" are not JSON: the pattern stops early and the following character is then rejected by the caller.
    let value
    if (numbers === 'ieee') {
      value = Number(literal)
      if (!Number.isFinite(value)) fail('JSON_NON_FINITE_NUMBER', 'number literal is not a finite IEEE 754 double')
    } else {
      // Signed-content profile: the token is evaluated EXACTLY (numberTokenProblem); only an exactly-known safe integer becomes a number.
      const r = numberTokenProblem(literal)
      if (r.problem === 'NEGATIVE_ZERO') fail('JSON_NUMBER_NEGATIVE_ZERO', 'negative zero is not admitted in signed content')
      if (r.problem === 'UNDERFLOW') fail('JSON_NUMBER_UNDERFLOW', 'a nonzero number that would silently become zero is not admitted')
      if (r.problem === 'UNSAFE_INTEGER') fail('JSON_NUMBER_UNSAFE_INTEGER', 'the exact integer value is outside +/-(2^53 - 1)')
      if (r.problem) fail('JSON_NUMBER_NOT_INTEGRAL', 'the exact value is not an integer')
      value = r.value
    }
    i += literal.length
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
    if (depth > maxDepth) fail('JSON_TOO_DEEP', `nesting deeper than ${maxDepth}`)
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
    if (depth > maxDepth) fail('JSON_TOO_DEEP', `nesting deeper than ${maxDepth}`)
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

  const value = parseValue(0)
  skipWs()
  if (i < text.length) fail('JSON_TRAILING', 'unexpected content after the JSON value')
  return value
}
