// GitLab and Bitbucket: encrypted tokens, safe hosts, verified webhooks, and the MR/PR scan flow.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createHmac, randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { encryptToken, decryptToken, isAllowedHost, createConnection, handleVcsWebhook, listConnections } from '../dist/vcs.mjs'

const KEY = randomBytes(32).toString('base64')
function makeDb() {
  const db = new DatabaseSync(':memory:')
  for (const f of ['billing.sql', 'vcs.sql']) db.exec(readFileSync(new URL(`../schema/${f}`, import.meta.url), 'utf8'))
  return { raw: db, prepare(q) { const s = db.prepare(q); let v = []; const api = { bind(...x) { v = x; return api }, async first() { return s.get(...v) ?? null }, async run() { const r = s.run(...v); return { success: true, meta: { changes: Number(r.changes) } } }, async all() { return { results: s.all(...v) } } }; return api } }
}
const env = db => ({ BILLING_DB: db, TOKEN_ENCRYPTION_KEY: KEY })
const AGENT = 'from langchain.agents import AgentExecutor\ntools = [lookup]\nr = requests.get(url, verify=False)\n'
const scanFn = () => ({ verdict: 'NOT_VERIFIED', riskScore: 55, findings: [{ id: 'a', code: 'TLS_VERIFICATION_DISABLED', title: 'TLS off', category: 'B', severity: 'high', whatIsWrong: 'off', whyItMatters: 'w', recommendedFix: 'Turn it on.', line: 3 }] })

function fakeApi({ probeOk = true, fileFails = false } = {}) {
  const calls = []
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url); const m = init.method ?? 'GET'
    calls.push({ m, host: u.hostname, path: u.pathname, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined })
    const ok = d => new Response(typeof d === 'string' ? d : JSON.stringify(d), { status: 200 })
    if (/\/api\/v4\/projects\/[^/]+$/.test(u.pathname) || /^\/2\.0\/repositories\/[^/]+\/[^/]+$/.test(u.pathname)) return probeOk ? ok({}) : new Response('no', { status: 404 })
    if (u.pathname.endsWith('/merge_requests/7/diffs')) return ok([{ new_path: 'agent.py', deleted_file: false }, { new_path: 'old.py', deleted_file: true }])
    if (u.pathname.includes('/repository/files/')) return fileFails ? new Response('nf', { status: 404 }) : ok(AGENT)
    if (u.pathname.endsWith('/merge_requests/7/notes')) return m === 'GET' ? ok([]) : ok({ id: 1 })
    if (u.pathname.includes('/statuses/')) return ok({})
    if (u.pathname.endsWith('/pullrequests/9/diffstat')) return ok({ values: [{ status: 'added', new: { path: 'agent.py' } }] })
    if (u.pathname.includes('/src/')) return fileFails ? new Response('nf', { status: 404 }) : ok(AGENT)
    if (u.pathname.endsWith('/pullrequests/9/comments')) return m === 'GET' ? ok({ values: [] }) : ok({ id: 1 })
    if (u.pathname.endsWith('/statuses/build')) return ok({})
    return new Response('unexpected ' + u.pathname, { status: 500 })
  }
  return { fetchFn, calls }
}

test('tokens are encrypted at rest and need the right key', async () => {
  const stored = await encryptToken({ TOKEN_ENCRYPTION_KEY: KEY }, 'glpat-secret-token-123')
  assert.ok(stored.startsWith('v1.'))
  assert.ok(!stored.includes('glpat'))
  assert.equal(await decryptToken({ TOKEN_ENCRYPTION_KEY: KEY }, stored), 'glpat-secret-token-123')
  assert.equal(await decryptToken({ TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') }, stored), null)
  assert.equal(await encryptToken({}, 'x'), null, 'no key, no storage')
})

test('only public HTTPS hostnames for self-hosted GitLab', () => {
  assert.equal(isAllowedHost('gitlab.com'), true)
  assert.equal(isAllowedHost('git.acme.io'), true)
  for (const bad of ['localhost', '127.0.0.1', '169.254.169.254', 'gitlab.internal', 'gitlab.local', 'nodot', 'a b.com']) assert.equal(isAllowedHost(bad), false, bad)
})

test('connecting: validates input, checks the token works, never stores or returns it in plain text', async () => {
  const db = makeDb()
  const api = fakeApi()
  assert.equal((await createConnection(env(db), 'u1', { provider: 'svn', project: 'a/b', token: 'x'.repeat(20) }, api.fetchFn)).status, 400)
  assert.equal((await createConnection(env(db), 'u1', { provider: 'gitlab', host: '10.0.0.5', project: 'a/b', token: 'x'.repeat(20) }, api.fetchFn)).status, 400)
  assert.equal((await createConnection(env(db), 'u1', { provider: 'bitbucket', project: 'just-one', token: 'x'.repeat(20) }, api.fetchFn)).status, 400)
  assert.equal((await createConnection(env(db), 'u1', { provider: 'gitlab', project: 'acme/bot', token: 'x'.repeat(20) }, fakeApi({ probeOk: false }).fetchFn)).status, 400, 'bad token rejected before storing')
  assert.equal((await createConnection({ BILLING_DB: db }, 'u1', { provider: 'gitlab', project: 'acme/bot', token: 'x'.repeat(20) }, api.fetchFn)).status, 503, 'needs the encryption key')
  const res = await createConnection(env(db), 'u1', { provider: 'gitlab', project: 'acme/bot', token: 'glpat-real-token-value-1' }, api.fetchFn)
  assert.equal(res.status, 200)
  assert.match(res.body.webhookUrl, /\/v1\/vcs\/webhook\/[0-9a-f]{24}$/)
  assert.ok(res.body.webhookSecret.length >= 32)
  assert.equal(JSON.stringify(res.body).includes('glpat'), false)
  assert.equal(JSON.stringify(db.raw.prepare('SELECT * FROM vcs_connections').all()).includes('glpat'), false, 'not stored in plain text')
  assert.equal(JSON.stringify(await listConnections(db, 'u1')).includes('token'), false)
  assert.deepEqual((await listConnections(db, 'someone-else')).connections, [])
})

async function connect(db, provider) {
  const api = fakeApi()
  const res = await createConnection(env(db), 'u1', { provider, project: provider === 'gitlab' ? 'acme/bot' : 'acme/bot', token: 'token-value-123456' }, api.fetchFn)
  return res.body
}

test('GitLab: wrong token header is refused; a new-commit MR event scans and reports', async () => {
  const db = makeDb()
  const conn = await connect(db, 'gitlab')
  const payload = { object_kind: 'merge_request', object_attributes: { iid: 7, action: 'update', oldrev: 'aaa', last_commit: { id: 'abcdef1234567' }, title: 't', url: 'u' } }
  const req = token => new Request(conn.webhookUrl, { method: 'POST', headers: { 'x-gitlab-token': token, 'x-gitlab-event': 'Merge Request Hook' }, body: JSON.stringify(payload) })
  const id = conn.id
  assert.equal((await handleVcsWebhook(req('wrong'), env(db), id, { waitUntil() {} })).status, 401)
  const api = fakeApi()
  const pending = []
  const res = await handleVcsWebhook(req(conn.webhookSecret), env(db), id, { waitUntil: p => pending.push(p) }, { fetchFn: api.fetchFn, scanFn })
  assert.equal(res.status, 202)
  await Promise.all(pending)
  const status = api.calls.find(c => c.path.includes('/statuses/abcdef1234567'))
  assert.equal(status.body.state, 'failed')
  assert.equal(status.headers['PRIVATE-TOKEN'], 'token-value-123456', 'the decrypted token is used for the API call')
  const note = api.calls.find(c => c.m === 'POST' && c.path.endsWith('/merge_requests/7/notes'))
  assert.match(note.body.body, /\[`agent\.py:3`\]\(https:\/\/gitlab\.com\/acme\/bot\/-\/blob\/abcdef1234567\/agent\.py#L3\)/)
  assert.doesNotMatch(note.body.body, /Turn it on/, 'free plan: no fixes')
  // Title-only edits (no new commits) are ignored.
  const edit = new Request(conn.webhookUrl, { method: 'POST', headers: { 'x-gitlab-token': conn.webhookSecret }, body: JSON.stringify({ ...payload, object_attributes: { ...payload.object_attributes, oldrev: undefined } }) })
  assert.deepEqual(await (await handleVcsWebhook(edit, env(db), id, { waitUntil() {} })).json(), { ok: true, ignored: true })
})

test('Bitbucket: HMAC-signed PR event scans and reports; bad signature refused', async () => {
  const db = makeDb()
  const conn = await connect(db, 'bitbucket')
  const body = JSON.stringify({ pullrequest: { id: 9, source: { commit: { hash: 'fedcba9876543' } }, title: 't', links: { html: { href: 'h' } } } })
  const sig = 'sha256=' + createHmac('sha256', conn.webhookSecret).update(body).digest('hex')
  const bad = new Request(conn.webhookUrl, { method: 'POST', headers: { 'x-hub-signature': 'sha256=00', 'x-event-key': 'pullrequest:created' }, body })
  assert.equal((await handleVcsWebhook(bad, env(db), conn.id, { waitUntil() {} })).status, 401)
  const api = fakeApi()
  const pending = []
  const res = await handleVcsWebhook(new Request(conn.webhookUrl, { method: 'POST', headers: { 'x-hub-signature': sig, 'x-event-key': 'pullrequest:created' }, body }), env(db), conn.id, { waitUntil: p => pending.push(p) }, { fetchFn: api.fetchFn, scanFn })
  assert.equal(res.status, 202)
  await Promise.all(pending)
  assert.equal(api.calls.find(c => c.path.endsWith('/commit/fedcba9876543/statuses/build')).body.state, 'FAILED')
  assert.ok(api.calls.find(c => c.m === 'POST' && c.path.endsWith('/pullrequests/9/comments')))
  assert.equal(api.calls.find(c => c.path.endsWith('/diffstat')).headers.Authorization, 'Bearer token-value-123456')
  assert.equal((await handleVcsWebhook(new Request('https://x', { method: 'POST', body: '{}' }), env(db), 'nothex', { waitUntil() {} })).status, 404)
})

// Reported by an outside reviewer (Nov 2026): GitLab/Bitbucket must not report success for changes that were not checked.
test('GitLab and Bitbucket: over the limit, unreadable files and "not assessed" are never a green status', async () => {
  const run = async (provider, { scan = scanFn, apiOpts = {}, fill = 0 } = {}) => {
    const db = makeDb()
    const conn = await connect(db, provider)
    if (fill) db.raw.prepare('INSERT INTO vcs_usage (connection_id, month, scan_count, updated_at) VALUES (?, ?, ?, 0)').run(conn.id, new Date().toISOString().slice(0, 7), fill)
    const api = fakeApi(apiOpts)
    const pending = []
    if (provider === 'gitlab') {
      const payload = { object_kind: 'merge_request', object_attributes: { iid: 7, action: 'update', oldrev: 'aaa', last_commit: { id: 'abcdef1234567' }, title: 't', url: 'u' } }
      await handleVcsWebhook(new Request(conn.webhookUrl, { method: 'POST', headers: { 'x-gitlab-token': conn.webhookSecret }, body: JSON.stringify(payload) }), env(db), conn.id, { waitUntil: p => pending.push(p) }, { fetchFn: api.fetchFn, scanFn: scan })
    } else {
      const body = JSON.stringify({ pullrequest: { id: 9, source: { commit: { hash: 'fedcba9876543' } }, title: 't', links: { html: { href: 'h' } } } })
      const sig = 'sha256=' + createHmac('sha256', conn.webhookSecret).update(body).digest('hex')
      await handleVcsWebhook(new Request(conn.webhookUrl, { method: 'POST', headers: { 'x-hub-signature': sig, 'x-event-key': 'pullrequest:created' }, body }), env(db), conn.id, { waitUntil: p => pending.push(p) }, { fetchFn: api.fetchFn, scanFn: scan })
    }
    await Promise.all(pending)
    return api.calls.find(c => c.m === 'POST' && (c.path.includes('/statuses/abcdef1234567') || c.path.endsWith('/statuses/build'))).body
  }
  const notAssessed = () => ({ verdict: 'NOT_ASSESSED', riskScore: 0, findings: [] })
  for (const [provider, grey] of [['gitlab', 'skipped'], ['bitbucket', 'STOPPED']]) {
    const over = await run(provider, { fill: 100000 })
    assert.equal(over.state, grey, `${provider}: over the monthly limit`)
    assert.match(over.description, /Not checked/)
    const unread = await run(provider, { apiOpts: { fileFails: true } })
    assert.equal(unread.state, grey, `${provider}: changed files could not be read`)
    assert.match(unread.description, /could not be read/)
    assert.equal((await run(provider, { scan: notAssessed })).state, grey, `${provider}: not assessed`)
  }
})
