'use client'

import { auth } from '@/lib/firebase'
import { trackSignIn, trackSignUp } from '@/lib/analytics'
import {
  GoogleAuthProvider,
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const getAuthError = (code: string): string => {
  const errors: Record<string, string> = {
    'auth/popup-closed-by-user': '',
    'auth/popup-blocked': 'Popup was blocked. Please allow popups for this site.',
    'auth/invalid-action-code': 'Sign in link expired. Please try again.',
    'auth/cancelled-popup-request': '',
    'auth/wrong-password': 'Incorrect password.',
    'auth/user-not-found': 'No account found with this email.',
    'auth/email-already-in-use': 'An account already exists with this email.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/too-many-requests': 'Too many attempts. Please try again later.',
    'auth/network-request-failed': 'Connection error. Please try again.',
  }
  return errors[code] ?? 'Something went wrong. Please try again.'
}

interface AuthContextValue {
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  signInWithGoogle: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    return onAuthStateChanged(auth, currentUser => {
      setUser(currentUser)
      setLoading(false)
    })
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password)
    trackSignIn()
  }, [])

  const signUp = useCallback(async (email: string, password: string) => {
    await createUserWithEmailAndPassword(auth, email, password)
    trackSignUp()
  }, [])

  const signInWithGoogle = useCallback(async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider())
      trackSignIn()
    } catch (err) {
      const e = err as { code?: string; message?: string }
      const msg = e.code ? getAuthError(e.code) : (e.message ?? 'Something went wrong. Please try again.')
      if (!msg) return
      // If getting auth/unauthorized-domain, add your domain to
      // Firebase Console > Authentication > Settings > Authorized domains
      throw new Error(msg)
    }
  }, [])

  // Password reset must not reveal whether an email address has an account (account
  // enumeration). Firebase throws auth/user-not-found when it doesn't — we swallow that
  // specific case so the UI can show the same "check your inbox" message either way.
  // Any other failure (invalid email format, rate limiting, network) still surfaces.
  const resetPassword = useCallback(async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email)
    } catch (err) {
      const e = err as { code?: string }
      if (e.code === 'auth/user-not-found') return
      throw err
    }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    signIn,
    signUp,
    signOut: () => firebaseSignOut(auth),
    signInWithGoogle,
    resetPassword,
  }), [user, loading, signIn, signUp, signInWithGoogle, resetPassword])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
