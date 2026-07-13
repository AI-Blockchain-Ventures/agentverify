import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import http from 'node:http'

const root = resolve(import.meta.dirname, '../../..')
const cli = resolve(import.meta.dirname, '../dist/cli.js')
const temp = mkdtempSync(join(tmpdir(), 'agentverify-cli-'))
const fixture = join(temp, 'agent.ts')
writeFileSync(fixture, `const agent = { name: 'TestAgent', tools: ['pay'], permissions: ['payments:write'] }
export async function run(request) { return tools.pay.execute(request) }
`)

const run = (args, env = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk.toString() })
  child.stderr.on('data', chunk => { stderr += chunk.toString() })
  child.on('close', status => resolve({ status, stdout, stderr }))
})

try {
  const missing = await run(['scan', '--file', fixture])
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /API key required/)

  const unauthorizedServer = http.createServer((req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'Invalid or unauthorized Agent Verify API key' }))
  })
  await new Promise(resolve => unauthorizedServer.listen(0, '127.0.0.1', resolve))
  const unauthorizedUrl = `http://127.0.0.1:${unauthorizedServer.address().port}/v1/scan`
  const unauthorized = await run(['scan', '--file', fixture, '--key', 'av_fake_cli_test_key_000000000000', '--json'], { AGENTVERIFY_API_URL: unauthorizedUrl })
  unauthorizedServer.close()
  assert.equal(unauthorized.status, 1)
  assert.doesNotMatch(unauthorized.stdout + unauthorized.stderr, /av_fake_cli_test_key/)
  assert.match(unauthorized.stdout, /Invalid or unauthorized Agent Verify API key/)

  const scanBody = {
    reportId: 'REPORT-test123',
    saved: true,
    reportUrl: 'https://aimodularity.com/agentverify/report/?id=REPORT-test123',
    verdict: 'NOT_VERIFIED',
    riskScore: 42,
    riskLevel: 'High Risk',
    confidence: 91,
    findings: [{ id: 'f1', code: 'MISSING_SIGNATURE', title: 'Missing cryptographic signature', category: 'A', severity: 'critical', whatIsWrong: '', whyItMatters: '', recommendedFix: '' }],
    categoryScores: [],
    threatCategories: [{ id: 'prompt-injection', label: 'Prompt Injection', status: 'possible', severity: 'high', whatItMeans: '', evidencePattern: '', whyItMatters: '', recommendedFix: '', a2spaImpact: '' }],
    bom: { detectedLanguage: 'TypeScript', detectedFramework: null, detectedPlatform: null, agentName: 'TestAgent', toolAccessLevel: 'Restricted', credentialExposure: 'Not Detected', memoryPersistence: 'Unknown', auditLogging: 'Unknown', humanGates: 'Unknown', rateLimiting: 'Unknown', promptInjectionSurface: 'Unknown', delegationScope: 'Unknown' },
    metadata: { schemaVersion: '1.3.0', scannerVersion: 'test', fileName: 'agent.ts', fileSize: 1, scannedAt: new Date().toISOString(), detectedLanguage: 'TypeScript', detectedFramework: null, selectedPlatform: null, agentName: 'TestAgent', scanDuration: 1 },
  }
  const okServer = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(scanBody))
  })
  await new Promise(resolve => okServer.listen(0, '127.0.0.1', resolve))
  const okUrl = `http://127.0.0.1:${okServer.address().port}/v1/scan`
  const normal = await run(['scan', '--file', fixture, '--key', 'av_valid_cli_test_key_000000000000'], { AGENTVERIFY_API_URL: okUrl })
  assert.equal(normal.status, 0)
  assert.match(normal.stdout, /NOT VERIFIED/)
  assert.match(normal.stdout, /Prompt Injection/)
  assert.match(normal.stdout, /https:\/\/aimodularity\.com\/agentverify\/report\/\?id=REPORT-test123/)

  const ci = await run(['scan', '--file', fixture, '--key', 'av_valid_cli_test_key_000000000000', '--ci'], { AGENTVERIFY_API_URL: okUrl })
  assert.equal(ci.status, 1)

  const markdown = await run(['scan', '--file', fixture, '--key', 'av_valid_cli_test_key_000000000000', '--markdown'], { AGENTVERIFY_API_URL: okUrl })
  assert.equal(markdown.status, 0)
  assert.match(markdown.stdout, /Threat categories:/)

  const notAssessedBody = { ...scanBody, verdict: 'NOT_ASSESSED', riskScore: 0, riskLevel: 'High Risk', findings: [] }
  const notAssessedServer = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(notAssessedBody))
  })
  await new Promise(resolve => notAssessedServer.listen(0, '127.0.0.1', resolve))
  const notAssessedUrl = `http://127.0.0.1:${notAssessedServer.address().port}/v1/scan`
  const strictNotAssessed = await run(['scan', '--file', fixture, '--key', 'av_valid_cli_test_key_000000000000', '--ci'], { AGENTVERIFY_API_URL: notAssessedUrl })
  assert.equal(strictNotAssessed.status, 2)
  const allowedNotAssessed = await run(['scan', '--file', fixture, '--key', 'av_valid_cli_test_key_000000000000', '--ci', '--allow-not-assessed'], { AGENTVERIFY_API_URL: notAssessedUrl })
  assert.equal(allowedNotAssessed.status, 0)
  notAssessedServer.close()
  okServer.close()

  const action = readFileSync(resolve(root, 'action.yml'), 'utf8')
  assert.match(action, /^name: Agent Verify/m)
  assert.match(action, /api-key:/)
  assert.match(action, /AGENTVERIFY_API_KEY: \$\{\{ inputs\.api-key \}\}/)
  assert.match(action, /npx --yes agentverify scan/)
  assert.doesNotMatch(action, /echo .*api-key|echo .*AGENTVERIFY_API_KEY/i)

  const docs = readFileSync(resolve(root, 'docs/github-action.md'), 'utf8')
  assert.match(docs, /secrets\.AGENTVERIFY_API_KEY/)
  assert.match(docs, /branch protection/i)
  assert.match(docs, /NOT_VERIFIED/)
  assert.match(docs, /README badge/i)
} finally {
  rmSync(temp, { recursive: true, force: true })
}
