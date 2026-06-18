type Verdict = 'VERIFIED' | 'NOT VERIFIED'
type RiskLevel = 'Low Risk' | 'Moderate Risk' | 'High Risk'
type Category = 'A' | 'B'
type Severity = 'critical' | 'high' | 'medium' | 'low'

interface Finding {
  id: string
  title: string
  category: Category
  severity: Severity
  whatIsWrong: string
  whyItMatters: string
  evidence?: string
  recommendedFix: string
}

interface RuntimeBOM {
  detectedLanguage: string
  detectedFramework: string | null
  detectedPlatform: string | null
  agentName: string | null
  toolAccessLevel: 'Restricted' | 'Unrestricted' | 'Unknown'
  credentialExposure: 'Detected' | 'Not Detected'
  memoryPersistence: 'Bounded' | 'Unbounded' | 'Unknown'
  auditLogging: 'Present' | 'Absent' | 'Unknown'
  humanGates: 'Present' | 'Absent' | 'Unknown'
  rateLimiting: 'Present' | 'Absent' | 'Unknown'
  promptInjectionSurface: 'Detected' | 'Not Detected' | 'Unknown'
  delegationScope: 'Scoped' | 'Unscoped' | 'Unknown'
}

interface CategoryScore {
  category: Category
  label: string
  score: number
  maxScore: number
  findingCount: number
}

interface ScanResult {
  reportId: string
  verdict: Verdict
  riskScore: number
  riskLevel: RiskLevel
  confidence: number
  findings: Finding[]
  categoryScores: CategoryScore[]
  bom: RuntimeBOM
  metadata: {
    fileName: string
    fileSize: number
    scannedAt: string
    detectedLanguage: string
    detectedFramework: string | null
    selectedPlatform: string | null
    agentName: string | null
  }
}

interface ScanInput {
  content: string
  fileName?: string
  fileSize?: number
  platform?: string
}

const nanoid = (size = 8): string =>
  Math.random().toString(36).slice(2, 2 + size)

const getRiskLevel = (score: number): RiskLevel => {
  if (score >= 80) return 'Low Risk'
  if (score >= 50) return 'Moderate Risk'
  return 'High Risk'
}

const detectLanguage = (content: string, fileName?: string): string => {
  const ext = fileName?.split('.').pop()?.toLowerCase()
  if (ext === 'py') return 'Python'
  if (ext === 'ts' || ext === 'tsx') return 'TypeScript'
  if (ext === 'js' || ext === 'jsx' || ext === 'mjs') return 'JavaScript'
  if (ext === 'json') return 'JSON'
  if (ext === 'yaml' || ext === 'yml') return 'YAML'
  if (/^import |^from |def |class /m.test(content)) return 'Python'
  if (/interface |: string|: number|<T>/m.test(content)) return 'TypeScript'
  if (/const |let |var |=>|require\(/m.test(content)) return 'JavaScript'
  return 'Unknown'
}

const detectFramework = (content: string): string | null => {
  if (/langchain|LangChain/i.test(content)) return 'LangChain'
  if (/autogen|AutoGen/i.test(content)) return 'AutoGen'
  if (/crewai|CrewAI/i.test(content)) return 'CrewAI'
  if (/openai|OpenAI/i.test(content)) return 'OpenAI'
  if (/anthropic|claude/i.test(content)) return 'Anthropic'
  if (/llamaindex|LlamaIndex/i.test(content)) return 'LlamaIndex'
  if (/haystack/i.test(content)) return 'Haystack'
  return null
}

const detectAgentName = (content: string): string | null => {
  const match = content.match(/name\s*[:=]\s*['"`]([^'"`]+)['"`]/i)
  return match?.[1] ?? null
}

const signals = {
  hasSignature: (c: string) =>
    /signature|sign\(|verify\(|crypto\.sign|rs256|hs256|jwt\.verify/i.test(c),
  hasNonce: (c: string) =>
    /nonce|replay.protect|unique.token|request.id|idempotency/i.test(c),
  hasTimestamp: (c: string) =>
    /timestamp|expir|ttl|expires.at|valid.until|iat|exp[^a-z]/i.test(c),
  hasFailClosed: (c: string) =>
    /fail.closed|throw|abort|reject|deny.by.default|block.on.fail/i.test(c),
  hasScopeEnforcement: (c: string) =>
    /scope|permission|allow.?list|whitelist|least.privilege/i.test(c) &&
    !/tools.*\*|permissions.*all|scope.*\*/i.test(c),
  hasBroadPermissions: (c: string) =>
    /tools.*['"`]\*['"`]|permissions.*['"`]all['"`]|scope.*['"`]\*['"`]/i.test(c),
  hasHumanGates: (c: string) =>
    /confirm|approve|human.review|checkpoint|manual.gate|require.approval/i.test(c),
  hasAuditLogging: (c: string) =>
    /audit|logger|log\.|console\.(log|warn|error)|track|record|monitor/i.test(c),
  hasRateLimiting: (c: string) =>
    /rate.?limit|throttle|budget|max.?calls|quota|token.?limit/i.test(c),
  hasMemoryBounds: (c: string) =>
    !/memory.*persist.*true|persist.*true|ttl.*null|retention.*forever/i.test(c),
  hasPromptSanitization: (c: string) =>
    !/system.?prompt|systemPrompt|system_prompt/i.test(c) ||
    /sanitize|validate|escape|boundary|input.clean/i.test(c),
  hasScopedDelegation: (c: string) =>
    !/delegate|subagent|sub_agent|handoff/i.test(c) ||
    /scope|constrain|limit|bound/i.test(c),
  hasToolAllowlist: (c: string) =>
    !/tools.*\[.*\*|allowedTools.*\*|toolAccess.*all/i.test(c),
  hasExecutionCapabilities: (c: string) =>
    /fetch|axios|request|http|api|tool|execute|run|call|invoke/i.test(c),
  hasHighRiskActions: (c: string) =>
    /transfer|delete|deploy|payment|purchase|send|execute|write|modify/i.test(c),
}

const findingDefinitions = {
  missingSignature: (): Finding => ({
    id: nanoid(), title: 'Missing cryptographic signature', category: 'A', severity: 'critical',
    whatIsWrong: 'No cryptographic signature was detected in this agent configuration.',
    whyItMatters: 'Without a signature, there is no proof the payload is authentic before it triggers real-world actions. Any intercepted or modified request will execute without detection.',
    recommendedFix: 'Add cryptographic signature verification to every execution request before allowing agent actions to run.',
  }),
  missingNonce: (): Finding => ({
    id: nanoid(), title: 'Missing nonce validation', category: 'A', severity: 'critical',
    whatIsWrong: 'No nonce or replay protection token was detected.',
    whyItMatters: 'Without a unique per-request token, replay attacks become trivial. An attacker can capture and re-execute any valid request.',
    recommendedFix: 'Add a UUID nonce to every request and reject requests with previously seen nonces.',
  }),
  missingTimestamp: (): Finding => ({
    id: nanoid(), title: 'Missing timestamp enforcement', category: 'A', severity: 'high',
    whatIsWrong: 'No timestamp or expiry validation was detected.',
    whyItMatters: 'Expired payloads remain valid indefinitely and can trigger execution long after the intended window.',
    recommendedFix: 'Add timestamp to every request. Reject requests older than 5 minutes.',
  }),
  missingFailClosed: (): Finding => ({
    id: nanoid(), title: 'Missing fail-closed enforcement', category: 'A', severity: 'critical',
    whatIsWrong: 'No fail-closed pattern detected. Verification failures may still allow execution.',
    whyItMatters: 'Without a hard block on verification failure, a failed check is just a warning. Execution proceeds regardless.',
    recommendedFix: 'Explicitly throw or abort execution when any verification check fails.',
  }),
  missingScope: (): Finding => ({
    id: nanoid(), title: 'Over-permissioned action scope', category: 'A', severity: 'high',
    whatIsWrong: 'Wildcard or broad permission scope detected.',
    whyItMatters: 'Wildcard and admin credentials expose access far beyond what the task requires. A compromised agent has unrestricted authority.',
    recommendedFix: 'Replace wildcard permissions with an explicit allowlist of only required actions.',
  }),
  hardcodedCredentials: (evidence?: string): Finding => ({
    id: nanoid(), title: 'Hardcoded credentials detected', category: 'B', severity: 'critical', evidence,
    whatIsWrong: 'API keys, passwords, or secrets appear to be hardcoded directly in the configuration.',
    whyItMatters: 'Hardcoded secrets are visible in version control history, logs, and error traces. A single repository leak exposes all credentials permanently.',
    recommendedFix: 'Move all secrets to environment variables. Use a secrets manager for production.',
  }),
  missingHumanGates: (): Finding => ({
    id: nanoid(), title: 'Missing human-in-the-loop gates', category: 'B', severity: 'high',
    whatIsWrong: 'High-risk actions (transfers, deletions, deployments, payments) execute without human confirmation.',
    whyItMatters: 'Irreversible actions without approval gates create catastrophic failure modes. A single prompt injection or logic error causes unrecoverable damage.',
    recommendedFix: 'Add explicit confirmation gates before any irreversible action. Require human approval for financial and destructive operations.',
  }),
  unboundedMemory: (): Finding => ({
    id: nanoid(), title: 'Unbounded memory persistence', category: 'B', severity: 'medium',
    whatIsWrong: 'Agent memory is configured to persist indefinitely.',
    whyItMatters: 'Agents that retain data beyond session boundaries can accumulate sensitive information and act on stale or poisoned context.',
    recommendedFix: 'Set explicit TTL on all memory. Clear session context after task completion.',
  }),
  missingAuditLog: (): Finding => ({
    id: nanoid(), title: 'Missing audit logging', category: 'B', severity: 'high',
    whatIsWrong: 'No audit logging or execution tracking detected.',
    whyItMatters: 'Without an audit trail, forensic investigation after a failure or breach is impossible. Compliance requirements cannot be met.',
    recommendedFix: 'Log every tool call, API request, and execution decision with timestamp and context.',
  }),
  promptInjectionSurface: (): Finding => ({
    id: nanoid(), title: 'Prompt injection surface detected', category: 'B', severity: 'high',
    whatIsWrong: 'System prompt configuration detected without input sanitization.',
    whyItMatters: 'Unsanitized system prompts are vulnerable to adversarial redirection. An attacker can override agent behavior through crafted inputs.',
    recommendedFix: 'Sanitize all user inputs before inclusion in prompts. Define strict boundaries between system and user content.',
  }),
  noRateLimiting: (): Finding => ({
    id: nanoid(), title: 'No execution rate limiting', category: 'B', severity: 'medium',
    whatIsWrong: 'No rate limiting, token budget, or call quota detected.',
    whyItMatters: 'Agents without execution budgets can exhaust API quotas, generate unbounded costs, and create denial-of-service conditions.',
    recommendedFix: 'Add rate limits, token budgets, and maximum call counts to all agent execution paths.',
  }),
  unscopedDelegation: (): Finding => ({
    id: nanoid(), title: 'Unscoped delegation detected', category: 'B', severity: 'high',
    whatIsWrong: 'Agent delegation or subagent handoff detected without scope constraints.',
    whyItMatters: 'Authority propagation without scope constraints creates unbounded privilege chains. Subagents inherit full parent permissions.',
    recommendedFix: 'Define explicit scope constraints on all delegation. Subagents must receive minimum required permissions only.',
  }),
  broadToolAccess: (): Finding => ({
    id: nanoid(), title: 'Unrestricted tool access', category: 'B', severity: 'high',
    whatIsWrong: 'Agent has access to all tools with no allowlist restriction.',
    whyItMatters: 'An agent that can invoke any tool it discovers has an unbounded attack surface. Tool discovery becomes a privilege escalation path.',
    recommendedFix: 'Define an explicit tool allowlist. Deny all tools not on the list by default.',
  }),
}

function scan(input: ScanInput): ScanResult {
  const { content, fileName, fileSize, platform } = input
  const detectedLanguage = detectLanguage(content, fileName)
  const detectedFramework = detectFramework(content)
  const agentName = detectAgentName(content)
  const hasExecCaps = signals.hasExecutionCapabilities(content)
  const hasHighRisk = signals.hasHighRiskActions(content)
  const findings: Finding[] = []

  if (!signals.hasSignature(content)) findings.push(findingDefinitions.missingSignature())
  if (!signals.hasNonce(content)) findings.push(findingDefinitions.missingNonce())
  if (!signals.hasTimestamp(content)) findings.push(findingDefinitions.missingTimestamp())
  if (!signals.hasFailClosed(content)) findings.push(findingDefinitions.missingFailClosed())
  if (!signals.hasScopeEnforcement(content)) findings.push(findingDefinitions.missingScope())

  const credMatch = content.match(/(api.?key|secret|password|token|credential)\s*[:=]\s*['"`]([a-zA-Z0-9_\-]{8,})/i)
  if (credMatch) findings.push(findingDefinitions.hardcodedCredentials(credMatch[0]))
  if (signals.hasBroadPermissions(content)) findings.push(findingDefinitions.broadToolAccess())
  if (hasHighRisk && !signals.hasHumanGates(content)) findings.push(findingDefinitions.missingHumanGates())
  if (!signals.hasMemoryBounds(content)) findings.push(findingDefinitions.unboundedMemory())
  if (hasExecCaps && !signals.hasAuditLogging(content)) findings.push(findingDefinitions.missingAuditLog())
  if (!signals.hasPromptSanitization(content)) findings.push(findingDefinitions.promptInjectionSurface())
  if (hasExecCaps && !signals.hasRateLimiting(content)) findings.push(findingDefinitions.noRateLimiting())
  if (!signals.hasScopedDelegation(content)) findings.push(findingDefinitions.unscopedDelegation())
  if (!signals.hasToolAllowlist(content)) findings.push(findingDefinitions.broadToolAccess())

  const catAFindings = findings.filter(f => f.category === 'A')
  const catBFindings = findings.filter(f => f.category === 'B')
  const criticalCount = findings.filter(f => f.severity === 'critical').length
  const highCount = findings.filter(f => f.severity === 'high').length
  const mediumCount = findings.filter(f => f.severity === 'medium').length

  let score = 100
  score -= criticalCount * 20
  score -= highCount * 10
  score -= mediumCount * 5
  score = Math.max(0, Math.min(100, score))

  const isVerified = score >= 80 && criticalCount === 0 && signals.hasSignature(content) && signals.hasNonce(content) && signals.hasFailClosed(content)
  const categoryScores: CategoryScore[] = [
    { category: 'A', label: 'Protocol Compliance', score: Math.max(0, 50 - catAFindings.length * 10), maxScore: 50, findingCount: catAFindings.length },
    { category: 'B', label: 'Security Controls', score: Math.max(0, 50 - catBFindings.length * 10), maxScore: 50, findingCount: catBFindings.length },
  ]
  const bom: RuntimeBOM = {
    detectedLanguage,
    detectedFramework,
    detectedPlatform: platform ?? null,
    agentName,
    toolAccessLevel: signals.hasBroadPermissions(content) ? 'Unrestricted' : 'Restricted',
    credentialExposure: !!credMatch ? 'Detected' : 'Not Detected',
    memoryPersistence: !signals.hasMemoryBounds(content) ? 'Unbounded' : 'Unknown',
    auditLogging: signals.hasAuditLogging(content) ? 'Present' : 'Absent',
    humanGates: signals.hasHumanGates(content) ? 'Present' : 'Absent',
    rateLimiting: signals.hasRateLimiting(content) ? 'Present' : 'Absent',
    promptInjectionSurface: !signals.hasPromptSanitization(content) ? 'Detected' : 'Not Detected',
    delegationScope: signals.hasScopedDelegation(content) ? 'Scoped' : 'Unknown',
  }

  return {
    reportId: 'REPORT-' + nanoid(12),
    verdict: isVerified ? 'VERIFIED' : 'NOT VERIFIED',
    riskScore: score,
    riskLevel: getRiskLevel(score),
    confidence: Math.round(Math.min(100, 60 + (content.length > 500 ? 20 : 0) + (detectedLanguage !== 'Unknown' ? 20 : 0))),
    findings,
    categoryScores,
    bom,
    metadata: {
      fileName: fileName ?? 'unknown',
      fileSize: fileSize ?? content.length,
      scannedAt: new Date().toISOString(),
      detectedLanguage,
      detectedFramework,
      selectedPlatform: platform ?? null,
      agentName,
    },
  }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, User-Agent',
    },
  })

async function saveReportToFirebase(
  apiKey: string,
  result: ScanResult,
  fileName: string,
  firebaseApiKey: string
): Promise<string | null> {
  try {
    // Step 1: Look up uid from apiKeyIndex
    const indexUrl = `https://firestore.googleapis.com/v1/projects/agentverify-26e26/databases/(default)/documents/apiKeyIndex/${encodeURIComponent(apiKey)}?key=${firebaseApiKey}`

    const indexRes = await fetch(indexUrl)
    if (!indexRes.ok) {
      console.error('apiKeyIndex lookup failed:', indexRes.status, await indexRes.text())
      return null
    }

    const indexData = await indexRes.json() as {
      fields?: { uid?: { stringValue?: string } }
    }
    const uid = indexData?.fields?.uid?.stringValue
    if (!uid) {
      console.error('No uid found in apiKeyIndex for key:', apiKey)
      return null
    }

    // Step 2: Save to cliReports collection
    const reportId = result.reportId
    const reportUrl = `https://firestore.googleapis.com/v1/projects/agentverify-26e26/databases/(default)/documents/cliReports/${reportId}?key=${firebaseApiKey}`

    const firestoreFindings = (result.findings ?? []).map((f: Finding) => ({
      mapValue: {
        fields: {
          title: { stringValue: f.title ?? '' },
          category: { stringValue: f.category ?? 'B' },
          severity: { stringValue: f.severity ?? 'medium' },
          whatIsWrong: { stringValue: f.whatIsWrong ?? '' },
          whyItMatters: { stringValue: f.whyItMatters ?? '' },
          recommendedFix: { stringValue: f.recommendedFix ?? '' },
        }
      }
    }))

    const payload = {
      fields: {
        reportId: { stringValue: reportId },
        uid: { stringValue: uid },
        fileName: { stringValue: fileName ?? 'unknown' },
        verdict: { stringValue: result.verdict ?? 'NOT VERIFIED' },
        riskScore: { integerValue: String(result.riskScore ?? 0) },
        riskLevel: { stringValue: result.riskLevel ?? 'High Risk' },
        findings: { arrayValue: { values: firestoreFindings } },
        scannedAt: { stringValue: result.metadata?.scannedAt ?? new Date().toISOString() },
        source: { stringValue: 'cli' },
        platform: { stringValue: result.metadata?.selectedPlatform ?? '' },
        isPrivate: { booleanValue: true },
        isPublic: { booleanValue: false },
        password: { nullValue: null },
      }
    }

    const saveRes = await fetch(reportUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!saveRes.ok) {
      const errText = await saveRes.text()
      console.error('Firestore save failed:', saveRes.status, errText)
      return null
    }

    return reportId
  } catch (e) {
    console.error('saveReportToFirebase error:', e instanceof Error ? e.message : e)
    return null
  }
}

export default {
  async fetch(request: Request, env: { AGENT_VERIFY_API_KEY?: string; FIREBASE_API_KEY?: string }): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') return json({ ok: true })
    if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, service: 'agentverify-api' })

    if (request.method === 'GET' && url.pathname.startsWith('/v1/badge/')) {
      const reportId = url.pathname.split('/v1/badge/')[1]
      if (!reportId) return json({ error: 'Report ID required' }, 400)

      let verdict = 'UNKNOWN'
      let score = 0
      let verified = false

      const reportsUrl = `https://firestore.googleapis.com/v1/projects/agentverify-26e26/databases/(default)/documents/reports/${reportId}?key=${env.FIREBASE_API_KEY}`
      let res = await fetch(reportsUrl)

      if (!res.ok) {
        const cliUrl = `https://firestore.googleapis.com/v1/projects/agentverify-26e26/databases/(default)/documents/cliReports/${reportId}?key=${env.FIREBASE_API_KEY}`
        res = await fetch(cliUrl)
      }

      if (res.ok) {
        const data = await res.json() as { fields?: Record<string, unknown> }
        const fields = data?.fields as Record<string, {
          stringValue?: string
          integerValue?: string
          doubleValue?: number
        }> | undefined
        verdict = fields?.verdict?.stringValue ?? 'UNKNOWN'
        score = parseInt(fields?.riskScore?.integerValue ?? '0') || Math.round(fields?.riskScore?.doubleValue ?? 0)
        verified = verdict === 'VERIFIED'
      }

      const color = verified ? '#00B37E' : score >= 50 ? '#E07B39' : '#E03E3E'
      const label = verified ? 'VERIFIED' : 'NOT VERIFIED'
      const labelWidth = verified ? 80 : 104
      const totalWidth = labelWidth + 110
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20"><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${totalWidth}" height="20" rx="3"/></clipPath><g clip-path="url(#r)"><rect width="110" height="20" fill="#0D1321"/><rect x="110" width="${labelWidth}" height="20" fill="${color}"/><rect width="${totalWidth}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11"><text x="55" y="15" fill="#000" fill-opacity=".15">Agent Verify ${score}/100</text><text x="55" y="14">Agent Verify ${score}/100</text><text x="${110 + labelWidth / 2}" y="15" fill="#000" fill-opacity=".15">${label}</text><text x="${110 + labelWidth / 2}" y="14">${label}</text></g></svg>`

      return new Response(svg, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, User-Agent',
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'max-age=3600',
        },
      })
    }

    if (request.method !== 'POST' || url.pathname !== '/v1/scan') {
      return json({ error: 'Not found' }, 404)
    }

    try {
      const body = (await request.json()) as Partial<ScanInput>
      if (!body.content || typeof body.content !== 'string') {
        return json({ error: 'content is required' }, 400)
      }

      const scanResult = scan({
        content: body.content,
        fileName: body.fileName,
        fileSize: body.fileSize,
        platform: body.platform,
      })
      const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim() ?? ''
      const fileName = body.fileName ?? 'unknown'
      const reportId = await saveReportToFirebase(token, scanResult, fileName, env.FIREBASE_API_KEY ?? '')

      return json({
        ...scanResult,
        reportId,
        saved: !!reportId,
        reportUrl: reportId
          ? `https://aimodularity.com/agentverify/report/?id=${reportId}`
          : null,
      })
    } catch {
      return json({ error: 'Invalid JSON body' }, 400)
    }
  },
}
