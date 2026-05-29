'use client'

import { useState } from 'react'

interface HeroProps {
  openAuth: (mode: 'signIn' | 'signUp') => void
}

export function Hero({ openAuth }: HeroProps) {
  const [showSample, setShowSample] = useState(false)

  return (
    <>
      <section className="mx-auto max-w-4xl px-4 pb-20 pt-24 text-center md:px-6 md:pb-24 md:pt-32">
        <div className="mb-8 inline-flex cursor-pointer items-center gap-2 rounded-full border border-[#1E2D40] bg-[#0D1117] px-4 py-1.5 text-xs text-[#94A3B8] transition-colors hover:border-[#243244] hover:text-white">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#06B6D4]" />
          Introducing Runtime BOM Analysis →
        </div>
        <h1 className="mb-6 text-4xl font-bold leading-[1.05] tracking-tight text-white md:text-7xl">
          Know what your agent<br />
          <span className="bg-gradient-to-r from-[#06B6D4] via-[#22D3EE] to-[#A78BFA] bg-clip-text text-transparent">
            can do before it runs.
          </span>
        </h1>
        <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-[#94A3B8]">
          Agent Verify analyzes AI agent configurations for execution authority, credential exposure, tool scope, and governance gaps before they reach production.
        </p>
        <div className="mb-20 flex flex-col justify-center gap-3 sm:flex-row sm:flex-wrap">
          <button
            onClick={() => openAuth('signUp')}
            className="inline-flex items-center gap-2 rounded-lg bg-[#06B6D4] px-6 py-3 font-semibold text-[#080B14] shadow-[0_0_24px_rgba(6,182,212,0.3)] transition-colors hover:bg-[#22D3EE]"
          >
            Start for free →
          </button>
          <button
            onClick={() => setShowSample(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-[#1E2D40] px-6 py-3 font-semibold text-[#94A3B8] transition-colors hover:border-[#243244] hover:text-white"
          >
            View sample report
          </button>
        </div>
        <div className="flex flex-wrap justify-center gap-6 border-t border-[#1E2D40] pt-10 md:gap-12">
          {[
            { number: '15', label: 'Security checks on every scan' },
            { number: '2min', label: 'Average time to results' },
            { number: '100%', label: 'Data privacy - no code leaves your environment' },
          ].map(stat => (
            <div key={stat.label} className="text-center">
              <div className="text-3xl font-bold text-white">{stat.number}</div>
              <div className="mt-1 max-w-[120px] text-xs text-[#4B6080]">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {showSample && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={() => setShowSample(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative w-full max-w-2xl rounded-2xl border border-[#1E2D40] bg-[#0F1623] p-4 md:p-6" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold text-white">Sample Scan Result</h3>
              <button onClick={() => setShowSample(false)} className="text-xl text-[#4B6080] hover:text-white">x</button>
            </div>

            <pre className="max-h-96 overflow-auto rounded-lg border border-[#1E2D40] bg-[#080B14] p-4 font-mono text-xs text-[#06B6D4]">
{`{
  "verdict": "NOT VERIFIED",
  "riskScore": 34,
  "riskLevel": "High Risk",
  "confidence": 80,
  "findings": [
    {
      "title": "Missing cryptographic signature",
      "category": "A",
      "severity": "critical",
      "whatIsWrong": "No cryptographic signature detected.",
      "recommendedFix": "Implement signature verification on every execution request using A2SPA."
    },
    {
      "title": "Hardcoded credentials detected",
      "category": "B",
      "severity": "critical",
      "whatIsWrong": "API key found hardcoded in config.",
      "evidence": "apiKey: \\"sk_live_abc123\\"",
      "recommendedFix": "Move secrets to environment variables."
    }
  ],
  "bom": {
    "detectedLanguage": "JavaScript",
    "toolAccessLevel": "Unrestricted",
    "credentialExposure": "Detected",
    "auditLogging": "Absent",
    "humanGates": "Absent"
  },
  "reportId": "REPORT-example",
  "scannedAt": "2026-05-22T14:47:01.705Z"
}`}
            </pre>

            <div className="mt-4 flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
              <p className="text-xs text-[#4B6080]">Real results include full fix guidance and Runtime BOM</p>
              <button
                onClick={() => { setShowSample(false); openAuth('signUp') }}
                className="rounded-lg bg-[#06B6D4] px-4 py-2 text-sm font-semibold text-[#080B14] transition-colors hover:bg-[#22D3EE]"
              >
                Run free analysis →
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
