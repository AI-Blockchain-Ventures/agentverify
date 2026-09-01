import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore'
import { computeHasFirebaseConfig, createUnconfiguredFirebaseProxy } from './firebaseConfigGuard'

// Local review mode (npm run review): NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true points this app at
// local Firebase emulators instead of production, so review data never touches a real project.
// This flag does nothing unless explicitly set — production behavior is completely unchanged.
export const useEmulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true'

const firebaseConfig = useEmulator
  ? {
      // Emulators accept any well-formed values — never real credentials, and never reachable
      // from a real Firebase project even if these leaked, since the SDK is pointed at
      // 127.0.0.1 below, not Google's servers.
      apiKey: 'demo-review-key',
      authDomain: 'localhost',
      projectId: 'agentverify-review',
      storageBucket: 'agentverify-review.appspot.com',
      messagingSenderId: '000000000000',
      appId: '1:000000000000:web:0000000000000000000000',
    }
  : {
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    }

// Next.js inlines NEXT_PUBLIC_* values at BUILD time (not read at request time), and evaluates
// this module during static prerendering for every page — including 'use client' components,
// which still render once server-side to produce their initial HTML. initializeApp()/getAuth()
// throw synchronously on a missing/invalid config, so without this guard, a build with no
// NEXT_PUBLIC_FIREBASE_* configured (public CI, the private-boundary check's isolated build —
// neither ever needs real Firebase) fails on EVERY page, not just Firebase-dependent ones. See
// firebaseConfigGuard.ts (and its test) for the guard logic itself.
const hasFirebaseConfig = computeHasFirebaseConfig(firebaseConfig, useEmulator)

export const app: FirebaseApp = hasFirebaseConfig
  ? (getApps().length ? getApp() : initializeApp(firebaseConfig))
  : createUnconfiguredFirebaseProxy<FirebaseApp>('App')
export const auth: Auth = hasFirebaseConfig ? getAuth(app) : createUnconfiguredFirebaseProxy<Auth>('Auth')
export const db: Firestore = hasFirebaseConfig ? getFirestore(app) : createUnconfiguredFirebaseProxy<Firestore>('Firestore')

if (useEmulator) {
  // Guard against Fast Refresh (browser) or a re-import (Node seed script) re-running this
  // module and trying to connect twice, which throws. Works in both contexts: the browser via
  // `window`, and plain Node (the review-data seed script) via a global on `globalThis`.
  const store = (typeof window !== 'undefined' ? window : globalThis) as unknown as { __avEmulatorsConnected?: boolean }
  if (!store.__avEmulatorsConnected) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
    connectFirestoreEmulator(db, '127.0.0.1', 8180)
    store.__avEmulatorsConnected = true
  }
}
