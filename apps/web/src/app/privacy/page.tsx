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
  ['Fix & re-check (Pro)', 'The code you check or ask AI to fix is sent to our server and, for AI fixes, to Cloudflare Workers AI. It is not stored. We keep a daily count of AI fixes per account.', 'Re-scoring your changes and writing AI fixes, and enforcing daily limits.'],
  ['"Ask" questions', 'Your question is sent to Cloudflare Workers AI to write an answer and is not stored. We keep a daily count per account, or per hashed network address.', 'Answering, and enforcing daily limits.'],
  ['Repository connections', 'GitHub installation ID, repository names, scores and pull-request numbers. GitLab and Bitbucket access tokens are encrypted.', 'Pull-request checks and monitoring.'],
  ['Slack', 'Your Slack workspace ID.', 'The /agentverify command.'],
  ['Alerts', 'An email address or Slack webhook address you choose.', 'Sending alerts.'],
  ['Agent Guard', 'Tool name, decision, and a short preview of arguments with secrets masked. Deleted after 30 days.', 'The Agent Guard dashboard.'],
  ['Coding-agent guard (Claude Code, Cursor)', 'The rules are checked on your own computer. Nothing is sent to us unless you set an Agent Verify API key. With a key: a label for the agent (the tool, your project folder name and your computer name), the action type, the decision, and a short preview of the command or file path with secrets masked. Set AGENTVERIFY_GUARD_LOG=off to send nothing. Deleted after 30 days.', 'The Agent Guard activity view.'],
  ['Company rules', 'The coding-agent rules your account owner saves. Each developer\'s computer keeps a copy for a few minutes so the guard stays fast.', 'Applying the same rules for everyone on a team.'],
  ['Approval requests', 'When an AI agent waits for a person: the agent label, a short masked preview of what it wants to do, the reason, and who approved or denied it. A notice goes to the Slack webhook or email in your alert settings. Deleted after 7 days.', 'Letting a person approve or deny from the dashboard or a phone.'],
  ['Prompt-injection tests', 'Target address, request headers (encrypted), short reply excerpts with secrets masked, and your weekly re-test setting.', 'Showing which attacks worked on your own agent, and alerting you when one starts getting through.'],
  ['Public agent profiles', 'Only what you choose to publish: the agent name, description and website, its scan result and score, how many injection tests it resisted, and Agent Guard counts. Never your code, findings, prompts, replies or commands.', 'Showing customers that your agent was checked.'],
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
    title: 'Who can see it',
    body: (
      <>
        <p>A small number of Agent Verify staff can see account details (email, plan, signup answers and scan counts) in an internal admin panel, to run billing and support. Access requires a verified staff email.</p>
        <p><strong style={{ color: 'var(--text-primary)' }}>On a Team plan, the Team owner can see each member&apos;s Agent Guard activity and approval requests</strong> (agent label, action, decision and the masked preview), and can approve or deny members&apos; requests. Members are told this on their own Agent Guard page. Members cannot see each other&apos;s activity or the owner&apos;s.</p>
        <p>A public agent profile can be seen by anyone with its link until you unpublish or delete it.</p>
      </>
    ),
  },
  {
    title: 'How long we keep it',
    body: (
      <Bullets items={[
        'Reports and account data: until you delete them or close your account.',
        'Agent Guard events, including coding-agent activity: 30 days.',
        'Approval requests: 7 days.',
        'Company rules and public agent profiles: until you change or delete them.',
        'Error reports: 90 days after the error was last seen.',
        'Free-scan results for identical code: up to 6 hours in cache.',
        'You can delete reports, repository connections, injection-test targets and public agent profiles yourself in the dashboard.',
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
      updated="November 23, 2026"
      intro={<p>This policy explains what Agent Verify (run by AI Blockchain Ventures LLC, &quot;we&quot;) collects, why, and the choices you have. The short version: we don&apos;t store the raw code you scan, we don&apos;t sell data, and analytics only run if you accept them.</p>}
      sections={sections}
    />
  )
}
