// REFERENCE / TEST-ONLY (vector set v4). Not the product implementation. See conformance/v4/README.md.
//
// Strict RFC 8785 (JSON Canonicalization Scheme). "Strict" means it REJECTS what the existing canonicalizeForHash coerces:
// undefined becomes null, unknown objects become String(x), and NaN passes through JSON.stringify as null. A canonicalizer that
// coerces lets two different in-memory values share one digest.
//
// Error codes (stable, asserted by the vectors):
//   JCS_UNDEFINED, JCS_NON_FINITE, JCS_NOT_PLAIN, JCS_ILL_FORMED_STRING, JCS_UNSUPPORTED_TYPE, JCS_CYCLE, JCS_TOO_DEEP
//   JCS_NUMBER_NOT_ADMITTED   (only with an admission predicate; see canonicalizeSigned)
//
// TWO ENTRY POINTS, ON PURPOSE.
//   canonicalize(value)         the generic RFC 8785 serializer: every finite double is allowed, exactly as the RFC says.
//   canonicalizeSigned(value)   the same serializer PLUS the Agent Verify signed-content numeric profile (numberProfile.mjs):
//                               safe integers only. Anything hashed or signed uses this one. The profile is stricter than
//                               RFC 8785 by design and must never be described as JCS behaviour.
//
// DEPTH is ABSOLUTE and shared with the strict parser (limits.mjs). This canonicalizer sees only a sub-object, so it is told the
// depth of that sub-object's PARENT as `baseDepth`: the root container is then at absolute depth baseDepth + 1. A sub-object that
// is digestible or signable is therefore also parseable inside its bundle, and the reverse.

import { exceedsDepth, MAX_JSON_DEPTH } from './limits.mjs'
import { numberProblem } from './numberProfile.mjs'
import { isWellFormedString, parseStrictJson } from './strictJson.mjs'

export class JcsError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`)
    this.name = 'JcsError'
    this.code = code
  }
}

export function canonicalize(value, { baseDepth = 0, admitNumber } = {}) {
  const stack = new Set()

  // `depth` is the absolute depth of the container being serialized (a scalar has no depth of its own).
  function ser(v, depth, where) {
    if (v === null) return 'null'
    switch (typeof v) {
      case 'undefined': throw new JcsError('JCS_UNDEFINED', `undefined at ${where}`)
      case 'boolean': return v ? 'true' : 'false'
      case 'number':
        if (!Number.isFinite(v)) throw new JcsError('JCS_NON_FINITE', `non-finite number at ${where}`)
        if (admitNumber) { const problem = admitNumber(v); if (problem !== null) throw new JcsError('JCS_NUMBER_NOT_ADMITTED', `${problem} at ${where}`) }
        // ECMAScript Number::toString is exactly what RFC 8785 section 3.2.2.3 requires; it also renders -0 as "0".
        return String(v)
      case 'string':
        if (!isWellFormedString(v)) throw new JcsError('JCS_ILL_FORMED_STRING', `lone surrogate in string at ${where}`)
        // For well-formed strings JSON.stringify matches RFC 8785 section 3.2.2.2 (minimal escaping, lowercase \u00xx).
        return JSON.stringify(v)
      case 'function': case 'symbol': case 'bigint':
        throw new JcsError('JCS_UNSUPPORTED_TYPE', `${typeof v} at ${where}`)
      default: break
    }
    if (exceedsDepth(depth)) throw new JcsError('JCS_TOO_DEEP', `nesting deeper than ${MAX_JSON_DEPTH} at ${where}`)
    if (stack.has(v)) throw new JcsError('JCS_CYCLE', `cycle at ${where}`)
    stack.add(v)
    try {
      if (Array.isArray(v)) {
        if (Object.getPrototypeOf(v) !== Array.prototype) throw new JcsError('JCS_NOT_PLAIN', `array subclass at ${where}`)
        const keys = Reflect.ownKeys(v).filter(k => k !== 'length')
        if (keys.length !== v.length || keys.some((k, idx) => k !== String(idx))) throw new JcsError('JCS_NOT_PLAIN', `sparse array or extra array properties at ${where}`)
        return `[${v.map((item, idx) => ser(item, depth + 1, `${where}[${idx}]`)).join(',')}]`
      }
      const proto = Object.getPrototypeOf(v)
      if (proto !== Object.prototype && proto !== null) throw new JcsError('JCS_NOT_PLAIN', `non-plain object (${proto?.constructor?.name ?? 'unknown'}) at ${where}`)
      const parts = []
      const own = Reflect.ownKeys(v)
      if (own.some(k => typeof k === 'symbol')) throw new JcsError('JCS_NOT_PLAIN', `symbol-keyed property at ${where}`)
      // Object.keys order is irrelevant: RFC 8785 sorts by UTF-16 code units, which is JavaScript's default string order.
      for (const key of [...own].sort()) {
        const d = Object.getOwnPropertyDescriptor(v, key)
        if (!d.enumerable || 'get' in d || 'set' in d) throw new JcsError('JCS_NOT_PLAIN', `non-data or non-enumerable property ${JSON.stringify(key)} at ${where}`)
        if (!isWellFormedString(key)) throw new JcsError('JCS_ILL_FORMED_STRING', `lone surrogate in a key at ${where}`)
        parts.push(`${JSON.stringify(key)}:${ser(d.value, depth + 1, `${where}.${key}`)}`)
      }
      return `{${parts.join(',')}}`
    } finally {
      stack.delete(v)
    }
  }

  // The root is a container at absolute depth baseDepth + 1.
  return ser(value, baseDepth + 1, '$')
}

/** Generic RFC 8785 over the FULL double domain. For testing the serializer; never for anything hashed or signed. */
export const canonicalizeText = text => canonicalize(parseStrictJson(text, { numbers: 'ieee' }))

/** RFC 8785 plus the signed-content numeric profile. What the assessment digest and the signing input use. */
export const canonicalizeSigned = (value, { baseDepth = 0 } = {}) => canonicalize(value, { baseDepth, admitNumber: numberProblem })
export const signedBytes = (value, options) => new TextEncoder().encode(canonicalizeSigned(value, options))

/** Parse strictly under the signed-content profile, then canonicalize: what a verifier does with received text. */
export const canonicalizeSignedText = text => canonicalizeSigned(parseStrictJson(text))

/** ECMAScript number serialization of the double with the given IEEE 754 bit pattern (hex, 16 digits). */
export function numberFromIeeeHex(hex) {
  const buf = new DataView(new ArrayBuffer(8))
  buf.setBigUint64(0, BigInt(`0x${hex}`))
  return buf.getFloat64(0)
}
