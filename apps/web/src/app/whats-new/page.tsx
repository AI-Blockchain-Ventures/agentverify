import Link from 'next/link'
import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { checkLibrary } from '@/lib/checkLibrary'
import { mcpSafety } from '@/lib/mcpSafety'

const newChecks = checkLibrary.checks.filter(c => c.addedIn === '2.0.0').length

export const metadata: Metadata = pageMetadata(
  '/whats-new',
  "What's new in Agent Verify 2.0",
  `Agent Verify 2.0: ${checkLibrary.total} checks (${newChecks} new), PR checks for GitHub, GitLab and Bitbucket, VS Code and MCP, Agent Guard, a Team plan, and the State of MCP Security report.`,
)

type Item = { title: string; text: string; href: string; cta: string; badge?: string }

const GROUPS: Array<{ title: string; intro: string; items: Item[] }> = [
  {
    title: 'Catch more',
    intro: 'Deeper coverage for the way agents are built today.',
    items: [
      { title: `${newChecks} new checks — ${checkLibrary.total} in total`, text: 'MCP tool poisoning, hidden characters and tool shadowing; payments and deletions with no limit or approval; personal data sent to models; retrieval with no per-customer filter; AI agents in CI; and checks for 11 frameworks including LangGraph, LlamaIndex, the Vercel AI SDK, Semantic Kernel, smolagents and Google ADK.', href: '/checks', cta: 'Browse the check library', badge: 'New' },
      { title: 'A help page for every check', text: 'What each check finds, why it matters, what an attacker could do, and how to fix it — linked from every finding in your reports.', href: '/checks', cta: 'Open the check library', badge: 'New' },
      { title: 'State of MCP Security report', text: `What ${mcpSafety.servers.length} popular MCP servers can actually do on your computer, and how to use them safely.`, href: '/state-of-mcp-security', cta: 'Read the report', badge: 'New' },
      { title: 'MCP security directory', text: `"Is it safe?" pages for ${mcpSafety.servers.length} MCP servers, with category comparisons and a pinned install snippet.`, href: '/mcp', cta: 'Find a server' },
    ],
  },
  {
    title: 'Check every change',
    intro: 'Security checks where code is written and reviewed.',
    items: [
      { title: 'Pull request checks', text: 'GitHub App, GitLab and Bitbucket: a pass/fail check and one updating comment on every PR that touches agent code. Pro adds one-click fixes.', href: '/developers#github-app', cta: 'Set up PR checks' },
      { title: 'VS Code and your AI assistant', text: 'Risky lines underlined as you type, and an MCP server so Claude Code, Cursor and Copilot can scan your agents for you.', href: '/developers#mcp', cta: 'Install in your editor' },
      { title: 'CLI and GitHub Action v2', text: 'Run the same checks locally and in CI, with each finding listed in the PR comment.', href: '/developers#cli', cta: 'Use the CLI' },
    ],
  },
  {
    title: 'Protect what runs',
    intro: 'Controls for agents in production.',
    items: [
      { title: 'Agent Guard', text: 'Runtime rules for JavaScript/TypeScript agents: allow and deny lists, human approval for risky tools, allowed domains, rate limits, and blocking keys from leaving.', href: '/developers#guard', cta: 'Add Agent Guard' },
      { title: 'Prompt-injection tests (Pro)', text: 'Ten known attacks sent to your own agent, with clear results on which ones worked.', href: '/developers', cta: 'Learn more' },
      { title: 'Compliance evidence pack (Pro)', text: 'EU AI Act and ISO/IEC 42001 mappings plus a one-click .zip of evidence for auditors.', href: '/docs#compliance', cta: 'See compliance' },
    ],
  },
  {
    title: 'Easier for teams',
    intro: 'Simpler to start, share and run across a team.',
    items: [
      { title: 'Team plan', text: 'Per-seat checkout, every Pro feature, and teammates managed from Billing.', href: '/pricing', cta: 'See plans' },
      { title: 'Ask anything (Ctrl+K)', text: 'One box on every page to find answers, docs, checks, MCP servers and your own findings.', href: '/docs', cta: 'Try it: press Ctrl+K' },
      { title: 'Slack, alerts and a weekly email', text: 'Scan from Slack, get alerts only for new risks, and a short Monday summary.', href: '/developers', cta: 'Connect Slack' },
      { title: 'New look, Trust Center and Status', text: 'A cleaner interface, plus clear answers on what we store and live system status.', href: '/trust', cta: 'Visit the Trust Center' },
    ],
  },
]

export default function WhatsNewPage() {
  const card = { backgroundColor: 'var(--card)', border: '1px solid var(--border)' }
  return (
    <main style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen px-4 py-12 md:px-6 md:py-16">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-purple-text)]">Agent Verify 2.0</p>
        <h1 style={{ color: 'var(--text-primary)' }} className="mt-2 text-3xl font-semibold tracking-tight md:text-5xl">What&apos;s new in 2.0</h1>
        <p style={{ color: 'var(--text-secondary)' }} className="mt-4 max-w-3xl text-lg leading-8">
          Agent Verify now checks AI agents everywhere they are built and run — in your editor, on every pull request, and in production — with {checkLibrary.total} tested checks.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/#public-scan" className="rounded-md bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6D28D9]">Scan an agent free</Link>
          <Link href="/signup" style={{ border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} className="rounded-md px-4 py-2 text-sm font-semibold">Create free account</Link>
        </div>

        {GROUPS.map(group => (
          <section key={group.title} className="mt-14">
            <h2 style={{ color: 'var(--text-primary)' }} className="text-2xl font-semibold tracking-tight">{group.title}</h2>
            <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">{group.intro}</p>
            <ul className="mt-5 grid gap-4 md:grid-cols-2">
              {group.items.map(item => (
                <li key={item.title} style={card} className="flex flex-col rounded-xl p-5">
                  <p style={{ color: 'var(--text-primary)' }} className="flex flex-wrap items-center gap-2 font-semibold">
                    {item.title}
                    {item.badge && <span className="rounded-full bg-[#7C3AED]/10 px-2 py-0.5 text-[11px] font-semibold text-[color:var(--accent-purple-text)]">{item.badge}</span>}
                  </p>
                  <p style={{ color: 'var(--text-secondary)' }} className="mt-2 flex-1 text-sm leading-6">{item.text}</p>
                  <Link href={item.href} className="mt-4 text-sm font-semibold text-[color:var(--accent-purple-text)] hover:underline">{item.cta} →</Link>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p style={{ color: 'var(--text-muted)' }} className="mt-14 text-sm">
          Every change, with details: <a href="https://github.com/AI-Blockchain-Ventures/agentverify/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer" className="font-semibold text-[color:var(--accent-purple-text)]">full changelog on GitHub</a>.
        </p>
      </div>
    </main>
  )
}
