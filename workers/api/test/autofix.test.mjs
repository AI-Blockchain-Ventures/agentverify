// One-click fixes: only safe, exact line rewrites; only on lines the PR changed; Pro only; never repeated.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { generateKeyPairSync } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { suggestLineFix, commentableLines } from '../dist/autofix.mjs'
import { processPullRequest, planFixSuggestions } from '../dist/githubWebhook.mjs'

const fix = (code, line, path = 'a.js', file = '') => suggestLineFix(code, line, path, file)?.replacement ?? null

test('TLS: certificate checks are turned back on, exactly once', () => {
  assert.equal(fix('TLS_VERIFICATION_DISABLED', '  const agent = new https.Agent({ rejectUnauthorized: false })'), '  const agent = new https.Agent({ rejectUnauthorized: true })')
  assert.equal(fix('TLS_VERIFICATION_DISABLED', 'r = requests.get(url, verify=False)', 'a.py'), 'r = requests.get(url, verify=True)')
  assert.equal(fix('TLS_VERIFICATION_DISABLED', 'x({ strictSSL: false })'), 'x({ strictSSL: true })')
  assert.equal(fix('TLS_VERIFICATION_DISABLED', 'a(verify=False); b(verify=False)', 'a.py'), null, 'ambiguous lines are left alone')
  assert.equal(fix('TLS_VERIFICATION_DISABLED', "process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'"), null, 'no safe one-line rewrite')
})

test('YAML: safe_load only when no Loader is given', () => {
  assert.equal(fix('UNSAFE_DESERIALIZATION', 'cfg = yaml.load(stream)', 'a.py'), 'cfg = yaml.safe_load(stream)')
  assert.equal(fix('UNSAFE_DESERIALIZATION', 'cfg = yaml.load(stream, Loader=yaml.FullLoader)', 'a.py'), null)
  assert.equal(fix('UNSAFE_DESERIALIZATION', 'obj = pickle.loads(data)', 'a.py'), null)
})

test('secrets: simple assignments become environment variables; anything else is left alone', () => {
  assert.equal(fix('SECRET_DETECTED_OPENAI_API_KEY', 'const openaiApiKey = "sk-proj-abcdefghijklmnop";'), 'const openaiApiKey = process.env.OPENAI_API_KEY;')
  assert.equal(fix('HARDCODED_CREDENTIALS', '  apiKey: "sk_live_abcdefghijklmnop",'), '  apiKey: process.env.API_KEY,')
  assert.equal(fix('HARDCODED_CREDENTIALS', 'API_TOKEN = "ghp_abcdefghijklmnop"  # temp', 'a.py', 'import os\n'), 'API_TOKEN = os.environ["API_TOKEN"]  # temp')
  assert.equal(fix('HARDCODED_CREDENTIALS', 'API_TOKEN = "ghp_abcdefghijklmnop"', 'a.py', 'import requests\n'), null, 'Python needs `import os` already in the file')
  assert.equal(fix('HARDCODED_CREDENTIALS', 'client = OpenAI(api_key="sk-abcdefghijklmnop")', 'a.py', 'import os\n'), null, 'call arguments are not rewritten')
  assert.equal(fix('HARDCODED_CREDENTIALS', 'const k = `sk-${part}abcdefgh`'), null, 'template strings are not rewritten')
})

test('debug, HTTP and loop caps', () => {
  assert.equal(fix('DEBUG_MODE_IN_PRODUCTION', 'app.run(debug=True)', 'a.py'), 'app.run(debug=False)')
  assert.equal(fix('INSECURE_HTTP_ENDPOINT', "const API = 'http://api.example.com/v1'"), "const API = 'https://api.example.com/v1'")
  assert.equal(fix('INSECURE_HTTP_ENDPOINT', "const API = 'http://localhost:3000'"), null)
  assert.equal(fix('INSECURE_HTTP_ENDPOINT', "const API = 'http://192.168.1.4/x'"), null)
  assert.equal(fix('UNBOUNDED_AGENT_LOOP', 'executor = AgentExecutor(agent=agent, tools=tools)', 'a.py'), 'executor = AgentExecutor(agent=agent, tools=tools, max_iterations=15)')
  assert.equal(fix('UNBOUNDED_AGENT_LOOP', 'executor = AgentExecutor(agent=make(), tools=tools)', 'a.py'), null, 'nested calls are left alone')
  assert.equal(fix('SQL_INJECTION_RISK', "db.query('SELECT * FROM t WHERE id=' + id)"), null, 'no rule = written fix only')
})

test('diff lines: only added and context lines on the new side are commentable', () => {
  const patch = '@@ -1,3 +1,4 @@\n line one\n-old two\n+new two\n+added three\n line four\n@@ -20,2 +21,2 @@\n ctx\n+x'
  assert.deepEqual([...commentableLines(patch)].sort((a, b) => a - b), [1, 2, 3, 4, 21, 22])
  assert.equal(commentableLines(undefined).size, 0)
})

// ── PR flow ──
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
function makeDb() {
  const db = new DatabaseSync(':memory:')
  for (const f of ['billing.sql', 'github.sql']) db.exec(readFileSync(new URL(`../schema/${f}`, import.meta.url), 'utf8'))
  return { raw: db, prepare(q) { const s = db.prepare(q); let v = []; const api = { bind(...x) { v = x; return api }, async first() { return s.get(...v) ?? null }, async run() { s.run(...v); return { success: true, meta: { changes: 1 } } }, async all() { return { results: s.all(...v) } } }; return api } }
}
const FILE = "import requests\nr = requests.get(URL, verify=False)\nprint(r)\n"
const PATCH = '@@ -0,0 +1,3 @@\n+import requests\n+r = requests.get(URL, verify=False)\n+print(r)'
const finding = { id: 'x', code: 'TLS_VERIFICATION_DISABLED', title: 'TLS certificate verification disabled', category: 'B', severity: 'high', whatIsWrong: 'off', whyItMatters: 'w', recommendedFix: 'Turn it on.', line: 2 }
function fakeGithub(existingReviewComments = []) {
  const calls = []
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url); const method = init.method ?? 'GET'
    calls.push({ method, path: u.pathname, body: init.body ? JSON.parse(init.body) : undefined })
    const ok = d => new Response(typeof d === 'string' ? d : JSON.stringify(d), { status: 200 })
    if (u.pathname.endsWith('/access_tokens')) return ok({ token: 't' })
    if (u.pathname.endsWith('/pulls/7/files')) return ok([{ filename: 'agent.py', status: 'added', patch: PATCH }])
    if (u.pathname.includes('/contents/')) return ok(FILE + '# langchain agent tools\n')
    if (u.pathname.endsWith('/pulls/7/comments')) return ok(existingReviewComments)
    if (u.pathname.endsWith('/issues/7/comments')) return method === 'GET' ? ok([]) : ok({ id: 1 })
    return ok({ id: 1 })
  }
  return { fetchFn, calls }
}
const payload = { action: 'opened', installation: { id: 1, account: { login: 'acme', type: 'Organization' } }, repository: { full_name: 'acme/bot', owner: { login: 'acme', type: 'Organization' } }, pull_request: { number: 7, head: { sha: 'abc1234567', ref: 'f' } } }
const env = db => ({ BILLING_DB: db, GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: privateKey, GITHUB_WEBHOOK_SECRET: 's' })
const scanFn = () => ({ verdict: 'NOT_VERIFIED', riskScore: 60, findings: [{ ...finding }] })

test('planner: suggestion only for a fixable finding on a changed line', () => {
  const files = [{ path: 'agent.py', content: FILE }]
  const plan = planFixSuggestions({ findings: [finding] }, files, [{ filename: 'agent.py', status: 'added', patch: PATCH }])
  assert.equal(plan.length, 1)
  assert.match(plan[0].body, /```suggestion\nr = requests.get\(URL, verify=True\)\n```/)
  assert.equal(planFixSuggestions({ findings: [finding] }, files, [{ filename: 'agent.py', status: 'modified', patch: '@@ -5,1 +5,1 @@\n+x' }]).length, 0, 'line not in the diff')
})

test('Pro: one review with the suggestion; not repeated on the next push', async () => {
  const db = makeDb()
  db.raw.prepare("INSERT INTO github_installations (installation_id, account_login, account_type, linked_uid, created_at, updated_at) VALUES (1,'acme','Organization','pro-user',0,0)").run()
  db.raw.prepare("INSERT INTO subscriptions (uid, plan, status, current_period_end, updated_at) VALUES ('pro-user','pro','active',?,0)").run(Math.floor(Date.now() / 1000) + 86400)
  const gh = fakeGithub()
  await processPullRequest(payload, env(db), { fetchFn: gh.fetchFn, scanFn })
  const reviews = gh.calls.filter(c => c.method === 'POST' && c.path.endsWith('/pulls/7/reviews'))
  assert.equal(reviews.length, 1)
  assert.deepEqual(reviews[0].body.comments.map(c => [c.path, c.line, c.side]), [['agent.py', 2, 'RIGHT']])
  const comment = gh.calls.find(c => c.method === 'POST' && c.path.endsWith('/issues/7/comments')).body.body
  assert.match(comment, /1 one-click fix\*\* added as review suggestions/)

  const again = fakeGithub([{ body: reviews[0].body.comments[0].body }])
  await processPullRequest({ ...payload, action: 'synchronize' }, env(db), { fetchFn: again.fetchFn, scanFn })
  assert.equal(again.calls.filter(c => c.path.endsWith('/pulls/7/reviews')).length, 0, 'already suggested: no duplicate review')
})

test('Free: no suggestions posted; the comment says one-click fixes are waiting in Pro', async () => {
  const db = makeDb()
  const gh = fakeGithub()
  await processPullRequest(payload, env(db), { fetchFn: gh.fetchFn, scanFn })
  assert.equal(gh.calls.filter(c => c.path.endsWith('/reviews')).length, 0)
  const comment = gh.calls.find(c => c.method === 'POST' && c.path.endsWith('/issues/7/comments')).body.body
  assert.match(comment, /1 of these can be fixed in one click/)
  assert.doesNotMatch(comment, /verify=True/, 'Free never receives the fix itself')
})
