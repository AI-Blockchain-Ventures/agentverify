/**
 * Shared clipboard helper. `navigator.clipboard.writeText()` can reject — insecure context,
 * permissions-policy restriction, an embedded browser, a user/browser denying clipboard access —
 * so callers get a real boolean and decide what to show, instead of assuming success.
 *
 * When the modern API is refused, it falls back to the older select-and-copy method, which still
 * works in many embedded and older browsers. Call it from a click (browsers require a user gesture).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  let ok: boolean
  try {
    await navigator.clipboard.writeText(text)
    ok = true
  } catch {
    ok = legacyCopy(text)
  }
  // Every Copy button on the site goes through here, so a refusal is always explained, never silent.
  if (!ok) showCopyRefusedNotice()
  return ok
}

let noticeTimer: ReturnType<typeof setTimeout> | null = null

/** A small message at the bottom of the screen when the browser blocks copying. */
function showCopyRefusedNotice(): void {
  if (typeof document === 'undefined') return
  let note = document.getElementById('av-copy-refused')
  if (!note) {
    note = document.createElement('div')
    note.id = 'av-copy-refused'
    note.setAttribute('role', 'status')
    note.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;max-width:90vw;padding:10px 16px;border-radius:12px;font-size:13px;font-family:inherit;background:#1F2937;color:#F9FAFB;border:1px solid #F59E0B;box-shadow:0 10px 30px rgba(0,0,0,.35)'
    document.body.appendChild(note)
  }
  note.textContent = 'This browser blocked copying. Select the text and press Ctrl+C (Cmd+C on Mac).'
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => document.getElementById('av-copy-refused')?.remove(), 5000)
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '-1000px'
  area.style.opacity = '0'
  const previous = document.activeElement as HTMLElement | null
  document.body.appendChild(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  previous?.focus?.()
  return ok
}

/** Selects the text inside an element (or a text field) so the person can press Ctrl+C when copying was refused. */
export function selectTextIn(element: HTMLElement | null): void {
  if (!element || typeof window === 'undefined') return
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.focus()
    element.select()
    return
  }
  const range = document.createRange()
  range.selectNodeContents(element)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}
