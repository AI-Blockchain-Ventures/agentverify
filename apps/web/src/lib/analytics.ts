import type { ScanResult } from '@/types'
import { getAnalytics, isSupported, logEvent } from 'firebase/analytics'
import { app, useEmulator } from './firebase'

let analyticsPromise: ReturnType<typeof getAnalyticsIfAllowed> | null = null

async function getAnalyticsIfAllowed() {
  if (typeof window === 'undefined') return null
  // Local review mode (npm run review) has no real Analytics config — attempting it only
  // produces a guaranteed-to-fail config-fetch request against Google's servers (visible as a
  // dev-mode "Unhandled Runtime Error" overlay) with zero purpose, since review sessions are
  // synthetic and local-only. Analytics is meaningless there, so skip it outright.
  if (useEmulator) return null
  if (window.localStorage.getItem('av_cookie_consent') !== 'accepted') return null
  if (!(await isSupported())) return null
  return getAnalytics(app)
}

export function initAnalytics(): void {
  analyticsPromise = getAnalyticsIfAllowed()
}

async function track(event: string, params?: Record<string, string | number | boolean>) {
  const analytics = await (analyticsPromise ?? getAnalyticsIfAllowed())
  if (analytics) logEvent(analytics, event, params)
}

export const trackScan = (result: ScanResult) =>
  track('scan_completed', { verdict: result.verdict, riskScore: result.riskScore, findings: result.findings.length })

export const trackSignUp = () => track('sign_up')
export const trackSignIn = () => track('login')
export const trackAPIPage = () => track('api_page_view')
