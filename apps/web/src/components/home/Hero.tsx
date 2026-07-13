'use client'

import Link from 'next/link'
import { useState } from 'react'

interface HeroProps {
  openAuth: (mode: 'signIn' | 'signUp') => void
}

export function Hero({ openAuth }: HeroProps) {
  const [showSample, setShowSample] = useState(false)

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="absolute left-1/2 top-10 h-72 w-72 -translate-x-1/2 rounded-full bg-[#00C4CC]/10 blur-3xl" />
        <div className="relative mx-auto max-w-5xl px-6 pb-20 pt-16 text-center md:pb-24 md:pt-28">
          <div className="mb-8 flex justify-center">
            <span
              style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#00C4CC]" />
              Execution-risk intelligence for AI agents
            </span>
          </div>

          <h1 style={{ color: 'var(--text-primary)' }} className="mb-6 text-5xl font-bold leading-tight tracking-tight md:text-7xl">
            Ship AI agents that can act without accepting blind execution risk{' '}
            <span className="bg-gradient-to-r from-[#00C4CC] to-[#6E3AED] bg-clip-text text-transparent">
              AI agents
            </span>
          </h1>

          <p style={{ color: 'var(--text-secondary)' }} className="mx-auto mb-12 max-w-2xl text-lg leading-relaxed">
            Agent Verify finds dangerous agent patterns before release, explains what can go wrong, and shows developers how to fix execution risk with practical remediation and A2SPA guidance.
          </p>

          <div className="mb-20 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <button
              onClick={() => openAuth('signUp')}
              className="inline-flex items-center gap-2 rounded-xl bg-[#00C4CC] px-8 py-4 text-lg font-bold text-[#060A0F] shadow-[0_0_40px_rgba(0,196,204,0.3)] transition-all hover:bg-[#00D9E0] hover:shadow-[0_0_60px_rgba(0,196,204,0.4)]"
            >
              Scan an Agent
            </button>
            <Link href="/pricing" className="inline-flex items-center gap-2 rounded-xl bg-[#00C4CC]/10 px-8 py-4 text-lg font-semibold text-[#00C4CC] transition-all hover:bg-[#00C4CC]/15">
              View Pricing
            </Link>
            <button
              onClick={() => setShowSample(true)}
              style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              className="inline-flex items-center gap-2 rounded-xl px-8 py-4 text-lg font-semibold transition-all hover:opacity-70"
            >
              View Sample Report
            </button>
          </div>

          <div style={{ borderTop: '1px solid var(--border)' }} className="grid gap-3 pt-10 text-left sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['Multi-signal agent security analysis', 'Execution-risk scoring', 'A2SPA readiness checks', 'Developer-ready remediation', 'CLI + dashboard workflow', 'Built for agents that take action'],
            ].flat().map(item => (
              <div key={item} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-4 shadow-xl shadow-black/5">
                <div className="mb-3 h-1.5 w-8 rounded-full bg-gradient-to-r from-[#00C4CC] to-[#6E3AED]" />
                <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {showSample && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={() => setShowSample(false)}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div
            style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
            className="relative max-h-[86vh] w-full max-w-4xl overflow-y-auto rounded-3xl p-6 shadow-2xl shadow-black/30 md:p-8"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <h3 style={{ color: 'var(--text-primary)' }} className="font-semibold">Sample execution-risk report</h3>
                <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-xs">payments-agent.ts · NOT VERIFIED · High Risk · 32/100</p>
              </div>
              <button onClick={() => setShowSample(false)} style={{ color: 'var(--text-muted)' }} className="text-xl hover:opacity-70">x</button>
            </div>

            <div className="grid gap-4 md:grid-cols-[220px_1fr]">
              <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#00C4CC]">Verdict</p>
                <p className="mt-2 text-3xl font-bold text-[#E03E3E]">32<span className="text-base text-[var(--text-muted)]">/100</span></p>
                <p style={{ color: 'var(--text-primary)' }} className="mt-2 text-sm font-semibold">NOT VERIFIED</p>
                <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">High Risk · 4 findings · Confidence 91/100</p>
              </div>
              <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#00C4CC]">Threat categories</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {['Tool misuse detected', 'Payment execution risk', 'Missing A2SPA evidence', 'Weak audit trail'].map(item => <span key={item} className="rounded-full border border-[#E07B39]/30 bg-[#E07B39]/10 px-3 py-1 text-[#E07B39]">{item}</span>)}
                </div>
                <p style={{ color: 'var(--text-secondary)' }} className="mt-3 text-sm">The agent can trigger payment-like actions without signed execution authorization, scoped tools, nonce replay protection, or a reliable audit receipt.</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {[
                ['Missing execution signature', 'The execution path accepts a tool request without verifying who authorized it.', 'An attacker or confused agent step could replay or modify a payment request.', 'Require A2SPA signature verification before tool execution.'],
                ['Unrestricted payment tool scope', 'The agent exposes broad payment and customer actions to the runtime.', 'Over-broad tool access turns prompt injection into real account or billing damage.', 'Limit tools to the minimum actions and require human approval for high-risk operations.'],
              ].map(([title, found, matters, fix]) => (
                <div key={title} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
                  <p style={{ color: 'var(--text-primary)' }} className="font-semibold">{title}</p>
                  <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
                    <p style={{ color: 'var(--text-secondary)' }}><strong>What we found:</strong> {found}</p>
                    <p style={{ color: 'var(--text-secondary)' }}><strong>Why it matters:</strong> {matters}</p>
                    <p style={{ color: 'var(--text-secondary)' }}><strong>How to fix:</strong> {fix}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#00B37E]">Corrected snippet</p>
                <pre className="overflow-x-auto text-xs leading-relaxed text-[#00B37E]">{`const signature = await signExecutionRequest({
  privateKey: process.env.A2SPA_PRIVATE_KEY,
  payload,
  nonce,
  timestamp,
})

if (!verifyExecutionRequest({
  publicKey: process.env.A2SPA_PUBLIC_KEY,
  payload,
  signature,
  nonce,
  timestamp,
})) throw new Error('Execution blocked')`}</pre>
              </div>
              <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#00C4CC]">Verify fix</p>
                <ol style={{ color: 'var(--text-secondary)' }} className="mt-3 list-decimal space-y-2 pl-4 text-sm">
                  <li>Store signing references as <code>A2SPA_SIGNING_KEY</code> and <code>A2SPA_VERIFY_KEY</code>.</li>
                  <li>Reject reused nonces and expired timestamps.</li>
                  <li>Re-scan and confirm the signature, nonce, timestamp, and fail-closed findings disappear.</li>
                </ol>
                <div className="mt-4 rounded-xl border border-[#00C4CC]/30 bg-[#00C4CC]/10 p-3">
                  <p className="text-sm font-semibold text-[#00C4CC]">Pro preview</p>
                  <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-xs">Pro unlocks full remediation, corrected snippets, A2SPA guidance, PDF export, and shareable reports.</p>
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-4">
              <p style={{ color: 'var(--text-muted)' }} className="text-xs">Sample data uses safe placeholders only. Never paste production private keys into Agent Verify.</p>
              <button onClick={() => { setShowSample(false); openAuth('signUp') }} className="shrink-0 rounded-lg bg-[#00C4CC] px-4 py-2 text-sm font-bold text-[#060A0F] hover:bg-[#00D9E0]">
                Scan an Agent
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
