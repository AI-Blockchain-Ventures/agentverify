'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from './ui/Button'
import { initAnalytics } from '@/lib/analytics'

const KEY = 'av_cookie_consent'

function readConsent(): string | null {
  try { return window.localStorage.getItem(KEY) } catch { return null }
}

/**
 * Analytics consent. A slim bar on phones, a small card on larger screens. While it is showing,
 * the page gets matching bottom padding, so the bar never sits on top of buttons (on phones it
 * used to cover the Live Demo's "Run live scan" button, which made taps look like they did nothing).
 */
export function CookieBanner() {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const consent = readConsent()
    setVisible(!consent)
    if (consent === 'accepted') initAnalytics()
  }, [])

  useEffect(() => {
    if (!visible || !ref.current) return
    const el = ref.current
    const apply = () => { document.body.style.paddingBottom = `${Math.ceil(el.getBoundingClientRect().height) + 16}px` }
    apply()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null
    ro?.observe(el)
    return () => { ro?.disconnect(); document.body.style.paddingBottom = '' }
  }, [visible])

  if (!visible) return null

  const choose = (value: 'accepted' | 'declined') => {
    try { window.localStorage.setItem(KEY, value) } catch { /* private mode: ask again next visit */ }
    if (value === 'accepted') initAnalytics()
    setVisible(false)
  }

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Cookie choice"
      style={{ backgroundColor: 'var(--card)', borderTop: '1px solid var(--border)' }}
      className="fixed inset-x-0 bottom-0 z-[70] px-4 py-2.5 shadow-2xl shadow-black/20 md:inset-x-4 md:bottom-4 md:mx-auto md:max-w-lg md:rounded-xl md:border md:p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <p style={{ color: 'var(--text-secondary)' }} className="text-xs leading-5 md:text-sm">Analytics cookies help us improve. No data is sold.</p>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="sm" onClick={() => choose('declined')}>Decline</Button>
          <Button variant="primary" size="sm" onClick={() => choose('accepted')}>Accept</Button>
        </div>
      </div>
    </div>
  )
}
