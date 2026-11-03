'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'

/** "Start free" / "Sign in" buttons go to the real /signup and /login pages. */
export function useAuthNav() {
  const router = useRouter()
  return useCallback((mode: 'signIn' | 'signUp', next?: string) => {
    const path = mode === 'signUp' ? '/signup' : '/login'
    router.push(next ? `${path}?next=${encodeURIComponent(next)}` : path)
  }, [router])
}
