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
        <div className="relative mx-auto max-w-5xl px-6 pb-10 pt-10 text-center md:pb-16 md:pt-24">
          <div className="mb-6 flex justify-center md:mb-8">
            <span
              style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#7C3AED]" />
              Execution-risk intelligence for AI agents
            </span>
          </div>

          <h1 style={{ color: 'var(--text-primary)' }} className="mb-5 text-4xl font-bold leading-tight tracking-tight sm:text-5xl md:mb-6 md:text-7xl">
            Know what your AI agent can do before you deploy it.
          </h1>

          <p style={{ color: 'var(--text-secondary)' }} className="mx-auto mb-8 max-w-2xl text-base leading-relaxed md:mb-12 md:text-lg">
            Agent Verify scans AI agents for dangerous permissions, exposed secrets, risky tools, MCP access, execution controls, runtime risks, and other security weaknesses — before the agent reaches production.
          </p>

          <div className="mb-3 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
            <a
              href="#public-scan"
              onClick={event => {
                const target = document.getElementById('public-scan')
                if (!target) return
                event.preventDefault()
                target.scrollIntoView({ behavior: 'smooth', block: 'start' })
                window.setTimeout(() => document.getElementById('public-scan-run')?.focus({ preventScroll: true }), 600)
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#7C3AED] px-8 py-4 text-lg font-bold text-white shadow-[0_0_40px_rgba(6,182,212,0.3)] transition-all hover:bg-[#06B6D4] hover:text-[#060A0F] hover:shadow-[0_0_60px_rgba(6,182,212,0.4)] sm:w-auto"
            >
              Scan an agent free
            </a>
            <button
              onClick={() => openAuth('signUp')}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#7C3AED]/10 px-8 py-4 text-lg font-semibold text-[color:var(--accent-purple-text)] transition-all hover:bg-[#7C3AED]/15 sm:w-auto"
            >
              Create free account
            </button>
            <Link
              href="/report/demo"
              style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-8 py-4 text-lg font-semibold transition-all hover:opacity-70 sm:w-auto"
            >
              View Sample Report
            </Link>
          </div>
          <p style={{ color: 'var(--text-muted)' }} className="mb-10 text-sm md:mb-20">No sign-up needed for your first scan · 10 free scans a month with an account</p>

          <div style={{ borderTop: '1px solid var(--border)' }} className="hidden gap-3 pt-10 text-left sm:grid sm:grid-cols-2 lg:grid-cols-3">
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
