'use client'

import { useEffect, useRef, useState, type SyntheticEvent } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { scan } from '@agentverify/scanner'
import type { ScanResult as ScanResultType } from '@/types'
import type { User } from 'firebase/auth'
import { ScanResult } from './ScanResult'
import { saveReport } from '@/lib/scanStore'
import { trackScan } from '@/lib/analytics'
import { assetUrl } from '@/lib/assets'
import { freeScanLimit } from '@/lib/pricing'
import { useBillingStatus } from '@/lib/useBillingStatus'

type ScannerExample = {
  fileName: string
  description: string
  demonstrates: string
  expected: string
  whyItMatters: string
  content: string
}

const examples: Record<string, ScannerExample> = {
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

const platforms = [
  { name: 'AWS', svg: '/platforms/aws.svg' },
  { name: 'Azure', svg: '/platforms/azure.svg' },
  { name: 'Google Cloud', svg: '/platforms/google-cloud.svg' },
  { name: 'IBM Cloud', svg: '/platforms/ibm-cloud.svg' },
  { name: 'Oracle', svg: '/platforms/Oracle.svg' },
]

interface ScannerPanelProps {
  user: User | null
  onScanComplete?: () => void
}

export function ScannerPanel({ user, onScanComplete }: ScannerPanelProps) {
  const billingStatus = useBillingStatus(user)
  const [tab, setTab] = useState<'upload' | 'paste'>('paste')
  const [content, setContent] = useState('')
  const [fileName, setFileName] = useState('')
  const [selectedPlatform, setSelectedPlatform] = useState('')
  const [drag, setDrag] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ScanResultType | null>(null)
  const [localMonthlyScans, setLocalMonthlyScans] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const key = `agentverify-free-scans-${new Date().toISOString().slice(0, 7)}`
    setLocalMonthlyScans(Number(window.localStorage.getItem(key) ?? '0') || 0)
  }, [])

  const readFile = async (file: File) => {
    setFileName(file.name)
    setContent(await file.text())
    setTab('paste')
  }

  const run = () => {
    if (!content.trim()) return
    setLoading(true)
    try {
      const next = scan({
        content,
        fileName: fileName || 'agent.txt',
        fileSize: content.length,
        platform: selectedPlatform || undefined,
      })
      setResult(next)
      const month = new Date().toISOString().slice(0, 7)
      const key = `agentverify-free-scans-${month}`
      const nextCount = localMonthlyScans + 1
      setLocalMonthlyScans(nextCount)
      window.localStorage.setItem(key, String(nextCount))
      trackScan(next)
      if (user) {
        saveReport(user.uid, next)
          .then(() => {
            onScanComplete?.()
          })
          .catch(e => {
            console.error('Save failed:', e)
          })
      }
    } catch (e) {
      console.error('Scan failed:', e)
    } finally {
      setLoading(false)
    }
  }

  if (result) return (
    <ScanResult
      result={result}
      originalContent={content}
      onNewScan={() => setResult(null)}
      reportUrl={`https://aimodularity.com/agentverify/report/?id=${encodeURIComponent(result.reportId)}`}
      billingStatus={billingStatus}
    />
  )

  return (
    <div className="mx-auto max-w-4xl rounded-[2rem] border border-[var(--border)] bg-[radial-gradient(circle_at_top_right,rgba(0,196,204,0.10),transparent_32%),var(--card)] p-5 shadow-2xl shadow-black/10 backdrop-blur md:p-7">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#00C4CC]">Private browser scan</p>
        <h2 style={{ color: 'var(--text-primary)' }} className="mt-2 text-2xl font-semibold tracking-tight">Scan agent</h2>
        <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">Upload or paste an agent file to generate a security report with findings and next steps.</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-[11px] font-semibold text-[#00C4CC]">
          <span className="rounded-full bg-[#00C4CC]/10 px-3 py-1.5">Risk</span>
          <span className="rounded-full bg-[#00C4CC]/10 px-3 py-1.5">A2SPA</span>
          <span className="rounded-full bg-[#00C4CC]/10 px-3 py-1.5">Fixes</span>
        </div>
      </div>
      {/* Tabs */}
      <div style={{ borderBottom: '1px solid var(--border)' }} className="mb-6 flex gap-6 pb-3">
        <button
          onClick={() => setTab('upload')}
          style={{ color: tab === 'upload' ? 'var(--text-primary)' : 'var(--text-muted)' }}
          className={`text-sm font-medium transition-colors hover:opacity-70 ${tab === 'upload' ? 'border-b-2 border-[#06B6D4] pb-3 -mb-3' : ''}`}
        >
          Upload file
        </button>
        <button
          onClick={() => setTab('paste')}
          style={{ color: tab === 'paste' ? 'var(--text-primary)' : 'var(--text-muted)' }}
          className={`text-sm font-medium transition-colors hover:opacity-70 ${tab === 'paste' ? 'border-b-2 border-[#06B6D4] pb-3 -mb-3' : ''}`}
        >
          Paste code
        </button>
      </div>

      {tab === 'upload' ? (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); const file = e.dataTransfer.files[0]; if (file) void readFile(file) }}
          style={{ borderColor: drag ? '#06B6D4' : 'var(--border)', backgroundColor: drag ? 'rgba(6,182,212,0.05)' : 'transparent' }}
          className="cursor-pointer rounded-3xl border-2 border-dashed p-12 text-center transition-all hover:opacity-80"
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".js,.ts,.py,.json,.yaml,.yml,.md"
            onChange={e => { const file = e.target.files?.[0]; if (file) void readFile(file) }}
          />
          <div style={{ color: 'var(--text-muted)' }} className="mb-4 text-3xl">+</div>
          <div style={{ color: 'var(--text-primary)' }} className="font-medium">Drop your agent file here</div>
          <div style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">or choose a file</div>
          <div style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">.js .ts .py .json .yaml .yml .md</div>
        </div>
      ) : (
        <div>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
            className="h-48 w-full resize-none rounded-3xl p-4 font-mono text-sm outline-none transition-colors placeholder:text-[var(--input-placeholder)] focus:border-[#06B6D4]/50 md:h-60"
            placeholder="// Paste agent code or configuration here..."
          />
          <input
            value={fileName}
            onChange={e => setFileName(e.target.value)}
            style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
            className="mt-3 w-full rounded-2xl px-4 py-3 text-sm outline-none transition-colors placeholder:text-[var(--input-placeholder)] focus:border-[#06B6D4]/50"
            placeholder="File name (optional, for example agent.json)"
          />
        </div>
      )}

      {/* Platform selector */}
      <div className="mt-6">
        <label style={{ color: 'var(--text-muted)' }} className="mb-3 block text-xs font-medium uppercase tracking-wider">
          Cloud Platform
        </label>
        <div className="flex flex-wrap gap-2">
          {platforms.map(item => (
            <button
              key={item.name}
              onClick={() => setSelectedPlatform(item.name)}
              className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-colors md:px-3 md:py-2 ${
                selectedPlatform === item.name
                  ? 'border-[#00C4CC]/50 bg-[#00C4CC]/10 text-[#00C4CC]'
                  : 'border-[var(--border)] text-[var(--text-muted)] hover:opacity-70'
              }`}
            >
              <Image
                src={assetUrl(item.svg)}
                alt={item.name}
                width={16}
                height={16}
                className="h-4 w-4"
                onError={(e: SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = 'none' }}
              />
              {item.name}
            </button>
          ))}
        </div>
      </div>

      {/* Examples */}
      <div className="mt-5 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Try an example</p>
        <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">Load safe demo agents that show risky and fixed patterns.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {Object.entries(examples).map(([label, example]) => (
            <button
              key={label}
              style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              className="rounded-2xl bg-[var(--card)] px-3 py-3 text-left text-xs transition-colors hover:opacity-80"
              onClick={() => { setTab('paste'); setContent(example.content); setFileName(example.fileName) }}
            >
              <span style={{ color: 'var(--text-primary)' }} className="block font-semibold">{label}</span>
              <span className="mt-0.5 block leading-relaxed">{example.description}</span>
              <span className="mt-2 block rounded-lg bg-[var(--card)] px-2 py-1 font-mono text-[10px] text-[#00C4CC]">{example.expected}</span>
              <span style={{ color: 'var(--text-muted)' }} className="mt-1 block leading-relaxed">Checks: {example.demonstrates}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Run button */}
      {billingStatus.plan !== 'pro' && localMonthlyScans >= freeScanLimit && (
        <div className="mt-6 rounded-xl border border-[#E07B39]/30 bg-[#E07B39]/10 p-4">
          <p className="text-sm font-semibold text-[#E07B39]">You have used {freeScanLimit}+ local scans this month</p>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-xs">Free includes {freeScanLimit} scans/month once server-side billing enforcement is enabled. Pro includes 100 scans/month plus full remediation, PDF export, and shareable reports.</p>
          <Link href="/pricing" className="mt-3 inline-flex rounded-lg bg-[#00C4CC] px-3 py-2 text-xs font-semibold text-[#060A0F]">View Pro</Link>
        </div>
      )}
      <button
        onClick={run}
        disabled={!content.trim() || loading}
        className="mt-6 w-full rounded-2xl bg-[#00C4CC] py-4 font-semibold text-[#060A0F] shadow-[0_18px_50px_rgba(0,196,204,0.22)] transition-colors hover:bg-[#22D3EE] disabled:opacity-30"
      >
        {loading ? 'Scanning...' : 'Scan agent'}
      </button>
      {content.length > 50000 && (
        <p className="mt-2 text-xs text-[#E07B39]">Large file detected. The scan may take a little longer.</p>
      )}
      <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-center text-xs">
        Dashboard scans run in your browser. Never paste a production private key into Agent Verify, source code, or a public repository. Store it in an environment variable or a secret manager.
      </p>
    </div>
  )
}
