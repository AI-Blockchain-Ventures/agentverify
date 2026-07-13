'use client'

import { useState } from 'react'
import type { Finding } from '@/types'

const severityColors: Record<string, string> = {
  critical: 'bg-[#EF4444]',
  high: 'bg-[#F59E0B]',
  medium: 'bg-yellow-500',
  low: 'bg-[#4B6080]',
}

const severityLabel: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

const severityExplanation: Record<string, string> = {
  critical: 'Fix before production. This can expose credentials, authorize unsafe execution, or create immediate compromise risk.',
  high: 'Prioritize soon. This can allow broad access, unsafe actions, or missing controls in important workflows.',
  medium: 'Plan a fix. This weakens safety or auditability and can become serious when combined with other issues.',
  low: 'Review when practical. This is lower risk but still worth improving for a stronger security posture.',
}

const getProtocolGuidance = (title: string): string => {
  const guides: Record<string, string> = {
    'Missing cryptographic signature':
      'Every agent execution request should carry a cryptographic signature that proves the request is authentic and unmodified. Generate a signature using HMAC-SHA256 or RSA on the request payload, and verify it server-side before allowing execution.',
    'Missing nonce validation':
      'Add a unique UUID to each request (called a nonce) and store it after first use. Reject any request that reuses a nonce. This prevents attackers from replaying captured requests.',
    'Missing timestamp enforcement':
      'Add a timestamp to every request and reject requests older than 5 minutes. This limits the window an attacker has to replay a captured request.',
    'Missing fail-closed enforcement':
      'When any verification check fails, execution must be explicitly blocked - not silently skipped. Use a try/catch that throws on failure, and ensure your default behavior is to deny, not allow.',
    'Over-permissioned action scope':
      'Replace wildcard permissions with an explicit list of exactly what this agent needs. If your agent only reads tickets, it should only have read:tickets permission - nothing more.',
  }
  return guides[title] ??
    'Review your agent configuration and implement the recommended controls before deploying to production.'
}

export function FindingCard({
  finding,
  showFullRemediation = true,
  showCorrectedSnippets = true,
  showA2spaGuidance = true,
}: {
  finding: Finding
  showFullRemediation?: boolean
  showCorrectedSnippets?: boolean
  showA2spaGuidance?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const isA = finding.category === 'A'
  const categoryLabel = finding.category === 'A' ? 'Protocol' : 'Security'
  const fixSnippet = finding.fixCode || finding.quickFix || getFixSnippet(finding)
  const verifyInstruction = isA
    ? 'Re-run Agent Verify after adding signature verification, nonce replay protection, timestamp expiry, and fail-closed behavior to the execution path.'
    : 'Apply the fix, re-run the scan, and confirm this finding no longer appears in the report.'
  const a2spaSnippet = `const signature = await signExecutionRequest({
  privateKey: process.env.A2SPA_PRIVATE_KEY,
  payload,
  nonce,
  timestamp,
})

const verifier = createA2SPAVerifier({
  publicKey: process.env.A2SPA_PUBLIC_KEY,
  maxAgeSeconds: 300,
})

if (!verifier.verify({ payload, signature, nonce, timestamp })) {
  throw new Error('A2SPA verification failed')
}`
  const a2spaPythonSnippet = `import os

signature = sign_execution_request(
    private_key=os.environ["A2SPA_PRIVATE_KEY"],
    payload=payload,
    nonce=nonce,
    timestamp=timestamp,
)

verified = verify_execution_request(
    public_key=os.environ["A2SPA_PUBLIC_KEY"],
    payload=payload,
    signature=signature,
    nonce=nonce,
    timestamp=timestamp,
    max_age_seconds=300,
)

if not verified:
    raise PermissionError("A2SPA verification failed")`
  const a2spaConfigSnippet = `executionAuthorization:
  protocol: A2SPA
  signingKeyRef: A2SPA_SIGNING_KEY
  verifyKeyRef: A2SPA_VERIFY_KEY
  requireNonce: true
  maxAgeSeconds: 300
  failClosed: true`

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div
      style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
      className={`w-full rounded-xl border p-5 text-left transition-colors hover:opacity-90 ${
        isA ? 'border-l-2 border-l-[#EF4444]' : 'border-l-2 border-l-[#F59E0B]'
      }`}
    >
      <button onClick={() => setOpen(!open)} className="flex w-full items-start justify-between gap-3 text-left">
        <div className="flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className={`h-2 w-2 rounded-full shrink-0 ${severityColors[finding.severity] ?? 'bg-[#4B6080]'}`} />
            <span style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }} className="rounded px-1.5 py-0.5 text-xs font-medium">
              {categoryLabel}
            </span>
            <span style={{ color: 'var(--text-muted)' }} className="text-xs">{severityLabel[finding.severity]}</span>
            <span style={{ color: 'var(--text-primary)' }} className="text-sm font-medium">{finding.title}</span>
          </div>
          {!open && (
            <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs line-clamp-1">{finding.whatIsWrong}</p>
          )}
        </div>
        <span style={{ color: 'var(--text-muted)' }} className="shrink-0 text-xs">{open ? '↑' : '↓'}</span>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)' }} className="mt-4 space-y-3 pt-4 text-sm">
          <div>
            <span style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold uppercase tracking-wider">What we found</span>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-1">{finding.whatIsWrong}</p>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold uppercase tracking-wider">Why it matters</span>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-1">{finding.whyItMatters}</p>
          </div>
          <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-lg p-3">
            <span style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold uppercase tracking-wider">Severity explained</span>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-xs">{severityExplanation[finding.severity] ?? severityExplanation.medium}</p>
          </div>
          {finding.evidence && (
            <div>
              <span style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold uppercase tracking-wider">Evidence</span>
              <pre style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)' }} className="mt-1 overflow-x-auto rounded-lg px-3 py-2 font-mono text-xs text-[#06B6D4]">
                {finding.evidence}
              </pre>
            </div>
          )}
          {showFullRemediation ? (
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-[#10B981]">How to fix it</span>
              <p style={{ color: 'var(--text-secondary)' }} className="mt-1">{finding.recommendedFix}</p>
            </div>
          ) : (
            <div className="rounded-lg border border-[#00C4CC]/30 bg-[#00C4CC]/10 p-3">
              <p style={{ color: 'var(--text-primary)' }} className="text-xs font-semibold">Full remediation requires Pro</p>
              <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-xs">Free reports show basic finding context. Pro unlocks corrected snippets, A2SPA guidance, PDF export, and shareable reports.</p>
            </div>
          )}
          {showCorrectedSnippets && fixSnippet && (
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#00B37E]">Corrected code or config</span>
                <button onClick={() => copy(fixSnippet, 'fix')} style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }} className="rounded px-2 py-1 text-xs hover:opacity-70">
                  {copied === 'fix' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="overflow-x-auto rounded-lg border border-[#00B37E]/20 bg-[#00B37E]/5 px-4 py-3 font-mono text-xs leading-relaxed text-[#00B37E]">
                {fixSnippet}
              </pre>
            </div>
          )}
          {!showCorrectedSnippets && fixSnippet && (
            <div className="rounded-lg border border-[#00C4CC]/30 bg-[#00C4CC]/10 p-3">
              <p style={{ color: 'var(--text-primary)' }} className="text-xs font-semibold">Corrected snippets require Pro</p>
              <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-xs">Upgrade to view copy-ready code and configuration fixes.</p>
            </div>
          )}
          {showA2spaGuidance && isA && (
            <div
              style={{ border: '1px solid var(--border)', backgroundColor: 'var(--surface)' }}
              className="mt-3 rounded-lg p-4"
            >
              <p style={{ color: 'var(--text-primary)' }} className="mb-2 text-xs font-semibold">
                Implement A2SPA
              </p>
              <p style={{ color: 'var(--text-secondary)' }} className="mb-3 text-xs leading-relaxed">
                A2SPA helps prove that an execution request came from a trusted caller and was not replayed or modified before an agent runs a tool, payment, deployment, or data mutation. {getProtocolGuidance(finding.title)}
              </p>
              <div
                style={{ border: '1px solid #00C4CC', backgroundColor: 'rgba(0,196,204,0.05)' }}
                className="rounded-lg p-3"
              >
                <p className="mb-1 text-xs font-semibold text-[#00C4CC]">
                  Safe implementation pattern
                </p>
                <ol style={{ color: 'var(--text-secondary)' }} className="mb-3 list-decimal space-y-1 pl-4 text-xs">
                  <li>Sign every execution request on the trusted caller side before sending it to the agent runtime.</li>
                  <li>Verify the signature at the server-side execution boundary before any tool, payment, deployment, or data mutation runs.</li>
                  <li>Reject reused nonces and expired timestamps.</li>
                  <li>Place your private key in your deployment environment or secret manager, then reference it here with environment variables.</li>
                  <li>Fail closed when verification is missing or invalid, then re-scan after implementation.</li>
                </ol>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold uppercase tracking-wider">TypeScript example</span>
                  <button onClick={() => copy(a2spaSnippet, 'a2spa')} style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }} className="rounded px-2 py-1 text-xs hover:opacity-70">
                    {copied === 'a2spa' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="overflow-x-auto rounded-lg bg-[#050A12] p-3 font-mono text-[11px] leading-relaxed text-[#A7F3D0]">{a2spaSnippet}</pre>
                <div className="mb-2 mt-3 flex items-center justify-between gap-3">
                  <span style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold uppercase tracking-wider">Python example</span>
                  <button onClick={() => copy(a2spaPythonSnippet, 'a2spa-python')} style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }} className="rounded px-2 py-1 text-xs hover:opacity-70">
                    {copied === 'a2spa-python' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="overflow-x-auto rounded-lg bg-[#050A12] p-3 font-mono text-[11px] leading-relaxed text-[#A7F3D0]">{a2spaPythonSnippet}</pre>
                <div className="mb-2 mt-3 flex items-center justify-between gap-3">
                  <span style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold uppercase tracking-wider">Config example</span>
                  <button onClick={() => copy(a2spaConfigSnippet, 'a2spa-config')} style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }} className="rounded px-2 py-1 text-xs hover:opacity-70">
                    {copied === 'a2spa-config' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="overflow-x-auto rounded-lg bg-[#050A12] p-3 font-mono text-[11px] leading-relaxed text-[#A7F3D0]">{a2spaConfigSnippet}</pre>
                <p className="mt-3 text-xs font-semibold text-[#E07B39]">Never paste a production private key into Agent Verify, source code, or a public repository. Store it in an environment variable or a secret manager.</p>
                <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs">Agent Verify will only treat an agent as A2SPA-protected when the scanned code shows verifiable implementation evidence.</p>
              </div>
            </div>
          )}
          {!showA2spaGuidance && isA && (
            <div className="rounded-lg border border-[#00C4CC]/30 bg-[#00C4CC]/10 p-3">
              <p style={{ color: 'var(--text-primary)' }} className="text-xs font-semibold">A2SPA guidance requires Pro</p>
              <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-xs">Upgrade to view implementation patterns for signed, replay-resistant agent execution.</p>
            </div>
          )}
          {showFullRemediation && <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-lg p-3">
            <span style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold uppercase tracking-wider">Verify the fix</span>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-xs">{verifyInstruction}</p>
          </div>}
          {(finding.compliance?.owasp?.length || finding.compliance?.nist?.length || finding.compliance?.soc2?.length) && (
            <div className="mt-3">
              <span style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold uppercase tracking-wider">Compliance</span>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {finding.compliance?.owasp?.map(tag => (
                  <span key={tag} className="rounded border border-[#E07B39]/20 bg-[#E07B39]/5 px-2 py-0.5 text-xs text-[#E07B39]">OWASP {tag}</span>
                ))}
                {finding.compliance?.nist?.map(tag => (
                  <span key={tag} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }} className="rounded px-2 py-0.5 text-xs">NIST {tag}</span>
                ))}
                {finding.compliance?.soc2?.map(tag => (
                  <span key={tag} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }} className="rounded px-2 py-0.5 text-xs">SOC 2 {tag}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function getFixSnippet(finding: Finding): string {
  if (finding.code === 'MISSING_SIGNATURE') {
    return `const signingKey = process.env.A2SPA_PRIVATE_KEY
const signature = await signExecutionRequest({ signingKey, payload, nonce, timestamp })`
  }
  if (finding.code === 'MISSING_NONCE' || finding.code === 'MISSING_TIMESTAMP') {
    return `const nonce = crypto.randomUUID()
const timestamp = new Date().toISOString()

if (await nonceStore.has(nonce)) throw new Error('Replay detected')
if (Date.now() - Date.parse(timestamp) > 300_000) throw new Error('Request expired')`
  }
  if (finding.code === 'MISSING_FAIL_CLOSED') {
    return `const authorized = await verifyExecutionAuthorization(request)
if (!authorized) {
  throw new Error('Execution blocked: authorization verification failed')
}`
  }
  if (finding.code === 'MISSING_HUMAN_GATES') {
    return `if (action.isHighRisk) {
  const approved = await requestHumanApproval({ action, requester: userId })
  if (!approved) throw new Error('Action requires human approval')
}`
  }
  if (finding.code === 'MISSING_AUDIT_LOGGING') {
    return `const receipt = await signAuditReceipt({
  requestId,
  actor: userId,
  action: toolName,
  decision: 'allowed',
  timestamp: new Date().toISOString(),
})`
  }
  if (finding.code === 'COMMAND_INJECTION_RISK') {
    return `const allowedCommands = new Set(['status', 'logs'])
if (!allowedCommands.has(request.command)) {
  throw new Error('Command not allowed')
}
await runCommand('kubectl', ['get', request.command], { shell: false, timeoutMs: 5000 })`
  }
  if (finding.code === 'SUPPLY_CHAIN_RISK') {
    return `const plugin = await loadPlugin({
  name: 'approved-agent-plugin',
  version: '1.4.2',
  integrity: process.env.APPROVED_PLUGIN_INTEGRITY,
})`
  }
  if (finding.code === 'ROGUE_AGENT_RISK') {
    return `const identity = await verifyAgentIdentity(candidateAgent)
if (!identity.trusted || !approvedAgents.has(identity.agentId)) {
  throw new Error('Rogue agent blocked')
}`
  }
  const title = finding.title.toLowerCase()
  if (title.includes('credential')) {
    return `const client = createClient({
  apiKey: process.env.AGENT_API_KEY,
})`
  }
  if (title.includes('tool') || title.includes('scope') || title.includes('permission')) {
    return `const agent = {
  tools: ['read_ticket', 'add_comment'],
  permissions: ['tickets:read', 'tickets:comment'],
}`
  }
  if (title.includes('rate')) {
    return `const rateLimit = {
  maxRequests: 30,
  windowSeconds: 60,
  perUser: true,
}`
  }
  if (title.includes('audit')) {
    return `auditLog.record({
  action: tool.name,
  userId,
  timestamp: new Date().toISOString(),
  decision: 'allowed',
})`
  }
  if (title.includes('human')) {
    return `if (action.isHighRisk) {
  await requireHumanApproval({ action, requester: userId })
}`
  }
  if (title.includes('memory')) {
    return `const memory = {
  persist: false,
  ttlSeconds: 3600,
  scope: 'session',
}`
  }
  return ''
}
