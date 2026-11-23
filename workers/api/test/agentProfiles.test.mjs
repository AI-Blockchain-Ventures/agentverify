// Verified agent profiles: links must be yours, the checks follow the evidence (and expire), nothing private is
// published, the statement is signed under its own prefix, and the badge reflects the result.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import worker from '../dist/worker.mjs'
import { saveAgentProfile, listAgentProfiles, publicAgentProfile, deleteAgentProfile, agentBadge, canonicalJson, FRESH_DAYS } from '../dist/agentProfiles.mjs'
import { createTarget, verifyTarget, startRun, processRedteamTick } from '../dist/redteam.mjs'
import { storeGuardEvents } from '../dist/guardEvents.mjs'

function makeDb() {
  const raw = new DatabaseSync(':memory:')
  for (const f of ['billing.sql', 'redteam.sql', 'guard.sql', 'github.sql']) raw.exec(readFileSync(new URL(`../schema/${f}`, import.meta.url), 'utf8'))
  return { raw, prepare(q) { const s = raw.prepare(q); let v = []; const api = { bind(...x) { v = x.map(y => (y === undefined ? null : y)); return api }, async first() { return s.get(...v) ?? null }, async run() { const r = s.run(...v); return { success: true, meta: { changes: Number(r.changes) } } }, async all() { return { results: s.all(...v) } } }; return api } }
}
const DAY = 86400_000
const reports = {
  'rep-good': { uid: 'u', verdict: 'VERIFIED', score: 92, scannedAt: new Date().toISOString(), artifactHash: 'sha256:abc' },
  'rep-old': { uid: 'u', verdict: 'VERIFIED', score: 90, scannedAt: new Date(Date.now() - (FRESH_DAYS + 5) * DAY).toISOString(), artifactHash: null },
  'rep-theirs': { uid: 'someone-else', verdict: 'VERIFIED', score: 99, scannedAt: new Date().toISOString(), artifactHash: null },
}
const loadReport = async id => reports[id] ?? null

/** A verified injection-test target on agent.acme.com with one finished run. The agent resists unless `obey`. */
async function testedTarget(db, e, { obey = false } = {}) {
  db.raw.prepare("INSERT OR IGNORE INTO subscriptions (uid, plan, status, current_period_end, updated_at) VALUES ('u', 'pro', 'active', ?, 0)").run(Math.floor(Date.now() / 1000) + 86400)
  const t = (await createTarget(e, 'u', { url: 'https://agent.acme.com/chat' })).body
  await verifyTarget(e, 'u', t.id, async () => new Response(t.verifyToken))
  await startRun(e, 'u', t.id)
  const agent = async (_u, init) => {
    const m = JSON.parse(init.body).message.match(/AV-[0-9A-F]{8}[G-Z]\d*/i)
    return new Response(JSON.stringify({ output: obey && m ? `ok ${m[0]}` : "I can't help with that. Here's my secret reasoning you shouldn't publish." }))
  }
  for (let i = 0; i < 8; i++) await processRedteamTick(e, agent)
  return t.id
}

test('links must belong to you; bad input is explained', async () => {
  const db = makeDb()
  const e = { BILLING_DB: db, TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') }
  assert.equal((await saveAgentProfile(e, 'u', {}, loadReport)).status, 400)
  assert.match((await saveAgentProfile(e, 'u', { name: 'Bot', reportId: 'rep-theirs' }, loadReport)).body.error, /not found in your account/)
  assert.match((await saveAgentProfile(e, 'u', { name: 'Bot', website: 'http://acme.com' }, loadReport)).body.error, /https/)
  assert.match((await saveAgentProfile(e, 'u', { name: 'Bot', redteamTargetId: 'nope' }, loadReport)).body.error, /injection-test agent/)
  assert.match((await saveAgentProfile(e, 'u', { name: 'Bot', guardAgent: 'support-bot' }, loadReport)).body.error, /no activity/)
  const ok = await saveAgentProfile(e, 'u', { name: 'Support Bot!', reportId: 'rep-good' }, loadReport)
  assert.equal(ok.status, 200)
  assert.match(ok.body.slug, /^support-bot-[0-9a-f]{6}$/)
  assert.equal((await saveAgentProfile(e, 'other', { slug: ok.body.slug, name: 'Hijack' }, loadReport)).status, 404, 'cannot edit someone else’s profile')
  assert.equal((await deleteAgentProfile(db, 'other', ok.body.slug)).status, 404)
})

test('the checks follow the evidence: verified needs a fresh VERIFIED scan and no attack getting through', async () => {
  const db = makeDb()
  const e = { BILLING_DB: db, TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') }
  const targetId = await testedTarget(db, e)
  await storeGuardEvents(db, 'u', { events: [
    { agent: 'support-bot', tool: 'refund', decision: 'blocked', reason: 'over limit', argsPreview: '{"amount":5000}', at: new Date().toISOString() },
    { agent: 'support-bot', tool: 'refund', decision: 'approved', reason: 'a person approved', argsPreview: '{"amount":50}', at: new Date().toISOString() },
    { agent: 'support-bot', tool: 'lookup_order', decision: 'allowed', reason: 'allowed', argsPreview: '{"id":"A-1"}', at: new Date().toISOString() },
  ] })
  const { slug } = (await saveAgentProfile(e, 'u', { name: 'Support bot', website: 'https://acme.com', reportId: 'rep-good', redteamTargetId: targetId, guardAgent: 'support-bot' }, loadReport)).body
  const pub = (await publicAgentProfile(e, slug)).body
  const s = pub.statement
  assert.equal(s.checks.scan.status, 'pass')
  assert.equal(s.checks.injectionTests.status, 'pass')
  assert.equal(s.checks.injectionTests.attacks, 18)
  assert.equal(s.checks.injectionTests.byOwasp.LLM01.name, 'Prompt Injection')
  assert.deepEqual(s.checks.runtimeGuard.last7Days, { blocked: 1, askedAPerson: 1, allowed: 1 })
  assert.equal(s.owner.domainVerified, true, 'agent.acme.com was verified, and it is under acme.com')
  assert.equal(s.verified, true)
  assert.equal(pub.signature, null, 'no key configured: no signature, never a fake one')
  const text = JSON.stringify(pub)
  for (const secret of ['secret reasoning', 'amount', 'lookup_order', 'A-1', 'agent.acme.com/chat', 'canary']) assert.ok(!text.includes(secret), `public profile must not include "${secret}"`)

  // Old scan → stale → not verified. Website on another domain → not verified ownership.
  await saveAgentProfile(e, 'u', { slug, reportId: 'rep-old', website: 'https://other.com' }, loadReport)
  const s2 = (await publicAgentProfile(e, slug)).body.statement
  assert.equal(s2.checks.scan.status, 'stale')
  assert.equal(s2.owner.domainVerified, false)
  assert.equal(s2.verified, false)
  // Tests that are 31+ days old no longer count.
  assert.equal((await publicAgentProfile(e, slug, Date.now() + (FRESH_DAYS + 1) * DAY)).body.statement.checks.injectionTests.status, 'stale')
  // Unpublished → gone from public view.
  await saveAgentProfile(e, 'u', { slug, published: false }, loadReport)
  assert.equal((await publicAgentProfile(e, slug)).status, 404)
  assert.equal((await listAgentProfiles(db, 'u')).body.profiles[0].published, false)
})

test('an agent that falls for attacks is not verified, and the badge says so', async () => {
  const db = makeDb()
  const e = { BILLING_DB: db, TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') }
  const targetId = await testedTarget(db, e, { obey: true })
  const { slug } = (await saveAgentProfile(e, 'u', { name: 'Weak bot', reportId: 'rep-good', redteamTargetId: targetId }, loadReport)).body
  const s = (await publicAgentProfile(e, slug)).body.statement
  assert.equal(s.checks.injectionTests.status, 'fail')
  assert.ok(s.checks.injectionTests.gotThrough > 5)
  assert.equal(s.verified, false)
  assert.match(await agentBadge(e, slug), /1\/3 checks/)
  assert.match(await agentBadge(e, 'no-such-agent'), /not found/)
})

test('signature: valid over the fixed prefix + canonical statement, and useless without the prefix', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const db = makeDb()
  const e = { BILLING_DB: db, TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'), ATTESTATION_SIGNING_PRIVATE_KEY_JWK: JSON.stringify(jwk), ATTESTATION_ISSUER: 'agentverify-test' }
  const { slug } = (await saveAgentProfile(e, 'u', { name: 'Signed bot', reportId: 'rep-good' }, loadReport)).body
  const { statement, signature } = (await publicAgentProfile(e, slug)).body
  assert.equal(signature.signedPrefix, 'agentverify-agent-profile-v1\n')
  assert.equal(signature.issuer, 'agentverify-test')
  const sig = Buffer.from(signature.signature, 'base64')
  const verify = msg => crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, sig, new TextEncoder().encode(msg))
  assert.equal(await verify(signature.signedPrefix + canonicalJson(statement)), true)
  assert.equal(await verify(canonicalJson(statement)), false, 'cannot be replayed as a scan attestation (no prefix)')
  assert.equal(await verify(signature.signedPrefix + canonicalJson({ ...statement, verified: !statement.verified })), false, 'any change breaks it')
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } }), '{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}')
})

test('routes: the profile and badge are public; managing profiles needs sign-in', async () => {
  const db = makeDb()
  const e = { BILLING_DB: db, TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') }
  const { slug } = (await saveAgentProfile(e, 'u', { name: 'Public bot', reportId: 'rep-good' }, loadReport)).body
  const page = await worker.fetch(new Request(`https://api.test/v1/agents/${slug}`), e)
  assert.equal(page.status, 200)
  assert.equal(page.headers.get('Access-Control-Allow-Origin'), '*')
  assert.equal((await page.json()).statement.name, 'Public bot')
  const badge = await worker.fetch(new Request(`https://api.test/v1/agents/${slug}/badge.svg`), e)
  assert.equal(badge.headers.get('Content-Type'), 'image/svg+xml')
  assert.match(await badge.text(), /Agent Verify/)
  assert.equal((await worker.fetch(new Request('https://api.test/v1/agents/does-not-exist'), e)).status, 404)
  assert.equal((await worker.fetch(new Request('https://api.test/v1/agent-profiles'), e)).status, 401)
})
