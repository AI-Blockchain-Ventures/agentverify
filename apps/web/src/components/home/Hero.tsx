'use client'

import Link from 'next/link'

interface HeroProps {
  openAuth: (mode: 'signIn' | 'signUp') => void
}

export function Hero({ openAuth }: HeroProps) {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="absolute left-1/2 top-10 h-72 w-72 -translate-x-1/2 rounded-full bg-[#7C3AED]/10 blur-3xl" />
        <div className="relative mx-auto max-w-5xl px-6 pb-20 pt-16 text-center md:pb-24 md:pt-28">
          <div className="mb-8 flex justify-center">
            <span
              style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#7C3AED]" />
              Execution-risk intelligence for AI agents
            </span>
          </div>

          <h1 style={{ color: 'var(--text-primary)' }} className="mb-6 text-5xl font-bold leading-tight tracking-tight md:text-7xl">
            Know what your AI agent can do before you deploy it.
          </h1>

          <p style={{ color: 'var(--text-secondary)' }} className="mx-auto mb-12 max-w-2xl text-lg leading-relaxed">
            Agent Verify scans AI agents for dangerous permissions, exposed secrets, risky tools, MCP access, execution controls, runtime risks, and other security weaknesses — before the agent reaches production.
          </p>

          <div className="mb-20 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <button
              onClick={() => openAuth('signUp')}
              className="inline-flex items-center gap-2 rounded-xl bg-[#7C3AED] px-8 py-4 text-lg font-bold text-white shadow-[0_0_40px_rgba(6,182,212,0.3)] transition-all hover:bg-[#06B6D4] hover:text-[#060A0F] hover:shadow-[0_0_60px_rgba(6,182,212,0.4)]"
            >
              Scan an Agent
            </button>
            <Link href="/pricing" className="inline-flex items-center gap-2 rounded-xl bg-[#7C3AED]/10 px-8 py-4 text-lg font-semibold text-[color:var(--accent-purple-text)] transition-all hover:bg-[#7C3AED]/15">
              View Pricing
            </Link>
            <Link
              href="/report/demo"
              style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              className="inline-flex items-center gap-2 rounded-xl px-8 py-4 text-lg font-semibold transition-all hover:opacity-70"
            >
              View Sample Report
            </Link>
          </div>

          <div style={{ borderTop: '1px solid var(--border)' }} className="grid gap-3 pt-10 text-left sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['Multi-signal agent security analysis', 'Execution-risk scoring', 'A2SPA readiness checks', 'Developer-ready remediation', 'CLI + dashboard workflow', 'Built for agents that take action'],
            ].flat().map(item => (
              <div key={item} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-4 shadow-xl shadow-black/5">
                <div className="mb-3 h-1.5 w-8 rounded-full bg-gradient-to-r from-[#7C3AED] to-[#7C3AED]" />
                <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
