import type { Metadata } from 'next'
import Link from 'next/link'
import { PROFILE_ATTESTATION_PUBLIC_IDENTITY as KEY, PROFILE_ATTESTATION_KEY_API_ROUTE } from '@/lib/profileAttestationKey'
import { SIGNATURE_SCOPE_DISCLAIMER } from '@/lib/owaspProfile'

const KEY_FILE_URL = 'https://aimodularity.com/agentverify/profile-attestation-key.json'
const API_BASE_URL = 'https://agentverify-api.agentverify.workers.dev'

export const metadata: Metadata = {
  title: 'Profile Attestation Signing Key',
  description: 'The public key Agent Verify uses to sign OWASP Agentic Skills profile assessments, published independently of the API, and how to verify a signed assessment against it.',
  openGraph: {
    title: 'Profile Attestation Signing Key — Agent Verify',
    description: 'The public key Agent Verify uses to sign OWASP Agentic Skills profile assessments, published independently of the API, and how to verify a signed assessment against it.',
    url: 'https://aimodularity.com/agentverify/profile-attestation/',
    siteName: 'Agent Verify',
    type: 'website',
  },
}

function CodeBlock({ children, label = 'Code example' }: { children: string; label?: string }) {
  return (
    <pre
      tabIndex={0}
      role="region"
      aria-label={label}
      style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)' }}
      className="overflow-x-auto rounded-lg px-4 py-3 font-mono text-xs leading-relaxed text-[color:var(--accent-cyan-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#06B6D4]"
    >
      {children}
    </pre>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold uppercase tracking-wide">{label}</dt>
      <dd style={{ color: 'var(--text-primary)' }} className="break-all font-mono text-xs">{value}</dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[var(--border)] py-8">
      <h2 style={{ color: 'var(--text-primary)' }} className="text-xl font-semibold tracking-tight">{title}</h2>
      <div style={{ color: 'var(--text-secondary)' }} className="mt-4 space-y-4 text-sm leading-relaxed">{children}</div>
    </section>
  )
}

export default function ProfileAttestationPage() {
  return (
    <main style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-10 md:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-purple-text)]">Trust</p>
        <h1 style={{ color: 'var(--text-primary)' }} className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">Profile attestation signing key</h1>
        <p style={{ color: 'var(--text-secondary)' }} className="mt-3 text-sm leading-6">
          When you request a signed <Link href="/owasp-agentic-skills" className="underline">OWASP Agentic Skills assessment</Link>, Agent Verify signs it with the key below. This page publishes that key
          independently of the API, so you can check a signed assessment against a key you obtained from a channel other than the assessment itself.
        </p>

        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mt-8 rounded-2xl p-5">
          <h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold uppercase tracking-wider">Production key (public half)</h2>
          <dl className="mt-2 divide-y divide-[var(--border)]">
            <Row label="Issuer" value={KEY.issuer} />
            <Row label="Key ID" value={KEY.keyId} />
            <Row label="Algorithm" value={KEY.algorithm} />
            <Row label="Purpose" value={KEY.purpose} />
            <Row label="Public key (JWK)" value={JSON.stringify(KEY.publicKey)} />
          </dl>
          <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">
            Key ID is the RFC 7638 JWK thumbprint of the public key (SHA-256 over the canonical <code>{`{"crv","kty","x","y"}`}</code> JSON, base64url) &mdash; recompute it yourself rather than trusting the value shown. Machine-readable copy:{' '}
            <a href={KEY_FILE_URL} className="underline">profile-attestation-key.json</a>.
          </p>
        </div>

        <Section title="Verify a signed assessment">
          <p>A signed assessment is a bundle of <code>{`{ bundleVersion, attestation, assessment }`}</code>. Download it from the result screen (Profile &amp; technical details &rarr; Download), or take the <code>assessment</code>, <code>attestation</code> and <code>bundleVersion</code> fields from the API response.</p>
          <ol className="ml-4 list-decimal space-y-2">
            <li><strong>Get the key from two places.</strong> This page and <code>GET {API_BASE_URL}{PROFILE_ATTESTATION_KEY_API_ROUTE}</code>. Both must agree.</li>
            <li><strong>Pin the key.</strong> Require the bundle&apos;s <code>attestation.publicKey</code> and <code>attestation.payload.keyId</code> to equal the published key. A signature that verifies against a key the bundle brought with it proves only that the bundle is self-consistent.</li>
            <li><strong>Verify the signature and bindings.</strong> The reference verifier checks the signature, that the Key ID matches the embedded key, that the assessment digest matches the signed payload, and every cross-field binding.</li>
          </ol>
          <CodeBlock label="Verification example">{`// Node 20+. verifier: conformance/v4/reference/ in the open-source repo
// https://github.com/AI-Blockchain-Ventures/agentverify
import { readFileSync } from 'node:fs'
import { verifyProfileBundleBytes } from './conformance/v4/reference/profileAttestation.mjs'

const bytes = readFileSync('bundle.json')
const bundle = JSON.parse(bytes.toString('utf8'))

// 1-2. The published key is the trust anchor, not the bundle's own key.
const published = await (await fetch('${API_BASE_URL}${PROFILE_ATTESTATION_KEY_API_ROUTE}')).json()
const pinned =
  published.keyId === bundle.attestation.payload.keyId &&
  JSON.stringify(published.publicKey) === JSON.stringify(bundle.attestation.publicKey)

// 3. Signature, digest and binding checks.
const result = await verifyProfileBundleBytes(bytes)
console.log(pinned && result.integrity === 'VALID' && result.interpretation === 'SUPPORTED')`}</CodeBlock>
        </Section>

        <Section title="What a valid signature means">
          <p>{SIGNATURE_SCOPE_DISCLAIMER}</p>
          <ul className="ml-4 list-disc space-y-1">
            <li><strong>Proves:</strong> the assessment is exactly what Agent Verify issued, unmodified; the issuer is Agent Verify, because the key is published independently; and the signature is bound to this exact package, assessment and profile version.</li>
            <li><strong>Does not prove:</strong> that every finding is correct or complete, and it is not an OWASP certification or endorsement.</li>
          </ul>
        </Section>

        <Section title="What this release does not provide">
          <p>This is a single published key, not a key set. It does not yet provide key retirement or revocation history, rollback detection, or trusted timestamping. The <code>issuedAt</code> value in a bundle is Agent Verify&apos;s own clock, signed with the assessment, not an independent timestamp. When any of these are added, they will be published here.</p>
        </Section>

        <p style={{ color: 'var(--text-muted)' }} className="border-t border-[var(--border)] pt-6 text-xs">
          Related: <Link href="/owasp-agentic-skills" className="underline">OWASP Agentic Skills profile</Link> &middot; <Link href="/docs#owasp-profile" className="underline">API and CLI documentation</Link>
        </p>
      </div>
    </main>
  )
}
