// Unit tests for the pure build-safety guard in src/lib/firebaseConfigGuard.ts. This module has
// no dependency on the Firebase SDK (deliberately — see its own comment), so it's transpiled with
// esbuild and imported directly, the same way apps/web/test/comparisonAndGrouping.test.mjs
// exercises other pure src/lib modules — no real Firebase project needed, and none of these
// assertions touch firebase.ts itself (which DOES import the real SDK and would need one).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.join(__dirname, '..', 'src', 'lib')

async function loadTsModule(relPath) {
  const filePath = path.join(srcDir, relPath)
  const source = readFileSync(filePath, 'utf8')
  const { code } = transformSync(source, { loader: 'ts', format: 'esm', target: 'node20' })
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64')
  return import(dataUrl)
}

const { computeHasFirebaseConfig, createUnconfiguredFirebaseProxy } = await loadTsModule('firebaseConfigGuard.ts')

// --- computeHasFirebaseConfig ---

// Missing config during a static build (public CI, the private-boundary check's isolated build)
// must be recognized as "no config" so firebase.ts skips real SDK initialization — this is the
// exact condition that previously made every page's prerender throw auth/invalid-api-key.
assert.equal(computeHasFirebaseConfig({}, false), false, 'no apiKey at all, not emulator mode')
assert.equal(computeHasFirebaseConfig({ apiKey: undefined }, false), false, 'explicitly undefined apiKey')
assert.equal(computeHasFirebaseConfig({ apiKey: '' }, false), false, 'empty-string apiKey must count as absent, not present')

// Valid config — real production/dev values — must initialize normally, exactly as before this
// guard existed.
assert.equal(computeHasFirebaseConfig({ apiKey: 'a-real-looking-key' }, false), true)

// Emulator mode (npm run review) must always be treated as configured, regardless of apiKey
// shape — this must not regress local review behavior.
assert.equal(computeHasFirebaseConfig({ apiKey: 'demo-review-key' }, true), true)
assert.equal(computeHasFirebaseConfig({}, true), true, 'emulator mode is authoritative even if apiKey were somehow missing')

// --- createUnconfiguredFirebaseProxy ---

// Constructing the proxy, or merely holding a reference to it (as firebase.ts's exported
// app/auth/db do when config is absent), must never throw — this is what lets a build complete.
let proxy
assert.doesNotThrow(() => { proxy = createUnconfiguredFirebaseProxy('Auth') }, 'constructing the proxy must never throw')

// A genuine attempt to use it — the Firebase SDK internally reading a property off the instance
// it was given — must fail clearly and specifically, not silently no-op and not surface a cryptic
// native SDK error. This is the "Firebase-dependent runtime call with missing config" case.
assert.throws(
  () => proxy.currentUser,
  (err) => err instanceof Error && err.message.includes('Firebase Auth') && err.message.includes('currentUser') && err.message.includes('NEXT_PUBLIC_FIREBASE_'),
  'accessing any property must throw a clear, specific configuration error'
)

// Symbol-keyed property access (e.g. tooling probing Symbol.toStringTag, or a thenable check)
// must not throw — only real string-keyed usage should.
assert.doesNotThrow(() => proxy[Symbol.toStringTag], 'symbol property access must not throw')
assert.equal(proxy[Symbol.toStringTag], undefined)

// Different service names produce distinctly-labeled errors, so a real failure is traceable to
// which Firebase service was actually touched.
const dbProxy = createUnconfiguredFirebaseProxy('Firestore')
assert.throws(() => dbProxy.collection, (err) => err.message.includes('Firebase Firestore'))

console.log('firebaseConfigGuard.test.mjs: all assertions passed')
