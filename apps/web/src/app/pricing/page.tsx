'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/components/auth/AuthProvider'
import { AuthModal } from '@/components/auth/AuthModal'
import { plans } from '@/lib/pricing'
import { billingRoutes, getApiBaseUrl, getPlanAction } from '@/lib/billing'

export default function PricingPage() {
  const { user } = useAuth()
  const [message, setMessage] = useState<string | null>(null)
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [pendingCheckout, setPendingCheckout] = useState(false)

  const startProCheckout = useCallback(async () => {
    if (!user) {
      setPendingCheckout(true)
      setAuthOpen(true)
      setMessage('Sign in to start Pro checkout. We will continue checkout after sign-in.')
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
      const data = await res.json().catch(() => ({})) as { url?: string; error?: string }
      if (res.status === 401) {
        setMessage('Sign in again to start Pro checkout.')
        return
      }
      if (res.status === 400 || res.status === 403) {
        setMessage('This plan is not available for checkout. Team is coming soon and Enterprise is contact-only.')
        return
      }
      if (res.status === 503) {
        setMessage('Billing is temporarily unavailable. Try again in a few minutes.')
        return
      }
      if (!res.ok || !data.url) {
        setMessage(data.error ?? 'Checkout could not be started. Please retry.')
        return
      }
      window.location.href = data.url
    } catch {
      setMessage('Network error while starting checkout. Please retry.')
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
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-[#00C4CC]">Pricing</p>
          <h1 style={{ color: 'var(--text-primary)' }} className="text-4xl font-semibold tracking-tight md:text-6xl">Simple plans for safer agent releases.</h1>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-5 text-base leading-7 md:text-lg">Start with basic findings. Upgrade when you need full remediation, corrected code, A2SPA guidance, PDF export, and shareable reports.</p>
        </div>

        <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="mx-auto mt-8 max-w-3xl rounded-3xl p-5 text-center shadow-xl shadow-black/5">
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Billing status</p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">Pro checkout is connected to the secure billing API for Stripe test-mode validation. Team remains coming soon and Enterprise is contact-only.</p>
          {message && <p className="mt-3 text-sm text-[#E07B39]">{message}</p>}
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-4">
          {plans.map(plan => {
            const action = getPlanAction(plan.id)
            return (
              <article
                key={plan.id}
                style={{ backgroundColor: 'var(--card)', border: plan.highlighted ? '1px solid #00C4CC' : '1px solid var(--border)' }}
                className={`relative flex rounded-3xl p-6 shadow-2xl shadow-black/5 backdrop-blur ${plan.highlighted ? 'lg:-mt-4 lg:mb-4' : ''}`}
              >
                {plan.highlighted && <div className="absolute right-4 top-4 rounded-full bg-[#00C4CC]/10 px-3 py-1 text-xs font-semibold text-[#00C4CC]">Best value</div>}
                {plan.comingSoon && <div className="absolute right-4 top-4 rounded-full bg-[#E07B39]/10 px-3 py-1 text-xs font-semibold text-[#E07B39]">Coming soon</div>}
                <div className="flex w-full flex-col">
                  <h2 style={{ color: 'var(--text-primary)' }} className="text-xl font-semibold">{plan.name}</h2>
                  <p style={{ color: 'var(--text-muted)' }} className="mt-2 min-h-12 text-sm leading-6">{plan.description}</p>
                  <div className="mt-6 flex items-end gap-1">
                    <span style={{ color: 'var(--text-primary)' }} className="text-4xl font-bold">{plan.price}</span>
                    {plan.period && <span style={{ color: 'var(--text-muted)' }} className="pb-1 text-sm">{plan.period}</span>}
                  </div>
                  {plan.limits && <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#00C4CC]">{plan.limits}</p>}
                  <ul className="mt-6 space-y-3">
                    {plan.features.map(feature => (
                      <li key={feature} style={{ color: 'var(--text-secondary)' }} className="flex gap-2 text-sm"><span className="text-[#00B37E]">✓</span>{feature}</li>
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
                  {plan.id === 'pro' ? (
                    <button onClick={startProCheckout} disabled={checkoutLoading} className="mt-8 block w-full rounded-2xl bg-[#00C4CC] px-4 py-3 text-center text-sm font-semibold text-[#060A0F] transition-opacity hover:opacity-85 disabled:opacity-60">
                      {checkoutLoading ? 'Starting checkout...' : user ? 'Start Pro Checkout' : 'Sign in to start Pro'}
                    </button>
                  ) : (
                    <Link
                      href={action.href}
                      aria-disabled={action.disabled === true}
                      className={`mt-8 block rounded-2xl px-4 py-3 text-center text-sm font-semibold transition-opacity hover:opacity-85 ${action.disabled ? 'cursor-not-allowed opacity-70' : ''} ${plan.highlighted ? 'bg-[#00C4CC] text-[#060A0F]' : 'border border-[var(--border)] text-[var(--text-primary)]'}`}
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
          <p style={{ color: 'var(--text-muted)' }} className="mx-auto mt-2 max-w-2xl text-sm leading-6">Free includes 10 scans/month and basic findings. Pro adds 100 scans/month, full remediation, corrected code, A2SPA guidance, PDF export, and shareable reports.</p>
        </div>
      </section>
      <AuthModal open={authOpen} defaultMode="signIn" onClose={() => setAuthOpen(false)} />
    </main>
  )
}
