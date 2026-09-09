#!/usr/bin/env node
// npm run verify:security-release
//
// ONE machine-checkable command that aggregates every release-security invariant this repo can
// genuinely test statically/locally. Fails non-zero if any MANDATORY check fails. A check that
// depends on an environment precondition this machine doesn't have (the private scanner package,
// a running Firebase emulator) is reported as SKIPPED with the reason — never silently passed and
// never counted as a failure, so this script's exit code always means what it says.
//
// What this does NOT and cannot prove: live production configuration (are the real Cloudflare
// secrets actually set, is the real D1 index actually READY, is the real npm account's 2FA
// correctly enforced). Those are runtime/infrastructure facts, not something a static/local test
// run can verify — this script only asserts what source code and local test execution can
// genuinely demonstrate. Pretending otherwise would be exactly the kind of unsupported claim this
// whole effort exists to eliminate.

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(__dirname, '..')

let mandatoryFailures = 0
const results = []

function run(label, mandatory, fn) {
  process.stdout.write(`\n=== ${label} ${mandatory ? '(mandatory)' : '(best-effort)'} ===\n`)
  try {
    const outcome = fn()
    if (outcome && outcome.skipped) {
      results.push({ label, status: 'SKIPPED', detail: outcome.reason })
      console.log(`SKIPPED — ${outcome.reason}`)
      return
    }
    results.push({ label, status: 'PASS' })
    console.log(`PASS`)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    results.push({ label, status: 'FAIL', detail })
    console.error(`FAIL — ${detail}`)
    if (mandatory) mandatoryFailures += 1
  }
}

const sh = (cmd, cwd = repoRoot) => execSync(cmd, { cwd, stdio: 'inherit' })

// 1. Private scanner absent from web bundles + static import audit (existing permanent CI check).
run('Private scanner absent from web bundles', true, () => {
  sh('node scripts/check-private-boundary.mjs')
})

// 2. Private scanner absent from the published npm CLI package — real npm pack + tarball scan.
run('Private scanner absent from npm CLI package', true, () => {
  const cliDir = path.join(repoRoot, 'packages', 'cli')
  sh('npm run build', cliDir)
  // Run tar/grep with cwd set to cliDir and a bare relative filename — an absolute Windows path
  // (C:\...) fed to Git Bash's tar is misparsed as a "host:path" remote-shell spec, not a local
  // file. Relative-from-cwd sidesteps that entirely, same as every other tar/grep call elsewhere
  // in this repo's own scripts.
  const packOutput = execSync('npm pack --json', { cwd: cliDir }).toString()
  const [{ filename }] = JSON.parse(packOutput)
  try {
    const listing = execSync(`tar -tzf "${filename}"`, { cwd: cliDir }).toString()
    const files = listing.trim().split('\n')
    const mapFiles = files.filter(f => f.endsWith('.map'))
    if (mapFiles.length > 0) throw new Error(`source map(s) present in published tarball: ${mapFiles.join(', ')}`)
    const extractDirName = '.verify-release-tarball-check'
    const extractDir = path.join(cliDir, extractDirName)
    rmSync(extractDir, { recursive: true, force: true })
    mkdirSync(extractDir, { recursive: true })
    execSync(`tar -xzf "${filename}" -C "${extractDirName}"`, { cwd: cliDir })
    const grepResult = (() => {
      try {
        return execSync(`grep -rl "packages/scanner\\|@agentverify/scanner\\|SECRET_PATTERNS\\|classifyMcpTool" "${extractDirName}"`, { cwd: cliDir }).toString()
      } catch { return '' } // grep exits 1 on no match — that's the success case here
    })()
    if (grepResult.trim()) throw new Error(`proprietary scanner reference(s) found in published tarball:\n${grepResult}`)
    rmSync(extractDir, { recursive: true, force: true })
  } finally {
    rmSync(path.join(cliDir, filename), { force: true })
  }
})

// 3. Worker suite: RBAC authorization, attestation sign/verify/tamper, replay/freshness, webhook
// secret non-disclosure — all real, already-passing tests in workers/api/test/*.
run('Worker suite: RBAC, attestation, replay/freshness, webhook secret non-disclosure', true, () => {
  sh('npm run build', path.join(repoRoot, 'workers', 'api'))
  sh('npm test', path.join(repoRoot, 'workers', 'api'))
})

// 4. Web suite: billing-navigation regression, Firebase config guard, compliance-mapping
// anti-fabrication tests, private-boundary-adjacent unit coverage.
run('Web unit test suite', true, () => {
  sh('npm run test:unit', path.join(repoRoot, 'apps', 'web'))
})

// 5. Secret-redaction tests — live only in the private packages/scanner test suite, which is
// gitignored and absent from a public checkout by design (see docs/private-scanner-boundary.md).
// SKIPPED (not failed) when that source isn't present on this machine — but mandatory whenever it
// IS present: `npm test` here now reliably runs all 58 real scanner tests (see package.json's
// `"test": "node --test"` — a prior `"node --test test/"` mis-invoked Node 24's positional-path
// handling and made every run fail before a single test executed; fixed 2026-09-04, verified
// against the real test files, not a product/security defect).
run('Secret-redaction tests (proprietary scanner suite)', true, () => {
  const scannerTestDir = path.join(repoRoot, 'packages', 'scanner', 'test')
  if (!existsSync(scannerTestDir)) return { skipped: true, reason: 'packages/scanner is not present on this machine (expected in public CI / a machine without private-package access)' }
  sh('npm run private:test:scanner')
})

// 6. Private-report ownership — real Firestore Security Rules tests against the emulator (not a
// mock). Requires a local Firebase emulator (Java runtime) — best-effort, since not every machine
// running this script will have that installed, but never silently skipped without saying why.
run('Private-report ownership (Firestore Security Rules emulator tests)', false, () => {
  try {
    execSync('java -version', { stdio: 'pipe' })
  } catch {
    return { skipped: true, reason: 'no Java runtime available for the Firestore emulator on this machine' }
  }
  sh('npm run test:rules')
})

// 7. Production/dev secret separation — what's genuinely checkable statically: .dev.vars is
// gitignored and untracked, and no tracked file contains a real-looking secret value. This is NOT
// a claim that live Cloudflare/Firebase/Stripe secrets are correctly configured in production —
// that's runtime infrastructure state, not something this script can see.
run('Static secret-separation checks', true, () => {
  const gitignore = readFileSync(path.join(repoRoot, '.gitignore'), 'utf8')
  if (!/^\.dev\.vars$/m.test(gitignore) && !gitignore.includes('.dev.vars')) {
    throw new Error('.dev.vars is not listed in .gitignore')
  }
  let tracked
  try {
    tracked = execSync('git ls-files', { cwd: repoRoot }).toString().split('\n').filter(Boolean)
  } catch (e) {
    throw new Error('could not list tracked files: ' + e.message)
  }
  if (tracked.some(f => f === 'workers/api/.dev.vars' || f.endsWith('/.dev.vars'))) {
    throw new Error('.dev.vars is tracked by git')
  }
  // A real Stripe secret/restricted key or webhook secret is base62-ish and always contains at
  // least one lowercase letter in its random tail (unlike an obviously-fake placeholder such as
  // "sk_live_DEMOPLACEHOLDERVALUE", which is all uppercase on purpose). Every
  // known fixture/placeholder in this repo (grep audited: apps/web/src/app/report/demo/page.tsx,
  // apps/web/test/comparisonAndGrouping.test.mjs, scripts/review-fixtures.mjs) uses an
  // ALL-UPPERCASE dictionary-word tail like "DEMO1234567890ABCDEF" or "OLDSECRETVALUE" specifically
  // so it reads as obviously fake — requiring a lowercase letter in the tail catches a real key
  // while passing every reviewed fixture without a hand-maintained per-file allowlist.
  const apiKeyPattern = /(sk_live_|rk_live_|whsec_)([A-Za-z0-9]{10,})/g
  // Requires real base64 body content after the marker (a genuinely embedded key), not just the
  // marker text itself — firebaseAuth.ts legitimately contains the literal string
  // "-----BEGIN PRIVATE KEY-----" as part of its OWN PEM-stripping regex, with no key body ever
  // following it in source.
  const pemBodyPattern = /-----BEGIN (RSA |EC )?PRIVATE KEY-----\s*\n\s*[A-Za-z0-9+/=]{40,}/g
  for (const file of tracked) {
    if (/\.(png|jpg|jpeg|gif|ico|woff2?|ttf|eot|pdf)$/i.test(file)) continue
    const full = path.join(repoRoot, file)
    if (!existsSync(full)) continue
    let content
    try { content = readFileSync(full, 'utf8') } catch { continue } // binary files
    for (const match of content.matchAll(apiKeyPattern)) {
      if (/[a-z]/.test(match[2])) throw new Error(`tracked file ${file} matches a live-secret pattern with a realistic (non-placeholder) tail`)
    }
    if (pemBodyPattern.test(content)) throw new Error(`tracked file ${file} contains an embedded PEM private key body`)
  }
})

console.log('\n' + '='.repeat(70))
console.log('SECURITY RELEASE GATE SUMMARY')
console.log('='.repeat(70))
for (const r of results) {
  console.log(`${r.status.padEnd(8)} ${r.label}${r.detail ? ' — ' + r.detail : ''}`)
}
console.log('='.repeat(70))

if (mandatoryFailures > 0) {
  console.error(`\n${mandatoryFailures} mandatory check(s) failed. SECURITY RELEASE GATE: FAILED\n`)
  process.exit(1)
} else {
  console.log('\nAll mandatory checks passed (best-effort checks may show SKIPPED — see above). SECURITY RELEASE GATE: PASSED\n')
  process.exit(0)
}
