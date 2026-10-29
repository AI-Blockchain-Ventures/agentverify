// v1.6: Free plans receive findings without fixes — enforced on the server, not just hidden in the UI.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { scan, computeReportHash } from '@agentverify/scanner'
import worker from '../dist/worker.mjs'
import { applyRemediationEntitlement, lockFindingFix } from '../dist/entitlementView.mjs'

const RISKY = `
const agent = { name: 'FixtureAgent', tools: ['lookup'] }
export async function run(request) {
  const rows = await db.query('SELECT * FROM orders WHERE id = ' + request.id)
  return fetch(request.url)
}
`
const full = scan({ content: RISKY, fileName: 'agent.js' })
const fixesIn = result => result.findings.filter(f => (f.recommendedFix && f.recommendedFix.trim()) || f.quickFix || f.fixCode)

test('fixture sanity: the unrestricted scan really contains fixes', () => {
  assert.ok(fixesIn(full).length > 0)
  assert.ok(full.findings.some(f => f.quickFix), 'at least one finding carries a code fix')
})

test('Free: every finding is kept, but no fix text or fix code survives', () => {
  const free = applyRemediationEntitlement(full, 'free')
  assert.equal(free.findings.length, full.findings.length, 'no finding is hidden')
  assert.deepEqual(free.findings.map(f => f.code), full.findings.map(f => f.code))
  assert.equal(fixesIn(free).length, 0, 'no fix leaks on Free')
  for (const f of free.findings) {
    assert.ok(!('quickFix' in f) && !('fixCode' in f), `${f.code} still carries a code fix key`)
    assert.ok(f.whatIsWrong && f.whyItMatters, `${f.code} keeps its explanation`)
  }
  assert.ok(free.findings.every(f => f.fixLocked === true || !fixesIn({ findings: [full.findings.find(x => x.code === f.code)] }).length))
  // Nothing outside findings changes: verdict, score, and every other section are identical.
  assert.equal(free.verdict, full.verdict)
  assert.equal(free.riskScore, full.riskScore)
  assert.deepEqual(free.reportInsights, full.reportInsights)
  const raw = JSON.stringify(free)
  for (const f of full.findings) if (f.quickFix) assert.ok(!raw.includes(f.quickFix), `quickFix for ${f.code} leaked`)
})

test('Pro: the result is returned unchanged', () => {
  assert.equal(applyRemediationEntitlement(full, 'pro'), full)
})

test('a finding with no fix is left as-is (not marked locked)', () => {
  const f = { id: 'x', code: 'X', title: 'x', category: 'B', severity: 'low', whatIsWrong: 'w', whyItMatters: 'y', recommendedFix: '' }
  assert.deepEqual(lockFindingFix(f), f)
})

test('the integrity hash of a Free report is computed over the stripped evidence (stable, verifiable)', async () => {
  const free = applyRemediationEntitlement(full, 'free')
  const a = await computeReportHash(free)
  const b = await computeReportHash(JSON.parse(JSON.stringify(free)))
  assert.equal(a.reportHash, b.reportHash, 'what was returned/stored re-hashes to the same value')
  assert.notEqual(a.reportHash, (await computeReportHash(full)).reportHash)
})

test('public demo endpoint (always Free) returns findings with no fixes — end to end through the Worker', async () => {
  const res = await worker.fetch(new Request('https://api.test/v1/demo/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.77' },
    body: JSON.stringify({ content: RISKY, fileName: 'agent.js' }),
  }), {})
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.ok(body.findings.length > 0)
  assert.equal(fixesIn(body).length, 0, 'demo response must not include fixes')
  assert.ok(body.findings.some(f => f.fixLocked === true), 'locked findings are marked so the UI can upsell')
})

test('source order: the entitlement is applied before hashing, signing, and saving in /v1/scan', () => {
  const src = readFileSync(new URL('../src/worker.ts', import.meta.url), 'utf8')
  const scanRoute = src.slice(src.indexOf("url.pathname !== '/v1/scan'"))
  const applied = scanRoute.indexOf("applyRemediationEntitlement(createScanResult(")
  assert.ok(applied > 0, '/v1/scan applies the entitlement')
  for (const later of ['computeReportHash(scanResult)', 'buildAttestationPayload(', 'saveReportToFirebase(']) {
    assert.ok(scanRoute.indexOf(later) > applied, `${later} must come after the entitlement is applied`)
  }
  assert.match(scanRoute, /quota\.plan === 'pro' \? 'pro' : 'free'/, 'the plan comes from the server-side quota check, not the request')
  const verifyFix = src.slice(src.indexOf('async function handleVerifyFix'), src.indexOf('export default {'))
  assert.match(verifyFix, /applyRemediationEntitlement\(createScanResult\(/, 'fix verification follows the plan too')
})

console.log('entitlementView.test.mjs: all assertions passed')
