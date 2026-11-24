// The Agent Verify folder's .htaccess on GoDaddy. On that host, any request our rules do not answer
// goes to the main aimodularity.com app (Passenger), which redirects "/x" to "/x/". On 2026-11-24 a
// rule that removed the ending slash combined with that into an endless redirect loop for missing
// pages. This test acts out the host: our rules first, then the main app, following redirects.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const live = readFileSync(path.join(__dirname, '..', 'public', '.htaccess'), 'utf8')

/** Parses RewriteCond/RewriteRule lines (only the forms this file uses) and ErrorDocument. */
function parse(text) {
  const rules = []
  let conds = []
  let errorDoc = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    let m
    if ((m = line.match(/^RewriteCond\s+%\{REQUEST_FILENAME\}\s+(!?)-(f|d)$/))) conds.push({ negate: m[1] === '!', test: m[2] })
    else if ((m = line.match(/^RewriteRule\s+(\S+)\s+(\S+)\s+\[([^\]]+)\]$/))) { rules.push({ pattern: new RegExp(m[1]), target: m[2], flags: m[3].split(',') }); conds = [] }
    else if ((m = line.match(/^ErrorDocument\s+404\s+(\S+)$/))) errorDoc = m[1]
  }
  return { rules, errorDoc }
}

// A few real files and page folders from the static export (relative to /agentverify/).
const FILES = new Set(['index.html', '404.html', 'pricing/index.html', 'checks/av-mcp-002/index.html', 'favicon.ico'])
const DIRS = new Set(['', 'pricing', 'checks', 'checks/av-mcp-002', 'report'])
const isFile = rel => FILES.has(rel)
const isDir = rel => DIRS.has(rel.replace(/\/$/, ''))

/** One request to /agentverify/<rel>: what the host answers. */
function respond(parsed, rel) {
  for (const r of parsed.rules) {
    const condsOk = (r.conds ?? []).every(c => (c.test === 'f' ? isFile(rel) : isDir(rel)) !== c.negate)
    if (!condsOk || !r.pattern.test(rel)) continue
    const status = (r.flags.find(f => f.startsWith('R=')) ?? '').slice(2)
    if (status === '404') return { status: 404, body: parsed.errorDoc ? 'not-found page' : 'host 404' }
    if (status === '301') return { status: 301, location: r.target.replace('$1', rel.match(r.pattern)[1] ?? '') }
    return { status: 200, body: r.target } // internal rewrite
  }
  if (isFile(rel) || isFile(rel.replace(/\/?$/, '/index.html').replace(/^\//, ''))) return { status: 200, body: rel }
  // Nothing in our folder answered: the main aimodularity.com app gets it, and it adds an ending slash.
  if (!rel.endsWith('/')) return { status: 301, location: `/agentverify/${rel}/` }
  return { status: 404, body: 'main app 404' }
}

function follow(text, rel) {
  // Attach each rule's conditions (the parser resets per rule; re-read them in order).
  const parsed = parse(text)
  const lines = text.split(/\r?\n/).map(l => l.trim())
  let ruleIndex = 0, pending = []
  for (const line of lines) {
    if (line.startsWith('RewriteCond')) { const m = line.match(/(!?)-(f|d)$/); pending.push({ negate: m[1] === '!', test: m[2] }) }
    else if (line.startsWith('RewriteRule')) { parsed.rules[ruleIndex++].conds = pending; pending = [] }
  }
  const hops = []
  let current = rel
  for (let i = 0; i < 10; i++) {
    const res = respond(parsed, current)
    hops.push(`${res.status} /agentverify/${current}`)
    if (res.status !== 301) return { ...res, hops }
    current = res.location.replace(/^\/agentverify\//, '')
  }
  return { status: 'LOOP', hops }
}

// --- the live file ---
for (const missing of ['this-page-does-not-exist', 'this-page-does-not-exist/', 'checks/not-a-real-check/', 'a/b/c']) {
  const r = follow(live, missing)
  assert.equal(r.status, 404, `missing page /${missing} must end in a 404, got ${r.status}: ${r.hops.join(' -> ')}`)
  assert.equal(r.body, 'not-found page', `missing page /${missing} must show our "Page not found" page`)
  assert.ok(r.hops.length <= 2, `missing page /${missing} must answer in at most one redirect: ${r.hops.join(' -> ')}`)
}
for (const [page, hopsAllowed] of [['', 1], ['pricing/', 1], ['pricing', 2], ['checks/av-mcp-002/', 1], ['favicon.ico', 1]]) {
  const r = follow(live, page)
  assert.equal(r.status, 200, `real page /${page} must load, got ${r.status}: ${r.hops.join(' -> ')}`)
  assert.ok(r.hops.length <= hopsAllowed, `real page /${page} took too many hops: ${r.hops.join(' -> ')}`)
}
assert.doesNotMatch(live, /RewriteRule\s+\^\(\.\+\)\/\$/, 'no rule may strip the ending slash (it loops with the main app)')
assert.match(live, /ErrorDocument 404 \/agentverify\/404\.html/)

// --- control: the 2026-11-24 version that looped must be caught by this test ---
const looped = `<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /agentverify/
  RewriteCond %{REQUEST_FILENAME} -d
  RewriteRule ^(.*[^/])$ /agentverify/$1/ [R=301,L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule ^(.+)/$ /agentverify/$1 [R=301,L]
</IfModule>
ErrorDocument 404 /agentverify/404.html`
assert.equal(follow(looped, 'this-page-does-not-exist').status, 'LOOP', 'the simulation must reproduce the loop seen live')

console.log('htaccess.test.mjs: missing pages answer 404 with no loop; real pages load; the old looping rules are caught')
