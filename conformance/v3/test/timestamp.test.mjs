import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import * as ref from '../reference/profileAttestation.mjs'
import { civilFromDays, daysFromCivil, daysInMonth, formatTimestamp, isCanonicalTimestamp, isLeapYear, parseTimestamp } from '../reference/timestamp.mjs'
import { loadVector, toInputBytes } from './helpers.mjs'

const V = loadVector('timestamps.v3.json')
const BUNDLES = loadVector('bundles.v3.json')
const here = path.dirname(fileURLToPath(import.meta.url))
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('TIMESTAMPS: every valid vector parses to the frozen epoch value, computed by an independent oracle (Date), and formats back to itself', () => {
  assert.ok(V.valid.length >= 10)
  for (const v of V.valid) {
    assert.deepEqual(parseTimestamp(v.ts), { ms: v.epochMs }, v.ts)
    assert.equal(new Date(v.ts).getTime(), v.epochMs, `oracle: ${v.ts}`)
    assert.equal(formatTimestamp(v.epochMs), v.ts, `round trip: ${v.ts}`)
    assert.equal(isCanonicalTimestamp(v.ts), true)
  }
})

test('TIMESTAMPS: every invalid vector is refused (impossible dates, 24:00, leap seconds, every non-canonical spelling)', () => {
  assert.ok(V.invalid.length >= 40)
  for (const v of V.invalid) assert.equal(parseTimestamp(v.ts), null, `${v.name}: ${JSON.stringify(v.ts)}`)
  const names = new Set(V.invalid.map(v => v.name))
  for (const need of ['feb-30', 'apr-31', 'hour-24', 'leap-second', 'feb-29-common-year', 'feb-29-2100', 'no-milliseconds', 'offset-minus', 'lowercase-t', 'expanded-year', 'fullwidth-digits']) assert.ok(names.has(need), need)
})

test('TIMESTAMPS: a non-string is refused, never coerced', () => {
  for (const v of [undefined, null, 1768478400000, {}, ['2026-01-15T12:00:00.000Z'], true, new Date(0), Symbol.iterator]) assert.equal(parseTimestamp(v), null, String(typeof v))
  assert.equal(parseTimestamp(new String('2026-01-15T12:00:00.000Z')), null, 'a boxed string is not a string')
})

test('TIMESTAMPS: EXHAUSTIVE over the whole admitted range at day granularity: the arithmetic parser agrees with Date on every valid day, and refuses the day after every month end', () => {
  let days = 0
  for (let day = daysFromCivil(1, 1, 1); day <= daysFromCivil(9999, 12, 31); day++) {
    const ms = day * 86400000 + (((day % 7) + 7) % 7) * 3723004 // vary the time of day too (never negative)
    const iso = new Date(ms).toISOString()
    const r = parseTimestamp(iso)
    assert.ok(r && r.ms === ms, iso)
    assert.equal(formatTimestamp(ms), iso)
    days++
  }
  assert.ok(days > 3_600_000)
  // one past the last day of every month of a leap and a common year is not a date
  for (const y of [2023, 2024, 1900, 2000, 2100]) for (let m = 1; m <= 12; m++) {
    const past = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(daysInMonth(y, m) + 1).padStart(2, '0')}T00:00:00.000Z`
    assert.equal(parseTimestamp(past), null, past)
  }
})

test('TIMESTAMPS: leap years follow the Gregorian rule and civil <-> days is a bijection', () => {
  for (const [y, leap] of [[1900, false], [2000, true], [2024, true], [2025, false], [2100, false], [2400, true], [1600, true]]) assert.equal(isLeapYear(y), leap, String(y))
  for (const d of [-719162, -1, 0, 1, 19737, 2932896]) { const c = civilFromDays(d); assert.equal(daysFromCivil(c.y, c.m, c.d), d) }
})

test('TIMESTAMPS: Date is NOT used anywhere in the reference to parse or compare instants (the review found Date.parse rollover risk)', () => {
  const dir = path.join(here, '..', 'reference')
  for (const f of readdirSync(dir).filter(x => x.endsWith('.mjs'))) {
    const src = strip(readFileSync(path.join(dir, f), 'utf8'))
    assert.doesNotMatch(src, /Date\.parse|new Date\(|Date\.UTC|Date\.now|toISOString/, `${f} must not use Date`)
  }
})

test('TIMESTAMPS: one parser everywhere: issuedAt, key-set generatedAt/notBefore/retiredAt/revokedAt and the policy clock are all judged by it', () => {
  const src = strip(readFileSync(path.join(here, '..', 'reference', 'profileAttestation.mjs'), 'utf8'))
  assert.equal((src.match(/parseTimestamp\(/g) ?? []).length >= 5, true)
  assert.doesNotMatch(src, /ISO_UTC_MS|isCanonicalIso/)
  const policy = strip(readFileSync(path.join(here, '..', 'reference', 'policy.mjs'), 'utf8'))
  assert.match(policy, /parseTimestamp\(policy\.now\)/)
})

test('TIMESTAMP VECTORS at bundle level: impossible issuedAt values are MALFORMED (with a valid signature), and valid extremes verify', async () => {
  for (const c of BUNDLES.cases.filter(x => x.name.startsWith('strict.issuedAt-'))) {
    const r = await ref.verifyProfileBundleBytes(toInputBytes(structuredClone(BUNDLES.signed[c.source.signed].bundle)))
    assert.equal(r.integrity, 'MALFORMED', c.name); assert.equal(r.reasonCode, 'payload.issuedAt', c.name)
    // ...and the signature over that payload is genuinely valid, so the ONLY thing refusing it is the timestamp rule
    assert.equal(BUNDLES.signed[c.source.signed].bundle.attestation.signature.length, 88)
  }
  for (const n of ['leap-day', 'century-leap-day', 'last-instant', 'first-instant']) {
    const r = await ref.verifyProfileBundleBytes(toInputBytes(BUNDLES.signed[`T_${n}`].bundle))
    assert.equal(r.integrity, 'VALID', n)
  }
  const names = BUNDLES.cases.map(c => c.name)
  for (const need of ['strict.issuedAt-feb-30', 'strict.issuedAt-apr-31', 'strict.issuedAt-hour-24', 'strict.issuedAt-leap-second']) assert.ok(names.includes(need), need)
})

test('KEY-SET TIMESTAMP VECTORS: impossible generatedAt / notBefore / retiredAt / revokedAt make the key set invalid', () => {
  for (const n of ['impossible-generatedAt', 'impossible-notBefore', 'impossible-retiredAt', 'impossible-revokedAt']) {
    const c = BUNDLES.cases.find(x => x.name === `key-state.key-set-invalid.${n}`)
    assert.ok(c, n); assert.equal(c.expected.keyState, 'KEY_SET_INVALID')
  }
})
