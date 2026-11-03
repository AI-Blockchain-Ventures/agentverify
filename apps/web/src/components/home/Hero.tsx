'use client'

import Link from 'next/link'
import { openAsk } from '@/components/ask/askEvents'

interface HeroProps {
  openAuth: (mode: 'signIn' | 'signUp') => void
}

const EXAMPLE_QUESTIONS = [
  'Is the filesystem MCP server safe to install?',
  'How do I check every pull request?',
  'Do you store my code?',
  'How do I scan inside VS Code or Cursor?',
]

export function Hero({ openAuth }: HeroProps) {
  return (
    <section style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="av-container grid items-center gap-10 py-14 md:py-20 lg:grid-cols-[1.1fr_1fr] lg:gap-14 2xl:gap-20 2xl:py-24">
        <div>
          <Link
            href="/whats-new"
            style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium"
          >
            <span className="font-semibold text-[color:var(--accent-purple-text)]">New</span> Agent Verify 2.0 · 124 checks, PR checks, Agent Guard →
          </Link>

          <h1 style={{ color: 'var(--text-primary)' }} className="mt-5 text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl xl:text-[56px] 2xl:text-[64px]">
            Security for AI agents, from first commit to production.
          </h1>

          <p style={{ color: 'var(--text-secondary)' }} className="mt-5 max-w-xl text-base leading-relaxed md:text-lg 2xl:max-w-2xl 2xl:text-xl">
            Find leaked keys, risky tools, MCP access and prompt-injection holes in your agents — then fix them in one click, right in the pull request.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <a
              href="#public-scan"
              onClick={event => {
                const target = document.getElementById('public-scan')
                if (!target) return
                event.preventDefault()
                target.scrollIntoView({ behavior: 'smooth', block: 'start' })
                window.setTimeout(() => document.getElementById('public-scan-run')?.focus({ preventScroll: true }), 600)
              }}
              className="inline-flex items-center justify-center rounded-md bg-[#7C3AED] px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-[#6D28D9]"
            >
              Scan an agent free
            </a>
            <button
              onClick={() => openAuth('signUp')}
              style={{ border: '1px solid var(--border-light)', color: 'var(--text-primary)', backgroundColor: 'var(--card)' }}
              className="inline-flex items-center justify-center rounded-md px-6 py-3 text-base font-semibold transition-opacity hover:opacity-80"
            >
              Create free account
            </button>
            <Link
              href="/report/demo"
              style={{ color: 'var(--text-secondary)' }}
              className="inline-flex items-center justify-center rounded-md px-4 py-3 text-base font-semibold transition-colors hover:text-[var(--text-primary)]"
            >
              View Sample Report
            </Link>
          </div>
          <p style={{ color: 'var(--text-muted)' }} className="mt-4 text-sm">No sign-up needed for your first scan · Your raw code is never stored</p>
        </div>

        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="overflow-hidden rounded-xl shadow-sm">
          <button
            onClick={() => openAsk()}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm"
            style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2" aria-hidden="true"><path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z" /></svg>
            <span className="flex-1">Ask anything about agent security…</span>
            <span className="av-kbd">Ctrl K</span>
          </button>
          <div className="p-4 md:p-5">
            <p style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold uppercase tracking-wider">Try asking</p>
            <ul className="mt-3 space-y-2">
              {EXAMPLE_QUESTIONS.map(q => (
                <li key={q}>
                  <button
                    onClick={() => openAsk(q)}
                    style={{ border: '1px solid var(--border)', color: 'var(--text-primary)', backgroundColor: 'var(--surface)' }}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-3.5 py-2.5 text-left text-sm transition-colors hover:border-[#7C3AED]"
                  >
                    <span>{q}</span>
                    <span aria-hidden="true" style={{ color: 'var(--text-muted)' }}>→</span>
                  </button>
                </li>
              ))}
            </ul>
            <p style={{ color: 'var(--text-muted)' }} className="mt-4 text-xs leading-5">
              Answers come from Agent Verify&apos;s checks, docs and the MCP safety directory — and, once you sign in, your own scan results.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
