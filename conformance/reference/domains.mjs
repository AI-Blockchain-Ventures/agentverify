// REFERENCE / TEST-ONLY. Not the product implementation. See conformance/README.md.
//
// THE DOMAIN REGISTRY: the one authoritative place that ties together, for every signed thing,
//   its attestation type, its signing-domain tag, its key purpose, and the tags of the digests it uses.
// Nothing else in the reference spells a tag, a type or a purpose. domains.v2.json freezes this table and a test proves it is
// one-to-one and prefix-free.
//
// RULES (these are what the tests enforce)
//   1. Attestation type, signing tag and key purpose are each UNIQUE across the registry: no two types share any of them.
//   2. Every signing tag and every digest tag has the form  agentverify-<scope>/vN<LF>  and none is a prefix of another, so
//      no tag-prefixed input can ever equal, or extend into, another tag-prefixed input.
//   3. No tag begins with "{" . A legacy scan attestation signs bare JSON (which begins with "{"), so a tagged input can never
//      equal a legacy input, and a legacy signature can never verify as a tagged one, or the reverse.
//   4. The VERIFIER chooses the tag from the type it has decided to accept. The tag is never read from the payload.
//   5. The version inside a tag (the "vN") changes ONLY when the construction of the signing input (or digest preimage)
//      changes. It is independent of attestationVersion, which changes when the payload's fields or meaning change, and of
//      bundleVersion, which changes when the outer container changes. None of the three implies another.
//   6. A signing key is registered for exactly one purpose, and a purpose is checked against the KEY SET, never read from the
//      attestation. A key with another purpose is KEY_PURPOSE_MISMATCH even when the signature is otherwise valid.

export const SIGNING_DOMAINS = Object.freeze({
  'agentverify.profile-assessment': Object.freeze({
    name: 'profile-assessment',
    signingTag: 'agentverify-attestation/profile-assessment/v1\n',
    keyPurpose: 'agentverify-profile-v1',
    attestationVersions: Object.freeze(['1.0.0']),
  }),
})

export const DIGEST_DOMAINS = Object.freeze({
  assessment: Object.freeze({ scheme: 'avassess-sha256', tag: 'agentverify-assessment-digest/v1\n' }),
  package: Object.freeze({ scheme: 'avpkg-sha256', tag: 'agentverify-skill-package-digest/v1\n' }),
})

/**
 * The existing scan attestation is NOT in SIGNING_DOMAINS and never will be: it has no attestationType, no tag (it signs bare
 * canonical JSON) and no registered key purpose. It is listed here only so the registry states that fact explicitly.
 */
export const LEGACY_SCAN_ATTESTATION = Object.freeze({ attestationType: null, signingTag: null, keyPurpose: null })

export const ATTESTATION_TYPE = 'agentverify.profile-assessment'
export const PROFILE_DOMAIN = SIGNING_DOMAINS[ATTESTATION_TYPE]
export const PAYLOAD_TAG = PROFILE_DOMAIN.signingTag
export const PROFILE_KEY_PURPOSE = PROFILE_DOMAIN.keyPurpose
export const ASSESSMENT_TAG = DIGEST_DOMAINS.assessment.tag
export const PACKAGE_TAG = DIGEST_DOMAINS.package.tag

/** Every tag, in a stable order, for the prefix-freeness check. */
export const ALL_TAGS = Object.freeze([
  ...Object.values(SIGNING_DOMAINS).map(d => d.signingTag),
  ...Object.values(DIGEST_DOMAINS).map(d => d.tag),
])

export const TAG_FORM = /^agentverify-[a-z0-9-]+(\/[a-z0-9-]+)*\/v[0-9]+\n$/
