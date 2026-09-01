/**
 * Pure helpers backing firebase.ts's build-safety guard — deliberately split into their own file
 * with NO Firebase SDK import, so they're unit-testable without pulling in the real SDK (which
 * would defeat the point: the whole issue is avoiding SDK initialization when config is absent).
 * See firebase.ts for how these are used and why.
 */

export interface MinimalFirebaseConfig {
  apiKey?: string
}

/**
 * True when there's real (or emulator-dummy) config to initialize the Firebase SDK against.
 * A presence check, not a validity check — Firebase's own servers are the only real authority on
 * whether a key actually works; this only distinguishes "nothing was configured" (safe to skip
 * SDK initialization) from "something was configured, let the SDK validate it" (behavior
 * unchanged from before this guard existed).
 */
export function computeHasFirebaseConfig(config: MinimalFirebaseConfig, useEmulator: boolean): boolean {
  return useEmulator || (typeof config.apiKey === 'string' && config.apiKey.length > 0)
}

/**
 * Returns a stand-in object for a Firebase App/Auth/Firestore instance that throws a clear,
 * specific error the moment any property on it is actually accessed — used in place of a real
 * SDK instance when no config was present at build time. Constructing or merely holding a
 * reference to this never throws (so importing firebase.ts, or passing this around unused, is
 * always safe); only a genuine attempt to use it — e.g. Firebase's own functions reading a
 * property off it internally — does. This is NOT a way to make missing config not matter: a real
 * deployment that's missing its config will still fail loudly the first time anything tries to
 * sign in, read a report, etc. It only prevents that failure from happening at build/prerender
 * time, before a single page (most of which need no auth at all) can even render.
 */
export function createUnconfiguredFirebaseProxy<T extends object>(serviceName: string): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      if (typeof prop === 'symbol') return undefined
      throw new Error(
        `Firebase ${serviceName} was used ("${String(prop)}"), but no NEXT_PUBLIC_FIREBASE_* ` +
        `configuration was present when this build was produced. A real deployment must set ` +
        `those environment variables before ${serviceName} can be used — see README.md.`
      )
    },
  })
}
