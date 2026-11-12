# Changelog

All notable user-facing changes to Agent Verify are documented here. The CLI/SDK package has its
own more granular changelog at [packages/cli/CHANGELOG.md](./packages/cli/CHANGELOG.md).

## [2.0.4] - 2026-11-12

### Fixed

- **A green check now always means the code was checked.** Pull-request checks on GitHub, GitLab and Bitbucket show a
  neutral (grey) result instead of a pass when the scanner could not assess the changes, when changed files could not
  be downloaded, or (GitLab and Bitbucket) when the monthly scan limit is reached.
- **Runtime guard (`agentverify/guard`):** rules written as global or sticky patterns now give the same decision every
  time, and a call whose arguments change while waiting for human approval is blocked instead of run.

Thanks to Nathan Freestone for the external
review that found all four issues.

### Changed

- **Fewer false alarms on real codebases.** Code checks now ignore comments, docstrings and description text, and
  look at the code around each match. For example, code that blocks the cloud metadata address is no longer reported as
  reaching it, and importing `subprocess` is no longer "command injection" on its own. On 12 company agent repos,
  serious findings dropped from 44 to 10, and every remaining one was confirmed by hand.

## [2.0.3] - 2026-11-09

### Added

- **State of AI Agent Security report** (`/state-of-agent-security/`). We scanned the source code of the 50 most-starred
  open-source AI agent projects on GitHub: 80% can run shell commands, 76% build commands from changing input, and 3
  passed every check. Totals only; no project is named next to a result. Possible secrets were reviewed by hand and
  none are reported as leaks.

## [2.0.2] - 2026-11-03

### Changed

- **Sample report shows the fix journey.** The demo report is now one agent in three versions — before (0/100),
  part-way (45/100) and after fixing (100/100, verified) — each with the code that was scanned.
- **Clearer verdicts.** A passing report now reads "No blocking problems found" (was "Execution authorized"), and every
  report and PDF says it checks the submitted code (static analysis) and is not a security certification.
- Signed-in people go to their dashboard instead of the marketing homepage, and reports open inside the dashboard
  sidebar instead of the site header.
- The OWASP Agentic Skills pages show coverage up front: 3 of 10 controls today.
- Pricing explains exactly what uses a monthly scan, a PR-check scan, or a Slack scan, and what doesn't count.
- The Trust and Privacy pages cover Fix & re-check and state that your code is never used to train AI models.

### Fixed

- Browsers and password managers no longer fill your email and password into the GitLab/Bitbucket project and token
  fields or the prompt-injection test form.

## [2.0.1] - 2026-11-03

### Added

- **Fix & re-check (Pro and Team).** Every report you own now has an editor with your code and the fix for each
  finding next to it. Press **Check my changes** to re-score it in seconds without using a monthly scan, repeat until
  the score is where you want it, then **Save as new report**. **Fix my file with AI** rewrites the file to address
  the findings and shows the new score before you use it (15 AI fixes per person a day). Your code is not stored.
- **Share bar at the top of every report.** "Make public & copy link" shares a private report in one click; "Make
  private" turns sharing off.

### Fixed

- Shared report links from dashboard scans showed "Report not found" to anyone not signed in, even when the report was
  public. They now open for everyone, and a private report says it is private instead of "not found".
- Copy-link buttons copied the link of a private report, which nobody else could open.
- The pricing table showed Team at $79 and listed team API keys. Team is $25 per seat (2-seat minimum), and API keys
  belong to each person.
- After canceling, the sidebar shows "Pro · ends <date>", and Billing says clearly that you won't be charged.
- A very long line containing repeated `SELECT` could make a scan take over a second; it now takes milliseconds.

### Changed

- **Fairer verdicts for agents that don't use A2SPA.** Request-signing checks now depend on what the agent can do.
  Read-only agents (they read and answer, but change nothing) can be VERIFIED without request signing; it shows as a
  low-severity suggestion. Agents that take actions (send email, edit files or data, run commands) pass with signed
  requests or a human approval step. High-impact agents (payments, refunds, deploys, deleting users, broad
  permissions) still need signed requests, or human approval plus an audit log. Any signing method counts — HMAC,
  JWT, A2SPA or your own.
- Placeholder values such as `YOUR_API_KEY` or `sk-your-key-here` are no longer reported as hardcoded secrets.
- YAML-style broad permissions (`permissions: all`, `tools: - '*'`) are now detected.

## [2.0.0] - 2026-10-30

Agent Verify now runs where you build agents: in your editor, inside your AI coding assistant, and on every pull request.

### Added

- **GitHub App (PR bot).** Install once; every pull request that changes agent code, prompts, tools or MCP config is
  scanned automatically. It adds a pass/fail check (fails on critical or high findings) with notes on the exact risky
  lines, and keeps one comment up to date on every push. PRs that don't touch agent code get a passing "no agent files"
  check and no comment. Pro and Team add the fixes to the comment. 50 GitHub scans a month on Free, 1,000 on Pro/Team.
- **Repo monitoring and alerts.** Connected repos are re-scanned when their main branch changes. The new
  **GitHub & Monitoring** dashboard tab shows each repo's score history and recent PR scans. Slack (and email, when
  enabled) alerts fire only for NEW findings at your chosen level, or a score drop of 10+.
- **MCP server: `agentverify mcp`.** Claude Code, Cursor, Windsurf and VS Code can now scan agents for you. Tools:
  `scan_path` (a file or a whole project as one report, with findings mapped back to file and line), `scan_code`, and
  `scan_mcp_config` (checks the MCP servers on your computer — only server definitions are read, and secret values are
  masked on your computer before anything is sent).
- **VS Code extension.** Underlines risky lines, fills the Problems panel, shows the security score in the status bar,
  optional scan on save, quick fixes that show the fix (Pro), API key in VS Code's secure storage, and it registers the
  Agent Verify MCP server for Copilot agent mode automatically.
- **Team plan, self-serve.** Per-seat checkout (2–100 seats), Team includes every Pro feature and 300 scans per person a
  month, and the owner adds or removes teammates by email from Billing. Seat changes made in Stripe are picked up
  automatically; if seats are reduced, the earliest-added members keep theirs. Team checkout switches on once a Team
  price is configured; until then the pricing page keeps "Talk to us".
- **MCP security directory** (`/mcp/`). A page for each of 66 popular MCP servers — "Is <server> safe?" — showing what
  it can do on your computer (run commands, change files, drive a browser, query a database, use your API keys), how to
  use it safely, code patterns worth reviewing, a pinned install snippet, and a README badge. Ratings describe reach,
  not intent; secret findings are never published; packages are read as text and never run.
- **GitHub Action v2** (`@v2`): pins CLI 2.x and lists each finding in the PR comment.
- **One-click fixes in pull requests (Pro).** For risks with a safe, exact line fix — certificate checks turned off,
  `yaml.load`, a pasted key (moved to an environment variable), debug mode, `http://` endpoints, unbounded LangChain
  loops — the PR bot posts a GitHub "suggested change" on the changed line; click **Commit suggestion**. Never repeated
  on later pushes. Free PR comments say how many one-click fixes are waiting.
- **Agent Guard (`agentverify/guard`).** Runtime protection for JavaScript/TypeScript agents: allow/deny lists,
  human approval for risky tools, allowed email/URL domains, rate limits, and blocking any call that carries an API key
  out. Blocked calls tell the model to stop. Decisions (secrets masked) appear in the new **Agent Guard** dashboard tab.
- **GitLab and Bitbucket.** Connect a project with an access token (stored encrypted) and a webhook; merge/pull requests
  get the same pass/fail status and updating comment. New **Repos & PR checks** tab (renamed from GitHub & Monitoring).
- **Slack app.** `/agentverify scan <public GitHub link or pasted code>`, `/agentverify connect`, `/agentverify help`.
- **Prompt-injection tests (Pro).** Ten known attacks sent to your own agent (after you prove ownership with a file on
  its host); canary-based results show which attacks worked. New **Injection tests** dashboard tab.
- **Compliance evidence pack (Pro).** EU AI Act (Articles 9, 12, 14, 15) and ISO/IEC 42001 (clauses 6.1.2, 6.1.3, 9.1)
  added to the Compliance view, plus a one-click .zip for auditors: summary, control tables (CSV), findings, the full
  report, and verification steps. Never "compliant" — only evidence observed, gap identified, or not assessed.
- **Referrals.** A free month of Pro for each friend who signs up and runs a scan; the friend gets 14 days.
- **Weekly email (opt-in).** Monday summary of monitored repos, new risks, invite progress; one-click unsubscribe.
- **Bigger MCP directory** with category comparisons ("X vs Y") and a "new this month" page.
- **New enterprise look.** Calmer colors, tighter corners, the shield logo in the header, a full footer, a dashboard
  sidebar with icons and a top bar, and layouts that use the width of large monitors. Partner logos scroll on the homepage.
- **Ask anything (Ctrl+K).** One box on every page: instant search over answers, docs, the MCP directory, dashboard pages
  and (signed in) your own findings, plus a short AI answer on Cloudflare Workers AI's free allowance. A hard daily cap
  keeps it free; when reached, Ask falls back to search. Questions are not stored.
- **"About you" signup step.** Name, company, role, team size, frameworks and how they heard about Agent Verify — all
  optional, with "Skip for now".
- **Admin panel** (`/admin`, only for verified emails in `ADMIN_EMAILS`): every account, how each one pays (Stripe, given
  by you, team seat, referral), signup details, scans this month, revenue estimate, CSV export, "Sync from Firebase", and
  **give anyone Pro or Team for free** for a set time or with no end date.
- **Getting started checklist** now has four steps, including "Connect a repo".
- **Trust Center** (`/trust`) and **System status** (`/status`) pages.
- **48 new checks (76 → 124).** MCP tool poisoning, invisible characters and tool shadowing in tool definitions;
  MCP servers installed from git URLs, run privileged, with sudo, over plain HTTP, bound to every network interface, or
  handed the whole environment; payments, deletions and outbound messages with no limit or approval; personal data sent
  to models and full prompts in logs; retrieval with no per-customer filter and unchecked web ingestion; cloud metadata
  access; unauthenticated agent endpoints; broad OAuth scopes and admin database users; AI agents in CI with
  `write-all` or checking out untrusted PR code; Kubernetes cluster-admin; identity from unverified headers; A2A agent
  cards with no auth; and framework checks for LlamaIndex, the Vercel AI SDK, Semantic Kernel, Claude Code, VS Code /
  Cursor auto-approve, smolagents, LangChain, the OpenAI Agents SDK, CrewAI, LangGraph and Google ADK. Each has a
  stable ID, a risky and a fixed test sample, and a hostile-input speed test.
- **Check library** (`/checks`). A help page for every check — what it finds, why it matters, what an attacker could
  do, how to fix it, and its OWASP / NIST / SOC 2 mapping — with search and filters. Every finding in a report links to
  its page. The Pro-only code snippet is not published there.
- **State of MCP Security report** (`/state-of-mcp-security`), computed from the MCP directory data at build time.
- **What's new in 2.0** page (`/whats-new`), linked from the homepage announcement.
- **Three new one-click examples** on the homepage scan: a poisoned MCP tool, an AI agent in CI, and a payments agent.
- **Running the product.** Website and API errors are grouped and emailed to the admin the first time each one
  happens (at most 10 alerts an hour), with a friendly error page instead of a blank crash. A "Growth funnel" in the
  admin panel shows demo scans → accounts → verified → first scan → connected repo → paying, from existing data. A
  **Feedback** button in the dashboard sends messages to the admin panel and by email (reply goes straight to the user).
  A three-email welcome series (welcome, connect a repo, what Pro adds) for verified new accounts, with one-click
  opt-out — off until `ONBOARDING_EMAILS = "true"`.
- **Plans.** Pro's price is read from Stripe (like Team's), optional yearly Pro (`STRIPE_PRO_ANNUAL_PRICE_ID`) with a
  Monthly/Yearly switch, and a free trial for first-time Pro buyers (`PRO_TRIAL_DAYS`, set to 14 days). Cleaner pricing page.
- **Ready for marketplaces.** GitHub Action branding for the Marketplace, MCP Registry metadata (`mcpName`,
  `packages/cli/server.json`), updated VS Code description.
- **Public demo limit.** Repeat scans of the same code (the Live Demo, the homepage examples) reuse a saved result and
  don't count toward the limit; new code gets 20 public scans per network per hour (was 5).

### Fixed
- Live Demo and homepage free scan: every outcome now shows right under the button (scanning, success, demo limit reached, server error, timeout after 30s, no connection), with Try again / sample-report links. Before, a reached demo limit (5 scans per network per hour) showed only a small line off-screen, so "Run live scan" looked like it did nothing. Buttons stay disabled ("Loading…") until the page's JavaScript is ready, so early clicks aren't lost. The Live Demo page no longer overflows sideways on phones. New e2e suite `e2e/live-demo.spec.ts` covers this on desktop, tablet, Android, and (with `E2E_WEBKIT=1`) Safari and iPhone.

- Integrations listed webhooks as "not yet deployed"; delivery is live since 1.6.

### Changed

- Version 2.0.0 across the scanner, CLI, web app and Worker. No scanning rules changed from 1.6.
- Pricing and the plan comparison describe the PR bot, monitoring, editor tools and per-seat Team.

### Deploy notes

- New database tables: `workers/api/schema/` — `github.sql`, `team.sql`, `growth.sql`, `guard.sql`, `vcs.sql`,
  `slack.sql`, `redteam.sql`, `admin.sql`, `ops.sql`.
- Optional vars: `ONBOARDING_EMAILS` (welcome emails, default off), `PRO_TRIAL_DAYS`, `STRIPE_PRO_ANNUAL_PRICE_ID`.
- `ADMIN_EMAILS` Worker secret (comma-separated) — who can open `/admin`. Workers AI is bound as `AI` in
  `wrangler.toml`; `ASK_DAILY_CAP` (default 150) keeps Ask inside the free daily allowance.
- New Worker secrets (only needed for the features that use them): `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`,
  `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_SLUG`; `STRIPE_TEAM_PRICE_ID`;
  optional `RESEND_API_KEY` + `ALERT_FROM_EMAIL` for email alerts and the weekly email; `TOKEN_ENCRYPTION_KEY` (32 random
  bytes, base64) for GitLab/Bitbucket tokens and injection-test headers; `SLACK_SIGNING_SECRET`, `SLACK_CLIENT_ID`,
  `SLACK_CLIENT_SECRET`; optional `PUBLIC_GITHUB_TOKEN` for Slack scans of public repos.

## [1.6.0] - 2026-10-27

### Added — easier first scan and better search/sharing (2026-10-29)

- **Homepage:** the main button is now "Scan an agent free" and jumps straight to the free scan (no sign-up),
  which now sits right under the headline. On phones the headline, buttons, and Run button fit without long scrolling.
- **Search and sharing:** every public page has its own title, description, and canonical URL; a proper
  1200x630 share card (`og-image.png`) replaces the stretched icon; dashboard and report pages are marked noindex.
- **Docs:** the GitHub Action snippet now uses `@v1.4.0`, a tag that exists (`@v1` did not).
- **Links without an ending slash** (e.g. `/agentverify/pricing`, `/agentverify/report/demo`) now redirect
  instead of showing the main site's 404 (new rule in `.htaccess`). The main site's `app.py` and
  `robots.txt` have matching changes (optional, not deployed yet).

### Added — more checks (44 → 76)

- **Scan a whole project.** In the dashboard, paste a public **GitHub repo link** (or a link to an
  agent's folder) or drop a **project .zip**. Agent Verify picks the files that define the agent —
  code, tools, prompts, MCP and config — skips dependencies, build output, lockfiles and binaries,
  and scans them together (up to 60 files / 5MB, one scan from the quota). The import runs in your
  browser: GitHub files are downloaded directly from GitHub, and the scan server never fetches
  user-supplied URLs.
- **MCP config scanner.** A new "MCP config" tab checks the MCP servers connected to Claude Desktop,
  Claude Code, Cursor, VS Code, Windsurf, and Cline — with where-to-find-your-file help. A bare
  config file is now assessed on its own (previously it returned NOT ASSESSED), and code-only
  A2SPA checks are not reported against it. Four new MCP checks (AV-MCP-101..104):
  `MCP_FILESYSTEM_BROAD_ROOT` (whole drive or home folder shared), `MCP_SECRET_IN_CONFIG` (token
  pasted into the config — always redacted), `MCP_REMOTE_SERVER_NO_AUTH`, `MCP_TOOLS_AUTO_APPROVED`.
  JSON configs (`"mcpServers": {...}`) are now recognized for MCP tool-exposure mapping too.
- **Framework check packs** (AV-FW-001..008), each only applied when that framework is in the code:
  LangChain shell/Python/requests tools (`LANGCHAIN_UNSAFE_TOOL`) and unrestricted SQL agents
  (`LANGCHAIN_SQL_AGENT_UNRESTRICTED`); CrewAI unsandboxed code execution and open delegation;
  AutoGen local code execution; OpenAI Agents SDK agents with tools but no guardrails; Claude Agent
  SDK agents without a tool allowlist; computer-use tools without a sandbox. Framework detection now
  also recognizes the Claude Agent SDK, OpenAI Agents SDK, LangGraph, Semantic Kernel, and Pydantic AI.
- **Data exfiltration path** (`DATA_EXFILTRATION_PATH`, AV-DATA-003): flags the "lethal trifecta" —
  an agent that reads private data, takes in untrusted content, and can send data out, with no
  destination allowlist or approval step.
- **12 new core detection checks**, each with its own stable catalog ID, regression test (fires on the
  risky shape, stays quiet on the safe shape), and OWASP LLM Top 10 / NIST AI RMF / SOC 2 mapping:
  - `SQL_INJECTION_RISK` (AV-RUNTIME-009) — SQL built by concatenation/interpolation instead of bound parameters.
  - `SSRF_RISK` (AV-NET-004) — outbound requests to a caller- or model-controlled URL with no host allowlist.
  - `UNSAFE_DESERIALIZATION` (AV-RUNTIME-010) — pickle/marshal/unsafe YAML/`torch.load` without `weights_only`.
  - `PATH_TRAVERSAL_RISK` (AV-RUNTIME-011) — file reads/writes/deletes using a caller-controlled path.
  - `INSECURE_OUTPUT_HANDLING` (AV-RUNTIME-012) — model output flowing into eval/exec/SQL/HTML with no schema validation.
  - `INDIRECT_PROMPT_INJECTION` (AV-RUNTIME-013) — web pages, emails, or retrieved documents added to the prompt without isolation.
  - `SAFETY_CONTROLS_DISABLED` (AV-HUMAN-002) — auto-approve, skip-permissions, `allow_dangerous_code`, `trust_remote_code`, `human_input_mode="NEVER"`.
  - `UNBOUNDED_AGENT_LOOP` (AV-RUNTIME-014) — `max_iterations`/`max_steps` set to None/Infinity.
  - `TLS_VERIFICATION_DISABLED` (AV-NET-005) — `verify=False`, `rejectUnauthorized: false`, and similar.
  - `SENSITIVE_DATA_IN_LOGS` (AV-DATA-001) — passwords, tokens, card numbers, or SSNs written to logs.
  - `SECRET_IN_SYSTEM_PROMPT` (AV-DATA-002) — credentials placed directly in a system prompt.
  - `MCP_UNPINNED_SERVER` (AV-DEP-002) — MCP servers launched with `npx -y`/`uvx` and no pinned version.
- **7 new secret types** (always redacted): Google API key, Hugging Face token, SendGrid key,
  Twilio key, npm token, Azure Storage account key, Discord bot token. Existing secret check IDs
  are unchanged.
- **Multi-file scans** in the dashboard: drop up to 20 files (5MB total) — agent code, config, MCP
  settings — and get one combined report. Still one scan from the monthly quota.
- **More file types** accepted in the dashboard and CLI (`.jsx`, `.tsx`, `.toml`, `.sh`, and more).
- **"Copy fix checklist"** on every report: a Markdown task list of the prioritized fixes, ready
  for GitHub, Jira, or Slack.
- Two new example agents (retrieval agent, safety switches off) that show the new checks.

### Changed — easier to use, clearer reports

- **Pro fixes are now enforced on the server.** For Free plans (and the public demo), the API returns every
  finding with its evidence and explanation but without `recommendedFix`, `quickFix`, or `fixCode`, marked
  `fixLocked: true`. This is applied before the report is hashed, signed, and saved, so integrity hashes and
  attestations stay valid. The dashboard, Agent Fixer, and Developer view show a locked Pro preview; the CLI
  prints a one-line Pro note. Reports made on Free and opened after upgrading say "re-scan to get the fix".
- **The score is now called "Security score"** (higher is safer) everywhere it is shown, including
  the PDF. The number and how it is calculated are unchanged.
- **Dashboard scan page:** the Scan button now sits directly under the input, examples show four
  with "Show all", and the cloud-platform picker moved into an optional section (it only labels the
  report; it never changed results). New "Ready to scan … uses 1 of your N monthly scans" hint.
- **Pricing:** a Free / Pro / Team comparison table, a side-by-side "what Pro unlocks" example, a
  FAQ, and clearer plan copy ("every plan runs all 76 checks"). Team is no longer "coming soon" —
  it lists what it includes today and has a "Talk to us" button.
- **Free reports** now show a locked preview where Pro's corrected code would be, and the findings
  banner says how many of the findings Pro has a fix for. The fix checklist includes fix text on Pro.
- **New Developers page** (/developers): install the CLI, scan before deploying, a copy-paste
  GitHub Action that blocks risky merges, CI exit codes, useful options, the scan API, and badges.
  Linked from the main menu.
- **Homepage:** a proof strip under the hero (76 checks, 5 frameworks with dedicated checks, 19
  secret types, OWASP / NIST / SOC 2 mapping) with a one-line CLI example.
- **Dashboard onboarding:** a "Getting started" checklist (first scan → fix and re-scan → add to
  CI) that ticks itself off from your real reports, and can be hidden.
- **Demo report** uses a more realistic finance agent (security score 30, six findings, and the
  controls it already has right) instead of a worst-case agent that scored 0.
- Homepage free scan: one-click example agents, a clear button, plain-English progress, and a
  "What to do next" panel after the result (create a free account, or book an AI Agent Safety Check).
- Reports: a score ring and severity bar in the header, a sticky section menu, and findings you can
  filter by severity, search, and expand/collapse all at once. New checks are tagged "New in v1.6".
- The verification check catalog has a "New in v1.6" filter.
- Scanner engine version is now `1.6.0` (reported in scan metadata and OWASP profile assessments).
  OWASP Agentic Skills assessment results are unchanged; only the version label moved.

### Fixed

- **Privacy Policy and Terms rewritten for 2.0.** They now list everything 2.0 collects and every service provider
  (Firebase, Cloudflare incl. Workers AI, Stripe, GitHub/GitLab/Bitbucket/Slack, Resend), retention (Guard events 30
  days, demo cache 6 hours, account deletion within 30 days), user rights, paid plans and refunds, acceptable use for
  injection tests, AI-answer disclaimer, liability cap, and Florida governing law. The old text said data was never
  shared with third parties and that paid plans were a future possibility.
- First live checks: the generic "hardcoded credentials" check no longer flags obvious placeholders such as
  `"YOUR_API_KEY"`, `"xxxxxxxx"` or an environment-variable name (real values are still caught and redacted); Slack
  scans explain GitHub rate limits in plain words, and use `PUBLIC_GITHUB_TOKEN` when set.
- Full pre-launch walkthrough (every page crawled on desktop and phone, signed-in dashboard, admin, billing,
  feedback, Slack link, rate limits — against the local 2.0 API): Pricing, Developers and the MCP directory no longer
  scroll sideways on phones (grid columns can't be stretched by code examples); a plan given by the admin no longer
  shows a "Manage billing" button that had nothing to open; Ask finds checks by their code ("tool poisoning");
  the 404 and verify pages have proper headings; removed an internal note from the API page. `npm run review`
  now creates every 2.0 table locally.
- Security hardening before launch: referral rewards only count accounts with a verified email (stops
  throwaway-account farming); admin plan grants confirm with Firebase that the account's email is verified (an
  impostor who signed up first with a partner's address can't receive it); a Slack `/agentverify connect` link now
  asks before linking a workspace to your account; PR comments escape file names.
- The cookie banner covered the Live Demo's "Run live scan" button on phones, so taps did nothing. It is now a slim
  bar on phones and never covers page content.
- Faster first load: the report viewer and Ask load on demand (homepage JavaScript 337 KB → 119 KB, Live Demo 322 KB →
  110 KB).
- Public routes (free scan, Ask) use Cloudflare's built-in rate limiter (`[[ratelimits]]`, 10 a minute per network)
  on top of the hourly limits.
- Homepage "How it works" and the dashboard scan panel said scans run "in your browser"; they have
  run on Agent Verify's server since v1.4. The wording now says so.

## [1.5.0] - 2026-09-22

### Added

- **OWASP Agentic Skills Top 10 profile assessment.** Assess a skill package against
  `owasp-agentic-skills-2026` — three controls are implemented in this profile version:
  **AST02 (Supply Chain Compromise)**, **AST03 (Over-Privileged Skills)**, and **AST04 (Insecure
  Metadata)**. AST01 and AST05–AST10 are explicitly reported as `NOT_ASSESSED` — never omitted,
  never implied as passing. Every result uses one of three evidence-based statuses:
  `EVIDENCE_OBSERVED`, `GAP_IDENTIFIED`, or `NOT_ASSESSED`. Assessed against the OWASP Agentic
  Skills Top 10 (CC-BY-SA-4.0) at a pinned upstream commit — this is not an OWASP certification
  or endorsement, and the profile mapping itself is versioned independently of Agent Verify
  (`1.0.0-alpha.1`, assessment schema `1.1.0`).
  - **CLI:** `agentverify scan <dir> --profile owasp-agentic-skills-2026`
  - **API:** `POST /v1/scan` with `{ "profile": "owasp-agentic-skills-2026" }`
  - **Web:** a new "OWASP Agentic Skills profile" option alongside the standard scan flow,
    showing per-control evidence, coverage, and remediation.
- **Signed profile attestations.** Add `"attest": true` to a profile-assessment request (or check
  "Request cryptographic signing" in the web UI) to receive an ECDSA P-256 signature over the
  exact assessment, issued by Agent Verify's independently published profile-attestation signing
  key (`GET /v1/profile-attestation/public-key`). Signing does not change the assessment result,
  and a signed or unsigned profile assessment consumes exactly one scan from the normal monthly
  quota — the same as any other scan.

## [1.4.0] - Shipped

### Added

- Organizations/workspaces with role-based access control (Owner/Admin/Member/Viewer), per-org
  API keys, webhooks, and a server-written audit log of security-relevant actions.
- Signed attestations (ECDSA P-256) over scan results, independently verifiable with no shared
  secret.
- Policy evaluation (`standard`, `high-security`, `financial-agent`, `production-infrastructure`)
  against scan evidence, available on the CLI, GitHub Action, and API.
- A public, unauthenticated demo scan endpoint and an authenticated fix-verification endpoint,
  both server-side only — neither ships the detection engine to the browser.
- GitHub Action: optional PR comment posting that updates in place across new commits.
- A permanent CI regression check (`check:private-boundary`) that fails the build if the
  proprietary detection engine is ever reachable from a browser-shipped bundle.

### Changed

- Dashboard scans now go through the same authenticated, server-metered route as CLI and API
  scans — one shared monthly quota per account across all three surfaces, enforced entirely
  server-side.
- Repeat Stripe checkout for an already-subscribed account reuses the existing customer and is
  routed to the billing portal instead of risking a second, concurrent subscription.
- CLI `--ci` exit codes now distinguish a real verification failure (`1`) from an execution error
  like a bad API key or network failure (`3`) — see the CLI changelog for the full breaking-change
  note.

### Fixed

- Several client-side code paths (public demo, fix-verification, the verification-check catalog,
  attestation/report-hash/policy display logic) that previously imported from the proprietary
  scanner package — safe individually, but pulling the whole compiled engine into the browser
  bundle transitively — now run server-side or use independent, non-proprietary reimplementations.

### Security

- Scanner findings that reference a detected credential no longer include the live secret value
  in evidence — only a redacted preview.
