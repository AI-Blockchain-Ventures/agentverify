'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { ScanResult as ScanResultType } from '@/types'
import { Footer } from '@/components/layout/Footer'
import { ScanResult } from '@/components/scanner/ScanResult'
import { freeBillingStatus, getApiBaseUrl } from '@/lib/billing'

const rogueOnboarding = {
  fileName: 'agent-marketplace.js',
  description: 'Remote agents/plugins can be onboarded without identity verification.',
  demonstrates: 'Rogue Agent, Identity Spoofing, Supply Chain',
  content: `const agent = { name: 'MarketplaceRunner', tools: ['registerAgent', 'invoke_plugin'], permissions: ['plugins:admin'] }

export async function onboard(remoteAgentUrl) {
  const plugin = await fetch(remoteAgentUrl).then(r => r.text())
  return registerAgent({ source: remoteAgentUrl, code: plugin, trusted: true })
}`,
}

/**
 * Same unauthenticated POST /v1/demo/scan the homepage's PublicScanDemo uses — one reusable
 * Worker route rather than a second copy of scan-calling logic. The proprietary engine never
 * ships to this page's client bundle; see docs/private-scanner-boundary.md.
 */
export function AgentSpoofedPage() {
  const [result, setResult] = useState<ScanResultType | null>(null)
  const [running, setRunning] = useState(false)
  const [events, setEvents] = useState<string[]>([])

  const runScan = async () => {
    setRunning(true)
    setResult(null)
    setEvents(['Loaded Rogue onboarding sample', 'Running the real scanner on Agent Verify’s server'])
    try {
      const res = await fetch(`${getApiBaseUrl()}/v1/demo/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: rogueOnboarding.content, fileName: rogueOnboarding.fileName, platform: 'Agent Marketplace' }),
      })
      const data = await res.json().catch(() => ({})) as ScanResultType & { error?: string }
      if (!res.ok || !data.verdict) {
        setEvents(current => [...current, data.error ?? 'Demo scan failed. Please retry.'])
        return
      }
      setEvents(current => [...current, `Scanner returned ${data.verdict} with ${data.findings.length} finding${data.findings.length === 1 ? '' : 's'}`])
      setResult(data)
    } catch {
      setEvents(current => [...current, 'Network error while scanning. Please retry.'])
    } finally {
      setRunning(false)
    }
  }

  return (
    <main style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen">
      <section className="mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-12">
        <div className="mb-8 flex items-center justify-between gap-4">
          <Link href="/" style={{ color: 'var(--text-secondary)' }} className="text-sm font-medium hover:opacity-75">Agent Verify</Link>
          <Link href="/pricing" className="rounded-2xl bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white hover:opacity-85">View pricing</Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_420px] lg:items-start">
          <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-[2rem] p-5 shadow-2xl shadow-black/10 md:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-purple-text)]">Live demo</p>
            <h1 style={{ color: 'var(--text-primary)' }} className="mt-3 text-4xl font-semibold tracking-tight md:text-6xl">Agent spoofing: rogue onboarding</h1>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-4 max-w-2xl text-base leading-7">This public demo scans the same Rogue onboarding / Identity Spoofing scenario available in the dashboard examples. It runs on Agent Verify&apos;s server and renders the resulting report below.</p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-[color:var(--accent-purple-text)]">
              {rogueOnboarding.demonstrates.split(', ').map(item => <span key={item} className="rounded-full bg-[#7C3AED]/10 px-3 py-1.5">{item}</span>)}
            </div>
            <button onClick={runScan} disabled={running} className="mt-6 rounded-2xl bg-[#7C3AED] px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-85 disabled:opacity-60">
              {running ? 'Scanning...' : 'Run live scan'}
            </button>
          </div>

          <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-[2rem] p-5 shadow-2xl shadow-black/10">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-purple-text)]">Vulnerable sample</p>
            <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-sm">{rogueOnboarding.description}</p>
            <pre style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)' }} className="mt-4 max-h-[420px] overflow-auto rounded-2xl p-4 font-mono text-xs leading-relaxed text-[var(--text-secondary)]">{rogueOnboarding.content}</pre>
          </div>
        </div>

        <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="mt-6 rounded-2xl p-4">
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Scan events</p>
          <div className="mt-3 space-y-2">
            {(events.length ? events : ['Waiting for live scan']).map(event => <p key={event} style={{ color: 'var(--text-muted)' }} className="text-xs">- {event}</p>)}
          </div>
        </div>

        {result && (
          <div className="mt-8">
            <ScanResult result={result} originalContent={rogueOnboarding.content} onNewScan={() => setResult(null)} billingStatus={freeBillingStatus} />
          </div>
        )}
      </section>
      <Footer />
    </main>
  )
}
