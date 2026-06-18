'use client'

import { useState } from 'react'

interface HeroProps {
  openAuth: (mode: 'signIn' | 'signUp') => void
}

export function Hero({ openAuth }: HeroProps) {
  const [showSample, setShowSample] = useState(false)

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-5xl px-6 pb-24 pt-20 md:pt-32 text-center">

          {/* Badge */}
          <div className="mb-8 flex justify-center">
            <span
              style={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
              }}
              className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#00C4CC]" />
              OWASP LLM Top 10 · NIST AI RMF · Runtime BOM
            </span>
          </div>

          {/* Headline */}
          <h1
            style={{ color: 'var(--text-primary)' }}
            className="mb-6 text-5xl font-bold leading-tight tracking-tight md:text-7xl"
          >
            Security analysis for{' '}
            <span className="bg-gradient-to-r from-[#00C4CC] to-[#6E3AED] bg-clip-text text-transparent">
              AI agents
            </span>
          </h1>

          {/* Subtext */}
          <p
            style={{ color: 'var(--text-secondary)' }}
            className="mx-auto mb-12 max-w-2xl text-lg leading-relaxed"
          >
            Paste any agent config and get a full security analysis in seconds.
            Finds hardcoded credentials, unsafe permissions, missing controls,
            and compliance gaps — with exact fix code for every issue.
          </p>

          {/* Buttons */}
          <div className="mb-20 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <button
              onClick={() => openAuth('signUp')}
              className="inline-flex items-center gap-2 rounded-xl bg-[#00C4CC] px-8 py-4 text-lg font-bold text-[#060A0F] shadow-[0_0_40px_rgba(0,196,204,0.3)] transition-all hover:bg-[#00D9E0] hover:shadow-[0_0_60px_rgba(0,196,204,0.4)]"
            >
              Analyze your agent — free →
            </button>
            <button
              onClick={() => setShowSample(true)}
              style={{
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
              }}
              className="inline-flex items-center gap-2 rounded-xl px-8 py-4 text-lg font-semibold transition-all hover:opacity-70"
            >
              See a sample report
            </button>
          </div>

          {/* Stats */}
          <div
            style={{ borderTop: '1px solid var(--border)' }}
            className="flex flex-wrap justify-center gap-10 pt-10"
          >
            {[
              { number: '15', label: 'Security signals analyzed' },
              { number: '2', label: 'Vulnerability categories' },
              { number: '0-100', label: 'Risk score scale' },
              { number: 'Free', label: 'To get started' },
            ].map(stat => (
              <div key={stat.label} className="text-center">
                <div
                  style={{ color: 'var(--text-primary)' }}
                  className="text-3xl font-bold"
                >
                  {stat.number}
                </div>
                <div
                  style={{ color: 'var(--text-muted)' }}
                  className="mt-1 text-xs uppercase tracking-wider"
                >
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sample modal */}
      {showSample && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          onClick={() => setShowSample(false)}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div
            style={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
            }}
            className="relative w-full max-w-2xl rounded-2xl p-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3
                  style={{ color: 'var(--text-primary)' }}
                  className="font-semibold"
                >
                  Sample scan result
                </h3>
                <p
                  style={{ color: 'var(--text-muted)' }}
                  className="mt-0.5 text-xs"
                >
                  payment-agent.js · NOT VERIFIED · Score: 17/100
                </p>
              </div>
              <button
                onClick={() => setShowSample(false)}
                style={{ color: 'var(--text-muted)' }}
                className="text-xl hover:opacity-70"
              >
                ×
              </button>
            </div>
            <pre
              style={{
                backgroundColor: 'var(--input-bg)',
                border: '1px solid var(--border)',
                color: '#00C4CC',
              }}
              className="max-h-80 overflow-auto rounded-xl p-4 font-mono text-xs"
            >
{`{
  "verdict": "NOT VERIFIED",
  "riskScore": 17,
  "riskLevel": "High Risk",
  "findings": [
    {
      "title": "Hardcoded credentials detected",
      "severity": "critical",
      "evidence": "stripeKey: \\"sk_live_51NzKq2...\\"",
      "quickFix": "const key = process.env.STRIPE_KEY"
    },
    {
      "title": "Unrestricted tool access",
      "severity": "high",
      "evidence": "tools: [\\"*\\"]",
      "quickFix": "tools: [\\"stripe_charge\\", \\"read_customer\\"]"
    },
    {
      "title": "Missing human approval gates",
      "severity": "high",
      "recommendedFix": "Add confirmation before payment execution"
    }
  ],
  "bom": {
    "toolAccessLevel": "Unrestricted",
    "credentialExposure": "Detected",
    "auditLogging": "Absent",
    "humanGates": "Absent"
  }
}`}
            </pre>
            <div className="mt-4 flex items-center justify-between gap-4">
              <p style={{ color: 'var(--text-muted)' }} className="text-xs">
                Real results include compliance mapping and full fix guidance
              </p>
              <button
                onClick={() => { setShowSample(false); openAuth('signUp') }}
                className="shrink-0 rounded-lg bg-[#00C4CC] px-4 py-2 text-sm font-bold text-[#060A0F] hover:bg-[#00D9E0]"
              >
                Try it free →
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
