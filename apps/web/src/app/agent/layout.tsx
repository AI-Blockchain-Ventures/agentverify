import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata('/agent', 'Verified Agent Profile', 'Independent security evidence for an AI agent: its latest security scan, prompt-injection test results, and runtime protection, signed by Agent Verify.')

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
