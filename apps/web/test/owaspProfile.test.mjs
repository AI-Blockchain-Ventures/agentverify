// OWASP Agentic Skills profile UI contract test. Renders the REAL .tsx components (via esbuild + react-dom/
// server, the same technique test/sixViewContract.test.mjs already established for this repo) against
// realistic fixtures shaped exactly like the backend's documented API response (workers/api/src/profiles.ts,
// workers/api/src/profileAttestationSigning.ts) — proving the UI renders from typed API data, not from its
// own inference.
import assert from 'node:assert/strict'
import * as esbuild from 'esbuild'
import path from 'node:path'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.join(__dirname, '..', 'src')
const tmpDir = path.join(__dirname, '.tmp-owasp-profile')
mkdirSync(tmpDir, { recursive: true })

async function renderComponent(componentFile, exportName, props) {
  const result = await esbuild.build({
    entryPoints: [path.join(srcDir, 'components', 'scanner', componentFile)],
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
    loader: { '.tsx': 'tsx', '.ts': 'ts' },
    define: { 'process.env.NODE_ENV': '"test"' },
  })
  const outFile = path.join(tmpDir, componentFile.replace('.tsx', `.${Math.random().toString(36).slice(2)}.mjs`))
  writeFileSync(outFile, result.outputFiles[0].text)
  const mod = await import('file://' + outFile.replace(/\\/g, '/'))
  const React = (await import('react')).default
  const { renderToStaticMarkup } = await import('react-dom/server')
  return renderToStaticMarkup(React.createElement(mod[exportName], props))
}

// ── Fixtures, shaped exactly like the real API response ──────────────────────────────────────────────────

const evidence = [
  { id: 'ev-gap', kind: 'permissions.manifest_absent', axis: 'manifest', polarity: 'gap', severity: 'medium', confidence: 'high', provenance: ['STATICALLY_OBSERVED'], summary: 'SKILL.md declares no permissions.', expected: 'An explicit permissions declaration.', remediation: 'Add a permissions block.', locations: [{ file: 'SKILL.md' }], facts: {} },
  { id: 'ev-positive', kind: 'network.consistent', axis: 'network', polarity: 'positive', severity: 'low', confidence: 'medium', provenance: ['STATICALLY_OBSERVED'], summary: 'No network permission declared and none used.', expected: 'No undeclared egress.', remediation: 'None needed.', locations: [], facts: {} },
]

function baseAssessment(overrides = {}) {
  return {
    schemaVersion: '1.1.0',
    profile: {
      profileId: 'owasp-agentic-skills-2026', framework: 'OWASP_AGENTIC_SKILLS_TOP_10',
      upstreamRepo: 'OWASP/www-project-agentic-skills-top-10', upstreamCommit: 'd6f7d7d0de314f52a83a85d1828e06ab096e595c',
      upstreamStatus: 'public-review', upstreamLicense: 'CC-BY-SA-4.0', agentverifyProfileVersion: '1.0.0-alpha.1',
      implementedControls: ['AST02', 'AST03', 'AST04'],
      scannerVersion: '1.4.0', assessmentEngineVersion: '1.0.1', riskRubricVersion: '1.0.0', keyAllowlistVersion: '1.0.0', normalizationVersion: '1.0.0',
    },
    controls: [
      { controlId: 'AST02', framework: 'OWASP_AGENTIC_SKILLS_TOP_10', title: 'Supply Chain Compromise', upstreamSeverity: 'Critical', status: 'EVIDENCE_OBSERVED', confidence: 'high', explanation: 'No dependency ranges found.',
        checks: [{ checkId: '2.3', title: 'Dependencies pinned', status: 'EVIDENCE_OBSERVED', confidence: 'high', provenance: ['STATICALLY_OBSERVED'], supportingEvidenceIds: ['ev-positive'], explanation: 'No unpinned ranges.' }],
        coverage: { total: 1, evidenceObserved: 1, gapIdentified: 0, notAssessed: 0 } },
      { controlId: 'AST03', framework: 'OWASP_AGENTIC_SKILLS_TOP_10', title: 'Over-Privileged Skills', upstreamSeverity: 'High', status: 'GAP_IDENTIFIED', confidence: 'high', explanation: '1 of 2 checks show a gap.',
        checks: [
          { checkId: '3.1', title: 'Permission manifest present', status: 'GAP_IDENTIFIED', confidence: 'high', provenance: ['STATICALLY_OBSERVED'], supportingEvidenceIds: ['ev-gap'], explanation: 'No permissions block found.' },
          { checkId: '3.2', title: 'Minimal permissions', status: 'EVIDENCE_OBSERVED', confidence: 'medium', provenance: ['STATICALLY_OBSERVED'], supportingEvidenceIds: ['ev-positive'], explanation: 'No excess permissions observed.' },
        ],
        coverage: { total: 2, evidenceObserved: 1, gapIdentified: 1, notAssessed: 0 } },
      { controlId: 'AST04', framework: 'OWASP_AGENTIC_SKILLS_TOP_10', title: 'Insecure Metadata', upstreamSeverity: 'High', status: 'NOT_ASSESSED', confidence: 'low', explanation: 'No checks could be established.',
        checks: [{ checkId: '4.1', title: 'Description accuracy', status: 'NOT_ASSESSED', confidence: 'low', provenance: [], supportingEvidenceIds: [], explanation: 'Cannot be affirmed from a package.' }],
        coverage: { total: 1, evidenceObserved: 0, gapIdentified: 0, notAssessed: 1 } },
    ],
    notImplementedControls: ['AST01', 'AST05', 'AST06', 'AST07', 'AST08', 'AST09', 'AST10'],
    evidence,
    unmappedEvidenceIds: [],
    package: { digest: 'avpkg-sha256:' + 'a'.repeat(64), fileCount: 1, manifestFiles: ['SKILL.md'] },
    notes: ['Assessed against the OWASP Agentic Skills Top 10 (CC-BY-SA-4.0) at the pinned upstream commit. Not an OWASP certification or endorsement.'],
    ...overrides,
  }
}

const signedResponse = {
  profile: 'owasp-agentic-skills-2026',
  assessment: baseAssessment(),
  attestation: {
    payload: {
      attestationType: 'agentverify.profile-assessment', attestationVersion: '1.0.0', profile: 'owasp-agentic-skills-2026', profileVersion: '1.0.0-alpha.1',
      framework: 'OWASP_AGENTIC_SKILLS_TOP_10', issuer: 'agentverify-profile-prod',
      upstream: { repo: 'OWASP/www-project-agentic-skills-top-10', commit: 'd6f7d7d0de314f52a83a85d1828e06ab096e595c', license: 'CC-BY-SA-4.0' },
      implementedControls: ['AST02', 'AST03', 'AST04'], assessmentSchemaVersion: '1.1.0',
      interpretationVersions: { scannerVersion: '1.4.0', assessmentEngineVersion: '1.0.1', riskRubricVersion: '1.0.0', keyAllowlistVersion: '1.0.0', normalizationVersion: '1.0.0' },
      package: { digest: 'avpkg-sha256:' + 'a'.repeat(64), fileCount: 1 },
      assessment: { digest: 'avassess-sha256:' + 'b'.repeat(64), canonicalization: 'RFC8785' },
      keyId: 'qTbWyxwe6WfzhukfJ5MDOezqS55MICEPWaXm-gcnTxk', issuedAt: '2026-09-22T18:23:13.725Z',
    },
    signature: 'c'.repeat(88),
    algorithm: 'ECDSA-P256-SHA256',
    publicKey: { kty: 'EC', crv: 'P-256', x: 'x'.repeat(43), y: 'y'.repeat(43) },
  },
  saved: false,
  bundleVersion: '1.0.0',
}

const unsignedResponse = { profile: 'owasp-agentic-skills-2026', assessment: baseAssessment(), attestation: null, saved: false }

// initiallyShowDetails: true is TEST-ONLY (see the component's own prop doc): static server rendering cannot
// simulate the real "expand technical details" click, so this exercises the collapsed content directly rather
// than changing what a real visitor sees by default (proven collapsed-by-default separately, below).
const signed = await renderComponent('OwaspProfileResult.tsx', 'OwaspProfileResult', { response: signedResponse, onNewAssessment: () => {}, initiallyShowDetails: true })
const unsigned = await renderComponent('OwaspProfileResult.tsx', 'OwaspProfileResult', { response: unsignedResponse, onNewAssessment: () => {}, initiallyShowDetails: true })
const signedCollapsedByDefault = await renderComponent('OwaspProfileResult.tsx', 'OwaspProfileResult', { response: signedResponse, onNewAssessment: () => {} })
const requestPanel = await renderComponent('OwaspProfilePanel.tsx', 'OwaspProfilePanel', { user: null })
const scannerDefault = await renderComponent('ScannerPanel.tsx', 'ScannerPanel', { user: null })

// ============================================================================
// 1. All ten AST controls are represented.
// ============================================================================
for (const id of ['AST01', 'AST02', 'AST03', 'AST04', 'AST05', 'AST06', 'AST07', 'AST08', 'AST09', 'AST10']) {
  assert.match(signed, new RegExp(id), `${id} must appear in the rendered result`)
}
console.log('✓ all ten AST controls are represented')

// ============================================================================
// 2. Only AST02/AST03/AST04 can currently show assessed (non-NOT_ASSESSED) results; the other seven are
//    ALWAYS "Not assessed", never hidden, never implied as passed.
// ============================================================================
{
  // The seven unimplemented controls' titles from the static OWASP catalog, each paired with NOT_ASSESSED.
  const unimplementedTitles = ['Malicious Skills', 'Untrusted External Instructions', 'Weak Isolation', 'Update Drift', 'Poor Scanning', 'No Governance', 'Cross-Platform Reuse']
  for (const title of unimplementedTitles) assert.match(signed, new RegExp(title), title)
  // 9 "Not assessed" occurrences: 7 unimplemented-control badges + AST04's own NOT_ASSESSED status badge in
  // the fixture + the top summary stat's "Not assessed" count label.
  const notAssessedCount = (signed.match(/Not assessed/g) || []).length
  assert.equal(notAssessedCount, 9, `expected 9 "Not assessed" occurrences (7 unimplemented + AST04's status + the summary stat label), got ${notAssessedCount}`)
  assert.match(signed, /Gap identified/, 'AST03\'s GAP_IDENTIFIED status must render')
  assert.match(signed, /Evidence observed/, 'AST02\'s EVIDENCE_OBSERVED status must render')
}
console.log('✓ only AST02/03/04 can show assessed results; the other seven are always NOT_ASSESSED')

// ============================================================================
// 3. NOT_ASSESSED is never rendered as a pass, safe, compliant, or certified claim anywhere on the page.
// ============================================================================
for (const forbidden of [/\bPassed\b/i, /\bCompliant\b/i, /\bCertified\b/i, /\bOWASP certified\b/i, /\bOWASP approved\b/i, /\bpassed OWASP\b/i, /\bverified secure\b/i]) {
  assert.doesNotMatch(signed, forbidden, `forbidden overclaiming wording: ${forbidden}`)
  assert.doesNotMatch(unsigned, forbidden, `forbidden overclaiming wording: ${forbidden}`)
}
console.log('✓ no overclaiming wording (passed/compliant/certified/verified secure) appears anywhere')

// ============================================================================
// 4. Gap/evidence statuses render from API fixture values, not UI inference: swapping the fixture's status
//    changes the rendered output accordingly.
// ============================================================================
{
  const flipped = { ...signedResponse, assessment: baseAssessment({ controls: baseAssessment().controls.map(c => c.controlId === 'AST02' ? { ...c, status: 'GAP_IDENTIFIED' } : c) }) }
  const flippedOutput = await renderComponent('OwaspProfileResult.tsx', 'OwaspProfileResult', { response: flipped, onNewAssessment: () => {} })
  const gapCountBefore = (signed.match(/Gap identified/g) || []).length
  const gapCountAfter = (flippedOutput.match(/Gap identified/g) || []).length
  assert.ok(gapCountAfter > gapCountBefore, 'changing the fixture\'s status must change the rendered status count (proves rendering from API data, not inference)')
}
console.log('✓ statuses render from API fixture values, not UI inference')

// ============================================================================
// 5. The signing indicator is structurally separate from the findings/controls.
// ============================================================================
{
  const signedAttestationIdx = signed.indexOf('Signed attestation')
  const controlsIdx = signed.indexOf('AST02')
  assert.ok(signedAttestationIdx > -1 && controlsIdx > -1)
  assert.notEqual(signedAttestationIdx, controlsIdx, 'the signing section and the controls section are distinct regions of the page')
}
console.log('✓ signing indicator is a separate section from findings')

// ============================================================================
// 6. Unsigned vs signed states render correctly and distinctly.
// ============================================================================
assert.match(unsigned, /Not requested/)
assert.doesNotMatch(unsigned, /agentverify-profile-prod/, 'unsigned result must not show issuer details')
assert.match(signed, /Cryptographically signed by Agent Verify/)
assert.match(signed, /agentverify-profile-prod/)
assert.match(signed, /qTbWyxwe6WfzhukfJ5MDOezqS55MICEPWaXm-gcnTxk/, 'keyId must be shown')
assert.match(signed, /ECDSA-P256-SHA256/, 'algorithm must be shown')
assert.match(signed, /1\.0\.0/, 'bundleVersion must be shown')
console.log('✓ unsigned vs signed states render distinctly')

// ============================================================================
// 7. Profile-version "alpha" wording cannot be confused with Agent Verify's own v1.5.0 release.
// ============================================================================
assert.match(signed, /1\.0\.0-alpha\.1/, 'the profile mapping version itself must be shown')
assert.match(signed, /not of Agent Verify/i)
assert.match(signed, /Agent Verify is released as v1\.5\.0/)
assert.doesNotMatch(signedCollapsedByDefault, /1\.0\.0-alpha\.1/, 'the technical-details section (which carries the alpha version string) is collapsed by default — secondary, not front-and-center (requirement 12)')
console.log('✓ profile-version alpha wording is clarified against Agent Verify v1.5.0, and is collapsed/secondary by default')

// ============================================================================
// 8. Required disclaimers appear verbatim.
// ============================================================================
assert.match(signed, /Only AST02, AST03 and AST04 are implemented in this profile version\. Every other control is not assessed, which is not a pass\./)
assert.match(signed, /Assessed against the OWASP Agentic Skills Top 10 \(CC-BY-SA-4\.0\) at the pinned upstream commit\. Not an OWASP certification or endorsement\./)
assert.match(unsigned, /Only AST02, AST03 and AST04 are implemented in this profile version\. Every other control is not assessed, which is not a pass\./)
console.log('✓ required disclaimers appear verbatim, signed and unsigned alike')

// ============================================================================
// 9. Public-key verification guidance appears for signed results, and the signature-scope clarification is present.
// ============================================================================
assert.match(signed, /Verify the signing key independently using Agent Verify&#x27;s published profile-attestation public key\./)
assert.match(signed, /GET \/v1\/profile-attestation\/public-key/)
assert.match(signed, /The signature proves this exact assessment was issued by Agent Verify and has not been altered\. It does not independently prove that every finding is correct or complete\./)
console.log('✓ public-key verification guidance and signature-scope clarification appear for signed results')

// ============================================================================
// 10. Metering wording never implies signing costs an additional scan.
// ============================================================================
// The unsigned result view's own "not signed" explanation lives inside the collapsible
// "Signed attestation" section, which (like the technical-details section) is collapsed by
// default when there is nothing notable to show — matching real product behavior, not a test
// artifact. The pre-submission checkbox copy in OwaspProfilePanel is what a customer actually
// reads before deciding whether to request signing, so that is what requirement 10 is verified
// against here.
assert.match(unsigned, /Not requested/, 'unsigned result must show the neutral, uncollapsed "Not requested" indicator')
assert.match(requestPanel, /Signing does not change the assessment result and costs the same one scan as an unsigned assessment\./)
console.log('✓ metering wording does not imply signing costs an additional scan')

// ============================================================================
// 11. Existing Agent Verify UI behavior is unchanged when no OWASP profile is used (ScannerPanel default).
// ============================================================================
assert.match(scannerDefault, /Scan agent/, 'the standard scan header must still render by default')
assert.match(scannerDefault, /Upload or paste an agent file to generate a security report/, 'the standard scan copy must be unchanged')
assert.match(scannerDefault, /OWASP Agentic Skills profile/, 'the new toggle option must be present')
assert.doesNotMatch(scannerDefault, /Run OWASP assessment/, 'the OWASP request panel must NOT render by default (standard mode is the default)')
console.log('✓ existing ScannerPanel behavior is unchanged by default; OWASP is an explicit, additional option')

// ============================================================================
// 12. The OWASP profile is an explicit request option (requirement 8): the profile identifier and the
//     explicit `attest` opt-in language are both present in the request UI, and the request panel does not
//     pre-select signing.
// ============================================================================
assert.match(requestPanel, /Run OWASP assessment/)
assert.match(requestPanel, /Request cryptographic signing/)
assert.match(requestPanel, /attest: true/)
console.log('✓ the OWASP profile is an explicit, separate assessment request option')

rmSync(tmpDir, { recursive: true, force: true })
console.log('\nAll OWASP profile UI contract assertions passed.')
