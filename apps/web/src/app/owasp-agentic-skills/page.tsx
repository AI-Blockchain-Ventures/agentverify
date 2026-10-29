import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import Link from 'next/link'
import sample from '@/data/owaspSample.json'
import { OwaspProfileResult } from '@/components/scanner/OwaspProfileResult'
import { StatusPill } from '@/components/scanner/OwaspControlCard'
import { IMPLEMENTED_CONTROLS_DISCLAIMER, OWASP_ATTRIBUTION_DISCLAIMER, OWASP_PROFILE_ID, STATUS_MEANING } from '@/lib/owaspProfile'
import type { ProfileAssessmentResponse, SkillAstAssessment } from '@/types/profileAssessment'

export const metadata: Metadata = pageMetadata('/owasp-agentic-skills', 'OWASP Agentic Skills Assessment', 'Assess an agent skill package against the OWASP Agentic Skills Top 10. See a sample assessment: what was assessed, what evidence was observed, which gaps were identified, and what could not be assessed.')

const assessment = sample.assessment as unknown as SkillAstAssessment
const sampleResponse: ProfileAssessmentResponse = { profile: OWASP_PROFILE_ID, assessment, attestation: null, saved: false }
const skillSource = sample.skillFiles.map(f => `// ${f.path}\n${f.content}`).join('\n\n')

const STATUSES = ['EVIDENCE_OBSERVED', 'GAP_IDENTIFIED', 'NOT_ASSESSED'] as const

export default function OwaspAgenticSkillsPage() {
  return (
    <main style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen">
      <div className="mx-auto max-w-4xl px-4 py-10 md:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-purple-text)]">OWASP profile assessment</p>
        <h1 style={{ color: 'var(--text-primary)' }} className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">OWASP Agentic Skills Top 10</h1>
        <p style={{ color: 'var(--text-secondary)' }} className="mt-3 max-w-2xl text-sm leading-6">
          Assess an agent skill package against the OWASP Agentic Skills Top 10. The result tells you what was assessed, what evidence was observed, which gaps were identified, and what could not be assessed &mdash; and, if you ask, carries a cryptographic signature from Agent Verify.
        </p>
        <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="mt-5 space-y-2 rounded-2xl p-4">
          <p style={{ color: 'var(--text-secondary)' }} className="text-xs leading-relaxed">{IMPLEMENTED_CONTROLS_DISCLAIMER}</p>
          <p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed">{OWASP_ATTRIBUTION_DISCLAIMER}</p>
        </div>

        <h2 style={{ color: 'var(--text-primary)' }} className="mt-10 text-sm font-semibold uppercase tracking-wider">Three statuses, never a pass/fail</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {STATUSES.map(status => (
            <div key={status} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
              <StatusPill status={status} />
              <p style={{ color: 'var(--text-secondary)' }} className="mt-3 text-xs leading-relaxed">{STATUS_MEANING[status]}</p>
            </div>
          ))}
        </div>

        <h2 style={{ color: 'var(--text-primary)' }} className="mt-10 text-sm font-semibold uppercase tracking-wider">Run it</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
            <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Dashboard</p>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-xs leading-relaxed">Sign in, open Scan, and choose &ldquo;OWASP Agentic Skills profile.&rdquo; Tick &ldquo;Request cryptographic signing&rdquo; for a signed result.</p>
          </div>
          <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
            <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">CLI</p>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-1 break-all font-mono text-xs leading-relaxed">agentverify scan ./my-skill --profile {OWASP_PROFILE_ID}</p>
          </div>
          <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
            <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">API</p>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-xs leading-relaxed"><code>POST /v1/scan</code> with <code>profile</code>, and optionally <code>attest: true</code>. <Link href="/docs#owasp-profile" className="underline">Read the docs</Link>.</p>
          </div>
        </div>
        <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">A profile assessment, signed or unsigned, uses one scan from your normal monthly quota. Signing does not change the result.</p>

        <div style={{ backgroundColor: '#7C3AED1A', border: '1px solid #7C3AED55' }} className="mt-10 rounded-2xl px-5 py-4">
          <p style={{ color: 'var(--demo-banner-text)' }} className="text-xs font-bold uppercase tracking-[0.22em]">Sample assessment &mdash; synthetic skill</p>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-sm">
            Below is the real output of Agent Verify&apos;s assessment engine for a synthetic &ldquo;expense approver&rdquo; skill, not a customer&apos;s package. This sample is unsigned; signed assessments show an extra attestation section and can be checked against the <Link href="/profile-attestation" className="underline">published signing key</Link>.
          </p>
        </div>

        <details style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mt-4 rounded-2xl p-4">
          <summary style={{ color: 'var(--text-primary)' }} className="cursor-pointer text-sm font-semibold">Show the skill package that was assessed</summary>
          <pre
            tabIndex={0}
            role="region"
            aria-label="Assessed skill package"
            style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)' }}
            className="mt-3 overflow-x-auto rounded-lg px-4 py-3 font-mono text-xs leading-relaxed text-[color:var(--accent-cyan-text)]"
          >{skillSource}</pre>
        </details>

        <div className="mt-6">
          <OwaspProfileResult response={sampleResponse} />
        </div>

        <div className="mt-10 text-center">
          <Link href="/dashboard" className="inline-flex rounded-2xl bg-[#7C3AED] px-6 py-3 text-sm font-semibold text-white hover:opacity-90">Assess your own skill</Link>
        </div>
      </div>
    </main>
  )
}
