import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { assessSkillPackageAst } from '@agentverify/scanner'
import worker from '../dist/worker.mjs'
import { handleProfileRequest, OWASP_AGENTIC_SKILLS_PROFILE_ID, MAX_PROFILE_FILES, PROFILE_RATE_LIMIT } from '../dist/profiles.mjs'
import { readBoundedBody, MAX_SCAN_REQUEST_BODY_BYTES } from '../dist/requestBody.mjs'

// THE PUBLIC CONTRACT PASS for `/v1/scan` + `profile`.
//
// Everything here is observable from outside the Worker: status codes, key sets, messages and behaviour.
// The frozen table lives in fixtures/profile-contract.v1.json. One thing is deliberately NOT frozen: the
// numeric rate limit (tests use the exported constant, so they require that a limiter exists, not what its
// number is). METERING IS NOW FROZEN, PUBLIC-RELEASE behaviour (RD-2 resolved for v1.5.0): a completed
// profile assessment consumes exactly one Agent Verify scan unit, the same metering path (and the same
// usage_monthly ledger) an ordinary scan uses — see section 13 below, which replaces the old "ALPHA, decision
// pending" test that used to live there.
//
// Obviously-fake fixtures only: no real keys, hosts or credentials appear below.

const C = JSON.parse(readFileSync(new URL('./fixtures/profile-contract.v1.json', import.meta.url), 'utf8'))
const profilesSource = readFileSync(new URL('../src/profiles.ts', import.meta.url), 'utf8')

const probe = await assessSkillPackageAst([{ path: 'SKILL.md', content: '---\nname: probe\ndescription: probe\n---\n' }])
const HAS_REAL_SCANNER = probe.ok && probe.assessment.controls.length > 0
const realOnly = { skip: HAS_REAL_SCANNER ? false : 'private scanner not present (public CI stub); covered by the local security release gate' }

const PROFILE = C.profileId
const FILE = { path: 'SKILL.md', content: '---\nname: x\ndescription: "x"\n---\n' }
let uidCounter = 0
const freshKey = () => `av_contract${++uidCounter}_profile_test_key_000000000000`
const enc = s => new TextEncoder().encode(s)
const sorted = o => Object.keys(o).sort()

// ── Harness ──────────────────────────────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch
async function withApi(fn) {
  const log = []
  globalThis.fetch = async (url, init) => {
    const href = String(url)
    log.push({ href, method: init?.method ?? 'GET' })
    if (href.includes('/documents/apiKeyIndex/')) {
      const key = decodeURIComponent(href.split('/documents/apiKeyIndex/')[1].split('?')[0])
      if (key.includes('revoked')) return new Response(JSON.stringify({ fields: { uid: { stringValue: key }, status: { stringValue: 'revoked' } } }), { status: 200 })
      if (key.includes('unknown')) return new Response('{}', { status: 404 })
      return new Response(JSON.stringify({ fields: { uid: { stringValue: key }, status: { stringValue: 'active' } } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('{}', { status: 404 })
  }
  try { return await fn(log) } finally { globalThis.fetch = originalFetch }
}
/** POST /v1/scan with a JSON object, a raw string, or raw bytes. */
const send = (body, { key = freshKey(), headers = {}, env = {}, auth = true } = {}) => worker.fetch(
  new Request('https://api.test/v1/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${key}` } : {}), ...headers },
    body: typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body),
  }),
  { FIREBASE_API_KEY: 'firebase_test_placeholder', ...env },
)
const read = async res => ({ status: res.status, headers: Object.fromEntries(res.headers), text: await res.text() })
const parse = r => JSON.parse(r.text)
const expectRow = (r, row, label) => {
  assert.equal(r.status, row.status, `${label}: status`)
  const body = parse(r)
  assert.deepEqual(sorted(body), [...row.keys].sort(), `${label}: keys`)
  if (row.error) assert.equal(body.error, row.error, `${label}: message`)
  return body
}
const fakeRegistry = result => {
  const calls = []
  return { calls, registry: new Map([[PROFILE, { id: PROFILE, assessmentSchemaVersion: '1.1.0', assess: async files => { calls.push(files); return typeof result === 'function' ? result(files) : result } }]]) }
}
const goodAssessment = { schemaVersion: '1.1.0', profile: { profileId: 'owasp-agentic-skills-2026', framework: 'F' }, controls: [], evidence: [], notImplementedControls: [], unmappedEvidenceIds: [], package: { digest: 'd', fileCount: 1, manifestFiles: [] }, notes: [] }
let handlerUid = 0
const viaHandler = (body, registry, options) => handleProfileRequest(body, `contract_handler_${++handlerUid}`, registry, options)
const d1Fake = ({ scanCount = 0 } = {}) => {
  const sql = []
  const stmt = q => ({ bind: () => stmt(q), first: async () => (/usage_monthly/i.test(q) && /select/i.test(q) ? { scan_count: scanCount } : null), run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }) })
  return { sql, db: { prepare: q => { sql.push(q); return stmt(q) } } }
}

// ── 1. The frozen success envelope ───────────────────────────────────────────────────────────

test('SUCCESS ENVELOPE: exact keys, exact types, schemaVersion 1.1.0, JSON content type', async () => {
  await withApi(async () => {
    const res = await send({ profile: PROFILE, files: [FILE] })
    const r = await read(res)
    const body = expectRow(r, C.success, 'success')
    assert.equal(body.profile, PROFILE)
    assert.equal(typeof body.assessment, 'object')
    assert.ok(body.assessment !== null && !Array.isArray(body.assessment))
    assert.equal(body.attestation, null)
    assert.strictEqual(body.saved, false)
    assert.equal(body.assessment.schemaVersion, C.assessmentSchemaVersion)
    assert.equal(r.headers['content-type'], 'application/json; charset=utf-8')
    assert.equal(r.headers['access-control-allow-origin'], '*')
  })
})

test('SUCCESS ENVELOPE: it is not a scan result. No report, findings, fingerprint, integrity hash or policy fields', async () => {
  await withApi(async () => {
    const body = parse(await read(await send({ profile: PROFILE, files: [FILE] })))
    for (const key of ['findings', 'verdict', 'riskScore', 'reportId', 'reportUrl', 'artifactFingerprint', 'reportIntegrity', 'policyProfile', 'policyResult', 'bom']) assert.equal(key in body, false, key)
  })
})

// ── 2. Unknown profiles and the closed set ───────────────────────────────────────────────────

test('UNKNOWN PROFILE: exact supportedProfiles, exact message, and never a fallback to a normal scan', async () => {
  await withApi(async () => {
    for (const profile of ['nope', '', null, 7, ['x'], 'OWASP-AGENTIC-SKILLS-2026', '__proto__']) {
      const body = expectRow(await read(await send({ profile, files: [FILE], content: undefined })), C.errors.unknownProfile, JSON.stringify(profile))
      assert.deepEqual(body.supportedProfiles, C.supportedProfiles)
      assert.equal('findings' in body, false)
    }
  })
})

// ── 3. Authentication precedence ─────────────────────────────────────────────────────────────

test('AUTH PRECEDENCE: an unauthenticated request reveals nothing about profiles, whatever it contains', async () => {
  const ordinary = await read(await send({ content: 'x' }, { auth: false }))
  expectRow(ordinary, C.errors.unauthenticated, 'ordinary unauthenticated scan')
  const unreadable = () => new ReadableStream({ pull() { throw new Error('the body must not be read before authentication') } })
  const attempts = {
    unknownProfile: () => send({ profile: 'nope', files: [FILE] }, { auth: false }),
    validProfile: () => send({ profile: PROFILE, files: [FILE] }, { auth: false }),
    malformedJson: () => send('{ not json', { auth: false }),
    invalidUtf8: () => send(new Uint8Array([0xff, 0xfe, 0xfd]), { auth: false }),
    hugeDeclaredLength: () => send('{}', { auth: false, headers: { 'Content-Length': String(MAX_SCAN_REQUEST_BODY_BYTES * 2) } }),
    malformedKey: () => send({ profile: PROFILE, files: [FILE] }, { key: 'not-an-agentverify-key' }),
    unreadableBody: () => worker.fetch(new Request('https://api.test/v1/scan', { method: 'POST', duplex: 'half', body: unreadable() }), { FIREBASE_API_KEY: 'x' }),
  }
  await withApi(async () => {
    for (const [name, attempt] of Object.entries(attempts)) {
      const r = await read(await attempt())
      assert.equal(r.status, ordinary.status, name)
      assert.equal(r.text, ordinary.text, `${name}: identical body to an ordinary unauthenticated scan`)
      assert.deepEqual(r.headers, ordinary.headers, `${name}: identical headers`)
      assert.equal(/supportedProfiles|owasp|profile/i.test(r.text), false, name)
    }
    // Unknown and revoked keys are refused identically, before any body handling.
    for (const key of ['av_unknown_profile_test_key_000000000000', 'av_revoked_profile_test_key_000000000000']) {
      const r = await read(await send({ profile: PROFILE, files: [FILE] }, { key }))
      assert.equal(r.status, 401)
      assert.equal(r.text, ordinary.text)
    }
  })
})

test('QUOTA PRECEDENCE: a user already over the scan quota gets the same 429 with or without a profile, and no profile information', async () => {
  const over = d1Fake({ scanCount: 10 })
  await withApi(async () => {
    const key = freshKey()
    const plain = await read(await send({ content: 'x' }, { key, env: { BILLING_DB: over.db } }))
    const profiled = await read(await send({ profile: PROFILE, files: [FILE] }, { key, env: { BILLING_DB: over.db } }))
    assert.equal(plain.status, 429)
    assert.equal(profiled.status, 429)
    assert.equal(profiled.text, plain.text)
    assert.equal(/supportedProfiles|owasp/i.test(profiled.text), false)
  })
})

// ── 4. 400 vs 413 vs 422 boundaries ──────────────────────────────────────────────────────────

test('BOUNDARIES: 400 is a malformed request, 413 is a size limit, 422 is a package the scanner rejects', async () => {
  await withApi(async () => {
    // 400: malformed request
    expectRow(await read(await send('{ not json')), C.errors.invalidJson, 'invalid JSON')
    expectRow(await read(await send({ profile: PROFILE })), C.errors.malformedRequest, 'missing files')
    expectRow(await read(await send({ profile: PROFILE, files: [] })), C.errors.malformedRequest, 'empty package')
    expectRow(await read(await send({ profile: PROFILE, files: [FILE], content: 'x' })), C.errors.malformedRequest, 'mixed request')
    // 413: size limits
    expectRow(await read(await send({ profile: PROFILE, files: Array.from({ length: MAX_PROFILE_FILES + 1 }, (_, i) => ({ path: `f${i}`, content: '' })) })), C.errors.tooManyFiles, '501 files')
  })
  assert.equal(C.limits.maxFiles, MAX_PROFILE_FILES)
  assert.equal(C.limits.maxRequestBodyBytes, MAX_SCAN_REQUEST_BODY_BYTES)
})

test('BOUNDARIES: scanner size rejections are 413 and every other package rejection is 422 (mapping is by code, and nothing else changes)', async () => {
  const sizeCodes = C.rejection.sizeCodes
  for (const code of [...sizeCodes, 'unsafe_path', 'duplicate_path', 'non_regular_entry', 'ill_formed_unicode', 'empty_package', 'some_future_code']) {
    const { registry } = fakeRegistry({ ok: false, rejection: { code, message: 'm', path: 'p', internal: 'LEAK' } })
    const r = await viaHandler({ profile: PROFILE, files: [FILE] }, registry)
    const want = sizeCodes.includes(code) ? C.errors.packageSizeRejected : C.errors.packageRejected
    assert.equal(r.status, want.status, code)
    assert.deepEqual(sorted(r.body), [...want.keys].sort())
    assert.equal(r.body.error, want.error)
    assert.deepEqual(sorted(r.body.rejection), ['code', 'message', 'path'])
    assert.equal(JSON.stringify(r.body).includes('LEAK'), false)
  }
})

test('BOUNDARIES: a rejection without a path has no path key', async () => {
  const { registry } = fakeRegistry({ ok: false, rejection: { code: 'too_many_files', message: 'm' } })
  assert.deepEqual(sorted((await viaHandler({ profile: PROFILE, files: [FILE] }, registry)).body.rejection), ['code', 'message'])
})

test('BOUNDARIES (real scanner): oversized files and packages are 413; hostile content is 422', realOnly, async () => {
  await withApi(async () => {
    const huge = await read(await send({ profile: PROFILE, files: [{ path: 'big.md', content: 'x'.repeat(1024 * 1024 + 1) }] }))
    assert.equal(huge.status, 413)
    assert.equal(parse(huge).rejection.code, 'file_too_large')
    const many = Array.from({ length: 6 }, (_, i) => ({ path: `f${i}.md`, content: 'y'.repeat(900 * 1024) }))
    const total = await read(await send({ profile: PROFILE, files: many }))
    assert.equal(total.status, 413)
    assert.equal(parse(total).rejection.code, 'package_too_large')
    const hostile = await read(await send({ profile: PROFILE, files: [{ path: '../x.md', content: 'x' }] }))
    expectRow(hostile, C.errors.packageRejected, 'hostile path')
    assert.equal(parse(hostile).rejection.code, 'unsafe_path')
  })
})

// ── 5. Body-size ceiling before expensive parsing ────────────────────────────────────────────

test('BODY CEILING: readBoundedBody stops at the ceiling exactly, by declared length or by streaming', async () => {
  const req = (body, headers = {}) => new Request('https://x.test/', { method: 'POST', headers, body, duplex: 'half' })
  assert.equal((await readBoundedBody(req(new Uint8Array(10)), 10)).ok, true)
  assert.equal((await readBoundedBody(req(new Uint8Array(11)), 10)).ok, false)
  assert.equal((await readBoundedBody(req(null), 10)).ok, true)
  assert.equal((await readBoundedBody(req('x', { 'content-length': '999' }), 10)).ok, false, 'a declared length over the ceiling is refused without reading')
  let pulled = 0
  const stream = new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(4)) } })
  assert.equal((await readBoundedBody(req(stream), 10)).ok, false)
  assert.ok(pulled <= 4, `streaming stopped early (pulled ${pulled} chunks)`)
})

test('BODY CEILING: an oversized profile body is a 413 before any parsing, whether declared or streamed', async () => {
  await withApi(async () => {
    // Declared: the body is not even valid JSON, proving nothing was parsed.
    const declared = await read(await send('{ not json', { headers: { 'Content-Length': String(MAX_SCAN_REQUEST_BODY_BYTES + 1) } }))
    expectRow(declared, C.errors.bodyTooLarge, 'declared length')
    // Streamed with no declared length: it is cut off at the ceiling and the rest is never pulled.
    let pulled = 0
    const chunk = 1024 * 1024
    const big = new ReadableStream({ pull(c) { pulled++; if (pulled > 200) { c.close(); return } c.enqueue(new Uint8Array(chunk)) } })
    const res = await worker.fetch(new Request('https://api.test/v1/scan', { method: 'POST', duplex: 'half', headers: { Authorization: `Bearer ${freshKey()}` }, body: big }), { FIREBASE_API_KEY: 'x' })
    expectRow(await read(res), C.errors.bodyTooLarge, 'streamed')
    assert.ok(pulled <= MAX_SCAN_REQUEST_BODY_BYTES / chunk + 2, `stopped reading at the ceiling (pulled ${pulled} MiB)`)
  })
})

test('BODY CEILING: it never changes what an ordinary oversized scan already returned (the 5 MB content limit still applies)', async () => {
  await withApi(async () => {
    const r = await read(await send({ content: 'x'.repeat(5 * 1024 * 1024 + 1) }))
    assert.equal(r.status, 413)
    assert.match(parse(r).error, /content exceeds the 5MB scan limit/)
  })
})

// ── 6. Package shape edge cases ──────────────────────────────────────────────────────────────

test('SHAPE: exactly 500 files reaches the scanner; 501 does not; an empty package is refused', async () => {
  const { registry, calls } = fakeRegistry({ ok: true, assessment: goodAssessment })
  const make = n => Array.from({ length: n }, (_, i) => ({ path: `f${i}.md`, content: '' }))
  assert.equal((await viaHandler({ profile: PROFILE, files: make(500) }, registry)).status, 200)
  assert.equal(calls[0].length, 500)
  assert.equal((await viaHandler({ profile: PROFILE, files: make(501) }, registry)).status, 413)
  assert.equal((await viaHandler({ profile: PROFILE, files: [] }, registry)).status, 400)
  assert.equal(calls.length, 1)
})

test('SHAPE: empty content is a valid file; an empty path is a package the scanner rejects', async () => {
  const { registry, calls } = fakeRegistry({ ok: true, assessment: goodAssessment })
  assert.equal((await viaHandler({ profile: PROFILE, files: [{ path: 'empty.md', content: '' }] }, registry)).status, 200)
  assert.deepEqual(calls[0], [{ path: 'empty.md', content: '' }])
  await withApi(async () => {
    if (HAS_REAL_SCANNER) {
      const ok = await read(await send({ profile: PROFILE, files: [{ path: 'empty.md', content: '' }] }))
      assert.equal(ok.status, 200)
      const bad = await read(await send({ profile: PROFILE, files: [{ path: '', content: 'x' }] }))
      assert.equal(bad.status, 422)
      assert.equal(parse(bad).rejection.code, 'unsafe_path')
    }
  })
})

test('SHAPE: non-string path or content, and non-object entries, are 400', async () => {
  const { registry, calls } = fakeRegistry({ ok: true, assessment: goodAssessment })
  const bad = [
    { path: 1, content: 'x' }, { path: null, content: 'x' }, { path: ['a'], content: 'x' }, { path: {}, content: 'x' }, { path: true, content: 'x' },
    { path: 'a', content: 1 }, { path: 'a', content: null }, { path: 'a', content: ['x'] }, { path: 'a', content: {} }, { path: 'a' }, { content: 'x' }, {},
    null, 'a.md', 7, [],
  ]
  for (const entry of bad) {
    const r = await viaHandler({ profile: PROFILE, files: [FILE, entry] }, registry)
    assert.equal(r.status, 400, JSON.stringify(entry))
    assert.deepEqual(sorted(r.body), ['error'])
  }
  assert.equal(calls.length, 0, 'a partly valid package never reaches the scanner')
})

// ── 7. Paths: the Worker is a transparent pipe; the scanner judges ───────────────────────────

const PATHS = {
  nul: 'a' + String.fromCharCode(0) + 'b.md',
  control: 'a' + String.fromCharCode(7) + 'b.md',
  del: 'a' + String.fromCharCode(127) + 'b.md',
  backslash: 'a\\b.md',
  mixedSlashes: 'a/b\\c/d.md',
  dotdotBackslash: '..\\x.md',
  percentDotDot: '%2e%2e/x.md',
  percentSlash: 'a%2fb.md',
  percentBackslash: 'a%5cb.md',
  percentNul: 'a%00b.md',
  percentTraversalReal: '%2e%2e/../x.md',
  nfc: 'caf' + String.fromCharCode(0xe9) + '.md',
  nfd: 'cafe' + String.fromCharCode(0x301) + '.md',
  astral: 'smile-' + String.fromCodePoint(0x1f600) + '.md',
  upper: 'README.md',
  lower: 'readme.md',
  trailingSpace: 'a.md ',
  loneSurrogate: String.fromCharCode(0xd800) + '.md',
  longPath: 'a/'.repeat(30) + 'x.md',
}

test('PATHS: the Worker passes path and content strings to the scanner byte for byte. No decoding, normalizing, trimming or case-folding', async () => {
  const { registry, calls } = fakeRegistry({ ok: true, assessment: goodAssessment })
  const files = Object.values(PATHS).map((path, i) => ({ path, content: `c${i}` + String.fromCharCode(0) + '\u00e9' }))
  await viaHandler({ profile: PROFILE, files }, registry)
  assert.deepEqual(calls[0], files)
  for (const [i, f] of calls[0].entries()) assert.equal(f.path, Object.values(PATHS)[i])
})

test('PATHS (real scanner): dangerous paths are 422, in every spelling', realOnly, async () => {
  await withApi(async () => {
    for (const name of ['nul', 'control', 'del', 'backslash', 'mixedSlashes', 'dotdotBackslash', 'percentTraversalReal', 'trailingSpace', 'loneSurrogate', 'nfd']) {
      const r = await read(await send({ profile: PROFILE, files: [FILE, { path: PATHS[name], content: 'x' }] }))
      assert.equal(r.status, 422, name)
      assert.equal(parse(r).rejection.code, 'unsafe_path', name)
    }
    for (const bad of ['/etc/x.md', 'C:/x.md', '../x.md', 'a/../x.md', './x.md', 'a//b.md']) {
      assert.equal((await read(await send({ profile: PROFILE, files: [FILE, { path: bad, content: 'x' }] }))).status, 422, bad)
    }
  })
})

test('PATHS (real scanner): percent-looking paths stay LITERAL. They are never decoded, and are rejected only when the literal path itself is dangerous', realOnly, async () => {
  await withApi(async () => {
    const manifest = '---\nname: x\ndescription: "x"\n---\n'
    // Each name is used as a DIRECTORY holding a SKILL.md, so the assessment reports the path back to us.
    for (const name of ['percentDotDot', 'percentSlash', 'percentBackslash', 'percentNul', 'nfc', 'astral']) {
      const path = `${PATHS[name].replace(/\.md$/, '')}/SKILL.md`
      const r = await read(await send({ profile: PROFILE, files: [{ path, content: manifest }] }))
      assert.equal(r.status, 200, `${name}: a literal percent sequence is an ordinary filename`)
      assert.deepEqual(parse(r).assessment.package.manifestFiles, [path], `${name}: reported exactly as submitted, never decoded`)
    }
    // A path that is only too deep is a package rejection, not a decoding question.
    const deep = await read(await send({ profile: PROFILE, files: [{ path: PATHS.longPath, content: 'x' }] }))
    assert.equal(deep.status, 422)
    // The literal directory name %2e%2e is reported as-is; it is never turned into a parent reference.
    const lit = parse(await read(await send({ profile: PROFILE, files: [{ path: '%2e%2e/SKILL.md', content: '---\nname: x\ndescription: "x"\n---\n' }] })))
    assert.deepEqual(lit.assessment.package.manifestFiles, ['%2e%2e/SKILL.md'])
    assert.equal(JSON.stringify(lit).includes('"../SKILL.md"'), false)
    // A REAL traversal segment next to it is still rejected.
    const real = await read(await send({ profile: PROFILE, files: [FILE, { path: '%2e%2e/../x.md', content: 'x' }] }))
    assert.equal(real.status, 422)
  })
})

test('PATHS (real scanner): duplicates are 422: exact, case-fold, and NFC-equivalent spellings', realOnly, async () => {
  await withApi(async () => {
    const dup = (a, b) => send({ profile: PROFILE, files: [{ path: a, content: '1' }, { path: b, content: '2' }] })
    for (const [a, b] of [['a.md', 'a.md'], [PATHS.upper, PATHS.lower], ['Skill.MD', 'skill.md']]) {
      const r = await read(await dup(a, b))
      assert.equal(r.status, 422, `${a} / ${b}`)
      assert.equal(parse(r).rejection.code, 'duplicate_path')
    }
    // NFC and NFD spellings of the same name: the decomposed one is refused outright, never accepted as a second file.
    const r = await read(await dup(PATHS.nfc, PATHS.nfd))
    assert.equal(r.status, 422)
    assert.equal(parse(r).rejection.code, 'unsafe_path')
    assert.equal((await read(await send({ profile: PROFILE, files: [{ path: PATHS.nfc, content: '1' }] }))).status, 200, 'the precomposed spelling alone is fine')
  })
})

test('CONTENT (real scanner): ill-formed Unicode is refused, so two different inputs can never share a package digest', realOnly, async () => {
  await withApi(async () => {
    const lone = String.fromCharCode(0xd800)
    const r = await read(await send({ profile: PROFILE, files: [{ path: 'a.md', content: 'x' + lone }] }))
    assert.equal(r.status, 422)
    assert.equal(parse(r).rejection.code, 'ill_formed_unicode')
    // NUL and control characters in CONTENT are just content; they are reported, not refused.
    const nul = await read(await send({ profile: PROFILE, files: [{ path: 'SKILL.md', content: '---\nname: x\ndescription: "x"\n---\nhi' + String.fromCharCode(0) + '\n' }] }))
    assert.equal(nul.status, 200)
    assert.equal(nul.text.includes(String.fromCharCode(0)), false)
  })
})

// ── 8. Encodings and JSON ────────────────────────────────────────────────────────────────────

const rawBody = (before, bytes, after) => new Uint8Array([...enc(before), ...bytes, ...enc(after)])

test('ENCODING: malformed UTF-8 is 400 for a profile request, in every spelling, but ordinary scans keep their lenient behaviour', async () => {
  await withApi(async () => {
    const shapes = {
      invalidByte: [0xff, 0xfe],
      overlong: [0xc0, 0xaf],
      encodedSurrogate: [0xed, 0xa0, 0x80], // CESU-8 style surrogate half
      truncatedSequence: [0xe2, 0x82],
      continuationOnly: [0x80, 0x80],
    }
    for (const [name, bytes] of Object.entries(shapes)) {
      const profile = rawBody(`{"profile":"${PROFILE}","files":[{"path":"a.md","content":"x `, bytes, ` y"}]}`)
      expectRow(await read(await send(profile)), C.errors.invalidUtf8, name)
    }
    // Ordinary scans are unchanged: the same bytes are repaired, exactly as before.
    const ordinary = rawBody('{"content":"const a = 1 // ', [0xff, 0xfe], '", "fileName":"a.ts"}')
    assert.equal((await read(await send(ordinary))).status, 200)
  })
})

test('ENCODING: a UTF-8 byte-order mark is accepted; UTF-16 and other encodings are refused as invalid JSON', async () => {
  await withApi(async () => {
    const json = JSON.stringify({ profile: PROFILE, files: [FILE] })
    assert.equal((await read(await send(new Uint8Array([0xef, 0xbb, 0xbf, ...enc(json)])))).status, 200)
    const utf16le = new Uint8Array([0xff, 0xfe, ...[...json].flatMap(c => [c.charCodeAt(0), 0])])
    expectRow(await read(await send(utf16le)), C.errors.invalidJson, 'UTF-16LE')
    expectRow(await read(await send(new Uint8Array([...enc('{"profile":'), 0, 0, ...enc('}')]))), C.errors.invalidJson, 'NUL bytes')
    expectRow(await read(await send('')), C.errors.invalidJson, 'empty body')
    for (const notObject of ['null', '[1,2]', '"str"', '7', 'true']) assert.equal((await read(await send(notObject))).status, 400, notObject)
  })
})

test('ENCODING: a charset label in Content-Type does not change how the body is decoded', async () => {
  await withApi(async () => {
    const json = JSON.stringify({ profile: PROFILE, files: [FILE] })
    for (const contentType of ['application/json; charset=utf-16', 'text/plain', 'application/json; charset=latin1']) {
      assert.equal((await read(await send(json, { headers: { 'Content-Type': contentType } }))).status, 200, contentType)
    }
  })
})

test('JSON DUPLICATE KEYS (tripwire): the runtime resolves duplicates last-wins. This documents it so a runtime change is noticed', async () => {
  // Accepted, low risk: the endpoint is authenticated and no authorization decision depends on these
  // fields. If the runtime ever changes this behaviour, this test fails and the contract is reviewed.
  await withApi(async () => {
    const lastWins = `{"profile":"nope","profile":"${PROFILE}","files":[${JSON.stringify(FILE)}]}`
    assert.equal((await read(await send(lastWins))).status, 200)
    const otherOrder = `{"profile":"${PROFILE}","profile":"nope","files":[${JSON.stringify(FILE)}]}`
    expectRow(await read(await send(otherOrder)), C.errors.unknownProfile, 'other order')
    const dupFiles = `{"profile":"${PROFILE}","files":[],"files":[${JSON.stringify(FILE)}]}`
    assert.equal((await read(await send(dupFiles))).status, 200)
  })
})

test('JSON: a __proto__ key in the body is inert and pollutes nothing', async () => {
  await withApi(async () => {
    const body = `{"__proto__":{"profile":"${PROFILE}"},"files":[${JSON.stringify(FILE)}]}`
    const r = await read(await send(body))
    assert.equal(r.status, 400, 'an inherited-looking profile is not a profile: this is an ordinary scan missing content')
    assert.equal(({}).profile, undefined)
    assert.equal(parse(r).error, 'content is required')
  })
})

// ── 9. Failure behaviour ─────────────────────────────────────────────────────────────────────

test('FAILURE: a hung assessor is a generic 500 after the timeout, with no internal detail', async () => {
  const { registry } = fakeRegistry(() => new Promise(() => {}))
  const started = Date.now()
  const r = await viaHandler({ profile: PROFILE, files: [FILE] }, registry, { timeoutMs: 30 })
  assert.equal(r.status, C.errors.internal.status)
  assert.deepEqual(r.body, { error: C.errors.internal.error })
  assert.ok(Date.now() - started < 2000)
})

test('FAILURE: every way an assessor can go wrong is a generic 500, never a client error, and never leaks detail', async () => {
  const bad = {
    throws: () => { throw new Error('secret internal detail /var/x') },
    rejects: () => Promise.reject(new Error('secret internal detail')),
    throwsString: () => { throw 'secret internal detail' },
    returnsNull: () => null,
    returnsUndefined: () => undefined,
    returnsString: () => 'ok',
    okWithoutAssessment: () => ({ ok: true }),
    okWithNullAssessment: () => ({ ok: true, assessment: null }),
    okWithStringAssessment: () => ({ ok: true, assessment: 'x' }),
    missingSchemaVersion: () => ({ ok: true, assessment: { ...goodAssessment, schemaVersion: undefined } }),
    wrongSchemaVersion: () => ({ ok: true, assessment: { ...goodAssessment, schemaVersion: '1.0.1' } }),
    historicalSchemaVersion: () => ({ ok: true, assessment: { ...goodAssessment, schemaVersion: '1.0.0' } }),
    futureSchemaVersion: () => ({ ok: true, assessment: { ...goodAssessment, schemaVersion: '2.0.0' } }),
    numericSchemaVersion: () => ({ ok: true, assessment: { ...goodAssessment, schemaVersion: 1 } }),
    missingProfileId: () => ({ ok: true, assessment: { ...goodAssessment, profile: { framework: 'F' } } }),
    mismatchedProfileId: () => ({ ok: true, assessment: { ...goodAssessment, profile: { profileId: 'owasp-agentic-skills-2027', framework: 'F' } } }),
    nonStringProfileId: () => ({ ok: true, assessment: { ...goodAssessment, profile: { profileId: 1, framework: 'F' } } }),
    nullProfile: () => ({ ok: true, assessment: { ...goodAssessment, profile: null } }),
    rejectionMissing: () => ({ ok: false }),
    rejectionNull: () => ({ ok: false, rejection: null }),
    rejectionBadCode: () => ({ ok: false, rejection: { code: 5, message: 'm' } }),
    okNotBoolean: () => ({ ok: 'yes', assessment: goodAssessment }),
  }
  for (const [name, make] of Object.entries(bad)) {
    const { registry } = fakeRegistry(make)
    const r = await viaHandler({ profile: PROFILE, files: [FILE] }, registry)
    assert.equal(r.status, 500, name)
    assert.deepEqual(r.body, { error: 'Profile assessment failed' }, name)
    assert.equal(JSON.stringify(r.body).includes('secret'), false, name)
  }
})

test('FAILURE: an assessor failure through the real route is never reported as "Invalid JSON body"', async () => {
  // The route's outer catch answers 400 "Invalid JSON body" for anything unexpected; a profile request must
  // never fall into it. (Exercised at the handler, which the route calls; the source guard pins the wiring.)
  const { registry } = fakeRegistry(() => { throw new TypeError('Cannot read properties of undefined') })
  const r = await viaHandler({ profile: PROFILE, files: [FILE] }, registry)
  assert.equal(r.status, 500)
  assert.equal(JSON.stringify(r.body).includes('JSON'), false)
})

// ── 10. The Worker is a transparent boundary ─────────────────────────────────────────────────

function deepFreeze(o) { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o) } return o }

test('TRANSPARENT: additive scanner changes under the same schema come through untouched: not reinterpreted, enriched, reordered or filtered', async () => {
  const assessment = deepFreeze({
    schemaVersion: '1.1.0',
    zzzFutureTopLevel: { nested: [3, 1, 2] },
    profile: { profileId: 'owasp-agentic-skills-2026', framework: 'F', someNewProfileField: 'v' },
    controls: [
      { controlId: 'AST99', title: 'A control that does not exist yet', status: 'GAP_IDENTIFIED', checks: [], coverage: { total: 0 }, futureField: [true, null] },
      { controlId: 'AST02', status: 'NOT_ASSESSED', checks: [{ checkId: '2.1', extra: 'kept' }] },
    ],
    evidence: [
      { id: 'b', kind: 'future.kind.b', facts: { n: 1e21, neg: -0, s: 'caf\u00e9 \ud83d\ude00', list: ['z', 'a'] } },
      { id: 'a', kind: 'future.kind.a', facts: {} },
    ],
    notImplementedControls: ['AST10', 'AST01'],
    unmappedEvidenceIds: [],
    package: { digest: 'd', fileCount: 1, manifestFiles: ['z.md', 'a.md'] },
    notes: ['b', 'a', 'b'],
  })
  const { registry } = fakeRegistry({ ok: true, assessment, normalized: { LEAK: 1 } })
  const r = await viaHandler({ profile: PROFILE, files: [FILE] }, registry)
  assert.equal(r.status, 200)
  assert.equal(JSON.stringify(r.body.assessment), JSON.stringify(assessment), 'byte-identical, including key and array order')
  assert.strictEqual(r.body.assessment, assessment, 'the very same object: not copied, wrapped or annotated')
  assert.deepEqual(sorted(r.body), ['assessment', 'attestation', 'profile', 'saved'])
})

test('TRANSPARENT (real scanner): the Worker returns exactly what the scanner returns', realOnly, async () => {
  await withApi(async () => {
    const files = [{ path: 'SKILL.md', content: '---\nname: x\ndescription: "x"\nrisk_tier: L0\npermissions:\n  shell: true\n---\n' }, { path: 'a.js', content: "fetch('https://api.example.test/x')\n" }]
    const body = parse(await read(await send({ profile: PROFILE, files })))
    const direct = await assessSkillPackageAst(files)
    assert.equal(JSON.stringify(body.assessment), JSON.stringify(direct.assessment))
  })
})

// ── 11. Nothing persisted, signed, or turned into a report ───────────────────────────────────

test('NO FIRESTORE PERSISTENCE, SIGNING OR REPORT (frozen): a profile request writes no report, no org/audit/webhook record, and signs nothing (D1 usage metering is separate — see section 13)', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const env = { ATTESTATION_SIGNING_PRIVATE_KEY_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)), ATTESTATION_ISSUER: 'agentverify-test', FIREBASE_CLIENT_EMAIL: 'w@t.iam.gserviceaccount.com' }
  await withApi(async log => {
    const r = await read(await send({ profile: PROFILE, files: [FILE] }, { env }))
    assert.equal(r.status, 200)
    // Firestore writes (reports, organizations, audit log, webhooks) go through fetch(); D1 usage metering
    // does not, so this log-based assertion is unaffected by, and does not observe, metering.
    assert.equal(log.filter(c => c.method !== 'GET').length, 0, 'no Firestore write of any kind')
    assert.equal(log.some(c => /cliReports|reports|organizations|webhooks|auditLog/i.test(c.href) && !/apiKeyIndex/.test(c.href)), false)
    assert.equal(log.every(c => c.href.includes('/documents/apiKeyIndex/')), true, 'the only outbound call is the key lookup')
    const body = parse(r)
    assert.equal(body.attestation, null)
    assert.equal(/signature|publicKey|attestationVersion/i.test(r.text), false)
    assert.equal('reportId' in body || 'reportUrl' in body, false)
  })
})

test('NO REPORT (source guard): profiles.ts cannot save, meter, audit, webhook, sign or hash a report', () => {
  const code = profilesSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.equal(/saveReport|recordMonthlyUsage|recordAuditEvent|enqueueWebhook|signAttestation|buildAttestationPayload|computeReportHash|createScanResult/.test(code), false)
})

// ── 12. Rate limiting ────────────────────────────────────────────────────────────────────────

test('RATE LIMIT: it exists, is per user, and returns the frozen 429 shape', async () => {
  await withApi(async () => {
    const key = freshKey()
    for (let i = 0; i < PROFILE_RATE_LIMIT.limit; i++) assert.equal((await read(await send({ profile: PROFILE, files: [FILE] }, { key }))).status, 200)
    const limited = await read(await send({ profile: PROFILE, files: [FILE] }, { key }))
    expectRow(limited, C.errors.rateLimited, 'rate limited')
    assert.equal((await read(await send({ profile: PROFILE, files: [FILE] }))).status, 200, 'another user is unaffected')
    assert.equal((await read(await send({ profile: 'nope', files: [FILE] }, { key }))).status, 400, 'validation still answers before the limiter is consulted')
  })
})

// ── 13. METERING (public release, RD-2 resolved — FROZEN): one profile assessment = one scan unit ───────
//
// A completed profile assessment consumes exactly one Agent Verify scan unit, through the SAME metering
// path (recordMonthlyUsage, the same usage_monthly ledger, the same `quota` object) an ordinary scan
// already uses — never a separate OWASP billing product or entitlement. Recorded once, the moment the
// assessment itself succeeds (worker.ts, right after handleProfileRequest returns 200), independent of
// whether `attest: true` was requested or what it then does. `d1Fake`'s `sql` array records one entry per
// `.prepare()` call regardless of whether `.run()`/`.first()` is awaited, so counting the INSERTs against
// usage_monthly in it is an exact count of how many times recordMonthlyUsage actually ran.
const usageInserts = spy => spy.sql.filter(q => /usage_monthly/i.test(q) && /insert/i.test(q))

test('METERING: a successful profile assessment (no attest) writes exactly one usage_monthly row', async () => {
  const spy = d1Fake({ scanCount: 0 })
  await withApi(async () => {
    const r = await read(await send({ profile: PROFILE, files: [FILE] }, { env: { BILLING_DB: spy.db } }))
    assert.equal(r.status, 200)
  })
  assert.equal(usageInserts(spy).length, 1)
})

test('METERING: attest:true costs the same one unit as an unsigned assessment — signing is never a second scan', async () => {
  const spy = d1Fake({ scanCount: 0 })
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const env = {
    BILLING_DB: spy.db,
    PROFILE_ATTESTATION_SIGNING_PRIVATE_KEY_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)),
    PROFILE_ATTESTATION_ISSUER: 'agentverify-contract-test',
    PROFILE_ATTESTATION_KEY_PURPOSE: 'agentverify-profile-v1',
  }
  await withApi(async () => {
    // Whatever attest:true's OWN outcome is here (200 with a real scanner and an admissible assessment, or
    // 422 inadmissible against the public-CI stub's placeholder assessment — see profileAttestationSigning
    // .test.mjs for that distinction in detail), the assessment itself reaches handleProfileRequest's 200
    // either way, so metering fires exactly once regardless of which branch this run takes.
    await send({ profile: PROFILE, files: [FILE], attest: true }, { env })
  })
  assert.equal(usageInserts(spy).length, 1, 'never a second usage row because attest:true was also requested')
})

test('METERING: a malformed request (400) never reaches a completed assessment and consumes nothing', async () => {
  const spy = d1Fake({ scanCount: 0 })
  await withApi(async () => {
    assert.equal((await read(await send({ profile: PROFILE }, { env: { BILLING_DB: spy.db } }))).status, 400) // missing files
  })
  assert.equal(usageInserts(spy).length, 0)
})

test('METERING: a size-limit rejection (413) consumes nothing', async () => {
  const spy = d1Fake({ scanCount: 0 })
  await withApi(async () => {
    const files = Array.from({ length: MAX_PROFILE_FILES + 1 }, (_, i) => ({ path: `f${i}`, content: '' }))
    assert.equal((await read(await send({ profile: PROFILE, files }, { env: { BILLING_DB: spy.db } }))).status, 413)
  })
  assert.equal(usageInserts(spy).length, 0)
})

test('METERING: an authentication failure (401) never touches metering at all', async () => {
  const spy = d1Fake({ scanCount: 0 })
  await withApi(async () => {
    const r = await read(await send({ profile: PROFILE, files: [FILE] }, { key: 'not-an-agentverify-key', env: { BILLING_DB: spy.db } }))
    assert.equal(r.status, 401)
  })
  assert.equal(spy.sql.length, 0, 'no D1 interaction of any kind before authentication succeeds')
})

test('METERING: a quota-exhausted request (429) is blocked before metering runs, identically to an ordinary scan', async () => {
  const over = d1Fake({ scanCount: 10 })
  await withApi(async () => {
    const key = freshKey()
    assert.equal((await read(await send({ profile: PROFILE, files: [FILE] }, { key, env: { BILLING_DB: over.db } }))).status, 429)
  })
  assert.equal(usageInserts(over).length, 0, 'the quota gate runs before the profile branch is even reached')
})

test('METERING (real scanner): a package the scanner rejects (422) consumes nothing', realOnly, async () => {
  const spy = d1Fake({ scanCount: 0 })
  await withApi(async () => {
    const r = await read(await send({ profile: PROFILE, files: [{ path: '../x.md', content: 'x' }] }, { env: { BILLING_DB: spy.db } }))
    assert.equal(r.status, 422)
  })
  assert.equal(usageInserts(spy).length, 0)
})

test('METERING (real scanner): attest:true failing closed with 503 (signing unavailable) after a valid assessment still leaves exactly one usage row -- never zero, never two', realOnly, async () => {
  const spy = d1Fake({ scanCount: 0 })
  await withApi(async () => {
    // No PROFILE_ATTESTATION_* configured at all: a real, admissible assessment is produced, then signing
    // itself is unavailable.
    const r = await read(await send({ profile: PROFILE, files: [FILE], attest: true }, { env: { BILLING_DB: spy.db } }))
    assert.equal(r.status, 503, JSON.stringify(parse(r)))
  })
  assert.equal(usageInserts(spy).length, 1, 'the assessment that WAS produced is still exactly one billable unit, even though it could not be signed')
})

test('METERING (real scanner): an internal signer defect (500) after a valid assessment still leaves exactly one usage row', realOnly, async () => {
  const spy = d1Fake({ scanCount: 0 })
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const env = {
    BILLING_DB: spy.db,
    PROFILE_ATTESTATION_SIGNING_PRIVATE_KEY_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)),
    PROFILE_ATTESTATION_ISSUER: 'agentverify-contract-test',
    PROFILE_ATTESTATION_KEY_PURPOSE: 'agentverify-profile-v1',
  }
  const originalVerify = crypto.subtle.verify.bind(crypto.subtle)
  crypto.subtle.verify = async () => false // forces signProfileAttestation's own self-check to fail -> category 'internal'
  try {
    await withApi(async () => {
      const r = await read(await send({ profile: PROFILE, files: [FILE], attest: true }, { env }))
      assert.equal(r.status, 500, JSON.stringify(parse(r)))
    })
  } finally {
    crypto.subtle.verify = originalVerify
  }
  assert.equal(usageInserts(spy).length, 1, 'a defect in signing does not erase or double the charge for the assessment that already completed')
})
