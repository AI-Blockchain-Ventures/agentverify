// Post-upload check for the manual static deploy. Run after uploading apps/web/out/agentverify:
//   node scripts/verify-web-deploy.mjs [baseUrl]        (default https://aimodularity.com/agentverify)
// It compares the live site with the local build in out/agentverify and fails on the failure we have actually
// seen: the host answering 200 with an HTML fallback page for an asset that was never uploaded.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const base = (process.argv[2] ?? 'https://aimodularity.com/agentverify').replace(/\/$/, '')
const outDir = fileURLToPath(new URL('../out/agentverify/', import.meta.url))
const API_KEY_ROUTE = 'https://agentverify-api.agentverify.workers.dev/v1/profile-attestation/public-key'

if (!existsSync(outDir)) { console.error(`No local build at ${outDir}. Run "npm run export" first.`); process.exit(2) }

const walk = dir => readdirSync(dir).flatMap(name => {
  const p = join(dir, name)
  return statSync(p).isDirectory() ? walk(p) : [p]
})

const EXPECTED_TYPE = {
  '.js': /javascript/, '.css': /text\/css/, '.json': /json/, '.svg': /svg/, '.png': /image\/png/, '.ico': /icon/,
}

const failures = []
const fail = msg => { failures.push(msg); console.error(`FAIL  ${msg}`) }
const urlFor = file => `${base}/${relative(outDir, file).split(sep).join('/')}`

// 1. Every built asset (everything under _next/static plus the public/ files) must be served as itself.
const assets = walk(outDir).filter(f => /[\\/]_next[\\/]static[\\/]/.test(f) || ['.png', '.svg', '.ico', '.json'].includes(extname(f)))
let ok = 0
for (let i = 0; i < assets.length; i += 8) {
  await Promise.all(assets.slice(i, i + 8).map(async file => {
    const url = urlFor(file)
    let res
    try { res = await fetch(url) } catch (e) { return fail(`${url} - ${e.message}`) }
    if (!res.ok) return fail(`${url} - HTTP ${res.status}`)
    const type = res.headers.get('content-type') ?? ''
    const want = EXPECTED_TYPE[extname(file)]
    if (want && !want.test(type)) return fail(`${url} - Content-Type "${type}" (expected ${want}); this is usually an HTML fallback for a missing file`)
    if (extname(file) === '.js' || extname(file) === '.css') {
      const remote = Buffer.from(await res.arrayBuffer())
      if (!remote.equals(readFileSync(file))) return fail(`${url} - content differs from the local build (stale or partial upload)`)
    }
    ok++
  }))
}
console.log(`assets served correctly: ${ok}/${assets.length}`)

// 2. Every built page must be served and must be its own page, not the root page repeated.
const pages = walk(outDir).filter(f => f.endsWith('index.html'))
const rootEtag = (await fetch(`${base}/`)).headers.get('etag')
const buildId = readdirSync(join(outDir, '_next')).find(name => name !== 'static')
for (const file of pages) {
  const url = urlFor(file).replace(/index\.html$/, '')
  const res = await fetch(url)
  if (!res.ok) { fail(`${url} - HTTP ${res.status}`); continue }
  const html = await res.text()
  if (buildId && !html.includes(buildId)) fail(`${url} - does not reference this build's id ${buildId} (stale page or HTML fallback)`)
  if (url !== `${base}/` && rootEtag && res.headers.get('etag') === rootEtag) fail(`${url} - identical to the root page`)
}
console.log(`pages checked: ${pages.length}`)

// 3. The key published on the site must equal what the API serves.
try {
  const site = await (await fetch(`${base}/profile-attestation-key.json`)).json()
  const api = await (await fetch(API_KEY_ROUTE)).json()
  if (JSON.stringify(site) !== JSON.stringify(api)) fail('site profile-attestation-key.json differs from the API public-key route')
  else console.log(`published signing key matches the API (keyId ${api.keyId})`)
} catch (e) { fail(`could not compare the published signing key: ${e.message}`) }

if (failures.length > 0) { console.error(`\n${failures.length} problem(s). Do not announce this deploy.`); process.exit(1) }
console.log('\nWeb deploy verified.')
