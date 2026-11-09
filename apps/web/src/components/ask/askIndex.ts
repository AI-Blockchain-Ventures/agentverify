import { plans } from '@/lib/pricing'
import type { DashboardTab } from '@/types'

/**
 * Everything the Ask box can find without AI: pages, docs sections, short ready-made answers and
 * dashboard shortcuts. Answers state only facts the product actually does — the AI answer is
 * built from these, so anything wrong here would be repeated there.
 */
export type AskKind = 'answer' | 'page' | 'doc' | 'action' | 'mcp' | 'check' | 'finding'

export interface AskEntry {
  id: string
  kind: AskKind
  title: string
  text: string
  url?: string
  /** dashboard tab to open (signed-in shortcuts) */
  tab?: DashboardTab
  keywords?: string
  signedInOnly?: boolean
}

const free = plans.find(p => p.id === 'free')!
const pro = plans.find(p => p.id === 'pro')!
const team = plans.find(p => p.id === 'team')!

export const STATIC_ENTRIES: AskEntry[] = [
  // Ready-made answers
  { id: 'a-pricing', kind: 'answer', title: 'How much does Agent Verify cost?', url: '/pricing', keywords: 'price pricing cost plan free pro team upgrade money pay',
    text: `Free is ${free.price} with ${free.limits}. Pro is ${pro.price}${pro.period} with ${pro.limits}, fixes with corrected code, one-click PR fix suggestions, prompt-injection tests and the compliance evidence pack. Team is ${team.price}${team.period} and gives Pro features to every member.` },
  { id: 'a-first-scan', kind: 'answer', title: 'How do I scan my agent?', url: '/#public-scan', keywords: 'scan start begin first check agent code repo github how',
    text: 'Paste your agent code or a public GitHub repo link into the scanner on the homepage — no account needed for the first scan. With an account you can also upload files or a .zip and keep a private report history.' },
  { id: 'a-cli', kind: 'answer', title: 'How do I use the CLI?', url: '/docs#cli', keywords: 'cli terminal command line npm install npx',
    text: 'Install with "npm install -g agentverify", then run "agentverify scan ./my-agent". Create an API key in the dashboard (API / CLI) to save results to your account.' },
  { id: 'a-ci', kind: 'answer', title: 'How do I check every pull request?', url: '/developers#github-app', keywords: 'pr pull request github action ci cd bot merge check gitlab bitbucket',
    text: 'Install the Agent Verify GitHub App from the dashboard (Repos & PR checks). Every pull request gets a pass/fail check and a comment listing risks. GitLab and Bitbucket can be connected with an access token, and there is also a GitHub Action.' },
  { id: 'a-vscode', kind: 'answer', title: 'Can I scan inside VS Code, Claude Code or Cursor?', url: '/developers#mcp', keywords: 'vscode vs code editor cursor claude code mcp ide extension',
    text: 'Yes. Install the Agent Verify VS Code extension, or add the MCP server ("agentverify mcp") to Claude Code or Cursor. Then ask your editor\'s AI to scan your project or an MCP config.' },
  { id: 'a-guard', kind: 'answer', title: 'What is Agent Guard?', url: '/developers#guard', keywords: 'guard runtime block approve allow deny protect tool calls',
    text: 'Agent Guard is runtime protection for JavaScript/TypeScript agents (import from "agentverify/guard"). It can allow or deny tools, ask a human before risky actions, limit which domains an agent can reach, rate-limit calls and block calls that would send an API key out. Decisions show in the Agent Guard dashboard tab.' },
  { id: 'a-injection', kind: 'answer', title: 'How do prompt-injection tests work?', url: '/developers', keywords: 'prompt injection red team attack jailbreak test',
    text: 'On Pro, you add your agent\'s chat endpoint and prove you own it with a small file on its host. Agent Verify then sends ten known attacks and shows which ones your agent fell for.' },
  { id: 'a-mcp-safe', kind: 'answer', title: 'Is an MCP server safe to install?', url: '/mcp', keywords: 'mcp server safe install trust risk directory',
    text: 'The MCP safety directory checks popular MCP servers and shows what each can do on your computer: limited access, review before use, or broad access (can run commands). Access level describes what a server can do, not whether it is trustworthy. You can also scan your own MCP config.' },
  { id: 'a-data', kind: 'answer', title: 'Do you store my code?', url: '/trust', keywords: 'privacy data store code security retention delete trust',
    text: 'Agent Verify does not store the raw agent code you submit for analysis. It stores scan results (verdict, score, findings and file name) so you can see your report history, and you can delete reports at any time.' },
  { id: 'a-score', kind: 'answer', title: 'How is the security score calculated?', url: '/docs#security-score', keywords: 'score calculate verdict verified points',
    text: 'Each scan runs every security check and turns the findings into a 0–100 score and a verdict. The docs explain the weighting, and every report has a "How is this score calculated?" section.' },
  { id: 'a-compliance', kind: 'answer', title: 'Does it help with compliance (EU AI Act, ISO 42001, SOC 2)?', url: '/docs#compliance', keywords: 'compliance eu ai act iso 42001 soc 2 nist audit evidence',
    text: 'Reports map findings to EU AI Act, ISO/IEC 42001, SOC 2 and NIST controls as evidence observed, gap identified or not assessed. Pro adds a one-click evidence pack (.zip) for auditors. It is evidence, not a certification.' },
  { id: 'a-referral', kind: 'answer', title: 'How do I get Pro for free?', url: '/dashboard', keywords: 'free pro referral invite friend reward',
    text: 'Invite friends from the Billing tab. You get a free month of Pro for each friend who signs up and runs a scan, and they get 14 days of Pro.' },
  { id: 'a-team', kind: 'answer', title: 'How do I add my team?', url: '/pricing', keywords: 'team seats members invite colleagues',
    text: `The Team plan (${team.price}${team.period}) gives Pro features to every member. The owner adds or removes teammates by email from the Billing tab.` },

  // Pages
  { id: 'p-pricing', kind: 'page', title: 'Pricing', url: '/pricing', text: 'Plans and what each includes.', keywords: 'plans' },
  { id: 'p-mcp', kind: 'page', title: 'MCP safety directory', url: '/mcp', text: 'Popular MCP servers checked.', keywords: 'servers directory' },
  { id: 'p-agent-report', kind: 'page', title: 'State of AI Agent Security report', url: '/state-of-agent-security', text: 'What 50 of the most-starred open-source AI agent projects can do (shell commands, files, browsers), the most common security patterns to review, and how to protect your own agents.' },
  { id: 'p-mcp-report', kind: 'page', title: 'State of MCP Security report', url: '/state-of-mcp-security', text: 'What 500+ popular MCP servers can do, and what that means for security.', keywords: 'report research statistics study mcp state survey' },
  { id: 'p-whats-new', kind: 'page', title: "What's new in 2.0", url: '/whats-new', text: 'Everything added in Agent Verify 2.0.', keywords: 'new release changelog update version 2 launch features' },
  { id: 'p-checks', kind: 'page', title: 'Check library', url: '/checks', text: 'Every security check, what it finds, why it matters and how to fix it.', keywords: 'checks rules library list all help fix' },
  { id: 'p-developers', kind: 'page', title: 'Developers', url: '/developers', text: 'GitHub App, MCP, VS Code, Agent Guard, CLI.', keywords: 'api sdk' },
  { id: 'p-demo', kind: 'page', title: 'Sample report', url: '/report/demo', text: 'See what a full report looks like.', keywords: 'example demo report' },
  { id: 'p-live', kind: 'page', title: 'Live demo', url: '/agentspoofed', text: 'Watch a spoofed agent get caught.', keywords: 'demo spoof' },
  { id: 'p-trust', kind: 'page', title: 'Trust Center', url: '/trust', text: 'How your code and data are handled.', keywords: 'security privacy' },
  { id: 'p-status', kind: 'page', title: 'System status', url: '/status', text: 'Is Agent Verify up right now?', keywords: 'down outage uptime' },
  { id: 'p-owasp', kind: 'page', title: 'OWASP Agentic Skills profile', url: '/owasp-agentic-skills', text: 'Assess skills against the OWASP Agentic Skills Top 10.', keywords: 'owasp' },

  // Docs sections
  ...([
    ['quick-start', 'Quick start'], ['cli', 'CLI'], ['ci-cd', 'CI/CD and GitHub Action'], ['api', 'API'], ['catalog', 'Security check catalog'],
    ['security-score', 'Security score'], ['capabilities-mcp', 'Capabilities and MCP access'], ['webhooks', 'Webhooks'], ['workspaces', 'Workspaces'],
    ['json-output', 'JSON output'], ['troubleshooting', 'Troubleshooting'], ['faq', 'FAQ'], ['limitations', 'Limitations'], ['compliance', 'Compliance mapping'],
  ] as const).map(([anchor, title]) => ({ id: `d-${anchor}`, kind: 'doc' as const, title: `Docs: ${title}`, url: `/docs#${anchor}`, text: `Documentation section: ${title}.`, keywords: anchor.replace(/-/g, ' ') })),

  // Dashboard shortcuts (signed in)
  ...([
    ['scan', 'New scan', 'scan run check'], ['reports', 'Reports', 'history results findings'], ['github', 'Repos & PR checks', 'github gitlab bitbucket pr'],
    ['guard', 'Agent Guard', 'runtime'], ['redteam', 'Injection tests', 'prompt injection'], ['billing', 'Billing & plan', 'upgrade invoice invite referral seats'],
    ['api', 'API keys / CLI', 'key token'], ['integrations', 'Integrations', 'slack webhook vscode'], ['settings', 'Settings', 'theme dark light email'],
  ] as const).map(([tab, title, keywords]) => ({ id: `t-${tab}`, kind: 'action' as const, title: `Go to ${title}`, tab, text: `Open ${title} in your dashboard.`, keywords, signedInOnly: true })),
]

const STOP = new Set(['a', 'an', 'the', 'is', 'are', 'i', 'my', 'me', 'do', 'does', 'how', 'what', 'why', 'can', 'to', 'of', 'in', 'on', 'for', 'it', 'this', 'that', 'and', 'or', 'with', 'be', 'you', 'your', 'we'])

export const tokenize = (s: string): string[] => s.toLowerCase().replace(/[^a-z0-9@./-]+/g, ' ').split(' ').filter(t => t.length > 1 && !STOP.has(t))

const haystack = (e: AskEntry) => `${e.title} ${e.keywords ?? ''} ${e.text}`.toLowerCase()

/** How much each word is worth: rare words ("filesystem") count far more than common ones ("mcp", "server"). */
export function termWeights(pool: AskEntry[], terms: string[]): Map<string, number> {
  const texts = pool.map(haystack)
  const weights = new Map<string, number>()
  for (const t of terms) {
    const df = texts.reduce((n, h) => n + (h.includes(t) ? 1 : 0), 0)
    weights.set(t, Math.log(1 + pool.length / (1 + df)))
  }
  return weights
}

/** Predictable ranking: title words count most, then keywords, then body text — each scaled by how rare the word is. */
export function scoreEntry(entry: AskEntry, terms: string[], raw: string, weights?: Map<string, number>): number {
  if (!terms.length) return 0
  const title = entry.title.toLowerCase()
  const keywords = (entry.keywords ?? '').toLowerCase()
  const text = entry.text.toLowerCase()
  let score = 0
  for (const t of terms) {
    const w = weights?.get(t) ?? 1
    if (title.includes(t)) score += 4 * w
    if (keywords.includes(t)) score += 3 * w
    if (text.includes(t)) score += 1 * w
  }
  if (raw.trim().length > 2 && title.includes(raw.toLowerCase().trim())) score += 10
  return score
}

/** True when the input reads like a question for the AI rather than a quick search. */
export const looksLikeQuestion = (q: string): boolean => /\?\s*$/.test(q) || /^(how|what|why|which|is|are|can|should|does|do|where|when|explain|help)\b/i.test(q.trim()) || q.trim().split(/\s+/).length >= 5
