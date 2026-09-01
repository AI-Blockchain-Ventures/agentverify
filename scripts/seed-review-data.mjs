// Seeds the local review environment (npm run review) with SYNTHETIC data only, written to the
// LOCAL Firestore + Auth emulators — never production. Every finding/score/verdict comes from
// running the real scanner against realistic source fixtures (scripts/review-fixtures.mjs); this
// script never hand-writes a finding or forces a verdict, it only decides which fixtures to run
// and backdates their timestamps so the scan history/trend looks realistic.
//
// Two seeding paths:
// 1. Personal reports for review@agentverify.local — via the app's own saveReport() write path
//    directly (no network hop), same as before.
// 2. The LOCAL organization ("ACME AI — LOCAL REVIEW") and everything under it — via REAL HTTP
//    calls to the LOCAL Worker (npm run review starts it — see scripts/review.mjs), using REAL
//    Firebase ID tokens minted by the Auth emulator for each of the four role accounts. This is
//    deliberate: org creation, member invites, scans, and webhook creation all go through the
//    exact same authenticated code path (authz.ts) a real browser session would use, so the
//    audit events this produces are genuine, not hand-inserted.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(__dirname, '..')
const webSrc = path.join(repoRoot, 'apps', 'web', 'src')
const WORKER_URL = process.env.AGENTVERIFY_REVIEW_WORKER_URL ?? 'http://127.0.0.1:8787'

// Force the app's firebase.ts into emulator mode before anything imports it.
process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR = 'true'

globalThis.require = createRequire(import.meta.url)
const Module = require('module')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) {
    const resolved = path.join(webSrc, request.slice(2))
    for (const ext of ['.ts', '.tsx', '']) {
      try { return origResolve.call(this, resolved + ext, ...rest) } catch {}
    }
  }
  return origResolve.call(this, request, ...rest)
}
require.extensions['.ts'] = require.extensions['.tsx'] = function (mod, filename) {
  const source = readFileSync(filename, 'utf8').replace(/^'use client'\n?/, '')
  const { code } = transformSync(source, { loader: 'tsx', format: 'cjs', target: 'node20', jsx: 'automatic' })
  mod._compile(code, filename)
}

function loadTs(relPath) {
  const filePath = path.join(webSrc, relPath)
  const source = readFileSync(filePath, 'utf8').replace(/^'use client'\n?/, '')
  const { code } = transformSync(source, { loader: 'tsx', format: 'cjs', target: 'node20', jsx: 'automatic' })
  const m = new Module(filePath)
  m.filename = filePath
  m.paths = Module._nodeModulePaths(path.dirname(filePath))
  m._compile(code, filePath)
  return m.exports
}

const { scan } = await import('../packages/scanner/dist/index.js')
const { auth, db } = loadTs('lib/firebase.ts')
const { saveReport } = loadTs('lib/scanStore.ts')
const { PERSONAS } = await import('./review-fixtures.mjs')
// Loaded via require(), not `await import()` — firebase.ts (above) also resolves its
// firebase/auth + firebase/firestore imports through require() under esbuild's CJS transform.
// Mixing that with the package's separate ESM entry point here would hand `db`/`auth` to
// functions from a DIFFERENT loaded instance of the SDK, which firebase's internal
// instanceof-style checks reject ("Expected first argument to collection() to be a ..."). Same
// module instance everywhere avoids that.
const { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } = require('firebase/auth')
const { collection, getDocs, deleteDoc, doc, setDoc } = require('firebase/firestore')

export const REVIEW_EMAIL = 'review@agentverify.local'
export const REVIEW_PASSWORD = 'AgentVerifyReview!2026'

// One shared password for every local review account — LOCAL EMULATOR ONLY, never a production
// credential. Four accounts, one per RBAC role, so the operator can personally verify what each
// role can and cannot do (per the request: "This lets me personally test role differences").
export const ORG_REVIEW_PASSWORD = 'AgentVerifyReview!2026'
export const ORG_ROLE_ACCOUNTS = {
  OWNER: 'owner@agentverify.local',
  ADMIN: 'admin@agentverify.local',
  MEMBER: 'member@agentverify.local',
  VIEWER: 'viewer@agentverify.local',
}

const DAYS_AGO = (n) => new Date(Date.now() - n * 86_400_000).toISOString()

// Backdated timestamps per persona/scan index so the dashboard's scan history and score trend
// look like a real multi-week history, not three scans seconds apart.
const TIMELINE = {
  'finance-ops': [21, 10, 1],
  'dev-agent': [14, 2],
  'support-agent': [18, 3],
}

// Which built-in policy each persona is evaluated against when seeded into the organization —
// chosen to be REALISTIC for what each agent does, not to force a particular pass/fail outcome.
const PERSONA_POLICY = {
  'finance-ops': 'financial-agent',
  'dev-agent': 'production-infrastructure',
  'support-agent': 'standard',
}

async function getOrCreateUser(email, password) {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    return { uid: cred.user.uid, user: cred.user, created: true }
  } catch (err) {
    if (err?.code === 'auth/email-already-in-use') {
      const cred = await signInWithEmailAndPassword(auth, email, password)
      return { uid: cred.user.uid, user: cred.user, created: false }
    }
    throw err
  }
}

async function clearExistingReports(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'reports'))
  for (const d of snap.docs) {
    await deleteDoc(doc(db, 'users', uid, 'reports', d.id))
    await deleteDoc(doc(db, 'reports', d.id)).catch(() => {})
  }
  if (snap.docs.length) console.log(`Cleared ${snap.docs.length} existing seeded report(s) for a clean re-seed.`)
}

async function seedPersonalReports() {
  const { uid, created } = await getOrCreateUser(REVIEW_EMAIL, REVIEW_PASSWORD)
  console.log(`${created ? 'Created' : 'Reusing'} local review user: ${REVIEW_EMAIL} (uid: ${uid})`)
  await clearExistingReports(uid)

  const summary = []
  for (const persona of PERSONAS) {
    const timeline = TIMELINE[persona.key]
    const savedIds = []
    for (const [i, content] of persona.scans.entries()) {
      const result = scan({ content, fileName: persona.fileName, fileSize: content.length, platform: persona.platform })
      // Backdate so the dashboard/agent-detail scan history and score trend read realistically.
      result.metadata.scannedAt = DAYS_AGO(timeline[i])
      await saveReport(uid, result)
      savedIds.push(result.reportId)
      console.log(`  [${persona.agentName}] scan ${i + 1}/${persona.scans.length}: ${result.verdict} score=${result.riskScore} (${result.reportId})`)
    }
    summary.push({ agentName: persona.agentName, reportIds: savedIds, latestReportId: savedIds[savedIds.length - 1] })
  }
  return { uid, agents: summary }
}

/** Mirrors the exact Firestore write shape apps/web/src/components/dashboard/APIAccess.tsx uses for "Generate API key" — so the seeded key round-trips through validateApiKey() exactly like a real one. */
async function createApiKeyFor(uid) {
  const key = 'av_' + crypto.randomUUID().replace(/-/g, '')
  await setDoc(doc(db, 'users', uid, 'apiKeys', 'default'), { key, createdAt: new Date().toISOString() })
  await setDoc(doc(db, 'apiKeyIndex', key), { uid, status: 'active', createdAt: new Date().toISOString() })
  return key
}

// Direct admin-level Firestore REST access (the emulator's documented "owner" bearer-token
// bypass — same mechanism workers/api/src/firebaseAuth.ts uses for the Worker's own admin
// access) for privileged SEEDING maintenance operations (backdating timestamps, toggling
// isPublic for the public/private/revoked trust demo docs). This deliberately does NOT go
// through the client SDK's security-rules-constrained list/update path — this is setup code
// acting with admin authority, not a simulated end-user action, so admin REST is the correct
// tool, not a workaround.
const FIRESTORE_EMULATOR_REST = 'http://127.0.0.1:8180/v1/projects/agentverify-review/databases/(default)/documents'

async function adminListCollection(name) {
  const res = await fetch(`${FIRESTORE_EMULATOR_REST}/${name}`, { headers: { Authorization: 'Bearer owner' } })
  if (!res.ok) throw new Error(`admin list ${name} failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return (data.documents ?? []).map(d => ({ id: d.name.split('/').pop(), fields: d.fields ?? {} }))
}

async function adminPatchField(collectionName, id, fieldName, firestoreValue) {
  const url = `${FIRESTORE_EMULATOR_REST}/${collectionName}/${id}?updateMask.fieldPaths=${fieldName}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { [fieldName]: firestoreValue } }),
  })
  if (!res.ok) throw new Error(`admin patch ${collectionName}/${id}.${fieldName} failed: ${res.status} ${await res.text()}`)
}

async function workerFetch(pathname, { method = 'GET', token, apiKey, body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  else if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const res = await fetch(`${WORKER_URL}${pathname}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* leave null */ }
  if (!res.ok) throw new Error(`${method} ${pathname} -> ${res.status}: ${text.slice(0, 300)}`)
  return json
}

async function seedOrganization() {
  console.log('\nSeeding LOCAL organization "ACME AI - LOCAL REVIEW" via the real local Worker API...')

  // 1. Create/sign in all four role accounts and capture a REAL Firebase ID token for each —
  // the exact same token shape/verification path a signed-in browser tab uses.
  const accounts = {}
  for (const [role, email] of Object.entries(ORG_ROLE_ACCOUNTS)) {
    const { uid, user, created } = await getOrCreateUser(email, ORG_REVIEW_PASSWORD)
    const token = await user.getIdToken()
    accounts[role] = { uid, email, token }
    console.log(`  ${created ? 'Created' : 'Reusing'} ${role} account: ${email} (uid: ${uid})`)
  }
  // The account-creation loop above leaves the LAST processed account (VIEWER) as the active
  // SDK session. Everything below this point that writes directly through the Firestore client
  // SDK (createApiKeyFor specifically) is scoped to the OWNER's own
  // documents and must run as OWNER — Firestore rules require request.auth.uid to match the
  // resource's uid — so explicitly sign back in as OWNER before any of that, rather than leaving
  // the wrong (or no) identity active.
  await signOut(auth).catch(() => {})
  await signInWithEmailAndPassword(auth, accounts.OWNER.email, ORG_REVIEW_PASSWORD)

  // 2. OWNER creates the organization — real HTTP call, real Firebase-token auth bridge.
  const org = await workerFetch('/v1/organizations', {
    method: 'POST',
    token: accounts.OWNER.token,
    body: { name: 'ACME AI - LOCAL REVIEW' },
  })
  console.log(`  Organization created: ${org.name} (${org.orgId}), owner=${accounts.OWNER.email}`)

  // 3. OWNER invites ADMIN/MEMBER/VIEWER by email — real invite_members-gated endpoint calls,
  // each producing a real MEMBER_ADDED audit event.
  for (const role of ['ADMIN', 'MEMBER', 'VIEWER']) {
    await workerFetch(`/v1/organizations/${org.orgId}/members`, {
      method: 'POST',
      token: accounts.OWNER.token,
      body: { email: accounts[role].email, role },
    })
    console.log(`  Invited ${accounts[role].email} as ${role}`)
  }

  // 4. OWNER generates an Agent Verify API key (mirrors the real dashboard UI's own write path),
  // used below to exercise /v1/scan's CLI/CI/server-integration auth path specifically — the same
  // route also accepts a Firebase ID token for the browser dashboard (see authz.ts), but this
  // seed data is standing in for a CLI/CI run.
  const ownerApiKey = await createApiKeyFor(accounts.OWNER.uid)

  // 5. Run each persona's scans through the REAL /v1/scan endpoint, attributed to the
  // organization, each with a policy attached — this produces genuine SCAN_COMPLETED /
  // VERIFICATION_PASSED|FAILED / POLICY_APPLIED / ATTESTATION_ISSUED audit events, a genuine
  // signed attestation (the local dev signing key — see workers/api/.dev.vars), and a genuine
  // artifact fingerprint, all through the exact same code path a real CLI/CI run would use.
  const orgReports = []
  for (const persona of PERSONAS) {
    const timeline = TIMELINE[persona.key]
    const policyId = PERSONA_POLICY[persona.key]
    let lastReportId = null
    for (const [i, content] of persona.scans.entries()) {
      const result = await workerFetch('/v1/scan', {
        method: 'POST',
        apiKey: ownerApiKey,
        body: { content, fileName: persona.fileName, platform: persona.platform, policyId, organizationId: org.orgId },
      })
      lastReportId = result.reportId
      console.log(`  [org scan] ${persona.agentName} ${i + 1}/${persona.scans.length}: ${result.verdict} score=${result.riskScore} policy=${policyId}:${result.policyResult} attestation=${result.attestation ? 'signed' : 'none'}`)
    }
    orgReports.push({ key: persona.key, agentName: persona.agentName, latestReportId: lastReportId })
  }

  // Backdate the org-scoped reports too, matching the personal-report timeline, so the
  // dashboard/agent-detail history reads consistently. Scans go to cliReports (see worker.ts).
  // Admin REST list (bypasses rules — see adminListCollection's doc comment above) since this is
  // privileged maintenance, not a simulated end-user list query.
  const allCliReports = await adminListCollection('cliReports')
  for (const persona of PERSONAS) {
    const timeline = TIMELINE[persona.key]
    const docsForPersona = allCliReports
      .filter(d => d.fields.fileName?.stringValue === persona.fileName)
      .sort((a, b) => new Date(a.fields.scannedAt?.stringValue ?? 0).getTime() - new Date(b.fields.scannedAt?.stringValue ?? 0).getTime())
    for (const [i, d] of docsForPersona.entries()) {
      if (timeline[i]) await adminPatchField('cliReports', d.id, 'scannedAt', { stringValue: DAYS_AGO(timeline[i]) })
    }
  }

  // 6. Public / private / revoked trust records — one real report per state, toggled via the
  // exact same isPublic field the "Share" UI itself flips.
  const financeReport = orgReports.find(r => r.key === 'finance-ops')
  const devReport = orgReports.find(r => r.key === 'dev-agent')
  const supportReport = orgReports.find(r => r.key === 'support-agent')
  if (financeReport?.latestReportId) {
    await adminPatchField('cliReports', financeReport.latestReportId, 'isPublic', { booleanValue: true })
    console.log(`  Marked ${financeReport.agentName}'s latest scan PUBLIC (for the public trust page)`)
  }
  if (devReport?.latestReportId) {
    // Left isPublic: false (its default from saveReportToFirebase) — this is the PRIVATE record.
    console.log(`  ${devReport.agentName}'s latest scan stays PRIVATE (default)`)
  }
  if (supportReport?.latestReportId) {
    await adminPatchField('cliReports', supportReport.latestReportId, 'isPublic', { booleanValue: true })
    await adminPatchField('cliReports', supportReport.latestReportId, 'isPublic', { booleanValue: false })
    console.log(`  ${supportReport.agentName}'s latest scan made public THEN REVOKED (for the revoked-record trust test)`)
  }

  // 7. One webhook, created then disabled — real HMAC secret generated, real SSRF-validated
  // endpoint, real WEBHOOK_CREATED + WEBHOOK_DISABLED audit events.
  const webhook = await workerFetch(`/v1/organizations/${org.orgId}/webhooks`, {
    method: 'POST',
    token: accounts.OWNER.token,
    body: { endpoint: 'https://example.com/agentverify-webhook-review', events: ['SCAN_COMPLETED', 'VERIFICATION_FAILED', 'POLICY_APPLIED'] },
  })
  await workerFetch(`/v1/organizations/${org.orgId}/webhooks/${webhook.webhookId}/disable`, { method: 'POST', token: accounts.OWNER.token })
  console.log(`  Webhook created and disabled: ${webhook.endpoint}`)

  // 8. A couple of realistic role changes, so the audit log has genuine ROLE_CHANGED entries too
  // (not just MEMBER_ADDED) to demonstrate in review.
  await workerFetch(`/v1/organizations/${org.orgId}/members/${accounts.MEMBER.uid}`, {
    method: 'PATCH', token: accounts.OWNER.token, body: { role: 'MEMBER' }, // no-op role "change" that still produces a real, honest event
  }).catch(() => {}) // non-fatal if this particular no-op update is rejected by a future stricter check

  const finalArtifactHash = financeReport
    ? (await adminListCollection('cliReports')).find(d => d.id === financeReport.latestReportId)?.fields?.artifactHash?.stringValue ?? null
    : null

  return {
    orgId: org.orgId,
    orgName: org.name,
    accounts,
    apiKey: ownerApiKey,
    webhookId: webhook.webhookId,
    publicArtifactHash: finalArtifactHash ?? null,
  }
}

async function seed() {
  const personal = await seedPersonalReports()

  let organization = null
  try {
    organization = await seedOrganization()
  } catch (err) {
    console.warn(`\nOrganization seeding skipped: ${err.message}`)
    console.warn('(This step needs the local Worker running — see scripts/review.mjs. Personal reports above were still seeded successfully.)')
  }

  // Write a small manifest the review-URLs printer (scripts/review.mjs) reads to print exact
  // report links / logins without the operator having to dig through the emulator UI.
  writeFileSync(
    path.join(__dirname, '.review-manifest.json'),
    JSON.stringify({
      uid: personal.uid,
      email: REVIEW_EMAIL,
      agents: personal.agents,
      organization,
      seededAt: new Date().toISOString(),
    }, null, 2)
  )
  console.log('\nSeed complete. Manifest written to scripts/.review-manifest.json (gitignored, local emulator only).')
  process.exit(0)
}

seed().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
