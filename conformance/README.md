# Conformance vectors: profile-assessment attestation (VECTOR SET v2)

Status: **FROZEN for the second independent review. No signing implementation exists.** These vectors are the specification of
[docs/attestation-profile-design.md](../docs/attestation-profile-design.md) made executable. They were written before any
signing code so that the implementation is checked against something it did not write.

This is **vector set v2**. It replaces v1 entirely (it was not patched): v1 signatures were not low-S, so a rule that changes what a
valid signature is could not be applied to them. See "What changed from v1" at the end. Everything here is **frozen once reviewed**;
see "Changing vectors" below.

## What is here

```
conformance/
  README.md
  reference/            REFERENCE, TEST-ONLY code. Verification only: no signing, no private key handling.
    numberProfile.mjs      THE signed-content numeric profile: one rule: numberTokenProblem (text) and numberProblem (values)
    strictJson.mjs         strict JSON parser (duplicate keys, lone surrogates, BOM, depth > 64, numeric modes)
    jcs.mjs                strict RFC 8785 serializer (generic) + canonicalizeSigned (serializer PLUS the numeric profile)
    domains.mjs            THE domain registry: attestation type, signing tag, key purpose, digest tags
    profileAttestation.mjs digests, signing input, keyId, package identity, key state, policy, cross-check registry, bundle verifier
  vectors/              the frozen data (JSON), plus manifest.v2.json with the SHA-256 of every file
    jcs.v2.json                  serializer cases, RFC 8785 number table, the NUMERIC PROFILE, Unicode, rejections
    avpkg.v2.json                package identity (avpkg-sha256): inputs, exact preimage bytes, digests
    assessment-digest.v2.json    avassess-sha256 digests
    keyid.v2.json                RFC 7638 thumbprints, canonical-coordinate rules, public-key shape checks
    signing.v2.json              exact signing inputs, low-S signatures and key ids for the signed bundles
    domains.v2.json              the domain registry, frozen
    bundles.v2.json              signed bundles + 275 verification cases (tamper, key state, policy, strictness, numbers, size)
    legacy-attestation.v2.json   frozen EXISTING scan attestations, low-S AND high-S, verified by three implementations
  test/                 the tests that run the vectors (node:test, no dependencies)
  tools/generate-vectors.mjs   ONE-SHOT generator. Read the warning in it before running.
  tools/mutation-check.mjs     mutation testing of the reference on a scratch copy (slow; not part of the gate)
```

The reference implementation is **not the product implementation.** It is a second, small, independently readable statement of the
rules. The future product implementation must produce identical results for every vector; where the two disagree, one of them is
wrong and the vector decides which. Do not import anything under `conformance/` from product code.

## Running

```bash
npm run test:conformance
```

This runs in public CI against the generated scanner stub as well as locally against the real scanner. Two more checks run
elsewhere: the web port of the scan verifier (`apps/web/test/conformanceLegacy.test.mjs`) and the private scanner's own checks
(`packages/scanner/test/conformanceAvpkg.test.mjs`: package digests, the profile id, and that REAL assessments pass the numeric profile).

## Decisions this vector set pins

1. **The assessment carries its profile id.** `assessment.profile.profileId` (schema `1.1.0`, amended before release). The payload's
   `profile` is cross-checked against it, so it is never a bare claim. The verifier has a **closed** profile registry
   (`SUPPORTED_PROFILES`, looked up by own key): an unknown profile id, framework or profile version gives
   `integrity: VALID` with `interpretation: UNSUPPORTED_PROFILE` or `UNSUPPORTED_PROFILE_VERSION`. Unsupported interpretation is
   never turned into `INVALID_SIGNATURE`, and nothing unsupported can satisfy a policy.
2. **Low-S is an Agent Verify canonical-signature rule. It is NOT an RFC 7518 (JWA) or RFC 7515 requirement**; ES256 as specified there
   accepts both `(r, s)` and `(r, n - s)`. For the **profile type only**: `1 <= r < n` and `1 <= s <= floor(n/2)` are checked
   BEFORE any cryptography; a high-S signature is `MALFORMED` with reason `signature.high-s`, an out-of-range value `signature.range`.
   Legacy verification is unchanged and both forms are pinned as `VALID`. Low-S removes the third-party twin of a given signature;
   it does not make signatures unique (ECDSA is randomized), and nothing may treat a signature as an identity. The signer (later)
   must normalize `s -> n - s` where required and self-verify.
3. **Key STATES, never "trusted".** `KEY_ACTIVE`, `KEY_RETIRED`, `KEY_REVOKED` (what the supplied key set records), plus
   `KEY_UNKNOWN`, `KEY_PURPOSE_MISMATCH`, `KEY_SET_INVALID`, `KEY_SET_ROLLBACK_DETECTED`, `NOT_EVALUATED`. Acceptance is verifier
   policy: `acceptedKeyStates`, default `KEY_ACTIVE` only; historical or offline verification opts into `KEY_RETIRED` explicitly.
   `KEY_REVOKED` is never accepted, and a policy that lists it (or any non-acceptable state) is `INVALID_POLICY`.
4. **`issuedAt` is a signer claim and never trusted time.** It is never compared with `retiredAt`, `revokedAt` or `notBefore`. The
   same bundle against a key retired before `issuedAt` and a key retired after it gives the same result. No anomaly flag, no
   time-derived output, no claim about when a signature was made. Only trusted timestamping or a transparency log could ever justify one.
5. **Rollback state is ISSUER-SCOPED. Key-set metadata is rollback DETECTION support, not rollback PROTECTION and not freshness.**
   The key set has `keySetVersion`, a monotonic `sequence` and `generatedAt` (all required, strict schema). A verifier that RETAINS the
   highest sequence it accepted for that issuer supplies it as `retainedSequenceByIssuer` (an object keyed by issuer, a Map, or a lookup
   function). The verifier looks it up with **the issuer named in the bundle's own payload**; there is no bare-number option (it is removed
   and refused). State for any other issuer is never consulted, and a key set that is not the payload issuer's is `KEY_UNKNOWN` without any
   lookup. The result's `keySetSequenceCheck` says which case applied: `NO_RETAINED_STATE` (the sequence could not be checked; a verifier
   with no state learns nothing from the number), `NOT_BEHIND_RETAINED` (not older than something this verifier already saw for this issuer, which
   is NOT "current" and NOT "fresh"), or `BEHIND_RETAINED` (`KEY_SET_ROLLBACK_DETECTED`). The key set is unsigned, so anyone who can present one
   can present any sequence; real protection needs retained verifier state plus an authenticated key set or freshness statement (future).
   `generatedAt` is informational: validated for form, never evaluated.
6. **The signed-content numeric profile (Agent Verify, NOT RFC 8785) is about the mathematical VALUE, not the spelling.** A signed number is
   an integer with `|n| <= 2^53 - 1` that is not negative zero. `98`, `98.0`, `9.8e1` and `0.98e2` denote the same exact safe integer and are
   all admitted (JCS then canonicalizes it as `98`). `9007199254740993.0`, `9007199254740992.5`, `1e-400`, `0.1`, `98e-1` and `-0.0` are refused.
   A numeric token is evaluated **exactly**, with arbitrary-precision integer arithmetic, and is never converted through a double before it is
   judged, so no spelling can round into a different admitted integer and nothing underflows to zero. The generic RFC 8785 serializer keeps the
   full double domain so its own table (Appendix B) can be tested; that is separate from this stricter admission rule. The parser
   (`numberTokenProblem`), the canonicalizer admission check and the future signer pre-check (`numberProblem`) implement one rule and are tested
   against each other and against an independent string-arithmetic oracle. The scanner's only former decimal (`printableRatio`) is now `printablePercent`.
7. **Canonical JWK coordinates.** `x` and `y` must be canonical unpadded base64url of exactly 32 bytes (decode, require 32 bytes,
   re-encode, require equality) before the RFC 7638 thumbprint over `crv`, `kty`, `x`, `y`. One public key has one `keyId`.
8. **`bundleVersion: "1.0.0"`** on the outer bundle, independent of `attestationVersion`, unsigned framing in v1. Missing is
   `MALFORMED`; unknown is `UNSUPPORTED_BUNDLE_VERSION`, decided before anything else in the bundle is read.
9. **One domain registry** (`reference/domains.mjs`, frozen in `domains.v2.json`): attestation type, signing tag, key purpose and digest
   tags, one-to-one, distinct and prefix-free, none beginning with `{`. The verifier chooses the tag from the type it accepts. The
   version inside a tag changes only when the construction of the signing input changes.
10. **Unicode is never normalized** by JCS, by the digests or by the package identity. NFC and NFD spellings are different keys, strings and paths.
11. **A size ceiling** on bundle text (16 MiB of UTF-8, inclusive), applied before parsing.
12. **The semantic cross-checks are a registry** (`CROSS_CHECKS`), exported by the reference and iterated by the verifier. The tests
    require one "the signer lied" vector per entry and none for anything not listed. A correct signature never overrides a failed entry.
13. **No key set means fail closed, and the three layers stay separate.** A bundle can have mathematically valid **integrity** while its **key state**
    is `NOT_EVALUATED` (no key set supplied) and **no policy is satisfied** (`NOT_EVALUATED` is not an acceptable key state). "No key set available" is never
    turned into a trust conclusion.

## The Worker is not the signing boundary

The Worker may keep returning an **unsigned** assessment that contains values outside the signed-content numeric profile (its response path
is a transparent pass-through, and its test still passes `1e21` and `-0` through unchanged). That is deliberate. The requirement lands on the
signer: **when `attest: true` is implemented, the signed-content admission check must run on the assessment AFTER it is generated and BEFORE any
signing operation, and an assessment that is not admitted must never be signed** (the request then fails; it is not silently returned unsigned).
This is documented here and in the design doc, and is to be tested when signing exists. No signing code exists now.

## Result model

`{ integrity, keyState, interpretation, policy? }`, never a single boolean.

| integrity | meaning |
|---|---|
| `VALID` | Well-formed, key id matches the embedded key, signature form and signature verify over the tagged input, assessment digest matches, every duplicated field agrees with the assessment. |
| `MALFORMED` | Not parseable, or not exactly the defined shape or form. Includes duplicate keys, unknown fields, non-canonical spellings and high-S. |
| `UNSUPPORTED_BUNDLE_VERSION` / `UNSUPPORTED_TYPE` / `UNSUPPORTED_VERSION` / `UNSUPPORTED_ALGORITHM` | Well-formed but not something this verifier will interpret. Nothing else is examined. |
| `INVALID_SIGNATURE` | The key id does not match the embedded key, or the signature does not verify. |
| `BINDING_MISMATCH` | Signed correctly, but the assessment digest, or a field duplicated from the assessment, disagrees. |

`keySetSequenceCheck` (only when a key set was evaluated for the payload issuer): `NO_RETAINED_STATE`, `NOT_BEHIND_RETAINED`, `BEHIND_RETAINED`.
`interpretation`: `SUPPORTED`, `UNSUPPORTED_SCHEMA`, `UNSUPPORTED_PROFILE`, `UNSUPPORTED_PROFILE_VERSION` (precedence in that order).
`policy`: `SATISFIED`, `NOT_SATISFIED`, `INVALID_POLICY`.

## What these vectors do NOT prove

- They do not prove any observation inside an assessment is correct. The assessments inside the bundles are **synthetic**; they exercise the
  attestation layer, not the scanner.
- They do not test signing. There is no signing implementation. The signatures were made once by the generator with throwaway keys held in memory.
- The legacy vectors freeze today's observed behaviour. They prove it does not change from here; they cannot prove what older builds did.
- Time and freshness: see decisions 4 and 5.

## Keys

Every key is a **throwaway** generated in memory by the generator and discarded. The vectors contain only public keys and signatures.
There is no private key anywhere in this directory, and a test enforces it. The issuer is `agentverify-conformance`; no real Agent Verify
issuer or key appears. A key in these files must never be trusted for anything.

## Changing vectors

The vectors are **frozen**. `manifest.v2.json` holds the SHA-256 of every file and a test fails if any file changes.

- Fixing a wrong expectation, or adding cases: edit or add, update the manifest, and say why in the change.
- The generator cannot reproduce the same signatures (its keys are discarded), so re-running it produces an entirely new vector set. It
  therefore refuses to run without `--new-vector-set` and refuses to overwrite without `--overwrite`. Doing so is a **new version of the
  vector set**, to be reviewed as such.
- If a rule changes (a tag, a field, a status), that is a version change of the attestation type first, and a vector change second.

## What changed from v1

- **Assessment:** `profile.profileId` added; `printableRatio` (decimal) became `printablePercent` (integer); engine version `1.0.1`.
- **Bundle:** `bundleVersion` added; `UNSUPPORTED_BUNDLE_VERSION` added.
- **Signatures:** every profile signature is low-S; `signature.high-s` and `signature.range` added, with boundary vectors; deliberate legacy low-S and high-S vectors added.
- **Numbers:** signed content admits exact safe integers only (any spelling of them), by one rule shared by the parser, the canonicalizer and the (future) signer. Generic RFC 8785 cases are labelled generic.
- **Keys:** `keyTrust`/`TRUSTED`/`TRUSTED_RETIRED` became `keyState`/`KEY_ACTIVE`/`KEY_RETIRED`; `acceptedKeyStates` policy; canonical JWK coordinates; key set gained `keySetVersion`, `sequence`, `generatedAt`.
- **Interpretation:** closed profile registry; `UNSUPPORTED_PROFILE` and `UNSUPPORTED_PROFILE_VERSION`; unsupported interpretation cannot satisfy a policy.
- **Domains:** one registry, one new vector file (`domains.v2.json`).
- **Tests:** the cross-check registry is exported and checked one-to-one; a format-preserving mutation matrix; NFC/NFD vectors; size-ceiling vectors; both retired-key date orders.

### Pre-freeze cleanup (after the first v2 generation, before the v2 freeze)

Vector set v2 had not completed independent review, so these changes were made to v2 in place (no v3) and v2 was regenerated ONCE more
(a new set of throwaway keys and signatures):
- Rollback state became issuer-scoped (`retainedSequenceByIssuer`); the bare-number option was removed; 13 rollback vectors added, the old 4 replaced; `keySetSequenceCheck` added to results.
- The numeric profile relaxed spelling but not value safety (decision 6); about 15 spelling and rejection vectors changed accordingly, plus new codes `JSON_NUMBER_NOT_INTEGRAL` and `JSON_NUMBER_UNDERFLOW` (replacing `..._NOT_INTEGER_LITERAL`).
- **Two coverage vectors were added that v2's first generation lacked:** `keySet.entry.purpose` (`key-state.key-set-invalid.entry-purpose-empty`) and
  `keySet.entry.notBefore` (`key-state.key-set-invalid.entry-notBefore-not-canonical`). A test now requires at least one vector for every reason the key-set validator can return.
- Mutation testing then exposed a spelling-dependent guard and a super-linear cost in the numeric evaluator (see "Mutation testing"); the fix needed new numeric vectors, so v2 was regenerated ONCE more, after which it is frozen.
- `manifest.v2.json` was regenerated with the new hashes.

## Mutation testing

`node conformance/tools/mutation-check.mjs` mutates the reference (on a scratch copy; the repository is never modified) in about 85 targeted ways
(dropped tags, removed cross-checks, off-by-one low-S boundaries, retired treated as active, issuer-unscoped rollback, spelling-based number rules, ...)
and requires the conformance tests to fail for each. It is slow, so it is not part of the gate. **A survivor is not automatically a reference
defect.** Equivalent mutants (a mutation that cannot change observable behaviour) and weak mutation operators also survive. But every survivor
must still be investigated and explained: either the mutant is genuinely equivalent (say why), or a test was too weak and is strengthened.
Survivors found so far, all explained: (1) two weak tests in the first v2 run (a length guard exercised only with all-zero input, and an inherited-registry case that a
second check happened to mask); both tests were strengthened and now kill their mutants. (2) A survivor in the pre-freeze run was a **real defect**, not a weak test: the numeric evaluator refused any
token whose exponent was written with more than 1000 in magnitude, so `0.` followed by 1000 zeros and `1e1001` (the exact integer 1) was refused purely because of how it
was spelled, and a 16 MiB digit string cost tens of seconds of big-number parsing. Both were fixed (exact BigInt exponents with a provably dominant-length bound, and
digit-string normalization so nothing long is ever parsed as a big number), with vectors and tests for zero-padded and long-exponent spellings and for linear time.
(3) The remaining equivalent mutants are listed, with their reasons, in the tool itself.

## Questions for the reviewer (second pass)

Decided before this freeze (recorded so the reviewer does not re-litigate them): no key set fails closed; the Worker keeps its pass-through; numeric spelling is
relaxed but value safety is not; rollback state is issuer-scoped. Still open:

1. **Signature form is `MALFORMED`, not `INVALID_SIGNATURE`.** A high-S signature is a mathematically valid signature refused on form.
2. **`profile` (id) format** is lowercase words joined by hyphens; the registry lists profile versions as exact strings, not ranges.
3. **Size ceiling** is 16 MiB; the reference applies it to text only (an object must be bounded by the caller before parsing).
4. **`KEY_PURPOSE_MISMATCH` is checked before `KEY_REVOKED`/`KEY_RETIRED`.** Both are refused by every policy; only the label differs.
5. **`minProfileVersion` policy is not covered** (it needs prerelease-aware comparison). Unknown type, version, profile and profile version fail closed instead.
6. **The reference takes retained state as caller-supplied data.** How a real verifier persists it (and what happens on first use, or after state loss, which is
   indistinguishable from no state) is out of scope here; the result makes that condition explicit (`NO_RETAINED_STATE`) rather than hiding it.
7. **A key set that is not the payload issuer's returns `KEY_UNKNOWN` and reports no sequence check**, rather than a rollback verdict on an unrelated issuer.
8. **The exact numeric evaluator uses BigInt in the reference.** A product implementation in another language must reproduce the same accept/reject
   decisions for the vector tokens (including 500-digit literals and 1e99999999999); the independent string-arithmetic oracle in the tests is offered as a second method.
