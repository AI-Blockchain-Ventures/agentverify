'use client'

import Link from 'next/link'
import { useState } from 'react'
import { collection, deleteDoc, doc, getDocs, query, where } from 'firebase/firestore'
import { useAuth } from '@/components/auth/AuthProvider'
import { db } from '@/lib/firebase'
import { useTheme } from '@/lib/useTheme'

export function Settings() {
  const { user, signOut } = useAuth()
  const { theme, setMode } = useTheme()
  const [deleting, setDeleting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const memberSince = user?.metadata.creationTime
    ? new Date(user.metadata.creationTime).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : 'Unknown'

  const deleteAllReports = async () => {
    if (!user) return
    setDeleting(true)
    try {
      // Delete dashboard reports
      const dashRef = collection(db, 'users', user.uid, 'reports')
      const dashSnap = await getDocs(dashRef)
      await Promise.all(
        dashSnap.docs.map(d =>
          deleteDoc(doc(db, 'users', user.uid, 'reports', d.id))
        )
      )

      // Delete CLI reports
      const cliRef = collection(db, 'cliReports')
      const cliSnap = await getDocs(
        query(cliRef, where('uid', '==', user.uid))
      )
      await Promise.all(
        cliSnap.docs.map(d => deleteDoc(doc(db, 'cliReports', d.id)))
      )

      setShowConfirm(false)
      setDeleting(false)
    } catch (err) {
      console.error('Delete failed:', err)
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div
        style={{
          backgroundColor: 'var(--card)',
          border: '1px solid var(--border)',
        }}
        className="rounded-3xl p-6 shadow-xl shadow-black/5"
      >
        <h2 style={{ color: 'var(--text-primary)' }} className="mb-4 text-sm font-semibold uppercase tracking-wider">
          Appearance
        </h2>
        <div className="flex items-center justify-between">
          <div>
            <p style={{ color: 'var(--text-primary)' }} className="text-sm font-medium">
              Theme
            </p>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs mt-0.5">
              Choose the workspace appearance that feels best.
            </p>
          </div>
          <div
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
            className="flex rounded-lg p-1.5 gap-1"
          >
            <button
              onClick={() => setMode('light')}
              style={{
                backgroundColor: theme === 'light' ? 'var(--card)' : 'transparent',
                color: theme === 'light' ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: theme === 'light' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
              className="rounded-md px-4 py-1.5 text-xs font-medium transition-all"
            >
              Light
            </button>
            <button
              onClick={() => setMode('dark')}
              style={{
                backgroundColor: theme === 'dark' ? 'var(--card)' : 'transparent',
                color: theme === 'dark' ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: theme === 'dark' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
              className="rounded-md px-4 py-1.5 text-xs font-medium transition-all"
            >
              Dark
            </button>
          </div>
        </div>
      </div>

      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-6 shadow-xl shadow-black/5">
        <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">Account</h2>
        <div className="mt-4 space-y-3 text-sm">
          <div>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs uppercase tracking-wider">Email</p>
            <p style={{ color: 'var(--text-primary)' }} className="mt-1">{user?.email ?? 'Unknown user'}</p>
          </div>
          <div>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs uppercase tracking-wider">Member since</p>
            <p style={{ color: 'var(--text-primary)' }} className="mt-1">{memberSince}</p>
          </div>
        </div>
        <button onClick={signOut} className="mt-5 rounded-lg border border-[#E03E3E]/20 bg-[#E03E3E]/5 px-4 py-2 text-sm font-semibold text-[#E03E3E] transition-colors hover:bg-[#E03E3E]/10">
          Sign out
        </button>
      </section>

      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-6 shadow-xl shadow-black/5">
        <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">Report data</h2>
        <p style={{ color: 'var(--text-secondary)' }} className="mt-2 text-sm">Delete saved dashboard and CLI reports from this workspace.</p>
        {showConfirm ? (
          <div className="mt-3 rounded-lg border border-[#E03E3E]/20 bg-[#E03E3E]/5 p-4">
            <p className="mb-3 text-sm text-[#E03E3E]">This will permanently delete all your scan reports. This cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={deleteAllReports} disabled={deleting} style={{ color: '#ffffff' }} className="rounded-lg bg-[#E03E3E] px-4 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-50">
                {deleting ? 'Deleting...' : 'Yes, delete all'}
              </button>
              <button onClick={() => setShowConfirm(false)} style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }} className="rounded-lg px-4 py-2 text-xs hover:opacity-70">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowConfirm(true)} className="mt-4 rounded-lg border border-[#E03E3E]/30 px-4 py-2 text-xs text-[#E03E3E] transition-colors hover:bg-[#E03E3E]/5">
            Delete all reports
          </button>
        )}
      </section>

      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-6 shadow-xl shadow-black/5">
        <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">Legal</h2>
        <div className="mt-3 flex gap-4 text-sm">
          <Link href="/privacy" className="text-[#00C4CC] hover:underline">Privacy Policy</Link>
          <Link href="/terms" className="text-[#00C4CC] hover:underline">Terms of Use</Link>
        </div>
      </section>

      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-6 shadow-xl shadow-black/5">
        <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">About</h2>
        <div style={{ color: 'var(--text-muted)' }} className="mt-3 space-y-1 text-sm">
          <p>Agent Verify v1.3.0</p>
          <p>AI agent security reports and execution-trust guidance</p>
          <p>Powered by A2SPA — AI Blockchain Ventures LLC</p>
          <a href="https://github.com/AI-Blockchain-Ventures/agentverify" target="_blank" rel="noreferrer" className="inline-block text-[#00C4CC] hover:underline">
            GitHub
          </a>
        </div>
      </section>
    </div>
  )
}
