/**
 * Compliance evidence pack: EU AI Act + ISO/IEC 42001 control mapping and a downloadable .zip for auditors.
 *
 * Same honesty rules as complianceMapping.ts: every row is GAP_IDENTIFIED (traced to real findings), EVIDENCE_OBSERVED
 * (narrow, documented inference — always medium confidence) or NOT_ASSESSED. Never "compliant" or "certified".
 * Pure functions — no browser APIs — so it is unit tested in Node.
 */
import type { Finding, SecurityCategoryId } from '@/types'
import type { NormalizedReport } from './normalizeReport'
import { buildComplianceMapping, type ComplianceStatus } from './complianceMapping'

export type RegulatoryFramework = 'EU_AI_ACT' | 'ISO_42001'

export interface RegulatoryControl {
  framework: RegulatoryFramework
  controlId: string
  title: string
  status: ComplianceStatus
  confidence: 'high' | 'medium' | 'low'
  explanation: string
  supportingFindingIds: string[]
}

interface Rule {
  framework: RegulatoryFramework
  controlId: string
  title: string
  /** Scan categories this control draws evidence from. 'assessment' = this report itself is the evidence. */
  categories: SecurityCategoryId[] | 'assessment'
  what: string
}

const RULES: Rule[] = [
  { framework: 'EU_AI_ACT', controlId: 'Article 9', title: 'Risk management system', categories: 'assessment', what: 'a documented, repeatable pre-deployment risk assessment of the agent' },
  { framework: 'EU_AI_ACT', controlId: 'Article 12', title: 'Record-keeping (logging)', categories: ['auditability'], what: 'automatic logging of the agent’s actions' },
  { framework: 'EU_AI_ACT', controlId: 'Article 14', title: 'Human oversight', categories: ['human-oversight', 'permissions'], what: 'human approval for consequential actions and scoped permissions' },
  { framework: 'EU_AI_ACT', controlId: 'Article 15', title: 'Accuracy, robustness and cybersecurity', categories: ['tools', 'mcp', 'runtime', 'network', 'dependencies', 'secrets', 'identity', 'execution-authorization'], what: 'resistance to misuse: tool, MCP, runtime, network, dependency, secret and identity controls' },
  { framework: 'ISO_42001', controlId: 'Clause 6.1.2', title: 'AI risk assessment', categories: 'assessment', what: 'an AI risk assessment covering the agent’s capabilities and threats' },
  { framework: 'ISO_42001', controlId: 'Clause 6.1.3', title: 'AI risk treatment', categories: ['tools', 'mcp', 'runtime', 'network', 'dependencies', 'secrets', 'identity', 'execution-authorization', 'human-oversight', 'permissions', 'auditability'], what: 'treatment of the risks the assessment identified' },
  { framework: 'ISO_42001', controlId: 'Clause 9.1', title: 'Monitoring, measurement, analysis and evaluation', categories: ['auditability'], what: 'logging and monitoring of the agent in operation' },
]

export function buildRegulatoryMapping(data: Pick<NormalizedReport, 'findings' | 'securityCategories' | 'criticalCount' | 'highCount' | 'scannedAt'>): RegulatoryControl[] {
  const categories = new Map(data.securityCategories.map(c => [c.id, c]))
  return RULES.map(rule => {
    if (rule.categories === 'assessment') {
      return {
        framework: rule.framework, controlId: rule.controlId, title: rule.title, status: 'EVIDENCE_OBSERVED' as const, confidence: 'medium' as const,
        supportingFindingIds: [],
        explanation: `This report is evidence of ${rule.what}, performed ${data.scannedAt ? `on ${data.scannedAt.slice(0, 10)}` : 'at scan time'}. It shows the assessment happened, not that every risk is resolved${data.criticalCount + data.highCount ? ` — ${data.criticalCount} critical and ${data.highCount} high findings remain open` : ''}.`,
      }
    }
    const cats = rule.categories.map(id => categories.get(id)).filter(Boolean) as Array<{ id: SecurityCategoryId; status: string }>
    const relevant = data.findings.filter((f: Finding) => f.securityCategory && (rule.categories as SecurityCategoryId[]).includes(f.securityCategory))
    const serious = relevant.filter(f => f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium')
    if (serious.length > 0 || cats.some(c => c.status === 'critical' || c.status === 'needs_attention')) {
      return {
        framework: rule.framework, controlId: rule.controlId, title: rule.title, status: 'GAP_IDENTIFIED' as const, confidence: 'high' as const,
        supportingFindingIds: (serious.length ? serious : relevant).map(f => f.id),
        explanation: `Findings in this scan show gaps in ${rule.what}.`,
      }
    }
    if (cats.length === rule.categories.length && cats.every(c => c.status === 'strong')) {
      return {
        framework: rule.framework, controlId: rule.controlId, title: rule.title, status: 'EVIDENCE_OBSERVED' as const, confidence: 'medium' as const,
        supportingFindingIds: [],
        explanation: `Every check for ${rule.what} ran and found nothing wrong. A clean static scan is supporting evidence, not proof.`,
      }
    }
    return {
      framework: rule.framework, controlId: rule.controlId, title: rule.title, status: 'NOT_ASSESSED' as const, confidence: 'low' as const,
      supportingFindingIds: [],
      explanation: `This scan produced no evidence either way about ${rule.what}. That is not the same as meeting it.`,
    }
  })
}

// ── CSV + zip (STORE, no compression) — enough for a small evidence bundle, no dependencies ──

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v)
    // Neutralise spreadsheet formulas (CSV injection) and quote everything.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
    return `"${safe.replace(/"/g, '""')}"`
  }
  return rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

let crcTable: Uint32Array | null = null
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export function makeZip(files: Array<{ name: string; content: string }>, date = new Date()): Uint8Array {
  const enc = new TextEncoder()
  const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)) & 0xffff
  const dosDate = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const data = enc.encode(f.content)
    const crc = crc32(data)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true)
    lv.setUint16(10, dosTime, true); lv.setUint16(12, dosDate, true); lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true)
    local.set(name, 30)
    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true)
    cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true); cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    locals.push(local, data)
    centrals.push(central)
    offset += local.length + data.length
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true)
  const out = new Uint8Array(offset + centralSize + 22)
  let p = 0
  for (const part of [...locals, ...centrals, end]) { out.set(part, p); p += part.length }
  return out
}

const STATUS_LABEL: Record<ComplianceStatus, string> = {
  GAP_IDENTIFIED: 'Gap identified', EVIDENCE_OBSERVED: 'Evidence observed', NOT_ASSESSED: 'Not assessed', NOT_APPLICABLE: 'Not applicable',
}
const FRAMEWORK_LABEL: Record<string, string> = {
  OWASP_LLM: 'OWASP LLM Top 10', NIST_AI_RMF: 'NIST AI RMF', SOC2: 'SOC 2', EU_AI_ACT: 'EU AI Act', ISO_42001: 'ISO/IEC 42001',
}

export interface EvidencePackMeta {
  reportUrl?: string | null
  verifyUrl?: string | null
  reportHash?: string | null
  generatedAt?: Date
  /** Raw report object for report.json (falls back to the normalized report). */
  raw?: unknown
}

export function buildEvidencePack(data: NormalizedReport, meta: EvidencePackMeta = {}): { fileName: string; bytes: Uint8Array } {
  const now = meta.generatedAt ?? new Date()
  const base = buildComplianceMapping(data.findings, data.securityCategories)
  const regulatory = buildRegulatoryMapping(data)
  const titles = new Map(data.findings.map(f => [f.id, f.title]))
  const allRows = [
    ...base.map(r => ({ framework: r.framework as string, controlId: r.controlId, title: '', status: r.status, confidence: r.confidence, explanation: r.explanation, ids: r.supportingFindingIds })),
    ...regulatory.map(r => ({ framework: r.framework as string, controlId: r.controlId, title: r.title, status: r.status, confidence: r.confidence, explanation: r.explanation, ids: r.supportingFindingIds })),
  ]
  const controlsCsv = toCsv([
    ['Framework', 'Control', 'Title', 'Status', 'Confidence', 'Evidence', 'Supporting findings'],
    ...allRows.map(r => [FRAMEWORK_LABEL[r.framework] ?? r.framework, r.controlId, r.title, STATUS_LABEL[r.status], r.confidence, r.explanation, r.ids.map(id => titles.get(id) ?? id).join('; ')]),
  ])
  const findingsCsv = toCsv([
    ['ID', 'Code', 'Severity', 'Title', 'Line', 'Category', 'What is wrong', 'OWASP LLM', 'NIST AI RMF', 'SOC 2'],
    ...data.findings.map(f => [f.id, f.code, f.severity, f.title, f.line ?? '', f.securityCategory ?? '', f.whatIsWrong, (f.compliance?.owasp ?? []).join('; '), (f.compliance?.nist ?? []).join('; '), (f.compliance?.soc2 ?? []).join('; ')]),
  ])
  const table = (rows: typeof allRows) => ['| Control | Status | Confidence | Evidence |', '|---|---|---|---|', ...rows.map(r => `| ${r.controlId}${r.title ? ` — ${r.title}` : ''} | ${STATUS_LABEL[r.status]} | ${r.confidence} | ${r.explanation.replace(/\|/g, '/')} |`)].join('\n')
  const frameworks = ['EU_AI_ACT', 'ISO_42001', 'OWASP_LLM', 'NIST_AI_RMF', 'SOC2']
  const summary = [
    `# Agent Verify evidence pack — ${data.fileName}`,
    '',
    `Generated ${now.toISOString()} from report ${data.reportId || '(unsaved)'} (scanned ${data.scannedAt}).`,
    '',
    '## Result',
    '',
    `- Verdict: **${data.verdictLabel}**`,
    `- Security score: **${data.riskScore}/100** (higher is safer)`,
    `- Findings: ${data.criticalCount} critical, ${data.highCount} high, ${data.mediumCount} medium, ${data.lowCount} low`,
    data.reportInsights?.topBlocker ? `- Fix first: ${data.reportInsights.topBlocker}` : '',
    '',
    '## How to read this pack',
    '',
    'Every control is **Evidence observed**, **Gap identified** or **Not assessed** — never "compliant" or "certified".',
    'A gap traces to specific findings in this scan. Evidence observed is a narrow, documented inference (medium confidence).',
    'Not assessed means this scan produced no evidence either way. This pack supports an audit; it does not replace one.',
    '',
    ...frameworks.flatMap(fw => {
      const rows = allRows.filter(r => r.framework === fw)
      return rows.length ? [`## ${FRAMEWORK_LABEL[fw]}`, '', table(rows), ''] : [`## ${FRAMEWORK_LABEL[fw]}`, '', 'Not assessed — no control in this framework was touched by this scan.', '']
    }),
    '## Files',
    '',
    '- `summary.md` — this document',
    '- `controls.csv` — every control row, for spreadsheets and GRC tools',
    '- `findings.csv` — every finding with its framework citations',
    '- `report.json` — the full machine-readable report',
    '- `VERIFY.txt` — how to confirm this report has not been altered',
  ].filter(l => l !== undefined).join('\n')
  const verify = [
    'How to verify this report',
    '',
    meta.verifyUrl ? `1. Open ${meta.verifyUrl} — it shows the verdict and integrity hash stored by Agent Verify.` : '1. Open the report link in Agent Verify (Verify tab) to see the stored verdict and integrity hash.',
    meta.reportHash ? `2. Compare the integrity hash there with this one: ${meta.reportHash}` : '2. Compare the integrity hash shown there with the one in report.json (reportIntegrity.reportHash).',
    '3. If the report was signed, the signature can be checked against the public key published at https://aimodularity.com/agentverify/profile-attestation/.',
    '',
    meta.reportUrl ? `Report: ${meta.reportUrl}` : '',
  ].join('\n')
  const readme = 'Agent Verify evidence pack. Start with summary.md. Generated by Agent Verify (aimodularity.com/agentverify). Automated, evidence-based check — not a certification.\n'
  const safeName = (data.fileName || 'agent').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60)
  const bytes = makeZip([
    { name: 'README.txt', content: readme },
    { name: 'summary.md', content: summary },
    { name: 'controls.csv', content: controlsCsv },
    { name: 'findings.csv', content: findingsCsv },
    { name: 'report.json', content: JSON.stringify(meta.raw ?? data, null, 2) },
    { name: 'VERIFY.txt', content: verify },
  ], now)
  return { fileName: `agentverify-evidence-${safeName}-${now.toISOString().slice(0, 10)}.zip`, bytes }
}
