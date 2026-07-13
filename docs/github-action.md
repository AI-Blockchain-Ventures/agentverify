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

## Optional PR Comment

You can post Markdown output as a pull request comment with `GITHUB_TOKEN`; no custom server is required.

```yaml
- name: Agent Verify Markdown
  run: npx --yes agentverify scan ./agents --ci --markdown > agentverify-summary.md
  env:
    AGENTVERIFY_API_KEY: ${{ secrets.AGENTVERIFY_API_KEY }}

- name: Comment Agent Verify summary
  if: always() && github.event_name == 'pull_request'
  uses: actions/github-script@v7
  with:
    script: |
      const fs = require('fs')
      const body = fs.readFileSync('agentverify-summary.md', 'utf8')
      await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        body
      })
```

Packaged first-class PR comments are planned for a later action release.

## Branch Protection

In GitHub repository settings, require the Agent Verify job before merge. With `--ci`:

- `VERIFIED` exits `0`.
- `NOT_VERIFIED` exits non-zero and blocks merge.
- `NOT_ASSESSED` exits non-zero by default.
- Invalid or missing API key exits non-zero.

Only set `fail-on-not-assessed: false` for repositories that intentionally scan mixed documentation/config paths and understand the risk.

## README Badges

Saved Agent Verify reports can expose badge URLs from the report page. A badge links to the canonical report URL:

```markdown
[![Agent Verify](https://agentverify-api.agentverify.workers.dev/v1/badge/REPORT_ID)](https://aimodularity.com/agentverify/report/?id=REPORT_ID)
```

Badge URLs reflect saved reports. Automatic README badge updates are planned for the packaged GitHub Action; they are not automated by this initial wrapper.

## What Comes Next

- Packaged marketplace action release.
- Built-in PR comment helper.
- README badge automation.
