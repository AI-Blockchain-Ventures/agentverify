import type { ScanResult } from '@/types'
import { getAnalytics, isSupported, logEvent } from 'firebase/analytics'
import { app } from './firebase'

let analyticsPromise: ReturnType<typeof getAnalyticsIfAllowed> | null = null

async function getAnalyticsIfAllowed() {
  if (typeof window === 'undefined') return null
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
