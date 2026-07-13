'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { DashboardTab } from '@/types'
import { useAuth } from '@/components/auth/AuthProvider'
import { Sidebar } from '@/components/layout/Sidebar'
import { BottomNav } from '@/components/layout/BottomNav'
import { ScannerPanel } from '@/components/scanner/ScannerPanel'
import { ReportList } from '@/components/dashboard/ReportList'
import { APIAccess } from '@/components/dashboard/APIAccess'
import { Settings } from '@/components/dashboard/Settings'
import { useBillingStatusState } from '@/lib/useBillingStatus'
import { A2SPA_DOCS_URL } from '@/lib/links'

const pageCopy: Record<DashboardTab, { title: string; subtitle: string }> = {
  scan: { title: 'Scan agent', subtitle: 'Create a private security report from agent code or configuration.' },
  reports: { title: 'Security reports', subtitle: 'Review findings, fixes, and report visibility.' },
  api: { title: 'API access', subtitle: 'Run Agent Verify from your terminal or automation workflow.' },
  settings: { title: 'Settings', subtitle: 'Manage appearance, account, and workspace preferences.' },
}

export default function DashboardPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [tab, setTab] = useState<DashboardTab>('scan')
  const [refreshKey, setRefreshKey] = useState(0)
  const [reportBadge, setReportBadge] = useState(0)
  const [billingSuccess, setBillingSuccess] = useState(false)
  const billing = useBillingStatusState(user)
  const refreshBilling = billing.refresh

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

  useEffect(() => {
    if (!user || typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('billing') === 'success') {
      setBillingSuccess(true)
      refreshBilling()
    }
  }, [user, refreshBilling])

  if (loading || !user) {
    return (
      <div style={{ backgroundColor: 'var(--bg)' }} className="flex min-h-screen items-center justify-center px-6">
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="w-full max-w-sm rounded-3xl p-8 text-center shadow-2xl shadow-black/5">
          <div style={{ borderColor: 'var(--border)', borderTopColor: '#06B6D4' }} className="mx-auto mb-4 h-6 w-6 animate-spin rounded-full border-2" />
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Loading workspace</p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">Preparing your scanner and reports.</p>
        </div>
      </div>
    )
  }

  const changeTab = (nextTab: DashboardTab) => {
    if (nextTab === 'reports') setReportBadge(0)
    setTab(nextTab)
  }

  const planLabel = billing.error
    ? 'Free (status unavailable)'
    : billing.status.plan === 'pro' && billing.status.status === 'active'
      ? 'Pro active'
      : billing.status.status === 'past_due'
        ? 'Past due'
        : billing.status.status === 'canceled'
          ? 'Canceled'
          : 'Free'

  return (
    <div style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen">
      <div className="hidden md:block">
        <Sidebar active={tab} onChange={changeTab} reportBadge={reportBadge} />
      </div>
      <main className="min-h-screen pb-20 md:ml-52 md:pb-0">
        <div className="mx-auto max-w-6xl px-4 py-5 md:px-8 md:py-8">
          <div className="mb-6 overflow-hidden rounded-[2rem] border border-[#00C4CC]/20 bg-[radial-gradient(circle_at_top_left,rgba(0,196,204,0.18),transparent_34%),var(--card)] p-5 shadow-2xl shadow-black/10 backdrop-blur md:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#00C4CC]">Agent Verify workspace</p>
                <h2 style={{ color: 'var(--text-primary)' }} className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">Scan, fix, and share agent execution-risk reports.</h2>
                <p style={{ color: 'var(--text-muted)' }} className="mt-2 max-w-2xl text-sm leading-6">Start with a scan, review the latest reports, manage Pro, or add A2SPA authorization evidence before production release.</p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                <button onClick={() => changeTab('scan')} className="rounded-2xl bg-[#00C4CC] px-4 py-3 text-sm font-semibold text-[#060A0F] shadow-[0_18px_50px_rgba(0,196,204,0.20)] transition-opacity hover:opacity-85">Scan Agent</button>
                <button onClick={() => changeTab('reports')} style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }} className="relative rounded-2xl bg-[var(--surface)] px-4 py-3 text-sm font-semibold transition-opacity hover:opacity-85">
                  Review Reports
                  {reportBadge > 0 && <span className="absolute -right-2 -top-2 rounded-full bg-[#E03E3E] px-2 py-0.5 text-[11px] font-bold text-white">+{reportBadge > 9 ? '9' : reportBadge}</span>}
                </button>
                <Link href="/pricing" className="rounded-2xl border border-[#00C4CC]/30 bg-[#00C4CC]/10 px-4 py-3 text-center text-sm font-semibold text-[#00C4CC] transition-opacity hover:opacity-85">{billing.status.plan === 'pro' ? 'Manage Pro' : 'Upgrade Pro'}</Link>
                <a href={A2SPA_DOCS_URL} target="_blank" rel="noreferrer" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-center text-sm font-semibold text-[var(--text-primary)] transition-opacity hover:opacity-85">Add A2SPA</a>
              </div>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-4">
              {[
                ['Scan', 'Find risky agent behavior before release.'],
                ['Fix', 'Prioritize execution-risk blockers.'],
                ['A2SPA', 'Add signed authorization evidence.'],
                ['Share', 'Send stakeholder-ready reports with Pro.'],
              ].map(([label, copy]) => (
                <div key={label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{label}</p>
                  <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs leading-relaxed">{copy}</p>
                </div>
              ))}
            </div>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="mb-6 rounded-3xl p-5 shadow-xl shadow-black/5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#00C4CC]">Billing</p>
                <h3 style={{ color: 'var(--text-primary)' }} className="mt-1 text-lg font-semibold">{billing.loading ? 'Checking plan...' : planLabel}</h3>
                <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">
                  {billing.error
                    ? 'Billing status could not be loaded, so Pro features are safely treated as Free.'
                    : billing.status.plan === 'pro'
                      ? `Pro features are ${billing.status.status === 'active' ? 'enabled' : 'limited until billing is active'}.`
                      : 'Free plan is active. Upgrade to Pro for remediation-ready reports.'}
                </p>
                {billingSuccess && (
                  <div className="mt-3 rounded-2xl border border-[#00C4CC]/30 bg-[#00C4CC]/10 p-3 text-sm text-[#00C4CC]">
                    <p className="font-semibold">Payment received. Pro is being activated.</p>
                    {(billing.loading || billing.status.plan !== 'pro') && <p className="mt-1">Pro activation may take a few seconds. Refresh billing status.</p>}
                  </div>
                )}
              </div>
              <button onClick={refreshBilling} disabled={billing.loading} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition-opacity hover:opacity-85 disabled:opacity-60">
                {billing.loading ? 'Refreshing...' : 'Refresh billing status'}
              </button>
            </div>
          </div>
          <div style={{ borderBottom: '1px solid var(--border)' }} className="mb-6 flex items-center justify-between gap-3 pb-4">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 style={{ color: 'var(--text-primary)' }} className="text-2xl font-semibold tracking-tight">{pageCopy[tab].title}</h1>
                {tab !== 'reports' && reportBadge > 0 && <button onClick={() => changeTab('reports')} className="rounded-full bg-[#E03E3E]/10 px-3 py-1 text-xs font-semibold text-[#E03E3E]">{reportBadge} new report{reportBadge === 1 ? '' : 's'}</button>}
              </div>
              <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">{pageCopy[tab].subtitle}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {tab === 'scan' && (
                <div style={{ color: 'var(--text-muted)' }} className="hidden items-center gap-2 text-xs sm:flex">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#00B37E]" />
                  Scanner ready
                </div>
              )}
            </div>
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
