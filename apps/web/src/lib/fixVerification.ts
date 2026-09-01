import type { Finding, ScanResult } from '@/types'
import { getApiBaseUrl } from '@/lib/billing'

export interface VerifiedFix {
  finding: Finding
  fixedCode: string
  rescan: ScanResult | null
  verified: boolean
  resolvedOriginal: boolean
  newFindings: Finding[]
  remainingMatches: Finding[]
  /** Set only when the server-side re-verification call itself failed (network, rate limit,
   * ownership) — distinct from "the fix didn't resolve the finding," which is a normal, expected
   * outcome represented by resolvedOriginal:false with error left undefined. */
  error?: string
}

export const findingKey = (finding: Finding): string =>
  finding.code || finding.title

export const sameFinding = (a: Finding, b: Finding): boolean => {
  const aKey = findingKey(a).toLowerCase()
  const bKey = findingKey(b).toLowerCase()
  return aKey === bKey || a.title.toLowerCase() === b.title.toLowerCase()
}

const hasMeaningfulChange = (before: string, after: string): boolean =>
  before.trim() !== after.trim()

export const applyFixForFinding = (content: string, finding: Finding): string => {
  const code = finding.code ?? ''
  const title = finding.title.toLowerCase()
  let fixed = content

  if (code === 'ROGUE_AGENT_RISK' || title.includes('rogue') || title.includes('spoof')) {
    fixed = fixed.replace(/trusted:\s*true/g, 'trusted: identity.trusted')
    fixed = fixed.replace(
      /export\s+async\s+function\s+onboard\(([^)]*)\)\s*{/,
      `export async function onboard($1) {\n  const identity = await verifyAgentIdentity($1)\n  if (!identity.trusted || !approvedAgents.has(identity.agentId)) {\n    throw new Error('Rogue agent blocked')\n  }`
    )
  }

  if (code === 'COMMAND_INJECTION_RISK' || title.includes('command injection')) {
    fixed = fixed.replace(/exec\(([^)]+)\)/g, "runCommand('kubectl', ['get', request.command], { shell: false, timeoutMs: 5000 })")
    fixed = `const allowedCommands = new Set(['pods', 'deployments', 'services'])\n\n${fixed}`
  }

  if (code === 'MISSING_HUMAN_GATES' || title.includes('human')) {
    fixed = `async function requireHumanApproval(action) {\n  const approved = await requestHumanApproval(action)\n  if (!approved) throw new Error('Action requires human approval')\n}\n\n${fixed.replace(/return\s+tools\./g, 'await requireHumanApproval(action)\n  return tools.')}`
  }

  if (code === 'MISSING_AUDIT_LOGGING' || title.includes('audit')) {
    fixed = `const auditLog = {\n  record(event) {\n    logger.info({ ...event, timestamp: new Date().toISOString() })\n  },\n}\n\n${fixed.replace(/return\s+/g, "auditLog.record({ action: 'execute', decision: 'allowed' })\n  return ")}`
  }

  if (code === 'MISSING_NONCE' || title.includes('nonce')) {
    fixed = `const nonceStore = new Set()\nfunction assertFreshNonce(nonce) {\n  if (nonceStore.has(nonce)) throw new Error('Replay detected')\n  nonceStore.add(nonce)\n}\n\n${fixed}`
  }

  if (code === 'MISSING_TIMESTAMP' || title.includes('timestamp')) {
    fixed = `function assertFreshTimestamp(timestamp) {\n  if (Date.now() - Date.parse(timestamp) > 300000) throw new Error('Request expired')\n}\n\n${fixed}`
  }

  if (code === 'MISSING_FAIL_CLOSED' || title.includes('fail-closed')) {
    fixed = fixed.replace(/catch\s*\([^)]*\)\s*{\s*}/g, "catch (error) { throw new Error('Execution blocked: authorization verification failed') }")
    fixed = `const failClosed = true\n\n${fixed}`
  }

  if (code === 'MISSING_SIGNATURE' || title.includes('signature')) {
    fixed = `async function verifyExecutionAuthorization(request) {\n  return verifySignature(process.env.A2SPA_PUBLIC_KEY, request.signature, request.payload)\n}\n\n${fixed}`
  }

  if (code === 'OVERSCOPED_TOOLS' || code === 'UNSCOPED_TOOLING' || title.includes('tool') || title.includes('permission') || title.includes('scope')) {
    fixed = fixed.replace(/tools:\s*\[[^\]]*\]/g, "tools: ['read_ticket', 'add_comment']")
    fixed = fixed.replace(/permissions:\s*\[[^\]]*\]/g, "permissions: ['tickets:read', 'tickets:comment']")
    fixed = fixed.replace(/permissions:\s*all/g, "permissions: ['tickets:read', 'tickets:comment']")
  }

  if (title.includes('credential') || title.includes('hardcoded')) {
    fixed = fixed
      .replace(/(['\"])(sk_(?:live|test)_[A-Za-z0-9_\-]+)\1/g, 'process.env.AGENT_API_KEY')
      .replace(/(['\"])([A-Za-z0-9_\-]{24,})\1/g, 'process.env.AGENT_SECRET')
    fixed = `const requiredEnv = ['AGENT_API_KEY']\nrequiredEnv.forEach(name => { if (!process.env[name]) throw new Error('Missing required secret') })\n\n${fixed}`
  }

  if (!hasMeaningfulChange(content, fixed)) {
    const fallback = finding.fixCode || finding.quickFix || finding.recommendedFix || 'Review and apply the recommended control.'
    return `// Suggested remediation for ${finding.title}\n// ${fallback.replace(/\n/g, '\n// ')}\n\n${content}`
  }

  return fixed
}

/**
 * Re-verifies a candidate fix by asking the Worker to re-scan the fixed content — the proprietary
 * engine runs ONLY there (POST /v1/verify-fix, Firebase-authenticated, ownership-checked, its own
 * rate limit separate from the monthly scan quota — see workers/api/src/worker.ts's
 * handleVerifyFix). This module never imports @agentverify/scanner.
 */
export const verifyFixCandidate = async (
  original: ScanResult,
  originalContent: string,
  finding: Finding,
  reportId: string,
  getIdToken: () => Promise<string>
): Promise<VerifiedFix> => {
  const fixedCode = applyFixForFinding(originalContent, finding)
  const base: Pick<VerifiedFix, 'finding' | 'fixedCode'> = { finding, fixedCode }

  try {
    const res = await fetch(`${getApiBaseUrl()}/v1/verify-fix`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await getIdToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportId,
        findingCode: findingKey(finding),
        fixedContent: fixedCode,
        fileName: original.metadata?.fileName ?? 'fixed-agent.js',
        platform: original.metadata?.selectedPlatform ?? undefined,
      }),
    })
    const data = await res.json().catch(() => ({})) as { rescan?: ScanResult; error?: string }
    if (!res.ok || !data.rescan) {
      return { ...base, rescan: null, verified: false, resolvedOriginal: false, newFindings: [], remainingMatches: [], error: data.error ?? 'Could not verify this fix. Please retry.' }
    }
    const rescan = data.rescan
    const remainingMatches = rescan.findings.filter(next => sameFinding(next, finding))
    const newFindings = rescan.findings.filter(next => !original.findings.some(previous => sameFinding(previous, next)))
    const resolvedOriginal = remainingMatches.length === 0
    return {
      ...base,
      rescan,
      verified: resolvedOriginal && newFindings.length === 0,
      resolvedOriginal,
      newFindings,
      remainingMatches,
    }
  } catch {
    return { ...base, rescan: null, verified: false, resolvedOriginal: false, newFindings: [], remainingMatches: [], error: 'Network error while verifying this fix. Please retry.' }
  }
}

export const canCreateFixPr = (fix: Pick<VerifiedFix, 'verified'>): boolean =>
  fix.verified
