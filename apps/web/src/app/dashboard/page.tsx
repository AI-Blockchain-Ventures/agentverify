'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DashboardTab } from '@/types'
import { useAuth } from '@/components/auth/AuthProvider'
import { Sidebar } from '@/components/layout/Sidebar'
import { BottomNav } from '@/components/layout/BottomNav'
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
      <div style={{ backgroundColor: 'var(--bg)' }} className="flex min-h-screen items-center justify-center">
        <div style={{ color: 'var(--text-muted)' }} className="text-sm">Loading secure workspace...</div>
      </div>
    )
  }

  const changeTab = (nextTab: DashboardTab) => {
    if (nextTab === 'reports') setReportBadge(0)
    setTab(nextTab)
  }

  return (
    <div style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen">
      <div className="hidden md:block">
        <Sidebar active={tab} onChange={changeTab} reportBadge={reportBadge} />
      </div>
      <main className="min-h-screen pb-20 md:ml-52 md:pb-0">
        <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8">
          <div style={{ borderBottom: '1px solid var(--border)' }} className="mb-6 flex items-center justify-between pb-4">
            <div>
              <h1 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">{pageCopy[tab].title}</h1>
              <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-xs">{pageCopy[tab].subtitle}</p>
            </div>
            {tab === 'scan' && (
              <div style={{ color: 'var(--text-muted)' }} className="flex items-center gap-2 text-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-[#00B37E]" />
                API Online
              </div>
            )}
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
      <BottomNav active={tab} onChange={changeTab} reportBadge={reportBadge} />
    </div>
  )
}
