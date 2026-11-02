// `agentverify mcp` end to end: spawn the built CLI as an MCP server and talk JSON-RPC to it over stdio,
// against a local fake scan API (no network, no real key).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
const REAL_SECRET = 'sk-live-THIS-MUST-NEVER-LEAVE-1234567890'

// Fake API: records each request body and returns findings at fixed lines in the scanned content.
const received = []
const api = createServer((req, res) => {
  let body = ''
  req.on('data', chunk => { body += chunk })
  req.on('end', () => {
    const parsed = JSON.parse(body)
    received.push({ auth: req.headers.authorization, ...parsed })
    const sqlLine = parsed.content.split('\n').findIndex(l => l.includes('SELECT')) + 1
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      reportId: 'REPORT-TEST',
      verdict: 'NOT_VERIFIED',
      riskScore: 35,
      riskLevel: 'High Risk',
      reportInsights: { topBlocker: 'SQL built from user input' },
      findings: [
        { id: 'a', code: 'SQL_INJECTION_RISK', title: 'SQL built from user input', category: 'B', severity: 'critical', whatIsWrong: 'Query uses string concatenation.', whyItMatters: 'Data theft.', recommendedFix: '', fixLocked: true, line: sqlLine || undefined },
        { id: 'b', code: 'NO_RATE_LIMITING', title: 'No rate limit', category: 'B', severity: 'medium', whatIsWrong: 'No limit.', whyItMatters: 'Runaway cost.', recommendedFix: 'Add a rate limit.', quickFix: 'rateLimit: { maxCallsPerHour: 100 }' },
      ],
      metadata: { scannerVersion: 'test' },
      reportUrl: 'https://aimodularity.com/agentverify/report/?id=REPORT-TEST',
    }))
  })
})
await new Promise(r => api.listen(0, '127.0.0.1', r))
const API_URL = `http://127.0.0.1:${api.address().port}/v1/scan`

function startServer(env = {}, cwd = process.cwd()) {
  const child = spawn(process.execPath, [CLI, 'mcp'], { cwd, env: { ...process.env, AGENTVERIFY_API_URL: API_URL, AGENTVERIFY_API_KEY: 'av_test_key', ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
  let buffer = ''
  const waiting = new Map()
  const stdoutLines = []
  child.stdout.on('data', chunk => {
    buffer += chunk
    let i
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i)
      buffer = buffer.slice(i + 1)
      stdoutLines.push(line)
      const msg = JSON.parse(line) // every stdout line must be valid JSON-RPC
      waiting.get(msg.id)?.(msg)
    }
  })
  let nextId = 1
  const request = (method, params) => new Promise(resolve => {
    const id = nextId++
    waiting.set(id, resolve)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  const stop = () => new Promise(r => { child.on('close', r); child.stdin.end() })
  return { request, notify, stop, stdoutLines }
}

test('handshake: initialize, tools/list, ping, unknown method', async () => {
  const s = startServer()
  const init = await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
  assert.equal(init.result.protocolVersion, '2025-06-18')
  assert.equal(init.result.serverInfo.name, 'agentverify')
  assert.ok(init.result.capabilities.tools)
  s.notify('notifications/initialized')
  const list = await s.request('tools/list', {})
  assert.deepEqual(list.result.tools.map(t => t.name), ['scan_path', 'scan_code', 'scan_mcp_config'])
  for (const t of list.result.tools) assert.equal(t.inputSchema.type, 'object')
  assert.deepEqual((await s.request('ping', {})).result, {})
  assert.equal((await s.request('does/not/exist', {})).error.code, -32601)
  const old = await s.request('initialize', { protocolVersion: '1999-01-01' })
  assert.equal(old.result.protocolVersion, '2025-06-18', 'unknown versions get the latest supported one')
  await s.stop()
  assert.ok(s.stdoutLines.every(l => l.startsWith('{"jsonrpc":"2.0"')), 'only protocol messages on stdout')
})

test('scan_code returns a readable report; Free findings say the fix is in Pro', async () => {
  const s = startServer()
  const res = await s.request('tools/call', { name: 'scan_code', arguments: { content: "db.query('SELECT * FROM t WHERE id=' + id)", fileName: 'agent.js' } })
  const text = res.result.content[0].text
  assert.equal(res.result.isError, undefined)
  assert.match(text, /Verdict: NOT VERIFIED/)
  assert.match(text, /Security score 35\/100/)
  assert.match(text, /\[CRITICAL\] SQL built from user input/)
  assert.match(text, /Fix: included with Agent Verify Pro/)
  assert.match(text, /rateLimit: \{ maxCallsPerHour: 100 \}/, 'fixes that were returned are shown')
  assert.equal(res.result.structuredContent.securityScore, 35)
  assert.equal(received.at(-1).auth, 'Bearer av_test_key')
  assert.equal(received.at(-1).platform, 'MCP')
  await s.stop()
})

test('scan_path scans a folder as one report and maps lines back to the right file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'av-mcp-'))
  mkdirSync(join(dir, 'agents'))
  mkdirSync(join(dir, 'node_modules'))
  writeFileSync(join(dir, 'README.md'), '# demo\n')
  writeFileSync(join(dir, 'agents', 'tools.py'), 'import os\n\ndef lookup(order_id):\n    return db.execute("SELECT * FROM orders WHERE id=" + order_id)\n')
  writeFileSync(join(dir, 'agents', 'agent.py'), 'agent = Agent(tools=[lookup])\n')
  writeFileSync(join(dir, 'node_modules', 'skip.js'), 'SELECT should never be sent')
  const s = startServer({}, dir)
  const res = await s.request('tools/call', { name: 'scan_path', arguments: { path: '.' } })
  const text = res.result.content[0].text
  const sent = received.at(-1).content
  assert.ok(!sent.includes('should never be sent'), 'node_modules is skipped')
  assert.match(sent, /===== FILE: agents\/agent\.py =====/)
  assert.match(text, /Scanned 3 files together as one report/)
  assert.match(text, /Location: agents\/tools\.py:4/, 'line is mapped back to the file it came from')
  await s.stop()
})

test('scan_mcp_config sends only server definitions, with secrets masked', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'av-mcp-cfg-'))
  const cfg = join(dir, 'claude.json')
  writeFileSync(cfg, JSON.stringify({
    history: ['private chat text that must not be sent'],
    mcpServers: {
      github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github', `--token=${REAL_SECRET}`], env: { GITHUB_PERSONAL_ACCESS_TOKEN: REAL_SECRET, LOG_LEVEL: 'debug', FROM_ENV: '${GITHUB_TOKEN}' } },
    },
    projects: { '/home/me/app': { mcpServers: { files: { command: 'npx', args: ['@modelcontextprotocol/server-filesystem', '/'] } } } },
  }))
  const s = startServer({}, dir)
  const res = await s.request('tools/call', { name: 'scan_mcp_config', arguments: { path: 'claude.json' } })
  const sent = received.at(-1).content
  assert.ok(!sent.includes(REAL_SECRET), 'the real key never leaves the computer')
  assert.ok(!sent.includes('private chat text'), 'only server definitions are sent')
  assert.match(sent, /"GITHUB_PERSONAL_ACCESS_TOKEN": "sk-l\*\*\*\*redacted"/, 'masked value still looks like a stored secret to the scanner')
  assert.match(sent, /--token=sk-l\*\*\*\*redacted/)
  assert.match(sent, /"LOG_LEVEL": "debug"/)
  assert.match(sent, /"FROM_ENV": "\$\{GITHUB_TOKEN\}"/, 'variable references are left alone')
  assert.match(sent, /app\/files/, 'per-project servers are included')
  assert.match(res.result.content[0].text, /Secret values were masked/)
  await s.stop()
})

test('no API key: the tool explains how to get one instead of failing silently', async () => {
  const s = startServer({ AGENTVERIFY_API_KEY: '' })
  const res = await s.request('tools/call', { name: 'scan_code', arguments: { content: 'x' } })
  assert.equal(res.result.isError, true)
  assert.match(res.result.content[0].text, /needs an API key/)
  await s.stop()
})

test.after(() => api.close())
