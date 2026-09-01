# Security Policy

Agent Verify is a security product that ingests potentially hostile, untrusted content (agent
source code and configuration) by design. We take reports about the product's own security
seriously.

## Reporting a vulnerability

**Do not open a public GitHub issue for a security report.** Email
**hello@aiblockchainventures.com** with:

- A description of the issue and its potential impact
- Steps to reproduce (a minimal example, if possible)
- Which component is affected (web app, CLI, Worker API — see the component table in
  [README.md](./README.md); the detection engine itself is proprietary and not in this repo, but
  we still want to hear about it)

We aim to acknowledge reports within 3 business days. Please give us a reasonable window to
investigate and ship a fix before any public disclosure.

## Scope

In scope: the web app (`apps/web`), CLI/SDK (`packages/cli`), and Worker API (`workers/api`) in
this repository, and the deployed instances at `aimodularity.com/agentverify` and
`agentverify-api.agentverify.workers.dev`.

Out of scope: automated scanning/spam reports with no demonstrated impact, social engineering,
and physical security.

## What we do to reduce risk

- Scanned content is analyzed statically — Agent Verify never executes submitted agent code.
- Detected secrets are redacted before they are ever persisted or displayed — see
  `packages/scanner`'s redaction handling (proprietary, not in this repo, but the contract is
  enforced end-to-end: raw secret values never appear in a report).
- Firestore Security Rules enforce per-user access control server-side, not just in the UI —
  see [`firestore.rules`](./firestore.rules) and the emulator test suite in
  [`firestore-tests/`](./firestore-tests).
- Stripe webhook payloads are signature-verified (HMAC-SHA256) and processed idempotently.
- API keys are validated server-side on every request; regenerating a key immediately revokes
  the previous one.

## Known limitations

This is a young product under active development. See [README.md](./README.md#limitations) for
what static analysis cannot see, and the "What Agent Verify Could Not Determine" section on every
report for scan-specific gaps.
