// Synthetic agent source fixtures for the local review environment (npm run review). Every
// finding/score/verdict shown in the review data comes from running these through the REAL
// scanner — nothing here is a hand-typed fake result. Each persona has 2-3 versions showing a
// real, deterministic progression (the scanner decides the verdict; these inputs are constructed
// to make specific real checks pass or fail, not to force an outcome).

export const FINANCE_OPS_SCANS = [
  // Scan 1: worst. Hardcoded Stripe key, wildcard tools, MCP payments exposure, no controls.
  `
const agent = {
  name: 'FinanceOpsAgent',
  tools: ['*'],
  permissions: 'all',
  accountingApiKey: "sk_live_FINOPS1234567890ABCDEF",
}
const mcpServers = { "payments": { command: "npx", args: ["-y", "mcp-server-stripe"] } }

async function lookupInvoice(invoiceId) {
  return db.query('SELECT * FROM invoices WHERE id = ' + invoiceId)
}
async function notifyFinance(message) {
  return sendMail({ to: 'finance@example.com', subject: 'Payment processed', body: message })
}
export async function run(request) {
  const invoice = await lookupInvoice(request.invoiceId)
  const result = await stripe.transfers.create({ amount: invoice.amount, destination: request.destinationAccount })
  await notifyFinance(\`Transferred \${invoice.amount} to \${request.destinationAccount}\`)
  return result
}
`.trim(),
  // Scan 2: improved. Secret moved to env var, tools scoped, audit + rate limiting added — but
  // still no execution-authorization protocol and no human approval gate on the payment action.
  `
const agent = {
  name: 'FinanceOpsAgent',
  tools: ['read_invoice', 'lookup_account', 'send_confirmation_email', 'transfer_payment'],
  permissions: ['invoices:read', 'accounts:read', 'email:send', 'payments:transfer'],
}
const accountingApiKey = process.env.ACCOUNTING_API_KEY

async function lookupInvoice(invoiceId) {
  return db.query('SELECT * FROM invoices WHERE id = ?', [invoiceId])
}
async function transferPayment(request) {
  if (await rateLimit.exceeded(request.callerId)) throw new Error('blocked: rate limit exceeded')
  logger.info({ action: 'transfer_payment', requestId: request.id, timestamp: Date.now() })
  const invoice = await lookupInvoice(request.invoiceId)
  return tools.transfer_payment.execute({ amount: invoice.amount, destination: request.destinationAccount })
}
`.trim(),
  // Scan 3: best. Full execution-authorization protocol (signature, nonce, fail-closed,
  // timestamp), human approval gate, audit logging, rate limiting, explicit scoped permissions,
  // no secrets in source.
  `
const agent = {
  name: 'FinanceOpsAgent',
  tools: ['read_invoice', 'lookup_account', 'send_confirmation_email', 'transfer_payment'],
  permissions: ['invoices:read', 'accounts:read', 'email:send', 'payments:transfer'],
}
const signingKey = process.env.A2SPA_PRIVATE_KEY
const verifyKey = process.env.A2SPA_PUBLIC_KEY
const usedNonces = new Set()

function verifyExecutionRequest(payload, signature, nonce, timestamp) {
  if (usedNonces.has(nonce)) throw new Error('unauthorized: nonce already used, request blocked')
  if (Date.now() - timestamp > 300000) throw new Error('unauthorized: request expired')
  const valid = crypto.verify('sha256', Buffer.from(JSON.stringify(payload)), verifyKey, signature)
  if (!valid) throw new Error('unauthorized: signature verification failed')
  usedNonces.add(nonce)
  return true
}

async function transferPayment(request) {
  verifyExecutionRequest(request.payload, request.signature, request.nonce, request.timestamp)
  const approved = await requestHumanApproval({ action: 'transfer_payment', amount: request.payload.amount })
  if (!approved) throw new Error('blocked: human approval required')
  if (await rateLimit.exceeded(request.callerId)) throw new Error('blocked: rate limit exceeded')
  logger.info({ action: 'transfer_payment', requestId: request.id, callerId: request.callerId, timestamp: Date.now() })
  return tools.transfer_payment.execute({ amount: request.payload.amount, destination: request.payload.destination })
}
`.trim(),
]

export const DEVELOPER_AGENT_SCANS = [
  // Scan 1: worst. Wildcard tools, hardcoded GitHub token, request-tainted shell exec, repo
  // write + deploy capability chain.
  `
const agent = {
  name: 'DevOpsAgent',
  tools: ['*'],
}
const githubToken = "ghp_DEVOPS1234567890ABCDEFGHIJ"

async function applyPatch(diff) {
  return git.commit(diff)
}
async function updateRepo(request) {
  return octokit.createOrUpdate({ path: request.path, content: request.content })
}
async function deploy(request) {
  return exec('kubectl apply -f ' + request.environment + '.yaml')
}
export async function run(request) {
  await applyPatch(request.diff)
  await updateRepo(request)
  return deploy(request)
}
`.trim(),
  // Scan 2: improved. Token moved to env var, tools scoped to an explicit allowlist, audit
  // logging added — but shell deploy path and the repo-write+deploy capability chain remain,
  // still no human approval gate on deployment.
  `
const agent = {
  name: 'DevOpsAgent',
  tools: ['read_repo', 'commit_patch', 'deploy_service'],
  permissions: ['repo:write', 'deploy:production'],
}
const githubToken = process.env.GITHUB_TOKEN

async function applyPatch(diff) {
  logger.info({ action: 'apply_patch', size: diff.length, timestamp: Date.now() })
  return git.commit(diff)
}
async function deploy(request) {
  logger.info({ action: 'deploy', environment: request.environment, timestamp: Date.now() })
  return exec('kubectl apply -f ' + request.environment + '.yaml')
}
export async function run(request) {
  await applyPatch(request.diff)
  return deploy(request)
}
`.trim(),
]

export const SUPPORT_AGENT_SCANS = [
  // Scan 1: worst. Broad customer-data + refund capability, no approval threshold, plaintext
  // internal API call, no audit trail.
  `
const agent = {
  name: 'SupportAgent',
  tools: ['*'],
}
async function lookupCustomer(email) {
  return db.query('SELECT * FROM customers WHERE email = ' + email)
}
async function issueRefund(request) {
  const customer = await lookupCustomer(request.customerEmail)
  const result = await stripe.refunds.create({ charge: request.chargeId, amount: request.amount })
  await http.post('http://internal-notify.example.com/refund', { customer: customer.email, amount: request.amount })
  return result
}
`.trim(),
  // Scan 2: improved. Tools scoped, HTTPS internal call, refund amount cap approval added, audit
  // logging present — customer PII lookup and refund authority remain (still worth flagging,
  // real remaining risk).
  `
const agent = {
  name: 'SupportAgent',
  tools: ['read_customer_record', 'issue_refund', 'send_customer_email'],
  permissions: ['customers:read', 'payments:refund', 'email:send'],
}
async function lookupCustomer(email) {
  return db.query('SELECT * FROM customers WHERE email = ?', [email])
}
async function issueRefund(request) {
  if (request.amount > 50) {
    const approved = await requestHumanApproval({ action: 'issue_refund', amount: request.amount })
    if (!approved) throw new Error('blocked: human approval required for refunds over $50')
  }
  logger.info({ action: 'issue_refund', requestId: request.id, amount: request.amount, timestamp: Date.now() })
  const customer = await lookupCustomer(request.customerEmail)
  const result = await stripe.refunds.create({ charge: request.chargeId, amount: request.amount })
  await https.post('https://internal-notify.example.com/refund', { customer: customer.email, amount: request.amount })
  return result
}
`.trim(),
]

export const PERSONAS = [
  { key: 'finance-ops', agentName: 'Finance Operations Agent', fileName: 'finance-ops-agent.js', platform: 'Custom', scans: FINANCE_OPS_SCANS },
  { key: 'dev-agent', agentName: 'Developer Agent', fileName: 'devops-agent.js', platform: 'Custom', scans: DEVELOPER_AGENT_SCANS },
  { key: 'support-agent', agentName: 'Customer Support Agent', fileName: 'support-agent.js', platform: 'Custom', scans: SUPPORT_AGENT_SCANS },
]
