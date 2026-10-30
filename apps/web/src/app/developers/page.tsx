import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import Link from 'next/link'
import { CodeBlock } from '@/components/developers/CodeBlock'

export const metadata: Metadata = pageMetadata('/developers', 'For Developers', 'Verify AI agents before they deploy: the Agent Verify CLI, a GitHub Action that blocks risky merges, CI exit codes, and the scan API.')

const WORKFLOW = `name: Agent Verify

on:
  pull_request:
    branches: [main]

jobs:
  agentverify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Verify AI agents before merge
        run: npx --yes agentverify scan ./agents --ci --policy standard
        env:
          AGENTVERIFY_API_KEY: \${{ secrets.AGENTVERIFY_API_KEY }}`

const STEPS: Array<{ n: string; title: string; body: string; code?: string; codeLabel?: string }> = [
  {
    n: '1',
    title: 'Create an API key',
    body: 'Sign in, open the dashboard, and generate a key on the API / CLI tab. Free accounts can use the CLI too — every scan uses one from your monthly quota.',
  },
  {
    n: '2',
    title: 'Scan before you deploy',
    body: 'Point the CLI at your agent folder. It scans every agent file and prints the verdict, security score, and what to fix first.',
    code: `npm install -g agentverify\nexport AGENTVERIFY_API_KEY=av_your_key\nagentverify scan ./agents`,
    codeLabel: 'Install and run the CLI',
  },
  {
    n: '3',
    title: 'Block risky merges in CI',
    body: 'Add this workflow and save your key as the AGENTVERIFY_API_KEY repository secret. Pull requests that make an agent unsafe fail the check before they merge.',
    code: WORKFLOW,
    codeLabel: 'GitHub Actions workflow',
  },
]

const EXIT_CODES: Array<[string, string]> = [
  ['0', 'Verified — every scanned file passed'],
  ['1', 'Not verified — a real security finding blocks release'],
  ['2', 'Not assessed — not enough agent code to judge (pass --allow-not-assessed to ignore)'],
  ['3', 'Execution error — bad key, network failure, missing file (never a security result)'],
]

export default function DevelopersPage() {
  return (
    <main style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen px-4 py-16 md:px-6 md:py-20">
      <div className="mx-auto max-w-5xl">
        <header className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[color:var(--accent-cyan-text)]">For developers</p>
          <h1 style={{ color: 'var(--text-primary)' }} className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">Verify every agent before it ships.</h1>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-5 text-base leading-7 md:text-lg">Run the same 76 checks from your terminal and your CI pipeline. Risky changes — a pasted key, a wildcard tool list, an unsandboxed code runner, an MCP server with your whole drive — fail the build before they reach production.</p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/dashboard" className="rounded-2xl bg-[#7C3AED] px-6 py-3 text-sm font-semibold text-white hover:opacity-90">Get a free API key</Link>
            <Link href="/docs" style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }} className="rounded-2xl px-6 py-3 text-sm font-semibold hover:opacity-80">Read the full docs</Link>
          </div>
        </header>

        <section className="mt-14 space-y-6" aria-label="Set up in three steps">
          {STEPS.map(step => (
            <div key={step.n} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="grid gap-4 rounded-3xl p-5 md:grid-cols-[220px_1fr] md:p-6">
              <div>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#7C3AED]/15 text-sm font-bold text-[color:var(--accent-purple-text)]">{step.n}</span>
                <h2 style={{ color: 'var(--text-primary)' }} className="mt-3 text-lg font-semibold">{step.title}</h2>
                <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm leading-6">{step.body}</p>
              </div>
              {step.code ? <CodeBlock code={step.code} label={step.codeLabel ?? step.title} /> : (
                <div style={{ backgroundColor: 'var(--surface)', border: '1px dashed var(--border)' }} className="flex items-center justify-center rounded-2xl p-6 text-center">
                  <p style={{ color: 'var(--text-secondary)' }} className="text-sm">Dashboard → <strong>API / CLI</strong> → <strong>Generate API key</strong>. Keys start with <code>av_</code>; regenerating one revokes the old key immediately.</p>
                </div>
              )}
            </div>
          ))}
        </section>

        <section className="mt-14 grid gap-5 md:grid-cols-2">
          <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-6">
            <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">CI exit codes</h2>
            <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">With <code>--ci</code>, your pipeline can tell a real security failure apart from a broken run.</p>
            <table className="mt-4 w-full text-left text-sm">
              <tbody>
                {EXIT_CODES.map(([code, meaning]) => (
                  <tr key={code} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="w-10 py-2 font-mono font-semibold text-[color:var(--accent-purple-text)]">{code}</td>
                    <td style={{ color: 'var(--text-secondary)' }} className="py-2">{meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-6">
            <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">Useful options</h2>
            <ul style={{ color: 'var(--text-secondary)' }} className="mt-3 space-y-2.5 text-sm">
              <li><code>--policy financial-agent</code> — stricter rules for agents that move money (also <code>high-security</code>, <code>production-infrastructure</code>).</li>
              <li><code>--markdown</code> — a summary you can post as a PR comment.</li>
              <li><code>--json</code> / <code>--summary-file out.json</code> — machine-readable results for dashboards.</li>
              <li><code>--file .mcp.json</code> — check one file, such as your MCP config.</li>
              <li><code>--profile owasp-agentic-skills-2026</code> — assess a skill package against the OWASP Agentic Skills Top 10.</li>
            </ul>
          </div>
        </section>

        <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mt-5 rounded-3xl p-6">
          <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">What the checks cover</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Code', 'SQL injection, SSRF, command injection, unsafe eval and deserialization, path traversal, model output executed without validation.'],
              ['Agents', 'Prompt injection (direct and from web pages, emails, documents), wildcard tools, missing approval gates, unbounded loops, data-exfiltration paths.'],
              ['Frameworks', 'LangChain, CrewAI, AutoGen, OpenAI Agents SDK, Claude Agent SDK, and computer-use tools — each with framework-specific checks.'],
              ['MCP & secrets', 'MCP servers with whole-drive access, unpinned or unauthenticated servers, 19 kinds of credentials — always redacted in reports.'],
            ].map(([title, body]) => (
              <div key={title} style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
                <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{title}</p>
                <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs leading-5">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-5 grid gap-5 md:grid-cols-2">
          <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-6">
            <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">Scan API</h2>
            <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">Call the scanner from your own tooling. Same checks, same quota.</p>
            <div className="mt-4">
              <CodeBlock
                label="Scan API request"
                code={`curl -X POST https://agentverify-api.agentverify.workers.dev/v1/scan \\\n  -H "Authorization: Bearer $AGENTVERIFY_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"fileName":"agent.py","content":"..."}'`}
              />
            </div>
          </div>
          <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-6">
            <h2 style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">Show it&apos;s verified</h2>
            <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm leading-6">When an agent passes, add the live Agent Verify badge to your README. It links to the report, so buyers and reviewers can check it themselves.</p>
            <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="mt-4 rounded-2xl p-4 text-sm">
              <p style={{ color: 'var(--text-secondary)' }}>Pro adds the corrected code for each finding and a PDF report for clients and auditors.</p>
              <Link href="/pricing" className="mt-3 inline-flex rounded-xl bg-[#06B6D4] px-4 py-2 text-xs font-semibold text-[#060A0F] hover:opacity-90">Compare plans</Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
