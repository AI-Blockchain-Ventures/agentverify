/**
 * Shared clipboard helper. `navigator.clipboard.writeText()` can reject — insecure context,
 * permissions-policy restriction, a user/browser denying clipboard access — and every call site
 * in this app previously fired it unguarded, so a denied write surfaced as an unhandled runtime
 * error while the UI still optimistically showed "Copied ✓" regardless. This makes success
 * explicit: callers get a real boolean and can decide what to show, instead of assuming success.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
