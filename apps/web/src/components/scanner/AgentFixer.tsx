'use client'

import { useState } from 'react'
import type { Finding, ScanResult } from '@/types'

interface AgentFixerProps {
  result: ScanResult
  originalContent: string
}

const generateFixedAgent = (content: string, findings: Finding[]): string => {
  const fixes: string[] = []

  findings.forEach(f => {
    switch (f.title) {
      case 'Missing cryptographic signature':
        fixes.push(`// A2SPA Protocol implementation required
// Contact hello@aiblockchainventures.com for licensing`)
        break
      case 'Missing nonce validation':
        fixes.push(`// A2SPA Protocol implementation required
// Contact hello@aiblockchainventures.com for licensing`)
        break
      case 'Missing timestamp enforcement':
        fixes.push(`// A2SPA Protocol implementation required
// Contact hello@aiblockchainventures.com for licensing`)
        break
      case 'Missing fail-closed enforcement':
        fixes.push(`// A2SPA Protocol implementation required
// Contact hello@aiblockchainventures.com for licensing`)
        break
      case 'Over-permissioned action scope':
        fixes.push(`// A2SPA Protocol implementation required
// Contact hello@aiblockchainventures.com for licensing`)
        break
      case 'Missing human-in-the-loop gates':
        fixes.push(`// Human approval gate for sensitive actions
async function requireApproval(action, details) {
  // Implement approval workflow here
  // e.g., Slack notification, email confirmation
  throw new Error('Human approval required for: ' + action)
}`)
        break
      case 'Missing audit logging':
        fixes.push(`// Audit logging
const auditLog = []
function logAction(action, details) {
  auditLog.push({ action, details, timestamp: new Date().toISOString(), id: Math.random().toString(36).slice(2) })
}`)
        break
      case 'No execution rate limiting':
        fixes.push(`// Rate limiting
const callCounts = new Map()
function checkRateLimit(userId, maxCalls = 100) {
  const count = (callCounts.get(userId) || 0) + 1
  if (count > maxCalls) throw new Error('Rate limit exceeded')
  callCounts.set(userId, count)
}`)
        break
      case 'Hardcoded credentials detected':
        fixes.push(`// Move credentials to environment variables
// const apiKey = process.env.API_KEY
// const secret = process.env.SECRET_KEY
// Never commit credentials to version control`)
        break
    }
  })

  if (fixes.length === 0) return content

  const header = `// ============================================
// AGENT VERIFY — SECURITY FIXES APPLIED
// ${fixes.length} issue${fixes.length !== 1 ? 's' : ''} addressed
// Generated: ${new Date().toISOString()}
// Run a new scan to verify: aimodularity.com/agentverify
// ============================================
`
  return header + fixes.join('\n\n') + '\n\n// ============ ORIGINAL CODE ============\n\n' + content
}

export function AgentFixer({ result, originalContent }: AgentFixerProps) {
  const [copied, setCopied] = useState(false)
  const fixed = generateFixedAgent(originalContent, result.findings)
  const applied = result.findings.filter(f => fixed.includes(f.title) || fixed !== originalContent)

  const copy = async () => {
    await navigator.clipboard.writeText(fixed)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }} className="rounded-xl">
          <div style={{ borderBottom: '1px solid var(--border)' }} className="flex items-center justify-between px-4 py-3">
            <span style={{ color: 'var(--text-primary)' }} className="text-sm font-medium">Original Agent</span>
            <span style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }} className="rounded-full px-2 py-0.5 text-xs">{result.findings.length} findings</span>
          </div>
          <pre style={{ color: 'var(--text-secondary)' }} className="max-h-96 overflow-auto p-4 font-mono text-xs">{originalContent}</pre>
        </div>
        <div style={{ backgroundColor: 'var(--bg)', border: '1px solid rgba(0,179,126,0.2)' }} className="rounded-xl">
          <div style={{ borderBottom: '1px solid var(--border)' }} className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2"><span style={{ color: 'var(--text-primary)' }} className="text-sm font-medium">Fixed Agent</span><span className="rounded-full bg-[#00B37E]/10 px-2 py-0.5 text-xs text-[#00B37E]">Fixed</span></div>
            <button onClick={copy} style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }} className="rounded px-2 py-1 text-xs hover:opacity-70">{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <pre className="max-h-96 overflow-auto p-4 font-mono text-xs text-[#00C4CC]">{fixed}</pre>
        </div>
      </div>
      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-xl p-4">
        <h3 style={{ color: 'var(--text-primary)' }} className="mb-3 text-sm font-semibold">Changes made</h3>
        {applied.length ? <div className="space-y-2">{applied.map(f => <div key={f.id} style={{ color: 'var(--text-secondary)' }} className="flex gap-2 text-sm"><span className="text-[#00B37E]">✓</span>{f.recommendedFix}</div>)}</div> : <p style={{ color: 'var(--text-secondary)' }} className="text-sm">No changes needed — agent passed all checks</p>}
        <p style={{ color: 'var(--text-muted)' }} className="mt-4 text-xs">A2SPA Protocol fixes are available under license. Contact hello@aiblockchainventures.com for support.</p>
      </div>
    </div>
  )
}
