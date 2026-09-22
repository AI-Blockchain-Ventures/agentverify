// Test helpers shared by the conformance tests and the one-shot vector generator. TEST-ONLY.

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

/** A source is { signed: name } | { signed: name, patch: [...] } | { text: "..." }. Returns an object, or a string for text sources. */
export function resolveSource(vector, source) {
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

/** The verifier options a bundle case carries: its key set, policy and any explicit options (size ceiling, retained key-set sequence). */
export function caseOptions(vector, c) {
  return { ...(c.keySet ? { keySet: vector.keySets[c.keySet] } : {}), ...(c.policy ? { policy: c.policy } : {}), ...(c.options ?? {}) }
}
