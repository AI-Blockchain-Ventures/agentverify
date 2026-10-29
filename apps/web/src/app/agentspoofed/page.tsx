import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { AgentSpoofedPage } from '@/components/spoof/AgentSpoofedPage'

export const metadata: Metadata = pageMetadata('/agentspoofed', 'Live Demo: Agent Spoofing', 'Run a live scan against a rogue-agent-onboarding sample using the real Agent Verify scan engine, and see the identity-spoofing and supply-chain findings it produces.')

export default function Page() {
  return <AgentSpoofedPage />
}
