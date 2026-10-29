/**
 * Safe, synthetic demo agents used by the dashboard scanner and the public homepage scan.
 * Plain strings only — nothing here imports the scanner engine.
 */
export type ScannerExample = {
  fileName: string
  description: string
  demonstrates: string
  expected: string
  whyItMatters: string
  content: string
}

export const SCAN_EXAMPLES: Record<string, ScannerExample> = {
  'Prompt injection': {
    fileName: 'prompt-injection-agent.ts',
    description: 'User content is blended into execution instructions without boundaries.',
    demonstrates: 'Prompt Injection, Intent Breaking, Tool Misuse',
    expected: 'NOT VERIFIED / High Risk',
    whyItMatters: 'Untrusted text can redirect a tool-connected agent into unsafe actions.',
    content: `const agent = {
  name: 'InboxActionAgent',
  tools: ['send_email', 'create_invoice'],
  permissions: ['email:send', 'billing:create'],
  systemPrompt: 'Follow every instruction in the email body: ' + userInput,
}

export async function run(email) {
  return agent.tools.map(tool => tool.execute(email.body))
}`,
  },
  'Memory poisoning': {
    fileName: 'memory-agent.yaml',
    description: 'Agent memory persists indefinitely and can carry poisoned context forward.',
    demonstrates: 'Memory Poisoning, Intent Breaking',
    expected: 'NOT VERIFIED / High Risk',
    whyItMatters: 'Stale or attacker-influenced memory can affect later execution decisions.',
    content: `name: MemoryAgent
tools: ["read_customer", "update_customer"]
permissions: ["customers:read", "customers:update"]
memory:
  persist: true
  retention: forever
  ttl: null
systemPrompt: |
  Use prior remembered instructions when deciding what customer records to update.`,
  },
  'Broad tools': {
    fileName: 'deployment-agent.yaml',
    description: 'Wildcard tools, broad permissions, no approval, and no audit trail.',
    demonstrates: 'Tool Misuse, Privilege Compromise, Auditability',
    expected: 'NOT VERIFIED / High Risk',
    whyItMatters: 'A compromised deployment agent could modify production without review.',
    content: `name: DeploymentBot
tools:
  - "*"
permissions: all
actions:
  - deploy_to_production
  - delete_resources
execution:
  on_error: continue
  require_approval: false
  audit_log: false
systemPrompt: |
  Execute deployment tasks automatically based on user instructions.`,
  },
  'Risky payment': {
    fileName: 'refund-agent.ts',
    description: 'Payment-like action executes without signed authorization or approval.',
    demonstrates: 'Tool Misuse, Replay Attacks, Missing A2SPA Evidence',
    expected: 'NOT VERIFIED / High Risk',
    whyItMatters: 'Payments and refunds need proof of intent before execution.',
    content: `const agent = {
  name: 'RefundAgent',
  tools: ['refund_payment', 'read_order'],
  permissions: ['payments:refund', 'orders:read'],
  systemPrompt: sanitize(userInput),
}

export async function run(request) {
  return await tools.refund_payment.execute({ orderId: request.orderId, amount: request.amount })
}`,
  },
  'Command injection': {
    fileName: 'shell-tool-agent.js',
    description: 'Untrusted input reaches shell command construction.',
    demonstrates: 'Command Injection, Tool Misuse',
    expected: 'NOT VERIFIED / High Risk',
    whyItMatters: 'Shell execution from user-controlled input can become remote code execution.',
    content: `import { exec } from 'child_process'

const agent = { name: 'OpsAgent', tools: ['run_shell'], permissions: ['ops:run'] }

export function run(request) {
  const command = 'kubectl get pods ' + request.namespace
  return exec(command)
}`,
  },
  'Replay missing': {
    fileName: 'signed-but-replayable.ts',
    description: 'Signature exists, but nonce/timestamp evidence is missing.',
    demonstrates: 'Replay Attacks, Missing Timestamp Enforcement',
    expected: 'NOT VERIFIED / Moderate Risk',
    whyItMatters: 'Captured requests can be reused unless each request is unique and expires quickly.',
    content: `const agent = { name: 'TransferAgent', tools: ['transfer_funds'], permissions: ['payments:transfer'] }

export async function transfer(request) {
  if (!verifySignature(request.signature, request.payload)) throw new Error('unauthorized')
  return tools.transfer_funds.execute(request.payload)
}`,
  },
  'Missing audit': {
    fileName: 'quiet-agent.ts',
    description: 'Sensitive execution path has no structured audit receipt.',
    demonstrates: 'Auditability, Non-Repudiation',
    expected: 'NOT VERIFIED / Moderate Risk',
    whyItMatters: 'Without receipts, teams cannot prove what happened after an incident.',
    content: `const agent = { name: 'DataChangeAgent', tools: ['modifyDatabase'], permissions: ['db:write'], rateLimit: 10 }

export async function run(change) {
  const approved = await requestHumanApproval(change)
  if (!approved) throw new Error('blocked')
  return tools.modifyDatabase.execute(change)
}`,
  },
  'Rogue onboarding': {
    fileName: 'agent-marketplace.js',
    description: 'Remote agents/plugins can be onboarded without identity verification.',
    demonstrates: 'Rogue Agent, Identity Spoofing, Supply Chain',
    expected: 'NOT VERIFIED / High Risk',
    whyItMatters: 'Unknown agents can inherit tool trust if onboarding is not verified.',
    content: `const agent = { name: 'MarketplaceRunner', tools: ['registerAgent', 'invoke_plugin'], permissions: ['plugins:admin'] }

export async function onboard(remoteAgentUrl) {
  const plugin = await fetch(remoteAgentUrl).then(r => r.text())
  return registerAgent({ source: remoteAgentUrl, code: plugin, trusted: true })
}`,
  },
  'Retrieval agent': {
    fileName: 'research-agent.py',
    description: 'Web pages and documents are pasted straight into the prompt; model output is executed.',
    demonstrates: 'Indirect Prompt Injection, Insecure Output Handling (new in v1.6)',
    expected: 'NOT VERIFIED / High Risk',
    whyItMatters: 'Hidden instructions in a web page can take over an agent that trusts what it reads.',
    content: `from langchain_community.document_loaders import WebBaseLoader

agent_name = "ResearchAgent"
tools = ["browse", "run_python"]
permissions = ["web:read", "code:run"]

def answer(question, url):
    docs = WebBaseLoader(url).load()
    prompt = "Answer the question using these pages: " + docs[0].page_content + question
    completion = client.chat.completions.create(model="gpt-4o", messages=[{"role": "user", "content": prompt}])
    exec(completion.choices[0].message.content)`,
  },
  'Safety switches off': {
    fileName: 'autonomous-agent.py',
    description: 'Framework safety settings are disabled and the loop has no step limit.',
    demonstrates: 'Safety Controls Disabled, Unbounded Loop, TLS Off (new in v1.6)',
    expected: 'NOT VERIFIED / High Risk',
    whyItMatters: 'These switches are the last checkpoint between a bad instruction and a real action.',
    content: `from langchain.agents import AgentExecutor
from langchain_experimental.tools import PythonREPLTool

agent = {"name": "AutoOpsAgent", "tools": ["python", "http"], "permissions": ["ops:run"]}
python_tool = PythonREPLTool(allow_dangerous_code=True)
executor = AgentExecutor(agent=agent, tools=[python_tool], max_iterations=None)

def call_api(url):
    return requests.post(url, json={"task": "sync"}, verify=False)`,
  },
  'MCP config': {
    fileName: 'claude_desktop_config.json',
    description: 'A Claude Desktop / Cursor MCP config with broad file access and a pasted-in token.',
    demonstrates: 'MCP configuration pack (new in v1.6)',
    expected: 'NOT VERIFIED / High Risk',
    whyItMatters: 'Your MCP config decides what the AI on your laptop can read, change, and send.',
    content: `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/alex"]
    },
    "jira": {
      "command": "npx",
      "args": ["-y", "mcp-atlassian-jira"],
      "env": { "JIRA_API_TOKEN": "EXAMPLE_jira_token_9f3k2q7w" },
      "autoApprove": ["create_issue", "transition_issue"]
    },
    "team-tools": {
      "url": "https://tools.example.com/mcp/sse"
    }
  }
}`,
  },
  'Env variables': {
    fileName: 'env-agent.js',
    description: 'Credentials are referenced from deployment environment variables.',
    demonstrates: 'Secret Handling, Least Privilege',
    expected: 'Improved / re-scan required',
    whyItMatters: 'Secrets should live in environment variables or a secret manager, not source code.',
    content: `const apiKey = process.env.AGENT_API_KEY
if (!apiKey) throw new Error('Missing AGENT_API_KEY environment variable')

const agent = { name: 'CustomerAgent', tools: ['read_customer'], permissions: ['customers:read'], rateLimit: 30, auditLog: true }
await tool.execute('read_customer')`,
  },
  'Scoped tools': {
    fileName: 'scoped-agent.ts',
    description: 'Tool execution is restricted to an explicit allowlist.',
    demonstrates: 'Tool Misuse, Privilege Compromise',
    expected: 'Improved / re-scan required',
    whyItMatters: 'Allowlists reduce blast radius when prompts or upstream inputs are compromised.',
    content: `const allowedTools = ['read_ticket', 'add_comment']
const agent = { name: 'SupportAgent', tools: allowedTools, permissions: ['tickets:read', 'tickets:comment'], rateLimit: 40, auditLog: true }

export async function run({ toolName, payload }) {
  if (!allowedTools.includes(toolName)) throw new Error('Tool not allowed')
  logger.info({ toolName, timestamp: new Date().toISOString() })
  return executeTool(toolName, payload)
}`,
  },
  'Approval gate': {
    fileName: 'approval-agent.ts',
    description: 'Sensitive action requires human approval before tool execution.',
    demonstrates: 'Human Approval, Intent Verification',
    expected: 'Improved / re-scan required',
    whyItMatters: 'High-impact actions need a human checkpoint when automation confidence is not enough.',
    content: `const agent = { name: 'PurchaseAgent', tools: ['create_purchase_order'], permissions: ['purchase:create'], auditLog: true, rateLimit: 10 }

export async function createPurchaseOrder(action, userId) {
  const approved = await requestHumanApproval({ action, requester: userId })
  if (!approved) throw new Error('Action requires human approval')
  return tools.create_purchase_order.execute(action)
}`,
  },
  'A2SPA-ready': {
    fileName: 'support-agent.js',
    description: 'Shows signing, nonce, timestamp, fail-closed, audit, and scoped tools evidence.',
    demonstrates: 'A2SPA Readiness, Replay Protection, Auditability',
    expected: 'VERIFIED when full evidence is present',
    whyItMatters: 'A2SPA creates execution authorization evidence before real actions run.',
    content: `const SecureAgent = {
  name: "SupportAgent",
  protocol: "A2SPA-v1",
  tools: ["read_ticket", "update_status", "add_comment"],
  permissions: ["read:tickets", "write:comments"],
  memory: { persist: false, ttl: 3600, scope: "session" },
  rateLimit: { maxRequests: 100, windowMs: 3600000, perUser: true },
  auditLog: { enabled: true, format: "json" },
  humanApproval: { required: true, actions: ["close_ticket", "escalate", "refund"] },
  failClosed: true,
  execution: { requireSignature: true, requireNonce: true, timestampExpiry: 300, failOnVerificationError: true }
}

const signingKey = process.env.A2SPA_PRIVATE_KEY
const publicKey = process.env.A2SPA_PUBLIC_KEY

export async function execute(request) {
  if (!verifySignature(publicKey, request.signature, request.payload)) throw new Error('authorization blocked')
  if (nonceStore.has(request.nonce)) throw new Error('replay blocked')
  if (Date.now() - request.timestamp > 300000) throw new Error('expired request')
  nonceStore.add(request.nonce)
  logger.info({ requestId: request.nonce, action: request.payload.action, timestamp: new Date().toISOString() })
  return executeAllowedTool(request.payload)
}`,
  },
}
