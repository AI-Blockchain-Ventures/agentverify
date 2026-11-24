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

const STALE_RELOAD_KEY = 'av-stale-build-reload'

/** True for the errors a browser hits when it still runs an older copy of the site after an update. */
export function isStaleBuildError(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null
  const text = `${e?.name ?? ''} ${e?.message ?? (typeof error === 'string' ? error : '')}`
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|Unexpected token '<'/i.test(text)
}

/**
 * After a site update, a page that was already open can ask for code files the update replaced. Reloading
 * picks up the new version. Reloads at most once a minute per tab, so a real problem can't loop.
 * Returns true when a reload was started (the error is then not worth reporting).
 */
export function recoverFromStaleBuild(error: unknown): boolean {
  if (typeof window === 'undefined' || !isStaleBuildError(error)) return false
  try {
    const last = Number(window.sessionStorage.getItem(STALE_RELOAD_KEY) ?? 0)
    if (Date.now() - last < 60_000) return false
    window.sessionStorage.setItem(STALE_RELOAD_KEY, String(Date.now()))
  } catch { return false }
  window.location.reload()
  return true
}

export function reportClientError(error: unknown, where?: string): void {
  if (recoverFromStaleBuild(error)) return
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
  const onError = (e: ErrorEvent) => reportClientError(e.error ?? e.message)
  const onRejection = (e: PromiseRejectionEvent) => reportClientError(e.reason, 'unhandled promise')
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
