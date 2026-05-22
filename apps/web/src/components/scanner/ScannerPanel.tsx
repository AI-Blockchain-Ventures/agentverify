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
  'Risky Payment Agent': `name: "PaymentRunner"\ntools: ["*"]\napi_key: "sk_live_123456789"\nexecute: transfer funds\nmemory: { persist: true, ttl: null }\nsystemPrompt: "Send payments from user instructions"`,
  'Risky DevOps Agent': `const agent = { name: "DeployBot", permissions: "all", tools: ["*"], actions: ["deploy", "delete", "modify"] }\nexecute(agent)`,
  'Secure A2SPA Agent': `// Agent protected by A2SPA execution trust protocol
const agent = {
  name: "SupportAgent",
  protocol: "A2SPA-v1",
  scope: ["read:tickets", "write:comments"],
  tools: ["ticket_api", "comment_writer"],
  permissions: ["read:tickets", "write:comments"],
  auditLog: true,
  rateLimit: { maxCalls: 100, window: "1h" },
  humanApproval: { required: true, actions: ["close_ticket", "escalate"] },
  failClosed: true,
  memory: { ttl: 3600, persist: false }
}`,
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
      onNewScan={() => setResult(null)}
      reportUrl={`${typeof window !== 'undefined' ? window.location.origin : ''}/agentverify/report?id=${encodeURIComponent(result.reportId)}`}
    />
  )

  return (
    <div className="mx-auto max-w-2xl rounded-xl border border-[#1E2D40] bg-[#0F1623] p-6">
      {/* Tabs */}
      <div className="mb-6 flex gap-6 border-b border-[#1E2D40] pb-3">
        <button
          onClick={() => setTab('upload')}
          className={`text-sm font-medium transition-colors ${tab === 'upload' ? 'border-b-2 border-[#06B6D4] text-white pb-3 -mb-3' : 'text-[#4B6080] hover:text-[#94A3B8]'}`}
        >
          Upload File
        </button>
        <button
          onClick={() => setTab('paste')}
          className={`text-sm font-medium transition-colors ${tab === 'paste' ? 'border-b-2 border-[#06B6D4] text-white pb-3 -mb-3' : 'text-[#4B6080] hover:text-[#94A3B8]'}`}
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
          className={`cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition-all ${drag ? 'border-[#06B6D4] bg-[#06B6D4]/5' : 'border-[#1E2D40] hover:border-[#243244] hover:bg-[#0D1117]/50'}`}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".js,.ts,.py,.json,.yaml,.yml,.md"
            onChange={e => { const file = e.target.files?.[0]; if (file) void readFile(file) }}
          />
          <div className="mb-4 text-3xl text-[#4B6080]">📁</div>
          <div className="font-medium text-white">Drop your agent config here</div>
          <div className="mt-1 text-sm text-[#4B6080]">or click to browse</div>
          <div className="mt-3 text-xs text-[#4B6080]">.js .ts .py .json .yaml .yml .md</div>
        </div>
      ) : (
        <div>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            className="h-48 w-full resize-none rounded-xl border border-[#1E2D40] bg-[#080B14] p-4 font-mono text-sm text-[#94A3B8] outline-none transition-colors focus:border-[#06B6D4]/50 placeholder:text-[#4B6080]"
            placeholder="// Paste your agent configuration here..."
          />
          <input
            value={fileName}
            onChange={e => setFileName(e.target.value)}
            className="mt-3 w-full rounded-lg border border-[#1E2D40] bg-[#080B14] px-4 py-2.5 text-sm text-white outline-none transition-colors focus:border-[#06B6D4]/50 placeholder:text-[#4B6080]"
            placeholder="File name (optional — e.g. agent.json)"
          />
        </div>
      )}

      {/* Platform selector */}
      <div className="mt-6">
        <label className="mb-3 block text-xs font-medium uppercase tracking-wider text-[#4B6080]">
          Cloud Platform
        </label>
        <div className="flex flex-wrap gap-2">
          {platforms.map(item => (
            <button
              key={item.name}
              onClick={() => setSelectedPlatform(item.name)}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${
                selectedPlatform === item.name
                  ? 'border-[#06B6D4]/50 bg-[#06B6D4]/10 text-white'
                  : 'border-[#1E2D40] text-[#4B6080] hover:border-[#243244] hover:text-[#94A3B8]'
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
      <div className="mt-4 text-center text-xs text-[#4B6080]">
        Try an example:{' '}
        {Object.entries(examples).map(([label, value], index) => (
          <span key={label}>
            <button
              className="text-[#94A3B8] transition-colors hover:text-white"
              onClick={() => { setTab('paste'); setContent(value); setFileName(`${label.toLowerCase().replaceAll(' ', '-')}.txt`) }}
            >
              {label}
            </button>
            {index < 2 ? ' · ' : ''}
          </span>
        ))}
      </div>

      {/* Run button */}
      <button
        onClick={run}
        disabled={!content.trim() || loading}
        className="mt-6 w-full rounded-lg bg-[#06B6D4] py-3 font-semibold text-[#080B14] transition-colors hover:bg-[#22D3EE] disabled:opacity-30 shadow-[0_0_20px_rgba(6,182,212,0.2)]"
      >
        {loading ? 'Analyzing...' : 'Run Analysis →'}
      </button>
    </div>
  )
}
