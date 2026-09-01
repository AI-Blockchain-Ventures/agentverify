# Private Scanner Boundary

Agent Verify's detection engine (`@agentverify/scanner`) is proprietary and is intentionally not
tracked in this repository — `packages/scanner/` is gitignored. This document explains where the
boundary is, how it's enforced, and how it's verified to stay that way.

## The rule

**No browser-shipped code may import from `@agentverify/scanner`, directly or transitively.**
Only Worker-side (server-only) code and Next.js Server Components may. This isn't a licensing
formality — the scanner package builds via a single bundled entry point, so even a "safe" named
import (a type, a hash function, a signature verifier) pulls the entire compiled module — the
real detection rules included — into whatever imports it. A client-safe named export must be
independently reimplemented in `apps/web`, not imported.

## Where scan-adjacent work actually happens

- `POST /v1/scan` — dashboard, CLI, and API scans. Authenticated (API key or Firebase ID token),
  quota-enforced server-side, runs the real engine.
- `POST /v1/demo/scan` — unauthenticated public demo scan. Rate-limited, size-capped, no
  persistence. Runs the real engine server-side; nothing about it ships client-side.
- `POST /v1/verify-fix` — authenticated, ownership-checked re-scan of a proposed remediation.
  Independent rate limit from the monthly scan quota; never increments it.
- `GET /v1/checks/catalog` — the public check catalog (names, descriptions, categories) is
  legitimately public product content, served from the Worker rather than imported client-side,
  because the module that builds it transitively imports real detection tables to construct
  itself from the same source of truth the engine uses.

## What's independently reimplemented client-side (not imported)

A handful of pure, non-secret operations are legitimately safe to run in the browser — signature
verification against a *published public key*, content-hash computation, and policy evaluation
against an already-produced scan result. These are reimplemented faithfully in `apps/web/src/lib/`
(`verifyAttestation.ts`, `reportIntegrity.ts`, `policyEvaluation.ts`) rather than imported, each
with a comment explaining why. If the scanner package's own canonicalization or algorithm ever
changes, these must be updated to match, or verification will safely start reporting an error
status rather than silently diverging.

## How this stays enforced

`npm run check:private-boundary` runs two independent checks:

1. **Static import audit** — every `apps/web/src` file importing `@agentverify/scanner` is
   checked against a small, explicitly reviewed allowlist of server-only files. Anything else
   fails immediately.
2. **Bundle content scan** — builds the web app and greps every emitted client chunk for marker
   strings derived live from the real proprietary source (when present — see below), catching
   transitive exposure that a literal-import grep alone would miss.

This runs in public CI on every push/PR (`.github/workflows/ci.yml`). Because the real
proprietary source only exists on a machine with private-package access, public CI runs the check
against a type-compatible stub (`scripts/create-ci-scanner-stub.mjs`) instead — the bundle content
scan has nothing sensitive to check for in that environment and is skipped, but the static import
audit runs in full either way, since it only inspects this repository's own source.
