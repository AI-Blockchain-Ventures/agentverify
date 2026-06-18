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
      <div style={{ color: 'var(--text-muted)' }} className="flex items-center gap-3 text-sm">
        <div style={{ borderColor: 'var(--border)', borderTopColor: '#06B6D4' }} className="h-4 w-4 animate-spin rounded-full border-2" />
        Loading reports...
      </div>
    )
  }

  if (!reports.length) {
    return (
      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-xl p-12 text-center">
        <div style={{ color: 'var(--text-muted)' }} className="mb-4 text-4xl">≡</div>
        <h3 style={{ color: 'var(--text-primary)' }} className="text-lg font-bold">No reports yet</h3>
        <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-sm">
          Run your first verification scan to populate this workspace.
        </p>
        <button
          onClick={onRunScan}
          className="mt-6 rounded-lg bg-[#06B6D4] px-5 py-2.5 text-sm font-semibold text-[#080B14] hover:bg-[#22D3EE] transition-colors"
        >
          Run First Scan
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
      <div style={{ border: '1px solid var(--border)' }} className="overflow-hidden rounded-xl">
        <div style={{ backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--border)' }} className="flex items-center gap-4 px-4 py-2">
          <div className="w-2" />
          <p style={{ color: 'var(--text-muted)' }} className="flex-1 text-xs font-medium uppercase tracking-wider">Agent</p>
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
