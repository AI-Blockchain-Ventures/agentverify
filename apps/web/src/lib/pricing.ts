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
    description: 'Try every check on your agent and see exactly what is wrong.',
    limits: '10 scans/month',
    features: ['10 scans/month', 'All 76 security checks', 'Verdict, security score, and findings', 'GitHub repo, .zip, and MCP config scans', 'CLI + GitHub Action', 'Private report history'],
    unavailable: ['Step-by-step fix guidance', 'Corrected code for each finding', 'A2SPA implementation guidance', 'PDF export for clients and auditors'],
    cta: 'Start free',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$19.99',
    period: '/month',
    description: 'Fix what the scan finds — with the corrected code — and prove it with a report.',
    limits: '100 scans/month',
    features: ['Everything in Free', '100 scans/month — scan on every change', 'Step-by-step fix guidance', 'Corrected code for each finding', 'A2SPA implementation guidance', 'PDF export for clients and auditors'],
    cta: 'Upgrade to Pro',
    highlighted: true,
  },
  {
    id: 'team',
    name: 'Team',
    price: '$79',
    period: '/month',
    description: 'For teams shipping several agents who want one shared place to review them.',
    limits: 'Set up with our team',
    features: ['Pro features for every member', 'Shared workspace with roles (Owner, Admin, Member, Viewer)', 'Team API keys for CLI and CI', 'Audit log of security actions', 'Onboarding call + priority support'],
    cta: 'Talk to us',
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
