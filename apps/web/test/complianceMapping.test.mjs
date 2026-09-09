// Unit tests for the compliance evidence-mapping engine (src/lib/complianceMapping.ts). Pure
// logic, no Firebase/React needed — transpiled with esbuild and imported directly, same pattern
// as this repo's other apps/web/test/*.test.mjs files.
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

const { buildComplianceMapping, notAssessedControls } = await loadTsModule('complianceMapping.ts')

const finding = (overrides = {}) => ({
  id: 'f1', code: 'HARDCODED_CREDENTIALS', title: 'Hardcoded credentials', category: 'B', severity: 'critical',
  whatIsWrong: 'x', whyItMatters: 'x', recommendedFix: 'x',
  ...overrides,
})

// --- Core: a control cited by a real, firing finding is GAP_IDENTIFIED, with real evidence ---
{
  const findings = [finding({ compliance: { owasp: ['LLM06 - Sensitive Information Disclosure'] } })]
  const mapping = buildComplianceMapping(findings, [])
  assert.equal(mapping.length, 1)
  assert.equal(mapping[0].status, 'GAP_IDENTIFIED')
  assert.deepEqual(mapping[0].supportingFindingIds, ['f1'])
  assert.equal(mapping[0].confidence, 'high')
  console.log('✓ a real firing finding produces a real GAP_IDENTIFIED control mapping')
}

// --- The core anti-fake-satisfaction guarantee: merely mentioning a tag string that happens to
// equal a real control ID, on a finding that has NOTHING to do with that control's category, still
// produces GAP_IDENTIFIED (correct — a real finding fired and cited it) but NEVER EVIDENCE_OBSERVED
// for that same control from unrelated category strength. Two independent facts can't leak into
// each other. ---
{
  const findings = [finding({ securityCategory: 'secrets', compliance: { soc2: ['CC6.1 - Logical Access Controls'] } })]
  // A totally unrelated category ('mcp') being 'strong' must NEVER produce EVIDENCE_OBSERVED for
  // 'CC6.1' just because the string exists somewhere in the STRONG_CATEGORY_EVIDENCE table for a
  // DIFFERENT category — this proves the category check is the real gate, not string matching.
  const categories = [{ id: 'mcp', label: 'MCP', findingCount: 0, highestSeverity: null, status: 'strong' }]
  const mapping = buildComplianceMapping(findings, categories)
  const cc61 = mapping.find(m => m.controlId === 'CC6.1 - Logical Access Controls')
  assert.equal(cc61.status, 'GAP_IDENTIFIED', 'the real firing finding still wins')
  assert.equal(mapping.length, 1, 'no extra EVIDENCE_OBSERVED row was fabricated for an unrelated strong category')
  console.log('✓ an unrelated strong category never fabricates evidence for a different control')
}

// --- THE key requirement: a control cannot become satisfied merely because a tag/string exists
// with no real backing evidence. No findings, no strong categories -> NO mapping rows at all,
// specifically never a fabricated EVIDENCE_OBSERVED or GAP_IDENTIFIED. ---
{
  const mapping = buildComplianceMapping([], [])
  assert.deepEqual(mapping, [], 'zero findings and zero category evidence produces zero asserted controls — nothing is invented from nothing')
  console.log('✓ no evidence in, no control mapping out — nothing is fabricated from nothing')
}

// --- A 'needs_attention' or 'critical' category status (real evidence of a PROBLEM) must never be
// misread as EVIDENCE_OBSERVED — only 'strong' (real evidence NOTHING was found wrong) qualifies. ---
{
  const categories = [{ id: 'secrets', label: 'Secrets', findingCount: 1, highestSeverity: 'critical', status: 'critical' }]
  const mapping = buildComplianceMapping([], categories)
  assert.deepEqual(mapping, [], 'a critical (not strong) category status must never produce a fabricated EVIDENCE_OBSERVED row')
  console.log('✓ only a genuinely strong category can ever produce EVIDENCE_OBSERVED, never a critical/needs_attention one')
}

// --- A real 'strong' category DOES produce a real, documented EVIDENCE_OBSERVED — with a
// rationale attached, confidence explicitly 'medium' (never 'high' — a clean scan is not a
// guarantee), and it is a DIFFERENT status/confidence shape than GAP_IDENTIFIED. ---
{
  const categories = [{ id: 'secrets', label: 'Secrets', findingCount: 0, highestSeverity: null, status: 'strong' }]
  const mapping = buildComplianceMapping([], categories)
  assert.ok(mapping.length > 0)
  for (const m of mapping) {
    assert.equal(m.status, 'EVIDENCE_OBSERVED')
    assert.equal(m.confidence, 'medium', 'EVIDENCE_OBSERVED must never claim high confidence — a clean static scan is not a guarantee')
    assert.ok(m.explanation.length > 20, 'a real, non-trivial rationale must be attached')
    assert.deepEqual(m.supportingFindingIds, [], 'EVIDENCE_OBSERVED has no firing finding to cite by definition')
  }
  console.log('✓ a genuinely strong category produces a real, documented, appropriately-lower-confidence EVIDENCE_OBSERVED')
}

// --- A firing finding for a control always wins over a strong-category inference for that SAME
// control — you can never be both a demonstrated gap and demonstrated-clean for one control. ---
{
  const findings = [finding({ compliance: { soc2: ['CC6.1 - Logical Access Controls'] } })]
  const categories = [{ id: 'secrets', label: 'Secrets', findingCount: 1, highestSeverity: 'critical', status: 'strong' }]
  const mapping = buildComplianceMapping(findings, categories)
  const cc61Rows = mapping.filter(m => m.controlId === 'CC6.1 - Logical Access Controls')
  assert.equal(cc61Rows.length, 1, 'a control never appears twice with contradictory statuses')
  assert.equal(cc61Rows[0].status, 'GAP_IDENTIFIED', 'a real firing finding always takes precedence over an inferred strong-category status')
  console.log('✓ a real gap always wins over an inferred clean-category status for the same control')
}

// --- Never "compliant"/"certified"/"passed" anywhere in the status vocabulary or any explanation ---
{
  const findings = [finding({ compliance: { owasp: ['LLM06 - Sensitive Information Disclosure'] } })]
  const categories = [{ id: 'secrets', label: 'Secrets', findingCount: 0, highestSeverity: null, status: 'strong' }]
  const mapping = buildComplianceMapping(findings, categories)
  const serialized = JSON.stringify(mapping).toLowerCase()
  for (const banned of ['compliant', 'certified', 'passed compliance']) {
    assert.ok(!serialized.includes(banned), `the word "${banned}" must never appear anywhere in a compliance mapping result`)
  }
  console.log('✓ no compliance mapping ever uses "compliant", "certified", or "passed compliance"')
}

// --- notAssessedControls: a real, known control this scan didn't touch is reported as such, never silently dropped ---
{
  const mapping = buildComplianceMapping([], [])
  const known = [{ framework: 'OWASP_LLM', controlId: 'LLM08 - Excessive Agency' }]
  const notAssessed = notAssessedControls(mapping, known)
  assert.equal(notAssessed.length, 1)
  assert.equal(notAssessed[0].status, 'NOT_ASSESSED')
  assert.equal(notAssessed[0].confidence, 'low')
  console.log('✓ a real, known control this scan never touched is honestly reported as NOT_ASSESSED, not omitted')
}

console.log('\ncomplianceMapping.test.mjs: all assertions passed')
