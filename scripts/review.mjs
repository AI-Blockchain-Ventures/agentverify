// npm run review — one command that starts a fully local, synthetic-data-only review
// environment: Firebase Auth + Firestore emulators, the local Worker/API (wrangler dev, pointed
// at those emulators), seeded with local review users/organization/agents/policies/webhooks, and
// the web app pointed at the LOCAL Worker (never the real production API). Nothing here touches
// production Firebase, Cloudflare, Stripe, GitHub, or any external webhook endpoint — no real
// credential is used or stored.
import { spawn, execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(__dirname, '..')
const isWindows = process.platform === 'win32'

const WORKER_PORT = 8787
const WORKER_URL = `http://127.0.0.1:${WORKER_PORT}`
const REVIEW_PROJECT_ID = 'agentverify-review'

const children = []
let shuttingDown = false

// On Windows, killing the direct child (a shell / npx wrapper) does NOT kill the process tree
// beneath it — the Firestore emulator's own Java process and wrangler's workerd subprocess in
// particular are left running and holding their ports, breaking the next `npm run review`.
// Force-kill the whole tree per child.
function killTree(child) {
  if (!child?.pid) return
  if (isWindows) {
    try { execSync(`taskkill /pid ${child.pid} /t /f`, { stdio: 'ignore' }) } catch {}
  } else {
    try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch {} }
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  console.log('\nStopping review environment (web app + local Worker + emulators)...')
  for (const child of children) killTree(child)
  setTimeout(() => process.exit(code), 800)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { cwd: repoRoot, stdio: 'inherit', shell: true, ...opts })
  children.push(child)
  return child
}

function waitForOutput(cmd, args, matchText, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: repoRoot, shell: true, ...opts })
    children.push(child)
    let seen = false
    const onData = (buf) => {
      const text = buf.toString()
      process.stdout.write(text)
      if (!seen && text.includes(matchText)) {
        seen = true
        resolve(child)
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code) => {
      if (!seen) reject(new Error(`${cmd} exited (code ${code}) before it became ready`))
    })
  })
}

// If a previous run was killed uncleanly (e.g. the terminal was closed instead of Ctrl+C), a
// stray emulator/worker process can be left holding one of these ports. Clear them proactively
// so this command is reliably re-runnable without the operator having to hunt down a PID.
function freePortWindows(port) {
  try {
    const out = execSync(`netstat -ano -p tcp | findstr :${port}`, { encoding: 'utf8' })
    const pids = new Set(out.split('\n').map(line => line.trim().split(/\s+/).pop()).filter(pid => pid && /^\d+$/.test(pid)))
    for (const pid of pids) {
      try { execSync(`taskkill /pid ${pid} /f`, { stdio: 'ignore' }) } catch {}
    }
  } catch {
    // findstr exits non-zero when nothing matches — port is already free, nothing to do.
  }
}

function freeReviewPorts() {
  if (!isWindows) return // POSIX systems don't show this failure mode the same way; skip.
  for (const port of [8180, 9099, 4001, 4400, 4500, 9150, 3000, WORKER_PORT]) freePortWindows(port)
}

function ensureDevSigningKey() {
  const devVarsPath = path.join(repoRoot, 'workers', 'api', '.dev.vars')
  const hasKey = existsSync(devVarsPath) && readFileSync(devVarsPath, 'utf8').includes('ATTESTATION_SIGNING_PRIVATE_KEY_JWK')
  if (hasKey) return
  console.log('No local attestation signing key found — generating a DEV-ONLY one...\n')
  execSync('node scripts/generate-dev-signing-key.mjs', { cwd: path.join(repoRoot, 'workers', 'api'), stdio: 'inherit' })
}

// wrangler's local D1 simulation starts as a genuinely empty SQLite file — the billing schema
// (workers/api/schema/billing.sql) has never been auto-applied to it before. Without this, every
// scan quota check throws (SQLITE_ERROR: no such table), which the scan endpoint's outer
// try/catch quietly turns into a generic 400 — this is exactly the failure that made the very
// first version of this harness hard to debug, so it's applied unconditionally and idempotently
// (CREATE TABLE IF NOT EXISTS) on every run rather than only "if missing".
function ensureLocalBillingSchema() {
  console.log('Ensuring local D1 billing schema is applied (idempotent)...\n')
  try {
    execSync('npx wrangler d1 execute BILLING_DB --local --file=schema/billing.sql', {
      cwd: path.join(repoRoot, 'workers', 'api'),
      stdio: 'pipe',
    })
  } catch (e) {
    console.warn('Warning: could not apply local D1 billing schema — scan quota checks may fail.')
    console.warn((e.stdout ?? e.message ?? '').toString().slice(0, 500))
  }
}

async function main() {
  console.log('=== Agent Verify local review environment ===')
  console.log('LOCAL REVIEW ENVIRONMENT — nothing here touches production.\n')
  freeReviewPorts()
  ensureDevSigningKey()
  ensureLocalBillingSchema()

  console.log('1/4 Starting Firebase Auth + Firestore emulators (local only, project: ' + REVIEW_PROJECT_ID + ')...\n')
  await waitForOutput(
    'npx',
    ['firebase-tools@13', 'emulators:start', '--only', 'firestore,auth', '--project', REVIEW_PROJECT_ID],
    'All emulators ready'
  )

  console.log('\n2/4 Starting the local Worker/API (wrangler dev, pointed at the local emulators)...\n')
  await waitForOutput(
    'npx',
    [
      'wrangler', 'dev', '--port', String(WORKER_PORT),
      '--var', `FIREBASE_PROJECT_ID:${REVIEW_PROJECT_ID}`,
      '--var', 'FIRESTORE_EMULATOR_HOST:127.0.0.1:8180',
      '--var', 'FIREBASE_AUTH_EMULATOR_HOST:127.0.0.1:9099',
      '--var', 'FIREBASE_API_KEY:agentverify-review-local-key',
    ],
    'Ready on',
    { cwd: path.join(repoRoot, 'workers', 'api') }
  )

  console.log('\n3/4 Seeding synthetic review data (real scanner + real local Worker calls, backdated timestamps)...\n')
  await new Promise((resolve, reject) => {
    const seed = spawn('node', ['scripts/seed-review-data.mjs'], {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, AGENTVERIFY_REVIEW_WORKER_URL: WORKER_URL },
    })
    seed.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`seed script exited with code ${code}`))))
  })

  console.log('\n4/4 Starting the web app against the local emulators + local Worker...\n')
  run('npm', ['run', 'dev', '--workspace=apps/web'], {
    env: {
      ...process.env,
      NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true',
      // getApiBaseUrl() (apps/web/src/lib/billing.ts) expects the BASE origin, no path — used for
      // billing status/checkout/portal calls and the /verify page's verification-status lookup.
      NEXT_PUBLIC_AGENTVERIFY_API_URL: WORKER_URL,
    },
  })

  let manifest = null
  try {
    manifest = JSON.parse(readFileSync(path.join(__dirname, '.review-manifest.json'), 'utf8'))
  } catch {}

  const verifyUrl = manifest?.organization?.publicArtifactHash
    ? `http://localhost:3000/agentverify/verify/?hash=${manifest.organization.publicArtifactHash}`
    : '(finishes seeding above — see the public verification link printed there once ready)'

  console.log(`
=================================================================
  LOCAL REVIEW ENVIRONMENT — nothing here touches production.

  Once "Ready" appears below, open: http://localhost:3000/agentverify/

  LOCAL REVIEW LOGINS (emulator only — never production):
    Personal account:  review@agentverify.local / AgentVerifyReview!2026
    OWNER:             owner@agentverify.local  / AgentVerifyReview!2026
    ADMIN:             admin@agentverify.local  / AgentVerifyReview!2026
    MEMBER:            member@agentverify.local / AgentVerifyReview!2026
    VIEWER:            viewer@agentverify.local / AgentVerifyReview!2026

  Public verification page (local Worker, not production):
    ${verifyUrl}

  Local Worker/API:       ${WORKER_URL}
  Firestore/Auth Emulator UI (inspect raw data): http://127.0.0.1:4001

  Press Ctrl+C to stop everything (web app + local Worker + emulators).
=================================================================
`)
}

main().catch((err) => {
  console.error('\nFailed to start review environment:', err.message)
  shutdown(1)
})
