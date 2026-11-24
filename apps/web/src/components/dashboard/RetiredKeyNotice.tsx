'use client'

import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { db } from '@/lib/firebase'
import { isRetiredApiKey } from '@/lib/apiKeyRetirement'

/** Shown across the dashboard when the signed-in user's API key was retired, until they make a new one. */
export function RetiredKeyNotice({ user, onOpenApi }: { user: User | null; onOpenApi: () => void }) {
  const [retired, setRetired] = useState(false)

  useEffect(() => {
    if (!user) { setRetired(false); return }
    let cancelled = false
    getDoc(doc(db, 'users', user.uid, 'apiKeys', 'default'))
      .then(snap => { if (!cancelled) setRetired(snap.exists() && isRetiredApiKey(snap.data().createdAt)) })
      .catch(() => { if (!cancelled) setRetired(false) })
    // Re-checked when the user creates a new key on the API tab.
    const onChange = () => { getDoc(doc(db, 'users', user.uid, 'apiKeys', 'default')).then(snap => setRetired(snap.exists() && isRetiredApiKey(snap.data().createdAt))).catch(() => {}) }
    window.addEventListener('agentverify:api-key-changed', onChange)
    return () => { cancelled = true; window.removeEventListener('agentverify:api-key-changed', onChange) }
  }, [user])

  if (!retired) return null
  return (
    <div role="alert" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--accent-orange-text)' }} className="mb-5 flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center">
      <p style={{ color: 'var(--text-secondary)' }} className="flex-1 text-sm leading-relaxed">
        <b style={{ color: 'var(--text-primary)' }}>Your API key was retired for security.</b> Create a new key, then update it wherever you use it (your terminal, CI, or Agent Guard). Until then, CLI scans and Agent Guard reporting are paused.
      </p>
      <button onClick={onOpenApi} className="shrink-0 rounded-xl bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#6D28D9]">
        Create new key
      </button>
    </div>
  )
}
