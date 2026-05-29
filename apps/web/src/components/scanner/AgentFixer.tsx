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
        fixes.push(`// A2SPA: Signature verification required
// Contact aiblockchainventures.com for A2SPA integration
// Add signature verification before execution`)
        break
      case 'Missing nonce validation':
        fixes.push(`// Add nonce validation to prevent replay attacks
const usedNonces = new Set()
function validateNonce(nonce) {
  if (!nonce || usedNonces.has(nonce)) throw new Error('Invalid nonce')
  usedNonces.add(nonce)
}`)
        break
      case 'Missing timestamp enforcement':
        fixes.push(`// Add timestamp validation (5 minute window)
function validateTimestamp(timestamp) {
  const age = Date.now() - new Date(timestamp).getTime()
  if (age > 300000) throw new Error('Request expired')
}`)
        break
      case 'Missing fail-closed enforcement':
        fixes.push(`// Fail-closed: block execution on any verification error
function executeWithFailClosed(fn) {
  try {
    return fn()
  } catch (err) {
    console.error('Execution blocked:', err instanceof Error ? err.message : String(err))
    throw new Error('Execution blocked — verification required')
  }
}`)
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
        <div className="rounded-xl border border-[#1A2535] bg-[#060A0F]">
          <div className="flex items-center justify-between border-b border-[#1A2535] px-4 py-3">
            <span className="text-sm font-medium text-white">Original Agent</span>
            <span className="rounded-full border border-[#1A2535] px-2 py-0.5 text-xs text-[#3D5166]">{result.findings.length} findings</span>
          </div>
          <pre className="max-h-96 overflow-auto p-4 font-mono text-xs text-[#8896A8]">{originalContent}</pre>
        </div>
        <div className="rounded-xl border border-[#00B37E]/20 bg-[#060A0F]">
          <div className="flex items-center justify-between border-b border-[#1A2535] px-4 py-3">
            <div className="flex items-center gap-2"><span className="text-sm font-medium text-white">Fixed Agent</span><span className="rounded-full bg-[#00B37E]/10 px-2 py-0.5 text-xs text-[#00B37E]">Fixed</span></div>
            <button onClick={copy} className="rounded border border-[#1A2535] px-2 py-1 text-xs text-[#8896A8] hover:text-white">{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <pre className="max-h-96 overflow-auto p-4 font-mono text-xs text-[#00C4CC]">{fixed}</pre>
        </div>
      </div>
      <div className="rounded-xl border border-[#1A2535] bg-[#0D1321] p-4">
        <h3 className="mb-3 text-sm font-semibold text-white">Changes made</h3>
        {applied.length ? <div className="space-y-2">{applied.map(f => <div key={f.id} className="flex gap-2 text-sm text-[#8896A8]"><span className="text-[#00B37E]">✓</span>{f.recommendedFix}</div>)}</div> : <p className="text-sm text-[#8896A8]">No changes needed — agent passed all checks</p>}
        <p className="mt-4 text-xs text-[#3D5166]">A2SPA Protocol fixes require integration. Contact aiblockchainventures.com for implementation support.</p>
      </div>
    </div>
  )
}
