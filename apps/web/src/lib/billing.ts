import type { PlanId } from './pricing'

export const billingRoutes = {
  checkout: '/v1/billing/checkout',
  portal: '/v1/billing/portal',
  webhook: '/v1/billing/webhook',
  status: '/v1/billing/status',
} as const

export type BillingPlan = 'free' | 'pro'

export interface BillingStatus {
  plan: BillingPlan
  status: string
  scanQuota: number
  /** Real scans used this calendar month, from the SAME server-side usage_monthly ledger
   * /v1/scan enforces against — never a client-only counter. See useBillingStatus.ts. */
  used: number
  features: {
    fullRemediation: boolean
    correctedSnippets: boolean
    a2spaGuidance: boolean
    pdfExport: boolean
  }
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

export const freeBillingStatus: BillingStatus = {
  plan: 'free',
  status: 'free',
  scanQuota: 10,
  used: 0,
  features: {
    fullRemediation: false,
    correctedSnippets: false,
    a2spaGuidance: false,
    pdfExport: false,
  },
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
}

export const proBillingStatus: BillingStatus = {
  plan: 'pro',
  status: 'active',
  scanQuota: 100,
  used: 0,
  features: {
    fullRemediation: true,
    correctedSnippets: true,
    a2spaGuidance: true,
    pdfExport: true,
  },
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
}

export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_AGENTVERIFY_API_URL ?? 'https://agentverify-api.agentverify.workers.dev'
}

export function getSalesUrl(plan: PlanId): string {
  const subject = plan === 'enterprise' ? 'Agent Verify Enterprise' : `Agent Verify ${plan.toUpperCase()}`
  return `mailto:hello@aiblockchainventures.com?subject=${encodeURIComponent(subject)}`
}

/**
 * Pro checkout is unconditionally live (backed by the real, quota-enforced Worker checkout route
 * — see workers/api/src/billing.ts's handleCheckout) — there is no longer a rollout flag gating
 * it. The Pricing page's own Pro card drives checkout/portal directly (see
 * apps/web/src/app/pricing/page.tsx) rather than through this helper; it stays here for Free/
 * Team/Enterprise callers and any future caller that needs a plain link for Pro too.
 */
export function getPlanAction(plan: PlanId): { href: string; label: string; disabled?: boolean } {
  if (plan === 'free') return { href: '/dashboard', label: 'Start free' }
  if (plan === 'team') return { href: getSalesUrl('team'), label: 'Join waitlist', disabled: true }
  if (plan === 'enterprise') return { href: getSalesUrl('enterprise'), label: 'Contact us' }
  return { href: `${getApiBaseUrl()}${billingRoutes.checkout}`, label: 'Start Pro checkout' }
}

export function canUseProFeature(status: BillingStatus, feature: keyof BillingStatus['features']): boolean {
  return status.plan === 'pro' && status.features[feature] === true
}

/** `en-US` long-form date for a billing period boundary, e.g. "October 1, 2026". Shared so every
 * surface that shows a cancellation date formats it identically. Returns null for a missing/
 * unparseable value so callers can fall back cleanly instead of rendering "Invalid Date". */
export function formatPeriodEndDate(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export interface BillingStateSummary {
  /** True while entitlement is Pro — active or trialing — regardless of cancelAtPeriodEnd. Stripe
   * keeps a canceled-at-period-end subscription's access live until currentPeriodEnd, so this is
   * never derived from cancelAtPeriodEnd alone. */
  isActivePro: boolean
  isCanceling: boolean
  periodEndDate: string | null
}

/**
 * Single, canonical interpretation of the raw billing-status fields (plan/status/
 * cancelAtPeriodEnd/currentPeriodEnd) — computed once here so Pricing, Settings, and the
 * dashboard sidebar never each re-derive their own version of "is this user really Pro" and risk
 * drifting out of sync (e.g. one surface prematurely showing Free the moment cancelAtPeriodEnd
 * flips true, while another still correctly shows Pro). Each surface renders its own copy/layout
 * from this — only the plan/status interpretation is shared, not presentation.
 */
export function summarizeBillingState(status: BillingStatus): BillingStateSummary {
  const isActivePro = status.plan === 'pro' && (status.status === 'active' || status.status === 'trialing')
  return {
    isActivePro,
    isCanceling: isActivePro && status.cancelAtPeriodEnd === true,
    periodEndDate: isActivePro ? formatPeriodEndDate(status.currentPeriodEnd) : null,
  }
}

export interface OpenBillingPortalResult {
  ok: boolean
  /** Set when the Worker distinguishes "this is npm run review, not a real outage" — see
   * workers/api/src/billing.ts's notConfiguredResponse(). Lets the UI show a neutral notice
   * instead of an alarming "something is broken" error in the local review environment. */
  reviewMode?: boolean
  message: string
}

/**
 * Opens the real Stripe Billing Portal for the signed-in user (server resolves the Stripe
 * customer from their authenticated uid — never from anything the client sends). Redirects the
 * browser on success; returns a result the caller can render on failure instead of redirecting.
 */
export async function openBillingPortal(getIdToken: () => Promise<string>): Promise<OpenBillingPortalResult> {
  try {
    const res = await fetch(`${getApiBaseUrl()}${billingRoutes.portal}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await getIdToken()}` },
    })
    const data = await res.json().catch(() => ({})) as { url?: string; error?: string; reviewMode?: boolean }
    if (res.ok && data.url) {
      window.location.href = data.url
      return { ok: true, message: 'Opening billing portal…' }
    }
    if (res.status === 404) return { ok: false, message: 'No billing account found yet — upgrade to Pro first.' }
    if (res.status === 401) return { ok: false, message: 'Sign in again to manage billing.' }
    return { ok: false, reviewMode: data.reviewMode === true, message: data.error ?? 'Could not open the billing portal. Please retry.' }
  } catch {
    return { ok: false, message: 'Network error while opening the billing portal. Please retry.' }
  }
}
