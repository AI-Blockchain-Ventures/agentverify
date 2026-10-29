import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata('/privacy', 'Privacy Policy', 'How Agent Verify handles the agent code you scan, your account data, and analytics.')

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
