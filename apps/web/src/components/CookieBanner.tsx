'use client'

import { useEffect, useState } from 'react'
import { Button } from './ui/Button'
import { initAnalytics } from '@/lib/analytics'

export function CookieBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const consent = window.localStorage.getItem('av_cookie_consent')
    setVisible(!consent)
    if (consent === 'accepted') initAnalytics()
  }, [])

  if (!visible) return null

  const choose = (value: 'accepted' | 'declined') => {
    window.localStorage.setItem('av_cookie_consent', value)
    if (value === 'accepted') initAnalytics()
    setVisible(false)
  }

  return (
    <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="fixed bottom-4 left-4 right-4 z-[70] mx-auto max-w-lg rounded-xl p-4 shadow-2xl shadow-black/20 backdrop-blur">
      <div className="flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between">
        <p style={{ color: 'var(--text-secondary)' }} className="text-sm">We use analytics cookies to understand usage. No data is sold.</p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => choose('declined')}>Decline</Button>
          <Button variant="primary" size="sm" onClick={() => choose('accepted')}>Accept</Button>
        </div>
      </div>
    </div>
  )
}
