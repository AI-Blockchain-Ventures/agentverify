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
  features: {
    fullRemediation: boolean
    correctedSnippets: boolean
    a2spaGuidance: boolean
    pdfExport: boolean
    reportSharing: boolean
  }
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

export const freeBillingStatus: BillingStatus = {
  plan: 'free',
  status: 'free',
  scanQuota: 10,
  features: {
    fullRemediation: false,
    correctedSnippets: false,
    a2spaGuidance: false,
    pdfExport: false,
    reportSharing: false,
  },
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
}

export const proBillingStatus: BillingStatus = {
  plan: 'pro',
  status: 'active',
  scanQuota: 100,
  features: {
    fullRemediation: true,
    correctedSnippets: true,
    a2spaGuidance: true,
    pdfExport: true,
    reportSharing: true,
  },
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
}

export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_AGENTVERIFY_API_URL ?? 'https://agentverify-api.agentverify.workers.dev'
}

export function isCheckoutEnabled(plan: PlanId): boolean {
  return plan === 'pro' && process.env.NEXT_PUBLIC_BILLING_CHECKOUT_ENABLED === 'true'
}

export function getSalesUrl(plan: PlanId): string {
  const subject = plan === 'enterprise' ? 'Agent Verify Enterprise' : `Agent Verify ${plan.toUpperCase()}`
  return `mailto:hello@aiblockchainventures.com?subject=${encodeURIComponent(subject)}`
}

export function getPlanAction(plan: PlanId): { href: string; label: string; disabled?: boolean } {
  if (plan === 'free') return { href: '/dashboard', label: 'Start free' }
  if (plan === 'team') return { href: getSalesUrl('team'), label: 'Join waitlist', disabled: true }
  if (plan === 'enterprise') return { href: getSalesUrl('enterprise'), label: 'Contact us' }
  if (isCheckoutEnabled(plan)) return { href: `${getApiBaseUrl()}${billingRoutes.checkout}`, label: 'Start Pro checkout' }
  return { href: getSalesUrl('pro'), label: 'Request Pro access' }
}

export function canUseProFeature(status: BillingStatus, feature: keyof BillingStatus['features']): boolean {
  return status.plan === 'pro' && status.features[feature] === true
}
