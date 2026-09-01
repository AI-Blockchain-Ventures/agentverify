# Agent Verify GitHub Action

Run Agent Verify in pull requests to block unsafe AI agent releases before merge.

## Requirements

- Create an Agent Verify API key from the Agent Verify dashboard: `https://aimodularity.com/agentverify/dashboard/`.
- Add it to your GitHub repository secrets as `AGENTVERIFY_API_KEY`.
- Do not paste API keys into workflow files, logs, README files, or source code.

## Basic PR Scan

```yaml
name: Agent Verify

on:
  pull_request:
    branches: [main]

jobs:
  agentverify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Agent Verify scan
        run: npx --yes agentverify scan ./agents --ci
        env:
          AGENTVERIFY_API_KEY: ${{ secrets.AGENTVERIFY_API_KEY }}
```

The local Worker code path fails closed for missing, malformed, invalid, disabled, or revoked API keys before scan findings are returned. Validate the deployed API path before relying on this as production enforcement.

## Composite Action Usage

When using this repository as an action, call the composite wrapper:

```yaml
- uses: AI-Blockchain-Ventures/agentverify@v1
  with:
    path: ./agents
    api-key: ${{ secrets.AGENTVERIFY_API_KEY }}
    format: text
```

Inputs:

| Input | Default | Description |
| --- | --- | --- |
| `path` | `./agents` | File or directory to scan. |
| `api-key` | required | Pass `${{ secrets.AGENTVERIFY_API_KEY }}`. |
| `format` | `text` | Use `text`, `markdown`, or `json`. |
| `fail-on-not-assessed` | `true` | Keep PR blocking strict when code cannot be assessed. |
| `upload-report-artifact` | `false` | Upload CLI output as `agentverify-results`. |
| `policy` | (none) | Evaluate a built-in policy profile (`standard`, `high-security`, `financial-agent`, `production-infrastructure`) against the scan, in addition to the scanner's own verdict. Leave unset to skip. |
| `comment-on-pr` | `false` | Post/update a single Agent Verify summary comment on the triggering pull request. Requires `permissions: pull-requests: write`. |
| `github-token` | `${{ github.token }}` | Token used to post/update the PR comment when `comment-on-pr` is `true`. |

Outputs: `output-file` (path to the CLI's console/markdown/json output) and `summary-file` (path to a machine-readable JSON summary — verdict, score, findings, policy result, report URL per file — the composite action's own PR-comment step reads this same file).

Every scan run also writes a GitHub Actions job summary (the "Summary" panel on the run page) automatically — no extra input needed, since the CLI detects the `GITHUB_STEP_SUMMARY` environment variable GitHub Actions sets for every job.

## Markdown Summary Mode

```yaml
- name: Agent Verify Markdown
  run: npx --yes agentverify scan ./agents --ci --markdown > agentverify-summary.md
  env:
    AGENTVERIFY_API_KEY: ${{ secrets.AGENTVERIFY_API_KEY }}
```

The Markdown output includes file count, score, verdict, risk level, top blocker, fix-first guidance, threat categories when available, A2SPA docs, and report URL when saved.

## JSON Output Mode

```yaml
- name: Agent Verify JSON
  run: npx --yes agentverify scan ./agents --ci --json > agentverify-results.json
  env:
    AGENTVERIFY_API_KEY: ${{ secrets.AGENTVERIFY_API_KEY }}
```

Use JSON output for custom workflow processing, artifacts, or security dashboards.

## Monorepo Path Scan

```yaml
- name: Scan agent package
  run: npx --yes agentverify scan ./packages/agents --ci
  env:
    AGENTVERIFY_API_KEY: ${{ secrets.AGENTVERIFY_API_KEY }}
```

## PR Comment (built in)

The composite action can post — and keep updated across new commits — a single Agent Verify
summary comment on the triggering pull request, with no custom scripting required:

```yaml
permissions:
  pull-requests: write

jobs:
  agentverify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: AI-Blockchain-Ventures/agentverify@v1
        with:
          path: ./agents
          api-key: ${{ secrets.AGENTVERIFY_API_KEY }}
          comment-on-pr: true
```

This only does anything on a `pull_request`-triggered run (it's a no-op otherwise, e.g. on
`push`). The comment includes per-file verdict, score, critical/high finding counts, policy
result when `policy` is set, and a report link when available. Re-running the workflow on a new
commit edits the existing comment in place — identified by a hidden HTML marker — rather than
posting a growing thread of separate comments. Requires `permissions: pull-requests: write` on
the job; `github-token` defaults to the workflow's own `${{ github.token }}` and rarely needs
overriding.

## Branch Protection

In GitHub repository settings, require the Agent Verify job before merge. With `--ci`:

- `VERIFIED` exits `0`.
- `NOT_VERIFIED` exits `1` and blocks merge — a real security/verification failure.
- `NOT_ASSESSED` exits `2` by default — insufficient evidence for a verdict.
- Invalid/missing API key, network failure, or a missing file exits `3` — an execution error, not a security finding. Treat repeated `3`s as an infrastructure problem to fix (key, network), not a signal about the agent's safety.

All three non-zero codes still block merge under a plain `if [ $? -ne 0 ]` branch protection check; the distinct codes exist for pipelines that want to react differently to "the agent failed" versus "the scan couldn't run."

Only set `fail-on-not-assessed: false` for repositories that intentionally scan mixed documentation/config paths and understand the risk.

## README Badges

Saved Agent Verify reports can expose badge URLs from the report page. A badge links to the canonical report URL:

```markdown
[![Agent Verify](https://agentverify-api.agentverify.workers.dev/v1/badge/REPORT_ID)](https://aimodularity.com/agentverify/report/?id=REPORT_ID)
```

Badge URLs reflect saved reports. Automatic README badge updates are planned for the packaged GitHub Action; they are not automated by this initial wrapper.

## Policy Evaluation and Artifact Fingerprint

Pass `--policy <id>` (CLI) or the `policy` input (composite action) to evaluate a built-in policy
profile against each scan's evidence, in addition to (never instead of) the scanner's own
verdict — a scan can be `VERIFIED` and still fail a stricter policy, and vice versa is never true
(a policy can never make a `NOT_VERIFIED` scan pass). Text/markdown/JSON output and the CLI's
`--summary-file`/job-summary output all include the policy id and `PASS`/`FAIL` result when set.

Every scan also computes a SHA-256 **artifact fingerprint** over the exact scanned content — text
and JSON output show a short preview; the full hash is in `--json`/`--summary-file` output as
`artifactFingerprint.artifactHash`. Two scans of byte-identical content always produce the same
fingerprint, independent of when they ran or whether the scanner's ruleset changed since.

## Generic CI (GitLab, others)

Agent Verify has no GitLab-specific integration — the CLI is a plain HTTP client that works
identically in any CI system with Node.js available. The pipeline shape is the same everywhere:

```
Checkout
  │
  ▼
Build
  │
  ▼
Agent Verify (npx agentverify scan --ci --policy <id>)
  │
  ▼
Policy evaluation (bound into the same scan — see above)
  │
  ├── VERIFIED (and policy PASS, if set) ──▶ continue / deploy
  │
  └── NOT VERIFIED (or policy FAIL) ──▶ stop the pipeline
```

`.gitlab-ci.yml`:

```yaml
agentverify:
  stage: test
  image: node:20
  script:
    - npx --yes agentverify scan ./agents --ci --policy standard --summary-file agentverify-summary.json
  artifacts:
    when: always
    paths:
      - agentverify-summary.json
  variables:
    AGENTVERIFY_API_KEY: $AGENTVERIFY_API_KEY
```

Exit codes are the same ones documented under [Branch Protection](#branch-protection) above:
`0` verified, `1` not verified, `2` not assessed, `3` execution error — any CI system's default
"non-zero exit fails the job" behavior is sufficient; nothing GitHub-specific is required to
enforce this as a merge gate elsewhere. `--summary-file` writes the same JSON shape as `--json`
to a path of your choice, useful for a system that wants the machine-readable result without
parsing stdout.

An artifact fingerprint and (when a signing key is configured server-side) a signed attestation
are available from any CI system the same way — they're just fields on the scan response
(`artifactFingerprint`, `attestation`) and in `--json`/`--summary-file` output, not something
tied to GitHub Actions specifically.

## What Comes Next

- Packaged marketplace action release.
- README badge automation.
