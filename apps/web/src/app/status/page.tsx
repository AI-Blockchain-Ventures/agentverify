import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { StatusBoard } from './StatusBoard'

export const metadata: Metadata = pageMetadata('/status/', 'System status', 'Live status of the Agent Verify website and API.')

export default function StatusPage() {
  return (
    <main style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen">
      <div className="av-container max-w-3xl py-14 md:py-20">
        <h1 style={{ color: 'var(--text-primary)' }} className="text-3xl font-bold tracking-tight">System status</h1>
        <p style={{ color: 'var(--text-secondary)' }} className="mt-2 text-base">Checked live from your browser each time you open this page.</p>
        <StatusBoard />
      </div>
    </main>
  )
}
