'use client'

import { useEffect, useState, Suspense } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { verifyAttestation, type SignedAttestation, type AttestationVerificationStatus } from '@/lib/verifyAttestation'
import { getApiBaseUrl } from '@/lib/billing'
import { assetUrl } from '@/lib/assets'
import { copyToClipboard } from '@/lib/clipboard'

/**
 * Public Verification / Trust view — the ONLY thing a company shares externally when they want
 * to prove an agent was verified, without exposing the underlying report. Backed entirely by
 * GET /v1/verification/{artifactHash} (see workers/api/src/verificationStatus.ts), which itself
 * only ever returns this data for a report the owner explicitly marked isPublic — the exact same
 * Private/Public toggle used everywhere else in the product. Revoking that toggle makes this
 * page 404 immediately; nothing here is cached separately from that flag.
 *
 * Deliberately excludes: findings, source code, user email, organization internals, API
 * information, secret data. Only ever renders the small, explicitly public-safe status fields
 * the endpoint returns.
 */

interface VerificationStatus {
  artifactHash: string
  latestScanId: string
  verdict: string
  score: number
  policyProfile: string | null
  policyResult: string | null
  scannerVersion: string | null
  rulesetVersion: string | null
  verifiedAt: string
  reportHash: string | null
  attestation: SignedAttestation | null
  signature: string | null
  status: 'private' | 'public'
}

type PageState =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'invalid' }
  | { kind: 'error' }
  | { kind: 'ready'; status: VerificationStatus; attestationCheck: AttestationVerificationStatus | null }

function VerifyPageInner() {
  const searchParams = useSearchParams()
  const hash = searchParams.get('hash') ?? ''
  const [state, setState] = useState<PageState>({ kind: 'loading' })
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!hash) { setState({ kind: 'invalid' }); return }
    if (!/^[0-9a-f]{64}$/i.test(hash)) { setState({ kind: 'invalid' }); return }

    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${getApiBaseUrl()}/v1/verification/${hash}`)
        if (cancelled) return
        if (res.status === 404) { setState({ kind: 'not_found' }); return }
        if (!res.ok) { setState({ kind: 'error' }); return }
        const status = await res.json() as VerificationStatus

        let attestationCheck: AttestationVerificationStatus | null = null
        if (status.attestation) {
          // Cross-check against the independently-published public key, not just the key the
          // attestation itself claims to be signed with — see attestation.ts's own doc comment
          // on why that distinction matters.
          let expectedPublicKey: JsonWebKey | undefined
          try {
            const keyRes = await fetch(`${getApiBaseUrl()}/v1/attestation/public-key`)
            if (keyRes.ok) expectedPublicKey = (await keyRes.json()).publicKey
          } catch { /* fall back to embedded-key-only verification below */ }
          const result = await verifyAttestation(status.attestation, expectedPublicKey)
          attestationCheck = result.status
        }

        if (!cancelled) setState({ kind: 'ready', status, attestationCheck })
      } catch {
        if (!cancelled) setState({ kind: 'error' })
      }
    })()
    return () => { cancelled = true }
  }, [hash])

  const copyHash = async (value: string) => {
    if (await copyToClipboard(value)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div style={{ backgroundColor: 'var(--bg)' }} className="flex min-h-screen flex-col items-center px-4 py-10 md:py-16">
      <Link href="/" className="mb-8 flex items-center gap-2 transition-opacity hover:opacity-80">
        <Image src={assetUrl('/agentverify-icon.png')} alt="Agent Verify" width={32} height={32} className="h-8 w-8 rounded-xl object-contain" />
        <span style={{ color: 'var(--text-primary)' }} className="text-sm font-bold tracking-tight">Agent Verify</span>
      </Link>

      {state.kind === 'loading' && (
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="w-full max-w-md rounded-3xl p-10 text-center shadow-2xl shadow-black/10">
          <div style={{ borderColor: 'var(--border)', borderTopColor: '#06B6D4' }} className="mx-auto mb-4 h-6 w-6 animate-spin rounded-full border-2" />
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Looking up verification record</p>
        </div>
      )}

      {state.kind === 'invalid' && (
        <TrustCard title="Invalid verification link" body="This link doesn't include a valid artifact fingerprint. Ask whoever shared it to copy the link directly from their Agent Verify report." />
      )}

      {state.kind === 'not_found' && (
        <TrustCard title="No public verification record" body="Either this artifact hasn't been scanned by Agent Verify, or the owner hasn't published this scan for public verification. If you expected to see a record here, ask the owner to check their report's sharing setting." />
      )}

      {state.kind === 'error' && (
        <TrustCard title="Verification lookup failed" body="Something went wrong reaching the verification service. Try again in a moment." />
      )}

      {state.kind === 'ready' && (
        <VerificationReceipt status={state.status} attestationCheck={state.attestationCheck} copied={copied} onCopy={copyHash} />
      )}

      <p style={{ color: 'var(--text-muted)' }} className="mt-8 max-w-md text-center text-xs leading-relaxed">
        This page shows only what the agent&apos;s owner explicitly published for public verification — never findings, source code, or account details.{' '}
        <Link href="/docs" className="underline hover:opacity-80">Learn how Agent Verify works</Link>.
      </p>
    </div>
  )
}

function TrustCard({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="w-full max-w-md rounded-3xl p-8 text-center shadow-2xl shadow-black/10">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E07B39]/10 text-lg font-semibold text-[color:var(--accent-orange-text)]">?</div>
      <p style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">{title}</p>
      <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-sm leading-relaxed">{body}</p>
    </div>
  )
}

function VerificationReceipt({ status, attestationCheck, copied, onCopy }: {
  status: VerificationStatus
  attestationCheck: AttestationVerificationStatus | null
  copied: boolean
  onCopy: (value: string) => void
}) {
  const verified = status.verdict === 'VERIFIED'
  const verifiedDate = status.verifiedAt ? new Date(status.verifiedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'Unknown'

  return (
    <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="av-animate-rise w-full max-w-md overflow-hidden rounded-3xl shadow-2xl shadow-black/10">
      <div className={`p-8 text-center ${verified ? 'bg-[#00B37E]/8' : 'bg-[#E03E3E]/8'}`}>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--accent-cyan-text)]">Agent Verify</p>
        <p className={`mt-3 text-3xl font-bold tracking-tight ${verified ? 'text-[color:var(--accent-green-text)]' : 'text-[color:var(--accent-red-text)]'}`}>
          {verified ? 'VERIFIED' : status.verdict.replace('_', ' ')}
        </p>
        <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">Score {status.score}/100</p>
      </div>

      <div style={{ borderTop: '1px solid var(--border)' }} className="space-y-4 p-6">
        <div>
          <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wider">Artifact fingerprint (SHA-256)</p>
          <div className="mt-1 flex items-center gap-2">
            <code style={{ color: 'var(--text-primary)' }} className="min-w-0 flex-1 break-all font-mono text-xs">{status.artifactHash}</code>
            <button onClick={() => onCopy(status.artifactHash)} style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }} className="av-press shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold">
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          {status.policyProfile && (
            <div>
              <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wider">Policy</p>
              <p style={{ color: 'var(--text-primary)' }} className="mt-0.5 font-medium">{status.policyProfile} · {status.policyResult}</p>
            </div>
          )}
          <div>
            <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wider">Scanner</p>
            <p style={{ color: 'var(--text-primary)' }} className="mt-0.5 font-medium">{status.scannerVersion ?? 'Unknown'}</p>
          </div>
          <div>
            <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wider">Ruleset</p>
            <p style={{ color: 'var(--text-primary)' }} className="mt-0.5 font-medium">{status.rulesetVersion ?? 'Unknown'}</p>
          </div>
          <div>
            <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wider">Verified</p>
            <p style={{ color: 'var(--text-primary)' }} className="mt-0.5 font-medium">{verifiedDate}</p>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border)' }} className="pt-4">
          {status.attestation && attestationCheck === 'VALID' && (
            <p className="flex items-center gap-2 text-sm font-semibold text-[color:var(--accent-green-text)]">
              <span className="h-2 w-2 rounded-full bg-[#00B37E]" aria-hidden="true" /> ATTESTATION VALID
            </p>
          )}
          {status.attestation && attestationCheck && attestationCheck !== 'VALID' && (
            <p className="flex items-center gap-2 text-sm font-semibold text-[color:var(--accent-red-text)]">
              <span className="h-2 w-2 rounded-full bg-[#E03E3E]" aria-hidden="true" /> ATTESTATION {attestationCheck.replace('_', ' ')}
            </p>
          )}
          {!status.attestation && (
            <p style={{ color: 'var(--text-muted)' }} className="text-xs">No signed attestation is attached to this record.</p>
          )}
          <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs leading-relaxed">
            A valid signature proves this record was signed by the holder of the Agent Verify signing key and has not been altered since signing. It does not prove the agent is permanently safe, that the scanner found every possible issue, or that what is currently deployed is this exact artifact — compare the fingerprint above against your own build to confirm that.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen" />}>
      <VerifyPageInner />
    </Suspense>
  )
}
