import Link from 'next/link'
import { Fragment } from 'react'

type Cell = boolean | string

// Every row reflects what the product actually enforces today (workers/api/src/billing.ts):
// all checks, imports, CLI/API keys, workspaces and the OWASP profile are on every plan; Pro adds
// quota, full remediation, corrected code, A2SPA guidance and PDF export.
const ROWS: Array<{ group: string; items: Array<[string, Cell, Cell, Cell]> }> = [
  {
    group: 'Find the problems',
    items: [
      ['Scans per month', '10', '100', 'Per member — sized with you'],
      ['All 76 security checks (incl. framework + MCP packs)', true, true, true],
      ['Verdict, 0–100 security score, prioritized findings', true, true, true],
      ['Scan a GitHub repo, a .zip, many files, or an MCP config', true, true, true],
      ['OWASP Agentic Skills assessment (+ optional signature)', true, true, true],
      ['Compliance mapping: OWASP LLM Top 10, NIST AI RMF, SOC 2', true, true, true],
    ],
  },
  {
    group: 'Fix them fast',
    items: [
      ['Step-by-step fix guidance for every finding', false, true, true],
      ['Corrected code you can copy in', false, true, true],
      ['A2SPA execution-authorization guidance', false, true, true],
      ['Copyable fix checklist (GitHub / Jira / Slack)', true, true, true],
    ],
  },
  {
    group: 'Ship with proof',
    items: [
      ['PDF security report for clients, auditors, and leadership', false, true, true],
      ['Shareable report link + verified badge', true, true, true],
      ['CLI + GitHub Action to block risky merges', true, true, true],
    ],
  },
  {
    group: 'Work as a team',
    items: [
      ['Shared workspace with roles and team API keys', true, true, true],
      ['Pro features for every member', false, false, true],
      ['Onboarding call + priority support', false, false, true],
    ],
  },
]

function Mark({ value }: { value: Cell }) {
  if (typeof value === 'string') return <span style={{ color: 'var(--text-primary)' }} className="text-xs font-semibold">{value}</span>
  return value
    ? <span className="text-base font-bold text-[color:var(--accent-green-text)]" aria-label="Included">✓</span>
    : <span style={{ color: 'var(--text-muted)' }} className="text-base" aria-label="Not included">—</span>
}

export function PlanComparison() {
  return (
    <section className="mt-16" aria-labelledby="compare-heading">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[color:var(--accent-cyan-text)]">Compare plans</p>
        <h2 id="compare-heading" style={{ color: 'var(--text-primary)' }} className="mt-2 text-3xl font-semibold tracking-tight">Free finds the problems. Pro fixes them.</h2>
        <p style={{ color: 'var(--text-secondary)' }} className="mx-auto mt-3 max-w-2xl text-sm leading-6">Every plan runs the same 76 checks — we never hide a risk behind a paywall. Pro is for when you need to actually fix what was found, quickly, and show proof that you did.</p>
      </div>
      <div tabIndex={0} role="region" aria-label="Plan comparison table" style={{ border: '1px solid var(--border)' }} className="mt-8 overflow-x-auto rounded-3xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#06B6D4]">
        <table className="w-full min-w-[620px] border-collapse text-left text-sm">
          <thead>
            <tr style={{ backgroundColor: 'var(--surface)' }}>
              <th style={{ color: 'var(--text-muted)' }} className="px-4 py-3 text-xs font-semibold uppercase tracking-wider">Feature</th>
              <th style={{ color: 'var(--text-primary)' }} className="w-28 px-4 py-3 text-center font-semibold">Free</th>
              <th className="w-28 bg-[#06B6D4]/10 px-4 py-3 text-center font-semibold text-[color:var(--accent-cyan-text)]">Pro · $19.99</th>
              <th style={{ color: 'var(--text-primary)' }} className="w-32 px-4 py-3 text-center font-semibold">Team · $79</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(group => (
              <Fragment key={group.group}>
                <tr style={{ backgroundColor: 'var(--card)', borderTop: '1px solid var(--border)' }}>
                  <td colSpan={4} className="px-4 pb-1 pt-4 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--accent-purple-text)]">{group.group}</td>
                </tr>
                {group.items.map(([label, free, pro, team]) => (
                  <tr key={label} style={{ backgroundColor: 'var(--card)' }}>
                    <td style={{ color: 'var(--text-secondary)' }} className="px-4 py-2.5">{label}</td>
                    <td className="px-4 py-2.5 text-center"><Mark value={free} /></td>
                    <td className="bg-[#06B6D4]/5 px-4 py-2.5 text-center"><Mark value={pro} /></td>
                    <td className="px-4 py-2.5 text-center"><Mark value={team} /></td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** A concrete before/after of one real finding, so the Pro difference is visible, not described. */
export function ProPreview() {
  return (
    <section className="mt-16" aria-labelledby="pro-preview-heading">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[color:var(--accent-cyan-text)]">What Pro unlocks</p>
        <h2 id="pro-preview-heading" style={{ color: 'var(--text-primary)' }} className="mt-2 text-3xl font-semibold tracking-tight">Same finding. One tells you it&apos;s broken. One fixes it.</h2>
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-5">
          <p style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold uppercase tracking-wider">Free</p>
          <p style={{ color: 'var(--text-primary)' }} className="mt-3 text-sm font-semibold">Critical · SQL query built from unescaped input</p>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-2 text-sm leading-6">A SQL statement is assembled by string concatenation instead of bound parameters. Line 14.</p>
          <pre tabIndex={0} role="region" aria-label="Code with the problem" style={{ backgroundColor: 'var(--surface)', color: 'var(--text-secondary)' }} className="mt-3 overflow-x-auto rounded-xl p-3 font-mono text-xs">db.query(&apos;SELECT * FROM invoices WHERE id = &apos; + invoiceId)</pre>
          <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">You know what&apos;s wrong — now you research the fix yourself.</p>
        </div>
        <div className="rounded-3xl border border-[#06B6D4]/50 bg-[var(--card)] p-5 shadow-[0_18px_50px_rgba(6,182,212,0.12)]">
          <p className="text-xs font-semibold uppercase tracking-wider text-[color:var(--accent-cyan-text)]">Pro</p>
          <p style={{ color: 'var(--text-primary)' }} className="mt-3 text-sm font-semibold">Critical · SQL query built from unescaped input</p>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-2 text-sm leading-6">Use bound parameters for every value, and give the agent a read-only database role limited to the tables it needs.</p>
          <pre tabIndex={0} role="region" aria-label="Corrected code" className="mt-3 overflow-x-auto rounded-xl border border-[#00B37E]/20 bg-[#00B37E]/5 p-3 font-mono text-xs text-[color:var(--accent-green-text)]">db.query(&apos;SELECT * FROM invoices WHERE id = $1&apos;, [invoiceId])</pre>
          <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">Copy the fix, re-scan to confirm, export the PDF for your records.</p>
        </div>
      </div>
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {[
          ['Minutes, not hours', 'Corrected code for each finding instead of researching every fix from scratch.'],
          ['Scan every change', '100 scans a month covers re-scanning after each fix and every pull request in CI.'],
          ['Proof for buyers', 'A PDF security report your clients, auditors, and leadership can read.'],
        ].map(([title, body]) => (
          <div key={title} style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
            <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{title}</p>
            <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs leading-5">{body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

const FAQ: Array<[string, string]> = [
  ['Do free scans run fewer checks?', 'No. Every plan runs all 76 checks. Free shows you what is wrong; Pro adds the step-by-step fix, corrected code, A2SPA guidance, and PDF export.'],
  ['Can my developers use it before every deploy?', 'Yes, on any plan. Create an API key in the dashboard, then run the CLI or the GitHub Action — risky changes fail the check before they merge. See the Developers page.'],
  ['What counts as a scan?', 'Each scan you run — from the dashboard, the CLI, the API, or the GitHub Action — uses one scan from the same monthly quota. Scanning a whole GitHub repo or .zip is still one scan.'],
  ['Is my code safe?', 'Scans run on Agent Verify’s server, never in your browser. Detected secrets are redacted before anything is saved, and reports stay private until you choose to share them.'],
  ['How does Team work?', 'Talk to us and we set up a shared workspace for your team with Pro features for every member, roles, team API keys, and an onboarding call.'],
  ['Can I cancel anytime?', 'Yes. Manage or cancel Pro from the billing portal; you keep Pro until the end of the period you paid for.'],
]

export function PricingFaq() {
  return (
    <section className="mx-auto mt-16 max-w-3xl" aria-labelledby="pricing-faq-heading">
      <h2 id="pricing-faq-heading" style={{ color: 'var(--text-primary)' }} className="text-center text-2xl font-semibold tracking-tight">Questions</h2>
      <div className="mt-6 space-y-2">
        {FAQ.map(([q, a]) => (
          <details key={q} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl px-5 py-4">
            <summary style={{ color: 'var(--text-primary)' }} className="cursor-pointer text-sm font-semibold">{q}</summary>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-2 text-sm leading-6">{a}</p>
          </details>
        ))}
      </div>
      <div className="mt-8 text-center">
        <Link href="/developers" className="text-sm font-semibold text-[color:var(--accent-purple-text)] underline-offset-2 hover:underline">See how developers run Agent Verify in CI →</Link>
      </div>
    </section>
  )
}
