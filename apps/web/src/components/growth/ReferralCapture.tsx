'use client'

import { useEffect } from 'react'
import { useAuth } from '@/components/auth/AuthProvider'
import { apiCall } from '@/lib/v2Api'

const KEY = 'av-ref'

/**
 * Remembers an invite code from ?ref=… and claims it once the visitor is signed in. Invisible.
 * Mounted once for the whole site, including the dashboard.
 */
export function ReferralCapture() {
  const { user } = useAuth()

  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get('ref')
      if (ref && /^[a-z0-9]{6,12}$/.test(ref)) localStorage.setItem(KEY, ref)
    } catch { /* storage blocked */ }
  }, [])

  useEffect(() => {
    if (!user) return
    let code: string | null = null
    try { code = localStorage.getItem(KEY) } catch { return }
    if (!code) return
    // Claim once, whatever the outcome (an existing account or an old code simply isn't eligible).
    try { localStorage.removeItem(KEY) } catch { /* ignore */ }
    void apiCall(user, '/v1/referrals/claim', { method: 'POST', body: { code } }).catch(() => undefined)
  }, [user])

  return null
}
