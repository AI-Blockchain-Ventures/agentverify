// REFERENCE / TEST-ONLY (vector set v3). Not the product implementation. See conformance/v3/README.md.
//
// THE ONE STRICT CANONICAL TIMESTAMP PARSER. Every timestamp in this reference (issuedAt, key-set generatedAt/notBefore/retiredAt/
// revokedAt, and the verifier-supplied `now`) is judged by parseTimestamp and by nothing else.
//
// The canonical form is exactly   YYYY-MM-DDTHH:MM:SS.mmmZ   (24 characters, UTC, always three fractional digits).
//
// It does NOT use Date.parse, new Date(text) or a round trip through Date. Date.parse accepts many spellings and, depending on the
// runtime, may roll an impossible date forward (Feb 30 becomes Mar 1 or Mar 2), which would give one instant two spellings. The
// calendar is validated here by arithmetic, and the epoch value is computed here by arithmetic (days from civil date), so the
// answer is the same in every runtime.
//
// Admitted: years 0001-9999; months 01-12; days valid for that month and year (Gregorian leap years); hours 00-23 (24:00 is NOT
// admitted); minutes 00-59; seconds 00-59 (a leap second, :60, is NOT admitted); exactly three fractional digits.

const DIGIT_AT = (s, i) => { const c = s.charCodeAt(i); return c >= 48 && c <= 57 ? c - 48 : -1 }
const readDigits = (s, start, count) => {
  let n = 0
  for (let i = start; i < start + count; i++) { const d = DIGIT_AT(s, i); if (d < 0) return -1; n = n * 10 + d }
  return n
}

export const isLeapYear = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
export const daysInMonth = (y, m) => (m === 2 ? (isLeapYear(y) ? 29 : 28) : (m === 4 || m === 6 || m === 9 || m === 11) ? 30 : 31)

/** Days since 1970-01-01 for a proleptic Gregorian civil date (Howard Hinnant's algorithm). Exact integer arithmetic. */
export function daysFromCivil(y, m, d) {
  const yy = m <= 2 ? y - 1 : y
  const era = Math.floor(yy / 400)
  const yoe = yy - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/** The inverse of daysFromCivil, used only by the tests and the formatter. */
export function civilFromDays(z0) {
  const z = z0 + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp < 10 ? mp + 3 : mp - 9
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d }
}

/**
 * Returns { ms } (milliseconds since the Unix epoch, an exact integer) when `s` is a canonical timestamp, otherwise null.
 * Never throws, never rolls over, never accepts a non-string.
 */
export function parseTimestamp(s) {
  if (typeof s !== 'string' || s.length !== 24) return null
  if (s[4] !== '-' || s[7] !== '-' || s[10] !== 'T' || s[13] !== ':' || s[16] !== ':' || s[19] !== '.' || s[23] !== 'Z') return null
  const y = readDigits(s, 0, 4), mo = readDigits(s, 5, 2), d = readDigits(s, 8, 2)
  const h = readDigits(s, 11, 2), mi = readDigits(s, 14, 2), sec = readDigits(s, 17, 2), ms = readDigits(s, 20, 3)
  if (y < 1 || mo < 1 || d < 1 || h < 0 || mi < 0 || sec < 0 || ms < 0) return null
  if (mo > 12 || d > daysInMonth(y, mo)) return null
  if (h > 23 || mi > 59 || sec > 59) return null
  return { ms: ((daysFromCivil(y, mo, d) * 24 + h) * 60 + mi) * 60000 + sec * 1000 + ms }
}

export const isCanonicalTimestamp = s => parseTimestamp(s) !== null

/** Formats epoch milliseconds in the canonical form. For tests and fixtures; the verifier never needs it. */
export function formatTimestamp(epochMs) {
  const days = Math.floor(epochMs / 86400000)
  const rest = epochMs - days * 86400000
  const { y, m, d } = civilFromDays(days)
  const p = (n, w) => String(n).padStart(w, '0')
  return `${p(y, 4)}-${p(m, 2)}-${p(d, 2)}T${p(Math.floor(rest / 3600000), 2)}:${p(Math.floor(rest / 60000) % 60, 2)}:${p(Math.floor(rest / 1000) % 60, 2)}.${p(rest % 1000, 3)}Z`
}
