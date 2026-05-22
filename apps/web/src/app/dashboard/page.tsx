'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DashboardTab } from '@/types'
import { useAuth } from '@/components/auth/AuthProvider'
import { Sidebar } from '@/components/layout/Sidebar'
import { ScannerPanel } from '@/components/scanner/ScannerPanel'
import { ReportList } from '@/components/dashboard/ReportList'
import { APIAccess } from '@/components/dashboard/APIAccess'
import { Settings } from '@/components/dashboard/Settings'

const pageCopy: Record<DashboardTab, { title: string; subtitle: string }> = {
  scan: { title: 'Execution Trust Scan', subtitle: 'Analyze your agent configuration' },
  reports: { title: 'Reports', subtitle: 'Your scan history' },
  api: { title: 'API Access', subtitle: 'Integrate Agent Verify into your workflow' },
  settings: { title: 'Settings', subtitle: 'Account and preferences' },
}

export default function DashboardPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [tab, setTab] = useState<DashboardTab>('scan')
  const [refreshKey, setRefreshKey] = useState(0)
  const [reportBadge, setReportBadge] = useState(0)

  const handleNewReports = useCallback((count: number) => {
    setReportBadge(current => current + count)
  }, [])

  const handleScanComplete = useCallback(() => {
    setRefreshKey(k => k + 1)
    setReportBadge(current => current + 1)
  }, [])

  useEffect(() => {
    if (!loading && !user) router.push('/')
  }, [loading, user, router])

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#080B14]">
        <div className="text-sm text-[#4B6080]">Loading secure workspace...</div>
      </div>
    )
  }

  const changeTab = (nextTab: DashboardTab) => {
    if (nextTab === 'reports') setReportBadge(0)
    setTab(nextTab)
  }

  return (
    <div className="min-h-screen bg-[#080B14]">
      <Sidebar active={tab} onChange={changeTab} reportBadge={reportBadge} />
      <main className="ml-56 min-h-screen">
        <div className="mx-auto max-w-4xl px-8 py-8">
          <div className="mb-8 border-b border-[#1E2D40] pb-6">
            <h1 className="text-2xl font-bold text-white">{pageCopy[tab].title}</h1>
            <p className="mt-1 text-sm text-[#4B6080]">{pageCopy[tab].subtitle}</p>
          </div>
          {tab === 'scan' && (
            <ScannerPanel
              user={user}
              onScanComplete={handleScanComplete}
            />
          )}
          {tab === 'reports' && (
            <ReportList
              key={refreshKey}
              user={user}
              onRunScan={() => setTab('scan')}
              onNewReports={handleNewReports}
              onClearNotification={() => setReportBadge(0)}
            />
          )}
          {tab === 'api' && <APIAccess />}
          {tab === 'settings' && <Settings />}
        </div>
      </main>
    </div>
  )
}
