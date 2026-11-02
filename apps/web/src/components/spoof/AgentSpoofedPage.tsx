'use client'

import { useEffect, useRef, useState } from 'react'
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

const SCAN_TIMEOUT_MS = 30_000

type Status =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; summary: string }
  | { kind: 'error'; title: string; detail: string; rateLimited?: boolean }

/** Turns any failed response into a message a visitor can act on. Never returns an empty string. */
function describeFailure(status: number, serverError?: string): Extract<Status, { kind: 'error' }> {
  if (status === 429) {
    return {
      kind: 'error',
      rateLimited: true,
      title: 'The free demo limit for your network has been reached.',
      detail: 'Public demo scans are limited per network each hour. You can open the saved sample report now, or create a free account for 10 private scans a month.',
    }
  }
  if (status >= 500) {
    return { kind: 'error', title: 'The scanner is temporarily unavailable.', detail: 'Our server did not finish the scan. Please try again in a minute.' }
  }
  return { kind: 'error', title: 'The scan could not be completed.', detail: serverError || `The server answered with status ${status}. Please try again.` }
}

/**
 * Same unauthenticated POST /v1/demo/scan the homepage's PublicScanDemo uses — one reusable
 * Worker route rather than a second copy of scan-calling logic. The proprietary engine never
 * ships to this page's client bundle; see docs/private-scanner-boundary.md.
 *
 * Every outcome (scanning, success, rate limit, timeout, network or server error) is shown right
 * under the button, so a click never looks like "nothing happened".
 */
export function AgentSpoofedPage() {
  const [result, setResult] = useState<ScanResultType | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [events, setEvents] = useState<string[]>([])
  // The page is a static export: until React has loaded, a click can't run the scan. Show that
  // instead of a button that silently ignores the click.
  const [ready, setReady] = useState(false)
  const resultRef = useRef<HTMLDivElement>(null)
  const running = status.kind === 'running'

  useEffect(() => { setReady(true) }, [])

  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [result])

  const runScan = async () => {
    if (running) return
    setStatus({ kind: 'running' })
    setResult(null)
    setEvents(['Loaded Rogue onboarding sample', 'Sending it to the scanner on Agent Verify’s server'])

    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS)
    try {
      const res = await fetch(`${getApiBaseUrl()}/v1/demo/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: rogueOnboarding.content, fileName: rogueOnboarding.fileName, platform: 'Agent Marketplace' }),
        signal: controller.signal,
      })
      const data = await res.json().catch(() => ({})) as Partial<ScanResultType> & { error?: string }
      if (!res.ok || !data.verdict || !Array.isArray(data.findings)) {
        const failure = res.ok
          ? { kind: 'error' as const, title: 'The scanner sent back an unexpected answer.', detail: 'Please try again. If it keeps happening, email hello@aiblockchainventures.com.' }
          : describeFailure(res.status, data.error)
        setStatus(failure)
        setEvents(current => [...current, `Failed: ${failure.title}`])
        return
      }
      const count = data.findings.length
      const summary = `Scanner returned ${data.verdict} with ${count} finding${count === 1 ? '' : 's'}. The full report is below.`
      setEvents(current => [...current, summary])
      setStatus({ kind: 'done', summary })
      setResult(data as ScanResultType)
    } catch (err) {
      const timedOut = (err as { name?: string })?.name === 'AbortError'
      const failure: Status = timedOut
        ? { kind: 'error', title: 'The scan took too long.', detail: `No answer from the scanner after ${SCAN_TIMEOUT_MS / 1000} seconds. Please try again.` }
        : { kind: 'error', title: 'Could not reach the scanner.', detail: 'Check your internet connection, or turn off any content blocker for this site, then try again.' }
      setStatus(failure)
      setEvents(current => [...current, `Failed: ${failure.title}`])
    } finally {
      window.clearTimeout(timer)
    }
  }

  const buttonLabel = !ready ? 'Loading demo…' : running ? 'Scanning…' : status.kind === 'idle' ? 'Run live scan' : 'Run again'

  return (
    <main style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen overflow-x-hidden">
      <section className="mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-12">
        <div className="mb-8 flex items-center justify-between gap-4">
          <Link href="/" style={{ color: 'var(--text-secondary)' }} className="text-sm font-medium hover:opacity-75">Agent Verify</Link>
          <Link href="/pricing" className="rounded-lg bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6D28D9]">View pricing</Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
          <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="min-w-0 rounded-2xl p-5 md:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-purple-text)]">Live demo</p>
            <h1 style={{ color: 'var(--text-primary)' }} className="mt-3 break-words text-3xl font-semibold tracking-tight sm:text-4xl md:text-6xl">Agent spoofing: rogue onboarding</h1>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-4 max-w-2xl text-base leading-7">This public demo scans the same Rogue onboarding / Identity Spoofing scenario available in the dashboard examples. It runs on Agent Verify&apos;s server and renders the resulting report below. No account needed.</p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-[color:var(--accent-purple-text)]">
              {rogueOnboarding.demonstrates.split(', ').map(item => <span key={item} className="rounded-full bg-[#7C3AED]/10 px-3 py-1.5">{item}</span>)}
            </div>
            <button
              type="button"
              onClick={() => void runScan()}
              disabled={!ready || running}
              aria-busy={running}
              data-testid="run-live-scan"
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#7C3AED] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#6D28D9] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {running && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              {buttonLabel}
            </button>

            <div aria-live="polite" className="mt-4">
              {running && (
                <p role="status" style={{ color: 'var(--text-secondary)' }} className="text-sm">Scanning the sample on our server. This usually takes a few seconds…</p>
              )}
              {status.kind === 'done' && (
                <p role="status" className="rounded-lg p-3 text-sm text-[color:var(--accent-green-text)]" style={{ backgroundColor: 'rgba(18,183,106,0.08)', border: '1px solid rgba(18,183,106,0.25)' }}>
                  {status.summary}
                </p>
              )}
              {status.kind === 'error' && (
                <div role="alert" data-testid="live-scan-error" className="rounded-lg p-3 text-sm" style={{ backgroundColor: 'rgba(217,45,32,0.06)', border: '1px solid rgba(217,45,32,0.3)' }}>
                  <p className="font-semibold text-[color:var(--accent-red-text)]">{status.title}</p>
                  <p style={{ color: 'var(--text-secondary)' }} className="mt-1">{status.detail}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {status.rateLimited ? (
                      <>
                        <Link href="/report/demo" className="rounded-md bg-[#7C3AED] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#6D28D9]">Open sample report</Link>
                        <Link href="/signup" style={{ border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} className="rounded-md px-3 py-1.5 text-xs font-semibold">Create free account</Link>
                      </>
                    ) : (
                      <button type="button" onClick={() => void runScan()} className="rounded-md bg-[#7C3AED] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#6D28D9]">Try again</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="min-w-0 rounded-2xl p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-purple-text)]">Vulnerable sample</p>
            <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-sm">{rogueOnboarding.description}</p>
            <pre style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)' }} className="mt-4 max-h-[420px] max-w-full overflow-auto rounded-lg p-4 font-mono text-xs leading-relaxed text-[var(--text-secondary)]">{rogueOnboarding.content}</pre>
          </div>
        </div>

        <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="mt-6 rounded-lg p-4">
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Scan events</p>
          <ol className="mt-3 space-y-2">
            {(events.length ? events : ['Waiting for live scan']).map((event, i) => <li key={`${i}-${event}`} style={{ color: 'var(--text-muted)' }} className="text-xs">- {event}</li>)}
          </ol>
        </div>

        {result && (
          <div ref={resultRef} className="mt-8 min-w-0 scroll-mt-20">
            <ScanResult result={result} originalContent={rogueOnboarding.content} onNewScan={() => { setResult(null); setStatus({ kind: 'idle' }); setEvents([]) }} billingStatus={freeBillingStatus} />
          </div>
        )}
      </section>
      <Footer />
    </main>
  )
}
