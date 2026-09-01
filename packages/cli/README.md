# agentverify

**Execution trust analysis for AI agents — CLI and SDK**

Scan AI agent configurations for security issues, credential exposure, and governance gaps. Saved CLI reports appear in your Agent Verify dashboard when API report save succeeds.

## Install

```bash
npm install -g agentverify
```

## CLI Usage

### Scan a directory

```bash
agentverify scan ./agents --key YOUR_KEY
```

### Scan a single file

```bash
agentverify scan --file agent.json --key av_your_key
```

### Use environment variable

```bash
export AGENTVERIFY_API_KEY=av_your_key
agentverify scan ./agents
```

### JSON output (for CI/CD)

```bash
agentverify scan . --key av_your_key --json
```

### Markdown summary

```bash
agentverify scan ./agents --markdown
```

### CI mode

```bash
agentverify scan ./agents --ci
```

Normal scans print findings without failing the shell just because issues exist. CI mode is stricter: it exits non-zero when an agent is `NOT_VERIFIED`, when a scan errors, or when submitted content cannot be assessed.

Exit codes distinguish a security/verification result from an application error, so a pipeline can tell "the agent failed the check" apart from "the scan itself couldn't run":

| Code | Meaning |
| --- | --- |
| `0` | All scanned files verified |
| `1` | `NOT_VERIFIED` — a security/verification check failed |
| `2` | `NOT_ASSESSED` — insufficient evidence for a verdict (see `--allow-not-assessed`) |
| `3` | Execution error — the scan itself could not run (bad key, network failure, missing file) |

All non-zero codes still fail a pipeline step by default, so an existing `if [ $? -ne 0 ]`-style check keeps working unchanged.

## SDK Usage

```ts
import { scan, scanMany } from 'agentverify'
```

### Scan a single file

```ts
const result = await scan(
  { content: agentCode, fileName: 'agent.js' },
  { apiKey: process.env.AGENTVERIFY_API_KEY }
)

result.verdict    // 'VERIFIED' | 'NOT_VERIFIED' | 'NOT_ASSESSED'
result.riskScore  // 0-100
result.findings   // Array of security findings
```

### Scan multiple files

```ts
const results = await scanMany(
  [
    { content: agent1Code, fileName: 'agent1.js' },
    { content: agent2Code, fileName: 'agent2.js' },
  ],
  { apiKey: process.env.AGENTVERIFY_API_KEY }
)
```

## CI/CD Integration

### GitHub Actions

```yaml
- name: Agent Verify
  run: npx agentverify scan ./agents --ci
  env:
    AGENTVERIFY_API_KEY: ${{ secrets.AGENTVERIFY_API_KEY }}
```

Use this in pull requests to block merges when an agent is `NOT_VERIFIED`. The CLI prints score, verdict, risk level, top blocker, fix-first guidance, threat categories, A2SPA docs, and the canonical report URL:

```text
https://aimodularity.com/agentverify/report/?id=REPORT_ID
```

For PR comments, run with `--markdown` and post the output with your preferred GitHub Action. For machine-readable pipelines, run with `--json`.

The workflow requires a valid `AGENTVERIFY_API_KEY`. The local Worker code path fails closed for missing, malformed, invalid, disabled, or revoked keys before findings are returned; validate the deployed API path before relying on this as production enforcement. Wire the workflow into branch protection so the non-zero `--ci` exit code blocks merges when an agent is `NOT_VERIFIED`, not assessed, or the API key is unauthorized.

Saved CLI reports sync to the dashboard through the API `cliReports` save path. If the API cannot save the report, the CLI still prints local scan output and tells you dashboard sync did not complete.

Verified reports can expose a README badge from the report page. A packaged Agent Verify GitHub Action (`AI-Blockchain-Ventures/agentverify@v1`) already exists and produces text/Markdown/JSON output plus an optional workflow artifact — see below. Automatically posting that output as a PR comment (rather than just producing it for you to post) is still a planned enhancement, not yet built.

See the full GitHub Action guide at `docs/github-action.md` for composite action inputs, JSON/Markdown examples, branch protection, optional PR comments, and badge guidance.

## Get your API key

Sign up at https://aimodularity.com/agentverify/dashboard and go to Dashboard -> API

## License

MIT — AI Blockchain Ventures LLC
hello@aiblockchainventures.com
