'use client'

import Link from 'next/link'
import { Bullets, LegalPage, type LegalSection } from '@/components/legal/LegalPage'

const EMAIL = 'hello@aiblockchainventures.com'
const mail = <a href={`mailto:${EMAIL}`} className="font-semibold text-[color:var(--accent-purple-text)]">{EMAIL}</a>
const link = (href: string, text: string) => <Link href={href} className="font-semibold text-[color:var(--accent-purple-text)]">{text}</Link>

const sections: LegalSection[] = [
  {
    title: '1. Accepting these terms',
    body: <p>By using Agent Verify you agree to these terms. If you use it for a company, you confirm you are allowed to accept them for that company. If you do not agree, do not use the service.</p>,
  },
  {
    title: '2. What Agent Verify does',
    body: <p>Agent Verify analyzes AI agent code and configuration for security risks, and offers related features such as pull-request checks, Agent Guard, prompt-injection tests and reports. Results are informational: they point out likely risks but <strong style={{ color: 'var(--text-primary)' }}>do not guarantee</strong> that every risk was found or that an agent is safe. Agent Verify helps your security review; it does not replace it.</p>,
  },
  {
    title: '3. Your account',
    body: <p>Keep your sign-in details and API keys private. You are responsible for activity under your account and your keys. If a key leaks, create a new one in the dashboard right away.</p>,
  },
  {
    title: '4. Plans, billing and refunds',
    body: (
      <Bullets items={[
        <>The Free plan has the limits shown on the {link('/pricing', 'pricing page')}.</>,
        'Pro and Team are subscriptions billed through Stripe. They renew automatically until you cancel in "Manage billing". When you cancel, your plan stays active until the end of the period you paid for.',
        'Team plans are billed per seat. Seat changes show up on your next Stripe invoice.',
        'Payments are not refundable for partial periods, except where the law requires a refund. If you think you were charged by mistake, email us and we will look at it.',
        'We may change prices with at least 30 days’ notice; changes apply from your next renewal.',
        'Referral bonuses and complimentary plans can be changed or withdrawn if they are abused.',
      ]} />
    ),
  },
  {
    title: '5. Acceptable use',
    body: (
      <>
        <p>Only scan, monitor or test code, repositories and endpoints that you own or are authorized to assess. Prompt-injection tests may only target agents you control, which is why we verify ownership first. You may not:</p>
        <Bullets items={[
          'try to break, overload or get around the limits of the service;',
          'reverse engineer the analysis engine;',
          'use Agent Verify to attack or probe systems you are not allowed to test;',
          'present Agent Verify results as a certification or guarantee they are not.',
        ]} />
      </>
    ),
  },
  {
    title: '6. Connected services',
    body: <p>When you connect GitHub, GitLab, Bitbucket or Slack, you allow Agent Verify to read the content needed for its checks and to post checks and comments where you have turned them on. Removing the connection stops this.</p>,
  },
  {
    title: '7. AI answers',
    body: <p>Answers in &quot;Ask&quot; are written by an AI model from Agent Verify&apos;s help content. They can be wrong — check important answers against the {link('/docs', 'docs')}.</p>,
  },
  {
    title: '8. Your content',
    body: <p>You keep all rights to your code and your reports. You allow us to process them only to provide the service. We do not store the raw code you submit for scans. See the {link('/privacy', 'Privacy Policy')}.</p>,
  },
  {
    title: '9. Our intellectual property',
    body: <p>The analysis engine, scoring method, check catalog content and the A2SPA protocol belong to AI Blockchain Ventures LLC. The web app, CLI, GitHub Action and VS Code extension are open source under the licenses in their repositories.</p>,
  },
  {
    title: '10. Availability',
    body: <p>We work to keep Agent Verify available but cannot promise it will always be uninterrupted or error-free. Current status is on the {link('/status', 'status page')}.</p>,
  },
  {
    title: '11. Disclaimer and limit of liability',
    body: (
      <>
        <p>Agent Verify is provided &quot;as is&quot; and &quot;as available&quot;, without warranties of any kind, to the extent the law allows.</p>
        <p>To the extent the law allows, AI Blockchain Ventures LLC is not liable for indirect, incidental or consequential losses, lost profits or lost data, or for security incidents in systems you operate. Our total liability for any claim is limited to the amount you paid us for Agent Verify in the 12 months before the claim (or US$100 if you paid nothing).</p>
      </>
    ),
  },
  {
    title: '12. Ending your use',
    body: <p>You can stop using Agent Verify and close your account at any time. We may suspend or close accounts that break these terms or put the service or others at risk.</p>,
  },
  {
    title: '13. Changes to these terms',
    body: <p>We may update these terms. For important changes we will let signed-in users know before they take effect. Continuing to use Agent Verify after that means you accept the new terms.</p>,
  },
  {
    title: '14. Governing law',
    body: <p>These terms are governed by the laws of the State of Florida, USA, without regard to its conflict-of-laws rules. Disputes will be handled in the state or federal courts located in Florida, unless the law where you live gives you a different right.</p>,
  },
  {
    title: '15. Contact',
    body: <p>AI Blockchain Ventures LLC, Sarasota, Florida, USA — {mail}</p>,
  },
]

export default function TermsPage() {
  return <LegalPage title="Terms of Use" updated="November 2, 2026" sections={sections} />
}
