// 2.0 PR bot + monitoring: webhook security, app auth, the full PR flow against a fake GitHub, alerts, and linking.
// Runs on the public CI stub too: scans are injected (deps.scanFn), the database is an in-memory SQLite with the real schema.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createHmac, generateKeyPairSync, createVerify } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { verifyWebhookSignature, createAppJwt } from '../dist/githubApp.mjs'
import { selectChangedFiles, looksLikeAgentCode, locateLine, buildComment, buildCheckRun, COMMENT_MARKER } from '../dist/githubPr.mjs'
import { handleGithubWebhook, processPullRequest, processPush, linkInstallation, listInstallations, GITHUB_SCANS_BY_PLAN } from '../dist/githubWebhook.mjs'
import { alertDecision, isSlackWebhookUrl, saveAlertSettings } from '../dist/alerts.mjs'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
const SECRET = 'whsec_test_secret'

/** Cloudflare D1-shaped wrapper over node:sqlite, loaded with the real schema files. */
function makeDb() {
  const db = new DatabaseSync(':memory:')
  for (const f of ['billing.sql', 'github.sql']) db.exec(readFileSync(new URL(`../schema/${f}`, import.meta.url), 'utf8'))
  return {
    raw: db,
    prepare(q) {
      const stmt = db.prepare(q)
      let vals = []
      const api = {
        bind(...v) { vals = v; return api },
        async first() { return stmt.get(...vals) ?? null },
        async run() { const r = stmt.run(...vals); return { success: true, meta: { changes: Number(r.changes) } } },
        async all() { return { results: stmt.all(...vals) } },
      }
      return api
    },
  }
}

function env(db) {
  return { BILLING_DB: db, GITHUB_APP_ID: '123', GITHUB_APP_PRIVATE_KEY: privateKey, GITHUB_WEBHOOK_SECRET: SECRET, GITHUB_CLIENT_ID: 'cid', GITHUB_CLIENT_SECRET: 'csecret' }
}

const AGENT = `from langchain.agents import initialize_agent\ntools = [lookup]\n\ndef lookup(order_id):\n    return db.execute("SELECT * FROM orders WHERE id=" + order_id)\n`
const finding = (code, severity, line, extra = {}) => ({ id: code, code, title: `${code} title`, category: 'B', severity, whatIsWrong: `${code} is wrong`, whyItMatters: 'w', recommendedFix: `Fix ${code}`, quickFix: `fixed_${code}()`, line, ...extra })
const fakeScan = findings => () => ({ verdict: findings.length ? 'NOT_VERIFIED' : 'VERIFIED', riskScore: findings.length ? 40 : 100, riskLevel: 'High Risk', findings, reportInsights: { topBlocker: findings[0]?.title } })

/** Fake GitHub REST API. Records writes so tests can check what the bot posted. */
function fakeGithub({ prFiles = [], contents = {}, comments = [], tree = [], userInstallations = [1] } = {}) {
  const calls = []
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url)
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ method, path: u.pathname + u.search, body, auth: init.headers?.Authorization })
    const ok = data => new Response(typeof data === 'string' ? data : JSON.stringify(data), { status: 200 })
    if (u.hostname === 'hooks.slack.com') return ok('ok')
    if (u.pathname === '/login/oauth/access_token') return ok(body.code === 'good' ? { access_token: 'gho_user' } : { error: 'bad_verification_code' })
    if (u.pathname === '/user/installations') return ok({ installations: userInstallations.map(id => ({ id })) })
    if (/\/app\/installations\/\d+\/access_tokens$/.test(u.pathname)) return ok({ token: 'ghs_install' })
    if (/\/app\/installations\/\d+$/.test(u.pathname)) return ok({ account: { login: 'acme', type: 'Organization' } })
    if (/\/pulls\/\d+\/files$/.test(u.pathname)) return ok(prFiles)
    const content = u.pathname.match(/\/contents\/(.+)$/)
    if (content) {
      const path = decodeURIComponent(content[1])
      return path in contents ? ok(contents[path]) : new Response('nf', { status: 404 })
    }
    if (u.pathname.endsWith('/check-runs')) return ok({ id: 1 })
    if (/\/issues\/\d+\/comments$/.test(u.pathname)) return method === 'GET' ? ok(comments) : ok({ id: 99 })
    if (/\/issues\/comments\/\d+$/.test(u.pathname)) return ok({ id: 5 })
    if (u.pathname.includes('/git/trees/')) return ok({ tree })
    return new Response('unexpected ' + u.pathname, { status: 500 })
  }
  return { fetchFn, calls, posted: (m, part) => calls.filter(c => c.method === m && c.path.includes(part)) }
}

const prPayload = (overrides = {}) => ({
  action: 'opened',
  installation: { id: 1, account: { login: 'acme', type: 'Organization' } },
  repository: { full_name: 'acme/bot', owner: { login: 'acme', type: 'Organization' } },
  pull_request: { number: 7, draft: false, head: { sha: 'abcdef1234567', ref: 'feature' } },
  ...overrides,
})

// ── webhook security and app auth ──

test('webhook signature: valid passes, tampered or missing fails', async () => {
  const body = new TextEncoder().encode('{"a":1}')
  const sig = 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex')
  assert.equal(await verifyWebhookSignature(SECRET, body, sig), true)
  assert.equal(await verifyWebhookSignature(SECRET, new TextEncoder().encode('{"a":2}'), sig), false)
  assert.equal(await verifyWebhookSignature(SECRET, body, null), false)
  assert.equal(await verifyWebhookSignature('', body, sig), false)
})

test('app JWT: signed with the PKCS#1 key GitHub provides, verifiable with its public key', async () => {
  const jwt = await createAppJwt('123', privateKey, 1_800_000_000)
  const [h, p, s] = jwt.split('.')
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString())
  assert.equal(payload.iss, '123')
  assert.ok(payload.exp - payload.iat <= 600, 'GitHub allows at most 10 minutes')
  const v = createVerify('RSA-SHA256').update(`${h}.${p}`)
  assert.ok(v.verify(publicKey, Buffer.from(s, 'base64url')))
  assert.ok(await createAppJwt('123', privateKey.replace(/\n/g, '\\n')), 'keys pasted with literal \\n also work')
})

test('unsigned or wrongly signed webhooks are rejected before anything runs', async () => {
  const req = new Request('https://api.test/v1/github/webhook', { method: 'POST', headers: { 'x-github-event': 'ping', 'x-hub-signature-256': 'sha256=00' }, body: '{}' })
  const res = await handleGithubWebhook(req, env(makeDb()), { waitUntil() {} })
  assert.equal(res.status, 401)
  const notConfigured = await handleGithubWebhook(new Request('https://api.test/x', { method: 'POST', body: '{}' }), {}, { waitUntil() {} })
  assert.equal(notConfigured.status, 503)
})

test('signed PR webhook returns 202 at once and does the scan in the background', async () => {
  const db = makeDb()
  const gh = fakeGithub({ prFiles: [{ filename: 'agent.py', status: 'added' }], contents: { 'agent.py': AGENT } })
  const body = JSON.stringify(prPayload())
  const sig = 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex')
  const pending = []
  const res = await handleGithubWebhook(new Request('https://api.test/v1/github/webhook', { method: 'POST', headers: { 'x-github-event': 'pull_request', 'x-hub-signature-256': sig }, body }), env(db), { waitUntil: p => pending.push(p) }, { fetchFn: gh.fetchFn, scanFn: fakeScan([finding('SQL_INJECTION_RISK', 'critical', 5)]) })
  assert.equal(res.status, 202)
  await Promise.all(pending)
  assert.equal(gh.posted('POST', '/check-runs').length, 1)
})

// ── file selection, comment and check output ──

test('changed files: deleted, lockfiles, node_modules and non-code are skipped; agent files first; tests last', () => {
  const picked = selectChangedFiles([
    { filename: 'README.md', status: 'modified' },
    { filename: 'tests/test_agent.py', status: 'added' },
    { filename: 'node_modules/x/index.js', status: 'added' },
    { filename: 'package-lock.json', status: 'modified' },
    { filename: 'logo.png', status: 'added' },
    { filename: 'old_agent.py', status: 'removed' },
    { filename: 'src/agents/support_agent.py', status: 'modified' },
  ])
  assert.deepEqual(picked, ['src/agents/support_agent.py', 'README.md', 'tests/test_agent.py'])
  assert.equal(looksLikeAgentCode([{ path: 'utils.py', content: 'def add(a, b): return a + b' }]), false)
  assert.equal(looksLikeAgentCode([{ path: 'a.py', content: AGENT }]), true)
  assert.deepEqual(locateLine([{ path: 'a', content: 'x\ny' }, { path: 'b', content: 'p\nq' }], 6), { path: 'b', line: 1 })
})

test('comment: Free shows findings with file links but no fixes; Pro includes the fixes', () => {
  const files = [{ path: 'agent.py', content: AGENT }]
  const free = { verdict: 'NOT_VERIFIED', riskScore: 40, findings: [{ ...finding('SQL_INJECTION_RISK', 'critical', 5), recommendedFix: '', quickFix: undefined, fixLocked: true }] }
  const freeText = buildComment(free, { repo: 'acme/bot', sha: 'abcdef1234567', files, plan: 'unlinked', linkUrl: 'https://x/link' })
  assert.ok(freeText.startsWith(COMMENT_MARKER))
  assert.match(freeText, /Security score 40\/100/)
  assert.match(freeText, /\[`agent\.py:5`\]\(https:\/\/github\.com\/acme\/bot\/blob\/abcdef1234567\/agent\.py#L5\)/)
  assert.match(freeText, /Connect this repo to your account\]\(https:\/\/x\/link\)/)
  assert.doesNotMatch(freeText, /How to fix/)
  const pro = { verdict: 'NOT_VERIFIED', riskScore: 40, findings: [finding('SQL_INJECTION_RISK', 'critical', 5)] }
  const proText = buildComment(pro, { repo: 'acme/bot', sha: 'abcdef1234567', files, plan: 'pro' })
  assert.match(proText, /How to fix/)
  assert.match(proText, /fixed_SQL_INJECTION_RISK\(\)/)
  const pipes = buildComment({ verdict: 'NOT_VERIFIED', riskScore: 40, findings: [finding('X', 'low', 1, { whatIsWrong: 'a | b\nc' })] }, { repo: 'a/b', sha: 'abcdefg', files, plan: 'pro' })
  assert.match(pipes, /a \\\| b c/, 'table cells are escaped')
})

test('check run: fails on critical/high, passes otherwise, with inline annotations', () => {
  const files = [{ path: 'agent.py', content: AGENT }]
  const failing = buildCheckRun({ riskScore: 40, findings: [finding('A', 'high', 2), finding('B', 'low', 3), finding('C', 'medium')] }, files)
  assert.equal(failing.conclusion, 'failure')
  assert.deepEqual(failing.annotations.map(a => [a.path, a.start_line, a.annotation_level]), [['agent.py', 2, 'failure'], ['agent.py', 3, 'notice']])
  assert.equal(buildCheckRun({ riskScore: 90, findings: [finding('B', 'medium', 1)] }, files).conclusion, 'success')
})

// ── full PR flow against a fake GitHub ──

test('PR flow: scans changed agent files, posts a failing check and one comment, strips fixes when not Pro', async () => {
  const db = makeDb()
  const gh = fakeGithub({ prFiles: [{ filename: 'agent.py', status: 'added' }, { filename: 'utils/math.py', status: 'added' }], contents: { 'agent.py': AGENT, 'utils/math.py': 'def add(a,b): return a+b' } })
  const out = await processPullRequest(prPayload(), env(db), { fetchFn: gh.fetchFn, scanFn: fakeScan([finding('SQL_INJECTION_RISK', 'critical', 6)]) })
  assert.match(out, /scanned 2 file/)
  const check = gh.posted('POST', '/check-runs')[0]
  assert.equal(check.body.conclusion, 'failure')
  assert.equal(check.body.head_sha, 'abcdef1234567')
  assert.equal(check.auth, 'Bearer ghs_install')
  const comment = gh.posted('POST', '/issues/7/comments')[0]
  assert.ok(comment, 'a comment is created when there are findings')
  assert.doesNotMatch(comment.body.body, /fixed_SQL_INJECTION_RISK/, 'unlinked installs never receive fixes')
  assert.match(comment.body.body, /Step-by-step fixes/)
  const row = db.raw.prepare('SELECT * FROM repo_scans').get()
  assert.equal(row.trigger, 'pull_request')
  assert.equal(row.critical_count, 1)
  assert.equal(db.raw.prepare('SELECT scan_count FROM github_usage').get().scan_count, 1)
  assert.ok(db.raw.prepare('SELECT * FROM github_installations WHERE installation_id = 1').get(), 'installation is recorded even if its install event was missed')
})

test('PR flow: the existing bot comment is updated, not duplicated; a clean PR with no prior comment stays quiet', async () => {
  const db = makeDb()
  const files = { prFiles: [{ filename: 'agent.py', status: 'modified' }], contents: { 'agent.py': AGENT } }
  const withOld = fakeGithub({ ...files, comments: [{ id: 5, body: `${COMMENT_MARKER}\nold`, user: { type: 'Bot' } }, { id: 6, body: COMMENT_MARKER, user: { type: 'User' } }] })
  await processPullRequest(prPayload({ action: 'synchronize' }), env(db), { fetchFn: withOld.fetchFn, scanFn: fakeScan([]) })
  assert.equal(withOld.posted('PATCH', '/issues/comments/5').length, 1, 'our own comment is edited to the new result')
  assert.equal(withOld.posted('POST', '/comments').length, 0)
  const clean = fakeGithub(files)
  await processPullRequest(prPayload(), env(db), { fetchFn: clean.fetchFn, scanFn: fakeScan([]) })
  assert.equal(clean.posted('POST', '/comments').length + clean.posted('PATCH', '/comments').length, 0)
  assert.equal(clean.posted('POST', '/check-runs')[0].body.conclusion, 'success')
})

test('PR flow: PRs without agent code get a passing "no agent files" check and no comment, and use no allowance', async () => {
  const db = makeDb()
  const gh = fakeGithub({ prFiles: [{ filename: 'utils/math.py', status: 'added' }, { filename: 'logo.png', status: 'added' }], contents: { 'utils/math.py': 'def add(a,b): return a+b' } })
  const out = await processPullRequest(prPayload(), env(db), { fetchFn: gh.fetchFn, scanFn: () => { throw new Error('must not scan') } })
  assert.equal(out, 'no agent files')
  assert.equal(gh.posted('POST', '/check-runs')[0].body.output.title, 'No agent files changed')
  assert.equal(gh.posted('POST', '/comments').length, 0)
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM github_usage').get().n, 0)
})

test('PR flow: the monthly allowance is enforced with a neutral check pointing to Pro', async () => {
  const db = makeDb()
  db.raw.prepare('INSERT INTO github_usage (installation_id, month, scan_count, updated_at) VALUES (1, ?, ?, 0)').run(new Date().toISOString().slice(0, 7), GITHUB_SCANS_BY_PLAN.unlinked)
  const gh = fakeGithub({ prFiles: [{ filename: 'agent.py', status: 'added' }], contents: { 'agent.py': AGENT } })
  const out = await processPullRequest(prPayload(), env(db), { fetchFn: gh.fetchFn, scanFn: () => { throw new Error('must not scan') } })
  assert.equal(out, 'over limit')
  const check = gh.posted('POST', '/check-runs')[0].body
  assert.equal(check.conclusion, 'neutral')
  assert.match(check.output.summary, /pricing/)
})

test('PR flow: a Pro-linked installation gets the fixes in its comment', async () => {
  const db = makeDb()
  db.raw.prepare("INSERT INTO github_installations (installation_id, account_login, account_type, linked_uid, created_at, updated_at) VALUES (1, 'acme', 'Organization', 'user-pro', 0, 0)").run()
  db.raw.prepare("INSERT INTO subscriptions (uid, plan, status, current_period_end, updated_at) VALUES ('user-pro', 'pro', 'active', ?, 0)").run(Math.floor(Date.now() / 1000) + 86400 * 30)
  const gh = fakeGithub({ prFiles: [{ filename: 'agent.py', status: 'added' }], contents: { 'agent.py': AGENT } })
  await processPullRequest(prPayload(), env(db), { fetchFn: gh.fetchFn, scanFn: fakeScan([finding('SQL_INJECTION_RISK', 'critical', 5)]) })
  assert.match(gh.posted('POST', '/issues/7/comments')[0].body.body, /fixed_SQL_INJECTION_RISK\(\)/)
})

// ── monitoring + alerts ──

test('monitoring: only linked installs, only the default branch; alerts only on NEW serious findings', async () => {
  const db = makeDb()
  const pushPayload = { ref: 'refs/heads/main', after: 'sha1', installation: { id: 1 }, repository: { full_name: 'acme/bot', default_branch: 'main', owner: { login: 'acme', type: 'Organization' } } }
  const gh = fakeGithub({ tree: [{ path: 'agent.py', type: 'blob', size: 100 }, { path: 'img.png', type: 'blob', size: 10 }], contents: { 'agent.py': AGENT } })
  assert.equal(await processPush(pushPayload, env(db), { fetchFn: gh.fetchFn }), 'not linked')
  db.raw.prepare("INSERT INTO github_installations (installation_id, account_login, account_type, linked_uid, created_at, updated_at) VALUES (1, 'acme', 'Organization', 'u1', 0, 0)").run()
  assert.equal(await processPush({ ...pushPayload, ref: 'refs/heads/feature' }, env(db), { fetchFn: gh.fetchFn }), 'not the default branch')
  assert.deepEqual(await saveAlertSettings(db, 'u1', { slackWebhookUrl: 'https://hooks.slack.com/services/T/B/X', minSeverity: 'high' }), { ok: true })

  await processPush(pushPayload, env(db), { fetchFn: gh.fetchFn, scanFn: fakeScan([finding('SQL_INJECTION_RISK', 'critical', 5)]) })
  const first = gh.calls.filter(c => c.path.startsWith('/services/'))
  assert.equal(first.length, 1, 'first scan with a critical finding alerts')
  assert.match(first[0].body.text, /SQL_INJECTION_RISK title — agent\.py:5/)

  await processPush({ ...pushPayload, after: 'sha2' }, env(db), { fetchFn: gh.fetchFn, scanFn: fakeScan([finding('SQL_INJECTION_RISK', 'critical', 5), finding('NO_RATE_LIMITING', 'medium', 1)]) })
  assert.equal(gh.calls.filter(c => c.path.startsWith('/services/')).length, 1, 'same critical again + a new medium (below the alert level) = no alert')

  await processPush({ ...pushPayload, after: 'sha3' }, env(db), { fetchFn: gh.fetchFn, scanFn: fakeScan([finding('SQL_INJECTION_RISK', 'critical', 5), finding('SSRF_RISK', 'high', 2)]) })
  assert.equal(gh.calls.filter(c => c.path.startsWith('/services/')).length, 2, 'a new high finding alerts')

  const listed = await listInstallations('u1', env(db))
  assert.equal(listed.repos[0].repo, 'acme/bot')
  assert.equal(listed.repos[0].history.length, 3, 'score history for the dashboard chart')
  assert.deepEqual(await listInstallations('someone-else', env(db)), { installations: [], repos: [] }, 'other accounts see nothing')
})

test('alert settings: only real Slack webhook addresses; score drops alert', async () => {
  assert.equal(isSlackWebhookUrl('https://hooks.slack.com/services/T/B/X'), true)
  assert.equal(isSlackWebhookUrl('https://evil.example/services/x'), false)
  assert.equal(isSlackWebhookUrl('http://hooks.slack.com/services/x'), false)
  const db = makeDb()
  assert.equal((await saveAlertSettings(db, 'u', { slackWebhookUrl: 'https://169.254.169.254/latest' })).ok, false)
  assert.equal((await saveAlertSettings(db, 'u', { email: 'not-an-email' })).ok, false)
  const base = { uid: 'u', repo: 'a/b', sha: 's', branch: 'main', files: [] }
  assert.equal(alertDecision({ ...base, result: { riskScore: 70, findings: [] }, previous: { score: 85, finding_codes: '' } }, 'high')?.scoreDrop, 15)
  assert.equal(alertDecision({ ...base, result: { riskScore: 80, findings: [] }, previous: { score: 85, finding_codes: '' } }, 'high'), null)
})

// ── linking an installation to an account ──

test('linking: requires a GitHub sign-in that can access the installation', async () => {
  const db = makeDb()
  const gh = fakeGithub({ userInstallations: [1] })
  assert.equal((await linkInstallation('u1', { installationId: 1, code: 'bad' }, env(db), { fetchFn: gh.fetchFn })).status, 403)
  assert.equal((await linkInstallation('u1', { installationId: 2, code: 'good' }, env(db), { fetchFn: gh.fetchFn })).status, 403, 'cannot claim an installation you cannot access')
  assert.equal((await linkInstallation('u1', { installationId: 'x', code: 'good' }, env(db), { fetchFn: gh.fetchFn })).status, 400)
  const ok = await linkInstallation('u1', { installationId: 1, code: 'good' }, env(db), { fetchFn: gh.fetchFn })
  assert.equal(ok.status, 200)
  assert.equal(db.raw.prepare('SELECT linked_uid FROM github_installations WHERE installation_id = 1').get().linked_uid, 'u1')
})

// Reported by an outside reviewer (Nov 2026): a green check must mean the changed agent code was actually checked.
test('PR flow: "not assessed" and unreadable files are neutral, never a green pass', async () => {
  const notAssessed = () => ({ verdict: 'NOT_ASSESSED', riskScore: 0, riskLevel: 'High Risk', findings: [], reportInsights: {} })
  const files = { prFiles: [{ filename: 'agent.py', status: 'modified' }], contents: { 'agent.py': AGENT } }
  const na = fakeGithub(files)
  await processPullRequest(prPayload(), env(makeDb()), { fetchFn: na.fetchFn, scanFn: notAssessed })
  const naCheck = na.posted('POST', '/check-runs')[0].body
  assert.equal(naCheck.conclusion, 'neutral')
  assert.match(naCheck.output.title, /Not assessed/)

  // Every changed agent file failed to download: not "No agent files changed".
  const gone = fakeGithub({ prFiles: [{ filename: 'agent.py', status: 'modified' }], contents: {} })
  const out = await processPullRequest(prPayload(), env(makeDb()), { fetchFn: gone.fetchFn, scanFn: fakeScan([]) })
  assert.equal(out, 'files unreadable')
  const goneCheck = gone.posted('POST', '/check-runs')[0].body
  assert.equal(goneCheck.conclusion, 'neutral')
  assert.match(goneCheck.output.title, /could not be read/)

  // Some files read and clean, one unreadable: still not a full pass.
  const partial = fakeGithub({ prFiles: [{ filename: 'agent.py', status: 'modified' }, { filename: 'tools.py', status: 'modified' }], contents: { 'agent.py': AGENT } })
  await processPullRequest(prPayload(), env(makeDb()), { fetchFn: partial.fetchFn, scanFn: fakeScan([]) })
  const partialCheck = partial.posted('POST', '/check-runs')[0].body
  assert.equal(partialCheck.conclusion, 'neutral')
  assert.match(partialCheck.output.title, /1 file not read/)
})
