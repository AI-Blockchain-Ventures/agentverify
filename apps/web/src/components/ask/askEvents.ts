/** Opens the "Ask" box from anywhere (header button, dashboard search bar, homepage). */
export const ASK_EVENT = 'av:open-ask'

export function openAsk(question?: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: question ?? '' }))
}
