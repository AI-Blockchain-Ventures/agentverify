#!/usr/bin/env node
// npm run check:private-boundary
//
// Permanent regression check: fails (non-zero exit) if the proprietary scanner engine
// (packages/scanner) ever ends up in a browser-shipped JS bundle again. Two independent checks:
//
//   1. STATIC IMPORT AUDIT — every apps/web/src file that imports from '@agentverify/scanner'
//      must be either a type-only import (erased at compile time, zero runtime risk) or on the
//      small, explicit allowlist below of server-only files where a real scan() call is safe
//      (Next.js Server Components never ship their own code to the client). Anything else fails
//      immediately, before even attempting a build.
//
//   2. BUNDLE CONTENT SCAN — builds the web app into an isolated output directory (never touches
//      whatever `npm run dev`/`npm run review` has running in .next) and greps every emitted
//      client chunk for marker strings extracted LIVE from the real proprietary source files
//      (secret-detection regex/labels, MCP tool classifier regex/names, engine finding body
//      text) — not a hardcoded, driftable copy, so this stays accurate as the engine changes.
//
// Why this exists: on 2026-09-01, ScannerPanel.tsx, PublicScanDemo.tsx, AgentSpoofedPage.tsx,
// fixVerification.ts, CheckCatalog.tsx, and (transitively, via the scanner package's single
// bundled entry point) app/verify/page.tsx, ReportView.tsx, and lib/policies.ts were all found to
// leak real detection-engine content into the client bundle. This script is what stops that from
// silently happening again.

import { execSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(__dirname, '..')
const webDir = path.join(repoRoot, 'apps', 'web')
const scannerSrc = path.join(repoRoot, 'packages', 'scanner', 'src')

let failed = false
const fail = (msg) => { console.error(`\n✗ ${msg}`); failed = true }
const ok = (msg) => console.log(`✓ ${msg}`)

// ============================================================================
// 1. STATIC IMPORT AUDIT
// ============================================================================
console.log('--- Static import audit: apps/web/src files importing @agentverify/scanner ---\n')

// Files where a real (non-type) import is known-safe: Next.js Server Components (no 'use client'
// directive, and nothing in their own render path re-exports the import to a client boundary).
// Keep this list short and reviewed — adding to it should be a deliberate, explained decision.
const ALLOWED_VALUE_IMPORT_FILES = new Set([
  'app/report/demo/page.tsx', // Server Component; scan() runs at build/request time only, never shipped
])

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.next')) continue
    const full = path.join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) walk(full, files)
    else if (/\.(tsx?|jsx?)$/.test(entry)) files.push(full)
  }
  return files
}

const webSrcDir = path.join(webDir, 'src')
const webFiles = walk(webSrcDir)
let importViolations = 0

// For each line ending in `from '@agentverify/scanner'`, walk BACKWARD to the nearest preceding
// line that actually starts a statement (top-level `import`/`export` at column 0) — correctly
// handles multi-line named imports without accidentally spanning across an unrelated EARLIER
// import statement the way a single forward non-greedy regex over the whole file would. Anchored
// to line-start `import`/`export` specifically so prose in a comment that merely MENTIONS the
// package name (e.g. explaining why it's avoided) is never mistaken for a real statement.
function findImportStatements(content) {
  const lines = content.split('\n')
  const statements = []
  for (let i = 0; i < lines.length; i += 1) {
    if (!/from\s+'@agentverify\/scanner'/.test(lines[i])) continue
    let start = i
    while (start > 0 && !/^(import|export)\b/.test(lines[start])) start -= 1
    if (/^(import|export)\b/.test(lines[start])) statements.push(lines.slice(start, i + 1).join('\n'))
  }
  return statements
}

for (const file of webFiles) {
  const relPath = path.relative(webDir, file).replace(/\\/g, '/')
  const content = readFileSync(file, 'utf8')
  const statements = findImportStatements(content)
  if (statements.length === 0) continue

  const allTypeOnly = statements.every(s => /^(import|export)\s+type\s/.test(s))

  const relFromSrc = path.relative(webSrcDir, file).replace(/\\/g, '/')
  if (allTypeOnly) {
    ok(`${relPath} — type-only import(s), erased at compile time, safe`)
    continue
  }
  if (ALLOWED_VALUE_IMPORT_FILES.has(relFromSrc)) {
    ok(`${relPath} — real import, but on the reviewed server-only allowlist`)
    continue
  }
  importViolations += 1
  fail(`${relPath} imports a VALUE (not just types) from '@agentverify/scanner' and is not on the server-only allowlist:\n    ${statements.filter(s => !/^(import|export)\s+type\s/.test(s)).join('\n    ')}`)
}

if (importViolations === 0) console.log('\nNo unreviewed value-imports found.\n')

// ============================================================================
// 2. BUNDLE CONTENT SCAN
// ============================================================================
console.log('--- Bundle content scan: building web app and scanning client chunks ---\n')

function extractQuoted(source, fieldPattern) {
  const re = new RegExp(`${fieldPattern}\\s*:\\s*'([^']{8,80})'`, 'g')
  const out = []
  let m
  while ((m = re.exec(source))) out.push(m[1])
  return out
}

function extractRegexSources(source) {
  // Pulls literal /.../ regex bodies out of a source file — these are the actual detection
  // patterns, and by far the most distinctive, unambiguous marker of "the real engine is here."
  // Matches both `pattern: /.../ ` (secrets.ts) and `match: /.../ ` (mcp.ts) field shapes.
  const re = /(?:pattern|match):\s*\/((?:[^/\\\n]|\\.)+)\//g
  const out = []
  let m
  while ((m = re.exec(source))) out.push(m[1])
  return out
}

// The real proprietary source (packages/scanner/src/{secrets,mcp,findings}.ts) only exists on a
// machine with private-package access — packages/scanner/ is gitignored and never present in a
// public CI checkout, which only has the type-compatible public stub (see
// scripts/create-ci-scanner-stub.mjs). In that environment there is nothing sensitive to derive
// markers from, so the marker-based content scan is skipped — the static import audit above still
// runs in full, since it only inspects apps/web's own source, not the proprietary package.
const hasRealScannerSource = existsSync(path.join(scannerSrc, 'secrets.ts'))
const markers = new Set()
if (hasRealScannerSource) {
  const secretsSource = readFileSync(path.join(scannerSrc, 'secrets.ts'), 'utf8')
  const mcpSource = readFileSync(path.join(scannerSrc, 'mcp.ts'), 'utf8')
  const findingsSource = readFileSync(path.join(scannerSrc, 'findings.ts'), 'utf8')

  // IMPORTANT: never extract `name`/`label`/`title` fields alone — those are legitimately PUBLIC
  // product content (an MCP tool's name, a finding's title) that real scan results already display
  // to users elsewhere in the product, so they produce false positives here. The proprietary part
  // is the DETECTION MECHANISM (the regex pattern, the internal body prose explaining what was
  // checked) — never the human-facing label attached to its output.
  for (const s of extractRegexSources(secretsSource)) markers.add(s.slice(0, 24)) // real secret-detection regex fragments
  for (const s of extractRegexSources(mcpSource)) markers.add(s.slice(0, 24)) // real MCP-tool-classifier regex fragments
  for (const s of extractQuoted(findingsSource, 'whatIsWrong')) markers.add(s) // internal engine body prose, never duplicated as UI copy
  // A handful of hand-picked, very-unlikely-to-appear-elsewhere internal identifiers as a backstop.
  for (const extra of ['buildSecurityControls', 'extractRedactedCredentialEvidence', 'dedupeFindings']) {
    markers.add(extra)
  }
  // Drop anything short/generic enough to risk a false positive from unrelated product copy.
  for (const m of [...markers]) {
    if (m.length < 12 && !m.includes(' ')) markers.delete(m)
  }
  console.log(`Derived ${markers.size} marker strings from the current proprietary source (not hardcoded).\n`)
} else {
  ok('Real proprietary scanner source not present (public CI / stub environment) — bundle content scan skipped; static import audit above is the enforcement in this environment.')
}

const buildDistDir = '.next-private-boundary-check'
try {
  execSync(`node -e "process.exit(0)"`, { cwd: webDir }) // sanity: node works
  execSync('npx next build', {
    cwd: webDir,
    env: { ...process.env, NEXT_DIST_DIR: buildDistDir },
    stdio: 'inherit',
  })
} catch (e) {
  fail(`Build failed — cannot verify the bundle. ${e.message}`)
  process.exit(1)
}

const chunksDir = path.join(webDir, buildDistDir, 'static')
const chunkFiles = walk(chunksDir).filter(f => f.endsWith('.js'))
console.log(`\nScanning ${chunkFiles.length} client JS chunks for ${markers.size} markers...\n`)

const hits = []
for (const file of chunkFiles) {
  const content = readFileSync(file, 'utf8')
  for (const marker of markers) {
    if (marker.length < 6) continue
    if (content.includes(marker)) hits.push({ file: path.relative(webDir, file), marker })
  }
}

if (hits.length > 0) {
  fail(`Found ${hits.length} proprietary-scanner marker(s) in the client bundle:`)
  for (const h of hits.slice(0, 20)) console.error(`    ${h.file} :: "${h.marker}"`)
} else {
  ok('Zero proprietary scanner markers found in any client chunk.')
}

// Source maps: confirm none are shipped (next.config.mjs does not set productionBrowserSourceMaps).
const mapFiles = walk(chunksDir).filter(f => f.endsWith('.map'))
if (mapFiles.length > 0) {
  fail(`${mapFiles.length} source map(s) were emitted — verify none expose scanner internals, or disable productionBrowserSourceMaps.`)
} else {
  ok('No source maps emitted.')
}

rmSync(path.join(webDir, buildDistDir), { recursive: true, force: true })

console.log('')
if (failed) {
  console.error('PRIVATE SCANNER BOUNDARY CHECK: FAILED\n')
  process.exit(1)
} else {
  console.log('PRIVATE SCANNER BOUNDARY CHECK: PASSED\n')
  process.exit(0)
}
