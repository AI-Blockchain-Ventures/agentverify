// Unit tests for the pure comparison/grouping logic in src/lib/compareReports.ts and
// src/lib/agentGrouping.ts. These modules have no runtime dependency on Firebase or React (only
// type-only imports from '@/types'), so we transpile them with esbuild at test time rather than
// pulling in the full Next.js build — this keeps the test fast and avoids initializing a real
// Firebase app as an import side effect.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.join(__dirname, '..', 'src', 'lib')

async function loadTsModule(relPath) {
  const filePath = path.join(srcDir, relPath)
  const source = readFileSync(filePath, 'utf8')
  const { code } = transformSync(source, { loader: 'ts', format: 'esm', target: 'node20' })
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64')
  return import(dataUrl)
}

const { compareReports, findPreviousReport } = await loadTsModule('compareReports.ts')
const { groupReportsByAgent, findAgentGroup, agentGroupSlug } = await loadTsModule('agentGrouping.ts')

let n = 0
const report = (overrides) => ({
  reportId: `r${n++}`,
  verdict: 'NOT VERIFIED',
  riskScore: 50,
  fileName: 'agent.py',
  agentName: null,
  scannedAt: new Date('2026-01-01T00:00:00Z').toISOString(),
  findings: [],
  capabilities: [],
  mcpExposures: [],
  ...overrides,
})

const finding = (code, overrides) => ({
  id: code, code, title: code, category: 'B', severity: 'medium',
  whatIsWrong: '', whyItMatters: '', recommendedFix: '', ...overrides,
})

// ---------------------------------------------------------------------------
// compareReports: finding-level edge cases
// ---------------------------------------------------------------------------

{
  // same finding, only line number moved -> still "unchanged" (matched by code, not line)
  const prev = report({ findings: [finding('HARDCODED_CREDENTIALS', { line: 10 })] })
  const cur = report({ findings: [finding('HARDCODED_CREDENTIALS', { line: 47 })] })
  const diff = compareReports(prev, cur)
  assert.equal(diff.findings.new.length, 0)
  assert.equal(diff.findings.resolved.length, 0)
  assert.equal(diff.findings.unchanged.length, 1)
  assert.equal(diff.findings.unchanged[0].code, 'HARDCODED_CREDENTIALS')
}

{
  // same code, wording of the title changed -> still one "unchanged" finding, not new+resolved
  const prev = report({ findings: [finding('BROAD_TOOL_ACCESS', { title: 'Unrestricted tool access' })] })
  const cur = report({ findings: [finding('BROAD_TOOL_ACCESS', { title: 'Agent can call any tool' })] })
  const diff = compareReports(prev, cur)
  assert.equal(diff.findings.unchanged.length, 1)
  assert.equal(diff.findings.new.length, 0)
  assert.equal(diff.findings.unchanged[0].title, 'Agent can call any tool')
}

{
  // secret VALUE changing between scans must never surface in the comparison at all —
  // FindingChange only ever carries code/title/severity/category, never evidence.
  const prev = report({ findings: [finding('HARDCODED_CREDENTIALS', { evidence: 'sk_live_OLDSECRETVALUE [redacted]' })] })
  const cur = report({ findings: [finding('HARDCODED_CREDENTIALS', { evidence: 'sk_live_NEWSECRETVALUE [redacted]' })] })
  const diff = compareReports(prev, cur)
  const serialized = JSON.stringify(diff)
  assert.ok(!serialized.includes('OLDSECRETVALUE') && !serialized.includes('NEWSECRETVALUE'), 'comparison summary must never carry raw finding evidence')
  assert.ok(!Object.prototype.hasOwnProperty.call(diff.findings.unchanged[0], 'evidence'))
}

{
  // two DIFFERENT findings with similar-sounding titles must never collapse into each other
  const prev = report({ findings: [finding('PERMISSIVE_CORS', { title: 'Permissive CORS (wildcard origin)' })] })
  const cur = report({ findings: [finding('PERMISSIVE_CORS', { title: 'Permissive CORS (wildcard origin)' }), finding('CORS_MISSING_CREDENTIALS_CHECK', { title: 'Permissive CORS combined with credentials' })] })
  const diff = compareReports(prev, cur)
  assert.equal(diff.findings.unchanged.length, 1, 'the matching-code finding must be unchanged')
  assert.equal(diff.findings.new.length, 1, 'the different-code finding must be new, not merged into the unchanged one')
  assert.equal(diff.findings.new[0].code, 'CORS_MISSING_CREDENTIALS_CHECK')
}

{
  // legacy string-only findings (pre-dating the code field) have no stable identity and must
  // never be matched to anything, in either direction
  const prev = report({ findings: ['Some old finding text'] })
  const cur = report({ findings: ['Some old finding text'] })
  const diff = compareReports(prev, cur)
  assert.equal(diff.findings.unchanged.length, 0)
  assert.equal(diff.findings.new.length, 0)
  assert.equal(diff.findings.resolved.length, 0)
}

{
  // old report predates capabilities/MCP/BOM fields entirely (all undefined) -> comparison
  // must show "no prior data" gracefully, never throw
  const prev = report({ capabilities: undefined, mcpExposures: undefined, bom: undefined })
  const cur = report({
    capabilities: [{ id: 'network_egress', label: 'Network egress', evidence: 'fetch(', confidence: 'definite' }],
    mcpExposures: [{ toolName: 'db_query', server: 'postgres-mcp', potentialActions: ['read'], riskLevel: 'high', evidence: 'mcp.tool(' }],
  })
  const diff = compareReports(prev, cur)
  assert.equal(diff.capabilities.new.length, 1)
  assert.equal(diff.capabilities.resolved.length, 0)
  assert.equal(diff.mcpExposures.new.length, 1)
  assert.equal(diff.bomChanges.length, 0)
}

{
  // capability/MCP tool removed between scans
  const prev = report({
    capabilities: [{ id: 'execute_commands', label: 'Execute commands', evidence: 'exec(', confidence: 'definite' }],
    mcpExposures: [{ toolName: 'shell_exec', server: null, potentialActions: ['run'], riskLevel: 'critical', evidence: 'mcp' }],
  })
  const cur = report({ capabilities: [], mcpExposures: [] })
  const diff = compareReports(prev, cur)
  assert.equal(diff.capabilities.resolved.length, 1)
  assert.equal(diff.capabilities.resolved[0].id, 'execute_commands')
  assert.equal(diff.mcpExposures.resolved.length, 1)
  assert.equal(diff.mcpExposures.resolved[0].toolName, 'shell_exec')
}

{
  // score increase / decrease and verdict transitions
  const worse = compareReports(report({ riskScore: 80, verdict: 'VERIFIED' }), report({ riskScore: 40, verdict: 'NOT VERIFIED' }))
  assert.equal(worse.scoreChange, -40)
  assert.equal(worse.verdictChanged, true)
  assert.equal(worse.verdictImproved, false)

  const better = compareReports(report({ riskScore: 40, verdict: 'NOT VERIFIED' }), report({ riskScore: 90, verdict: 'VERIFIED' }))
  assert.equal(better.scoreChange, 50)
  assert.equal(better.verdictImproved, true)

  const fromNotAssessed = compareReports(report({ riskScore: 0, verdict: 'NOT_ASSESSED' }), report({ riskScore: 85, verdict: 'VERIFIED' }))
  assert.equal(fromNotAssessed.verdictChanged, true)
  assert.equal(fromNotAssessed.verdictImproved, true)
}

// ---------------------------------------------------------------------------
// findPreviousReport: identity-matching edge cases (the core "don't falsely merge" guarantee)
// ---------------------------------------------------------------------------

{
  // same filename, UNRELATED project (no agent name on either) -> must never be linked
  const older = report({ fileName: 'agent.py', agentName: null, scannedAt: new Date('2026-01-01').toISOString() })
  const current = report({ fileName: 'agent.py', agentName: null, scannedAt: new Date('2026-01-02').toISOString() })
  assert.equal(findPreviousReport(current, [older]), null, 'must not match on filename alone')
}

{
  // same filename, but only ONE side has a real agent name -> still must not match
  const older = report({ fileName: 'main.ts', agentName: null, scannedAt: new Date('2026-01-01').toISOString() })
  const current = report({ fileName: 'main.ts', agentName: 'Support Bot', scannedAt: new Date('2026-01-02').toISOString() })
  assert.equal(findPreviousReport(current, [older]), null)
}

{
  // same agent name, different filename/version/branch -> DOES match (identity is the name, not the file)
  const older = report({ fileName: 'agent-v1.py', agentName: 'FinanceOps Agent', scannedAt: new Date('2026-01-01').toISOString() })
  const current = report({ fileName: 'agent-v2.py', agentName: 'FinanceOps Agent', scannedAt: new Date('2026-01-02').toISOString() })
  const found = findPreviousReport(current, [older])
  assert.equal(found?.reportId, older.reportId)
}

{
  // renamed project: agent name itself changed -> conservatively treated as no match (never
  // guessed) rather than silently attributing one project's history to a different name
  const older = report({ fileName: 'agent.py', agentName: 'Old Name', scannedAt: new Date('2026-01-01').toISOString() })
  const current = report({ fileName: 'agent.py', agentName: 'New Name', scannedAt: new Date('2026-01-02').toISOString() })
  assert.equal(findPreviousReport(current, [older]), null)
}

{
  // cross-source: a CLI scan and a dashboard scan of the SAME named agent must still link
  const older = report({ agentName: 'Support Bot', source: 'cli', scannedAt: new Date('2026-01-01').toISOString() })
  const current = report({ agentName: 'Support Bot', source: 'dashboard', scannedAt: new Date('2026-01-02').toISOString() })
  const found = findPreviousReport(current, [older])
  assert.equal(found?.reportId, older.reportId)
}

{
  // multiple older scans of the same named agent -> picks the most recent one
  const oldest = report({ agentName: 'Ops Agent', scannedAt: new Date('2026-01-01').toISOString() })
  const middle = report({ agentName: 'Ops Agent', scannedAt: new Date('2026-01-05').toISOString() })
  const current = report({ agentName: 'Ops Agent', scannedAt: new Date('2026-01-10').toISOString() })
  const found = findPreviousReport(current, [oldest, middle])
  assert.equal(found?.reportId, middle.reportId)
}

// ---------------------------------------------------------------------------
// groupReportsByAgent: dashboard/agent-detail grouping edge cases
// ---------------------------------------------------------------------------

{
  // same agent name, different filename/version -> one group
  const a = report({ agentName: 'FinanceOps Agent', fileName: 'v1/agent.py' })
  const b = report({ agentName: 'FinanceOps Agent', fileName: 'v2/agent.py' })
  const groups = groupReportsByAgent([a, b])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].reports.length, 2)
  assert.equal(groups[0].identityConfidence, 'named')
}

{
  // same filename, unrelated/unnamed projects -> must NOT be grouped together
  const a = report({ agentName: null, fileName: 'agent.py' })
  const b = report({ agentName: null, fileName: 'agent.py' })
  const groups = groupReportsByAgent([a, b])
  assert.equal(groups.length, 2, 'unnamed reports sharing a filename must stay standalone')
  assert.ok(groups.every(g => g.identityConfidence === 'standalone'))
}

{
  // unknown/empty agent name variants all treated as "no reliable identity"
  const a = report({ agentName: 'Unknown' })
  const b = report({ agentName: '' })
  const c = report({ agentName: null })
  const groups = groupReportsByAgent([a, b, c])
  assert.equal(groups.length, 3)
  assert.ok(groups.every(g => g.identityConfidence === 'standalone'))
}

{
  // findAgentGroup resolves a real group by its URL slug, and never matches a standalone report
  const named = report({ agentName: 'Finance Ops / Agent' })
  const standalone = report({ agentName: null, fileName: 'agent.py' })
  const slug = agentGroupSlug('Finance Ops / Agent')
  const found = findAgentGroup([named, standalone], slug)
  assert.ok(found)
  assert.equal(found.agentName, 'Finance Ops / Agent')
  assert.equal(findAgentGroup([named, standalone], 'nonexistent-slug'), null)
}

console.log('comparisonAndGrouping.test.mjs: all assertions passed')
