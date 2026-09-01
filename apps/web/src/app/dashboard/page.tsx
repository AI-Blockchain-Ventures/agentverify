'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { DashboardTab } from '@/types'
import { useAuth } from '@/components/auth/AuthProvider'
import { Sidebar } from '@/components/layout/Sidebar'
import { BottomNav } from '@/components/layout/BottomNav'
import { MobileNavDrawer } from '@/components/layout/MobileNav'
import { ScannerPanel } from '@/components/scanner/ScannerPanel'
import { ReportList } from '@/components/dashboard/ReportList'
import { APIAccess } from '@/components/dashboard/APIAccess'
import { Settings } from '@/components/dashboard/Settings'
import { DashboardOverview } from '@/components/dashboard/DashboardOverview'
import { AgentsInventory } from '@/components/dashboard/AgentsInventory'
import { CheckCatalog } from '@/components/dashboard/CheckCatalog'
import { PolicyProfiles } from '@/components/dashboard/PolicyProfiles'
import { Integrations } from '@/components/dashboard/Integrations'
import { Workspace } from '@/components/dashboard/Workspace'
import { useBillingStatusState } from '@/lib/useBillingStatus'
import { summarizeBillingState } from '@/lib/billing'

const pageCopy: Record<DashboardTab, { title: string; subtitle: string; docsHref?: string }> = {
  overview: { title: 'Dashboard', subtitle: 'Your agent security posture at a glance — what changed, what needs attention.' },
  agents: { title: 'Agents', subtitle: 'Monitor the security posture of every AI agent you’ve verified.' },
  scan: { title: 'Scan agent', subtitle: 'Create a private security report from agent code or configuration.' },
  reports: { title: 'Security reports', subtitle: 'Review findings, fixes, and report visibility.' },
  checks: { title: 'Verification Checks', subtitle: 'The real, auditable catalog of checks Agent Verify runs on every scan.', docsHref: '/docs#catalog' },
  policies: { title: 'Policies', subtitle: 'Define the security requirements agents must meet.', docsHref: '/docs' },
  workspace: { title: 'Workspace', subtitle: 'Members, roles, activity, and webhooks shared across your team.', docsHref: '/docs' },
  integrations: { title: 'Integrations', subtitle: 'Real ways to connect Agent Verify to your workflow.', docsHref: '/docs#ci-cd' },
  api: { title: 'API access', subtitle: 'Run Agent Verify from your terminal or automation workflow.', docsHref: '/docs#cli' },
  settings: { title: 'Settings', subtitle: 'Manage appearance, account, and workspace preferences.' },
}

export default function DashboardPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [tab, setTab] = useState<DashboardTab>('overview')
  const [refreshKey, setRefreshKey] = useState(0)
  const [reportBadge, setReportBadge] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [billingSuccess, setBillingSuccess] = useState(false)
  const billing = useBillingStatusState(user)

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
      billing.refresh()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

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
    setMenuOpen(false)
  }

  const goToAgent = (slug: string) => router.push(`/dashboard/agent?name=${encodeURIComponent(slug)}`)

  // Entitlement, not the raw Stripe status: `isActivePro` covers active AND trialing (both grant
  // Pro access) and stays true through cancelAtPeriodEnd — the sidebar must never say Free before
  // the subscription's current period actually ends. See lib/billing.ts's summarizeBillingState,
  // the single shared interpretation of plan/status/cancelAtPeriodEnd used by Pricing, Settings,
  // and here so none of them can drift out of sync with what the backend actually says.
  const planLabel = billing.error
    ? 'Free'
    : summarizeBillingState(billing.status).isActivePro
      ? 'Pro'
      : billing.status.status === 'past_due'
        ? 'Past due'
        : billing.status.status === 'canceled'
          ? 'Canceled'
          : 'Free'

  return (
    <div style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen">
      <div className="hidden md:block">
        <Sidebar active={tab} onChange={changeTab} reportBadge={reportBadge} planLabel={planLabel} />
      </div>
      <MobileNavDrawer open={menuOpen} onClose={() => setMenuOpen(false)} active={tab} onChange={changeTab} reportBadge={reportBadge} planLabel={planLabel} />
      <main className="min-h-screen pb-20 md:ml-60 md:pb-0">
        <div className="mx-auto max-w-6xl px-4 py-5 md:px-8 md:py-8">
          {(billingSuccess || billing.error || billing.status.status === 'past_due') && (
            <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="av-animate-fade mb-5 flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">
                  {billingSuccess ? 'Payment received — Pro is being activated.' : billing.error ? 'Billing status could not be loaded, so Pro features are safely treated as Free.' : 'Your subscription payment is past due.'}
                </p>
                {billingSuccess && (billing.loading || billing.status.plan !== 'pro') && (
                  <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-xs">Activation can take a few seconds — refresh billing status if it hasn&apos;t updated.</p>
                )}
              </div>
              <button onClick={billing.refresh} disabled={billing.loading} className="av-press shrink-0 rounded-xl border px-3 py-2 text-xs font-semibold transition-opacity hover:opacity-85 disabled:opacity-60" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)', backgroundColor: 'var(--card)' }}>
                {billing.loading ? 'Refreshing...' : 'Refresh billing status'}
              </button>
            </div>
          )}
          <div key={tab} className="av-animate-fade mb-6 flex items-center justify-between gap-3 border-b pb-4" style={{ borderColor: 'var(--border)' }}>
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 style={{ color: 'var(--text-primary)' }} className="text-2xl font-semibold tracking-tight">{pageCopy[tab].title}</h1>
                {tab !== 'reports' && reportBadge > 0 && (
                  <button onClick={() => changeTab('reports')} className="rounded-full bg-[#E03E3E]/10 px-3 py-1 text-xs font-semibold text-[color:var(--accent-red-text)]">
                    {reportBadge} new report{reportBadge === 1 ? '' : 's'}
                  </button>
                )}
              </div>
              <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">{pageCopy[tab].subtitle}</p>
            </div>
            {tab === 'scan' && (
              <div style={{ color: 'var(--text-muted)' }} className="hidden shrink-0 items-center gap-2 text-xs sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-[#00B37E]" />
                Scanner ready
              </div>
            )}
            {pageCopy[tab].docsHref && (
              <Link href={pageCopy[tab].docsHref!} style={{ color: 'var(--text-muted)' }} className="hidden shrink-0 items-center gap-1 text-xs font-semibold transition-colors hover:text-[color:var(--accent-purple-text)] sm:flex">
                Read docs →
              </Link>
            )}
          </div>

          <div key={`content-${tab}`} className="av-animate-rise">
            {tab === 'overview' && (
              <DashboardOverview user={user} onGoToScan={() => changeTab('scan')} onGoToAgent={goToAgent} />
            )}
            {tab === 'agents' && (
              <AgentsInventory key={refreshKey} user={user} onOpenAgent={goToAgent} />
            )}
            {tab === 'scan' && (
              <ScannerPanel user={user} onScanComplete={handleScanComplete} />
            )}
            {tab === 'reports' && (
              <ReportList
                key={refreshKey}
                user={user}
                onRunScan={() => changeTab('scan')}
                onNewReports={handleNewReports}
                onClearNotification={() => setReportBadge(0)}
              />
            )}
            {tab === 'checks' && <CheckCatalog />}
            {tab === 'policies' && <PolicyProfiles user={user} />}
            {tab === 'workspace' && <Workspace user={user} />}
            {tab === 'integrations' && <Integrations />}
            {tab === 'api' && <APIAccess />}
            {tab === 'settings' && <Settings onNavigate={changeTab} />}
          </div>
        </div>
      </main>
      <BottomNav active={tab} onChange={changeTab} reportBadge={reportBadge} onOpenMenu={() => setMenuOpen(true)} />
    </div>
  )
}
