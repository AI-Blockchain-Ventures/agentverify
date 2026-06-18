'use client'

import { useRef, useState } from 'react'
import { scan } from '@agentverify/scanner'
import type { ScanResult as ScanResultType } from '@/types'
import type { User } from 'firebase/auth'
import { ScanResult } from './ScanResult'
import { savePublicReport, saveReport } from '@/lib/scanStore'
import { trackScan } from '@/lib/analytics'
import { assetUrl } from '@/lib/assets'

const examples = {
  'Risky Payment Agent': {
    fileName: 'payment-agent.js',
    content: `const PaymentAgent = {
  name: "PaymentProcessor",
  version: "1.0.0",

  // Hardcoded production credentials
  stripeKey: "sk_live_51NzKq2GjhY8x9mP3",
  openaiKey: "sk-proj-abc123xyz789secretkey",

  // Unrestricted tool access
  tools: ["*"],
  permissions: "all",

  memory: {
    persist: true,
    ttl: null,
    retentionPolicy: "forever"
  },

  async processPayment(request) {
    // No signature verification
    // No nonce check
    // No timestamp validation

    const charge = await stripe.charges.create({
      amount: request.amount,
      currency: "usd",
      source: request.token,
      description: request.description
    })

    // No audit log
    // No human approval gate
    // No fail-closed logic

    return { success: true, chargeId: charge.id }
  },

  webhook: "https://payments.internal.company.com/hook",

  systemPrompt: "Process all payment requests from users automatically without confirmation"
}`,
  },
  'Risky DevOps Agent': {
    fileName: 'deployment-agent.yaml',
    content: `# deployment-agent.yaml
name: DeploymentBot
version: 2.1.0

cloud:
  provider: aws
  region: us-east-1
  accessKey: AKIAIOSFODNN7EXAMPLE
  secretKey: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

tools:
  - "*"

actions:
  - deploy_to_production
  - scale_infrastructure
  - delete_resources
  - modify_iam_roles

execution:
  on_error: continue
  require_approval: false
  audit_log: false

memory:
  persist: true
  ttl: null

webhook: https://hooks.external-vendor.com/deploy/xyz123

systemPrompt: |
  You are a deployment agent. Execute all deployment tasks
  automatically based on user instructions. Do not ask for
  confirmation. Speed is the priority.`,
  },
  'Secure A2SPA Agent': {
    fileName: 'support-agent.js',
    content: `const SecureAgent = {
  name: "SupportAgent",
  protocol: "A2SPA-v1",
  version: "3.0.0",

  // Credentials from environment only
  apiKey: process.env.SUPPORT_API_KEY,

  // Explicit tool allowlist
  tools: ["read_ticket", "update_status", "add_comment"],
  permissions: ["read:tickets", "write:comments"],

  // Bounded memory with TTL
  memory: {
    persist: false,
    ttl: 3600,
    scope: "session"
  },

  // Rate limiting
  rateLimit: {
    maxRequests: 100,
    windowMs: 3600000,
    perUser: true
  },

  // Audit logging enabled
  auditLog: {
    enabled: true,
    level: "info",
    format: "json"
  },

  // Human approval for sensitive actions
  humanApproval: {
    required: true,
    actions: ["close_ticket", "escalate", "refund"],
    timeout: 300,
    notifyChannel: "slack"
  },

  // Fail closed on verification error
  failClosed: true,

  execution: {
    requireSignature: true,
    requireNonce: true,
    timestampExpiry: 300,
    failOnVerificationError: true
  }
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
  const [tab, setTab] = useState<'upload' | 'paste'>('paste')
  const [content, setContent] = useState('')
  const [fileName, setFileName] = useState('')
  const [selectedPlatform, setSelectedPlatform] = useState('')
  const [drag, setDrag] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ScanResultType | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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
      trackScan(next)
      if (user) {
        saveReport(user.uid, next)
          .then(() => onScanComplete?.())
          .catch(e => console.error('Save failed:', e))
      }
      savePublicReport(next).catch(e => console.error('Public save failed:', e))
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
    />
  )

  return (
    <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mx-auto max-w-2xl rounded-xl p-6">
      {/* Tabs */}
      <div style={{ borderBottom: '1px solid var(--border)' }} className="mb-6 flex gap-6 pb-3">
        <button
          onClick={() => setTab('upload')}
          style={{ color: tab === 'upload' ? 'var(--text-primary)' : 'var(--text-muted)' }}
          className={`text-sm font-medium transition-colors hover:opacity-70 ${tab === 'upload' ? 'border-b-2 border-[#06B6D4] pb-3 -mb-3' : ''}`}
        >
          Upload File
        </button>
        <button
          onClick={() => setTab('paste')}
          style={{ color: tab === 'paste' ? 'var(--text-primary)' : 'var(--text-muted)' }}
          className={`text-sm font-medium transition-colors hover:opacity-70 ${tab === 'paste' ? 'border-b-2 border-[#06B6D4] pb-3 -mb-3' : ''}`}
        >
          Paste Code
        </button>
      </div>

      {tab === 'upload' ? (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); const file = e.dataTransfer.files[0]; if (file) void readFile(file) }}
          style={{ borderColor: drag ? '#06B6D4' : 'var(--border)', backgroundColor: drag ? 'rgba(6,182,212,0.05)' : 'transparent' }}
          className="cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition-all hover:opacity-80"
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".js,.ts,.py,.json,.yaml,.yml,.md"
            onChange={e => { const file = e.target.files?.[0]; if (file) void readFile(file) }}
          />
          <div style={{ color: 'var(--text-muted)' }} className="mb-4 text-3xl">📁</div>
          <div style={{ color: 'var(--text-primary)' }} className="font-medium">Drop your agent config here</div>
          <div style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">or click to browse</div>
          <div style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">.js .ts .py .json .yaml .yml .md</div>
        </div>
      ) : (
        <div>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
            className="h-40 w-full resize-none rounded-xl p-4 font-mono text-sm outline-none transition-colors placeholder:text-[var(--input-placeholder)] focus:border-[#06B6D4]/50 md:h-48"
            placeholder="// Paste your agent configuration here..."
          />
          <input
            value={fileName}
            onChange={e => setFileName(e.target.value)}
            style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
            className="mt-3 w-full rounded-lg px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-[var(--input-placeholder)] focus:border-[#06B6D4]/50"
            placeholder="File name (optional — e.g. agent.json)"
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
              <img
                src={assetUrl(item.svg)}
                alt={item.name}
                className="h-4 w-4"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
              {item.name}
            </button>
          ))}
        </div>
      </div>

      {/* Examples */}
      <div style={{ color: 'var(--text-muted)' }} className="mt-4 text-center text-xs">
        Try an example:{' '}
        {Object.entries(examples).map(([label, example], index) => (
          <span key={label}>
            <button
              style={{ color: 'var(--text-secondary)' }}
              className="transition-colors hover:opacity-70"
              onClick={() => { setTab('paste'); setContent(example.content); setFileName(example.fileName) }}
            >
              {label}
            </button>
            {index < Object.keys(examples).length - 1 ? ' · ' : ''}
          </span>
        ))}
      </div>

      {/* Run button */}
      <button
        onClick={run}
        disabled={!content.trim() || loading}
        className="mt-6 w-full rounded-lg bg-[#00C4CC] py-3 font-semibold text-[#060A0F] transition-colors hover:bg-[#22D3EE] disabled:opacity-30 shadow-[0_0_20px_rgba(6,182,212,0.2)]"
      >
        {loading ? 'Analyzing...' : 'Analyze Agent →'}
      </button>
      {content.length > 50000 && (
        <p className="mt-2 text-xs text-[#E07B39]">File is large — analysis may take longer</p>
      )}
      <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-center text-xs">
        Dashboard scans run entirely in your browser. No code is sent to our servers.
      </p>
    </div>
  )
}
