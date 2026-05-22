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

  useEffect(() => {
    if (!user) return
    setLoading(true)
    isFirstLoad.current = true
    baselineCount.current = 0

    let dashboardReports: StoredReport[] = []
    let cliReports: StoredReport[] = []
    let loaded = 0
    let cliFirstLoad = true

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
        const newCliReports = snap.docs.map(d => normalize(d.data(), d.id))
        if (cliFirstLoad) {
          cliReports = newCliReports
          cliFirstLoad = false
          setNewCount(0)
          onClearNotification?.()
          merge()
          return
        }
        const added = Math.max(0, newCliReports.length - cliReports.length)
        cliReports = newCliReports
        if (added > 0) {
          setNewCount(c => c + added)
          onNewReports?.(added)
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
      <div className="space-y-3">
        {reports.map(report => (
          <ReportCard key={`${report.source}-${report.reportId}`} report={report} />
        ))}
      </div>
    </div>
  )
}
