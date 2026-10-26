// Site content contract test: the pages that publish the profile-attestation signing key, document the OWASP
// Agentic Skills profile, and show a sample assessment. Renders the real page/section components with the same
// esbuild + react-dom/server technique as owaspProfile.test.mjs. The point is that nothing public can drift from
// the facts that matter: the published key must be the real production key (three copies must agree), required
// disclaimers must be present, and no page may use certification wording.
import assert from 'node:assert/strict'
import * as esbuild from 'esbuild'
import crypto from 'node:crypto'
import path from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.join(__dirname, '..', 'src')
const repoRoot = path.join(__dirname, '..', '..', '..')
const tmpDir = path.join(__dirname, '.tmp-site-content')
mkdirSync(tmpDir, { recursive: true })

async function load(entry) {
  const result = await esbuild.build({
    entryPoints: [path.join(srcDir, entry)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react-dom/server', 'firebase', 'firebase/*'],
    alias: {
      '@': srcDir,
      'next/link': path.join(__dirname, '.stubs', 'next-link.mjs'),
      'next/image': path.join(__dirname, '.stubs', 'next-image.mjs'),
    },
    loader: { '.tsx': 'tsx', '.ts': 'ts', '.json': 'json' },
    define: { 'process.env.NODE_ENV': '"test"' },
  })
  const outFile = path.join(tmpDir, `${path.basename(entry).replace(/\.\w+$/, '')}.${Math.random().toString(36).slice(2)}.mjs`)
  writeFileSync(outFile, result.outputFiles[0].text)
  return import('file://' + outFile.replace(/\\/g, '/'))
}

async function render(entry, exportName = 'default', props = {}) {
  const React = (await import('react')).default
  const { renderToStaticMarkup } = await import('react-dom/server')
  const mod = await load(entry)
  const html = renderToStaticMarkup(React.createElement(mod[exportName], props))
  // Assertions are about visible text, so decode the entities React escapes.
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

const BANNED = /OWASP certified|OWASP approved|passed OWASP|verified secure|OWASP-certified|certified by OWASP/i
const IMPLEMENTED_DISCLAIMER = 'Only AST02, AST03 and AST04 are implemented in this profile version. Every other control is not assessed, which is not a pass.'
const ATTRIBUTION_DISCLAIMER = 'Assessed against the OWASP Agentic Skills Top 10 (CC-BY-SA-4.0) at the pinned upstream commit. Not an OWASP certification or endorsement.'
const SIGNATURE_SCOPE = 'The signature proves this exact assessment was issued by Agent Verify and has not been altered. It does not independently prove that every finding is correct or complete.'

try {
  // ── 1. The published key: three copies must agree, and keyId must be the RFC 7638 thumbprint of the key. ──
  const { PROFILE_ATTESTATION_PUBLIC_IDENTITY: identity } = await load('lib/profileAttestationKey.ts')
  const publicFile = JSON.parse(readFileSync(path.join(__dirname, '..', 'public', 'profile-attestation-key.json'), 'utf8'))
  assert.deepEqual(JSON.parse(JSON.stringify(identity)), publicFile, 'public/profile-attestation-key.json must equal lib/profileAttestationKey.ts')

  assert.deepEqual(Object.keys(identity.publicKey).sort(), ['crv', 'kty', 'x', 'y'], 'the published key contains only kty, crv, x, y')
  assert.ok(!JSON.stringify(publicFile).includes('"d"'), 'no private member anywhere in the published file')
  const thumbprintInput = JSON.stringify({ crv: identity.publicKey.crv, kty: identity.publicKey.kty, x: identity.publicKey.x, y: identity.publicKey.y })
  assert.equal(crypto.createHash('sha256').update(thumbprintInput).digest('base64url'), identity.keyId, 'keyId is the RFC 7638 thumbprint of the published key')

  const wrangler = readFileSync(path.join(repoRoot, 'workers', 'api', 'wrangler.toml'), 'utf8')
  assert.match(wrangler, new RegExp(`^PROFILE_ATTESTATION_EXPECTED_KEY_ID = "${identity.keyId}"`, 'm'), 'the Worker pins the same keyId the site publishes')
  assert.match(wrangler, new RegExp(`^PROFILE_ATTESTATION_ISSUER = "${identity.issuer}"`, 'm'))
  assert.match(wrangler, new RegExp(`^PROFILE_ATTESTATION_KEY_PURPOSE = "${identity.purpose}"`, 'm'))
  console.log('✓ published signing key: site page data, public JSON and Worker pin agree; keyId is the key\'s RFC 7638 thumbprint; no private member')

  // ── 2. Signing key page ──
  const keyPage = await render('app/profile-attestation/page.tsx')
  for (const v of [identity.keyId, identity.issuer, identity.algorithm, identity.purpose, identity.publicKey.x, identity.publicKey.y]) assert.ok(keyPage.includes(v), `key page shows ${v}`)
  assert.ok(keyPage.includes(SIGNATURE_SCOPE), 'the signature-scope disclaimer appears verbatim')
  assert.match(keyPage, /GET https:\/\/agentverify-api\.agentverify\.workers\.dev\/v1\/profile-attestation\/public-key/)
  assert.match(keyPage, /not the bundle's own key|brought with it/, 'tells verifiers not to trust the bundle\'s embedded key')
  assert.match(keyPage, /does not yet provide key retirement or revocation history, rollback detection, or trusted timestamping/, 'trust-model limits stated')
  assert.doesNotMatch(keyPage, BANNED)
  assert.doesNotMatch(keyPage, /"d"\s*:/, 'no private JWK member in the page')
  console.log('✓ signing key page: key identity, verification steps, scope disclaimer and honest limits present')

  // ── 3. Landing section ──
  const section = await render('components/home/OwaspProfileSection.tsx', 'OwaspProfileSection')
  assert.ok(section.includes(ATTRIBUTION_DISCLAIMER))
  for (const label of ['Evidence observed', 'Gap identified', 'Not assessed']) assert.ok(section.includes(label), `landing shows "${label}"`)
  assert.match(section, /href="\/owasp-agentic-skills"/)
  assert.match(section, /href="\/profile-attestation"/)
  assert.match(section, /never as a pass/)
  assert.doesNotMatch(section, BANNED)
  assert.doesNotMatch(section, /\b(Passed|Compliant)\b/)
  console.log('✓ landing section: three statuses, attribution disclaimer, links; no certification or pass wording')

  // ── 4. Sample assessment page ──
  const sample = JSON.parse(readFileSync(path.join(srcDir, 'data', 'owaspSample.json'), 'utf8'))
  assert.equal(sample.assessment.schemaVersion, '1.1.0')
  assert.equal(sample.assessment.profile.agentverifyProfileVersion, '1.0.0-alpha.1')
  assert.deepEqual(sample.assessment.controls.map(c => c.controlId), ['AST02', 'AST03', 'AST04'], 'only AST02/03/04 carry results')
  assert.deepEqual(sample.assessment.notImplementedControls, ['AST01', 'AST05', 'AST06', 'AST07', 'AST08', 'AST09', 'AST10'])

  const samplePage = await render('app/owasp-agentic-skills/page.tsx')
  for (let i = 1; i <= 10; i++) assert.ok(samplePage.includes(`AST${String(i).padStart(2, '0')}`), `sample shows AST${i}`)
  assert.ok(samplePage.includes(IMPLEMENTED_DISCLAIMER))
  assert.ok(samplePage.includes(ATTRIBUTION_DISCLAIMER))
  assert.match(samplePage, /Sample assessment/)
  assert.doesNotMatch(samplePage, /New assessment/, 'the read-only sample has no form to return to')
  assert.doesNotMatch(samplePage, /Cryptographically signed/, 'the sample is unsigned and must not claim a signature')
  assert.match(samplePage, /Signed attestation: Not requested/)
  assert.doesNotMatch(samplePage, BANNED)
  assert.match(samplePage, /agentverify scan \.\/my-skill --profile owasp-agentic-skills-2026/)
  const notAssessedCards = samplePage.match(/Not implemented in this profile version/g) ?? []
  assert.equal(notAssessedCards.length, 7, 'seven unimplemented controls are each shown as not assessed')
  console.log('✓ sample page: all ten controls, both disclaimers, unsigned sample never claims a signature')

  // ── 5. Docs ──
  const docs = await render('app/docs/page.tsx')
  const owaspDocs = docs.slice(docs.indexOf('id="owasp-profile"'), docs.indexOf('id="ci-cd"'))
  assert.ok(owaspDocs.length > 500, 'docs have an OWASP profile section')
  assert.match(docs, /href="#owasp-profile"/, 'docs nav links to it')
  assert.match(owaspDocs, /agentverify scan \.\/my-skill --profile owasp-agentic-skills-2026/)
  assert.match(owaspDocs, /"attest": true/)
  assert.ok(owaspDocs.includes('Assessed against the OWASP Agentic Skills Top 10 (CC-BY-SA-4.0) at a pinned upstream commit. This is not an OWASP certification or endorsement.'))
  assert.match(owaspDocs, /1\.0\.0-alpha\.1/)
  assert.match(owaspDocs, /Neither is the Agent Verify product version/)
  for (const status of ['EVIDENCE_OBSERVED', 'GAP_IDENTIFIED', 'NOT_ASSESSED']) assert.ok(owaspDocs.includes(status))
  for (const code of ['422', '429', '503', '500']) assert.ok(owaspDocs.includes(`>${code}<`) || owaspDocs.includes(code), `docs cover ${code}`)
  assert.ok(owaspDocs.includes('A signature proves this exact assessment was issued by Agent Verify and has not been altered. It does not independently prove that every finding is correct or complete.'), 'docs state what a signature proves')
  assert.match(owaspDocs, /uses one scan from your monthly quota, signed or unsigned/)
  assert.doesNotMatch(docs, BANNED)
  console.log('✓ docs: OWASP section covers CLI, API, statuses, versions, signing, metering and error codes; no certification wording')

  // ── 6. Discoverability ──
  const sitemap = (await load('app/sitemap.ts')).default().map(e => e.url)
  assert.ok(sitemap.includes('https://aimodularity.com/agentverify/owasp-agentic-skills/'))
  assert.ok(sitemap.includes('https://aimodularity.com/agentverify/profile-attestation/'))
  const footer = await render('components/layout/Footer.tsx', 'Footer')
  assert.match(footer, /href="\/owasp-agentic-skills"/)
  assert.match(footer, /href="\/profile-attestation"/)
  console.log('✓ sitemap and footer link to the new pages')

  console.log('\nAll site content assertions passed.')
} finally {
  rmSync(tmpDir, { recursive: true, force: true })
}
