import Link from 'next/link'
import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata('/trust/', 'Trust Center', 'How Agent Verify handles your code, scan results, tokens and payments — and what it does not do yet.')

/*
 * Every statement here must stay true to how the product works today. If something changes
 * (storage, encryption, a certification), update this page in the same change.
 */
const SECTIONS: Array<{ id: string; title: string; points: Array<string | [string, string]> }> = [
  { id: 'code', title: 'Your code', points: [
    'We do not store the raw agent code you submit. It is analyzed and then discarded.',
    'We store the scan results — verdict, score, findings and file name — so your report history works. Findings can include a short evidence snippet from the line that triggered them, with any secret values masked.',
    'Fix & re-check (Pro) sends your code to our server to re-score it, and, if you press "Fix my file with AI", to Cloudflare Workers AI to write the fixed version. Neither is stored.',
    'We do not use your code or your reports to train AI models.',
    'You can delete any report from your dashboard. To delete your account and all its data, email hello@aiblockchainventures.com.',
    'Pull-request checks read your repository files through the GitHub App permissions you approve, and keep only the results.',
  ] },
  { id: 'encryption', title: 'Encryption', points: [
    'All traffic to the website and API uses HTTPS (TLS).',
    'GitLab/Bitbucket access tokens and the headers for prompt-injection test targets are encrypted at rest with AES-GCM; the key is held as a Cloudflare secret, not in the database.',
    'Payments go through Stripe Checkout. Card details never reach Agent Verify.',
  ] },
  { id: 'access', title: 'Access and accounts', points: [
    'Sign-in is handled by Firebase Authentication (email or Google).',
    'Team plans have owners and members; workspaces have roles and an audit log of security actions.',
    'API keys are created in the dashboard; making a new key turns the old one off.',
  ] },
  { id: 'integrity', title: 'Report integrity', points: [
    ['Reports can be signed so anyone can check they were issued by Agent Verify and have not been changed.', '/profile-attestation'],
    'A signature proves who issued a report and that it is unaltered — not that every finding is complete.',
  ] },
  { id: 'testing', title: 'Safe testing', points: [
    'Prompt-injection tests are only sent to an agent after you prove you own its host (a token file at /.well-known/agentverify.txt).',
    'Tests are limited to one run at a time and a few runs per day.',
  ] },
  { id: 'ai', title: 'AI answers (“Ask”)', points: [
    'Search in the Ask box runs in your browser.',
    'When you ask the AI, your question and the matching help text (and, if you are signed in, matching findings from your own scans) are sent to Cloudflare Workers AI to write the answer.',
    'We keep only a daily count of questions for limits — not the questions themselves.',
  ] },
  { id: 'infrastructure', title: 'Where it runs', points: [
    'API: Cloudflare Workers, with a Cloudflare D1 database for billing, plans and settings.',
    'Accounts and reports: Google Firebase (Authentication and Firestore).',
    'Payments: Stripe. Email (optional alerts and weekly summary): Resend.',
  ] },
]

export default function TrustPage() {
  return (
    <main style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen">
      <section style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="av-container py-14 md:py-20">
          <p className="text-sm font-semibold text-[color:var(--accent-purple-text)]">Trust Center</p>
          <h1 style={{ color: 'var(--text-primary)' }} className="mt-2 max-w-3xl text-3xl font-bold tracking-tight md:text-5xl">How Agent Verify handles your code and data</h1>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-4 max-w-2xl text-base leading-7 md:text-lg">Plain answers for security reviews. If something here is unclear or you need a security questionnaire filled in, email <a className="font-semibold text-[color:var(--accent-purple-text)]" href="mailto:hello@aiblockchainventures.com">hello@aiblockchainventures.com</a>.</p>
          <div className="mt-6 flex flex-wrap gap-2 text-sm">
            {SECTIONS.map(s => <a key={s.id} href={`#${s.id}`} style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)', backgroundColor: 'var(--card)' }} className="rounded-md px-3 py-1.5">{s.title}</a>)}
          </div>
        </div>
      </section>

      <div className="av-container grid gap-4 py-12 md:grid-cols-2">
        {SECTIONS.map(s => (
          <section key={s.id} id={s.id} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="scroll-mt-24 rounded-xl p-6">
            <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">{s.title}</h2>
            <ul className="mt-3 space-y-2.5">
              {s.points.map(p => {
                const [text, href] = Array.isArray(p) ? p : [p, null]
                return (
                  <li key={text} className="flex gap-3 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
                    <span className="mt-0.5 font-bold text-[color:var(--accent-green-text)]" aria-hidden="true">✓</span>
                    <span>{text}{href && <> <Link href={href} className="font-semibold text-[color:var(--accent-purple-text)]">Signing key →</Link></>}</span>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}

        <section id="certifications" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-xl p-6 md:col-span-2">
          <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">Certifications</h2>
          <p className="mt-3 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
            Agent Verify does not hold a SOC 2 or ISO 27001 certification yet. Its compliance features help <em>you</em> collect evidence for EU AI Act, ISO/IEC 42001, SOC 2 and NIST reviews of your agents; that evidence is not a certification of Agent Verify or of your product.
          </p>
          <p className="mt-3 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
            Found a security issue? Please email <a className="font-semibold text-[color:var(--accent-purple-text)]" href="mailto:hello@aiblockchainventures.com">hello@aiblockchainventures.com</a> — we reply to every report. See also the <Link href="/privacy" className="font-semibold text-[color:var(--accent-purple-text)]">privacy policy</Link> and <Link href="/status" className="font-semibold text-[color:var(--accent-purple-text)]">system status</Link>.
          </p>
        </section>
      </div>
    </main>
  )
}
