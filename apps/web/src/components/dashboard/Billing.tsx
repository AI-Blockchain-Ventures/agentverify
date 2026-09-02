'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { User } from 'firebase/auth'
import { useBillingStatusState } from '@/lib/useBillingStatus'
import { openBillingPortal, summarizeBillingState } from '@/lib/billing'

/**
 * The in-app-shell Billing/Plan destination. Previously the sidebar's "Billing / Plan" item and
 * Settings' "Billing / Plan →" card both linked straight to the public marketing `/pricing` page
 * — a real page navigation that drops the authenticated user out of the dashboard entirely (no
 * Sidebar, no app shell), which reads as broken even though nothing actually errored. Fixed by
 * giving Billing the same "own dedicated destination" treatment Workspace/API/Integrations already
 * have (see Settings.tsx's own doc comment) — this tab, not an external link, is the target now.
 *
 * The ONE navigation this component still performs on its own is the real Stripe Customer Portal
 * redirect from "Manage billing" — that's an intentional, explicit action, not an accidental
 * default click, so it's expected (and fine) to leave the app shell.
 */
export function Billing({ user }: { user: User }) {
  const billing = useBillingStatusState(user)
  const billingState = summarizeBillingState(billing.status)
  const [portalBusy, setPortalBusy] = useState(false)
  const [portalMessage, setPortalMessage] = useState<{ text: string; reviewMode?: boolean } | null>(null)

  const planLabel = billingState.isActivePro
    ? billingState.isCanceling
      ? billingState.periodEndDate
        ? `Pro — cancels ${billingState.periodEndDate}`
        : 'Pro — canceling'
      : 'Pro — active'
    : billing.status.status === 'past_due'
      ? 'Past due'
      : billing.status.status === 'canceled'
        ? 'Canceled'
        : 'Free'

  const manageBilling = async () => {
    if (!user) return
    setPortalBusy(true)
    setPortalMessage(null)
    const result = await openBillingPortal(() => user.getIdToken())
    if (!result.ok) setPortalMessage({ text: result.message, reviewMode: result.reviewMode })
    setPortalBusy(false)
  }

  const features: Array<[keyof typeof billing.status.features, string]> = [
    ['fullRemediation', 'Full remediation guidance'],
    ['correctedSnippets', 'Corrected code snippets'],
    ['a2spaGuidance', 'A2SPA implementation guidance'],
    ['pdfExport', 'PDF export'],
  ]

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-6 shadow-xl shadow-black/5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold uppercase tracking-wider">Current plan</p>
            <p style={{ color: 'var(--text-primary)' }} className="mt-1 text-2xl font-semibold">{billing.loading ? 'Loading…' : planLabel}</p>
          </div>
          {billingState.isActivePro ? (
            <button onClick={manageBilling} disabled={portalBusy} className="av-press shrink-0 rounded-xl bg-[#7C3AED] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50">
              {portalBusy ? 'Opening…' : 'Manage billing →'}
            </button>
          ) : (
            <Link href="/pricing" className="av-press shrink-0 rounded-xl bg-[#7C3AED] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90">
              Upgrade to Pro →
            </Link>
          )}
        </div>
        {billingState.isActivePro && (
          <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">
            {billingState.isCanceling
              ? billingState.periodEndDate
                ? `Your Pro plan remains active until ${billingState.periodEndDate}. Update payment method or resume — through Stripe's secure billing portal.`
                : "Your Pro plan is canceling at the end of the current billing period. Update payment method or resume — through Stripe's secure billing portal."
              : "Update payment method, view invoices, or cancel — through Stripe's secure billing portal."}
          </p>
        )}
        {portalMessage && (
          <p className="mt-3 text-xs" style={{ color: portalMessage.reviewMode ? 'var(--text-muted)' : 'var(--accent-orange-text)' }}>
            {portalMessage.text}
          </p>
        )}
        {billing.error && (
          <p className="mt-3 text-xs" style={{ color: 'var(--accent-orange-text)' }}>
            Billing status could not be loaded, so Pro features are safely treated as Free. Try refreshing shortly.
          </p>
        )}
      </section>

      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-6 shadow-xl shadow-black/5">
        <h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold uppercase tracking-wider">Scan usage this period</h2>
        <div className="mt-3 flex items-center justify-between">
          <p style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">
            {billing.loading ? '—' : `${billing.status.used} / ${billing.status.scanQuota}`}
          </p>
          <p style={{ color: 'var(--text-muted)' }} className="text-xs">scans used</p>
        </div>
        <div style={{ backgroundColor: 'var(--surface)' }} className="mt-2 h-1.5 w-full overflow-hidden rounded-full">
          <div
            style={{ backgroundColor: '#7C3AED', width: `${billing.loading || billing.status.scanQuota === 0 ? 0 : Math.min(100, (billing.status.used / billing.status.scanQuota) * 100)}%` }}
            className="h-full rounded-full transition-all"
          />
        </div>
      </section>

      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-6 shadow-xl shadow-black/5">
        <h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold uppercase tracking-wider">Plan features</h2>
        <ul className="mt-3 space-y-2">
          {features.map(([key, label]) => (
            <li key={key} className="flex items-center gap-2 text-sm">
              <span style={{ color: billing.status.features[key] ? 'var(--accent-green-text)' : 'var(--text-muted)' }} aria-hidden="true">
                {billing.status.features[key] ? '✓' : '—'}
              </span>
              <span style={{ color: billing.status.features[key] ? 'var(--text-primary)' : 'var(--text-muted)' }}>{label}</span>
            </li>
          ))}
        </ul>
        {!billingState.isActivePro && (
          <Link href="/pricing" className="mt-4 inline-block text-xs font-semibold text-[color:var(--accent-purple-text)] hover:underline">
            Compare plans →
          </Link>
        )}
      </section>
    </div>
  )
}
