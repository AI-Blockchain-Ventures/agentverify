'use client'

import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { copyToClipboard } from '@/lib/clipboard'

export interface ReportSharing {
  canManage: boolean
  isPublic: boolean
  busy: boolean
  error: string | null
  copied: boolean
  setVisibility: (isPublic: boolean) => Promise<boolean>
  /** Copies the report link. For the owner of a private report, makes it public first, so the link works. */
  copyShareLink: () => Promise<boolean>
}

interface Options {
  report?: Record<string, unknown>
  reportId: string
  user: User | null
  isOwner: boolean
  publicReportUrl: string
  onReportUpdate?: (updates: Record<string, unknown>) => void
}

export function useReportSharing({ report, reportId, user, isOwner, publicReportUrl, onReportUpdate }: Options): ReportSharing {
  const [isPublic, setIsPublic] = useState(report?.isPublic === true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => { setIsPublic(report?.isPublic === true) }, [report?.isPublic])

  const canManage = !!(user && isOwner && reportId.startsWith('REPORT-'))

  const setVisibility = async (next: boolean) => {
    if (!user || !canManage) return false
    setBusy(true)
    setError(null)
    // Only the sharing fields change; the database rules keep verdict, score and findings locked.
    const updates = { isPublic: next, isPrivate: !next }
    try {
      const topRef = doc(db, 'reports', reportId)
      let updated = false
      try {
        await updateDoc(topRef, updates)
        updated = true
      } catch { /* the report may live in cliReports instead */ }
      if (!updated || report?._source === 'cliReports') {
        try { await updateDoc(doc(db, 'cliReports', reportId), updates); updated = true } catch { /* not a CLI report */ }
      }
      try { await updateDoc(doc(db, 'users', user.uid, 'reports', reportId), updates) } catch { /* older reports have no copy here */ }
      if (!updated) throw new Error('report not found')
      const check = await getDoc(topRef).catch(() => null)
      if (check?.exists() && check.data().isPublic !== next) throw new Error('share setting did not save')
      setIsPublic(next)
      onReportUpdate?.(updates)
      return true
    } catch (err) {
      console.error('Failed to change report sharing:', err)
      setError('Sharing could not be changed. Refresh the page and try again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const copyShareLink = async () => {
    if (canManage && !isPublic && !(await setVisibility(true))) return false
    const ok = await copyToClipboard(publicReportUrl)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }
    return ok
  }

  return { canManage, isPublic, busy, error, copied, setVisibility, copyShareLink }
}

/** Owner-only sharing controls, shown at the top of the report. */
export function ShareBar({ sharing, artifactHash }: { sharing: ReportSharing; artifactHash?: string }) {
  const [verifyCopied, setVerifyCopied] = useState(false)
  if (!sharing.canManage) return null
  const { isPublic, busy, error, copied } = sharing
  const verifyUrl = artifactHash ? `https://aimodularity.com/agentverify/verify/?hash=${artifactHash}` : null

  return (
    <div data-testid="share-bar" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="no-print mb-6 rounded-2xl p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{isPublic ? '🌐 Public report' : '🔒 Private report'}</p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-xs">
            {isPublic ? 'Anyone with the link can view it.' : 'Only you can see it. Copying the link makes it public so the link works for others.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void sharing.copyShareLink()}
            disabled={busy}
            className="rounded-xl bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white hover:opacity-85 disabled:opacity-60"
          >
            {busy ? 'Saving…' : copied ? '✓ Link copied' : isPublic ? 'Copy link' : 'Make public & copy link'}
          </button>
          {isPublic && (
            <button
              onClick={() => void sharing.setVisibility(false)}
              disabled={busy}
              style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              className="rounded-xl px-4 py-2 text-sm font-semibold hover:opacity-85 disabled:opacity-60"
            >
              Make private
            </button>
          )}
        </div>
      </div>
      {error && <p role="alert" className="mt-3 text-xs font-semibold text-[color:var(--accent-red-text)]">{error}</p>}
      {isPublic && verifyUrl && (
        <div className="mt-3 flex flex-col gap-1 border-t border-[var(--border)] pt-3 text-xs sm:flex-row sm:items-center sm:justify-between">
          <span style={{ color: 'var(--text-muted)' }}>Verification link: shows only the verdict and file fingerprint, no findings.</span>
          <button
            onClick={async () => { if (await copyToClipboard(verifyUrl)) { setVerifyCopied(true); setTimeout(() => setVerifyCopied(false), 2000) } }}
            style={{ color: 'var(--accent-purple-text)' }}
            className="w-fit font-semibold hover:opacity-80"
          >
            {verifyCopied ? '✓ Copied' : 'Copy verification link'}
          </button>
        </div>
      )}
    </div>
  )
}
