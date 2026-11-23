'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { getApiBaseUrl } from '@/lib/billing'
import { copyToClipboard } from '@/lib/clipboard'

/**
 * Public verified-agent profile: /agent?slug=... Everything shown comes from GET /v1/agents/{slug}, which only
 * returns what the owner published and never anything private (no prompts, replies, commands or findings).
 * The signature is checked here in the visitor's browser against Agent Verify's published key.
 */

type CheckStatus = 'pass' | 'fail' | 'stale' | 'missing'
interface Statement {
  type: string; version: number; slug: string; name: string; description: string
  owner: { website: string | null; domain: string | null; domainVerified: boolean }
  checks: {
    scan: { status: CheckStatus; verdict: string | null; score: number | null; scannedAt: string | null; artifactHash: string | null }
    injectionTests: { status: CheckStatus; testedAt: string | null; attacks: number; gotThrough: number; needsReview: number; weekly: boolean; byOwasp: Record<string, { name: string; resisted: number; total: number }> }
    runtimeGuard: { status: CheckStatus; lastSeenAt: string | null; last7Days: { blocked: number; askedAPerson: number; allowed: number } }
  }
  verified: boolean
  issuedAt: string
}
interface Signature { signature: string; algorithm: string; signedPrefix: string; issuer: string; publicKeyUrl: string }
type SigCheck = 'checking' | 'valid' | 'invalid' | 'unsigned'

/** Same as the API's canonicalJson: keys sorted at every level. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(value)
}

async function checkSignature(statement: Statement, sig: Signature | null): Promise<SigCheck> {
  if (!sig) return 'unsigned'
  try {
    // The key comes from Agent Verify's own endpoint, never from the response being checked.
    const keyRes = await fetch(`${getApiBaseUrl()}/v1/attestation/public-key`)
    if (!keyRes.ok) return 'invalid'
    const { publicKey } = await keyRes.json() as { publicKey: JsonWebKey }
    const key = await crypto.subtle.importKey('jwk', { kty: publicKey.kty, crv: publicKey.crv, x: publicKey.x, y: publicKey.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    const bytes = Uint8Array.from(atob(sig.signature), c => c.charCodeAt(0))
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes, new TextEncoder().encode(sig.signedPrefix + canonicalJson(statement)))
    return ok && sig.signedPrefix === 'agentverify-agent-profile-v1\n' ? 'valid' : 'invalid'
  } catch {
    return 'invalid'
  }
}

const STATUS: Record<CheckStatus, { label: string; color: string; mark: string }> = {
  pass: { label: 'Passed', color: 'var(--accent-green-text)', mark: '✓' },
  fail: { label: 'Not passed', color: 'var(--accent-red-text)', mark: '✕' },
  stale: { label: 'Out of date', color: 'var(--accent-orange-text)', mark: '!' },
  missing: { label: 'Not set up', color: 'var(--text-muted)', mark: '–' },
}
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '')

function Check({ title, status, children }: { title: string; status: CheckStatus; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl p-5" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
        <span className="shrink-0 text-sm font-semibold" style={{ color: STATUS[status].color }}>{STATUS[status].mark} {STATUS[status].label}</span>
      </div>
      <div className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>{children}</div>
    </section>
  )
}

function AgentProfileInner() {
  const slug = useSearchParams().get('slug') ?? ''
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'missing' } | { kind: 'error' } | { kind: 'ready'; statement: Statement; signature: Signature | null }>({ kind: 'loading' })
  const [sig, setSig] = useState<SigCheck>('checking')
  const [copied, setCopied] = useState('')

  useEffect(() => {
    if (!/^[a-z0-9-]{3,60}$/.test(slug)) { setState({ kind: 'missing' }); return }
    void (async () => {
      try {
        const res = await fetch(`${getApiBaseUrl()}/v1/agents/${encodeURIComponent(slug)}`)
        if (res.status === 404) { setState({ kind: 'missing' }); return }
        if (!res.ok) { setState({ kind: 'error' }); return }
        const body = await res.json() as { statement: Statement; signature: Signature | null }
        setState({ kind: 'ready', ...body })
        setSig(await checkSignature(body.statement, body.signature))
      } catch {
        setState({ kind: 'error' })
      }
    })()
  }, [slug])

  if (state.kind === 'loading') return <p className="p-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
  if (state.kind !== 'ready') {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>{state.kind === 'missing' ? 'No public profile here' : 'Could not load this profile'}</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>{state.kind === 'missing' ? 'The link may be wrong, or the owner unpublished it.' : 'Please try again in a moment.'}</p>
      </div>
    )
  }

  const s = state.statement
  const { scan, injectionTests: inj, runtimeGuard: rt } = s.checks
  const api = getApiBaseUrl()
  const pageUrl = typeof window !== 'undefined' ? window.location.href : ''
  const badgeUrl = `${api}/v1/agents/${s.slug}/badge.svg`
  const badgeMd = `[![Agent Verify](${badgeUrl})](${pageUrl})`
  const copy = async (what: string, text: string) => { if (await copyToClipboard(text)) { setCopied(what); setTimeout(() => setCopied(''), 1500) } }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-10">
      <header className="rounded-3xl p-6" style={{ backgroundColor: 'var(--card)', border: `2px solid ${s.verified ? 'var(--accent-green-text)' : 'var(--border)'}` }}>
        <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: s.verified ? 'var(--accent-green-text)' : 'var(--text-muted)' }}>{s.verified ? '✓ Verified agent' : 'Agent security profile'}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>{s.name}</h1>
        {s.description && <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>{s.description}</p>}
        {s.owner.website && (
          <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
            By <a href={s.owner.website} rel="noopener noreferrer nofollow" target="_blank" className="underline">{s.owner.domain}</a>{' '}
            {s.owner.domainVerified ? <span style={{ color: 'var(--accent-green-text)' }}>· owner verified</span> : <span style={{ color: 'var(--text-muted)' }}>· domain not verified</span>}
          </p>
        )}
        <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          {s.verified ? 'Passed a security scan and every prompt-injection test in the last 30 days.' : 'A verified agent passes a security scan and every prompt-injection test, both within the last 30 days.'} Checked {day(s.issuedAt)}.
        </p>
      </header>

      <Check title="Security scan" status={scan.status}>
        {scan.status === 'missing' ? 'No scan linked yet.' : <>Result <strong>{scan.verdict === 'VERIFIED' ? 'VERIFIED' : scan.verdict?.replace('_', ' ')}</strong>, score {scan.score}/100, scanned {day(scan.scannedAt)}.{scan.artifactHash && <> <Link href={`/verify?hash=${encodeURIComponent(scan.artifactHash)}`} className="underline">Check the scan</Link></>}</>}
      </Check>

      <Check title="Prompt-injection tests" status={inj.status}>
        {inj.status === 'missing' ? 'No tests run yet.' : (
          <>
            <p>{inj.attacks - inj.gotThrough} of {inj.attacks} attacks resisted, tested {day(inj.testedAt)}{inj.weekly ? ', re-tested every week' : ''}.{inj.needsReview ? ` ${inj.needsReview} marked for a human to review.` : ''} Includes checking what the agent actually tried to do, not only what it said.</p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {Object.entries(inj.byOwasp).sort().map(([code, b]) => (
                <li key={code} className="flex items-center justify-between rounded-xl px-3 py-2 text-xs" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)' }}>
                  <span><span className="font-semibold">OWASP {code}</span> · {b.name}</span>
                  <span className="font-semibold tabular-nums" style={{ color: b.resisted === b.total ? 'var(--accent-green-text)' : 'var(--accent-red-text)' }}>{b.resisted}/{b.total}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Check>

      <Check title="Runtime protection (Agent Guard)" status={rt.status}>
        {rt.status === 'missing' ? 'Not connected.' : rt.status === 'stale' ? 'Connected, but no activity in the last 7 days.' : (
          <>Active, last seen {day(rt.lastSeenAt)}. In the last 7 days it blocked {rt.last7Days.blocked}, sent {rt.last7Days.askedAPerson} to a person to approve, and allowed {rt.last7Days.allowed} actions.</>
        )}
      </Check>

      <section className="rounded-2xl p-5 text-sm" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
        <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
          Signature: {sig === 'checking' ? 'checking…' : sig === 'valid' ? <span style={{ color: 'var(--accent-green-text)' }}>✓ valid, issued by Agent Verify</span> : sig === 'unsigned' ? <span style={{ color: 'var(--text-muted)' }}>not signed</span> : <span style={{ color: 'var(--accent-red-text)' }}>✕ does not match</span>}
        </p>
        <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>Your browser checked this page&apos;s data against Agent Verify&apos;s public key at <code>{api}/v1/attestation/public-key</code>. The evidence comes from Agent Verify&apos;s own records, not from the agent&apos;s owner.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={badgeUrl} alt="Agent Verify badge" height={20} />
          <button type="button" onClick={() => copy('badge', badgeMd)} className="rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }}>{copied === 'badge' ? 'Copied' : 'Copy badge for a README'}</button>
          <button type="button" onClick={() => copy('link', pageUrl)} className="rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }}>{copied === 'link' ? 'Copied' : 'Copy link'}</button>
        </div>
      </section>
      <p className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>Want a profile like this for your agent? <Link href="/signup" className="underline">Try Agent Verify free</Link></p>
    </div>
  )
}

export default function AgentProfilePage() {
  return (
    <main style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen">
      <Suspense fallback={<div className="min-h-screen" />}>
        <AgentProfileInner />
      </Suspense>
    </main>
  )
}
