import type { Metadata } from 'next'
import { AgentSpoofedPage } from '@/components/spoof/AgentSpoofedPage'

export const metadata: Metadata = {
  title: 'Live Demo: Agent Spoofing',
  description: 'Run a live scan against a rogue-agent-onboarding sample using the real Agent Verify scan engine, and see the identity-spoofing and supply-chain findings it produces.',
}

export default function Page() {
  return <AgentSpoofedPage />
}
