# Agent Verify for VS Code

**Know what your AI agent can do before you deploy it.** Agent Verify scans AI agent code, tools, prompts and MCP configs for
security risks and underlines them right in your editor.

## What it finds

- Dangerous tool permissions, wildcard access, and missing human approval for risky actions
- Prompt injection paths, including untrusted web or document content reaching tools
- Exposed secrets (OpenAI, Anthropic, AWS, GitHub, Stripe, Google, Hugging Face and more)
- Risky MCP servers: broad filesystem access, unpinned packages, remote servers without auth, auto-approved tools
- SQL injection, SSRF, unsafe code execution, path traversal and unsafe deserialization in agent tools
- Framework issues in LangChain, CrewAI, AutoGen, OpenAI Agents SDK and Claude Agent SDK

124 checks, mapped to the OWASP LLM Top 10, NIST AI RMF and SOC 2.

## How to use it

1. Run **Agent Verify: Set API Key** (get a free key at
   [aimodularity.com/agentverify](https://aimodularity.com/agentverify/dashboard/), 10 scans a month).
2. Open an agent file and click the shield button, or run **Agent Verify: Scan This File**.
3. Risks are underlined and listed in the **Problems** panel. The status bar shows the security score (higher is safer).

Other commands:

- **Agent Verify: Scan Project** — scans the most important agent files in the folder as one report (up to 60 files).
- **Agent Verify: Check My MCP Servers** — checks the MCP servers set up for Claude Code, Claude Desktop, Cursor, VS Code and Windsurf.
  Secret values are masked on your computer before anything is sent.
- Turn on **Agent Verify: Scan On Save** in settings to re-scan as you work.

## Use it from Copilot and other AI chat

This extension adds an **Agent Verify** MCP server to VS Code, so agent mode can scan your agent for you ("scan my agent
for security issues"). It uses the API key you saved here.

Using Claude Code, Cursor or another tool? Add the same server there:

```bash
claude mcp add agentverify -e AGENTVERIFY_API_KEY=av_your_key -- npx -y agentverify mcp
```

## Privacy

The file or files you scan are sent to the Agent Verify scan service over HTTPS to be analyzed. Detected secrets are
redacted in reports. Don't scan production keys; rotate any key that was ever committed. See the
[privacy policy](https://aimodularity.com/agentverify/privacy/).

## Free and Pro

Free shows every finding. **Pro** ($19.99/month) adds step-by-step fixes and corrected code for each finding, 100 scans a
month, and more. [See pricing](https://aimodularity.com/agentverify/pricing/).

Agent Verify is an automated, evidence-based check, not a guarantee.
