#!/usr/bin/env node

import { readFileSync, readdirSync, statSync, appendFileSync, writeFileSync } from 'fs'
import { join, relative, extname } from 'path'
import { scan } from './sdk'
import type { ScanResult } from './types'

const VERSION = '1.4.0'
const API_URL = process.env.AGENTVERIFY_API_URL ?? 'https://agentverify-api.agentverify.workers.dev/v1/scan'
const A2SPA_DOCS_URL = 'https://aimodularity.com/A2SPA/docs'

// Exit codes distinguish a security/verification result from an application error, so CI
// can tell "the agent failed the security check" apart from "the scan itself couldn't run"
// (bad key, network failure, missing file, etc). All non-zero codes still fail a pipeline
// step by default — existing `if [ $? -ne 0 ]`-style checks keep working unchanged.
const EXIT_OK = 0
const EXIT_NOT_VERIFIED = 1 // security/verification failure — the agent itself did not pass
const EXIT_NOT_ASSESSED = 2 // insufficient evidence to issue a verdict (unless --allow-not-assessed)
const EXIT_EXECUTION_ERROR = 3 // the scan could not complete — bad key, network, file, etc.

// ANSI colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
}

const write = (value = '') => process.stdout.write(`${value}\n`)

const SUPPORTED_EXTENSIONS = new Set(['.js', '.ts', '.py', '.json', '.yaml', '.yml', '.md', '.mjs', '.cjs'])
const MAX_SCAN_FILE_BYTES = 5 * 1024 * 1024 // 5MB — matches the web scanner's upload limit
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'vendor', 'coverage', '.cache'])

function collectFiles(dir: string): string[] {
  const files: string[] = []
  try {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue
      const fullPath = join(dir, entry)
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        files.push(...collectFiles(fullPath))
      } else if (SUPPORTED_EXTENSIONS.has(extname(entry).toLowerCase())) {
        files.push(fullPath)
      }
    }
  } catch {
    // ignore permission errors
  }
  return files
}

function parseArgs(argv: string[]): {
  command: string
  dir: string
  key: string
  file: string
  json: boolean
  markdown: boolean
  ci: boolean
  allowNotAssessed: boolean
  help: boolean
  version: boolean
  policy: string
  summaryFile: string
} {
  const args = argv.slice(2)
  const result = {
    command: args[0] ?? '',
    dir: '.',
    key: '',
    file: '',
    json: false,
    markdown: false,
    ci: false,
    allowNotAssessed: false,
    help: false,
    version: false,
    policy: '',
    summaryFile: '',
  }

  if (result.command === '--help' || result.command === '-h') {
    result.command = ''
    result.help = true
  }

  if (result.command === '--version' || result.command === '-v') {
    result.command = ''
    result.version = true
  }

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--key' || arg === '-k') result.key = args[++i] ?? ''
    else if (arg === '--file' || arg === '-f') result.file = args[++i] ?? ''
    else if (arg === '--json') result.json = true
    else if (arg === '--markdown') result.markdown = true
    else if (arg === '--ci') result.ci = true
    else if (arg === '--allow-not-assessed') result.allowNotAssessed = true
    else if (arg === '--policy') result.policy = args[++i] ?? ''
    else if (arg === '--summary-file') result.summaryFile = args[++i] ?? ''
    else if (arg === '--help' || arg === '-h') result.help = true
    else if (arg === '--version' || arg === '-v') result.version = true
    else if (!arg.startsWith('-')) result.dir = arg
  }

  // Also check environment variable for API key
  if (!result.key) result.key = process.env.AGENTVERIFY_API_KEY ?? ''

  return result
}

function printHelp() {
  write(`
${c.bold}${c.cyan}Agent Verify${c.reset} ${c.gray}v${VERSION}${c.reset}
${c.gray}Execution trust analysis for AI agents${c.reset}

${c.bold}Usage:${c.reset}
  agentverify scan [dir] --key <api-key>
  agentverify scan --file <file> --key <api-key>

${c.bold}Commands:${c.reset}
  scan          Scan agent files in a directory or a single file

${c.bold}Options:${c.reset}
  --key, -k     API key (or set AGENTVERIFY_API_KEY env var)
  --file, -f    Scan a single file instead of a directory
  --json        Output results as JSON
  --markdown    Output a Markdown summary
  --ci          CI mode: concise output and non-zero exit for NOT VERIFIED
  --allow-not-assessed
                In CI mode, do not fail only because content is NOT_ASSESSED
  --policy <id> Evaluate a built-in policy profile against this scan's evidence
                in addition to the scanner's own verdict (e.g. financial-agent)
  --summary-file <path>
                Write results as JSON to this path (in addition to any other output)
  --version, -v Print version
  --help, -h    Show this help message

${c.bold}Examples:${c.reset}
  ${c.gray}# Scan all agent files in current directory${c.reset}
  agentverify scan . --key av_your_key

  ${c.gray}# Scan a specific file${c.reset}
  agentverify scan --file agent.json --key av_your_key

  ${c.gray}# Use environment variable for key${c.reset}
  AGENTVERIFY_API_KEY=av_your_key agentverify scan ./agents

  ${c.gray}# Output as JSON (useful for CI/CD)${c.reset}
  agentverify scan . --key av_your_key --json

  ${c.gray}# Markdown summary for pull requests${c.reset}
  agentverify scan . --key av_your_key --markdown

${c.bold}Exit codes (--ci):${c.reset}
  0   All scanned files verified
  1   NOT VERIFIED — a security/verification check failed
  2   NOT ASSESSED — insufficient evidence for a verdict (see --allow-not-assessed)
  3   Execution error — the scan itself could not run (bad key, network, missing file)

${c.bold}Get your API key:${c.reset}
  https://aimodularity.com/agentverify/dashboard

${c.bold}Docs:${c.reset}
  https://github.com/AI-Blockchain-Ventures/agentverify

${c.bold}A2SPA docs:${c.reset}
  ${A2SPA_DOCS_URL}
`)
}

function getTopBlocker(result: ScanResult): string {
  return result.reportInsights?.topBlocker ?? result.findings[0]?.title ?? 'No blocking finding detected'
}

function getFixFirst(result: ScanResult): string[] {
  const fromInsights = result.reportInsights?.fixPriority?.filter(item => item.priority === 'fix_first').map(item => item.title) ?? []
  const fallback = result.findings.slice(0, 3).map(item => item.title)
  return (fromInsights.length ? fromInsights : fallback).slice(0, 3)
}

function getRelevantThreatCategories(result: ScanResult): string[] {
  return (result.threatCategories ?? [])
    .filter(item => item.status !== 'not_assessed')
    .slice(0, 6)
    .map(item => `${item.label} (${item.status.replace('_', ' ')})`)
}

function criticalCount(result: ScanResult): number {
  return result.findings.filter(f => f.severity === 'critical').length
}

function highCount(result: ScanResult): number {
  return result.findings.filter(f => f.severity === 'high').length
}

function fingerprintPreview(result: ScanResult): string | null {
  const hash = result.artifactFingerprint?.artifactHash
  return hash ? `${hash.slice(0, 12)}…` : null
}

function printDetailedSummary(result: ScanResult, fileName: string) {
  const verified = result.verdict === 'VERIFIED'
  const verdictColor = verified ? c.green : result.verdict === 'NOT_ASSESSED' ? c.yellow : c.red
  write(`\n${c.bold}${c.cyan}Agent Verify${c.reset}`)
  write(`${c.gray}${fileName}${c.reset}`)
  write(`${c.bold}Score:${c.reset} ${result.riskScore}/100`)
  write(`${c.bold}Verdict:${c.reset} ${verdictColor}${result.verdict === 'NOT_VERIFIED' ? 'NOT VERIFIED' : result.verdict.replace('_', ' ')}${c.reset}`)
  write(`${c.bold}Risk level:${c.reset} ${result.riskLevel}`)
  write(`${c.bold}Confidence:${c.reset} ${result.confidence}/100`)
  write(`${c.bold}Critical / High findings:${c.reset} ${criticalCount(result)} / ${highCount(result)}`)
  if (result.metadata?.scannerVersion) write(`${c.bold}Ruleset version:${c.reset} ${result.metadata.scannerVersion}`)
  if (fingerprintPreview(result)) write(`${c.bold}Artifact fingerprint:${c.reset} ${fingerprintPreview(result)}`)
  if (result.policyProfile) write(`${c.bold}Policy (${result.policyProfile}):${c.reset} ${result.policyResult === 'PASS' ? `${c.green}PASS${c.reset}` : `${c.red}FAIL${c.reset}`}`)
  write(`${c.bold}Top blocker:${c.reset} ${getTopBlocker(result)}`)
  write(`\n${c.bold}Fix first:${c.reset}`)
  const fixes = getFixFirst(result)
  if (fixes.length) fixes.forEach((item, index) => write(`  ${index + 1}. ${item}`))
  else write(`  No blocking fixes detected. Re-scan after any material change.`)
  if (result.reportInsights?.nextAction) write(`\n${c.bold}Next action:${c.reset} ${result.reportInsights.nextAction}`)
  const threats = getRelevantThreatCategories(result)
  if (threats.length) {
    write(`\n${c.bold}Threat categories:${c.reset}`)
    threats.forEach(item => write(`  - ${item}`))
  }
  if (result.saved && result.reportId) write(`${c.bold}View report:${c.reset} https://aimodularity.com/agentverify/report/?id=${result.reportId}`)
  write(`${c.bold}A2SPA docs:${c.reset} ${A2SPA_DOCS_URL}`)
  write(`${c.gray}Re-scan:${c.reset} agentverify scan --file ${fileName} --key $AGENTVERIFY_API_KEY\n`)
}

function markdownSummary(results: Array<{ file: string; result: ScanResult | null; error: string | null }>, summary: { total: number; verified: number; notVerified: number; notAssessed: number; errors: number }): string {
  const lines = ['# Agent Verify', '', `Files scanned: ${summary.total}`, `Verified: ${summary.verified}`, `Not verified: ${summary.notVerified}`, `Not assessed: ${summary.notAssessed}`, `Errors: ${summary.errors}`, '']
  for (const item of results) {
    if (!item.result) {
      lines.push(`## ${item.file}`, '', `Error: ${item.error ?? 'Unknown error'}`, '')
      continue
    }
    lines.push(`## ${item.file}`, '', `Score: ${item.result.riskScore}/100`, `Verdict: ${item.result.verdict === 'NOT_VERIFIED' ? 'NOT VERIFIED' : item.result.verdict.replace('_', ' ')}`, `Risk level: ${item.result.riskLevel}`, `Critical / High findings: ${criticalCount(item.result)} / ${highCount(item.result)}`)
    if (item.result.metadata?.scannerVersion) lines.push(`Ruleset version: ${item.result.metadata.scannerVersion}`)
    if (fingerprintPreview(item.result)) lines.push(`Artifact fingerprint: \`${fingerprintPreview(item.result)}\``)
    if (item.result.policyProfile) lines.push(`Policy (${item.result.policyProfile}): ${item.result.policyResult}`)
    lines.push(`Top blocker: ${getTopBlocker(item.result)}`, '')
    const fixes = getFixFirst(item.result)
    if (fixes.length) lines.push('Fix first:', ...fixes.map((fix, index) => `${index + 1}. ${fix}`), '')
    const threats = getRelevantThreatCategories(item.result)
    if (threats.length) lines.push('Threat categories:', ...threats.map(threat => `- ${threat}`), '')
    if (item.result.reportId) lines.push(`Report: https://aimodularity.com/agentverify/report/?id=${item.result.reportId}`, '')
  }
  lines.push(`A2SPA docs: ${A2SPA_DOCS_URL}`)
  return lines.join('\n')
}

/**
 * Writes a GitHub Actions job summary — the collapsible "Summary" panel shown on a workflow
 * run's page — when GITHUB_STEP_SUMMARY is set (GitHub sets this automatically inside Actions;
 * it's absent everywhere else, so this is a genuine no-op outside CI, not something that needs
 * its own flag). Reuses the same markdownSummary() content, so there is exactly one place that
 * decides what a "summary" contains.
 */
function writeGithubJobSummary(results: Array<{ file: string; result: ScanResult | null; error: string | null }>, summary: { total: number; verified: number; notVerified: number; notAssessed: number; errors: number }) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!summaryPath) return
  try {
    appendFileSync(summaryPath, `${markdownSummary(results, summary)}\n`)
  } catch (e) {
    console.error(`Warning: could not write GitHub job summary: ${e instanceof Error ? e.message : e}`)
  }
}

/** Optional machine-readable summary file (--summary-file <path>) for a caller (e.g. a custom CI step, or the composite Action's PR-comment step) that wants the results without re-parsing stdout. */
function writeSummaryFile(path: string, results: Array<{ file: string; result: ScanResult | null; error: string | null }>, summary: { total: number; verified: number; notVerified: number; notAssessed: number; errors: number }) {
  if (!path) return
  try {
    writeFileSync(path, JSON.stringify({ results, summary }, null, 2))
  } catch (e) {
    console.error(`Warning: could not write summary file: ${e instanceof Error ? e.message : e}`)
  }
}

function printVerdict(result: ScanResult, fileName: string) {
  const verified = result.verdict === 'VERIFIED'
  const notAssessed = result.verdict === 'NOT_ASSESSED'
  const icon = verified ? `${c.green}✓${c.reset}` : notAssessed ? `${c.yellow}⚠${c.reset}` : `${c.red}✗${c.reset}`
  const verdict = verified
    ? `${c.green}VERIFIED${c.reset}    `
    : notAssessed
      ? `${c.yellow}NOT ASSESSED${c.reset}`
      : `${c.red}NOT VERIFIED${c.reset}`
  const score = verified
    ? `${c.green}${result.riskScore}/100${c.reset}`
    : result.riskScore >= 50
      ? `${c.yellow}${result.riskScore}/100${c.reset}`
      : `${c.red}${result.riskScore}/100${c.reset}`
  const findings = result.findings.length > 0
    ? `${c.gray}— ${result.findings.length} finding${result.findings.length === 1 ? '' : 's'}${c.reset}`
    : ''
  const name = fileName.padEnd(30)

  write(`  ${icon} ${verdict}  ${name}  score: ${score}  ${findings}`)

  if (result.saved && result.reportId) {
    write(`    ${c.gray}→ Report: https://aimodularity.com/agentverify/report/?id=${result.reportId}${c.reset}`)
  }
}

async function runScan(args: ReturnType<typeof parseArgs>) {
  if (!args.key) {
    console.error(`\n${c.red}Error:${c.reset} API key required\n`)
    console.error(`  Set with --key av_your_key or AGENTVERIFY_API_KEY env var.`)
    console.error(`  Get your key at https://aimodularity.com/agentverify/dashboard/`)
    console.error(`  Example: AGENTVERIFY_API_KEY=av_your_key agentverify scan .\n`)
    process.exit(EXIT_EXECUTION_ERROR)
  }

  // Collect files
  let files: string[] = []
  if (args.file) {
    files = [args.file]
  } else {
    const dir = args.dir
    if (!args.markdown && !args.json) {
      write(`\n${c.bold}Agent Verify${c.reset} ${c.gray}v${VERSION}${c.reset}`)
      write(`${c.gray}Scanning ${dir}...${c.reset}\n`)
    }
    files = collectFiles(dir)
    if (files.length === 0) {
      write(`${c.yellow}No agent files found in ${dir}${c.reset}`)
      write(`${c.gray}Supported: .js .ts .py .json .yaml .yml .md${c.reset}\n`)
      process.exit(0)
    }
  }

  // Scan files
  const jsonResults: Array<{ file: string; result: ScanResult | null; error: string | null }> = []
  let verified = 0
  let notVerified = 0
  let notAssessed = 0
  let errors = 0

  // Process with concurrency of 3
  const CONCURRENCY = 3
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.allSettled(
      batch.map(async (filePath) => {
        const fileStat = statSync(filePath)
        if (fileStat.size > MAX_SCAN_FILE_BYTES) {
          throw new Error(`File is ${(fileStat.size / 1024 / 1024).toFixed(1)}MB, over the ${MAX_SCAN_FILE_BYTES / 1024 / 1024}MB scan limit — skipped`)
        }
        const content = readFileSync(filePath, 'utf-8')
        const relPath = relative(args.dir === '.' ? process.cwd() : args.dir, filePath)
        const result = await scan(
          { content, fileName: relPath, policyId: args.policy || undefined },
          { apiKey: args.key, apiUrl: API_URL }
        )
        return { filePath, relPath, result }
      })
    )

    for (let j = 0; j < batchResults.length; j++) {
      const outcome = batchResults[j]
      if (outcome.status === 'fulfilled') {
        const { relPath, result } = outcome.value
        if (!args.json && !args.markdown) {
          if (args.file && !args.ci) printDetailedSummary(result, relPath)
          else printVerdict(result, relPath)
        }
        jsonResults.push({ file: relPath, result, error: null })
        if (result.verdict === 'VERIFIED') verified++
        else if (result.verdict === 'NOT_ASSESSED') notAssessed++
        else notVerified++
      } else {
        const filePath = batch[j]
        const relPath = relative(args.dir, filePath)
        const errMsg = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
        if (!args.json) {
          write(`  ${c.yellow}⚠${c.reset}  ${c.yellow}WARNING${c.reset}      ${relPath.padEnd(30)}  ${c.gray}${errMsg}${c.reset}`)
        }
        jsonResults.push({ file: relPath, result: null, error: errMsg })
        errors++
      }
    }
  }

  const summary = { total: files.length, verified, notVerified, notAssessed, errors }
  writeGithubJobSummary(jsonResults, summary)
  writeSummaryFile(args.summaryFile, jsonResults, summary)

  if (args.json) {
    write(JSON.stringify({ results: jsonResults, summary }, null, 2))
    if (errors > 0) process.exit(EXIT_EXECUTION_ERROR)
    if (args.ci) {
      if (notVerified > 0) process.exit(EXIT_NOT_VERIFIED)
      if (notAssessed > 0 && !args.allowNotAssessed) process.exit(EXIT_NOT_ASSESSED)
    }
    return
  }

  if (args.markdown) {
    write(markdownSummary(jsonResults, summary))
    if (errors > 0) process.exit(EXIT_EXECUTION_ERROR)
    if (args.ci) {
      if (notVerified > 0) process.exit(EXIT_NOT_VERIFIED)
      if (notAssessed > 0 && !args.allowNotAssessed) process.exit(EXIT_NOT_ASSESSED)
    }
    return
  }

  // Summary
  const savedReports = jsonResults.filter(item => item.result?.saved && item.result.reportId).length
  write(`\n${c.gray}${'─'.repeat(60)}${c.reset}`)
  write(`${c.bold}Agent Verify Scan Complete${c.reset}`)
  write(`${c.gray}Files scanned:${c.reset}   ${files.length}`)
  write(`${c.green}Verified:${c.reset}        ${verified}`)
  if (notVerified > 0) write(`${c.red}Not Verified:${c.reset}    ${notVerified}`)
  if (notAssessed > 0) write(`${c.yellow}Not Assessed:${c.reset}    ${notAssessed}`)
  if (errors > 0) write(`${c.yellow}Errors:${c.reset}          ${errors}`)
  write(`${c.gray}${'─'.repeat(60)}${c.reset}`)
  if (savedReports > 0) write(`\n${c.gray}Saved CLI reports appear in your dashboard: https://aimodularity.com/agentverify/dashboard/${c.reset}`)
  else write(`\n${c.gray}No dashboard report was saved. Check API key access and retry if you need dashboard sync.${c.reset}`)
  write(`${c.gray}A2SPA docs: ${A2SPA_DOCS_URL}${c.reset}\n`)

  if (errors > 0) process.exit(EXIT_EXECUTION_ERROR)

  if (args.ci) {
    if (notVerified > 0) process.exit(EXIT_NOT_VERIFIED)
    if (notAssessed > 0 && !args.allowNotAssessed) process.exit(EXIT_NOT_ASSESSED)
  }
}

async function main() {
  const args = parseArgs(process.argv)

  if (args.version) {
    write(`agentverify v${VERSION}`)
    process.exit(EXIT_OK)
  }

  if (args.help || !args.command) {
    printHelp()
    process.exit(EXIT_OK)
  }

  if (args.command === 'scan') {
    await runScan(args)
  } else {
    console.error(`\n${c.red}Unknown command: ${args.command}${c.reset}`)
    console.error(`Run ${c.cyan}agentverify --help${c.reset} for usage\n`)
    process.exit(EXIT_EXECUTION_ERROR)
  }
}

main().catch(err => {
  console.error(`\n${c.red}Fatal error:${c.reset}`, err instanceof Error ? err.message : err)
  process.exit(EXIT_EXECUTION_ERROR)
})
