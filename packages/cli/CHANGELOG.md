# Changelog

All notable changes to the `agentverify` CLI/SDK package are documented here.

## [1.5.0] - 2026-09-22

### Added

- `--profile <id>` — assess a directory against an assessment profile instead of running the
  standard scan/verify flow. `owasp-agentic-skills-2026` is the first supported profile
  (assessment schema `1.1.0`, currently alpha): `agentverify scan <dir> --profile owasp-agentic-skills-2026 --key av_your_key`.
  Prints AST02/AST03/AST04 evidence-based results (`EVIDENCE_OBSERVED` / `GAP_IDENTIFIED`) plus
  every other control explicitly as `NOT_ASSESSED`; `--json` prints the service's response
  unmodified.

## [1.4.0] - Shipped

### Changed — CI exit codes now distinguish a security failure from an execution error (behavior change)

Previously, `--ci` mode used exit code `1` for **both** a real `NOT_VERIFIED` verdict **and** any execution error (missing/invalid API key, network failure, missing file). That made it impossible for a pipeline to tell "the agent failed the security check" apart from "the scan itself couldn't run."

New exit codes:

| Code | Meaning | Previously |
| --- | --- | --- |
| `0` | All scanned files verified | `0` (unchanged) |
| `1` | `NOT_VERIFIED` — a real security/verification failure | `1` (unchanged) |
| `2` | `NOT_ASSESSED` — insufficient evidence for a verdict | `2` (unchanged) |
| `3` | **New.** Execution error — bad/missing API key, network failure, missing file, unknown command | was `1` |

**If your pipeline only checks `exit code != 0` to block a deployment, this is not a breaking change** — every previously-non-zero case is still non-zero. **If your pipeline branches on the exact code `1`**, an execution error will now surface as `3` instead — update any such logic to treat both `1` and `3` as failures, or to react differently to `3` (an infrastructure problem, not a security finding).

### Fixed

- Scanner: findings that reference a detected credential no longer include the live secret value in `evidence` — only a redacted preview (e.g. `api_key: "sk_l****" (redacted)`). Affects report evidence produced by any scan, including those made public via report sharing.

## [1.3.0] - 2026-07-13

Initial public release. See git history for prior changes.
