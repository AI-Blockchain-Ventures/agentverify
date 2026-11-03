/**
 * `agentverify mcp` — an MCP server (stdio) so AI coding tools (Claude Code, Cursor, VS Code, Windsurf…) can
 * scan an agent while you build it. Speaks newline-delimited JSON-RPC 2.0 on stdin/stdout.
 * Nothing but protocol messages may be written to stdout; diagnostics go to stderr.
 */
import { createInterface } from 'readline'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { scan } from './sdk'
import type { Finding, ScanResult } from './types'
import { combineFiles, existingMcpConfigs, extractMcpServers, locateLine, pickFiles, redactMcpSecrets, type PickedFile } from './files'

const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']
const PRICING_URL = 'https://aimodularity.com/agentverify/pricing/'
const DASHBOARD_URL = 'https://aimodularity.com/agentverify/dashboard/'

export interface McpOptions {
  version: string
  apiKey: string
  apiUrl: string
  cwd?: string
  /** Injected in tests. */
  scanFn?: typeof scan
}

interface Tool {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
}

export const TOOLS: Tool[] = [
  {
    name: 'scan_path',
    title: 'Scan agent files',
    description:
      'Scan an AI agent for security risks before it is deployed: dangerous tool permissions, prompt injection paths, exposed secrets, ' +
      'risky MCP servers, missing approval gates, SQL/SSRF/code-execution risks, and framework-specific issues (LangChain, CrewAI, AutoGen, ' +
      'OpenAI Agents SDK, Claude Agent SDK). Give a file or a folder; a folder is scanned as one report using the most important agent ' +
      'files (up to 60 files / 5MB). Returns a verdict, a 0-100 security score (higher is safer) and findings with file and line.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File or folder to scan. Relative paths are resolved from the current project.' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'scan_code',
    title: 'Scan agent code',
    description:
      'Scan a snippet of agent code, a tool definition, a system prompt or an MCP config for security risks. Use this for code that is not ' +
      'saved to a file yet. Returns a verdict, a security score and findings.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The code or config to scan.' },
        fileName: { type: 'string', description: 'A file name with the right extension (e.g. agent.py, mcp.json) so the language is detected.' },
      },
      required: ['content'],
      additionalProperties: false,
    },
  },
  {
    name: 'scan_mcp_config',
    title: 'Check my MCP servers',
    description:
      'Check the MCP servers configured on this computer (Claude Code, Claude Desktop, Cursor, VS Code, Windsurf) for risks such as broad ' +
      'filesystem access, unpinned packages, remote servers without auth, auto-approved tools and API keys stored in plain text. Only the ' +
      'server definitions are read, and secret values are masked on this computer before anything is sent.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Optional: a specific MCP config file. Leave empty to check all known locations.' } },
      additionalProperties: false,
    },
  },
]

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const SEVERITY_LABEL: Record<string, string> = { critical: 'CRITICAL', high: 'HIGH', medium: 'MEDIUM', low: 'LOW' }

function verdictLine(result: ScanResult): string {
  const verdict = result.verdict === 'VERIFIED' ? 'VERIFIED' : result.verdict === 'NOT_ASSESSED' ? 'NOT ASSESSED' : 'NOT VERIFIED'
  return `**Verdict: ${verdict}** — Security score ${result.riskScore}/100 (higher is safer, ${result.riskLevel})`
}

function fixText(f: Finding): string | null {
  if (f.fixLocked) return `Fix: included with Agent Verify Pro (${PRICING_URL})`
  const steps = (f.recommendedFix ?? '').trim()
  const code = (f.quickFix ?? f.fixCode ?? '').trim()
  if (!steps && !code) return null
  return [steps ? `Fix: ${steps}` : '', code ? '```\n' + code + '\n```' : ''].filter(Boolean).join('\n')
}

/** Plain-text report for the AI tool to read and act on. */
export function formatReport(result: ScanResult, opts: { title: string; files?: PickedFile[]; notes?: string[] }): string {
  const findings = [...(result.findings ?? [])].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))
  const counts = ['critical', 'high', 'medium', 'low'].map(s => [s, findings.filter(f => f.severity === s).length] as const).filter(([, n]) => n > 0)
  const lines: string[] = [`# Agent Verify: ${opts.title}`, '', verdictLine(result)]
  lines.push(findings.length ? `Findings: ${counts.map(([s, n]) => `${n} ${s}`).join(', ')}` : 'No findings.')
  if (result.reportInsights?.topBlocker) lines.push(`Fix first: ${result.reportInsights.topBlocker}`)
  for (const note of opts.notes ?? []) lines.push(`Note: ${note}`)
  findings.forEach((f, i) => {
    const where = typeof f.line === 'number' && f.line > 0
      ? opts.files ? locateLine(opts.files, f.line) : { path: opts.title, line: f.line }
      : null
    lines.push('', `## ${i + 1}. [${SEVERITY_LABEL[f.severity] ?? f.severity}] ${f.title} (${f.code})`)
    if (where) lines.push(`Location: ${where.path}:${where.line}`)
    if (f.evidence) lines.push(`Evidence: ${f.evidence}`)
    lines.push(`What is wrong: ${f.whatIsWrong}`)
    if (f.whyItMatters) lines.push(`Why it matters: ${f.whyItMatters}`)
    const fix = fixText(f)
    if (fix) lines.push(fix)
  })
  const locked = findings.filter(f => f.fixLocked).length
  if (locked > 0) lines.push('', `Step-by-step fixes and corrected code for ${locked} finding(s) are included with Pro: ${PRICING_URL}`)
  if (result.reportUrl) lines.push('', `Full report: ${result.reportUrl}`)
  lines.push('', 'Agent Verify is an automated, evidence-based check, not a guarantee. Re-scan after making changes.')
  return lines.join('\n')
}

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean; structuredContent?: Record<string, unknown> }

function textResult(text: string, isError = false, structured?: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}), ...(structured ? { structuredContent: structured } : {}) }
}

function summary(result: ScanResult): Record<string, unknown> {
  return {
    verdict: result.verdict,
    securityScore: result.riskScore,
    riskLevel: result.riskLevel,
    findings: (result.findings ?? []).map(f => ({ code: f.code, severity: f.severity, title: f.title, line: f.line ?? null })),
    reportUrl: result.reportUrl ?? null,
  }
}

export async function callTool(name: string, args: Record<string, unknown>, opts: McpOptions): Promise<ToolResult> {
  const tool = TOOLS.find(t => t.name === name)
  if (!tool) return textResult(`Unknown tool: ${name}`, true)
  if (!opts.apiKey) {
    return textResult(
      'Agent Verify needs an API key. Create a free one in the dashboard (API / CLI tab): ' + DASHBOARD_URL +
      '\nThen set AGENTVERIFY_API_KEY in this MCP server\'s environment and restart it.',
      true,
    )
  }
  const doScan = opts.scanFn ?? scan
  const cwd = opts.cwd ?? process.cwd()
  try {
    if (name === 'scan_code') {
      const content = typeof args.content === 'string' ? args.content : ''
      if (!content.trim()) return textResult('Nothing to scan: "content" is empty.', true)
      const fileName = typeof args.fileName === 'string' && args.fileName.trim() ? args.fileName.trim() : 'agent'
      const result = await doScan({ content, fileName, platform: 'MCP' }, { apiKey: opts.apiKey, apiUrl: opts.apiUrl })
      return textResult(formatReport(result, { title: fileName }), false, summary(result))
    }
    if (name === 'scan_path') {
      const raw = typeof args.path === 'string' ? args.path.trim() : ''
      if (!raw) return textResult('Give a file or folder "path" to scan.', true)
      const target = resolve(cwd, raw)
      const picked = pickFiles(target)
      const fileName = picked.files.length === 1 ? picked.files[0].path : `${raw.replace(/[\\/]+$/, '') || 'project'} (${picked.files.length} files)`
      const result = await doScan({ content: combineFiles(picked.files), fileName, platform: 'MCP' }, { apiKey: opts.apiKey, apiUrl: opts.apiUrl })
      const notes = [...picked.notes]
      if (picked.files.length > 1) notes.unshift(`Scanned ${picked.files.length} files together as one report.`)
      return textResult(formatReport(result, { title: fileName, files: picked.files, notes }), false, summary(result))
    }
    // scan_mcp_config
    const explicit = typeof args.path === 'string' && args.path.trim() ? resolve(cwd, args.path.trim()) : ''
    const configs = explicit ? [{ client: 'Config file', path: explicit }] : existingMcpConfigs(cwd)
    if (configs.length === 0) return textResult('No MCP config files were found in the usual places (Claude Code, Claude Desktop, Cursor, VS Code, Windsurf). Pass a "path" to check a specific file.')
    const servers: Record<string, unknown> = {}
    const read: string[] = []
    for (const cfg of configs) {
      let rawText = ''
      try {
        rawText = readFileSync(cfg.path, 'utf8')
      } catch {
        continue
      }
      const found = extractMcpServers(rawText)
      if (!found) continue
      read.push(`${cfg.client}: ${Object.keys(found).length} server(s)`)
      for (const [server, def] of Object.entries(found)) servers[`${cfg.client} › ${server}`] = def
    }
    if (Object.keys(servers).length === 0) return textResult(`Found ${configs.length} config file(s), but none of them define any MCP servers.`)
    const content = JSON.stringify({ mcpServers: redactMcpSecrets(servers) }, null, 2)
    const result = await doScan({ content, fileName: 'mcp.json', platform: 'MCP' }, { apiKey: opts.apiKey, apiUrl: opts.apiUrl })
    return textResult(
      formatReport(result, { title: `MCP servers (${Object.keys(servers).length})`, notes: [`Checked: ${read.join('; ')}`, 'Secret values were masked on this computer before scanning.'] }),
      false,
      summary(result),
    )
  } catch (err) {
    return textResult(`Scan failed: ${err instanceof Error ? err.message : String(err)}`, true)
  }
}

type JsonRpcId = string | number | null
interface JsonRpcRequest { jsonrpc?: string; id?: JsonRpcId; method?: string; params?: Record<string, unknown> }

/** Handle one JSON-RPC message. Returns the response, or null for notifications. */
export async function handleMessage(msg: JsonRpcRequest, opts: McpOptions): Promise<Record<string, unknown> | null> {
  const isNotification = msg.id === undefined || msg.id === null
  const reply = (result: unknown) => (isNotification ? null : { jsonrpc: '2.0', id: msg.id, result })
  const fail = (code: number, message: string) => (isNotification ? null : { jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } })
  switch (msg.method) {
    case 'initialize': {
      const requested = typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : ''
      return reply({
        protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'agentverify', title: 'Agent Verify', version: opts.version },
        instructions:
          'Use Agent Verify to check AI agent code, tools, prompts and MCP configs for security risks before deploying. ' +
          'Run scan_path on the agent folder after making changes, and fix critical and high findings first.',
      })
    }
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({ tools: TOOLS })
    case 'tools/call': {
      const name = typeof msg.params?.name === 'string' ? msg.params.name : ''
      const args = (msg.params?.arguments && typeof msg.params.arguments === 'object' ? msg.params.arguments : {}) as Record<string, unknown>
      return reply(await callTool(name, args, opts))
    }
    case 'resources/list':
      return reply({ resources: [] })
    case 'prompts/list':
      return reply({ prompts: [] })
    default:
      if (typeof msg.method === 'string' && msg.method.startsWith('notifications/')) return null
      return fail(-32601, `Method not found: ${msg.method}`)
  }
}

export function runMcpServer(opts: McpOptions): Promise<void> {
  return new Promise(done => {
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
    const send = (obj: unknown) => process.stdout.write(JSON.stringify(obj) + '\n')
    let pending = 0
    let closed = false
    const maybeDone = () => { if (closed && pending === 0) done() }
    rl.on('line', line => {
      const text = line.trim()
      if (!text) return
      let msg: JsonRpcRequest
      try {
        msg = JSON.parse(text)
      } catch {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
        return
      }
      pending++
      handleMessage(msg, opts)
        .then(res => { if (res) send(res) })
        .catch(err => send({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32603, message: err instanceof Error ? err.message : 'Internal error' } }))
        .finally(() => { pending--; maybeDone() })
    })
    rl.on('close', () => { closed = true; maybeDone() })
    process.stderr.write(`Agent Verify MCP server ${opts.version} ready${opts.apiKey ? '' : ' (no API key set: tools will explain how to add one)'}\n`)
  })
}
