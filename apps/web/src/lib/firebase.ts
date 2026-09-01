import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'

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

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)

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
