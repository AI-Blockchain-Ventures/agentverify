# agentverify

**Execution trust analysis for AI agents — CLI and SDK**

Scan AI agent configurations for security issues, credential exposure, and governance gaps. Results save automatically to your Agent Verify dashboard.

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

result.verdict    // 'VERIFIED' | 'NOT VERIFIED'
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
- name: Scan agents
  run: npx agentverify scan ./agents --key ${{ secrets.AGENTVERIFY_API_KEY }} --json
```

## Get your API key

Sign up at https://aimodularity.com/agentverify/dashboard and go to Dashboard -> API

## License

MIT — AI Blockchain Ventures LLC
hello@aiblockchainventures.com
