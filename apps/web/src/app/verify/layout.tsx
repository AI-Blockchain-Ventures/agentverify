import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata('/verify', 'Verify a Report', 'Check that an Agent Verify report is authentic: confirm its verdict, integrity hash, and signature.')

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
