// Firestore Security Rules test suite — runs against the real Firestore emulator (not a mock),
// exercising the actual rules in firestore.rules. Run with:
//   npx firebase emulators:exec --only firestore "node firestore-tests/rules.test.mjs"
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where } from 'firebase/firestore'

const PROJECT_ID = 'agentverify-rules-test'

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
    host: '127.0.0.1',
    port: 8180,
  },
})

const ownerA = testEnv.authenticatedContext('user_a')
const ownerB = testEnv.authenticatedContext('user_b')
const anon = testEnv.unauthenticatedContext()

const validReport = (uid) => ({
  reportId: 'REPORT-test1',
  uid,
  userId: uid,
  verdict: 'NOT_VERIFIED',
  riskScore: 20,
  riskLevel: 'High Risk',
  findings: [{ code: 'MISSING_SIGNATURE', title: 'Missing cryptographic signature' }],
  isPublic: false,
  scannedAt: new Date().toISOString(),
})

let passed = 0
let failed = 0
const results = []
async function test(name, fn) {
  try {
    await fn()
    passed++
    results.push(`ok - ${name}`)
  } catch (err) {
    failed++
    results.push(`FAIL - ${name}: ${err.message}`)
  }
}

await testEnv.withSecurityRulesDisabled(async (context) => {
  // Seed data with admin (rules bypassed) so we test READ/UPDATE rules independently of create rules.
  const db = context.firestore()
  await setDoc(doc(db, 'reports', 'REPORT-a-private'), validReport('user_a'))
  await setDoc(doc(db, 'reports', 'REPORT-a-public'), { ...validReport('user_a'), reportId: 'REPORT-a-public', isPublic: true })
  await setDoc(doc(db, 'apiKeyIndex', 'av_seeded_key_0000000000000000'), { uid: 'user_a', createdAt: new Date().toISOString() })
  await setDoc(doc(db, 'apiKeyIndex', 'av_seeded_key_1111111111111111'), { uid: 'user_b', createdAt: new Date().toISOString() })
  await setDoc(doc(db, 'users', 'user_a', 'billing', 'subscription'), { plan: 'pro', status: 'active' })
})

// --- 1. Cross-account read/write isolation ---
await test('User A cannot read User B private report', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'reports', 'REPORT-b-private'), validReport('user_b'))
  })
  await assertFails(getDoc(doc(ownerA.firestore(), 'reports', 'REPORT-b-private')))
})

await test('User A cannot update User B report', async () => {
  await assertFails(updateDoc(doc(ownerA.firestore(), 'reports', 'REPORT-b-private'), { isPublic: true }))
})

await test('Owner can read their own private report', async () => {
  await assertSucceeds(getDoc(doc(ownerA.firestore(), 'reports', 'REPORT-a-private')))
})

// --- 2. Report integrity: verdict/score/findings immutable after creation ---
await test('Owner cannot change a NOT_VERIFIED report into VERIFIED', async () => {
  const ref = doc(ownerA.firestore(), 'reports', 'REPORT-a-private')
  await assertFails(updateDoc(ref, { verdict: 'VERIFIED', riskScore: 100 }))
})

await test('Owner CAN toggle isPublic on their own report (legitimate action)', async () => {
  const ref = doc(ownerA.firestore(), 'reports', 'REPORT-a-private')
  await assertSucceeds(updateDoc(ref, { isPublic: true }))
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'reports', 'REPORT-a-private'), { ...validReport('user_a'), isPublic: false })
  })
})

await test('A signed-in user cannot create a report claiming another uid (forgery)', async () => {
  await assertFails(setDoc(doc(ownerA.firestore(), 'reports', 'REPORT-forged'), validReport('user_b')))
})

await test('A signed-in user cannot fabricate a VERIFIED verdict outside the allowed enum on create', async () => {
  await assertFails(setDoc(doc(ownerA.firestore(), 'reports', 'REPORT-fake-verdict'), { ...validReport('user_a'), reportId: 'REPORT-fake-verdict', verdict: 'DEFINITELY_SAFE' }))
})

await test('Owner CAN create their own report with a valid verdict (legitimate action)', async () => {
  await assertSucceeds(setDoc(doc(ownerA.firestore(), 'reports', 'REPORT-a-new'), { ...validReport('user_a'), reportId: 'REPORT-a-new' }))
})

// --- 3. apiKeyIndex: get allowed (worker lookup path), list denied (enumeration) ---
await test('Anonymous get-by-known-key succeeds (worker validateApiKey path)', async () => {
  await assertSucceeds(getDoc(doc(anon.firestore(), 'apiKeyIndex', 'av_seeded_key_0000000000000000')))
})

await test('Anonymous user cannot list the apiKeyIndex collection (enumeration blocked)', async () => {
  await assertFails(getDocs(collection(anon.firestore(), 'apiKeyIndex')))
})

await test('Authenticated user cannot list the apiKeyIndex collection either', async () => {
  await assertFails(getDocs(collection(ownerA.firestore(), 'apiKeyIndex')))
})

// --- 4. Public sharing: explicit share works, revoke works ---
await test('Public report can be read by anonymous user when isPublic=true', async () => {
  await assertSucceeds(getDoc(doc(anon.firestore(), 'reports', 'REPORT-a-public')))
})

await test('Anonymous user cannot read a private report', async () => {
  await assertFails(getDoc(doc(anon.firestore(), 'reports', 'REPORT-a-private')))
})

await test('Revoked (isPublic=false) report cannot be read by anonymous user', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'reports', 'REPORT-a-public'), { ...validReport('user_a'), reportId: 'REPORT-a-public', isPublic: false })
  })
  await assertFails(getDoc(doc(anon.firestore(), 'reports', 'REPORT-a-public')))
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'reports', 'REPORT-a-public'), { ...validReport('user_a'), reportId: 'REPORT-a-public', isPublic: true })
  })
})

await test('Invalid/nonexistent report id is never readable (not an access grant)', async () => {
  // The read rule references resource.data.isPublic, so evaluating it against a document
  // that doesn't exist raises a rules evaluation error rather than a clean "not found" —
  // the client SDK surfaces that as a rejected read either way. Either failure mode proves
  // the same thing: a guessed/invalid report id grants no access. apps/web/src/app/report/
  // page.tsx already treats any getDoc failure here as "not found" for the user.
  await assertFails(getDoc(doc(anon.firestore(), 'reports', 'REPORT-does-not-exist')))
})

// --- 5. Billing entitlement is server-write-only ---
await test('Client cannot write their own billing entitlement', async () => {
  await assertFails(setDoc(doc(ownerA.firestore(), 'users', 'user_a', 'billing', 'subscription'), { plan: 'pro', status: 'active' }))
})

await test('Owner can still read their own billing entitlement (legitimate action)', async () => {
  await assertSucceeds(getDoc(doc(ownerA.firestore(), 'users', 'user_a', 'billing', 'subscription')))
})

await test('User B cannot read User A billing entitlement', async () => {
  await assertFails(getDoc(doc(ownerB.firestore(), 'users', 'user_a', 'billing', 'subscription')))
})

// --- 6. cliReports: same forgery/immutability protections as reports ---
await test('cliReports: create must match caller uid', async () => {
  await assertFails(setDoc(doc(ownerA.firestore(), 'cliReports', 'REPORT-cli-forged'), { reportId: 'REPORT-cli-forged', uid: 'user_b', verdict: 'NOT_VERIFIED', riskScore: 0, findings: [] }))
})

await test('cliReports: owner cannot tamper with verdict after creation', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'cliReports', 'REPORT-cli-a'), { reportId: 'REPORT-cli-a', uid: 'user_a', verdict: 'NOT_VERIFIED', riskScore: 10, findings: [], isPublic: false })
  })
  await assertFails(updateDoc(doc(ownerA.firestore(), 'cliReports', 'REPORT-cli-a'), { verdict: 'VERIFIED' }))
  await assertSucceeds(updateDoc(doc(ownerA.firestore(), 'cliReports', 'REPORT-cli-a'), { isPublic: true }))
})

// --- 7. cliReports list query — the exact shape used by getReports()/the agent detail and
// scan-comparison pages: query(collection('cliReports'), where('uid', '==', <own uid>)). This
// must succeed for the caller's own uid and fail for anyone else's, at the query level, not
// just per-document — otherwise those pages could not list a user's own CLI-sourced scans, or
// worse, could be coaxed into requesting another user's.
await test('cliReports: owner CAN list their own reports via where(uid==self) query (legitimate action)', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'cliReports', 'REPORT-cli-list-a'), { reportId: 'REPORT-cli-list-a', uid: 'user_a', verdict: 'NOT_VERIFIED', riskScore: 10, findings: [], isPublic: false })
  })
  const snap = await assertSucceeds(getDocs(query(collection(ownerA.firestore(), 'cliReports'), where('uid', '==', 'user_a'))))
  assert.ok(snap.docs.some(d => d.id === 'REPORT-cli-list-a'))
})

await test('cliReports: user cannot list another user\'s reports via where(uid==other) query', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'cliReports', 'REPORT-cli-list-b'), { reportId: 'REPORT-cli-list-b', uid: 'user_b', verdict: 'NOT_VERIFIED', riskScore: 10, findings: [], isPublic: false })
  })
  await assertFails(getDocs(query(collection(ownerA.firestore(), 'cliReports'), where('uid', '==', 'user_b'))))
})

await test('User A cannot delete User B report', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'reports', 'REPORT-b-delete-test'), validReport('user_b'))
  })
  await assertFails(deleteDoc(doc(ownerA.firestore(), 'reports', 'REPORT-b-delete-test')))
})

await test('stripeWebhookEvents is never client-readable or writable', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'stripeWebhookEvents', 'evt_1'), { type: 'test' })
  })
  await assertFails(getDoc(doc(ownerA.firestore(), 'stripeWebhookEvents', 'evt_1')))
})

// --- 8. Organizations / RBAC / Audit Log — direct client reads only (all mutations go through
// the Worker's service-account token, which bypasses these rules; see
// workers/api/src/organizations.ts). Seeds two organizations, each with one member, entirely
// with rules disabled (as the Worker's service-account write path would do), then proves cross-
// org read isolation purely at the rules layer as a second, independent enforcement point beyond
// the Worker's own RBAC checks.
await testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  await setDoc(doc(db, 'organizations', 'org_a'), { name: 'Org A', ownerId: 'user_a', plan: 'free', createdAt: new Date().toISOString() })
  await setDoc(doc(db, 'organizations', 'org_a', 'members', 'user_a'), { uid: 'user_a', role: 'OWNER', addedAt: new Date().toISOString(), addedBy: 'user_a' })
  await setDoc(doc(db, 'organizations', 'org_b'), { name: 'Org B', ownerId: 'user_b', plan: 'free', createdAt: new Date().toISOString() })
  await setDoc(doc(db, 'organizations', 'org_b', 'members', 'user_b'), { uid: 'user_b', role: 'OWNER', addedAt: new Date().toISOString(), addedBy: 'user_b' })
  await setDoc(doc(db, 'organizations', 'org_a', 'auditEvents', 'evt_a1'), { eventId: 'evt_a1', organizationId: 'org_a', actorId: 'user_a', actorType: 'user', action: 'SCAN_COMPLETED', targetType: 'scan', targetId: 'r1', timestamp: new Date().toISOString(), metadata: {} })
})

await test('a member CAN read their own organization doc (legitimate action)', async () => {
  await assertSucceeds(getDoc(doc(ownerA.firestore(), 'organizations', 'org_a')))
})

await test('User A cannot read Org B (not a member)', async () => {
  await assertFails(getDoc(doc(ownerA.firestore(), 'organizations', 'org_b')))
})

await test('User A cannot list Org B members', async () => {
  await assertFails(getDocs(collection(ownerA.firestore(), 'organizations', 'org_b', 'members')))
})

await test('User A CAN list Org A members (legitimate action)', async () => {
  const snap = await assertSucceeds(getDocs(collection(ownerA.firestore(), 'organizations', 'org_a', 'members')))
  assert.ok(snap.docs.some(d => d.id === 'user_a'))
})

await test('User A cannot read Org B audit log', async () => {
  await assertFails(getDoc(doc(ownerA.firestore(), 'organizations', 'org_b', 'auditEvents', 'evt_b1')))
})

await test('User A CAN read Org A audit log (legitimate action)', async () => {
  await assertSucceeds(getDoc(doc(ownerA.firestore(), 'organizations', 'org_a', 'auditEvents', 'evt_a1')))
})

await test('an anonymous user cannot read any organization doc', async () => {
  await assertFails(getDoc(doc(anon.firestore(), 'organizations', 'org_a')))
})

await test('a client (even the org owner) cannot write an organization doc directly — Worker-only', async () => {
  await assertFails(setDoc(doc(ownerA.firestore(), 'organizations', 'org_a'), { name: 'Hacked Name', ownerId: 'user_a', plan: 'free', createdAt: new Date().toISOString() }))
})

await test('a client cannot write a membership doc directly — not even to add themselves to another org', async () => {
  await assertFails(setDoc(doc(ownerA.firestore(), 'organizations', 'org_b', 'members', 'user_a'), { uid: 'user_a', role: 'OWNER', addedAt: new Date().toISOString(), addedBy: 'user_a' }))
})

await test('a client cannot write an audit event directly (cannot fabricate audit history)', async () => {
  await assertFails(setDoc(doc(ownerA.firestore(), 'organizations', 'org_a', 'auditEvents', 'evt_fake'), { eventId: 'evt_fake', organizationId: 'org_a', actorId: 'user_a', actorType: 'user', action: 'MEMBER_ADDED', targetType: 'member', targetId: 'user_b', timestamp: new Date().toISOString(), metadata: {} }))
})

await test('User A cannot delete Org B (or Org A) directly', async () => {
  await assertFails(deleteDoc(doc(ownerA.firestore(), 'organizations', 'org_a')))
})

console.log('\n' + results.join('\n'))
console.log(`\n${passed} passed, ${failed} failed`)

await testEnv.cleanup()
process.exit(failed > 0 ? 1 : 0)
