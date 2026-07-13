'use client'

import { useEffect, useRef, useState } from 'react'
import type { StoredReport } from '@/types'
import type { User } from 'firebase/auth'
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { normalize, sortReports } from '@/lib/scanStore'
import { ReportCard } from './ReportCard'

export function ReportList({ user, onRunScan, onNewReports, onClearNotification }: {
  user: User
  onRunScan: () => void
  onNewReports?: (count: number) => void
  onClearNotification?: () => void
}) {
  const [reports, setReports] = useState<StoredReport[]>([])
  const [loading, setLoading] = useState(true)
  const [newCount, setNewCount] = useState(0)
  const baselineCount = useRef(0)
  const isFirstLoad = useRef(true)
  const seenCliIds = useRef<Set<string>>(new Set())
  const cliInitialized = useRef(false)

  useEffect(() => {
    if (!user) return
    setLoading(true)
    isFirstLoad.current = true
    baselineCount.current = 0
    seenCliIds.current = new Set()
    cliInitialized.current = false

    let dashboardReports: StoredReport[] = []
    let cliReports: StoredReport[] = []
    let loaded = 0

    const merge = () => {
      const all = sortReports([...dashboardReports, ...cliReports])
      setReports(all)
      if (loaded < 2) {
        loaded++
        if (loaded === 2) setLoading(false)
      }
    }

    const unsubDashboard = onSnapshot(
      collection(db, 'users', user.uid, 'reports'),
      snap => {
        dashboardReports = snap.docs.map(d => normalize(d.data(), d.id))

        if (isFirstLoad.current) {
          baselineCount.current = snap.docs.length
          isFirstLoad.current = false
          setNewCount(0)
          onClearNotification?.()
          merge()
          return
        }

        const added = Math.max(0, dashboardReports.length - baselineCount.current)
        baselineCount.current = dashboardReports.length
        if (added > 0) {
          setNewCount(c => c + added)
          onNewReports?.(added)
        }
        merge()
      },
      err => {
        console.error('Dashboard reports error:', err)
        setLoading(false)
      }
    )

    const cliQuery = query(
      collection(db, 'cliReports'),
      where('uid', '==', user.uid),
      limit(100)
    )
    const unsubCli = onSnapshot(
      cliQuery,
      snap => {
        const allCliReports = snap.docs.map(d => normalize(d.data(), d.id))
        cliReports = allCliReports

        if (!cliInitialized.current) {
          snap.docs.forEach(d => seenCliIds.current.add(d.id))
          cliInitialized.current = true
          merge()
          return
        }

        const newDocs = snap.docs.filter(d => !seenCliIds.current.has(d.id))
        newDocs.forEach(d => seenCliIds.current.add(d.id))

        if (newDocs.length > 0) {
          setNewCount(c => c + newDocs.length)
          onNewReports?.(newDocs.length)
        }
        merge()
      },
      err => {
        console.error('CLI reports error:', err)
        merge()
      }
    )

    return () => {
      unsubDashboard()
      unsubCli()
    }
  }, [user, onNewReports, onClearNotification])

  if (loading) {
    return (
      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-8 text-center">
        <div style={{ borderColor: 'var(--border)', borderTopColor: '#06B6D4' }} className="mx-auto mb-4 h-6 w-6 animate-spin rounded-full border-2" />
        <p style={{ color: 'var(--text-primary)' }} className="text-sm font-medium">Loading security reports</p>
        <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">Your workspace will appear here in a moment.</p>
      </div>
    )
  }

  if (!reports.length) {
    return (
      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-8 text-center shadow-2xl shadow-black/5 md:p-12">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#00C4CC]/10 text-lg font-semibold text-[#00C4CC]">R</div>
        <h3 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">No security reports yet</h3>
        <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-sm">
          Run your first scan to create a private report with findings and recommended fixes.
        </p>
        <button
          onClick={onRunScan}
          className="mt-6 rounded-2xl bg-[#06B6D4] px-5 py-3 text-sm font-semibold text-[#080B14] hover:bg-[#22D3EE] transition-colors"
        >
          Scan agent
        </button>
      </div>
    )
  }

  return (
    <div>
      {newCount > 0 && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-[#06B6D4]/20 bg-[#06B6D4]/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#06B6D4] animate-pulse" />
            <span style={{ color: 'var(--text-primary)' }} className="text-sm">
              {newCount} new report{newCount > 1 ? 's' : ''} added
            </span>
          </div>
          <button
            onClick={() => {
              setNewCount(0)
              onClearNotification?.()
            }}
            style={{ color: 'var(--text-muted)' }}
            className="text-xs transition-colors hover:opacity-70"
          >
            Dismiss
          </button>
        </div>
      )}
      <div style={{ border: '1px solid var(--border)' }} className="overflow-hidden rounded-3xl shadow-2xl shadow-black/5">
        <div style={{ backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--border)' }} className="hidden items-center gap-4 px-4 py-3 sm:flex">
          <div className="w-2" />
          <p style={{ color: 'var(--text-muted)' }} className="flex-1 text-xs font-medium uppercase tracking-wider">Report</p>
          <p style={{ color: 'var(--text-muted)' }} className="text-xs font-medium uppercase tracking-wider">Score</p>
          <p style={{ color: 'var(--text-muted)' }} className="w-16 text-xs font-medium uppercase tracking-wider">Issues</p>
          <div className="w-4" />
        </div>
        {reports.map(report => (
          <ReportCard key={`${report.source}-${report.reportId}`} report={report} />
        ))}
      </div>
    </div>
  )
}
