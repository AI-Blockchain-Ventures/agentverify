import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata('/pricing', 'Pricing', 'Agent Verify pricing: free AI agent security scans, Pro at $19.99/month with step-by-step fixes and corrected code, and Team plans for organizations.')

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
