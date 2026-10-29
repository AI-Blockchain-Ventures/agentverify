# Changelog

All notable user-facing changes to Agent Verify are documented here. The CLI/SDK package has its
own more granular changelog at [packages/cli/CHANGELOG.md](./packages/cli/CHANGELOG.md).

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
