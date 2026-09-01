import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Docs',
  description: 'How Agent Verify’s AI agent security scanner checks permissions, MCP servers, secrets, and execution controls, what VERIFIED/NOT VERIFIED/NOT ASSESSED mean, and how to use the web scanner, CLI, npm package, and CI integration.',
  openGraph: {
    title: 'Docs — Agent Verify',
    description: 'How Agent Verify’s AI agent security scanner checks permissions, MCP servers, secrets, and execution controls, what VERIFIED/NOT VERIFIED/NOT ASSESSED mean, and how to use the web scanner, CLI, npm package, and CI integration.',
    url: 'https://aimodularity.com/agentverify/docs/',
    siteName: 'Agent Verify',
    type: 'website',
  },
}

const nav = [
  { id: 'overview', label: 'Overview' },
  { id: 'quick-start', label: 'Quick Start' },
  { id: 'web-scanner', label: 'Web Scanner' },
  { id: 'cli', label: 'CLI' },
  { id: 'npm', label: 'npm Installation' },
  { id: 'authentication', label: 'Authentication' },
  { id: 'api', label: 'API' },
  { id: 'ci-cd', label: 'CI/CD & GitHub Actions' },
  { id: 'scan-results', label: 'Scan Results' },
  { id: 'security-score', label: 'Security Score' },
  { id: 'findings', label: 'Findings' },
  { id: 'capabilities-mcp', label: 'Capabilities, MCP & Blast Radius' },
  { id: 'catalog', label: 'Verification Check Catalog' },
  { id: 'taxonomy', label: 'Risk Taxonomy' },
  { id: 'report-types', label: 'Report Types' },
  { id: 'reports', label: 'Reports' },
  { id: 'sharing', label: 'Sharing Reports' },
  { id: 'json-output', label: 'JSON Output' },
  { id: 'schema', label: 'JSON Schema' },
  { id: 'compliance', label: 'Compliance Mapping' },
  { id: 'integrity', label: 'Report Integrity' },
  { id: 'benchmark', label: 'Benchmark Methodology' },
  { id: 'a2spa', label: 'A2SPA Checks' },
  { id: 'comparison', label: 'Scan Comparison' },
  { id: 'controls-detected', label: 'Security Controls Detected' },
  { id: 'rbom', label: 'Runtime Bill of Materials' },
  { id: 'formats', label: 'Supported Formats' },
  { id: 'limitations', label: 'Limitations' },
  { id: 'troubleshooting', label: 'Troubleshooting' },
  { id: 'faq', label: 'FAQ' },
]

function CodeBlock({ children }: { children: string }) {
  return (
    <pre
      tabIndex={0}
      role="region"
      aria-label="Code example"
      style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)' }}
      className="overflow-x-auto rounded-lg px-4 py-3 font-mono text-xs leading-relaxed text-[color:var(--accent-cyan-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#06B6D4]"
    >
      {children}
    </pre>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-b border-[var(--border)] py-10 first:pt-0 last:border-b-0">
      <h2 style={{ color: 'var(--text-primary)' }} className="text-xl font-semibold tracking-tight">{title}</h2>
      <div style={{ color: 'var(--text-secondary)' }} className="mt-4 space-y-4 text-sm leading-relaxed">
        {children}
      </div>
    </section>
  )
}

export default function DocsPage() {
  return (
    <main style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen">
      <div className="mx-auto flex max-w-6xl gap-10 px-4 py-10 md:px-8">
        <aside className="hidden w-56 shrink-0 lg:block">
          <nav className="sticky top-24 space-y-1 text-sm">
            <p style={{ color: 'var(--text-muted)' }} className="mb-2 text-xs font-semibold uppercase tracking-[0.2em]">Docs</p>
            {nav.map(item => (
              <a key={item.id} href={`#${item.id}`} style={{ color: 'var(--text-muted)' }} className="block rounded-lg px-2 py-1.5 transition-opacity hover:opacity-80">
                {item.label}
              </a>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-purple-text)]">Documentation</p>
          <h1 style={{ color: 'var(--text-primary)' }} className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">Agent Verify Docs</h1>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-3 max-w-2xl text-sm leading-6">
            Agent Verify inspects an AI agent or agent package for identity, permissions, tools, execution controls, secrets, runtime configuration, and dependency risk, then issues a <strong>VERIFIED</strong> or <strong>NOT VERIFIED</strong> result with evidence. This page documents the web scanner, CLI, npm package, and API as they actually exist today &mdash; every command and endpoint here is real and testable.
          </p>

          <div className="mt-8 space-y-0">
            <Section id="overview" title="Overview">
              <p>Every scan produces one of three verdicts:</p>
              <ul className="ml-4 list-disc space-y-1">
                <li><strong>VERIFIED</strong> &mdash; sufficient execution context was assessed and the required trust controls passed.</li>
                <li><strong>NOT VERIFIED</strong> &mdash; sufficient execution context was assessed and one or more security or protocol controls failed.</li>
                <li><strong>NOT ASSESSED</strong> &mdash; the submitted content did not contain enough agent execution context (tools, permissions, actions) to make a verification decision. This is not a security failure &mdash; it means Agent Verify could not evaluate the input.</li>
              </ul>
              <p>Findings are split into two categories: <strong>A &mdash; A2SPA Protocol Compliance</strong> (signature, nonce, timestamp, fail-closed, and scope evidence for execution-time authorization) and <strong>B &mdash; General Agent Security</strong> (secrets, tool access, human approval gates, audit logging, rate limiting, prompt injection surface, and related runtime risk).</p>
            </Section>

            <Section id="quick-start" title="Quick Start">
              <p>Two ways to run a scan:</p>
              <ol className="ml-4 list-decimal space-y-1">
                <li>Sign in and use the <Link href="/dashboard" className="underline">web scanner</Link> to paste or upload agent code/config for a private report.</li>
                <li>Install the CLI and scan from your terminal or CI pipeline:</li>
              </ol>
              <CodeBlock>{`npm install -g agentverify
agentverify scan ./agents --key av_your_key`}</CodeBlock>
              <p>Get an API key from <Link href="/dashboard" className="underline">Dashboard &rarr; API access</Link> after signing in.</p>
            </Section>

            <Section id="web-scanner" title="Web Scanner">
              <p>The dashboard scanner runs the same <code>@agentverify/scanner</code> engine as the CLI and API against pasted code or an uploaded file, then saves a private report to your account. Reports created this way are client-submitted: they are useful for iterating on your own agent, but they are not server-attested evidence in the same sense as a report saved through an authenticated CLI/API scan. See <a href="#limitations" className="underline">Limitations</a>.</p>
            </Section>

            <Section id="cli" title="CLI">
              <CodeBlock>{`agentverify scan [dir] --key <api-key>
agentverify scan --file <file> --key <api-key>
agentverify --help
agentverify --version`}</CodeBlock>
              <p>Common flags:</p>
              <ul className="ml-4 list-disc space-y-1">
                <li><code>--key, -k</code> &mdash; API key (or set <code>AGENTVERIFY_API_KEY</code>)</li>
                <li><code>--file, -f</code> &mdash; scan a single file instead of a directory</li>
                <li><code>--json</code> &mdash; machine-readable output</li>
                <li><code>--markdown</code> &mdash; Markdown summary, useful for PR comments</li>
                <li><code>--ci</code> &mdash; concise output with strict exit codes</li>
                <li><code>--allow-not-assessed</code> &mdash; in CI mode, do not fail solely because content is <code>NOT_ASSESSED</code></li>
              </ul>
              <p>CI exit codes:</p>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th className="py-1.5 pr-4 text-left font-semibold" style={{ color: 'var(--text-primary)' }}>Code</th>
                    <th className="py-1.5 text-left font-semibold" style={{ color: 'var(--text-primary)' }}>Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}><td className="py-1.5 pr-4 font-mono">0</td><td className="py-1.5">All scanned files verified</td></tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}><td className="py-1.5 pr-4 font-mono">1</td><td className="py-1.5">NOT VERIFIED &mdash; a real security/verification failure</td></tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}><td className="py-1.5 pr-4 font-mono">2</td><td className="py-1.5">NOT ASSESSED &mdash; insufficient evidence for a verdict</td></tr>
                  <tr><td className="py-1.5 pr-4 font-mono">3</td><td className="py-1.5">Execution error &mdash; bad key, network failure, missing file (not a security finding)</td></tr>
                </tbody>
              </table>
            </Section>

            <Section id="npm" title="npm Installation">
              <p>Package: <a href="https://www.npmjs.com/package/agentverify" target="_blank" rel="noreferrer" className="underline">agentverify</a> on the public npm registry.</p>
              <CodeBlock>{`npm install -g agentverify
# or run without installing
npx agentverify scan . --key av_your_key`}</CodeBlock>
              <p>Requires Node.js 18 or later. The package ships both CommonJS and ESM builds and TypeScript types; it has no dependency on this monorepo &mdash; it works standalone in any project.</p>
            </Section>

            <Section id="authentication" title="Authentication">
              <p>Sign up with email/password or Google. Forgot your password? Use <strong>Forgot password?</strong> on the sign-in form &mdash; if an account exists for that email, a reset link is sent. For account-security reasons, the response is identical whether or not the email is registered.</p>
              <p>API keys are generated per-account from <strong>Dashboard &rarr; API access</strong>. Regenerating a key immediately revokes the previous one.</p>
            </Section>

            <Section id="api" title="API">
              <p>Authenticated scan endpoint (used by the CLI and SDK):</p>
              <CodeBlock>{`POST https://agentverify-api.agentverify.workers.dev/v1/scan
Authorization: Bearer av_your_key
Content-Type: application/json

{ "content": "<agent code or config>", "fileName": "agent.ts" }`}</CodeBlock>
              <p>Responses include the full scan result (verdict, riskScore, findings, categoryScores, bom, threatCategories, metadata) plus <code>reportId</code>, <code>saved</code>, and <code>reportUrl</code> when a report was persisted. A <code>429</code> response means your plan&apos;s monthly scan quota (10 scans/month on Free, 100/month on Pro) has been reached. A <code>401</code> means the key is missing, malformed, disabled, or revoked.</p>
              <p>The Worker also serves a live SVG badge at <code>GET /v1/badge/:reportId</code> for saved reports, and the billing endpoints used by the dashboard (<code>/v1/billing/status</code>, <code>/checkout</code>, <code>/portal</code>) which require a signed-in Firebase session, not an API key.</p>
            </Section>

            <Section id="ci-cd" title="CI/CD & GitHub Actions">
              <p>Run Agent Verify as a required PR check:</p>
              <CodeBlock>{`- uses: AI-Blockchain-Ventures/agentverify@v1
  with:
    path: ./agents
    api-key: \${{ secrets.AGENTVERIFY_API_KEY }}
    format: text`}</CodeBlock>
              <p>Or call the CLI directly in any workflow:</p>
              <CodeBlock>{`- run: npx --yes agentverify scan ./agents --ci
  env:
    AGENTVERIFY_API_KEY: \${{ secrets.AGENTVERIFY_API_KEY }}`}</CodeBlock>
              <p>Add the job to branch protection so a non-zero exit blocks merge. Full reference: <a href="https://github.com/AI-Blockchain-Ventures/agentverify/blob/main/docs/github-action.md" target="_blank" rel="noreferrer" className="underline">docs/github-action.md</a>.</p>
            </Section>

            <Section id="scan-results" title="Scan Results">
              <p>Every result carries <code>schemaVersion</code>, a stable machine-safe <code>verdict</code> (<code>VERIFIED</code> / <code>NOT_VERIFIED</code> / <code>NOT_ASSESSED</code>), a <code>riskScore</code> (0&ndash;100), <code>riskLevel</code>, a <code>confidence</code> score, category scores for Protocol Compliance and Security Controls, a findings array, a Runtime Bill of Materials, and scan metadata (scanner version, timestamp, duration, detected language/framework).</p>
            </Section>

            <Section id="security-score" title="Security Score">
              <p>The score starts at 100 and is reduced by weighted findings: &minus;20 per critical finding, &minus;10 per high, &minus;5 per medium (low findings don&apos;t subtract points but still appear in the report). Broad/wildcard tool or permission access caps the score at 65 regardless of other findings. A <code>VERIFIED</code> verdict additionally requires zero critical findings, at most one high finding, no broad permissions, and either full A2SPA execution-authorization evidence (signature, nonce, fail-closed) or a complete security-controls baseline (no hardcoded secrets, audit logging, rate limiting, and human approval gates present).</p>
              <p>This is a heuristic, evidence-based score, not a guarantee. See <a href="#limitations" className="underline">Limitations</a>.</p>
            </Section>

            <Section id="findings" title="Findings">
              <p>Each finding includes a stable <code>code</code>, severity (<code>critical</code>/<code>high</code>/<code>medium</code>/<code>low</code>), category (A or B), a plain-language description of what was found and why it matters, a line number when locatable, a plain-English &quot;what an agent could do because of this&quot; note, a recommended fix, an <strong>evidence type</strong>, and &mdash; where relevant &mdash; mappings to OWASP LLM Top 10, NIST AI RMF, and SOC 2 controls. Findings that reference a detected secret show a redacted preview (e.g. <code>api_key: &quot;sk_l****&quot; (redacted)</code>) &mdash; the live value is never included in a report. Named, higher-confidence patterns are detected for OpenAI/Anthropic/AWS/GitHub/Stripe/Slack keys, private key blocks, and database URLs with embedded credentials, in addition to a generic key/password/token pattern.</p>
              <p>Every finding also carries an <strong>evidence type</strong> so a heuristic guess is never presented as an established fact:</p>
              <ul className="ml-4 list-disc space-y-1">
                <li><strong>Definite</strong> &mdash; a concrete pattern was matched (a literal wildcard permission, a literal secret literal).</li>
                <li><strong>Heuristic</strong> &mdash; inferred from the absence of an expected pattern, or contextual keyword co-occurrence. Can under- or over-detect if a control is implemented in a way the scanner doesn&apos;t recognize.</li>
                <li><strong>Informational</strong> &mdash; a neutral observation, not itself good or bad.</li>
              </ul>
            </Section>

            <Section id="capabilities-mcp" title="Capabilities, MCP, and Blast Radius">
              <p><strong>Capabilities</strong> answer &quot;what could this agent actually do if compromised?&quot; &mdash; read/write/delete files, execute commands, deploy software, access/modify databases, send email/messages, transfer money, issue refunds, touch crypto wallets, reach cloud infrastructure, create/delete users, or call external APIs. Each capability is derived only from concrete evidence in the submitted content, with its own confidence level &mdash; never guessed from a tool name alone.</p>
              <p><strong>MCP (Model Context Protocol)</strong> detection identifies MCP server configuration, known server/tool categories (filesystem, shell, database, GitHub, Slack, email, browser automation, payments, docker, memory), and builds an Agent &rarr; MCP Server &rarr; Tool &rarr; Potential Action chain when there is real evidence. An MCP integration with an unidentified server is reported as exactly that &mdash; &quot;Unknown MCP server&quot; &mdash; never invented.</p>
              <p><strong>Potential Blast Radius</strong> surfaces dangerous <em>combinations</em> of capabilities that matter more than any single permission &mdash; e.g. filesystem write + shell execution, or a payment capability with no visible destination constraint or human approval step. This never claims an exploit exists, only that the combination could allow the stated impact if the agent is compromised or misused.</p>
            </Section>

            <Section id="catalog" title="Verification Check Catalog">
              <p>Agent Verify runs <strong>44 distinct, independently-tested verification checks</strong> &mdash; not a marketing round number. Each check has a stable ID (e.g. <code>AV-SECRET-003</code>, <code>AV-MCP-005</code>), a category, severity, detection type, and its own regression test asserting it actually fires. Every check the scanner can produce is cross-checked in both directions against a real test suite: no catalog entry exists without a working code path, and no working code path exists without a catalog entry.</p>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th className="py-1.5 pr-4 text-left font-semibold" style={{ color: 'var(--text-primary)' }}>Category</th>
                    <th className="py-1.5 text-left font-semibold" style={{ color: 'var(--text-primary)' }}>Checks</th>
                  </tr>
                </thead>
                <tbody>
                  {[['Secrets', 12], ['Runtime', 8], ['MCP', 9], ['Execution authorization', 4], ['Permissions', 3], ['Network', 3], ['Human oversight', 1], ['Auditability', 1], ['Tools', 1], ['Dependencies', 1], ['Identity', 1]].map(([label, count]) => (
                    <tr key={label as string} style={{ borderBottom: '1px solid var(--border)' }}><td className="py-1.5 pr-4">{label}</td><td className="py-1.5 font-mono">{count}</td></tr>
                  ))}
                </tbody>
              </table>
              <p>Beyond the 44 checks, the scanner separately runs 19 capability detectors (what an agent can do), 10 MCP tool classifiers, 8 capability-chain (&quot;blast radius&quot;) combination rules, and 14 threat-category assessments &mdash; these are classification/context systems, not pass/fail checks, and are counted separately so the 44 stays an honest number of real, distinct checks rather than an inflated one.</p>
            </Section>

            <Section id="taxonomy" title="Risk Taxonomy">
              <p>Findings are tagged with one of <strong>11 technical security categories</strong> (Identity, Permissions, Tools, MCP, Execution Authorization, Secrets, Runtime, Network, Dependencies, Auditability, Human Oversight) &mdash; this is the ground truth every finding, check, and report is built from. For a non-technical audience, those 11 categories group into <strong>7 executive families</strong>, derived from the same tags (never assigned separately, so the two views can never contradict each other):</p>
              <ul className="ml-4 list-disc space-y-1">
                <li><strong>Identity &amp; Access</strong> &mdash; Identity, Permissions</li>
                <li><strong>Tools &amp; Capabilities</strong> &mdash; Tools, MCP</li>
                <li><strong>Execution Security</strong> &mdash; Execution Authorization</li>
                <li><strong>Secrets &amp; Data</strong> &mdash; Secrets</li>
                <li><strong>Runtime &amp; Network</strong> &mdash; Runtime, Network</li>
                <li><strong>Supply Chain</strong> &mdash; Dependencies</li>
                <li><strong>Oversight &amp; Auditability</strong> &mdash; Auditability, Human Oversight</li>
              </ul>
            </Section>

            <Section id="report-types" title="Report Types">
              <p>Every report is built from one canonical scan result &mdash; the same verdict, score, and findings, rendered six different ways for six different audiences, all from the exact same evidence. Switch between them with the tabs at the top of any report:</p>
              <ul className="ml-4 list-disc space-y-1">
                <li><strong>Executive</strong> &mdash; a 60-second read for a CEO, CISO, CTO, buyer, or investor: verdict, score, top risks, what to fix first.</li>
                <li><strong>Security</strong> &mdash; the full security analysis: posture, categories, capability chains, MCP, controls, evidence, limitations.</li>
                <li><strong>Developer</strong> &mdash; action-oriented: file, line, what&apos;s wrong, why it matters, how to fix it, and example code, for every finding.</li>
                <li><strong>Compliance</strong> &mdash; findings mapped to OWASP LLM Top 10, NIST AI RMF, and SOC 2 &mdash; evidence, never a certification claim.</li>
                <li><strong>AI / JSON</strong> &mdash; the stable, schema-versioned machine-readable report for CI/CD, SIEM, and API clients.</li>
                <li><strong>Full Technical</strong> &mdash; essentially everything Agent Verify knows about the scan in one place, without exposing the detection engine&apos;s internal implementation.</li>
              </ul>
            </Section>

            <Section id="reports" title="Reports">
              <p>A report page shows the verdict, score, category breakdown, threat-category assessment, prioritized fix plan, individual findings with evidence, compliance mapping, and the Runtime Bill of Materials. Reports created via the CLI/API are stored separately from dashboard (browser) reports so their provenance (<code>source: cli</code> vs <code>dashboard</code>) is always visible on the report itself.</p>
            </Section>

            <Section id="sharing" title="Sharing Reports">
              <p>Reports are private by default. An owner can explicitly toggle a report to <strong>Public</strong> from Share settings, which makes it reachable at its canonical URL without signing in; toggling back to <strong>Private</strong> immediately revokes that access. Anyone who can edit the report can regenerate its content by re-scanning, which produces a new report ID and URL &mdash; the old link is unaffected. Password-protected sharing is not implemented yet; the UI will not claim it works until a server can verify a password before releasing report content.</p>
            </Section>

            <Section id="json-output" title="JSON Output">
              <CodeBlock>{`agentverify scan ./agents --json > results.json`}</CodeBlock>
              <p>Produces <code>{`{ results: [...], summary: { total, verified, notVerified, notAssessed, errors } }`}</code> for CI systems, dashboards, or custom tooling.</p>
            </Section>

            <Section id="schema" title="JSON Schema">
              <p>The AI/JSON report view is validated against a documented JSON Schema (<code>packages/scanner/schema/report.schema.json</code>, draft-07) checked into the repository, including negative tests that confirm it actually rejects invalid data. Field names match the scanner&apos;s real output exactly: <code>schemaVersion</code>, <code>reportId</code> (referred to as scanId), <code>verdict</code>, <code>riskScore</code>, <code>scoreFormula</code>, <code>findings</code> (each with a stable <code>code</code>), <code>securityCategories</code>, <code>capabilities</code> (consequential capabilities), <code>mcpExposures</code> (MCP servers/tools), <code>capabilityChains</code>, <code>securityControlsDetected</code>, <code>bom</code> (runtime bill of materials &mdash; the closest field to a general permissions/tools summary), <code>notDetermined</code>, and <code>metadata.scannerVersion</code> (also referred to as &quot;ruleset version&quot; &mdash; the scanner ships as one versioned unit with its detection rules, so there is no separately-versioned ruleset artifact). A <code>comparisonSummary</code> is included only when you supply a previous scan to compare against &mdash; a single scan has nothing to compare on its own.</p>
            </Section>

            <Section id="compliance" title="Compliance Mapping">
              <p>The Compliance report view maps findings to <strong>OWASP LLM Top 10</strong>, <strong>NIST AI Risk Management Framework</strong> (GOVERN/MAP/MEASURE/MANAGE function citations), and <strong>SOC 2 Trust Services Criteria</strong>. Every row says <strong>&quot;Potential Gap&quot;</strong> (a finding suggests a control may not be met) or <strong>&quot;Evidence Found&quot;</strong> (a detected positive control) &mdash; never <strong>&quot;Compliant&quot;</strong>. A framework control with no mapped item for a given scan is shown as <em>not evaluated</em>, not silently omitted as if it passed. This is a real, code-derived mapping (each finding already carries its own citations), not a marketing checklist, and it does not constitute a compliance certification of any kind.</p>
            </Section>

            <Section id="integrity" title="Report Integrity">
              <p>Every report can carry a SHA-256 hash of its canonical evidence fields (verdict, score, findings, capabilities, MCP exposures, BOM, and related scan output &mdash; not presentation/sharing state like public/private visibility, which is expected to change after a scan). Recomputing the hash from the currently-stored evidence and comparing it to the stored hash tells you whether that data has changed since it was hashed.</p>
              <p><strong>What this proves:</strong> the evidence fields are byte-identical to what was hashed at scan time. <strong>What this does not prove:</strong> that the scan itself was accurate (a wrong scan hashes just as cleanly as a correct one), and it is not a cryptographic signature or a third-party-verifiable attestation &mdash; there is no private key or external timestamping authority involved. Anyone with write access to the underlying data store could recompute and overwrite the hash alongside the data, so this defends against accidental corruption or a partial/naive tamper, not a fully compromised backend acting deliberately. Agent Verify does not claim reports are &quot;immutable&quot; anywhere in the product &mdash; this is hash verification, described exactly as what it is.</p>
            </Section>

            <Section id="benchmark" title="Benchmark Methodology">
              <p>Scan-duration numbers are measured, not asserted: <code>packages/scanner/benchmark/benchmark.mjs</code> runs the real <code>scan()</code> function 30 times against four representative synthetic fixture sizes (small ~200B, medium ~8KB, large ~100KB, very-large ~2.3MB &mdash; past the scanner&apos;s internal truncation limit) and reports median, p95, fastest, and slowest wall-clock time. As measured: a small agent file scans in a fraction of a millisecond; a 100KB file in single-digit milliseconds; a 2.3MB file (larger than any realistic single agent module, and past the point the scanner truncates for safety) in roughly 100&ndash;125ms. The scan computation itself is not the bottleneck in any realistic use of the product &mdash; network transfer and the CLI/API round-trip dominate end-to-end time, and those depend on your network conditions, not on the scanner.</p>
            </Section>

            <Section id="a2spa" title="A2SPA Checks">
              <p>A2SPA (execution-time authorization) findings check whether an agent&apos;s consequential actions are protected by: a cryptographic signature over the execution request, a per-request nonce (replay protection), a timestamp/expiry window, fail-closed behavior when verification fails, and a scoped (non-wildcard) permission model. Agent Verify detects whether this evidence is present in the submitted code &mdash; it does not itself sign or verify production traffic.</p>
              <p>Each report carries an overall A2SPA status, deliberately conservative &mdash; <strong>mentioning &quot;A2SPA&quot; by name in a comment or string is never treated as evidence</strong>; only an actual signature/verification code pattern counts:</p>
              <ul className="ml-4 list-disc space-y-1">
                <li><strong>Detected</strong> &mdash; all five controls show real code-pattern evidence.</li>
                <li><strong>Partially detected</strong> &mdash; some but not all controls show evidence.</li>
                <li><strong>Not detected</strong> &mdash; none of the five controls show evidence.</li>
                <li><strong>Cannot determine</strong> &mdash; there wasn&apos;t enough execution context to assess anything.</li>
              </ul>
            </Section>

            <Section id="comparison" title="Scan-to-Scan Comparison">
              <p>When you scan the same agent again (matched by agent name, falling back to file name, within your own account), the report shows what changed since the previous scan: score delta, verdict change, new vs. resolved findings, capability and MCP exposure changes, and risk-relevant configuration changes. Findings are matched by their stable <code>code</code> only &mdash; never by title text or evidence content &mdash; so two unrelated findings are never falsely merged, and the same finding is still recognized as unchanged even if its evidence shifted slightly.</p>
            </Section>

            <Section id="controls-detected" title="Security Controls Detected">
              <p>Reports don&apos;t only list what&apos;s wrong. A &quot;Security Controls Detected&quot; section lists real positive signals already present in the code (scoped permissions, human approval gates, audit logging, rate limiting, and others) &mdash; never awarded without matching evidence. Every report also includes a &quot;What Agent Verify Could Not Determine&quot; section stating the specific limits of static analysis for that scan (runtime-only behavior, dynamically granted permissions, external policy, production network ACLs, and similar).</p>
            </Section>

            <Section id="rbom" title="Runtime Bill of Materials">
              <p>Where detectable from the submitted content, each report shows: detected language, framework (LangChain, AutoGen, CrewAI, OpenAI, Anthropic, LlamaIndex, Haystack), platform, agent name, tool access level, credential exposure, memory persistence, audit logging, human approval gates, rate limiting, prompt-injection surface, and delegation scope. Fields Agent Verify cannot determine from the submitted content are shown as <strong>Unknown</strong> or <strong>Not Detected</strong> &mdash; never guessed.</p>
            </Section>

            <Section id="formats" title="Supported Formats">
              <p>The CLI scans <code>.js</code>, <code>.ts</code>, <code>.py</code>, <code>.json</code>, <code>.yaml</code>, <code>.yml</code>, <code>.md</code>, <code>.mjs</code>, and <code>.cjs</code> files, skipping <code>node_modules</code>, <code>.git</code>, build output, and coverage directories. The web scanner accepts pasted text or a single uploaded file of the same types.</p>
            </Section>

            <Section id="limitations" title="Limitations">
              <ul className="ml-4 list-disc space-y-2">
                <li>Agent Verify performs <strong>static</strong> analysis of submitted content. It does not execute your agent, and it cannot see behavior that only exists at runtime or in code that wasn&apos;t submitted.</li>
                <li>Findings are evidence-based and heuristic. A clean report is not a guarantee of safety, and a finding is not proof of exploitation &mdash; both should be read as signals, not deterministic facts.</li>
                <li><code>NOT ASSESSED</code> means there wasn&apos;t enough agent execution context to issue a verdict &mdash; it must never be read as, or presented as, <code>VERIFIED</code>.</li>
                <li>Dashboard (browser) scans are self-reported: the report is written by the signed-in browser, not attested by the server. CLI/API scans are computed and saved server-side.</li>
                <li>Detected secrets are redacted in every report; Agent Verify does not store or display live credential values.</li>
              </ul>
            </Section>

            <Section id="troubleshooting" title="Troubleshooting">
              <ul className="ml-4 list-disc space-y-2">
                <li><strong>&quot;API key required&quot;</strong> &mdash; pass <code>--key</code> or set <code>AGENTVERIFY_API_KEY</code>.</li>
                <li><strong>&quot;Invalid or unauthorized Agent Verify API key&quot;</strong> &mdash; the key is missing, malformed, disabled, or was regenerated (which revokes the old key). Generate a fresh key from the dashboard.</li>
                <li><strong>HTTP 429 / &quot;Monthly scan quota exceeded&quot;</strong> &mdash; you&apos;ve used your plan&apos;s scans for the current month. Upgrade to Pro or wait for the next billing month.</li>
                <li><strong>No agent files found</strong> &mdash; the directory has no files with a supported extension; scan a specific file with <code>--file</code>.</li>
                <li><strong>Exit code 3 in CI</strong> &mdash; this is an execution error (key/network/file), not a failed agent. Fix the pipeline configuration, not the agent.</li>
              </ul>
            </Section>

            <Section id="faq" title="FAQ">
              <p><strong>Does Agent Verify run my agent&apos;s code?</strong> No. Analysis is static; your code is inspected, not executed.</p>
              <p><strong>Can a report be forged or edited after it&apos;s created?</strong> A report&apos;s verdict, score, and findings are immutable once saved &mdash; only visibility (public/private) can change afterward.</p>
              <p><strong>What happens to scans over my plan&apos;s limit?</strong> The API returns <code>429</code> and no scan is performed or counted against your quota.</p>
              <p><strong>Is the scanner open source?</strong> The web app, CLI, and Worker API are open source. The detection engine (<code>@agentverify/scanner</code>) is proprietary and lives only in the private build behind the API &mdash; the published CLI package is a pure HTTP client and does not bundle it.</p>
              <p><strong>Does the CLI send my code anywhere?</strong> Yes &mdash; each scanned file&apos;s content is sent to the Agent Verify API over HTTPS to be analyzed server-side; nothing is scanned locally by the CLI itself. Don&apos;t scan files containing production secrets you aren&apos;t comfortable transmitting.</p>
            </Section>
          </div>
        </div>
      </div>
    </main>
  )
}
