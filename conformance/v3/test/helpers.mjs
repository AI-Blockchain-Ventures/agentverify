// Test helpers shared by the conformance tests and the one-shot vector generator (vector set v3). TEST-ONLY.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const VECTOR_DIR = path.join(here, '..', 'vectors')
export const loadVector = name => JSON.parse(readFileSync(path.join(VECTOR_DIR, name), 'utf8'))

const unescapePointer = s => s.replace(/~1/g, '/').replace(/~0/g, '~')

/**
 * A deliberately tiny subset of RFC 6902 JSON Patch (paths are RFC 6901 pointers), so a vector states exactly what was
 * changed and a reviewer can read it. Operations:
 *   replace  the target must already exist
 *   add      an object member that must NOT exist, or "-" / an index on an array
 *   remove   the target must exist
 *   swap     exchange items i and j of the array at `path` (used for reorder vectors)
 * A patch that names a path that does not exist throws: a vector whose mutation silently did nothing would be a vector that proves nothing.
 */
export function applyPatch(doc, ops) {
  const root = structuredClone(doc)
  const navigate = pointer => {
    const parts = pointer.split('/').slice(1).map(unescapePointer)
    let parent = root
    for (const part of parts.slice(0, -1)) {
      if (parent === undefined || parent === null || !(part in parent)) throw new Error(`patch path does not exist: ${pointer}`)
      parent = parent[part]
    }
    return { parent, key: parts[parts.length - 1] }
  }
  for (const op of ops) {
    if (op.op === 'swap') {
      const target = op.path.split('/').slice(1).map(unescapePointer).reduce((acc, part) => (acc === undefined || acc === null ? undefined : acc[part]), root)
      if (!Array.isArray(target)) throw new Error(`swap target is not an array: ${op.path}`)
      if (!(op.i in target) || !(op.j in target) || op.i === op.j) throw new Error(`swap indexes must be two distinct existing items: ${op.path}`)
      ;[target[op.i], target[op.j]] = [target[op.j], target[op.i]]
      continue
    }
    const { parent, key } = navigate(op.path)
    if (op.op === 'replace') {
      if (!(key in parent)) throw new Error(`replace target does not exist: ${op.path}`)
      parent[key] = structuredClone(op.value)
    } else if (op.op === 'add') {
      if (Array.isArray(parent)) {
        if (key === '-') parent.push(structuredClone(op.value))
        else parent.splice(Number(key), 0, structuredClone(op.value))
      } else {
        if (key in parent) throw new Error(`add target already exists: ${op.path}`)
        parent[key] = structuredClone(op.value)
      }
    } else if (op.op === 'remove') {
      if (!(key in parent)) throw new Error(`remove target does not exist: ${op.path}`)
      if (Array.isArray(parent)) parent.splice(Number(key), 1)
      else delete parent[key]
    } else {
      throw new Error(`unknown patch op: ${op.op}`)
    }
  }
  return root
}

/**
 * A number that JSON text cannot carry safely (a fraction, negative zero, a value beyond 2^53) is written in a vector as
 * { "$ieeeHex": "<16 hex digits>" } and rebuilt here as the exact IEEE-754 double; a deeply nested value is written { "$nested": k }.
 * Everything else is returned unchanged.
 */
export function reviveNumbers(value) {
  if (Array.isArray(value)) return value.map(reviveNumbers)
  if (value && typeof value === 'object') {
    // { "$nested": k } is k nested arrays around the string "x": a vector states a deep value without itself being deep.
    if (Object.keys(value).length === 1 && Number.isInteger(value.$nested)) { let v = 'x'; for (let i = 0; i < value.$nested; i++) v = [v]; return v }
    if (Object.keys(value).length === 1 && typeof value.$ieeeHex === 'string') { const dv = new DataView(new ArrayBuffer(8)); dv.setBigUint64(0, BigInt(`0x${value.$ieeeHex}`)); return dv.getFloat64(0) }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, reviveNumbers(v)]))
  }
  return value
}

/**
 * The BYTES a verifier is given for a resolved source (the normative verifier input). A text source is its UTF-8 encoding; an object
 * source is the UTF-8 encoding of its compact JSON serialization; a bytes source is used exactly as written.
 */
export function toInputBytes(resolved) {
  if (resolved instanceof Uint8Array) return resolved
  return new TextEncoder().encode(typeof resolved === 'string' ? resolved : JSON.stringify(resolved))
}

/** A source is { signed: name } | { signed: name, patch: [...] } | { text: "..." } | { bytesHex: "..." }. Returns an object, a string (text) or a Uint8Array (bytes). */
export function resolveSource(vector, source) {
  if (typeof source.bytesHex === 'string') return new Uint8Array(Buffer.from(source.bytesHex, 'hex'))
  if (typeof source.text === 'string') return source.text
  const entry = vector.signed[source.signed]
  if (!entry) throw new Error(`unknown signed bundle: ${source.signed}`)
  return source.patch ? applyPatch(entry.bundle, source.patch) : structuredClone(entry.bundle)
}

/** Every key in `expected` must equal the same key in `actual`; extra keys in `actual` are allowed. */
export function assertSubset(assert, actual, expected, label) {
  for (const [k, v] of Object.entries(expected)) assert.deepEqual(actual[k], v, `${label}: ${k}`)
}

/**
 * The attestation a legacy case feeds to a legacy verifier, and the expected public key it passes (if any).
 * A case is { from, patch? } (an attestation in legacy-attestation.v1.json) or { fromBundle } (the attestation of a signed
 * profile bundle in bundles.v1.json: the cross-type case).
 */
export function legacyCaseInput(legacyVector, bundlesVector, c) {
  const attestation = c.fromBundle
    ? structuredClone(bundlesVector.signed[c.fromBundle].bundle.attestation)
    : (c.patch ? applyPatch(legacyVector.attestations[c.from].attestation, c.patch) : structuredClone(legacyVector.attestations[c.from].attestation))
  return { attestation, expectedPublicKey: c.expectedPublicKey ? legacyVector.publicKeys[c.expectedPublicKey] : undefined }
}

/**
 * Policies whose defect is not expressible as JSON (a prototype, a class, a symbol key). A vector names one with policyBuilder and
 * the test / generator builds it here, so the shape is stated once.
 */
export function buildPolicy(c) {
  if (c.policyBuilder === 'inherited-requiredProfile') return Object.create({ requiredProfile: 'owasp-agentic-skills-2027' })
  if (c.policyBuilder === 'inherited-with-own-valid-key') return Object.assign(Object.create({ requiredProfile: 'owasp-agentic-skills-2027' }), { requiredControls: ['AST02'] })
  if (c.policyBuilder === 'class-instance') { class P { constructor() { this.requiredControls = ['AST02'] } } return new P() }
  if (c.policyBuilder === 'symbol-key') return { [Symbol('x')]: 1 }
  if (c.policyBuilder === 'null') return null
  if (c.policyBuilder === 'array') return []
  if (c.policyBuilder === 'string') return 'requiredControls'
  if (c.policyBuilder === 'undefined-value') return { requiredProfile: undefined }
  if (c.policyBuilder === 'null-prototype-valid') return Object.assign(Object.create(null), { requiredControls: ['AST02'] })
  if (c.policyBuilder === 'sparse-array') { const a = new Array(2); a[0] = 'KEY_ACTIVE'; return { acceptedKeyStates: a } }
  throw new Error(`unknown policyBuilder: ${c.policyBuilder}`)
}

/** The verifier options a bundle case carries: its key set, policy and any explicit options (size ceiling, retained key-set sequence). */
export function caseOptions(vector, c) {
  return {
    ...(c.keySet ? { keySet: vector.keySets[c.keySet] } : {}),
    ...(c.policyBuilder ? { policy: buildPolicy(c) } : (c.policy !== undefined ? { policy: reviveNumbers(c.policy) } : {})),
    ...(c.options ?? {}),
  }
}

// ── Adversarial number tokens: long runs of zeros in the MIDDLE of a token ────────────────────
//
// Each kind builds ONE JSON number token from a size N and states the exact result. The expectations are analytic (a formula in N),
// so they do not depend on any classifier; the tests additionally check them against an independent arbitrary-precision oracle.
const z = n => '0'.repeat(n)
const pow10 = n => 10n ** BigInt(n)
const safe = v => (v <= 9007199254740991n ? { value: Number(v) } : { problem: 'UNSAFE_INTEGER' })
export const ADVERSARIAL_KINDS = {
  'int-middle-zeros': { build: n => `1${z(n)}1`, expected: n => safe(pow10(n + 1) + 1n), description: '1, N zeros, 1 (an integer with a zero run in the middle)' },
  'int-trailing-zeros': { build: n => `1${z(n)}`, expected: n => safe(pow10(n)), description: '1 followed by N zeros' },
  'int-nines': { build: n => '9'.repeat(n), expected: n => safe(pow10(n) - 1n), description: 'N nines' },
  'int-zeros-cancelled-by-exponent': { build: n => `1${z(n)}e-${n}`, expected: () => ({ value: 1 }), description: '1, N zeros, e-N: exactly 1' },
  'int-shifted': { build: n => `5${z(n)}e-${n}`, expected: () => ({ value: 5 }), description: '5, N zeros, e-N: exactly 5' },
  'frac-middle-zeros': { build: n => `1.${z(n)}2`, expected: () => ({ problem: 'NON_INTEGER' }), description: '1., N zeros, 2 (a fraction with a zero run in the middle)' },
  'frac-trailing-zeros': { build: n => `1.${z(n)}`, expected: () => ({ value: 1 }), description: '1., then N zeros: exactly 1' },
  'frac-leading-zeros-shifted': { build: n => `0.${z(n)}1e${n + 1}`, expected: () => ({ value: 1 }), description: '0., N zeros, 1, e(N+1): exactly 1' },
  'frac-only-zeros': { build: n => `0.${z(n)}`, expected: () => ({ value: 0 }), description: '0. then N zeros: zero' },
  'frac-nonzero-last': { build: n => `0.${z(n)}5`, expected: () => ({ problem: 'NON_INTEGER' }), description: '0., N zeros, 5' },
  'negative-zero-fraction': { build: n => `-0.${z(n)}`, expected: () => ({ problem: 'NEGATIVE_ZERO' }), description: '-0. then N zeros' },
  'exp-leading-zeros-positive': { build: n => `1e${z(n)}5`, expected: () => ({ value: 100000 }), description: '1e, N zeros, 5: exactly 100000' },
  'exp-leading-zeros-negative': { build: n => `1e-${z(n)}5`, expected: () => ({ problem: 'NON_INTEGER' }), description: '1e-, N zeros, 5' },
  'exp-zero-with-zero-run': { build: n => `0e${z(n)}9`, expected: () => ({ value: 0 }), description: '0e, N zeros, 9: zero' },
  'int-middle-zeros-negative-exponent': { build: n => `1${z(n)}1e-${n + 1}`, expected: () => ({ problem: 'NON_INTEGER' }), description: '1, N zeros, 1, e-(N+1): 1.0...01, not an integer' },
}
export const adversarialToken = (kind, n) => ADVERSARIAL_KINDS[kind].build(n)
