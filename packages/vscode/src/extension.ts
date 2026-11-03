import * as vscode from 'vscode'
import { basename, extname, join } from 'path'
import { scan } from '../../cli/src/sdk'
import type { ScanResult } from '../../cli/src/types'
import { combineFiles, pickFiles, type PickedFile } from '../../cli/src/files'
import { callTool, formatReport } from '../../cli/src/mcp'
import { mapFindings, statusText, SCANNABLE_LANGUAGE_EXTENSIONS, type Problem } from './mapping'
import { EXTENSION_VERSION } from './version'

const KEY_SECRET = 'agentverify.apiKey'
const DASHBOARD_URL = 'https://aimodularity.com/agentverify/dashboard/'
const PRICING_URL = 'https://aimodularity.com/agentverify/pricing/'
const DOCS_URL = 'https://aimodularity.com/agentverify/docs/#findings'

let diagnostics: vscode.DiagnosticCollection
let output: vscode.OutputChannel
let status: vscode.StatusBarItem
let lastReportUrl: string | null = null
/** Problem details by "uri#line#code", so quick fixes can show the fix text. */
const problemIndex = new Map<string, Problem>()
const saveTimers = new Map<string, NodeJS.Timeout>()

function apiUrl(): string {
  return vscode.workspace.getConfiguration('agentverify').get<string>('apiUrl') || 'https://agentverify-api.agentverify.workers.dev/v1/scan'
}

async function getKey(context: vscode.ExtensionContext, ask = true): Promise<string | undefined> {
  const stored = await context.secrets.get(KEY_SECRET)
  if (stored) return stored
  if (process.env.AGENTVERIFY_API_KEY) return process.env.AGENTVERIFY_API_KEY
  if (!ask) return undefined
  const choice = await vscode.window.showInformationMessage(
    'Agent Verify needs an API key to scan. A free account includes 10 scans a month.',
    'Enter API key',
    'Get a free key',
  )
  if (choice === 'Get a free key') void vscode.env.openExternal(vscode.Uri.parse(DASHBOARD_URL))
  if (choice === 'Enter API key') return setKey(context)
  return undefined
}

async function setKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  const key = await vscode.window.showInputBox({
    title: 'Agent Verify API key',
    prompt: 'Create one in the dashboard on the API / CLI tab. It is stored in VS Code\'s secure storage.',
    password: true,
    ignoreFocusOut: true,
    validateInput: v => (v.trim().startsWith('av_') ? null : 'Agent Verify keys start with av_'),
  })
  if (!key) return undefined
  await context.secrets.store(KEY_SECRET, key.trim())
  vscode.window.showInformationMessage('Agent Verify API key saved.')
  return key.trim()
}

function toVsSeverity(s: Problem['severity']): vscode.DiagnosticSeverity {
  return s === 'error' ? vscode.DiagnosticSeverity.Error : s === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information
}

function lineRange(doc: vscode.TextDocument | undefined, line: number): vscode.Range {
  if (!doc) return new vscode.Range(line, 0, line, 200)
  const safe = Math.min(line, Math.max(0, doc.lineCount - 1))
  const text = doc.lineAt(safe)
  return new vscode.Range(safe, text.firstNonWhitespaceCharacterIndex, safe, text.range.end.character)
}

async function publish(result: ScanResult, files: PickedFile[], root: vscode.Uri | null, single?: vscode.TextDocument) {
  const { problems, projectLevel } = mapFindings(result, files)
  const byFile = new Map<string, vscode.Diagnostic[]>()
  const uriFor = (p: string) => (single ? single.uri : vscode.Uri.file(join(root!.fsPath, p)))
  // Clear previous results for every file in this scan.
  for (const f of files) diagnostics.delete(uriFor(f.path))
  for (const p of problems) {
    const uri = uriFor(p.path)
    let doc = single
    if (!doc) {
      try {
        doc = await vscode.workspace.openTextDocument(uri)
      } catch {
        doc = undefined
      }
    }
    const d = new vscode.Diagnostic(lineRange(doc, p.line), p.message, toVsSeverity(p.severity))
    d.source = 'Agent Verify'
    d.code = { value: p.code, target: vscode.Uri.parse(DOCS_URL) }
    problemIndex.set(`${uri.toString()}#${p.line}#${p.code}`, p)
    const list = byFile.get(uri.toString()) ?? []
    list.push(d)
    byFile.set(uri.toString(), list)
  }
  for (const [uri, list] of byFile) diagnostics.set(vscode.Uri.parse(uri), list)
  lastReportUrl = result.reportUrl ?? null
  status.text = `$(shield) ${statusText(result)}`
  status.tooltip = `Agent Verify — ${result.verdict.replace('_', ' ')}, security score ${result.riskScore}/100 (higher is safer).${projectLevel.length ? ` ${projectLevel.length} project-wide finding(s) are in the Agent Verify output.` : ''} Click for the full report.`
  status.backgroundColor = result.riskScore < 50 ? new vscode.ThemeColor('statusBarItem.errorBackground') : result.riskScore < 80 ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined
  status.show()
  return { problems, projectLevel }
}

async function runScan(context: vscode.ExtensionContext, label: string, work: (key: string) => Promise<void>) {
  const key = await getKey(context)
  if (!key) return
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Agent Verify: scanning ${label}…` }, async () => {
    try {
      await work(key)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (/API key/i.test(message)) {
        const pick = await vscode.window.showErrorMessage(`Agent Verify: ${message}`, 'Enter API key')
        if (pick) await setKey(context)
      } else if (/429|quota/i.test(message)) {
        const pick = await vscode.window.showWarningMessage('Agent Verify: monthly scan limit reached. Pro includes 100 scans a month.', 'See Pro')
        if (pick) void vscode.env.openExternal(vscode.Uri.parse(PRICING_URL))
      } else {
        vscode.window.showErrorMessage(`Agent Verify: scan failed — ${message}`)
      }
    }
  })
}

function summarize(result: ScanResult, count: number) {
  const locked = (result.findings ?? []).filter(f => f.fixLocked).length
  const text = `Agent Verify: ${result.verdict.replace('_', ' ')} — security score ${result.riskScore}/100, ${count} issue${count === 1 ? '' : 's'}.`
  const actions = ['Show report', ...(locked ? ['Unlock fixes (Pro)'] : [])]
  void (result.riskScore < 50 ? vscode.window.showWarningMessage(text, ...actions) : vscode.window.showInformationMessage(text, ...actions)).then(pick => {
    if (pick === 'Show report') output.show(true)
    if (pick === 'Unlock fixes (Pro)') void vscode.env.openExternal(vscode.Uri.parse(PRICING_URL))
  })
}

async function scanDocument(context: vscode.ExtensionContext, doc: vscode.TextDocument, quiet = false) {
  const name = basename(doc.fileName)
  await runScan(context, name, async key => {
    const content = doc.getText()
    if (!content.trim()) throw new Error('this file is empty')
    const result = await scan({ content, fileName: name, platform: 'VS Code' }, { apiKey: key, apiUrl: apiUrl() })
    const files = [{ path: name, content }]
    await publish(result, files, null, doc)
    output.clear()
    output.appendLine(formatReport(result, { title: name, files }))
    if (!quiet) summarize(result, (result.findings ?? []).length)
  })
}

async function scanFolder(context: vscode.ExtensionContext, folder: vscode.Uri) {
  const label = basename(folder.fsPath) || 'project'
  await runScan(context, label, async key => {
    const picked = pickFiles(folder.fsPath)
    const fileName = `${label} (${picked.files.length} files)`
    const result = await scan({ content: combineFiles(picked.files), fileName, platform: 'VS Code' }, { apiKey: key, apiUrl: apiUrl() })
    const { projectLevel } = await publish(result, picked.files, folder)
    const notes = [...picked.notes, `Scanned ${picked.files.length} files together as one report.`]
    if (projectLevel.length) notes.push(`${projectLevel.length} finding(s) apply to the project as a whole and are listed below, not on a line.`)
    output.clear()
    output.appendLine(formatReport(result, { title: fileName, files: picked.files, notes }))
    summarize(result, (result.findings ?? []).length)
  })
}

class FixActions implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix]
  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = []
    for (const d of ctx.diagnostics) {
      if (d.source !== 'Agent Verify') continue
      const code = typeof d.code === 'object' ? String(d.code.value) : String(d.code)
      const p = problemIndex.get(`${doc.uri.toString()}#${d.range.start.line}#${code}`)
      if (!p) continue
      if (p.fixLocked) {
        const a = new vscode.CodeAction('Agent Verify: get the fix with Pro', vscode.CodeActionKind.QuickFix)
        a.command = { command: 'vscode.open', title: 'Pricing', arguments: [vscode.Uri.parse(PRICING_URL)] }
        a.diagnostics = [d]
        actions.push(a)
      } else if (p.fixSteps || p.fixCode) {
        const a = new vscode.CodeAction(`Agent Verify: show how to fix "${p.title}"`, vscode.CodeActionKind.QuickFix)
        a.command = { command: 'agentverify.showFix', title: 'Show fix', arguments: [p] }
        a.diagnostics = [d]
        a.isPreferred = true
        actions.push(a)
      }
    }
    return actions
  }
}

function registerMcpProvider(context: vscode.ExtensionContext) {
  // VS Code 1.101+: offer Agent Verify as an MCP server to Copilot/agent mode, using the key saved in this extension.
  const lm = (vscode as unknown as { lm?: { registerMcpServerDefinitionProvider?: Function } }).lm
  const Def = (vscode as unknown as { McpStdioServerDefinition?: new (...args: unknown[]) => unknown }).McpStdioServerDefinition
  if (!lm?.registerMcpServerDefinitionProvider || !Def) return
  const changed = new vscode.EventEmitter<void>()
  context.subscriptions.push(changed)
  context.subscriptions.push(context.secrets.onDidChange(e => { if (e.key === KEY_SECRET) changed.fire() }))
  const server = context.asAbsolutePath(join('dist', 'mcp-server.js'))
  context.subscriptions.push(
    lm.registerMcpServerDefinitionProvider('agentverify.mcp', {
      onDidChangeMcpServerDefinitions: changed.event,
      provideMcpServerDefinitions: async () => {
        const key = (await getKey(context, false)) ?? ''
        // Run the bundled server with VS Code's own Node runtime, so nothing has to be installed.
        return [new Def('Agent Verify', process.execPath, [server], { ELECTRON_RUN_AS_NODE: '1', AGENTVERIFY_API_KEY: key, AGENTVERIFY_API_URL: apiUrl() }, EXTENSION_VERSION)]
      },
      resolveMcpServerDefinition: async (def: unknown) => {
        if (!(await getKey(context, false))) await getKey(context, true)
        return def
      },
    }) as vscode.Disposable,
  )
}

export function activate(context: vscode.ExtensionContext) {
  diagnostics = vscode.languages.createDiagnosticCollection('agentverify')
  output = vscode.window.createOutputChannel('Agent Verify')
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50)
  status.command = 'agentverify.openReport'
  status.text = '$(shield) Agent Verify'
  status.tooltip = 'Scan this file with Agent Verify'
  context.subscriptions.push(diagnostics, output, status)

  const setButtonContext = () => void vscode.commands.executeCommand('setContext', 'agentverify.showEditorButton', vscode.workspace.getConfiguration('agentverify').get('showEditorButton', true))
  setButtonContext()

  context.subscriptions.push(
    vscode.commands.registerCommand('agentverify.scanFile', async (uri?: vscode.Uri) => {
      const doc = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document
      if (!doc) return vscode.window.showInformationMessage('Open an agent file first, then run "Agent Verify: Scan This File".')
      return scanDocument(context, doc)
    }),
    vscode.commands.registerCommand('agentverify.scanWorkspace', async (uri?: vscode.Uri) => {
      const folder = uri ?? vscode.workspace.workspaceFolders?.[0]?.uri
      if (!folder) return vscode.window.showInformationMessage('Open a folder first, then run "Agent Verify: Scan Project".')
      return scanFolder(context, folder)
    }),
    vscode.commands.registerCommand('agentverify.scanMcpConfig', async () => {
      const key = await getKey(context)
      if (!key) return
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      const res = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Agent Verify: checking your MCP servers…' }, () =>
        callTool('scan_mcp_config', {}, { version: EXTENSION_VERSION, apiKey: key, apiUrl: apiUrl(), cwd }),
      )
      output.clear()
      output.appendLine(res.content[0].text)
      output.show(true)
    }),
    vscode.commands.registerCommand('agentverify.setApiKey', () => setKey(context)),
    vscode.commands.registerCommand('agentverify.clearApiKey', async () => {
      await context.secrets.delete(KEY_SECRET)
      vscode.window.showInformationMessage('Agent Verify API key removed.')
    }),
    vscode.commands.registerCommand('agentverify.openReport', () => {
      if (lastReportUrl) return vscode.env.openExternal(vscode.Uri.parse(lastReportUrl))
      if (output) return output.show(true)
    }),
    vscode.commands.registerCommand('agentverify.clear', () => {
      diagnostics.clear()
      problemIndex.clear()
      status.text = '$(shield) Agent Verify'
      status.backgroundColor = undefined
    }),
    vscode.commands.registerCommand('agentverify.showFix', (p: Problem) => {
      output.clear()
      output.appendLine(`How to fix: ${p.title} (${p.code})`)
      if (p.fixSteps) output.appendLine(`\n${p.fixSteps}`)
      if (p.fixCode) output.appendLine(`\nExample:\n${p.fixCode}`)
      output.show(true)
    }),
    vscode.languages.registerCodeActionsProvider({ scheme: 'file' }, new FixActions(), { providedCodeActionKinds: FixActions.kinds }),
    vscode.workspace.onDidSaveTextDocument(doc => {
      if (!vscode.workspace.getConfiguration('agentverify').get('scanOnSave', false)) return
      if (!SCANNABLE_LANGUAGE_EXTENSIONS.includes(extname(doc.fileName).toLowerCase())) return
      const id = doc.uri.toString()
      clearTimeout(saveTimers.get(id))
      saveTimers.set(id, setTimeout(() => void scanDocument(context, doc, true), 800))
    }),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('agentverify.showEditorButton')) setButtonContext() }),
  )
  status.show()
  registerMcpProvider(context)
}

export function deactivate() {
  for (const t of saveTimers.values()) clearTimeout(t)
}
