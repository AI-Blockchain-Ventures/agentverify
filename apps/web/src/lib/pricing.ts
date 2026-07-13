export type PlanId = 'free' | 'pro' | 'team' | 'enterprise'

export interface Plan {
  id: PlanId
  name: string
  price: string
  period?: string
  description: string
  features: string[]
  limits?: string
  unavailable?: string[]
  cta: string
  highlighted?: boolean
  comingSoon?: boolean
}

export const freeScanLimit = 10
export const proScanLimit = 100

export const plans: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: '/month',
    description: 'Validate early agent configs and catch obvious deployment risks.',
    limits: '10 scans/month',
    features: ['10 scans/month', 'Basic findings', 'Verdict and risk score', 'Private report history'],
    unavailable: ['Full remediation guidance', 'Corrected code snippets', 'A2SPA implementation guidance', 'PDF export', 'Shareable reports'],
    cta: 'Start free',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$19.99',
    period: '/month',
    description: 'For builders who need remediation-ready reports and stakeholder-ready exports.',
    limits: '100 scans/month',
    features: ['100 scans/month', 'Full remediation guidance', 'Corrected code snippets', 'A2SPA implementation guidance', 'PDF export', 'Shareable reports'],
    cta: 'Upgrade to Pro',
    highlighted: true,
  },
  {
    id: 'team',
    name: 'Team',
    price: '$79',
    period: '/month',
    description: 'Coming soon for teams that need coordinated security review workflows.',
    limits: 'Coming soon',
    features: ['Planned team review flow', 'Planned shared report queue', 'Planned team API controls', 'Planned usage visibility', 'Priority support'],
    cta: 'Join waitlist',
    comingSoon: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Contact us',
    description: 'For regulated teams and private agent security programs.',
    features: ['White label', 'SLA', 'Dedicated support', 'Private deployment', 'Custom controls'],
    cta: 'Contact sales',
  },
]
