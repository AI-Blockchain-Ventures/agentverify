import {
  PROFILE_ATTESTATION_TYPE as ATTESTATION_TYPE, PROFILE_ATTESTATION_VERSION as ATTESTATION_VERSION,
  PROFILE_BUNDLE_VERSION as BUNDLE_VERSION, PROFILE_KEY_PURPOSE, PROFILE_ATTESTATION_ALGORITHM,
  INTERPRETATION_VERSION_KEYS, admitAssessment, profileAssessmentDigest, profileSigningInput, profileKeyIdOf,
  checkP256PublicJwk, profileSignatureProblem, normalizeProfileSignatureLowS,
} from '@agentverify/scanner'

/**
 * Profile-attestation signing — the ONLY place in this codebase that touches the profile-attestation private
 * key. Mirrors the split that workers/api/src/attestationSigning.ts already established for the legacy scan
 * attestation: packages/scanner/src/profileAttestation.ts (imported above) is public-safe — payload/digest/
 * signing-input construction, admission, and every check a VERIFIER needs — and contains no key material and
 * no signing call. This file adds exactly the two things a public-safe module cannot contain: importing a
 * private key, and calling `crypto.subtle.sign`.
 *
 * This is a DIFFERENT key from the legacy ATTESTATION_SIGNING_PRIVATE_KEY_JWK (different env vars below, on
 * purpose): the profile-assessment attestation is a new, domain-separated signing type (design doc §3.2, §6)
 * with its own registered key purpose (`agentverify-profile-v1`), and reusing the legacy key would blur that
 * separation. See docs/attestation-profile-design.md §10.1 for the full normative signing-boundary contract
 * this module implements; every numbered rule below cites the requirement it satisfies.
 *
 * Key custody:
 * - LOCAL DEVELOPMENT: a throwaway key pair from
 *   `workers/api/scripts/generate-dev-profile-attestation-key.mjs`, written to the already-gitignored
 *   `workers/api/.dev.vars` as PROFILE_ATTESTATION_SIGNING_PRIVATE_KEY_JWK_B64 / PROFILE_ATTESTATION_ISSUER /
 *   PROFILE_ATTESTATION_KEY_PURPOSE. Dev-only; never production material; never committed.
 * - PRODUCTION: the private key JWK is a Cloudflare Worker secret, or (preferred, and not yet implemented —
 *   see the final report) non-exportable KMS-backed key material where only a signing capability, never the
 *   raw key, is exposed to the Worker. The module boundary here (one file, one set of env bindings) is what
 *   makes that swap possible later without touching any caller of signProfileAttestation.
 *
 * FAILURE CATEGORIES. Every refusal carries a `category`, so a caller (the Worker's HTTP route) can classify
 * the HTTP status WITHOUT pattern-matching an open-ended set of reason strings:
 *   'inadmissible'  the SPECIFIC assessment/package is not eligible for attestation (admitAssessment's own
 *                    reason). The request was received fine; this content cannot be attested. -> 422.
 *   'unavailable'   the SIGNING CAPABILITY itself is unavailable: missing/misconfigured key material, wrong
 *                    declared purpose, unconfigured issuer, an identity mismatch, or (if a KMS/signing service
 *                    is introduced later) that service being down. Nothing about this specific request caused
 *                    it; retrying the identical request once the server is reconfigured would succeed. -> 503.
 *   'internal'      an unexpected defect in THIS module: a signature it just produced failed its own
 *                    self-verification, an invariant it relies on did not hold, or a crypto/runtime call
 *                    failed in a way none of the above explains. -> 500.
 */

export interface ProfileAttestationSigningEnv {
  /** JSON-encoded EC (P-256) private key in JWK format. Absent -> signing is reported unavailable, never faked. */
  PROFILE_ATTESTATION_SIGNING_PRIVATE_KEY_JWK?: string
  /** Same key, base64-encoded (preferred — sidesteps dotenv-style quoting ambiguity; see attestationSigning.ts). */
  PROFILE_ATTESTATION_SIGNING_PRIVATE_KEY_JWK_B64?: string
  /** Server-side issuer configuration (payload.issuer / the publication endpoint's issuer). Never request input. Required: unset is treated as misconfiguration, not silently defaulted, so a deployment can never sign under an accidental placeholder issuer. */
  PROFILE_ATTESTATION_ISSUER?: string
  /**
   * The purpose this deployment DECLARES the configured key is for. A signing key is registered for exactly
   * one purpose (design doc / conformance/v4/reference/domains.mjs rule 6); this is the Worker-side analogue
   * of that key-set entry field, since no key-set publisher exists yet (see the final report). Signing refuses
   * unless this is EXACTLY `agentverify-profile-v1` — a key provisioned for anything else, or with this unset,
   * is refused rather than assumed correct.
   */
  PROFILE_ATTESTATION_KEY_PURPOSE?: string
  /**
   * Optional. The keyId (RFC 7638 thumbprint) this deployment expects to be signing with — set this once the
   * key's published identity is known. If set to a non-empty string, a computed keyId that does not match is
   * refused. Left UNSET only during first-ever provisioning, before any identity has been published anywhere.
   * Set but EMPTY is treated as misconfiguration (not "no check wanted") and refuses closed: an env loader that
   * turns "unset" into "" must not be able to silently disable this check by accident.
   */
  PROFILE_ATTESTATION_EXPECTED_KEY_ID?: string
}

export type SignFailureCategory = 'inadmissible' | 'unavailable' | 'internal'

export type SignedProfileAttestation = {
  payload: Record<string, unknown>
  signature: string
  algorithm: typeof PROFILE_ATTESTATION_ALGORITHM
  publicKey: JsonWebKey
}
export type ProfileAttestationBundle = { bundleVersion: typeof BUNDLE_VERSION; attestation: SignedProfileAttestation; assessment: unknown }

export type SignProfileAttestationResult =
  | { ok: true; attestation: SignedProfileAttestation; bundle: ProfileAttestationBundle }
  | { ok: false; reason: string; category: SignFailureCategory }

const fail = (reason: string, category: SignFailureCategory): { ok: false; reason: string; category: SignFailureCategory } => ({ ok: false, reason, category })

function resolveJwkJson(env: ProfileAttestationSigningEnv): string | null {
  if (env.PROFILE_ATTESTATION_SIGNING_PRIVATE_KEY_JWK_B64) {
    try { return atob(env.PROFILE_ATTESTATION_SIGNING_PRIVATE_KEY_JWK_B64) } catch { return null }
  }
  return env.PROFILE_ATTESTATION_SIGNING_PRIVATE_KEY_JWK ?? null
}

function derivePublicJwk(privateJwk: JsonWebKey): JsonWebKey {
  // The four public EC coordinates ARE the public key; everything else (the private scalar `d`, key_ops, ext,
  // kid, alg, use...) is dropped, not merely ignored: checkP256PublicJwk requires EXACTLY {kty, crv, x, y}.
  const { kty, crv, x, y } = privateJwk
  return { kty, crv, x, y } as JsonWebKey
}

let cachedPrivateKey: { jwkSource: string; key: CryptoKey } | null = null
async function importPrivateKey(privateKeyJwkJson: string): Promise<CryptoKey> {
  if (cachedPrivateKey && cachedPrivateKey.jwkSource === privateKeyJwkJson) return cachedPrivateKey.key
  const jwk = JSON.parse(privateKeyJwkJson) as JsonWebKey
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  cachedPrivateKey = { jwkSource: privateKeyJwkJson, key }
  return key
}

/** UTC "now" in the exact canonical timestamp form the frozen v4 reference requires (YYYY-MM-DDTHH:MM:SS.mmmZ) — what Date.prototype.toISOString() always produces for a valid Date; no separate formatter is needed to PRODUCE one (only to PARSE an untrusted one, which this module never does). */
function issuedAtNow(): string {
  return new Date().toISOString()
}

/** Logs an unexpected error's detail SERVER-SIDE ONLY. Never returned to a caller — see the module header's FAILURE CATEGORIES note. The detail here is a JS Error/message from WebCrypto or JSON parsing; it never contains request content or key material (nothing derived from `assessment` or from key bytes is interpolated into it). */
function logInternal(where: string, e: unknown): void {
  console.error(`profileAttestationSigning: ${where}:`, e instanceof Error ? e.message : e)
}

/**
 * Signs a profile assessment, or reports exactly why it could not, following the REQUIRED SIGNING FLOW:
 *
 *   1. `assessment` must be the EXACT object the caller just generated from the scanner/profile path — no
 *      rescanning, reconstruction, regeneration or mutation after this call (design doc §10.3; caller's
 *      responsibility to pass that same reference, never a copy or a re-derived object).
 *   2. Admission runs FIRST, before any env/key material is even read. An assessment this function does not
 *      admit is refused with the admission reason (category 'inadmissible') and the private key is never
 *      touched — this is deliberate ordering, not an optimization: it is what makes "admission occurs before
 *      any private-key operation" true for EVERY refusal path, not only the ones downstream of key resolution.
 *   3. Only once admitted: resolve key material, check its declared purpose, derive and validate its public
 *      half, check its keyId against the expected identity (if configured), then sign.
 *   4. The signature is normalized to low-S and self-verified (WebCrypto, over the exact bytes just signed)
 *      before this function returns it. A signature this module cannot verify against its own public key is
 *      never returned — that would be a bug in this module (category 'internal'), and fails closed rather
 *      than shipping doubt.
 *
 * Returns { ok: false, reason, category } for every refusal (never throws for an expected refusal). Stable
 * public reason codes (never a raw error message — see logInternal for where detail actually goes):
 *   'signing-not-configured'            category 'unavailable' — no private key JWK is present in env
 *   'issuer-not-configured'             category 'unavailable' — PROFILE_ATTESTATION_ISSUER is unset
 *   'key-purpose-mismatch'              category 'unavailable' — PROFILE_ATTESTATION_KEY_PURPOSE is not exactly 'agentverify-profile-v1'
 *   'key-invalid:<jwk.*>'               category 'unavailable' — the derived public key fails checkP256PublicJwk (malformed key material)
 *   'key-unavailable'                   category 'unavailable' — the private key JWK could not be imported (e.g. missing `d`, wrong curve)
 *   'key-identity-mismatch'             category 'unavailable' — PROFILE_ATTESTATION_EXPECTED_KEY_ID is set (non-empty) and does not match
 *   'key-identity-check-misconfigured'  category 'unavailable' — PROFILE_ATTESTATION_EXPECTED_KEY_ID is present but empty
 *   <admission reason>                  category 'inadmissible' — admitAssessment's own reason (e.g. an
 *                                        assessment.schema.* code, or an interpretation code such as
 *                                        PROFILE_DEFINITION_MISMATCH) when the assessment itself was never admitted
 *   'self-verification-failed'          category 'internal' — this module's own post-sign check did not accept its own signature
 *   'invariant-failed'                  category 'internal' — the normalized signature itself fails the range/low-S check (should be unreachable)
 *   'signing-failed'                    category 'internal' — an unexpected WebCrypto error during the sign call itself
 */
export async function signProfileAttestation(
  assessment: unknown,
  env: ProfileAttestationSigningEnv,
  context: { workspaceId?: string } = {},
): Promise<SignProfileAttestationResult> {
  // (2) Admission BEFORE anything else. Nothing below this line has run yet for a refused assessment.
  const admission = admitAssessment(assessment)
  if (!admission.admitted) return fail(admission.reason, 'inadmissible')
  const a = assessment as Record<string, unknown>
  const profile = a.profile as Record<string, unknown>

  // (3) Key material and its declared identity. Every failure from here is 'unavailable': none of it depends
  // on the specific assessment content, only on this deployment's signing configuration.
  const jwkJson = resolveJwkJson(env)
  if (!jwkJson) return fail('signing-not-configured', 'unavailable')
  if (!env.PROFILE_ATTESTATION_ISSUER) return fail('issuer-not-configured', 'unavailable')
  if (env.PROFILE_ATTESTATION_KEY_PURPOSE !== PROFILE_KEY_PURPOSE) return fail('key-purpose-mismatch', 'unavailable')

  let privateJwk: JsonWebKey
  try { privateJwk = JSON.parse(jwkJson) as JsonWebKey } catch { return fail('key-invalid:jwk.not-json', 'unavailable') }
  const publicJwk = derivePublicJwk(privateJwk)
  const jwkCheck = checkP256PublicJwk(publicJwk)
  if (!jwkCheck.ok) return fail(`key-invalid:${jwkCheck.reasonCode}`, 'unavailable')

  const keyId = await profileKeyIdOf(publicJwk)
  if (env.PROFILE_ATTESTATION_EXPECTED_KEY_ID !== undefined) {
    if (env.PROFILE_ATTESTATION_EXPECTED_KEY_ID === '') return fail('key-identity-check-misconfigured', 'unavailable')
    if (env.PROFILE_ATTESTATION_EXPECTED_KEY_ID !== keyId) return fail('key-identity-mismatch', 'unavailable')
  }

  let privateKey: CryptoKey
  try {
    privateKey = await importPrivateKey(jwkJson)
  } catch (e) {
    // The public coordinates already passed checkP256PublicJwk above; a failure here means the PRIVATE half is
    // bad (missing/malformed `d`, a curve mismatch WebCrypto itself rejects, etc.) — key material, not a defect
    // in this module's own logic, so 'unavailable' (503), not 'internal' (500).
    logInternal('importPrivateKey', e)
    return fail('key-unavailable', 'unavailable')
  }

  // The payload's cross-checked fields are read directly from the ADMITTED assessment (never re-derived, never
  // looked up separately in the registry): admission already proved these equal the pinned registry definition,
  // so copying them here is both correct and exactly what design doc §10.3 requires ("no reconstruction").
  const payload: Record<string, unknown> = {
    attestationType: ATTESTATION_TYPE,
    attestationVersion: ATTESTATION_VERSION,
    profile: profile.profileId,
    profileVersion: profile.agentverifyProfileVersion,
    framework: profile.framework,
    issuer: env.PROFILE_ATTESTATION_ISSUER,
    upstream: { repo: profile.upstreamRepo, commit: profile.upstreamCommit, license: profile.upstreamLicense },
    // Copied, not aliased: implementedControls is the one array-valued field read into the payload, and this
    // module must never hold a live reference into the caller's assessment object past this point — an in-place
    // mutation of the original array after this line (however unlikely in this codebase today) must not be able
    // to silently change a payload this function already returned to a caller.
    implementedControls: [...(profile.implementedControls as string[])],
    assessmentSchemaVersion: a.schemaVersion,
    interpretationVersions: Object.fromEntries(INTERPRETATION_VERSION_KEYS.map(k => [k, profile[k]])),
    package: { digest: (a.package as Record<string, unknown>).digest, fileCount: (a.package as Record<string, unknown>).fileCount },
    assessment: { digest: await profileAssessmentDigest(assessment), canonicalization: 'RFC8785' },
    keyId,
    issuedAt: issuedAtNow(),
    ...(context.workspaceId !== undefined ? { workspaceId: context.workspaceId } : {}),
  }

  let signatureBuf: ArrayBuffer
  try {
    signatureBuf = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, profileSigningInput(payload) as BufferSource)
  } catch (e) {
    // An imported, already-validated key failing at the sign call itself is not explained by any known
    // configuration problem: genuinely unexpected, category 'internal'.
    logInternal('subtle.sign', e)
    return fail('signing-failed', 'internal')
  }

  const normalized = normalizeProfileSignatureLowS(new Uint8Array(signatureBuf))
  const formProblem = profileSignatureProblem(normalized)
  if (formProblem) {
    // Unreachable in practice (normalizeProfileSignatureLowS always produces a value passing this check) —
    // fails closed as an internal invariant violation rather than ever trusting an un-checked signature.
    logInternal('invariant', new Error(`normalized signature failed profileSignatureProblem: ${formProblem}`))
    return fail('invariant-failed', 'internal')
  }

  // (4) Self-verify with the SAME public key and the SAME signing-input construction just used, before
  // returning anything. This is a cheap correctness check on this module, not the normative verifier — the
  // full cross-check against the frozen v4 reference lives in this package's own test suite.
  let verified: boolean
  try {
    const verifyKey = await crypto.subtle.importKey('jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    verified = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, normalized as BufferSource, profileSigningInput(payload) as BufferSource)
  } catch (e) {
    logInternal('self-verify', e)
    verified = false
  }
  if (!verified) return fail('self-verification-failed', 'internal')

  const attestation: SignedProfileAttestation = { payload, signature: base64Encode(normalized), algorithm: PROFILE_ATTESTATION_ALGORITHM, publicKey: publicJwk }
  // The frozen v4 bundle shape, exactly three keys, no more: { bundleVersion, attestation, assessment }.
  // bundleVersion is unsigned framing (design doc / conformance/v4), not part of any digest or signing input.
  return { ok: true, attestation, bundle: { bundleVersion: BUNDLE_VERSION, attestation, assessment } }
}

/**
 * Exposes just the public verification key + issuer/algorithm/purpose — safe to serve publicly, no secret
 * material. This IS the minimum trusted publication format (design doc / review requirement): { issuer, keyId,
 * publicKey: {kty,crv,x,y}, algorithm, purpose }. `keyId` is always derived from the actual public key
 * (profileKeyIdOf), never a separately configured or claimed value — so what this function publishes can never
 * diverge from what signProfileAttestation actually signs with. Requires the same PROFILE_ATTESTATION_ISSUER
 * configuration signing itself requires (never a silent placeholder default), and requires the key to pass the
 * same public-JWK validity check signing uses — returns null (never a partial/inconsistent shape) if either is
 * missing or the key material is malformed. Wired to GET /v1/profile-attestation/public-key in worker.ts.
 *
 * INTERIM SCOPE (do not read more into this than it states): this is a SINGLE trusted key publication. It
 * establishes issuer/key provenance and lets a third party verify a bundle's embedded publicKey against an
 * independently-obtained source instead of trusting the bundle alone. It does NOT provide key-state history,
 * retirement/revocation semantics, a monotonic sequence, or rollback detection — none of those fields
 * (`sequence`, `keySetVersion`, `generatedAt`, `status`) appear here, and none should be added to this function
 * until the real key-set publisher (design doc §10.2) exists. Faking any of them would be worse than omitting
 * them: a consumer could mistake an absent guarantee for a present one.
 */
export async function getProfileAttestationPublicKeyInfo(
  env: ProfileAttestationSigningEnv,
): Promise<{ issuer: string; keyId: string; publicKey: JsonWebKey; algorithm: typeof PROFILE_ATTESTATION_ALGORITHM; purpose: string } | null> {
  if (!env.PROFILE_ATTESTATION_ISSUER) return null
  const jwkJson = resolveJwkJson(env)
  if (!jwkJson) return null
  try {
    const publicJwk = derivePublicJwk(JSON.parse(jwkJson) as JsonWebKey)
    if (!checkP256PublicJwk(publicJwk).ok) return null
    return {
      issuer: env.PROFILE_ATTESTATION_ISSUER,
      keyId: await profileKeyIdOf(publicJwk),
      publicKey: publicJwk,
      algorithm: PROFILE_ATTESTATION_ALGORITHM,
      purpose: PROFILE_KEY_PURPOSE,
    }
  } catch {
    return null
  }
}

function base64Encode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
