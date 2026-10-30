import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata('/terms', 'Terms of Service', 'The terms for using Agent Verify, the AI agent security scanner by AI Blockchain Ventures LLC.')

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
