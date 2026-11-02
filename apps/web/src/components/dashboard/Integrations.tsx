'use client'

import Link from 'next/link'
import type { User } from 'firebase/auth'
import { SlackConnect } from './SlackConnect'

/**
 * Integrations — real destinations only. No logos or cards for anything Agent Verify does not
 * actually integrate with. Webhooks are listed as "Planned" (foundations exist internally, not
 * yet a connectable feature) rather than hidden entirely, since the roadmap status itself is
 * useful information — but it is never presented as "Connected."
 */

interface IntegrationCard {
  id: string
  name: string
  status: 'available' | 'planned'
  purpose: string
  setup: string
  docsHref?: string
  docsLabel?: string
}

const INTEGRATIONS: IntegrationCard[] = [
  {
    id: 'github-app',
    name: 'GitHub App (PR bot)',
    status: 'available',
    purpose: 'Scans every pull request that changes agent code, adds a pass/fail check with notes on the risky lines, and keeps one comment up to date. Also monitors your main branch.',
    setup: 'Open the GitHub & Monitoring tab and click Install on GitHub. No workflow file or API key needed.',
    docsHref: '/developers#github-app',
    docsLabel: 'How the PR bot works',
  },
  {
    id: 'mcp',
    name: 'Claude Code, Cursor & other AI tools (MCP)',
    status: 'available',
    purpose: 'Let your AI coding assistant scan the agent it is building: "scan my agent for security issues" runs Agent Verify and reads back the findings.',
    setup: 'claude mcp add agentverify -e AGENTVERIFY_API_KEY=av_your_key -- npx -y agentverify mcp (or add the same command in Cursor, Windsurf or VS Code).',
    docsHref: '/developers#mcp',
    docsLabel: 'MCP setup',
  },
  {
    id: 'vscode',
    name: 'VS Code extension',
    status: 'available',
    purpose: 'Underlines risky lines as you write agent code, lists them in the Problems panel, and shows the security score in the status bar.',
    setup: 'Install "Agent Verify" from the VS Code Marketplace, then run "Agent Verify: Set API Key".',
    docsHref: '/developers#vscode',
    docsLabel: 'VS Code setup',
  },
  {
    id: 'github-actions',
    name: 'GitHub Actions',
    status: 'available',
    purpose: 'Block a pull request or deployment when an agent fails verification, directly in your existing CI pipeline.',
    setup: 'Add the Agent Verify CLI to a workflow step and run a scan against your agent code on every push or pull request.',
    docsHref: '/docs#ci-cd',
    docsLabel: 'View CI/CD setup',
  },
  {
    id: 'cli',
    name: 'Command line (CLI)',
    status: 'available',
    purpose: 'Scan agent code from your terminal, a pre-commit hook, or any script — the same engine as the web scanner and API.',
    setup: 'npm install -g agentverify, then run agentverify scan <path> with an API key from the API / CLI tab.',
    docsHref: '/docs#cli',
    docsLabel: 'View CLI docs',
  },
  {
    id: 'api',
    name: 'REST API',
    status: 'available',
    purpose: 'Submit a scan or fetch a report programmatically from your own tooling, without the CLI.',
    setup: 'Generate an API key in the API / CLI tab and authenticate requests with it.',
    docsHref: '/docs#api',
    docsLabel: 'View API docs',
  },
  {
    id: 'webhooks',
    name: 'Webhooks',
    status: 'available',
    purpose: 'Notify an external system (Slack, SIEM, your own service) when a scan completes, a verification fails, or a policy check fails.',
    setup: 'Add an endpoint and choose its events in Workspace → Webhooks. Deliveries are signed, retried with backoff, and listed with their history.',
    docsHref: '/docs#webhooks',
    docsLabel: 'View webhook docs',
  },
]

export function Integrations({ user }: { user?: User }) {
  return (
    <div className="space-y-4">
      <p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed">
        These are the real ways to connect Agent Verify to your workflow today. We don&apos;t list integrations that don&apos;t exist yet just to fill this page.
      </p>
      <div className="av-stagger grid gap-4 md:grid-cols-2">
        {INTEGRATIONS.map(item => (
          <div key={item.id} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="av-hover-lift rounded-3xl p-5">
            <div className="flex items-start justify-between gap-3">
              <p style={{ color: 'var(--text-primary)' }} className="text-base font-semibold">{item.name}</p>
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${item.status === 'available' ? 'bg-[#00B37E]/10 text-[color:var(--accent-green-text)]' : 'bg-[var(--surface)] text-[color:var(--text-muted)]'}`}
                style={item.status === 'planned' ? { border: '1px solid var(--border)' } : undefined}
              >
                {item.status === 'available' ? 'Available' : 'Planned'}
              </span>
            </div>
            <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-sm leading-relaxed">{item.purpose}</p>
            <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs leading-relaxed"><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Setup: </span>{item.setup}</p>
            {item.docsHref && (
              <Link href={item.docsHref} className="av-transition mt-3 inline-block text-xs font-semibold text-[color:var(--accent-cyan-text)] hover:opacity-80">{item.docsLabel} →</Link>
            )}
          </div>
        ))}
        {user && <SlackConnect user={user} />}
      </div>
    </div>
  )
}
