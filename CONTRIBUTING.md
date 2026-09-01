# Contributing to Agent Verify

Thanks for your interest in contributing! Please read this before opening a PR — it explains
what's open for contribution and what isn't.

## What you can contribute to

- **Web app** (`apps/web`) — dashboard, reports, landing page, docs site, pricing.
- **CLI/SDK** (`packages/cli`) — command-line interface and the `agentverify` npm package.
- **Worker API** (`workers/api`) — the Cloudflare Worker backing the CLI/API and billing.
- **Documentation** — README, docs site content, this file, examples.
- **Firestore rules** (`firestore.rules`) and their tests (`firestore-tests/`).

## What you cannot contribute to (and why)

The **detection engine** (`@agentverify/scanner`) is proprietary and lives in `packages/scanner`,
which is **intentionally excluded from this repository** (`.gitignore`). If you clone this repo,
that directory will not exist on your machine — this is expected, not a broken checkout. Public
CI builds the web app, CLI, and Worker against a type-compatible stub of the scanner
(`scripts/create-ci-scanner-stub.mjs`) so the rest of the codebase stays verifiable without the
real engine ever being present publicly.

If you've found a scanner detection gap or false positive, please open an issue describing the
pattern and a (sanitized, non-sensitive) example — we'll evaluate it for the private engine. Pull
requests that add files under `packages/scanner/` will not be merged.

## Before you start

1. Check open issues/PRs to avoid duplicate work.
2. For anything nontrivial, open an issue first to discuss the approach.
3. Never commit secrets, API keys, or `.env*`/`.dev.vars` files — see [SECURITY.md](./SECURITY.md)
   to report an accidental leak.

## Development

```bash
npm install
npm run dev              # apps/web dev server
npm run build             # apps/web production build
npm run build:cli         # packages/cli
npm run build:worker      # workers/api
npm run lint               # apps/web
npm run test:worker        # workers/api tests
npm run test --workspace=packages/cli
npm run test:rules         # Firestore Security Rules against the real emulator (no live project needed)
```

## Pull requests

- Keep PRs focused — one concern per PR is easier to review.
- Add or update tests for behavior changes; do not weaken an existing test to make it pass.
- Run `npm run lint` and the relevant test suite(s) above before opening the PR.
- Describe what changed and why, not just what.
- Do not modify billing/entitlement logic (`workers/api/src/billing.ts`) or Firestore rules
  without also updating their tests.

## Code of conduct

Be respectful and constructive. We reserve the right to close issues/PRs that aren't.
