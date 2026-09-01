'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/components/auth/AuthProvider'
import { AuthModal } from '@/components/auth/AuthModal'
import { plans } from '@/lib/pricing'
import { billingRoutes, getApiBaseUrl, getPlanAction, openBillingPortal, summarizeBillingState } from '@/lib/billing'
import { useBillingStatusState } from '@/lib/useBillingStatus'

export default function PricingPage() {
  const { user } = useAuth()
  const billing = useBillingStatusState(user)
  const billingState = summarizeBillingState(billing.status)
  const [message, setMessage] = useState<{ text: string; reviewMode?: boolean } | null>(null)
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [pendingCheckout, setPendingCheckout] = useState(false)

  const manageBilling = useCallback(async () => {
    if (!user) return
    setPortalLoading(true)
    setMessage(null)
    const result = await openBillingPortal(() => user.getIdToken())
    if (!result.ok) setMessage({ text: result.message, reviewMode: result.reviewMode })
    setPortalLoading(false)
  }, [user])

  const startProCheckout = useCallback(async () => {
    if (!user) {
      setPendingCheckout(true)
      setAuthOpen(true)
      setMessage({ text: 'Sign in to start Pro checkout. We will continue checkout after sign-in.' })
      return
    }
    setCheckoutLoading(true)
    setMessage(null)
    try {
      const res = await fetch(`${getApiBaseUrl()}${billingRoutes.checkout}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await user.getIdToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ plan: 'pro' }),
      })
      const data = await res.json().catch(() => ({})) as { url?: string; error?: string; reviewMode?: boolean }
      if (res.status === 401) {
        setMessage({ text: 'Sign in again to start Pro checkout.' })
        return
      }
      if (res.status === 400 || res.status === 403) {
        setMessage({ text: 'This plan is not available for checkout. Team is coming soon and Enterprise is contact-only.' })
        return
      }
      if (res.status === 503) {
        // The Worker distinguishes "npm run review has no Stripe test config" from a real
        // production outage (see workers/api/src/billing.ts's notConfiguredResponse) — show
        // whichever message it actually sent rather than a generic one that reads as broken.
        setMessage({ text: data.error ?? 'Billing is temporarily unavailable. Try again in a few minutes.', reviewMode: data.reviewMode === true })
        return
      }
      if (!res.ok || !data.url) {
        setMessage({ text: data.error ?? 'Checkout could not be started. Please retry.' })
        return
      }
      window.location.href = data.url
    } catch {
      setMessage({ text: 'Network error while starting checkout. Please retry.' })
    } finally {
      setCheckoutLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (!user || !pendingCheckout || checkoutLoading) return
    setAuthOpen(false)
    setPendingCheckout(false)
    void startProCheckout()
  }, [checkoutLoading, pendingCheckout, startProCheckout, user])

  return (
    <main style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen px-4 py-16 md:px-6 md:py-20">
      <section className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-[color:var(--accent-cyan-text)]">Pricing</p>
          <h1 style={{ color: 'var(--text-primary)' }} className="text-4xl font-semibold tracking-tight md:text-6xl">Simple plans for safer agent releases.</h1>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-5 text-base leading-7 md:text-lg">Start with basic findings. Upgrade when you need full remediation, corrected code, A2SPA guidance, and PDF export.</p>
        </div>

        <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="mx-auto mt-8 max-w-3xl rounded-3xl p-5 text-center shadow-xl shadow-black/5">
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Billing status</p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">Pro checkout runs through Stripe. Team is coming soon; Enterprise is contact-only.</p>
          {message && (
            <p className="mt-3 text-sm" style={{ color: message.reviewMode ? 'var(--text-muted)' : 'var(--accent-orange-text)' }}>
              {message.text}
            </p>
          )}
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-4">
          {plans.map(plan => {
            const action = getPlanAction(plan.id)
            return (
              <article
                key={plan.id}
                style={{ backgroundColor: 'var(--card)', border: plan.highlighted ? '1px solid #06B6D4' : '1px solid var(--border)' }}
                className={`relative flex rounded-3xl p-6 shadow-2xl shadow-black/5 backdrop-blur ${plan.highlighted ? 'lg:-mt-4 lg:mb-4' : ''}`}
              >
                {plan.highlighted && <div className="absolute right-4 top-4 rounded-full bg-[#06B6D4]/10 px-3 py-1 text-xs font-semibold text-[color:var(--accent-cyan-text)]">Best value</div>}
                {plan.comingSoon && <div className="absolute right-4 top-4 rounded-full bg-[#E07B39]/10 px-3 py-1 text-xs font-semibold text-[color:var(--accent-orange-text)]">Coming soon</div>}
                <div className="flex w-full flex-col">
                  <h2 style={{ color: 'var(--text-primary)' }} className="text-xl font-semibold">{plan.name}</h2>
                  <p style={{ color: 'var(--text-muted)' }} className="mt-2 min-h-12 text-sm leading-6">{plan.description}</p>
                  <div className="mt-6 flex items-end gap-1">
                    <span style={{ color: 'var(--text-primary)' }} className="text-4xl font-bold">{plan.price}</span>
                    {plan.period && <span style={{ color: 'var(--text-muted)' }} className="pb-1 text-sm">{plan.period}</span>}
                  </div>
                  {plan.limits && <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-cyan-text)]">{plan.limits}</p>}
                  <ul className="mt-6 space-y-3">
                    {plan.features.map(feature => (
                      <li key={feature} style={{ color: 'var(--text-secondary)' }} className="flex gap-2 text-sm"><span className="text-[color:var(--accent-green-text)]">✓</span>{feature}</li>
                    ))}
                  </ul>
                  {plan.unavailable && (
                    <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                      <p style={{ color: 'var(--text-primary)' }} className="mb-2 text-xs font-semibold">Free does not include</p>
                      <ul className="space-y-1.5">
                        {plan.unavailable.map(item => <li key={item} style={{ color: 'var(--text-muted)' }} className="text-xs">- {item}</li>)}
                      </ul>
                    </div>
                  )}
                  {plan.id === 'pro' && user && billing.loading ? (
                    <div className="mt-8 rounded-2xl border px-4 py-3 text-center text-sm font-semibold opacity-60" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                      Checking your plan…
                    </div>
                  ) : plan.id === 'pro' && user && billingState.isActivePro ? (
                    <div className="mt-8">
                      <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-2xl p-3.5 text-center">
                        <p style={{ color: 'var(--text-muted)' }} className="text-[10px] font-semibold uppercase tracking-[0.18em]">Current Plan</p>
                        <p style={{ color: 'var(--text-primary)' }} className="mt-0.5 text-sm font-bold uppercase tracking-wide">Pro</p>
                        {billingState.isCanceling && (
                          <p style={{ color: 'var(--accent-orange-text)' }} className="mt-2 text-xs font-medium">
                            {billingState.periodEndDate
                              ? `Your Pro plan remains active until ${billingState.periodEndDate}.`
                              : 'Your Pro plan is canceling at the end of the current billing period.'}
                          </p>
                        )}
                      </div>
                      <button onClick={manageBilling} disabled={portalLoading} className="mt-3 block w-full rounded-2xl border px-4 py-3 text-center text-sm font-semibold transition-opacity hover:opacity-85 disabled:opacity-60" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                        {portalLoading ? 'Opening…' : 'Manage Billing'}
                      </button>
                    </div>
                  ) : plan.id === 'pro' ? (
                    <button onClick={startProCheckout} disabled={checkoutLoading} className="mt-8 block w-full rounded-2xl bg-[#06B6D4] px-4 py-3 text-center text-sm font-semibold text-[#060A0F] transition-opacity hover:opacity-85 disabled:opacity-60">
                      {checkoutLoading ? 'Starting checkout...' : user ? 'Start Pro Checkout' : 'Sign in to start Pro'}
                    </button>
                  ) : (
                    <Link
                      href={action.href}
                      aria-disabled={action.disabled === true}
                      className={`mt-8 block rounded-2xl px-4 py-3 text-center text-sm font-semibold transition-opacity hover:opacity-85 ${action.disabled ? 'cursor-not-allowed opacity-70' : ''} ${plan.highlighted ? 'bg-[#06B6D4] text-[#060A0F]' : 'border border-[var(--border)] text-[var(--text-primary)]'}`}
                    >
                      {action.label}
                    </Link>
                  )}
                </div>
              </article>
            )
          })}
        </div>

        <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="mt-10 rounded-3xl p-6 text-center shadow-xl shadow-black/5">
          <p style={{ color: 'var(--text-primary)' }} className="font-semibold">Pro is for remediation-ready reports</p>
          <p style={{ color: 'var(--text-muted)' }} className="mx-auto mt-2 max-w-2xl text-sm leading-6">Free includes 10 scans/month and basic findings. Pro adds 100 scans/month, full remediation, corrected code, A2SPA guidance, and PDF export.</p>
        </div>
      </section>
      <AuthModal open={authOpen} defaultMode="signIn" onClose={() => setAuthOpen(false)} />
    </main>
  )
}
