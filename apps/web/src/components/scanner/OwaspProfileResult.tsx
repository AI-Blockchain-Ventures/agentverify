'use client'

import { useState } from 'react'
import type { ProfileAssessmentResponse } from '@/types/profileAssessment'
import {
  buildControlRows, IMPLEMENTED_CONTROLS_DISCLAIMER, OWASP_ATTRIBUTION_DISCLAIMER, SIGNATURE_SCOPE_DISCLAIMER,
  PUBLIC_KEY_VERIFICATION_GUIDANCE, PUBLIC_KEY_ROUTE, PROFILE_VERSION_CLARIFICATION,
} from '@/lib/owaspProfile'
import { OwaspControlCard } from './OwaspControlCard'
import { copyToClipboard } from '@/lib/clipboard'

interface OwaspProfileResultProps {
  response: ProfileAssessmentResponse
  onNewAssessment: () => void
  /** Testability only (default false, matching the real product default: technical details start collapsed —
   * requirement 12). Static server rendering cannot simulate the "expand" click a real visitor makes, so tests
   * that need to assert on the collapsed content's presence pass this rather than changing the shipped default. */
  initiallyShowDetails?: boolean
}

/**
 * Renders the typed assessment the backend returned. This component does not parse skill files, infer a
 * status, derive an OWASP mapping, or recompute any evidence, coverage number, or digest — every value shown
 * below is read directly from `response` (requirement 9). It only formats and lays out what the backend
 * already decided.
 */
export function OwaspProfileResult({ response, onNewAssessment, initiallyShowDetails = false }: OwaspProfileResultProps) {
  const { assessment, attestation } = response
  const rows = buildControlRows(assessment.controls)
  const [showDetails, setShowDetails] = useState(initiallyShowDetails)
  const [showAttestation, setShowAttestation] = useState(Boolean(attestation))
  const [copied, setCopied] = useState(false)

  const gapCount = assessment.controls.filter(c => c.status === 'GAP_IDENTIFIED').length
  const observedCount = assessment.controls.filter(c => c.status === 'EVIDENCE_OBSERVED').length

  const exportBundle = attestation
    ? { bundleVersion: response.bundleVersion ?? '1.0.0', attestation, assessment }
    : { profile: response.profile, assessment }
  const exportText = JSON.stringify(exportBundle, null, 2)

  const copy = async () => {
    if (await copyToClipboard(exportText)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }
  const download = () => {
    const blob = new Blob([exportText], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `owasp-agentic-skills-assessment${attestation ? '-signed' : ''}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* ── Summary header ─────────────────────────────────────────────────────────────────── */}
      <div className="rounded-[2rem] border border-[var(--border)] bg-[radial-gradient(circle_at_top_right,rgba(6,182,212,0.10),transparent_32%),var(--card)] p-6 shadow-2xl shadow-black/10 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-purple-text)]">OWASP profile assessment</p>
            <h1 style={{ color: 'var(--text-primary)' }} className="mt-2 text-2xl font-semibold tracking-tight">OWASP Agentic Skills Top 10</h1>
          </div>
          <button onClick={onNewAssessment} style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }} className="no-print rounded-xl px-3.5 py-2 text-xs font-semibold hover:opacity-70">
            New assessment
          </button>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <SummaryStat label="Assessed" value={String(observedCount)} tone="green" />
          <SummaryStat label="Gaps identified" value={String(gapCount)} tone={gapCount > 0 ? 'red' : 'muted'} />
          <SummaryStat label="Not assessed" value={String(10 - assessment.controls.length)} tone="muted" />
          <div className={`flex items-center gap-2 rounded-2xl border px-4 py-2.5 ${attestation ? 'border-[#00B37E]/25 bg-[#00B37E]/10' : 'border-[var(--border)] bg-[var(--surface)]'}`}>
            <span className={`h-2 w-2 rounded-full ${attestation ? 'bg-[#00B37E]' : 'bg-[var(--text-muted)]'}`} aria-hidden />
            <span style={{ color: attestation ? undefined : 'var(--text-secondary)' }} className={`text-xs font-semibold ${attestation ? 'text-[color:var(--accent-green-text)]' : ''}`}>
              {attestation ? 'Cryptographically signed' : 'Signed attestation: Not requested'}
            </span>
          </div>
        </div>

        {/* ── Required disclaimers (verbatim) ──────────────────────────────────────────────── */}
        <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="mt-5 space-y-2 rounded-2xl p-4">
          <p style={{ color: 'var(--text-secondary)' }} className="text-xs leading-relaxed">{IMPLEMENTED_CONTROLS_DISCLAIMER}</p>
          <p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed">{OWASP_ATTRIBUTION_DISCLAIMER}</p>
        </div>
      </div>

      {/* ── The ten controls ──────────────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold uppercase tracking-wider">Controls</h2>
        {rows.map(row => <OwaspControlCard key={row.id} row={row} allEvidence={assessment.evidence} />)}
      </div>

      {/* ── Signed attestation ───────────────────────────────────────────────────────────── */}
      <div style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }} className="rounded-2xl border p-5">
        <button onClick={() => setShowAttestation(!showAttestation)} className="flex w-full items-center justify-between text-left" aria-expanded={showAttestation}>
          <h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Signed attestation</h2>
          <span style={{ color: 'var(--text-muted)' }} className="text-xs">{showAttestation ? '↑' : '↓'}</span>
        </button>
        {showAttestation && (attestation ? (
          <div className="mt-4 space-y-3 text-sm">
            <p className="text-sm font-semibold text-[color:var(--accent-green-text)]">Cryptographically signed by Agent Verify</p>
            <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
              <DetailRow label="Issuer" value={attestation.payload.issuer} />
              <DetailRow label="Key ID" value={attestation.payload.keyId} mono />
              <DetailRow label="Algorithm" value={attestation.algorithm} />
              <DetailRow label="Bundle version" value={response.bundleVersion ?? '1.0.0'} />
            </dl>
            <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-xl p-3">
              <p style={{ color: 'var(--text-secondary)' }} className="text-xs">{PUBLIC_KEY_VERIFICATION_GUIDANCE}</p>
              <p style={{ color: 'var(--text-muted)' }} className="mt-1 font-mono text-[11px]">{PUBLIC_KEY_ROUTE}</p>
            </div>
            <div className="rounded-xl border border-[#E07B39]/25 bg-[#E07B39]/10 p-3">
              <p className="text-xs text-[color:var(--accent-orange-text)]">{SIGNATURE_SCOPE_DISCLAIMER}</p>
            </div>
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">
            This assessment was not signed. Signing is an explicit, separate request (`attest: true`) and does not change the assessment result or cost.
          </p>
        ))}
      </div>

      {/* ── Technical / profile details (secondary) ─────────────────────────────────────────── */}
      <div style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }} className="rounded-2xl border p-5">
        <button onClick={() => setShowDetails(!showDetails)} className="flex w-full items-center justify-between text-left" aria-expanded={showDetails}>
          <h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Profile &amp; technical details</h2>
          <span style={{ color: 'var(--text-muted)' }} className="text-xs">{showDetails ? '↑' : '↓'}</span>
        </button>
        {showDetails && (
          <div className="mt-4 space-y-4 text-xs">
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <DetailRow label="Profile ID" value={assessment.profile.profileId} mono />
              <DetailRow label="Framework" value={assessment.profile.framework} />
              <DetailRow label="Agent Verify profile version" value={assessment.profile.agentverifyProfileVersion} mono />
              <DetailRow label="Assessment schema version" value={assessment.schemaVersion} mono />
              <DetailRow label="Upstream commit (pinned)" value={assessment.profile.upstreamCommit} mono />
              <DetailRow label="Upstream license" value={assessment.profile.upstreamLicense} />
              <DetailRow label="Package digest" value={assessment.package.digest} mono />
              <DetailRow label="Scanner version" value={assessment.profile.scannerVersion} mono />
              <DetailRow label="Assessment engine version" value={assessment.profile.assessmentEngineVersion} mono />
              <DetailRow label="Normalization version" value={assessment.profile.normalizationVersion} mono />
              <DetailRow label="Risk rubric version" value={assessment.profile.riskRubricVersion} mono />
              <DetailRow label="Key allowlist version" value={assessment.profile.keyAllowlistVersion} mono />
            </dl>
            <p style={{ color: 'var(--text-muted)', borderColor: 'var(--border)' }} className="rounded-lg border p-2.5">{PROFILE_VERSION_CLARIFICATION}</p>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
              <p style={{ color: 'var(--text-muted)' }} className="text-xs">Export the exact assessment (and signature, if present) as JSON.</p>
              <div className="no-print flex gap-2">
                <button onClick={copy} style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }} className="rounded-xl px-3.5 py-2 text-xs font-semibold hover:opacity-70">{copied ? 'Copied' : 'Copy JSON'}</button>
                <button onClick={download} className="rounded-xl bg-[#7C3AED] px-3.5 py-2 text-xs font-semibold text-white">Download</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryStat({ label, value, tone }: { label: string; value: string; tone: 'green' | 'red' | 'muted' }) {
  const toneClass = tone === 'green' ? 'border-[#00B37E]/25 bg-[#00B37E]/10 text-[color:var(--accent-green-text)]'
    : tone === 'red' ? 'border-[#EF4444]/25 bg-[#EF4444]/10 text-[color:var(--accent-red-text)]'
    : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]'
  return (
    <div className={`rounded-2xl border px-4 py-2.5 ${toneClass}`}>
      <span className="text-sm font-semibold">{value}</span>
      <span style={{ color: 'var(--text-muted)' }} className="ml-1.5 text-xs">{label}</span>
    </div>
  )
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wide">{label}</dt>
      <dd style={{ color: 'var(--text-secondary)' }} className={`mt-0.5 break-all ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  )
}
