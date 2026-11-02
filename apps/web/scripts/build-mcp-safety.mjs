#!/usr/bin/env node
/**
 * Builds src/data/mcpSafety.json — the data behind the public "Is this MCP server safe?" pages.
 *
 * For each popular npm-published MCP server: download the published package (as data — it is never installed or run),
 * read its source, run the Agent Verify scanner on it, and record what the server can do plus code-level findings.
 * Runs locally (needs the private scanner); the committed JSON is what the static site renders.
 *
 *   node scripts/build-mcp-safety.mjs            # refresh all
 *   node scripts/build-mcp-safety.mjs --limit 20 # quick run
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { scan, SCANNER_VERSION } from '@agentverify/scanner'

const OUT = new URL('../src/data/mcpSafety.json', import.meta.url)
const args = process.argv.slice(2)
const LIMIT = Number(args[args.indexOf('--limit') + 1]) || 520
const MIN_DOWNLOADS = 20
const MAX_TARBALL = 8 * 1024 * 1024
const MAX_FILES = 60
const MAX_TOTAL = 5 * 1024 * 1024
const MAX_FILE = 400 * 1024

/** Well-known servers, always included (the registry is large and unordered). */
const SEED = [
  '@modelcontextprotocol/server-filesystem', '@modelcontextprotocol/server-memory', '@modelcontextprotocol/server-everything',
  '@modelcontextprotocol/server-sequential-thinking', '@modelcontextprotocol/server-github', '@modelcontextprotocol/server-postgres',
  '@modelcontextprotocol/server-brave-search', '@modelcontextprotocol/server-puppeteer', '@modelcontextprotocol/server-slack',
  '@modelcontextprotocol/server-google-maps', '@modelcontextprotocol/server-gdrive', '@modelcontextprotocol/server-redis',
  '@playwright/mcp', '@upstash/context7-mcp', '@notionhq/notion-mcp-server', '@supabase/mcp-server-supabase',
  '@stripe/mcp', 'firecrawl-mcp', '@browserbasehq/mcp-server-browserbase', 'tavily-mcp', 'exa-mcp-server',
  '@cloudflare/mcp-server-cloudflare', 'mcp-server-kubernetes', '@sentry/mcp-server', 'chrome-devtools-mcp',
  '@heroku/mcp-server', '@azure/mcp', 'mongodb-mcp-server', '@elastic/mcp-server-elasticsearch', '@21st-dev/magic',
  'figma-developer-mcp', '@hubspot/mcp-server', 'airtable-mcp-server', '@modelcontextprotocol/server-aws-kb-retrieval',
  'mcp-remote', '@kimtaeyoon83/mcp-server-youtube-transcript', 'desktop-commander', '@wonderwhy-er/desktop-commander',
]

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function getJson(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'agentverify-mcp-safety/2.0' } })
      if (res.status === 404) return null
      if (res.ok) return await res.json()
    } catch { /* retry */ }
    await sleep(800 * (i + 1))
  }
  return null
}

async function registryNpmPackages(max) {
  const names = new Set()
  let cursor = ''
  for (let page = 0; page < 30 && names.size < max; page++) {
    const data = await getJson(`https://registry.modelcontextprotocol.io/v0/servers?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    if (!data) break
    for (const item of data.servers ?? []) {
      if (item._meta?.['io.modelcontextprotocol.registry/official']?.isLatest === false) continue
      for (const p of item.server?.packages ?? []) if ((p.registryType ?? p.registry_type) === 'npm' && p.identifier) names.add(p.identifier)
    }
    cursor = data.metadata?.nextCursor ?? data.metadata?.next_cursor ?? ''
    if (!cursor) break
  }
  return [...names]
}

/** npm search: packages tagged as MCP servers, most popular first. */
async function npmSearchMcp(max) {
  const names = new Set()
  for (const text of ['keywords:mcp-server', 'keywords:modelcontextprotocol', 'keywords:mcp']) {
    for (let from = 0; from < 1000 && names.size < max; from += 250) {
      const d = await getJson(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(text)}&size=250&from=${from}&popularity=1.0&quality=0.2&maintenance=0.2`)
      const objs = d?.objects ?? []
      for (const o of objs) {
        const p = o.package ?? {}
        const hay = `${p.name} ${p.description ?? ''}`
        // Only actual servers: skip SDKs, clients, and frameworks that merely mention MCP.
        if (!/mcp|model context protocol/i.test(hay)) continue
        if (/(^|[-/])(sdk|client|types|inspector|cli-kit)($|[-/])/i.test(p.name ?? '') && !/server/i.test(p.name ?? '')) continue
        if (p.name === '@modelcontextprotocol/sdk') continue
        names.add(p.name)
      }
      if (objs.length < 250) break
    }
  }
  return [...names]
}

const CATEGORIES = [
  ['browser', /browser|playwright|puppeteer|chrome|selenium|web-?scrap|crawl|firecrawl|browserbase/i],
  ['files', /file-?system|filesystem|files?|desktop-commander|fs/i],
  ['code-hosting', /github|gitlab|bitbucket|git/i],
  ['database', /postgres|mysql|sqlite|mongo|redis|supabase|neon|database|sql|elastic|snowflake|bigquery|duckdb/i],
  ['search', /search|brave|tavily|exa|serp|perplexity|bing|duckduckgo/i],
  ['docs-memory', /memory|context7|docs|knowledge|notion|obsidian|rag/i],
  ['cloud-devops', /aws|azure|gcp|cloudflare|kubernetes|k8s|docker|vercel|heroku|terraform|sentry/i],
  ['productivity', /slack|gmail|google|calendar|jira|linear|asana|hubspot|airtable|figma|stripe|trello/i],
]
function categoryOf(name, description) {
  const hay = `${name} ${description}`
  return CATEGORIES.find(([, re]) => re.test(hay))?.[0] ?? 'other'
}

async function weeklyDownloads(name) {
  const d = await getJson(`https://api.npmjs.org/downloads/point/last-week/${name}`)
  return typeof d?.downloads === 'number' ? d.downloads : 0
}

/** Minimal tar reader (ustar + pax long names). Returns text files only; nothing is written to disk. */
function untar(buf) {
  const files = []
  let off = 0
  let paxPath = null
  const str = (a, b) => buf.subarray(off + a, off + b).toString('utf8').replace(/\0.*$/s, '')
  while (off + 512 <= buf.length) {
    if (buf.subarray(off, off + 512).every(b => b === 0)) break
    const size = parseInt(str(124, 136).trim() || '0', 8)
    const type = String.fromCharCode(buf[off + 156] || 48)
    const prefix = str(345, 500)
    const name = paxPath ?? (prefix ? `${prefix}/${str(0, 100)}` : str(0, 100))
    const body = buf.subarray(off + 512, off + 512 + size)
    if (type === 'x') {
      const m = body.toString('utf8').match(/\d+ path=([^\n]+)\n/)
      paxPath = m ? m[1] : null
    } else {
      if (type === '0' || type === '\0') files.push({ path: name.replace(/^package\//, ''), data: body })
      paxPath = null
    }
    off += 512 + Math.ceil(size / 512) * 512
  }
  return files
}

const CODE = /\.(m?js|cjs|ts|mts|cts|py)$/i
const SKIP = /(^|\/)(node_modules|test|tests|__tests__|spec|examples?|fixtures?|docs?)\/|\.d\.ts$|\.min\.js$|\.map$|\.test\.|\.spec\./i
function priority(path) {
  let s = 0
  if (/(server|index|tools?|handler|main|mcp)/i.test(path)) s += 20
  if (/(^|\/)(src|dist|build|lib)\//.test(path)) s += 5
  return s - path.split('/').length
}

function pickSource(files) {
  const picked = []
  let total = 0
  for (const f of files.filter(f => CODE.test(f.path) && !SKIP.test(f.path)).sort((a, b) => priority(b.path) - priority(a.path))) {
    if (picked.length >= MAX_FILES) break
    if (f.data.length > MAX_FILE || total + f.data.length > MAX_TOTAL) continue
    const text = f.data.toString('utf8')
    if (text.includes('\u0000')) continue
    picked.push({ path: f.path, content: text })
    total += f.data.length
  }
  return picked
}

function locate(files, line) {
  if (files.length === 1) return { path: files[0].path, line }
  let cursor = 1
  for (const f of files) {
    const start = cursor + 1
    const n = f.content.split('\n').length
    if (line >= start && line < start + n) return { path: f.path, line: line - start + 1 }
    cursor = start + n + 1
  }
  return null
}

/** What the server is able to do, from its source. Plain facts, shown as tags. */
const CAPABILITIES = [
  { id: 'shell', label: 'Runs shell commands', risk: 3, test: /child_process|\bexecSync\b|\bspawn\(|\bexecFile\(|subprocess\.(run|Popen|call)|os\.system\(/ },
  { id: 'fs-write', label: 'Writes or deletes files', risk: 2, test: /\b(writeFile|writeFileSync|appendFile|unlink|rmSync|rm\(|rmdir|rename|mkdir)\b|shutil\.rmtree|os\.remove/ },
  { id: 'fs-read', label: 'Reads files', risk: 1, test: /\b(readFile|readFileSync|createReadStream|readdir)\b|open\([^)]*['"]r/ },
  { id: 'browser', label: 'Controls a web browser', risk: 2, test: /puppeteer|playwright|chromium\.launch|webdriver/i },
  { id: 'network', label: 'Calls internet services', risk: 1, test: /\bfetch\(|axios|https?\.request|got\(|undici|requests\.(get|post)|httpx/ },
  { id: 'database', label: 'Queries a database', risk: 2, test: /(require\(|from\s+|import\s+)['"](pg|mysql2?|sqlite3|better-sqlite3|mongodb|redis|ioredis|@prisma\/client|knex|sequelize|@neondatabase\/serverless|@supabase\/supabase-js|duckdb|snowflake-sdk|@google-cloud\/bigquery)['"]|import (psycopg2?|sqlite3|pymongo|redis|sqlalchemy)\b/ },
  { id: 'secrets', label: 'Needs API keys or tokens', risk: 1, test: /process\.env\.[A-Z0-9_]*(TOKEN|KEY|SECRET|PASSWORD|PAT)\b|os\.environ(\.get)?\(?\[?['"][A-Z0-9_]*(TOKEN|KEY|SECRET)/ },
]

/**
 * Bundled helpers (opening a browser for sign-in, launching a bundled binary) use child_process too. Only call it
 * "runs shell commands" when the server's own tools or description show it runs commands for the AI; otherwise it is
 * the milder "starts other programs", which does not raise the rating on its own.
 */
const SHELL_EVIDENCE = /(exec|shell|command|terminal|bash|powershell|run_?code|execute|spawn_process|run_script|kubectl|desktop.?commander|automation|ssh)/i
export function refineCapabilities(caps, tools, description) {
  if (!caps.some(c => c.id === 'shell')) return caps
  if (tools.some(t => SHELL_EVIDENCE.test(t)) || SHELL_EVIDENCE.test(description ?? '')) return caps
  return caps.map(c => (c.id === 'shell' ? { id: 'spawn', label: 'Starts other programs', risk: 1 } : c))
}

function toolNames(text) {
  const names = new Set()
  for (const re of [/\.(?:tool|registerTool)\(\s*["'`]([a-zA-Z0-9_.-]{2,64})["'`]/g, /name:\s*["'`]([a-z][a-zA-Z0-9_.-]{2,63})["'`],\s*\n?\s*(?:title|description)/g]) {
    for (const m of text.matchAll(re)) names.add(m[1])
  }
  return [...names].slice(0, 40)
}

/**
 * Code-level checks that are meaningful for a server's own source. Agent-setup checks (audit logging, rate limits,
 * "MCP server connected", memory…) are about how an AGENT is configured, so they are not shown here. Secret findings
 * are left out on purpose: bundled libraries trigger false positives, and if one were real, publishing it would hurt
 * the maintainer — those go through responsible disclosure instead.
 */
const PUBLIC_CODES = new Set(['COMMAND_INJECTION_RISK', 'UNSAFE_EVAL_EXEC', 'SQL_INJECTION_RISK', 'SSRF_RISK', 'PATH_TRAVERSAL_RISK', 'UNSAFE_DESERIALIZATION', 'TLS_VERIFICATION_DISABLED', 'INSECURE_HTTP_ENDPOINT', 'SENSITIVE_DATA_IN_LOGS', 'UNSAFE_BROWSER_AUTOMATION', 'INDIRECT_PROMPT_INJECTION'])

/**
 * The rating is about reach — how much an AI agent could do through this server if it were tricked or misused —
 * and is based only on capabilities that are plainly visible in the code. Code patterns are listed separately.
 */
function rate(caps) {
  const has = id => caps.some(c => c.id === id)
  if (has('shell')) return { rating: 'higher', reasons: ['can run shell commands on your computer'] }
  const reasons = ['fs-write', 'browser', 'database'].filter(has).map(id => caps.find(c => c.id === id).label.toLowerCase())
  if (has('network') && has('secrets')) reasons.push('uses your API keys to call online services')
  if (reasons.length) return { rating: 'review', reasons }
  return { rating: 'lower', reasons: [has('fs-read') ? 'reads files but does not change them' : has('network') ? 'calls online services without stored keys' : 'no high-reach capabilities found'] }
}

export function slugFor(name) {
  return name.replace(/^@/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
}

async function analyze(name) {
  const meta = await getJson(`https://registry.npmjs.org/${name.replace('/', '%2F')}`)
  if (!meta) return null
  const version = meta['dist-tags']?.latest
  const v = meta.versions?.[version]
  if (!v?.dist?.tarball) return null
  const res = await fetch(v.dist.tarball)
  if (!res.ok) return null
  const gz = Buffer.from(await res.arrayBuffer())
  if (gz.length > MAX_TARBALL) return { skipped: 'package too large' }
  const files = pickSource(untar(gunzipSync(gz)))
  if (files.length === 0) return null
  const content = files.length === 1 ? files[0].content : files.map(f => `// ===== FILE: ${f.path} =====\n${f.content}`).join('\n\n')
  const result = scan({ content, fileName: `${name}@${version}`, fileSize: content.length, platform: 'MCP server' })
  // Category A is A2SPA protocol readiness (signatures, nonces…) — useful for agents, not a fair judgment of a server.
  const seen = new Set()
  const findings = (result.findings ?? [])
    .filter(f => f.category !== 'A' && PUBLIC_CODES.has(f.code) && !seen.has(f.code) && seen.add(f.code))
    .map(f => {
      const loc = typeof f.line === 'number' && f.line > 0 ? locate(files, f.line) : null
      return { code: f.code, title: f.title, severity: f.severity, whatIsWrong: f.whatIsWrong, file: loc?.path ?? null, line: loc?.line ?? null }
    })
  const all = files.map(f => f.content).join('\n')
  const tools = toolNames(all)
  const caps = refineCapabilities(CAPABILITIES.filter(c => c.test.test(all)).map(({ id, label, risk }) => ({ id, label, risk })), tools, v.description ?? meta.description ?? '')
  const repo = typeof v.repository === 'string' ? v.repository : v.repository?.url ?? meta.repository?.url ?? null
  return {
    slug: slugFor(name),
    name,
    version,
    description: (v.description ?? meta.description ?? '').slice(0, 300),
    repository: repo ? repo.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://') : null,
    homepage: v.homepage ?? null,
    license: v.license ?? null,
    publishedAt: meta.time?.[version] ?? null,
    firstPublishedAt: meta.time?.created ?? null,
    category: categoryOf(name, v.description ?? meta.description ?? ''),
    capabilities: caps,
    tools,
    findings: findings.slice(0, 12),
    counts: ['critical', 'high', 'medium', 'low'].reduce((o, s) => ({ ...o, [s]: findings.filter(f => f.severity === s).length }), {}),
    ...rate(caps),
    filesScanned: files.length,
  }
}

/** --reclassify: re-apply the capability and rating rules to the existing data without downloading anything. */
function reclassify() {
  const data = JSON.parse(readFileSync(OUT, 'utf8'))
  let changed = 0
  for (const s of data.servers) {
    const caps = refineCapabilities(s.capabilities, s.tools, s.description)
    const next = rate(caps)
    if (JSON.stringify(caps) !== JSON.stringify(s.capabilities) || next.rating !== s.rating) changed++
    Object.assign(s, { capabilities: caps }, next)
  }
  writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n')
  console.log(`Reclassified ${data.servers.length} servers (${changed} changed).`)
}

async function main() {
  if (args.includes('--reclassify')) return reclassify()
  const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { servers: [] }
  console.log('Collecting MCP servers…')
  const fromRegistry = await registryNpmPackages(600)
  const fromSearch = await npmSearchMcp(1500)
  const candidates = [...new Set([...SEED, ...fromRegistry, ...fromSearch])]
  console.log(`${candidates.length} npm packages; ranking by weekly downloads…`)
  const ranked = []
  for (let i = 0; i < candidates.length; i += 10) {
    const batch = candidates.slice(i, i + 10)
    const counts = await Promise.all(batch.map(weeklyDownloads))
    batch.forEach((name, j) => ranked.push({ name, downloads: counts[j], seed: SEED.includes(name) }))
  }
  ranked.sort((a, b) => Number(b.seed) - Number(a.seed) || b.downloads - a.downloads)
  const servers = []
  for (const { name, downloads } of ranked) {
    if (servers.length >= LIMIT) break
    if (downloads < MIN_DOWNLOADS && !SEED.includes(name)) continue
    try {
      const entry = await analyze(name)
      if (!entry || entry.skipped) { console.log(`  - ${name}: skipped${entry?.skipped ? ` (${entry.skipped})` : ''}`); continue }
      servers.push({ ...entry, weeklyDownloads: downloads })
      console.log(`  ✓ ${name}@${entry.version}: ${entry.rating} (${entry.findings.length} findings, ${entry.capabilities.map(c => c.id).join(',') || 'no caps'})`)
    } catch (e) {
      console.log(`  ! ${name}: ${e instanceof Error ? e.message : e}`)
    }
  }
  if (servers.length === 0) {
    console.error('No servers analyzed; keeping the previous data.')
    process.exit(1)
  }
  const out = { generatedAt: new Date().toISOString(), scannerVersion: SCANNER_VERSION, count: servers.length, servers }
  writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n')
  console.log(`Wrote ${servers.length} servers (was ${previous.servers?.length ?? 0}).`)
}

main().catch(e => { console.error(e); process.exit(1) })
