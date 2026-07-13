'use client'

import { useEffect, useState } from 'react'
import { useAuth } from './AuthProvider'
import { Button } from '@/components/ui/Button'

const getAuthError = (code: string): string => {
  const errors: Record<string, string> = {
    'auth/wrong-password': 'Incorrect password',
    'auth/popup-blocked': 'Popup was blocked. Please allow popups for this site.',
    'auth/invalid-action-code': 'Sign in link expired. Please try again.',
    'auth/cancelled-popup-request': '',
    'auth/user-not-found': 'No account found with this email',
    'auth/email-already-in-use': 'An account already exists with this email',
    'auth/weak-password': 'Password must be at least 6 characters',
    'auth/invalid-email': 'Please enter a valid email address',
    'auth/too-many-requests': 'Too many attempts. Please try again later.',
    'auth/network-request-failed': 'Connection error. Please try again.',
    'auth/popup-closed-by-user': '',
  }
  return errors[code] ?? 'Something went wrong. Please try again.'
}

interface AuthModalProps {
  open: boolean
  onClose: () => void
  defaultMode?: 'signIn' | 'signUp'
}

export function AuthModal({ open, onClose, defaultMode = 'signIn' }: AuthModalProps) {
  const { signIn, signUp, signInWithGoogle } = useAuth()
  const [mode, setMode] = useState(defaultMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setMode(defaultMode)
    setError(null)
  }, [defaultMode, open])

  if (!open) return null

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      if (mode === 'signIn') await signIn(email, password)
      else await signUp(email, password)
      onClose()
    } catch (err) {
      const e = err as { code?: string; message?: string }
      const msg = e.code ? getAuthError(e.code) : (e.message ?? 'Something went wrong')
      if (msg) setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const google = async () => {
    setLoading(true)
    setError(null)
    try {
      await signInWithGoogle()
      onClose()
    } catch (err) {
      const e = err as { code?: string; message?: string }
      const msg = e.code ? getAuthError(e.code) : (e.message ?? 'Something went wrong')
      if (msg) setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mx-auto w-full max-w-sm rounded-3xl p-7 shadow-2xl shadow-black/30 md:p-8">
        <p style={{ color: 'var(--text-muted)' }} className="mb-3 text-xs font-semibold uppercase tracking-[0.24em]">Agent Verify</p>
        <h2 style={{ color: 'var(--text-primary)' }} className="mb-2 text-2xl font-semibold tracking-tight">{mode === 'signIn' ? 'Welcome back' : 'Create your workspace'}</h2>
        <p style={{ color: 'var(--text-muted)' }} className="mb-6 text-sm">{mode === 'signIn' ? 'Sign in to view reports and scan agents.' : 'Start with 10 free scans/month and private reports.'}</p>
        <form onSubmit={submit} className="space-y-3">
          <input style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }} className="w-full rounded-lg px-4 py-3 text-sm outline-none focus:border-[#00C4CC]/50" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="Email" required />
          <input style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }} className="w-full rounded-lg px-4 py-3 text-sm outline-none focus:border-[#00C4CC]/50" type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Password" required minLength={6} />
          {error && <p className="rounded-lg border border-[#EF4444]/20 bg-[#EF4444]/5 p-3 text-sm text-[#EF4444]">{error}</p>}
          <Button type="submit" variant="primary" size="lg" className="w-full justify-center" disabled={loading}>{loading ? 'Working...' : mode === 'signIn' ? 'Sign in' : 'Create account'}</Button>
        </form>
        <button onClick={google} disabled={loading} style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm transition-opacity hover:opacity-80 disabled:opacity-30">
          <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>
        <button style={{ color: 'var(--text-secondary)' }} className="mt-4 w-full text-center text-sm transition-opacity hover:opacity-70" onClick={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}>
          {mode === 'signIn' ? 'New to Agent Verify? Create account' : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  )
}
