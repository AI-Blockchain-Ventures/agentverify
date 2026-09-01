# Changelog

All notable user-facing changes to Agent Verify are documented here. The CLI/SDK package has its
own more granular changelog at [packages/cli/CHANGELOG.md](./packages/cli/CHANGELOG.md).

## [1.4.0] - Unreleased

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
