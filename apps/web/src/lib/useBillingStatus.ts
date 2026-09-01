'use client'

import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { billingRoutes, freeBillingStatus, getApiBaseUrl, type BillingStatus } from './billing'

export function useBillingStatusState(user: User | null) {
  const [status, setStatus] = useState<BillingStatus>(freeBillingStatus)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => {
    setRefreshKey(key => key + 1)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(false)
      try {
        const headers: HeadersInit = {}
        if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`
        const res = await fetch(`${getApiBaseUrl()}${billingRoutes.status}`, { headers })
        if (!res.ok) throw new Error('billing status unavailable')
        const data = await res.json() as BillingStatus
        // Trust the real response for BOTH plans now — it carries real per-user `used`, which
        // varies even on the free plan and previously got discarded here in favor of the static
        // freeBillingStatus default. Only a malformed/unexpected shape falls back to the default.
        if (!cancelled) setStatus(data.plan === 'pro' || data.plan === 'free' ? data : freeBillingStatus)
      } catch {
        if (!cancelled) {
          setStatus(freeBillingStatus)
          setError(true)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [user, refreshKey])

  return { status, loading, error, refresh }
}

export function useBillingStatus(user: User | null, refreshKey = 0): BillingStatus {
  const state = useBillingStatusState(user)
  const { refresh } = state

  useEffect(() => {
    if (refreshKey > 0) refresh()
  }, [refreshKey, refresh])

  return state.status
}
