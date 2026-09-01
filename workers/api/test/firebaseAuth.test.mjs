// Unit tests for the emulator-aware Firebase access layer — the foundation the local review
// harness AND the browser Firebase-token auth bridge both depend on. Run with node:test directly
// (see package.json test script) rather than the big source.test.mjs script.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { firestoreBaseUrl, firestoreAdminAuthHeader, identityToolkitBaseUrl, apiKeyQueryParam, verifyFirebaseIdToken } from '../dist/firebaseAuth.mjs'

const b64url = (value) => Buffer.from(value).toString('base64url')

async function createSignedToken(overrides = {}) {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  publicJwk.kid = 'test-kid'
  const now = Math.floor(Date.now() / 1000)
  const claims = {
    aud: 'agentverify-firebaseauth-test',
    iss: 'https://securetoken.google.com/agentverify-firebaseauth-test',
    sub: 'alice_uid',
    email: 'alice@example.test',
    iat: now,
    exp: now + 3600,
    ...overrides.claims,
  }
  const header = { alg: 'RS256', typ: 'JWT', kid: 'test-kid', ...overrides.header }
  const headerB64 = b64url(JSON.stringify(header))
  const payloadB64 = b64url(JSON.stringify(claims))
  const signed = `${headerB64}.${payloadB64}`
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(signed))
  const token = `${signed}.${Buffer.from(signature).toString('base64url')}`
  return { token, jwk: publicJwk }
}

function createUnsignedEmulatorToken(claims = {}) {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'none', typ: 'JWT' }
  const payload = {
    aud: 'agentverify-firebaseauth-test',
    iss: 'https://securetoken.google.com/agentverify-firebaseauth-test',
    sub: 'alice_uid',
    email: 'alice@example.test',
    iat: now,
    exp: now + 3600,
    ...claims,
  }
  return `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}.`
}

// --- URL/credential helpers switch cleanly between production and emulator mode ---

test('firestoreBaseUrl targets the real Google API when no emulator env is set', () => {
  const url = firestoreBaseUrl({ FIREBASE_PROJECT_ID: 'agentverify-26e26' })
  assert.equal(url, 'https://firestore.googleapis.com/v1/projects/agentverify-26e26/databases/(default)/documents')
})

test('firestoreBaseUrl targets the local emulator when FIRESTORE_EMULATOR_HOST is set', () => {
  const url = firestoreBaseUrl({ FIREBASE_PROJECT_ID: 'agentverify-review', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180' })
  assert.equal(url, 'http://127.0.0.1:8180/v1/projects/agentverify-review/databases/(default)/documents')
})

test('firestoreAdminAuthHeader uses the emulator magic "owner" token in emulator mode (no real credentials needed)', async () => {
  const headers = await firestoreAdminAuthHeader({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180' })
  assert.deepEqual(headers, { Authorization: 'Bearer owner' })
})

test('firestoreAdminAuthHeader returns null in production mode without real service-account credentials configured', async () => {
  const headers = await firestoreAdminAuthHeader({ FIREBASE_PROJECT_ID: 'agentverify-26e26' })
  assert.equal(headers, null)
})

test('identityToolkitBaseUrl targets the local Auth emulator when FIREBASE_AUTH_EMULATOR_HOST is set', () => {
  assert.equal(identityToolkitBaseUrl({ FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }), 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1')
  assert.equal(identityToolkitBaseUrl({}), 'https://identitytoolkit.googleapis.com/v1')
})

test('apiKeyQueryParam never returns an empty string in emulator mode even with no real key configured', () => {
  assert.equal(apiKeyQueryParam({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180' }).length > 0, true)
  assert.equal(apiKeyQueryParam({}), '')
})

// --- Firebase ID token verification: production (real RS256+JWKS) path ---

test('verifyFirebaseIdToken (production mode): a validly signed token verifies and resolves the real uid', async (t) => {
  const { token, jwk } = await createSignedToken()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).includes('securetoken@system.gserviceaccount.com')) {
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('{}', { status: 404 })
  }
  t.after(() => { globalThis.fetch = originalFetch })

  const user = await verifyFirebaseIdToken(token, { FIREBASE_PROJECT_ID: 'agentverify-firebaseauth-test' })
  assert.deepEqual(user, { uid: 'alice_uid', email: 'alice@example.test' })
})

test('verifyFirebaseIdToken (production mode): SECURITY — wrong audience is rejected', async (t) => {
  const { token, jwk } = await createSignedToken({ claims: { aud: 'some-other-project' } })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } })
  t.after(() => { globalThis.fetch = originalFetch })
  const user = await verifyFirebaseIdToken(token, { FIREBASE_PROJECT_ID: 'agentverify-firebaseauth-test' })
  assert.equal(user, null)
})

test('verifyFirebaseIdToken (production mode): SECURITY — wrong issuer is rejected', async (t) => {
  const { token, jwk } = await createSignedToken({ claims: { iss: 'https://securetoken.google.com/attacker-project' } })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } })
  t.after(() => { globalThis.fetch = originalFetch })
  const user = await verifyFirebaseIdToken(token, { FIREBASE_PROJECT_ID: 'agentverify-firebaseauth-test' })
  assert.equal(user, null)
})

test('verifyFirebaseIdToken (production mode): SECURITY — expired token is rejected', async (t) => {
  const now = Math.floor(Date.now() / 1000)
  const { token, jwk } = await createSignedToken({ claims: { iat: now - 7200, exp: now - 3600 } })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } })
  t.after(() => { globalThis.fetch = originalFetch })
  const user = await verifyFirebaseIdToken(token, { FIREBASE_PROJECT_ID: 'agentverify-firebaseauth-test' })
  assert.equal(user, null)
})

test('verifyFirebaseIdToken (production mode): SECURITY — tampered payload (claimed uid changed after signing) is rejected', async (t) => {
  const { token, jwk } = await createSignedToken()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } })
  t.after(() => { globalThis.fetch = originalFetch })

  const [headerB64, payloadB64, sigB64] = token.split('.')
  const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
  const forgedPayload = b64url(JSON.stringify({ ...claims, sub: 'attacker_uid' }))
  const forgedToken = `${headerB64}.${forgedPayload}.${sigB64}`

  const user = await verifyFirebaseIdToken(forgedToken, { FIREBASE_PROJECT_ID: 'agentverify-firebaseauth-test' })
  assert.equal(user, null, 'a forged uid claim must invalidate the signature check — the attacker must never be resolved as attacker_uid')
})

test('verifyFirebaseIdToken (production mode): SECURITY — malformed token (garbage string) fails safely, no throw', async () => {
  const user = await verifyFirebaseIdToken('not-a-real-token', { FIREBASE_PROJECT_ID: 'agentverify-firebaseauth-test' })
  assert.equal(user, null)
})

test('verifyFirebaseIdToken (production mode): SECURITY — missing/null token fails safely', async () => {
  assert.equal(await verifyFirebaseIdToken(null, { FIREBASE_PROJECT_ID: 'x' }), null)
  assert.equal(await verifyFirebaseIdToken(undefined, { FIREBASE_PROJECT_ID: 'x' }), null)
  assert.equal(await verifyFirebaseIdToken('', { FIREBASE_PROJECT_ID: 'x' }), null)
})

test('verifyFirebaseIdToken (production mode): SECURITY — an unsigned (alg:none) emulator-style token is REJECTED when FIREBASE_AUTH_EMULATOR_HOST is not set', async () => {
  const unsigned = createUnsignedEmulatorToken()
  const user = await verifyFirebaseIdToken(unsigned, { FIREBASE_PROJECT_ID: 'agentverify-firebaseauth-test' })
  assert.equal(user, null, 'production mode must never accept an unsigned token, even one with otherwise-correct claims')
})

// --- Firebase ID token verification: emulator (unsigned) path — gated behind the standard env var ---

test('verifyFirebaseIdToken (emulator mode): an unsigned emulator token is accepted when FIREBASE_AUTH_EMULATOR_HOST is set', async () => {
  const unsigned = createUnsignedEmulatorToken()
  const user = await verifyFirebaseIdToken(unsigned, { FIREBASE_PROJECT_ID: 'agentverify-firebaseauth-test', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' })
  assert.deepEqual(user, { uid: 'alice_uid', email: 'alice@example.test' })
})

test('verifyFirebaseIdToken (emulator mode): SECURITY — a token claiming a real algorithm but with a fake/empty signature is still rejected even in emulator mode', async () => {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'fake' }))
  const payload = b64url(JSON.stringify({ aud: 'agentverify-firebaseauth-test', iss: 'https://securetoken.google.com/agentverify-firebaseauth-test', sub: 'attacker_uid', iat: now, exp: now + 3600 }))
  const fakeToken = `${header}.${payload}.not-a-real-signature`
  const user = await verifyFirebaseIdToken(fakeToken, { FIREBASE_PROJECT_ID: 'agentverify-firebaseauth-test', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' })
  assert.equal(user, null, 'emulator mode only trusts alg:none tokens — a token claiming RS256 must still go through real verification, which this fake signature fails')
})

test('verifyFirebaseIdToken (emulator mode): SECURITY — expired claims are still rejected even with the emulator bypass active', async () => {
  const now = Math.floor(Date.now() / 1000)
  const unsigned = createUnsignedEmulatorToken({ iat: now - 7200, exp: now - 3600 })
  const user = await verifyFirebaseIdToken(unsigned, { FIREBASE_PROJECT_ID: 'agentverify-firebaseauth-test', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' })
  assert.equal(user, null, 'the emulator bypass skips signature verification only — claim validation (expiry, issuer, audience) always still runs')
})

test('verifyFirebaseIdToken (emulator mode): SECURITY — wrong audience is still rejected even with the emulator bypass active', async () => {
  const unsigned = createUnsignedEmulatorToken({ aud: 'some-other-project' })
  const user = await verifyFirebaseIdToken(unsigned, { FIREBASE_PROJECT_ID: 'agentverify-firebaseauth-test', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' })
  assert.equal(user, null)
})
