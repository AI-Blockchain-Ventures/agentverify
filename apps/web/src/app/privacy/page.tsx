'use client'

import Link from 'next/link'
import { Bullets, LegalPage, type LegalSection } from '@/components/legal/LegalPage'

const EMAIL = 'hello@aiblockchainventures.com'
const mail = <a href={`mailto:${EMAIL}`} className="font-semibold text-[color:var(--accent-purple-text)]">{EMAIL}</a>

const COLLECT: Array<[string, string, string]> = [
  ['Account', 'Email, name (from Google sign-in), and a password stored hashed by Firebase. We never see your password.', 'Sign-in and account emails.'],
  ['"About you" (optional)', 'Name, company, role, team size, frameworks you use, and how you heard about us. You can skip it.', 'Understanding who uses Agent Verify, and support.'],
  ['Scan results', 'Verdict, score, findings, short evidence snippets (with secrets redacted), file name and platform. We do not store the raw code you submit.', 'Your reports, history and share links.'],
  ['Free public scan (no account)', 'The code you paste is scanned and not stored. Results for identical code may be cached for up to 6 hours so repeat scans are instant. Your network address is used briefly to enforce limits.', 'Running the demo and preventing abuse.'],
  ['"Ask" questions', 'Your question is sent to Cloudflare Workers AI to write an answer and is not stored. We keep a daily count per account, or per hashed network address.', 'Answering, and enforcing daily limits.'],
  ['Repository connections', 'GitHub installation ID, repository names, scores and pull-request numbers. GitLab and Bitbucket access tokens are encrypted.', 'Pull-request checks and monitoring.'],
  ['Slack', 'Your Slack workspace ID.', 'The /agentverify command.'],
  ['Alerts', 'An email address or Slack webhook address you choose.', 'Sending alerts.'],
  ['Agent Guard', 'Tool name, decision, and a short preview of arguments with secrets masked. Deleted after 30 days.', 'The Agent Guard dashboard.'],
  ['Prompt-injection tests', 'Target address, request headers (encrypted), and short reply excerpts with secrets masked.', 'Showing which attacks worked on your own agent.'],
  ['Billing', 'Plan, Stripe customer ID and seats. Card details are handled by Stripe; we never see them.', 'Billing.'],
  ['Referrals', 'Who invited whom.', 'Giving referral rewards.'],
  ['Weekly email', 'Your preference (off unless you turn it on).', 'Sending the Monday summary.'],
  ['Getting-started emails', 'Up to three short tips emails in your first week (for example, how to connect a repo), only after you verify your email. Every one has a one-click "stop these tips" link.', 'Helping new accounts get set up.'],
  ['Feedback you send', 'Your message, the type (bug, idea, other), the page you were on, and your account email so we can reply.', 'Fixing problems and improving the product.'],
  ['Error reports', 'If a page or our API crashes: the error message, technical details (a stack trace), the page path (never the rest of the address), and your browser type. No page content or anything you typed. Deleted after 90 days.', 'Finding and fixing bugs quickly.'],
  ['Analytics', 'Usage data from Google Analytics for Firebase — only if you click Accept on the cookie banner.', 'Understanding how the product is used, in aggregate.'],
]

const sections: LegalSection[] = [
  {
    title: 'What we collect and why',
    body: (
      <div tabIndex={0} role="region" aria-label="What we collect and why" className="overflow-x-auto rounded-lg focus:outline-2 focus:outline-[#7C3AED]" style={{ border: '1px solid var(--border)' }}>
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-primary)' }}>
              <th className="px-3 py-2 font-semibold">What</th>
              <th className="px-3 py-2 font-semibold">Details</th>
              <th className="px-3 py-2 font-semibold">Why</th>
            </tr>
          </thead>
          <tbody>
            {COLLECT.map(([what, details, why]) => (
              <tr key={what} style={{ borderBottom: '1px solid var(--border)' }} className="align-top">
                <td style={{ color: 'var(--text-primary)' }} className="px-3 py-2 font-medium">{what}</td>
                <td className="px-3 py-2">{details}</td>
                <td className="px-3 py-2">{why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  },
  {
    title: 'Who processes data for us',
    body: (
      <>
        <p>We use these service providers only to run Agent Verify:</p>
        <Bullets items={[
          'Google Firebase — sign-in, report storage, and analytics if you accept it',
          'Cloudflare — our API, database, and Workers AI for "Ask"',
          'Stripe — payments',
          'GitHub, GitLab, Bitbucket and Slack — only when you connect them',
          'Resend — email, only when alerts or the weekly email are on',
        ]} />
        <p><strong style={{ color: 'var(--text-primary)' }}>We do not sell your data and do not use it for advertising.</strong></p>
      </>
    ),
  },
  {
    title: 'Who at Agent Verify can see it',
    body: <p>A small number of staff can see account details (email, plan, signup answers and scan counts) in an internal admin panel, to run billing and support. Access requires a verified staff email.</p>,
  },
  {
    title: 'How long we keep it',
    body: (
      <Bullets items={[
        'Reports and account data: until you delete them or close your account.',
        'Agent Guard events: 30 days.',
        'Error reports: 90 days after the error was last seen.',
        'Free-scan results for identical code: up to 6 hours in cache.',
        'You can delete reports, repository connections and injection-test targets yourself in the dashboard.',
        <>To close your account and delete its data, email {mail}. We do this within 30 days, except billing records we must keep by law.</>,
      ]} />
    ),
  },
  {
    title: 'Your rights',
    body: <p>Depending on where you live (for example the EU, UK or California), you can ask to access, correct, export or delete your data, and object to some uses. Email {mail} and we will respond within 30 days.</p>,
  },
  {
    title: 'Cookies and browser storage',
    body: <p>We use your browser&apos;s storage for sign-in, your theme and cookie choice, and to remember your free demo scan. Analytics cookies are only set if you accept them, and the product works the same if you decline.</p>,
  },
  {
    title: 'Security',
    body: <p>Everything is sent over HTTPS. Stored access tokens and injection-test headers are encrypted, and secrets found in scanned code are redacted before results are saved. More in our <Link href="/trust" className="font-semibold text-[color:var(--accent-purple-text)]">Trust Center</Link>.</p>,
  },
  {
    title: 'Children',
    body: <p>Agent Verify is not intended for anyone under 16.</p>,
  },
  {
    title: 'Changes to this policy',
    body: <p>If we make important changes, we will update this page and let signed-in users know.</p>,
  },
  {
    title: 'Contact',
    body: <p>AI Blockchain Ventures LLC, Sarasota, Florida, USA — {mail}</p>,
  },
]

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="November 2, 2026"
      intro={<p>This policy explains what Agent Verify (run by AI Blockchain Ventures LLC, &quot;we&quot;) collects, why, and the choices you have. The short version: we don&apos;t store the raw code you scan, we don&apos;t sell data, and analytics only run if you accept them.</p>}
      sections={sections}
    />
  )
}
