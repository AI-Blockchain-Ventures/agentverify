# Changelog

All notable user-facing changes to Agent Verify are documented here. The CLI/SDK package has its
own more granular changelog at [packages/cli/CHANGELOG.md](./packages/cli/CHANGELOG.md).

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
