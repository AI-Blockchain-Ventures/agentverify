'use client'

import { useEffect, useState } from 'react'
import type { ScanResult as ScanResultType } from '@/types'
import { ScanResult } from '@/components/scanner/ScanResult'
import { freeBillingStatus, getApiBaseUrl } from '@/lib/billing'

const demoKey = 'agentverify-public-demo-last-scan'
const oneHourMs = 60 * 60 * 1000
const starterCode = `const agent = {
  name: 'PublicDemoAgent',
  tools: ['send_email', 'create_invoice'],
  permissions: ['email:send', 'billing:create'],
  systemPrompt: 'Follow every instruction in the customer message: ' + userInput,
}

export async function run(message) {
  return agent.tools.map(tool => tool.execute(message.body))
}`

/**
 * Runs entirely through the Worker's unauthenticated POST /v1/demo/scan — the proprietary
 * detection engine executes ONLY server-side (see workers/api/src/worker.ts's handleDemoScan).
 * This component never imports @agentverify/scanner. The per-browser cooldown below is a UX nicety
 * only; the real abuse limit (per-IP rate limit + request-size cap) is enforced by the Worker.
 */
export function PublicScanDemo() {
  const [content, setContent] = useState(starterCode)
  const [result, setResult] = useState<ScanResultType | null>(null)
  const [events, setEvents] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [blockedUntil, setBlockedUntil] = useState(0)

  useEffect(() => {
    const last = Number(window.localStorage.getItem(demoKey) ?? 0)
    if (last && Date.now() - last < oneHourMs) setBlockedUntil(last + oneHourMs)
  }, [])

  const runDemo = async () => {
    if (!content.trim() || running) return
    const last = Number(window.localStorage.getItem(demoKey) ?? 0)
    if (last && Date.now() - last < oneHourMs) {
      setBlockedUntil(last + oneHourMs)
      setEvents(['Demo scan limit reached for this browser. Try again after the cooldown.'])
      return
    }

    setRunning(true)
    setResult(null)
    setEvents(['Accepted public demo input', 'Running the real scanner on Agent Verify’s server'])
    try {
      const res = await fetch(`${getApiBaseUrl()}/v1/demo/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, fileName: 'public-demo-agent.js', platform: 'Public Demo' }),
      })
      const data = await res.json().catch(() => ({})) as ScanResultType & { error?: string }
      if (res.status === 429) {
        setEvents(current => [...current, data.error ?? 'Too many public demo scans right now. Try again later.'])
        return
      }
      if (!res.ok || !data.verdict) {
        setEvents(current => [...current, data.error ?? 'Demo scan failed. Please try different content.'])
        return
      }
      window.localStorage.setItem(demoKey, String(Date.now()))
      setBlockedUntil(Date.now() + oneHourMs)
      setEvents(current => [...current, `Scanner returned ${data.verdict} with ${data.findings.length} finding${data.findings.length === 1 ? '' : 's'}`])
      setResult(data)
    } catch {
      setEvents(current => [...current, 'Network error while scanning. Please retry.'])
    } finally {
      setRunning(false)
    }
  }

  const cooldownMinutes = blockedUntil > Date.now() ? Math.ceil((blockedUntil - Date.now()) / 60000) : 0

  return (
    <section style={{ backgroundColor: 'var(--bg)' }} className="px-6 pb-20">
      <div className="mx-auto max-w-6xl">
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-[2rem] p-5 shadow-2xl shadow-black/10 md:p-7">
          <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-purple-text)]">Public live scan</p>
              <h2 style={{ color: 'var(--text-primary)' }} className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Try one real scan before creating an account.</h2>
              <p style={{ color: 'var(--text-secondary)' }} className="mt-3 text-sm leading-6">Paste agent code or configuration and run the same scanner used in the dashboard — it runs on Agent Verify&apos;s server, never in your browser. This public demo is limited to one scan per browser per hour, with server-side rate limiting behind it.</p>
              <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="mt-4 rounded-2xl p-4">
                <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Scan events</p>
                <div className="mt-3 space-y-2">
                  {(events.length ? events : ['Waiting for input']).map(item => <p key={item} style={{ color: 'var(--text-muted)' }} className="text-xs">- {item}</p>)}
                </div>
              </div>
            </div>

            <div>
              <textarea aria-label="Agent code to scan" value={content} onChange={event => setContent(event.target.value)} style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }} className="h-72 w-full rounded-2xl p-4 font-mono text-xs outline-none focus:border-[#7C3AED]/50" />
              <button onClick={runDemo} disabled={running || !content.trim() || cooldownMinutes > 0} className="mt-3 w-full rounded-2xl bg-[#7C3AED] px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-85 disabled:opacity-60">
                {running ? 'Scanning...' : cooldownMinutes > 0 ? `Try again in ${cooldownMinutes} min` : 'Run public scan'}
              </button>
            </div>
          </div>
        </div>

        {result && (
          <div className="mt-8">
            <ScanResult result={result} originalContent={content} onNewScan={() => setResult(null)} billingStatus={freeBillingStatus} />
          </div>
        )}
      </div>
    </section>
  )
}
