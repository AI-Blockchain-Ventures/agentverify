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
import { GithubMonitoring } from '@/components/dashboard/GithubMonitoring'
import { AgentGuard } from '@/components/dashboard/AgentGuard'
import { InjectionTests } from '@/components/dashboard/InjectionTests'
import { Workspace } from '@/components/dashboard/Workspace'
import { Billing } from '@/components/dashboard/Billing'
import { useBillingStatusState } from '@/lib/useBillingStatus'
import { summarizeBillingState } from '@/lib/billing'
import { apiCall } from '@/lib/v2Api'
import { openAsk } from '@/components/ask/askEvents'
import { FeedbackDialog, openFeedback } from '@/components/growth/FeedbackDialog'
import { DASHBOARD_TAB_EVENT } from '@/components/ask/AskPalette'
import { OnboardingProfile } from '@/components/growth/OnboardingProfile'
import { SectionErrorBoundary } from '@/components/ui/SectionErrorBoundary'

const pageCopy: Record<DashboardTab, { title: string; subtitle: string; docsHref?: string }> = {
  overview: { title: 'Dashboard', subtitle: 'Your agent security posture at a glance — what changed, what needs attention.' },
  agents: { title: 'Agents', subtitle: 'Monitor the security posture of every AI agent you’ve verified.' },
  scan: { title: 'Scan agent', subtitle: 'Create a private security report from agent code or configuration.' },
  reports: { title: 'Security reports', subtitle: 'Review findings, fixes, and report visibility.' },
  checks: { title: 'Verification Checks', subtitle: 'The real, auditable catalog of checks Agent Verify runs on every scan.', docsHref: '/docs#catalog' },
  policies: { title: 'Policies', subtitle: 'Define the security requirements agents must meet.', docsHref: '/docs' },
  workspace: { title: 'Workspace', subtitle: 'Members, roles, activity, and webhooks shared across your team.', docsHref: '/docs' },
  billing: { title: 'Billing & plan', subtitle: 'Your plan, scan usage, and Stripe billing — without leaving the dashboard.' },
  integrations: { title: 'Integrations', subtitle: 'Real ways to connect Agent Verify to your workflow.', docsHref: '/docs#ci-cd' },
  redteam: { title: 'Injection tests', subtitle: 'Send known prompt-injection attacks to your own agent and see which ones it falls for.', docsHref: '/developers' },
  guard: { title: 'Agent Guard', subtitle: 'Runtime protection: what your agents tried to do, and what was blocked or approved.', docsHref: '/developers#guard' },
  github: { title: 'Repos & PR checks', subtitle: 'Scan every pull request on GitHub, GitLab and Bitbucket, and watch each repo’s security score over time.', docsHref: '/developers' },
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
  const [isAdmin, setIsAdmin] = useState(false)
  const billing = useBillingStatusState(user)

  const handleNewReports = useCallback((count: number) => {
    setReportBadge(current => current + count)
  }, [])

  const handleScanComplete = useCallback(() => {
    setRefreshKey(k => k + 1)
    setReportBadge(current => current + 1)
  }, [])

  useEffect(() => {
    if (!loading && !user) router.replace('/login?next=/dashboard')
  }, [loading, user, router])

  // Each section has its own address (?tab=...), so refresh keeps your place and Back works.
  const showTab = useCallback((nextTab: DashboardTab) => {
    setTab(nextTab)
    const url = new URL(window.location.href)
    if (url.searchParams.get('tab') !== nextTab) {
      url.searchParams.set('tab', nextTab)
      window.history.pushState(null, '', url.pathname + url.search)
    }
    window.scrollTo({ top: 0 })
  }, [])

  // The Ask box (Ctrl+K) can switch tabs while the dashboard is open.
  useEffect(() => {
    const onTab = (e: Event) => {
      const next = (e as CustomEvent<DashboardTab>).detail
      if (next && Object.prototype.hasOwnProperty.call(pageCopy, next)) showTab(next)
    }
    // Back / Forward move between dashboard sections instead of leaving the app.
    const onPop = () => {
      const t = new URLSearchParams(window.location.search).get('tab') ?? 'overview'
      setTab(Object.prototype.hasOwnProperty.call(pageCopy, t) ? t as DashboardTab : 'overview')
    }
    window.addEventListener(DASHBOARD_TAB_EVENT, onTab)
    window.addEventListener('popstate', onPop)
    return () => { window.removeEventListener(DASHBOARD_TAB_EVENT, onTab); window.removeEventListener('popstate', onPop) }
  }, [showTab])

  // Shows the Admin link only to the owner (the API answers 404 for everyone else).
  useEffect(() => {
    if (!user) return
    apiCall<{ admin?: boolean }>(user, '/v1/admin/me').then(r => setIsAdmin(r.admin === true)).catch(() => setIsAdmin(false))
  }, [user])

  useEffect(() => {
    if (!user || typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.has('slack_link')) setTab('integrations')
    const requested = params.get('tab')
    if (requested && Object.prototype.hasOwnProperty.call(pageCopy, requested)) setTab(requested as DashboardTab)
    if (params.get('tab') === 'github' || params.has('github_installation') || (params.has('code') && params.has('state'))) setTab('github')
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
          <div style={{ borderColor: 'var(--border)', borderTopColor: '#7C3AED' }} className="mx-auto mb-4 h-6 w-6 animate-spin rounded-full border-2" />
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Loading workspace</p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">Preparing your scanner and reports.</p>
        </div>
      </div>
    )
  }

  const changeTab = (nextTab: DashboardTab) => {
    if (nextTab === 'reports') setReportBadge(0)
    showTab(nextTab)
    setMenuOpen(false)
  }

  const goToAgent = (slug: string) => router.push(`/dashboard/agent?name=${encodeURIComponent(slug)}`)

  // Entitlement, not the raw Stripe status: `isActivePro` covers active AND trialing (both grant
  // Pro access) and stays true through cancelAtPeriodEnd — the sidebar must never say Free before
  // the subscription's current period actually ends. See lib/billing.ts's summarizeBillingState,
  // the single shared interpretation of plan/status/cancelAtPeriodEnd used by Pricing, Settings,
  // and here so none of them can drift out of sync with what the backend actually says.
  const billingSummary = summarizeBillingState(billing.status)
  const planLabel = billing.error
    ? 'Free'
    : billingSummary.isActivePro
      ? billingSummary.isCanceling && billing.status.currentPeriodEnd ? `Pro · ends ${new Date(billing.status.currentPeriodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Pro'
      : billing.status.status === 'past_due'
        ? 'Past due'
        : billing.status.status === 'canceled'
          ? 'Canceled'
          : 'Free'

  return (
    <div style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen">
      <div className="hidden md:block">
        <Sidebar active={tab} onChange={changeTab} reportBadge={reportBadge} planLabel={planLabel} isAdmin={isAdmin} />
      </div>
      <MobileNavDrawer open={menuOpen} onClose={() => setMenuOpen(false)} active={tab} onChange={changeTab} reportBadge={reportBadge} planLabel={planLabel} />
      <main className="min-h-screen pb-20 md:ml-60 md:pb-0 2xl:ml-64">
        <header style={{ backgroundColor: 'var(--nav-bg)', borderBottom: '1px solid var(--border)' }} className="no-print sticky top-0 z-30 hidden h-14 items-center gap-4 px-8 backdrop-blur-xl md:flex">
          <p style={{ color: 'var(--text-muted)' }} className="hidden whitespace-nowrap text-sm lg:block">Dashboard / <span style={{ color: 'var(--text-primary)' }} className="font-semibold">{pageCopy[tab].title}</span></p>
          <button
            onClick={() => openAsk()}
            style={{ border: '1px solid var(--border-light)', backgroundColor: 'var(--surface)', color: 'var(--text-muted)' }}
            className="mx-auto flex w-full max-w-xl items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors hover:border-[#7C3AED]"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2" aria-hidden="true"><path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z" /></svg>
            <span className="flex-1 truncate">Ask anything or search your findings, repos and docs…</span>
            <span className="av-kbd">Ctrl K</span>
          </button>
          <button onClick={openFeedback} style={{ border: '1px solid var(--border-light)', color: 'var(--text-secondary)' }} className="shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:text-[var(--text-primary)]">Feedback</button>
          <button onClick={() => changeTab('scan')} className="shrink-0 rounded-md bg-[#7C3AED] px-3.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#6D28D9]">New scan</button>
        </header>
        <OnboardingProfile user={user} />
        <FeedbackDialog user={user} />
        <div className="w-full max-w-[1600px] px-4 py-5 md:px-8 md:py-7">
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
            <SectionErrorBoundary label={pageCopy[tab].title}>
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
            {tab === 'workspace' && <Workspace user={user} onNavigate={changeTab} />}
            {tab === 'billing' && <Billing user={user} />}
            {tab === 'integrations' && <Integrations user={user} />}
            {tab === 'github' && <GithubMonitoring user={user} />}
            {tab === 'guard' && <AgentGuard user={user} />}
            {tab === 'redteam' && <InjectionTests user={user} isPro={summarizeBillingState(billing.status).isActivePro} />}
            {tab === 'api' && <APIAccess />}
            {tab === 'settings' && <Settings onNavigate={changeTab} />}
            </SectionErrorBoundary>
          </div>
        </div>
      </main>
      <BottomNav active={tab} onChange={changeTab} reportBadge={reportBadge} onOpenMenu={() => setMenuOpen(true)} />
    </div>
  )
}
