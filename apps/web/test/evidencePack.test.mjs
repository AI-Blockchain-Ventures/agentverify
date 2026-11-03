// Evidence pack: EU AI Act / ISO 42001 mapping stays honest, CSV is formula-safe, and the .zip is valid.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inflateRawSync } from 'node:zlib'
import { buildSync } from 'esbuild'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(__dirname, '.build')
mkdirSync(outDir, { recursive: true })
const outfile = path.join(outDir, 'evidencePack.mjs')
buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'lib', 'evidencePack.ts')], bundle: true, format: 'esm', platform: 'node', outfile, alias: { '@': path.join(__dirname, '..', 'src') }, logLevel: 'error' })
const { buildRegulatoryMapping, buildEvidencePack, toCsv, makeZip } = await import(pathToFileURL(outfile).href)

const cat = (id, status) => ({ id, label: id, findingCount: 0, highestSeverity: null, status })
const ALL = ['identity', 'permissions', 'tools', 'mcp', 'execution-authorization', 'secrets', 'runtime', 'network', 'dependencies', 'auditability', 'human-oversight']

// 1. Mapping ---------------------------------------------------------------------------------------
{
  const finding = { id: 'f1', code: 'NO_HUMAN_APPROVAL', title: 'No human approval', severity: 'high', securityCategory: 'human-oversight', whatIsWrong: 'w', whyItMatters: 'y', recommendedFix: '', category: 'B' }
  const rows = buildRegulatoryMapping({ findings: [finding], securityCategories: ALL.map(id => cat(id, id === 'human-oversight' ? 'critical' : id === 'auditability' ? 'strong' : 'not_assessed')), criticalCount: 0, highCount: 1, scannedAt: '2026-10-30T10:00:00Z' })
  const get = id => rows.find(r => r.controlId === id && r.framework === 'EU_AI_ACT')
  assert.equal(get('Article 14').status, 'GAP_IDENTIFIED')
  assert.deepEqual(get('Article 14').supportingFindingIds, ['f1'])
  assert.equal(get('Article 12').status, 'EVIDENCE_OBSERVED')
  assert.equal(get('Article 12').confidence, 'medium', 'clean-category evidence is never high confidence')
  assert.equal(get('Article 15').status, 'NOT_ASSESSED', 'partial coverage is not evidence')
  assert.equal(get('Article 9').status, 'EVIDENCE_OBSERVED')
  assert.match(get('Article 9').explanation, /1 high findings remain open/)
  for (const r of rows) assert.doesNotMatch(`${r.status} ${r.explanation}`, /\bcompliant\b|certified/i, 'never claims compliance')
  console.log('✓ EU AI Act / ISO 42001 mapping: gaps trace to findings, evidence is medium confidence, partial = not assessed')
}

// 2. CSV is safe in spreadsheets --------------------------------------------------------------------
{
  const csv = toCsv([['a', '=HYPERLINK("x")', '+1', '-2', '@cmd', 'he said "hi"']])
  assert.equal(csv, '"a","\'=HYPERLINK(""x"")","\'+1","\'-2","\'@cmd","he said ""hi"""\r\n')
  console.log('✓ CSV quotes every cell and neutralises formulas')
}

// 3. Zip is valid and contains every file -----------------------------------------------------------
{
  const zip = makeZip([{ name: 'a.txt', content: 'hello' }, { name: 'b/c.md', content: '# hi ✓' }], new Date('2026-10-30T10:00:00'))
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  assert.equal(view.getUint32(0, true), 0x04034b50)
  const endAt = zip.length - 22
  assert.equal(view.getUint32(endAt, true), 0x06054b50)
  assert.equal(view.getUint16(endAt + 10, true), 2)
  // Read the first entry back.
  const nameLen = view.getUint16(26, true)
  const size = view.getUint32(18, true)
  const data = zip.slice(30 + nameLen, 30 + nameLen + size)
  assert.equal(new TextDecoder().decode(data), 'hello')
  assert.ok(inflateRawSync instanceof Function)
  console.log('✓ zip has local headers, central directory, and readable entries')
}

// 4. Whole pack -------------------------------------------------------------------------------------
{
  const report = {
    reportId: 'REPORT-1', verdictLabel: 'NOT VERIFIED', riskScore: 40, fileName: 'agent.py', scannedAt: '2026-10-30T10:00:00Z',
    criticalCount: 1, highCount: 0, mediumCount: 0, lowCount: 0, reportInsights: { topBlocker: 'SQL injection' },
    findings: [{ id: 'f1', code: 'SQL_INJECTION_RISK', title: 'SQL built from user input', severity: 'critical', securityCategory: 'tools', whatIsWrong: '=cmd()', line: 4, compliance: { owasp: ['LLM02'], nist: ['MG-2.2'], soc2: ['CC6.1'] } }],
    securityCategories: ALL.map(id => cat(id, id === 'tools' ? 'critical' : 'not_assessed')),
  }
  const { fileName, bytes } = buildEvidencePack(report, { reportHash: 'abc123', verifyUrl: 'https://x/verify/?id=REPORT-1', generatedAt: new Date('2026-10-30T12:00:00Z') })
  assert.equal(fileName, 'agentverify-evidence-agent.py-2026-10-30.zip')
  const text = new TextDecoder().decode(bytes)
  for (const name of ['README.txt', 'summary.md', 'controls.csv', 'findings.csv', 'report.json', 'VERIFY.txt']) assert.ok(text.includes(name), `${name} in the zip`)
  assert.match(text, /## EU AI Act/)
  assert.match(text, /Article 15 — Accuracy, robustness and cybersecurity \| Gap identified/)
  assert.match(text, /abc123/)
  assert.match(text, /"'=cmd\(\)"/, 'finding text is formula-safe in findings.csv')
  console.log('✓ evidence pack contains summary, control tables, findings, report and verification steps')
}
