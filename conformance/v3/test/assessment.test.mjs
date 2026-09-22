import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ASSESSMENT_SCHEMA_PROBLEM_CODES, AXES, CHECK_STATUSES, CONFIDENCES, POLARITIES, PROVENANCES, SEVERITIES, UPSTREAM_SEVERITIES, assessmentSchemaProblem } from '../reference/assessmentSchema.mjs'
import * as ref from '../reference/profileAttestation.mjs'
import { PROFILE_DEFINITION_PROBLEM_CODES, PROFILE_REGISTRY, lookupProfile, profileDefinitionProblem } from '../reference/profileRegistry.mjs'
import { applyPatch, caseOptions, loadVector, resolveSource, reviveNumbers, toInputBytes } from './helpers.mjs'

const SCHEMA = loadVector('assessment-schema.v3.json')
const REGISTRY = loadVector('profile-registry.v3.json')
const ADMISSION = loadVector('admission.v3.json')
const BUNDLES = loadVector('bundles.v3.json')
const base = () => structuredClone(SCHEMA.base)
const build = patch => reviveNumbers(applyPatch(base(), patch))
const run = c => ref.verifyProfileBundleBytes(toInputBytes(resolveSource(BUNDLES, c.source)), caseOptions(BUNDLES, c))

// ══ 1. SUPPORTED is defined by an exact assessment schema ═══════════════════════════════════════════════════════

test('SCHEMA: every frozen case gives its frozen result, the base is valid, and every problem code has a vector', () => {
  assert.ok(SCHEMA.cases.length >= 70)
  assert.equal(assessmentSchemaProblem(SCHEMA.base), null)
  for (const c of SCHEMA.cases) assert.equal(assessmentSchemaProblem(build(c.patch)), c.expected, c.name)
  const covered = new Set(SCHEMA.cases.map(c => c.expected).filter(Boolean))
  for (const code of ASSESSMENT_SCHEMA_PROBLEM_CODES) assert.ok(covered.has(code), `no vector for ${code}`)
  for (const code of covered) assert.ok(ASSESSMENT_SCHEMA_PROBLEM_CODES.includes(code), code)
  assert.deepEqual(SCHEMA.problemCodes, [...ASSESSMENT_SCHEMA_PROBLEM_CODES])
})

test('SCHEMA: the enums in the vectors are exactly the reference\'s', () => {
  assert.deepEqual(SCHEMA.enums, { confidence: [...CONFIDENCES], severity: [...SEVERITIES], polarity: [...POLARITIES], axis: [...AXES], provenance: [...PROVENANCES], upstreamSeverity: [...UPSTREAM_SEVERITIES], checkStatus: [...CHECK_STATUSES] })
})

test('SCHEMA: an unknown field is refused at EVERY object of the assessment (the schema is closed everywhere)', () => {
  const walk = (v, p, out) => { if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}/${i}`, out)); else if (v && typeof v === 'object') { out.push(p); for (const [k, x] of Object.entries(v)) walk(x, `${p}/${k}`, out) } return out }
  const objects = walk(base(), '', [])
  assert.ok(objects.length > 15)
  for (const p of objects) {
    // (`facts` is an open map of scalars: an unknown NAME is allowed there, an unknown non-scalar VALUE is not.)
    const a = applyPatch(base(), [{ op: 'add', path: `${p}/zzUnknown`, value: p.endsWith('/facts') ? { nested: 1 } : 'x' }])
    assert.notEqual(assessmentSchemaProblem(a), null, `an unknown field at ${p || '(root)'} was accepted`)
  }
})

test('SCHEMA: removing ANY required field, anywhere, is refused', () => {
  const walk = (v, p, out) => { if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}/${i}`, out)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(`${p}/${k}`); walk(x, `${p}/${k}`, out) } return out }
  const optional = new Set(['/evidence/0/locations/0/line', '/evidence/1/locations/0/line', '/evidence/1/locations/1/line', '/evidence/0/locations/0/keyPath'])
  for (const p of walk(base(), '', [])) {
    if (/\/facts\//.test(p)) continue // facts members are free-form scalars
    if (/^\/(controls|evidence)\/\d+$/.test(p) || /\/(checks|locations)\/\d+$/.test(p) || /\/(implementedControls|notImplementedControls|notes|manifestFiles|provenance|supportingEvidenceIds|unmappedEvidenceIds)\/\d+$/.test(p) || optional.has(p)) continue // array items / optional members
    const a = applyPatch(base(), [{ op: 'remove', path: p }])
    assert.notEqual(assessmentSchemaProblem(a), null, `removing ${p} was accepted`)
  }
})

test('SCHEMA: swapping the order of the controls, checks or implemented list is refused or changes nothing that is trusted', () => {
  assert.notEqual(assessmentSchemaProblem(build([{ op: 'swap', path: '/controls', i: 0, j: 1 }])), null)
  assert.notEqual(assessmentSchemaProblem(build([{ op: 'swap', path: '/profile/implementedControls', i: 0, j: 1 }])), null, 'implementedControls must be in controls order')
})

test('SCHEMA: real scanner output validates against it (the reference schema is not a fantasy)', async () => {
  // The private scanner's own test (packages/scanner/test/conformanceAvpkg.test.mjs) validates its REAL assessments against this schema;
  // here the structural facts it relies on are pinned: the real check ids, control ids and the control-status rule.
  const real = base()
  assert.deepEqual(real.controls.map(c => c.controlId), real.profile.implementedControls)
  assert.deepEqual([...new Set(SCHEMA.cases.map(c => c.expected))].filter(Boolean).length > 10, true)
  assert.equal(SCHEMA.controlStatusRule.includes('no "passed" status'), true)
})

// ══ 2. the CLOSED registry pins the definition of a profile ═════════════════════════════════════════════════════

test('REGISTRY: the frozen registry is exactly the reference registry, deeply frozen, own-key only', () => {
  assert.deepEqual(REGISTRY.registry, JSON.parse(JSON.stringify(PROFILE_REGISTRY)))
  const deepFrozen = o => Object.isFrozen(o) && Object.values(o).every(v => typeof v !== 'object' || v === null || deepFrozen(v))
  assert.ok(deepFrozen(PROFILE_REGISTRY))
  const def = PROFILE_REGISTRY['owasp-agentic-skills-2026'].versions['1.0.0-alpha.1']
  assert.deepEqual(Object.keys(def).sort(), ['assessmentSchemaVersion', 'controlUniverse', 'framework', 'implementedControls', 'upstream'])
  assert.deepEqual(Object.keys(def.upstream).sort(), ['commit', 'license', 'repo', 'status'])
  assert.equal(def.upstream.commit, 'd6f7d7d0de314f52a83a85d1828e06ab096e595c')
  assert.equal(def.upstream.repo, 'OWASP/www-project-agentic-skills-top-10')
  assert.equal(def.upstream.license, 'CC-BY-SA-4.0')
  assert.deepEqual(def.implementedControls, ['AST02', 'AST03', 'AST04'])
  assert.equal(def.controlUniverse.length, 10)
})

test('REGISTRY: lookups are by OWN key and give the frozen answers', () => {
  for (const l of REGISTRY.lookups) {
    const r = lookupProfile(PROFILE_REGISTRY, l.profileId, l.profileVersion)
    if (l.expected.found) assert.ok(r.definition, `${l.profileId}@${l.profileVersion}`)
    else assert.equal(r.problem, l.expected.problem, `${l.profileId}@${l.profileVersion}`)
  }
  assert.equal(lookupProfile(PROFILE_REGISTRY, 5, '1.0.0-alpha.1').problem, 'UNSUPPORTED_PROFILE')
  assert.equal(lookupProfile(PROFILE_REGISTRY, 'owasp-agentic-skills-2026', 5).problem, 'UNSUPPORTED_PROFILE_VERSION')
})

test('REGISTRY: every pinned value, altered in the assessment, makes the interpretation PROFILE_DEFINITION_MISMATCH with the right reason', () => {
  for (const c of REGISTRY.definitionCases) {
    const a = build(c.patch)
    assert.equal(assessmentSchemaProblem(a), null, `${c.name} is structurally valid`)
    const out = ref.interpretationOf(a)
    assert.deepEqual(out, c.expected, c.name)
  }
  assert.ok(REGISTRY.definitionCases.length >= 9)
})

test('REGISTRY: every pin is enforced even where no JSON vector can reach it (the registry itself is altered, one pin at a time)', () => {
  const def = PROFILE_REGISTRY['owasp-agentic-skills-2026'].versions['1.0.0-alpha.1']
  const variants = [
    ['profile.framework', d => { d.framework = 'X' }], ['profile.upstream.repo', d => { d.upstream.repo = 'x/y' }], ['profile.upstream.commit', d => { d.upstream.commit = 'f'.repeat(40) }],
    ['profile.upstream.license', d => { d.upstream.license = 'MIT' }], ['profile.upstream.status', d => { d.upstream.status = 'final' }],
    ['profile.implemented-controls', d => { d.implementedControls = ['AST02', 'AST03'] }],
    ['profile.not-implemented-controls', d => { d.controlUniverse = d.controlUniverse.slice(0, 9) }],
    ['profile.assessment-schema-version', d => { d.assessmentSchemaVersion = '1.0.0' }],
  ]
  const seen = new Set()
  for (const [reason, mutate] of variants) {
    const d = structuredClone(def); mutate(d)
    const registry = { 'owasp-agentic-skills-2026': { versions: { '1.0.0-alpha.1': d } } }
    const out = ref.interpretationOf(base(), undefined, { profileRegistry: registry })
    assert.deepEqual(out, { interpretation: 'PROFILE_DEFINITION_MISMATCH', interpretationReason: reason }, reason)
    seen.add(reason)
  }
  for (const code of PROFILE_DEFINITION_PROBLEM_CODES) assert.ok(seen.has(code), `no test for ${code}`)
  assert.deepEqual(REGISTRY.problemCodes, [...PROFILE_DEFINITION_PROBLEM_CODES])
  assert.equal(profileDefinitionProblem(def, base()), null)
})

test('REGISTRY: the interpretation versions are NOT pinned (each is bound independently), and the profile version is part of the lookup', async () => {
  for (const f of ['scannerVersion', 'assessmentEngineVersion', 'riskRubricVersion', 'keyAllowlistVersion', 'normalizationVersion']) {
    const a = base(); a.profile[f] = '9.9.9'
    assert.deepEqual(ref.interpretationOf(a), { interpretation: 'SUPPORTED' }, `${f} is not a pin`)
  }
  const v = base(); v.profile.agentverifyProfileVersion = '9.9.9'
  assert.deepEqual(ref.interpretationOf(v), { interpretation: 'UNSUPPORTED_PROFILE_VERSION' })
  for (const f of ['scannerVersion', 'assessmentEngineVersion', 'riskRubricVersion', 'keyAllowlistVersion', 'normalizationVersion']) {
    assert.ok(ref.CROSS_CHECKS.some(c => c.binding === `interpretationVersions.${f}`), `${f} has its own cross-check`)
  }
})

test('INTERPRETATION ORDER: schema, then structure, then profile, then version, then definition; the first failure decides', () => {
  const both = (mutate) => { const a = base(); mutate(a); return ref.interpretationOf(a) }
  assert.equal(both(a => { a.schemaVersion = '1.2.0'; a.extra = 1 }).interpretation, 'UNSUPPORTED_SCHEMA')
  assert.equal(both(a => { a.extra = 1; a.profile.profileId = 'other' }).interpretation, 'INVALID_ASSESSMENT')
  assert.equal(both(a => { a.profile.profileId = 'other'; a.profile.agentverifyProfileVersion = '9.9.9' }).interpretation, 'UNSUPPORTED_PROFILE')
  assert.equal(both(a => { a.profile.agentverifyProfileVersion = '9.9.9'; a.profile.upstreamCommit = 'f'.repeat(40) }).interpretation, 'UNSUPPORTED_PROFILE_VERSION')
  assert.equal(both(a => { a.profile.upstreamCommit = 'f'.repeat(40) }).interpretation, 'PROFILE_DEFINITION_MISMATCH')
  assert.equal(both(() => {}).interpretation, 'SUPPORTED')
  for (const n of ['interpretation.schema-decided-before-profile', 'invalid-assessment.structure-decided-before-profile']) assert.ok(BUNDLES.cases.find(c => c.name === n), n)
  assert.deepEqual(REGISTRY.interpretationOrder, ['UNSUPPORTED_SCHEMA', 'INVALID_ASSESSMENT', 'UNSUPPORTED_PROFILE', 'UNSUPPORTED_PROFILE_VERSION', 'PROFILE_DEFINITION_MISMATCH', 'SUPPORTED'])
})

test('SUPPORTED IS STRONG, end to end: a malformed, mismatched or unsupported assessment is never SUPPORTED and never satisfies a policy', async () => {
  const cases = BUNDLES.cases.filter(c => c.name.startsWith('invalid-assessment.') || c.name.startsWith('profile-definition.') || c.name.startsWith('unsupported-schema.') || c.name.startsWith('interpretation.'))
  assert.ok(cases.length >= 25)
  for (const c of cases) {
    const r = await run(c)
    for (const [k, v] of Object.entries(c.expected)) assert.deepEqual(r[k], v, `${c.name}: ${k}`)
    if (r.integrity === 'VALID' && r.interpretation !== 'SUPPORTED') {
      const p = await ref.verifyProfileBundleBytes(toInputBytes(resolveSource(BUNDLES, c.source)), { keySet: BUNDLES.keySets.active, policy: {} })
      assert.equal(p.policy.status, 'NOT_SATISFIED', c.name)
      assert.ok(p.policy.failures.includes('INTERPRETATION_UNSUPPORTED'), c.name)
    }
  }
})

// ══ 3. the structure-dependent cross-checks and unsupported schemas ═════════════════════════════════════════════

test('UNSUPPORTED SCHEMA RULE: schemaVersion and the digest are ALWAYS checked; every structure-dependent cross-check is skipped, and only those', () => {
  const always = ref.CROSS_CHECKS.filter(c => c.runsWhen === 'always').map(c => c.binding)
  assert.deepEqual(always, ['assessmentSchemaVersion'])
  for (const c of ref.CROSS_CHECKS.filter(x => x.runsWhen === 'always')) assert.equal(c.assessmentPath, 'schemaVersion', 'an always-run check reads only the top-level schemaVersion')
  for (const c of ref.CROSS_CHECKS.filter(x => x.runsWhen === 'schema-supported')) assert.ok(c.assessmentPath.includes('.'), `${c.binding} reads structure`)
  const named = BUNDLES.cases.filter(c => c.name.startsWith('unsupported-schema.'))
  assert.ok(named.length >= 8)
})

// ══ 4. the signer-side ADMISSION predicate (pure; nothing signs) ═════════════════════════════════════════════════

test('ADMISSION: every frozen case gives its frozen result, and the v2 depth gap (depth 64 alone, 65 embedded) is closed', () => {
  assert.ok(ADMISSION.cases.length >= 20)
  for (const c of ADMISSION.cases) assert.deepEqual(ref.admitAssessment(build(c.patch)), c.expected, c.name)
  const gap = ADMISSION.cases.find(c => c.name === 'depth-fits-alone-but-not-embedded')
  assert.deepEqual(gap.expected, { admitted: false, reason: 'assessment.not-canonicalizable:JCS_TOO_DEEP' })
  const admittedNames = ADMISSION.cases.filter(c => c.expected.admitted).map(c => c.name)
  assert.deepEqual(admittedNames, ['base'])
})

test('ADMISSION: an admitted assessment digests and can be embedded; a refused one cannot both be digested and parsed', async () => {
  for (const c of ADMISSION.cases) {
    const a = build(c.patch)
    if (c.expected.admitted) { await ref.assessmentDigest(a); continue }
    if (c.expected.reason.startsWith('assessment.not-canonicalizable')) await assert.rejects(() => ref.assessmentDigest(a), c.name)
  }
})

test('ADMISSION: a signer that follows the rule never produces a bundle the reference calls anything but SUPPORTED', () => {
  const r = ref.admitAssessment(base())
  assert.deepEqual(r, { admitted: true })
  assert.deepEqual(ref.interpretationOf(base()), { interpretation: 'SUPPORTED' })
})

// ══ 5. THE PAYLOAD FIELD CLASSIFICATION REGISTRY (a new field must be classified) ═══════════════════════════════

const leaves = (v, prefix = '') => Object.entries(v).flatMap(([k, x]) => (x && typeof x === 'object' && !Array.isArray(x) ? leaves(x, `${prefix}${k}.`) : [`${prefix}${k}`]))

test('CLASSIFICATION: the frozen classification is exactly the reference table, and every row is classified exactly one way, with a reason or a binding', () => {
  assert.deepEqual(BUNDLES.payloadFields, ref.PAYLOAD_FIELDS.map(({ path, code, required, kind, binding, reason }) => ({ path, code, required, kind, ...(binding ? { binding } : {}), ...(reason ? { reason } : {}) })))
  const paths = ref.PAYLOAD_FIELDS.map(f => f.path)
  assert.equal(new Set(paths).size, paths.length, 'each field appears once')
  for (const f of ref.PAYLOAD_FIELDS) {
    assert.ok(['cross-checked', 'independent'].includes(f.kind), `${f.path} is unclassified`)
    if (f.kind === 'independent') { assert.ok(typeof f.reason === 'string' && f.reason.length >= 40, `${f.path}: an independent field states WHY`); assert.equal(f.binding, undefined) }
    else { assert.ok(typeof f.binding === 'string' && f.binding.length > 0, `${f.path}: a cross-checked field names its check`); assert.equal(f.reason, undefined) }
    assert.equal(typeof f.valid, 'function', `${f.path} has a validator`)
    assert.match(f.code, /^payload\./)
  }
})

const NEGATIVE_UNKNOWN_FIELD_VECTORS = ['S_unknown-payload-field', 'S_upstream-extra-field', 'S_interpretation-key-extra', 'S_version-and-unknown-field']

test('CLASSIFICATION: EVERY leaf of EVERY signed vector payload is a classified row: a new payload field fails this suite until it is classified', () => {
  const rows = new Set(ref.PAYLOAD_FIELDS.map(f => f.path))
  let payloads = 0
  for (const [name, s] of Object.entries(BUNDLES.signed)) {
    payloads++
    const p = s.bundle.attestation.payload
    // Vectors that deliberately carry an unknown field (strict.unknown-payload-field) are the negative examples.
    for (const leaf of leaves(p)) {
      if (rows.has(leaf)) continue
      // The ONLY payloads allowed to carry an unclassified leaf are the four deliberate negative vectors, and each must be refused.
      assert.ok(NEGATIVE_UNKNOWN_FIELD_VECTORS.includes(name), `${name}: payload field ${leaf} is not in the classification registry`)
      const c = BUNDLES.cases.find(x => x.source.signed === name && !x.source.patch)
      assert.notEqual(c.expected.integrity, 'VALID', `${name} carries an unclassified field and must be refused`)
    }
  }
  assert.ok(payloads >= 100)
  // A clean payload has no leaf outside the registry at all.
  for (const leaf of leaves(BUNDLES.signed.B2.bundle.attestation.payload)) assert.ok(rows.has(leaf), leaf)
})

test('CLASSIFICATION: a payload with an UNCLASSIFIED extra field is refused by the verifier, not ignored', async () => {
  const b = structuredClone(BUNDLES.signed.B1.bundle); b.attestation.payload.newUnclassifiedField = 'x'
  const r = await ref.verifyProfileBundleBytes(toInputBytes(b))
  assert.equal(r.integrity, 'MALFORMED'); assert.equal(r.reasonCode, 'payload.unknown-field')
})

test('CLASSIFICATION: every cross-checked field has exactly one registered check, and every registered check has a payload row (one to one)', () => {
  const crossRows = ref.PAYLOAD_FIELDS.filter(f => f.kind === 'cross-checked')
  const bindings = new Set([...ref.CROSS_CHECKS.map(c => c.binding), ref.DIGEST_BINDING])
  for (const f of crossRows) assert.ok(bindings.has(f.binding), `${f.path} names a check (${f.binding}) that is not registered`)
  for (const c of ref.CROSS_CHECKS) {
    const rows = crossRows.filter(f => f.binding === c.binding)
    assert.equal(rows.length, 1, `check ${c.binding} must belong to exactly one payload row`)
    assert.equal(rows[0].path, c.payloadField, `${c.binding}: the check reads the row it is classified on`)
  }
  assert.equal(crossRows.filter(f => f.binding === ref.DIGEST_BINDING).length, 1)
  assert.equal(crossRows.length, ref.CROSS_CHECKS.length + 1, 'the cross-checks plus the digest binding account for every cross-checked row')
  // every assessment path a check reads exists in the schema-valid base assessment
  const at = (o, p) => p.split('.').reduce((a, k) => a?.[k], o)
  for (const c of ref.CROSS_CHECKS) assert.notEqual(at(base(), c.assessmentPath), undefined, `${c.binding}: ${c.assessmentPath}`)
})

test('CLASSIFICATION: every cross-checked row has a "signer lied" vector; every independent row has a tamper vector that the signature stops', () => {
  const lied = BUNDLES.cases.filter(c => c.name.startsWith('binding.signer-lied.'))
  for (const f of ref.PAYLOAD_FIELDS.filter(x => x.kind === 'cross-checked' && x.binding !== ref.DIGEST_BINDING)) assert.ok(lied.some(c => c.expected.binding === f.binding), `no signer-lied vector for ${f.path} (${f.binding})`)
  assert.ok(BUNDLES.cases.some(c => c.expected.binding === ref.DIGEST_BINDING && c.name.startsWith('assessment.')), 'the digest binding has assessment tamper vectors')
  const tamper = new Set(BUNDLES.cases.filter(c => c.name.startsWith('tamper.payload.')).map(c => c.name.slice('tamper.payload.'.length)))
  for (const f of ref.PAYLOAD_FIELDS.filter(x => x.kind === 'independent' && !['attestationType', 'attestationVersion'].includes(x.path) && x.path !== 'assessment.canonicalization')) {
    const key = f.path === 'workspaceId' ? 'workspace.' : f.path
    assert.ok([...tamper].some(t => t === f.path || t.startsWith(key)), `no tamper vector for independent field ${f.path}`)
  }
  for (const n of ['strict.type-unknown', 'strict.version-1.1.0', 'tamper.payload.assessment.canonicalization']) assert.ok(BUNDLES.cases.some(c => c.name === n), n)
})

test('A VERIFIER CAN NARROW WHAT IT SUPPORTS: a schema it was not told to support is UNSUPPORTED_SCHEMA, and the structure-dependent cross-checks are then skipped', async () => {
  const narrow = { supportedAssessmentSchemas: [] }
  const ok = await ref.verifyProfileBundleBytes(toInputBytes(BUNDLES.signed.B1.bundle), narrow)
  assert.equal(ok.integrity, 'VALID'); assert.equal(ok.interpretation, 'UNSUPPORTED_SCHEMA')
  assert.equal((await ref.verifyProfileBundleBytes(toInputBytes(BUNDLES.signed.B1.bundle))).interpretation, 'SUPPORTED', 'and the default verifier supports it')
  // The same bundle, signed with a lying profile id: BINDING_MISMATCH for a verifier that can read the structure, VALID (skipped) for one that cannot.
  const lied = toInputBytes(BUNDLES.signed['L_profileId'].bundle)
  assert.equal((await ref.verifyProfileBundleBytes(lied)).integrity, 'BINDING_MISMATCH')
  const skipped = await ref.verifyProfileBundleBytes(lied, narrow)
  assert.equal(skipped.integrity, 'VALID'); assert.equal(skipped.interpretation, 'UNSUPPORTED_SCHEMA')
  // ...but the top-level schemaVersion cross-check and the digest always run.
  const schemaLie = toInputBytes(BUNDLES.signed['L_assessmentSchemaVersion'].bundle)
  assert.equal((await ref.verifyProfileBundleBytes(schemaLie, narrow)).binding, 'assessmentSchemaVersion')
})
