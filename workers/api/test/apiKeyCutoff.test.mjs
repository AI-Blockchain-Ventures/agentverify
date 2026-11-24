// API keys made before API_KEYS_ISSUED_AFTER are refused, with a clear reason (2026-11-24 key retirement).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import worker from '../dist/worker.mjs'
import { isRetiredKeyCreatedAt, RETIRED_API_KEY_MESSAGE } from '../dist/authz.mjs'

const CUTOFF = '2026-11-24T18:17:00Z'

function makeDb() {
  const db = new DatabaseSync(':memory:')
  for (const f of ['billing.sql', 'team.sql', 'guard.sql', 'github.sql']) db.exec(readFileSync(new URL(`../schema/${f}`, import.meta.url), 'utf8'))
  return {
    raw: db,
    prepare(q) {
      const stmt = db.prepare(q)
      let vals = []
      const api = {
        bind(...v) { vals = v.map(x => (x === undefined ? null : typeof x === 'boolean' ? Number(x) : x)); return api },
        async first() { return stmt.get(...vals) ?? null },
        async run() { const r = stmt.run(...vals); return { success: true, meta: { changes: Number(r.changes) } } },
        async all() { return { results: stmt.all(...vals) } },
      }
      return api
    },
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out },
  }
}
const env = (extra = {}) => ({ BILLING_ENABLED: 'true', FIREBASE_PROJECT_ID: 'agentverify-test', FIREBASE_API_KEY: 'fb-test', BILLING_DB: makeDb(), API_KEYS_ISSUED_AFTER: CUTOFF, ...extra })

// Each key name maps to the apiKeyIndex fields the fake Firestore returns for it.
const KEYS = {
  av_old_key_made_before_the_fix_000: { uid: { stringValue: 'dev' }, createdAt: { stringValue: '2026-11-20T10:00:00.000Z' } },
  av_new_key_made_after_the_fix_0000: { uid: { stringValue: 'dev' }, createdAt: { stringValue: '2026-11-24T19:00:00.000Z' } },
  av_key_with_no_creation_time_00000: { uid: { stringValue: 'dev' } },
  av_old_key_that_was_revoked_000000: { uid: { stringValue: 'dev' }, createdAt: { stringValue: '2026-11-20T10:00:00.000Z' }, disabled: { booleanValue: true } },
}

async function withFakeFirestore(fn) {
  const original = globalThis.fetch
  globalThis.fetch = async url => {
    const href = String(url)
    const m = href.match(/\/documents\/apiKeyIndex\/([^?]+)/)
    if (m) {
      const fields = KEYS[decodeURIComponent(m[1])]
      return fields ? new Response(JSON.stringify({ fields }), { status: 200 }) : new Response('{}', { status: 404 })
    }
    return new Response('{}', { status: 404 })
  }
  try { return await fn() } finally { globalThis.fetch = original }
}
const call = (e, key, method = 'GET', path = '/v1/guard/policy', body) =>
  worker.fetch(new Request(`https://api.test${path}`, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), e)

test('isRetiredKeyCreatedAt: before the cutoff, missing or unreadable dates are retired; after is fine; no cutoff retires nothing', () => {
  assert.equal(isRetiredKeyCreatedAt('2026-11-20T10:00:00Z', CUTOFF), true)
  assert.equal(isRetiredKeyCreatedAt('2026-11-24T18:16:59Z', CUTOFF), true)
  assert.equal(isRetiredKeyCreatedAt('2026-11-24T18:17:00Z', CUTOFF), false)
  assert.equal(isRetiredKeyCreatedAt('2026-11-25T00:00:00Z', CUTOFF), false)
  assert.equal(isRetiredKeyCreatedAt(undefined, CUTOFF), true)
  assert.equal(isRetiredKeyCreatedAt('not a date', CUTOFF), true)
  assert.equal(isRetiredKeyCreatedAt('2026-11-20T10:00:00Z', undefined), false)
  assert.equal(isRetiredKeyCreatedAt('2026-11-20T10:00:00Z', 'garbage'), false, 'a broken setting must not lock everyone out')
})

test('an old key is refused with a clear "retired" reason that says what to do', async () => {
  await withFakeFirestore(async () => {
    const res = await call(env(), 'av_old_key_made_before_the_fix_000')
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.code, 'api_key_retired')
    assert.equal(body.error, RETIRED_API_KEY_MESSAGE)
    assert.match(body.error, /dashboard/)
  })
})

test('a key with no creation time counts as old', async () => {
  await withFakeFirestore(async () => {
    const res = await call(env(), 'av_key_with_no_creation_time_00000')
    assert.equal(res.status, 401)
    assert.equal((await res.json()).code, 'api_key_retired')
  })
})

test('a new key made after the fix works', async () => {
  await withFakeFirestore(async () => {
    const res = await call(env(), 'av_new_key_made_after_the_fix_0000')
    assert.equal(res.status, 200)
  })
})

test('the old key is refused on every guard route the CLI uses (events, approvals, policy)', async () => {
  await withFakeFirestore(async () => {
    const e = env()
    const old = 'av_old_key_made_before_the_fix_000'
    for (const [method, path, body] of [
      ['GET', '/v1/guard/policy'],
      ['POST', '/v1/guard/events', { events: [] }],
      ['POST', '/v1/guard/approvals', { agent: 'a', tool: 't', preview: 'p', reason: 'r', rule: 'x' }],
    ]) {
      const res = await call(e, old, method, path, body)
      assert.equal(res.status, 401, `${method} ${path}`)
      assert.equal((await res.json()).code, 'api_key_retired', `${method} ${path}`)
    }
  })
})

test('a revoked key gets the normal refusal, not the "retired" one', async () => {
  await withFakeFirestore(async () => {
    const res = await call(env(), 'av_old_key_that_was_revoked_000000')
    assert.equal(res.status, 401)
    assert.notEqual((await res.json()).code, 'api_key_retired')
  })
})

test('an unknown key gets the normal refusal', async () => {
  await withFakeFirestore(async () => {
    const res = await call(env(), 'av_this_key_does_not_exist_at_all_0')
    assert.equal(res.status, 401)
    assert.notEqual((await res.json()).code, 'api_key_retired')
  })
})

test('with no cutoff set, old keys keep working (the setting is what turns retirement on)', async () => {
  await withFakeFirestore(async () => {
    const res = await call(env({ API_KEYS_ISSUED_AFTER: undefined }), 'av_old_key_made_before_the_fix_000')
    assert.equal(res.status, 200)
  })
})

test('the production setting in wrangler.toml is the agreed cutoff', () => {
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')
  assert.match(toml, /API_KEYS_ISSUED_AFTER = "2026-11-24T18:17:00Z"/)
})
