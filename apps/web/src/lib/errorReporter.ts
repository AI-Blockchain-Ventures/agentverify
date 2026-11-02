import { getApiBaseUrl } from '@/lib/billing'

/**
 * Sends website crashes to the API (POST /v1/errors), which groups them and emails the admin the first
 * time each one happens. Only the error text, stack and page path are sent — never the query string,
 * page content or anything typed. Off on localhost so local testing never reports to production.
 */
const MAX_PER_PAGE_LOAD = 5
const seen = new Set<string>()

function enabled(): boolean {
  if (typeof window === 'undefined') return false
  return !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)
}

export function reportClientError(error: unknown, where?: string): void {
  if (!enabled() || seen.size >= MAX_PER_PAGE_LOAD) return
  const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error')
  const message = `${where ? `[${where}] ` : ''}${err.message || err.name || 'Unknown error'}`.slice(0, 500)
  if (seen.has(message)) return
  seen.add(message)
  try {
    void fetch(`${getApiBaseUrl()}/v1/errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, stack: (err.stack ?? '').slice(0, 4000), path: window.location.pathname }),
      keepalive: true,
    }).catch(() => { /* never let reporting cause another error */ })
  } catch { /* ignore */ }
}

/** Catches errors nothing else handled (uncaught exceptions and rejected promises). Returns a cleanup. */
export function installErrorReporter(): () => void {
  if (!enabled()) return () => {}
  const onError = (e: ErrorEvent) => reportClientError(e.error ?? e.message)
  const onRejection = (e: PromiseRejectionEvent) => reportClientError(e.reason, 'unhandled promise')
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
