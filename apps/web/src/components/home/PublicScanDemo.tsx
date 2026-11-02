'use client'

import { useEffect, useState } from 'react'
import type { ScanResult as ScanResultType } from '@/types'
import dynamic from 'next/dynamic'
// The full report viewer is large and only needed after a scan, so it loads on demand.
const ScanResult = dynamic(() => import('@/components/scanner/ScanResult').then(m => m.ScanResult), { ssr: false, loading: () => <p style={{ color: 'var(--text-muted)' }} className="text-sm">Loading the report…</p> })
import { freeBillingStatus, getApiBaseUrl } from '@/lib/billing'
import { SCAN_EXAMPLES } from '@/lib/scanExamples'
import { SAFETY_CHECK_URL } from '@/lib/links'

const demoKey = 'agentverify-public-demo-last-scan'
const oneHourMs = 60 * 60 * 1000

// A short, curated set for first-time visitors — each one shows a different kind of risk.
const QUICK_EXAMPLES = ['Prompt injection', 'Poisoned MCP tool', 'MCP config', 'AI agent in CI', 'Payments agent', 'Retrieval agent', 'Safety switches off', 'A2SPA-ready'] as const
const starterExample = SCAN_EXAMPLES['Prompt injection']

const readLastScan = (): number => {
  try { return Number(window.localStorage.getItem(demoKey) ?? 0) } catch { return 0 }
}
const writeLastScan = (value: number) => {
  try { window.localStorage.setItem(demoKey, String(value)) } catch { /* private mode: server-side limit still applies */ }
}

/**
 * Runs entirely through the Worker's unauthenticated POST /v1/demo/scan — the proprietary
 * detection engine executes ONLY server-side (see workers/api/src/worker.ts's handleDemoScan).
 * This component never imports @agentverify/scanner. The per-browser cooldown below is a UX nicety
 * only; the real abuse limit (per-IP rate limit + request-size cap) is enforced by the Worker.
 */
export function PublicScanDemo({ openAuth }: { openAuth?: (mode: 'signIn' | 'signUp') => void }) {
  const [content, setContent] = useState(starterExample.content)
  const [fileName, setFileName] = useState(starterExample.fileName)
  const [activeExample, setActiveExample] = useState<string | null>('Prompt injection')
  const [result, setResult] = useState<ScanResultType | null>(null)
  const [events, setEvents] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [blockedUntil, setBlockedUntil] = useState(0)
  // Shown right under the Run button so a failed scan is never silent or off-screen.
  const [scanError, setScanError] = useState('')
  // Static export: the button can't run a scan until React has loaded, so it stays disabled until then.
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(true)
    const last = readLastScan()
    if (last && Date.now() - last < oneHourMs) setBlockedUntil(last + oneHourMs)
  }, [])

  const loadExample = (label: string) => {
    const example = SCAN_EXAMPLES[label]
    if (!example) return
    setContent(example.content)
    setFileName(example.fileName)
    setActiveExample(label)
  }

  const runDemo = async () => {
    if (!content.trim() || running) return
    const last = readLastScan()
    if (last && Date.now() - last < oneHourMs) {
      setBlockedUntil(last + oneHourMs)
      setEvents(['You have used this browser’s free public scan for the hour. Create a free account for 10 scans a month.'])
      return
    }

    setRunning(true)
    setResult(null)
    setScanError('')
    setEvents(['Received your code', 'Running 120+ security checks on Agent Verify’s server'])
    const fail = (message: string) => { setScanError(message); setEvents(current => [...current, message]) }
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 30_000)
    try {
      const res = await fetch(`${getApiBaseUrl()}/v1/demo/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, fileName: fileName || 'public-demo-agent.js', platform: 'Public Demo' }),
        signal: controller.signal,
      })
      const data = await res.json().catch(() => ({})) as ScanResultType & { error?: string }
      if (res.status === 429) {
        fail('The free demo limit for your network has been reached. Try again later, or create a free account for 10 scans a month.')
        return
      }
      if (res.status === 413) {
        fail('That is more than the public scan accepts (200KB). Paste just the agent file, or create a free account to scan up to 5MB.')
        return
      }
      if (!res.ok || !data.verdict || !Array.isArray(data.findings)) {
        fail(res.status >= 500 ? 'The scanner is temporarily unavailable. Please try again in a minute.' : data.error ?? 'The scan did not complete. Please try different content.')
        return
      }
      writeLastScan(Date.now())
      setBlockedUntil(Date.now() + oneHourMs)
      setEvents(current => [...current, `Done: ${data.verdict === 'VERIFIED' ? 'verified' : data.verdict === 'NOT_ASSESSED' ? 'not enough agent code to assess' : 'not verified'} · ${data.findings.length} finding${data.findings.length === 1 ? '' : 's'}`])
      setResult(data)
      // Bring the report into view on small screens, where it renders below the fold.
      window.setTimeout(() => document.getElementById('public-scan-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    } catch (err) {
      fail((err as { name?: string })?.name === 'AbortError'
        ? 'The scan took too long (no answer after 30 seconds). Please try again.'
        : 'Could not reach the scanner. Check your connection or turn off any content blocker for this site, then try again.')
    } finally {
      window.clearTimeout(timer)
      setRunning(false)
    }
  }

  const cooldownMinutes = blockedUntil > Date.now() ? Math.ceil((blockedUntil - Date.now()) / 60000) : 0
  const criticalOrHigh = result ? result.findings.filter(f => f.severity === 'critical' || f.severity === 'high').length : 0

  return (
    <section id="public-scan" style={{ backgroundColor: 'var(--bg)' }} className="scroll-mt-20 px-4 pb-20 sm:px-6">
      <div className="mx-auto max-w-[1320px] min-[1800px]:max-w-[1520px]">
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-[2rem] p-5 shadow-2xl shadow-black/10 md:p-7">
          <div className="grid gap-6 lg:grid-cols-[1fr_440px]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-purple-text)]">Free live scan · no account needed</p>
              <h2 style={{ color: 'var(--text-primary)' }} className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Try a real scan in 10 seconds.</h2>
              <ol style={{ color: 'var(--text-secondary)' }} className="mt-4 hidden space-y-2 text-sm leading-6 sm:block">
                <li><span className="font-semibold text-[color:var(--accent-purple-text)]">1.</span> Pick an example below, or paste your own agent code or config.</li>
                <li><span className="font-semibold text-[color:var(--accent-purple-text)]">2.</span> Press <strong>Run free scan</strong>. It runs on our server, never in your browser.</li>
                <li><span className="font-semibold text-[color:var(--accent-purple-text)]">3.</span> Read the verdict, the top risks, and what to fix first.</li>
              </ol>

              <p style={{ color: 'var(--text-muted)' }} className="mt-5 text-xs font-semibold uppercase tracking-wider">Try an example</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {QUICK_EXAMPLES.map(label => (
                  <button
                    key={label}
                    onClick={() => loadExample(label)}
                    title={SCAN_EXAMPLES[label]?.description}
                    style={{
                      border: '1px solid var(--border)',
                      backgroundColor: activeExample === label ? 'var(--text-primary)' : 'var(--surface)',
                      color: activeExample === label ? 'var(--bg)' : 'var(--text-secondary)',
                    }}
                    className="rounded-full px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
                  >
                    {label}
                  </button>
                ))}
              </div>
              {activeExample && SCAN_EXAMPLES[activeExample] && (
                <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs leading-5">{SCAN_EXAMPLES[activeExample].whyItMatters}</p>
              )}

              <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className={`mt-5 rounded-2xl p-4 ${events.length ? '' : 'hidden lg:block'}`} aria-live="polite">
                <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Scan progress</p>
                <div className="mt-2 space-y-1.5">
                  {(events.length ? events : ['Waiting for you to press Run free scan']).map((item, i) => <p key={`${i}-${item}`} style={{ color: 'var(--text-muted)' }} className="text-xs">• {item}</p>)}
                </div>
              </div>
              <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-[11px] leading-5">One free public scan per browser per hour. Don&apos;t paste real production keys — any detected secret is redacted, but rotate it anyway.</p>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label htmlFor="public-scan-input" style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold uppercase tracking-wider">{fileName || 'Your agent code'}</label>
                {content && (
                  <button onClick={() => { setContent(''); setFileName(''); setActiveExample(null) }} style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold underline-offset-2 hover:underline">
                    Clear and paste my own
                  </button>
                )}
              </div>
              <textarea
                id="public-scan-input"
                aria-label="Agent code to scan"
                value={content}
                onChange={event => { setContent(event.target.value); if (activeExample) { setActiveExample(null); setFileName('') } }}
                placeholder="// Paste your agent code, tool config, or MCP settings here"
                style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
                className="h-48 w-full rounded-2xl p-4 font-mono text-xs outline-none lg:h-72 placeholder:text-[var(--input-placeholder)] focus:border-[#7C3AED]/50"
              />
              <button id="public-scan-run" onClick={runDemo} disabled={!ready || running || !content.trim() || cooldownMinutes > 0} className="mt-3 w-full rounded-2xl bg-[#7C3AED] px-5 py-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-85 disabled:opacity-60">
                {!ready ? 'Loading…' : running ? 'Scanning…' : cooldownMinutes > 0 ? `Free scan used — next one in ${cooldownMinutes} min` : 'Run free scan'}
              </button>
              {scanError && (
                <p role="alert" data-testid="public-scan-error" className="mt-3 rounded-lg p-3 text-sm text-[color:var(--accent-red-text)]" style={{ backgroundColor: 'rgba(217,45,32,0.06)', border: '1px solid rgba(217,45,32,0.3)' }}>
                  {scanError}
                </p>
              )}
              {cooldownMinutes > 0 && openAuth && (
                <button onClick={() => openAuth('signUp')} className="mt-2 w-full rounded-2xl border border-[#7C3AED]/40 px-5 py-3 text-sm font-semibold text-[color:var(--accent-purple-text)] transition-opacity hover:opacity-80">
                  Create a free account — 10 scans a month
                </button>
              )}
            </div>
          </div>
        </div>

        {result && (
          <div id="public-scan-result" className="mt-8 scroll-mt-24">
            <NextStepsPanel result={result} criticalOrHigh={criticalOrHigh} openAuth={openAuth} />
            <div className="mt-6">
              <ScanResult result={result} originalContent={content} onNewScan={() => setResult(null)} billingStatus={freeBillingStatus} />
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

/** Plain-English "what now?" right under the scan, before the detailed report. */
function NextStepsPanel({ result, criticalOrHigh, openAuth }: { result: ScanResultType; criticalOrHigh: number; openAuth?: (mode: 'signIn' | 'signUp') => void }) {
  const verified = result.verdict === 'VERIFIED'
  const notAssessed = result.verdict === 'NOT_ASSESSED'
  const headline = verified
    ? 'Good news: no blocking issues found in this code.'
    : notAssessed
      ? 'We need more of your agent to give a verdict.'
      : criticalOrHigh > 0
        ? `This agent has ${criticalOrHigh} serious issue${criticalOrHigh === 1 ? '' : 's'} to fix before it goes live.`
        : 'This agent needs a few fixes before it goes live.'
  const detail = verified
    ? 'A clean static scan is a strong start, not a guarantee. Re-scan after every change, and have the full agent reviewed before it touches money or customer data.'
    : notAssessed
      ? 'Paste the code where the agent calls its tools or model, or sign up and drop in several files at once.'
      : `Start with: ${result.reportInsights?.topBlocker ?? 'the highest-severity finding below'}. Each finding below says what is wrong, why it matters, and how to fix it.`

  return (
    <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-[1.5rem] p-5 md:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-purple-text)]">What to do next</p>
      <h3 style={{ color: 'var(--text-primary)' }} className="mt-2 text-xl font-semibold tracking-tight md:text-2xl">{headline}</h3>
      <p style={{ color: 'var(--text-secondary)' }} className="mt-2 max-w-3xl text-sm leading-6">{detail}</p>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Fix it yourself</p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs leading-5">Free account: 10 private scans a month, multi-file upload, saved reports, and re-scan to confirm your fixes worked.</p>
          {openAuth ? (
            <button onClick={() => openAuth('signUp')} className="mt-3 rounded-xl bg-[#7C3AED] px-4 py-2.5 text-xs font-semibold text-white transition-opacity hover:opacity-85">Create free account</button>
          ) : (
            <a href="/agentverify/dashboard/" className="mt-3 inline-flex rounded-xl bg-[#7C3AED] px-4 py-2.5 text-xs font-semibold text-white transition-opacity hover:opacity-85">Create free account</a>
          )}
        </div>
        <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Have us check it</p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs leading-5">The AI Agent Safety Check: an expert review of your agent&apos;s permissions, tools, and approval steps, with a written fix plan.</p>
          <a href={SAFETY_CHECK_URL} className="mt-3 inline-flex rounded-xl border border-[#7C3AED]/40 px-4 py-2.5 text-xs font-semibold text-[color:var(--accent-purple-text)] transition-opacity hover:opacity-80">Book a Safety Check</a>
        </div>
      </div>
    </div>
  )
}
