# Agent Verify Scanner Contract

`@agentverify/scanner` is the single authority for scan classification, findings, scoring,
verdicts, BOM output, and scanner metadata. **Only Worker-side (server-only) code and Next.js
Server Components may call this package directly** — see
[private-scanner-boundary.md](./private-scanner-boundary.md). Browser-shipped code must never
import it, even transitively; the CLI reaches it only through the Worker API, never as a local
dependency. A narrow set of pure, non-secret operations (attestation signature verification,
report-hash computation, policy evaluation against an already-produced result) are independently
reimplemented client-side rather than reimplementing scanner *rules* — those reimplementations
are documented at the top of each file that has one (`apps/web/src/lib/verifyAttestation.ts`,
`reportIntegrity.ts`, `policyEvaluation.ts`) and must stay faithful to this contract.

## Result Shape

- `schemaVersion`: currently `1.3.0`.
- `verdict`: one of `VERIFIED`, `NOT_VERIFIED`, or `NOT_ASSESSED`.
- `findings[].code`: stable machine-safe finding identifier.
- `metadata.scannerVersion`: scanner implementation version.
- `reportId`, `metadata.scannedAt`, and `metadata.scanDuration` are volatile and must not be used for parity assertions.

## Verdict Semantics

- `VERIFIED`: sufficient execution context was assessed and required trust controls passed.
- `NOT_VERIFIED`: sufficient execution context was assessed and one or more security or protocol controls failed.
- `NOT_ASSESSED`: submitted content did not contain enough agent execution context to make a verification decision.

`NOT_ASSESSED` must not be presented as `VERIFIED` and must not be treated as a security failure caused by missing A2SPA controls.

## Consumer Rules

- Store machine-safe verdict values only.
- UI and CLI may render friendly labels such as `NOT VERIFIED` and `NOT ASSESSED`.
- Worker responses may add transport fields such as `saved` and `reportUrl`, but scanner-owned fields must come from `@agentverify/scanner`.
- Browser-created or owner-writable documents are not server-attested verification evidence.
