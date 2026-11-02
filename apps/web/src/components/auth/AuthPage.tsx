'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from './AuthProvider'
import { Brand } from '@/components/layout/Brand'

type Mode = 'signIn' | 'signUp' | 'forgotPassword'

const AUTH_ERRORS: Record<string, string> = {
  'auth/wrong-password': 'That email and password do not match.',
  'auth/invalid-credential': 'That email and password do not match.',
  'auth/user-not-found': 'That email and password do not match.',
  'auth/email-already-in-use': 'An account already exists with this email. Log in instead.',
  'auth/weak-password': 'Use at least 8 characters for your password.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
  'auth/network-request-failed': 'Connection problem. Check your internet and try again.',
  'auth/popup-blocked': 'Your browser blocked the Google window. Allow pop-ups for this site and try again.',
  'auth/popup-closed-by-user': '',
  'auth/cancelled-popup-request': '',
}
const errorText = (err: unknown): string => {
  const e = err as { code?: string; message?: string }
  if (e.code && e.code in AUTH_ERRORS) return AUTH_ERRORS[e.code]
  return e.message || 'Something went wrong. Please try again.'
}

/** Where to go after signing in: a same-site path from ?next=, otherwise the dashboard. */
function nextPath(): string {
  if (typeof window === 'undefined') return '/dashboard'
  const next = new URLSearchParams(window.location.search).get('next') ?? ''
  return /^\/(?!\/)[\w\-./?=&#%]*$/.test(next) ? next : '/dashboard'
}

const POINTS = ['Free plan — no credit card', 'Scan a repo in about 30 seconds', 'PR checks on GitHub, GitLab and Bitbucket', 'Invite your team any time']

export function AuthPage({ initialMode }: { initialMode: 'signIn' | 'signUp' }) {
  const { user, loading, signIn, signUp, signInWithGoogle, resetPassword } = useAuth()
  const router = useRouter()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  // Already signed in (or just signed in): go straight on.
  useEffect(() => {
    if (!loading && user) router.replace(nextPath())
  }, [loading, user, router])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try { await fn() } catch (err) { setError(errorText(err)) }
    setBusy(false)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    void run(async () => {
      if (mode === 'forgotPassword') { await resetPassword(email); setResetSent(true); return }
      if (mode === 'signUp') {
        if (password.length < 8) throw Object.assign(new Error(''), { code: 'auth/weak-password' })
        await signUp(email, password)
      } else {
        await signIn(email, password)
      }
    })
  }

  const input = { backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }
  const title = mode === 'signUp' ? 'Create your free account' : mode === 'signIn' ? 'Log in to Agent Verify' : 'Reset your password'

  return (
    <main className="grid min-h-screen lg:grid-cols-2" style={{ backgroundColor: 'var(--bg)' }}>
      <section className="hidden flex-col justify-between p-12 lg:flex xl:p-16" style={{ backgroundColor: 'var(--card)', borderRight: '1px solid var(--border)' }}>
        <Link href="/" aria-label="Agent Verify home" className="text-lg"><Brand size={36} /></Link>
        <div>
          <h2 className="max-w-md text-3xl font-bold leading-tight tracking-tight xl:text-4xl" style={{ color: 'var(--text-primary)' }}>Ship AI agents your security team will approve.</h2>
          <ul className="mt-8 space-y-3">
            {POINTS.map(p => (
              <li key={p} className="flex gap-3 text-base" style={{ color: 'var(--text-secondary)' }}><span className="font-bold text-[color:var(--accent-green-text)]" aria-hidden="true">✓</span>{p}</li>
            ))}
          </ul>
        </div>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Your raw agent code is never stored. <Link href="/trust" className="font-semibold text-[color:var(--accent-purple-text)]">Trust Center →</Link></p>
      </section>

      <section className="flex flex-col justify-center px-4 py-10 sm:px-8">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/" aria-label="Agent Verify home" className="mb-10 inline-block text-base lg:hidden"><Brand size={32} /></Link>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>{title}</h1>
          <p className="mt-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
            {mode === 'signUp' ? '10 free scans a month and private reports. No credit card.' : mode === 'signIn' ? 'Welcome back.' : 'We will email you a link to set a new password.'}
          </p>

          {mode === 'forgotPassword' && resetSent ? (
            <div className="mt-6 space-y-4">
              <p className="rounded-md p-3 text-sm text-[color:var(--accent-green-text)]" style={{ backgroundColor: 'rgba(18,183,106,0.08)', border: '1px solid rgba(18,183,106,0.25)' }}>
                If an account exists for {email}, a reset link is on its way. Check your inbox and spam folder.
              </p>
              <button onClick={() => { setMode('signIn'); setResetSent(false) }} className="w-full rounded-md bg-[#7C3AED] py-2.5 text-sm font-semibold text-white hover:bg-[#6D28D9]">Back to log in</button>
            </div>
          ) : (
            <>
              {mode !== 'forgotPassword' && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(signInWithGoogle)}
                    className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-md py-2.5 text-sm font-semibold transition-opacity hover:opacity-85 disabled:opacity-50"
                    style={{ border: '1px solid var(--border-light)', backgroundColor: 'var(--card)', color: 'var(--text-primary)' }}
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    Continue with Google
                  </button>
                  <div className="my-5 flex items-center gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span className="h-px flex-1" style={{ backgroundColor: 'var(--border)' }} />or<span className="h-px flex-1" style={{ backgroundColor: 'var(--border)' }} />
                  </div>
                </>
              )}

              <form onSubmit={submit} className={`space-y-4 ${mode === 'forgotPassword' ? 'mt-6' : ''}`}>
                <label className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  Work email
                  <input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" style={input} className="mt-1.5 w-full rounded-md px-3 py-2.5 text-sm font-normal outline-none focus:border-[#7C3AED]" />
                </label>
                {mode !== 'forgotPassword' && (
                  <label className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    <span className="flex items-center justify-between">
                      Password
                      {mode === 'signIn' && <button type="button" onClick={() => { setMode('forgotPassword'); setError('') }} className="text-xs font-medium text-[color:var(--accent-purple-text)]">Forgot password?</button>}
                    </span>
                    <input type="password" required minLength={mode === 'signUp' ? 8 : 6} autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'signUp' ? 'At least 8 characters' : ''} style={input} className="mt-1.5 w-full rounded-md px-3 py-2.5 text-sm font-normal outline-none focus:border-[#7C3AED]" />
                  </label>
                )}
                {error && <p role="alert" className="rounded-md p-3 text-sm text-[color:var(--accent-red-text)]" style={{ backgroundColor: 'rgba(217,45,32,0.06)', border: '1px solid rgba(217,45,32,0.25)' }}>{error}</p>}
                <button type="submit" disabled={busy} className="w-full rounded-md bg-[#7C3AED] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#6D28D9] disabled:opacity-60">
                  {busy ? 'Working…' : mode === 'signUp' ? 'Create free account' : mode === 'signIn' ? 'Log in' : 'Send reset link'}
                </button>
              </form>

              {mode === 'signUp' && (
                <p className="mt-4 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>
                  By creating an account you agree to the <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.
                </p>
              )}
            </>
          )}

          <p className="mt-8 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {mode === 'signUp' ? (
              <>Already have an account? <Link href="/login" className="font-semibold text-[color:var(--accent-purple-text)]">Log in</Link></>
            ) : mode === 'signIn' ? (
              <>New to Agent Verify? <Link href="/signup" className="font-semibold text-[color:var(--accent-purple-text)]">Create a free account</Link></>
            ) : (
              <button onClick={() => { setMode('signIn'); setError('') }} className="font-semibold text-[color:var(--accent-purple-text)]">Back to log in</button>
            )}
          </p>
        </div>
      </section>
    </main>
  )
}
