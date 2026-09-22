// REFERENCE / TEST-ONLY (vector set v4). Not the product implementation. See conformance/v4/README.md.
//
// Small strict-shape helpers shared by the payload, key-set, policy and assessment validators. Everything here reads OWN
// properties only: an inherited property is never a member of anything this reference validates.

import { isWellFormedString } from './strictJson.mjs'
import { numberProblem } from './numberProfile.mjs'

/** A plain object: a prototype of Object.prototype or null. Arrays, class instances, Maps, Dates and so on are not plain. */
export const isPlain = v => typeof v === 'object' && v !== null && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)

/** Own enumerable string keys, and no symbol keys. `optional` keys may be absent. Unknown keys fail. */
export function exactKeys(o, required, optional = []) {
  if (Object.getOwnPropertySymbols(o).length > 0) return false
  const keys = Object.keys(o)
  return required.every(k => Object.hasOwn(o, k)) && keys.every(k => required.includes(k) || optional.includes(k))
}

/** The own value of a property, or undefined. Never reads the prototype chain. */
export const own = (o, key) => (typeof o === 'object' && o !== null && Object.hasOwn(o, key) ? o[key] : undefined)

/** A real, dense array with the Array prototype and no extra properties (the shape JSON produces). */
export function isDenseArray(v) {
  if (!Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype) return false
  const keys = Reflect.ownKeys(v).filter(k => k !== 'length')
  return keys.length === v.length && keys.every((k, i) => k === String(i))
}

export const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
export const PROFILE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const CONTROL_ID = /^[A-Z]{3}\d{2}$/
export const COMMIT = /^[0-9a-f]{40}$/
export const PACKAGE_DIGEST = /^avpkg-sha256:[0-9a-f]{64}$/
export const ASSESSMENT_DIGEST = /^avassess-sha256:[0-9a-f]{64}$/

export const isString = s => typeof s === 'string' && isWellFormedString(s)
export const isNonEmptyString = s => isString(s) && s.length > 0
export const isSemver = s => typeof s === 'string' && SEMVER.test(s)
export const isCommit = s => typeof s === 'string' && COMMIT.test(s)
export const isNonNegativeSafeInteger = n => typeof n === 'number' && numberProblem(n) === null && n >= 0
export const isPositiveSafeInteger = n => typeof n === 'number' && numberProblem(n) === null && n >= 1
export const isUniqueStringArray = (a, itemOk) => isDenseArray(a) && a.every(itemOk) && new Set(a).size === a.length
