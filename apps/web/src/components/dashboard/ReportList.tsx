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
      <div className="flex items-center gap-3 text-sm text-[#4B6080]">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#1E2D40] border-t-[#06B6D4]" />
        Loading reports...
      </div>
    )
  }

  if (!reports.length) {
    return (
      <div className="rounded-xl border border-[#1E2D40] bg-[#0F1623] p-12 text-center">
        <div className="mb-4 text-4xl text-[#4B6080]">≡</div>
        <h3 className="text-lg font-bold text-white">No reports yet</h3>
        <p className="mt-2 text-sm text-[#4B6080]">
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
            <span className="text-sm text-white">
              {newCount} new report{newCount > 1 ? 's' : ''} added
            </span>
          </div>
          <button
            onClick={() => {
              setNewCount(0)
              onClearNotification?.()
            }}
            className="text-xs text-[#4B6080] hover:text-white transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-[#1A2535]">
        <div className="flex items-center gap-4 border-b border-[#1A2535] bg-[#0A0F1A] px-4 py-2">
          <div className="w-2" />
          <p className="flex-1 text-xs font-medium uppercase tracking-wider text-[#3D5166]">Agent</p>
          <p className="text-xs font-medium uppercase tracking-wider text-[#3D5166]">Score</p>
          <p className="w-16 text-xs font-medium uppercase tracking-wider text-[#3D5166]">Issues</p>
          <div className="w-4" />
        </div>
        {reports.map(report => (
          <ReportCard key={`${report.source}-${report.reportId}`} report={report} />
        ))}
      </div>
    </div>
  )
}
