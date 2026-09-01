# Agent Verify

**Know what your AI agent can do before you deploy it.**

Agent Verify inspects an AI agent or agent package — its permissions, tools, MCP connections,
execution controls, secrets, runtime configuration, and dependencies — and issues a **VERIFIED**
or **NOT VERIFIED** result with evidence, before the agent reaches production.

Traditional security tools scan software. Agent Verify also examines what an AI agent is
*connected to* and what those connections may let it actually *do* — a legitimate credential,
valid API access, and an approved tool can still combine into an action the agent should never
be able to take.

Agent Verify provides open-source CLI, CI, web integration, and API tooling backed by a
proprietary verification engine — see [Privacy & proprietary scanner boundary](#privacy--proprietary-scanner-boundary).

## Architecture

```
Dashboard ─┐
CLI ───────┼──► Worker API ──► server-side entitlement & scan quota ──► private scanner engine
API ───────┘         │
                      └──► D1 (billing/quota) · Firestore (reports, orgs, audit log)
```

Every scan — from the dashboard, the CLI, or a direct API call — goes through the same
authenticated Worker route and the same server-owned monthly quota; there is no client-only or
local-storage-based scan counter anywhere in the product, and no browser code ever runs the
detection engine directly. See [Web App](#web-app) and [Privacy & proprietary scanner
boundary](#privacy--proprietary-scanner-boundary) for how that boundary is enforced and verified.

## What this repo contains — open source vs. proprietary

| Component | Location | License |
| --- | --- | --- |
| Web app (dashboard, reports, landing page) | `apps/web` | Open source (this repo, MIT) |
| CLI / SDK (`agentverify` on npm) | `packages/cli` | Open source (this repo, MIT) |
| Cloudflare Worker API | `workers/api` | Open source (this repo, MIT) |
| **Detection engine** (`@agentverify/scanner`) | `packages/scanner` | **Proprietary — not in this repository** |

## Quick Start — CLI

```bash
npm install -g agentverify
agentverify scan ./agents --key av_your_key
```

Get an API key from **Dashboard → API access** after signing in at
https://aimodularity.com/agentverify/. Full docs, including the API contract, CI/CD integration,
and JSON output shape: https://aimodularity.com/agentverify/docs/

```bash
agentverify --help
agentverify --version
agentverify scan ./agents --key av_your_key           # scan a directory
agentverify scan --file agent.json --key av_your_key   # scan a single file
agentverify scan ./agents --key av_your_key --ci        # CI mode, strict exit codes
agentverify scan ./agents --key av_your_key --ci --policy standard  # + policy evaluation
```

CI exit codes distinguish a real security failure from an execution problem:

| Code | Meaning |
| --- | --- |
| `0` | All scanned files verified |
| `1` | `NOT_VERIFIED` — a real security/verification failure |
| `2` | `NOT_ASSESSED` — insufficient evidence for a verdict |
| `3` | Execution error — bad/missing API key, network failure, missing file (not a security finding) |

## GitHub Action

```yaml
- uses: AI-Blockchain-Ventures/agentverify@v1
  with:
    path: ./agents
    api-key: ${{ secrets.AGENTVERIFY_API_KEY }}
```

See [docs/github-action.md](./docs/github-action.md) for the full reference — Markdown/JSON
output modes, PR comment posting, branch protection, and policy evaluation in CI.

## Web App

The dashboard (`apps/web`) provides scan history, report sharing, a check catalog, policy
profiles, and organization/team management (roles: Owner/Admin/Member/Viewer) on top of the same
Worker API the CLI uses — every dashboard scan is server-metered exactly like a CLI or API scan,
never run or counted client-side.

## What Agent Verify analyzes

Permissions and tool access, MCP server connections and what they expose, execution/authorization
controls, secrets and credential handling, runtime configuration, and dependencies — static
analysis of submitted content, not a live sandbox execution.

## Verification output

- **VERIFIED** — sufficient execution context was assessed and the required trust controls passed.
- **NOT VERIFIED** — sufficient execution context was assessed and one or more security or protocol controls failed.
- **NOT ASSESSED** — the submitted content didn't contain enough agent execution context to make a decision. This is not a security failure, and it must never be read as VERIFIED.

Every finding is also labeled by how it was derived: **definite** (a concrete pattern was
matched), **heuristic** (inferred from context — could be a false positive/negative), or
**informational** (a neutral observation). Agent Verify does static analysis — it never executes
submitted code — so it is honest about what it cannot see: see [Limitations](#limitations) below.

## Artifact fingerprinting / signed attestations

Every scan computes a SHA-256 **artifact fingerprint** over the exact scanned content — identical
content always produces the same fingerprint, independent of when it ran or whether the ruleset
changed since. When server-side signing is configured, a scan result can carry a **signed
attestation** (ECDSA P-256 / ES256) over the verdict, score, and fingerprint — independently
verifiable by any third party with nothing more than the published public key, with no shared
secret and no need to trust Agent Verify's API at verification time.

## Policies

Built-in policy profiles (`standard`, `high-security`, `financial-agent`,
`production-infrastructure`) can be evaluated against a scan's evidence in addition to — never
instead of — the base verdict: a scan can be `VERIFIED` and still fail a stricter policy, but a
policy can never turn a `NOT_VERIFIED` scan into a pass. Pass `--policy <id>` on the CLI or the
`policy` input on the GitHub Action.

## Security model

Billing, quota, and authentication are server-authoritative — see
[docs/billing-setup.md](./docs/billing-setup.md) for the full architecture. Webhook payloads are
signature-verified and processed idempotently, organization mutations are RBAC-enforced
server-side (never trusting a client-supplied role), and Firestore Security Rules enforce
per-user access control independently of the UI. Full detail and how to report an issue:
[SECURITY.md](./SECURITY.md).

## Privacy & proprietary scanner boundary

The detection engine — the actual rules that decide what's risky — is Agent Verify's core IP and
is intentionally **not tracked in this git repository** (`packages/scanner/` is gitignored). The
CLI and Worker call it over HTTPS or via a private build; nothing in this public repo bundles or
exposes its source, and no browser-shipped code ever imports it — only Worker-side (server-only)
code does. A permanent CI check (`npm run check:private-boundary`) builds the web app and
statically inspects every emitted client bundle for known proprietary markers on every change, so
this boundary can't silently regress. Public CI validates the web app, CLI, and Worker against a
type-compatible stub of the scanner (see `scripts/create-ci-scanner-stub.mjs`) so the public build
is verifiable without the private engine ever being present.

## Plans

Free (10 scans/month, basic findings, private report history), Pro ($19.99/month — full
remediation guidance, corrected snippets, A2SPA implementation guidance, PDF export, 100
scans/month), Team (coming soon), Enterprise (contact us). Pricing is defined once in
`apps/web/src/lib/pricing.ts` and mirrored in the Worker's quota table
(`workers/api/src/billing.ts`) — see those files for the current source of truth.

## Documentation

- App docs: https://aimodularity.com/agentverify/docs/
- GitHub Action reference: [docs/github-action.md](./docs/github-action.md)
- Billing/entitlement architecture: [docs/billing-setup.md](./docs/billing-setup.md)
- Proprietary scanner boundary: [docs/private-scanner-boundary.md](./docs/private-scanner-boundary.md)
- Roadmap: [ROADMAP.md](./ROADMAP.md)
- Changelog: [CHANGELOG.md](./CHANGELOG.md)

## Development

```bash
npm install
npm run dev              # apps/web dev server
npm run build             # apps/web production build
npm run build:cli         # packages/cli
npm run build:worker      # workers/api
npm run lint               # apps/web
npm run check:web          # apps/web typecheck
npm run check:worker       # workers/api typecheck
npm run test:worker        # workers/api tests
npm run test --workspace=packages/cli
npm run test:rules         # Firestore Security Rules against the real emulator
npm run check:private-boundary  # proprietary-boundary regression check
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full contributor guide, including what you can
and cannot modify and PR expectations.

## Limitations

Agent Verify performs **static** analysis of submitted content. It does not execute your agent
and cannot see: runtime-only behavior, permissions/credentials granted dynamically at deploy
time, remote policy enforced outside the codebase, production network ACLs, external identity
provider policy, or runtime secrets injected outside the source. Every report includes a "What
Agent Verify Could Not Determine" section stating this explicitly for that scan. Findings are
evidence-based and heuristic, not a formal proof of security — a clean report is not a guarantee
of safety, and a finding is not proof of exploitation.

## License

MIT — AI Blockchain Ventures LLC — hello@aiblockchainventures.com

MIT applies to the components in this repository (web app, CLI, Worker API) as listed above. The
detection engine is proprietary, is not distributed under this license, and is not included in
this repository.
