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
    features: ['10 scans/month', 'All 124 security checks', 'Verdict, security score, and findings', 'GitHub PR bot + repo monitoring (50 scans/month)', 'VS Code + Claude Code / Cursor (MCP)', 'CLI + GitHub Action', 'Private report history'],
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
    features: ['Everything in Free', '100 scans/month + 1,000 PR scans', 'Fixes + one-click PR suggestions', 'Prompt-injection tests on your agent', 'Compliance evidence pack + PDF reports'],
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
    features: ['Pro features for every member', '300 scans per person each month', 'Add and remove teammates yourself', 'Shared workspace with roles and team API keys', 'Audit log of security actions', 'Priority support'],
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
