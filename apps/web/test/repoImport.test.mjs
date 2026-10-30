// Unit tests for the v1.6 GitHub/zip project import (src/lib/repoImport.ts) and the fix checklist.
// Pure logic — the zip test builds a real archive in memory and reads it back with the same
// DecompressionStream path the browser uses. No network calls.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'
import { transformSync } from 'esbuild'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.join(__dirname, '..', 'src', 'lib')

async function loadTsModule(relPath) {
  const source = readFileSync(path.join(srcDir, relPath), 'utf8')
  const { code } = transformSync(source, { loader: 'ts', format: 'esm', target: 'node20' })
  return import('data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64'))
}

const { parseGitHubUrl, selectAgentFiles, isScannablePath, combineFiles, importFromZip, MAX_IMPORT_FILES } = await loadTsModule('repoImport.ts')
const { buildFixChecklist } = await loadTsModule('fixChecklist.ts')

// 1. GitHub link parsing ---------------------------------------------------------------------------
assert.deepEqual(parseGitHubUrl('https://github.com/acme/agent'), { owner: 'acme', repo: 'agent' })
assert.deepEqual(parseGitHubUrl('github.com/acme/agent.git'), { owner: 'acme', repo: 'agent' })
assert.deepEqual(parseGitHubUrl('acme/agent'), { owner: 'acme', repo: 'agent' })
assert.deepEqual(parseGitHubUrl('https://github.com/acme/agent/tree/dev/src/agents'), { owner: 'acme', repo: 'agent', ref: 'dev', subpath: 'src/agents' })
assert.equal(parseGitHubUrl('https://gitlab.com/acme/agent'), null, 'only github.com links are accepted')
assert.equal(parseGitHubUrl('https://github.com.evil.example/acme/agent'), null, 'look-alike hosts are rejected')
assert.equal(parseGitHubUrl('not a url at all'), null)
console.log('✓ GitHub links parse to owner/repo/ref/path, and non-GitHub hosts are rejected')

// 2. File selection ----------------------------------------------------------------------------------
assert.ok(isScannablePath('src/agent.py'))
assert.ok(isScannablePath('.cursor/mcp.json'))
assert.ok(isScannablePath('Dockerfile'))
assert.ok(!isScannablePath('node_modules/x/index.js'), 'dependencies are skipped')
assert.ok(!isScannablePath('package-lock.json'), 'lockfiles are skipped')
assert.ok(!isScannablePath('dist/bundle.js'), 'build output is skipped')
assert.ok(!isScannablePath('assets/logo.png'), 'binaries are skipped')

const listing = [
  { path: 'README.md', size: 2_000 },
  { path: 'tests/test_agent.py', size: 1_000 },
  { path: 'src/utils/strings.py', size: 1_000 },
  { path: 'src/agents/support_agent.py', size: 3_000 },
  { path: '.mcp.json', size: 400 },
  { path: 'node_modules/huge/index.js', size: 9_000 },
  { path: 'giant_dataset.json', size: 5_000_000 },
]
const { selected } = selectAgentFiles(listing)
const order = selected.map(e => e.path)
assert.equal(order[0], '.mcp.json', 'MCP config is scanned first')
assert.equal(order[1], 'src/agents/support_agent.py', 'agent code comes next')
assert.ok(order.indexOf('tests/test_agent.py') > order.indexOf('src/utils/strings.py'), 'tests rank below regular code')
assert.ok(!order.includes('node_modules/huge/index.js'))
assert.ok(!order.includes('giant_dataset.json'), 'files over the per-file limit are left out')
const many = Array.from({ length: 200 }, (_, i) => ({ path: `src/m${i}.py`, size: 100 }))
assert.equal(selectAgentFiles(many).selected.length, MAX_IMPORT_FILES, 'file count is capped')
const heavy = Array.from({ length: 20 }, (_, i) => ({ path: `src/h${i}.py`, size: 390 * 1024 }))
assert.ok(selectAgentFiles(heavy).selected.reduce((n, e) => n + e.size, 0) <= 5 * 1024 * 1024, 'total size stays within the 5MB scan limit')
console.log('✓ project files are filtered and ranked (MCP + agent code first; deps, lockfiles, build output, binaries skipped; size/count capped)')

const combined = combineFiles([{ path: 'a.py', content: 'A' }, { path: 'b/c.json', content: 'C' }], 'acme/agent')
assert.equal(combined.fileName, 'acme/agent (2 files)')
assert.equal(combined.content, '// ===== File: a.py =====\nA\n\n// ===== File: b/c.json =====\nC')
console.log('✓ imported files are combined with a per-file header')

// 3. Zip import (real archive, deflate + stored entries, wrapped in a top-level folder) -------------
function buildZip(entries) {
  const locals = []; const centrals = []; let offset = 0
  for (const { name, data, store } of entries) {
    const nameBuf = Buffer.from(name)
    const raw = Buffer.from(data)
    const body = store ? raw : deflateRawSync(raw)
    const method = store ? 0 : 8
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8)
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, body)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(method, 10)
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}
const zipBytes = buildZip([
  { name: 'my-agent/src/agent.py', data: 'tools = ["send_email"]\nagent = "SupportAgent"\n' },
  { name: 'my-agent/.mcp.json', data: '{ "mcpServers": {} }', store: true },
  { name: 'my-agent/node_modules/x/index.js', data: 'ignored' },
  { name: 'my-agent/logo.png', data: 'PNG' },
])
const zipFile = new File([zipBytes], 'my-agent.zip')
const progress = []
const imported = await importFromZip(zipFile, m => progress.push(m))
assert.deepEqual(imported.files.map(f => f.path), ['.mcp.json', 'src/agent.py'], 'top-level folder stripped; deps and images skipped; MCP config first')
assert.equal(imported.files[1].content, 'tools = ["send_email"]\nagent = "SupportAgent"\n', 'deflated content round-trips exactly')
assert.equal(imported.fileName, 'my-agent (2 files)')
assert.ok(imported.notes[0].startsWith('Imported 2 files'))
assert.ok(progress.length > 0, 'progress is reported')
await assert.rejects(() => importFromZip(new File([Buffer.from('not a zip')], 'x.zip')), /not a valid \.zip/)
console.log('✓ .zip import reads deflated and stored entries, strips the wrapper folder, and rejects non-zip files')

// 4. Fix checklist -------------------------------------------------------------------------------------
const checklist = buildFixChecklist({
  fileName: 'agent.py', reportId: 'REPORT-x', riskScore: 40, verdictLabel: 'NOT VERIFIED',
  findings: [{ title: 'SQL query built from unescaped input', line: 12, recommendedFix: 'Use parameterized\n queries.' }],
  fixPriority: [
    { title: 'SQL query built from unescaped input', severity: 'critical', priority: 'fix_first' },
    { title: 'No execution rate limiting', severity: 'low', priority: 'nice_to_have' },
  ],
})
assert.match(checklist, /### Fix first\n- \[ \] \*\*SQL query built from unescaped input\*\* — critical \(line 12\)\n  - How to fix: Use parameterized queries\./)
assert.match(checklist, /### Nice to have\n- \[ \] \*\*No execution rate limiting\*\* — low/)
assert.ok(!/### Fix next/.test(checklist), 'empty priority groups are omitted')
assert.match(checklist, /- \[ \] Re-scan with Agent Verify/)
console.log('✓ fix checklist is a grouped Markdown task list built from the real fix plan')

console.log('\nrepoImport.test.mjs: all assertions passed')
