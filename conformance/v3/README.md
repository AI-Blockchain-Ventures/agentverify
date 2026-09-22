# Conformance vectors: profile-assessment attestation (VECTOR SET v3)

Status: **CANDIDATE for the third independent review. No signing implementation exists, and none may be started until v3 is reviewed.**
These vectors are the specification of [docs/attestation-profile-design.md](../../docs/attestation-profile-design.md) made executable.

This is **vector set v3, a NEW set**. **Vector set v2 is frozen and untouched** (`conformance/vectors/`, `conformance/reference/`,
`conformance/test/`, `conformance/tools/`, `conformance/README.md`): its manifest hash remains the reviewed historical artifact of the second
review, and `npm run test:conformance` still runs it. v3 was created because the second independent review found signer-blocking defects that
change what a verifier must do; a frozen set is replaced by a new one, never patched. Everything here is **frozen once reviewed**; see "Changing vectors".

## What is here

```
conformance/v3/
  README.md
  reference/            REFERENCE, TEST-ONLY code. Verification only: no signing, no private key handling.
    limits.mjs             THE shared limits: the ABSOLUTE depth model (64) and the byte ceiling (16 MiB)
    numberProfile.mjs      THE signed-content numeric profile: ONE linear pass, exact value, no regex, bounded BigInt
    strictJson.mjs         strict JSON parser (duplicate keys, lone surrogates, BOM, absolute depth) and the strict UTF-8 BYTES decoder
    jcs.mjs                strict RFC 8785 serializer (generic) + canonicalizeSigned (serializer PLUS numeric profile, given a base depth)
    timestamp.mjs          THE one strict canonical timestamp parser (arithmetic; no Date)
    plain.mjs              strict-shape helpers (own properties only)
    assessmentSchema.mjs   THE exact assessment schema, 1.1.0: what SUPPORTED requires structurally
    profileRegistry.mjs    THE closed profile registry: pins framework, upstream repo/commit/licence/status, controls, schema
    policy.mjs             strict, fail-closed verifier policy
    domains.mjs            THE domain registry: attestation type, signing tag, key purpose, digest tags
    profileAttestation.mjs bytes entry point, payload field classification, cross-check registry, key state, admission predicate
  vectors/              the frozen data (JSON), plus manifest.v3.json with the SHA-256 of every file
    jcs.v3.json                  serializer cases, RFC 8785 number table, the NUMERIC PROFILE, ADVERSARIAL zero-run number vectors, depth model
    timestamps.v3.json           the strict timestamp parser, directly (valid, impossible dates, non-canonical spellings)
    assessment-schema.v3.json    the exact assessment schema: a valid base and ~80 single-fault cases, one problem code each
    profile-registry.v3.json     the closed registry, lookups, and one case per pinned value
    admission.v3.json            the signer-side ADMISSION predicate (pure; nothing signs)
    avpkg.v3.json / assessment-digest.v3.json / keyid.v3.json / signing.v3.json / domains.v3.json
    bundles.v3.json              signed bundles + the verification cases (tamper, key state, policy, bytes, depth, schema, registry, ...)
    legacy-attestation.v3.json   frozen EXISTING scan attestations, low-S AND high-S, verified by three implementations
  test/                 the tests that run the vectors (node:test, no dependencies)
  tools/generate-vectors.mjs   ONE-SHOT generator. Read the warning in it before running.
  tools/mutation-check.mjs     mutation testing of the reference on a scratch copy (slow; not part of the gate)
```

The reference implementation is **not the product implementation.** It is a second, small, independently readable statement of the
rules. The future product implementation must produce identical results for every vector; where the two disagree, one of them is
wrong and the vector decides which. Do not import anything under `conformance/` from product code.

## Running

```bash
npm run test:conformance:v3
```

This runs in public CI against the generated scanner stub as well as locally against the real scanner. Two more checks run
elsewhere: the web port of the scan verifier (`apps/web/test/conformanceLegacy.test.mjs`, which now also runs the v3 legacy vectors) and the private
scanner's own check (`packages/scanner/test/conformanceAvpkg.test.mjs`, which validates REAL assessments against the v3 assessment schema and the numeric profile).

## Loading the vector files

- **The vector files are not themselves bound by the 64-level verifier limit.** `bundles.v3.json` holds a signed bundle whose assessment is nested to
  exactly absolute depth 64 *inside the bundle*, which sits several levels inside the file. A loader must not apply the verifier's depth rule to the vector file.
- A verifier is given **bytes**. A case's `source` is `{ signed, patch? }` (an object: any serialization of it), `{ text }` (the exact UTF-8 text) or
  `{ bytesHex }` (the exact bytes). Only the last two are byte-exact.
- Values JSON text cannot carry safely are written `{ "$ieeeHex": "<16 hex digits>" }` (an exact IEEE-754 double: a fraction, `-0`, `2^53`, `NaN`) and
  `{ "$nested": k }` (k nested arrays around a string). The adversarial number tokens are rebuilt from a `kind` and a size `N`
  by `adversarialToken` in `test/helpers.mjs`.
- Policies whose defect is not expressible in JSON (an inherited property, a class instance, a symbol key) are named by `policyBuilder`.

## Decisions this vector set pins

Items 1 to 13 below are inherited from v2 unless marked **(v3)**.

1. **The assessment carries its profile id**, cross-checked against the payload. **(v3) The profile registry is authoritative**: for each `profileId` + `profileVersion` it
   PINS the framework, the upstream repository, the pinned upstream commit, the upstream licence and status, the control universe, the implemented control set and the
   expected assessment schema version. Any pinned value that differs is `PROFILE_DEFINITION_MISMATCH` (interpretation; integrity stays `VALID`; never `SUPPORTED`; cannot satisfy a policy). The five interpretation
   versions are deliberately NOT pinned: each is bound independently in the payload and the assessment.
2. **Low-S is an Agent Verify canonical-signature rule. It is NOT an RFC 7518 (JWA) or RFC 7515 requirement.** For the profile type only; legacy verification is unchanged and both forms are pinned `VALID`.
3. **Key STATES, never "trusted".** `KEY_ACTIVE`, `KEY_RETIRED`, `KEY_REVOKED`, `KEY_UNKNOWN`, `KEY_PURPOSE_MISMATCH` (purpose compared exactly, case-sensitively), `KEY_SET_INVALID`, `KEY_SET_ROLLBACK_DETECTED`, `NOT_EVALUATED`.
   Acceptance is verifier policy (default `KEY_ACTIVE` only; `KEY_REVOKED` never).
4. **`issuedAt` is a signer claim and never trusted time.** `notBefore`, `retiredAt` and `revokedAt` are **METADATA in v1**: validated for form, never compared with `issuedAt` or any clock, never used by a result or policy. They may be used by a verifier policy only after it has obtained a
   TRUSTED time from a source this design does not have.
5. **Rollback state is ISSUER-SCOPED. Key-set metadata is rollback DETECTION support, not rollback PROTECTION and not freshness.** A verifier that RETAINS the
   highest sequence it accepted for that issuer supplies it as `retainedSequenceByIssuer`; the verifier looks it up with the issuer named in the bundle's own payload. `NO_RETAINED_STATE` (the number teaches nothing),
   `NOT_BEHIND_RETAINED` (not older than something already seen: NOT "current" and NOT "fresh"), `BEHIND_RETAINED`. **(v3) What the CALLER must do**, because the reference persists nothing:
   update retained state ONLY from an AUTHENTICATED, TRUSTED key-set distribution channel; NEVER from a key set presented inside or alongside a bundle; NEVER turn an unsigned presented key set into persistent trusted state; scope retained state by
   TRUSTED SOURCE and issuer when more than one authenticated source may claim the same issuer; loss of state is `NO_RETAINED_STATE`.
6. **The signed-content numeric profile (NOT RFC 8785): the mathematical VALUE decides.** An integer, `|n| <= 2^53 - 1`, not negative zero; `98`, `98.0`, `9.8e1` are one number. **(v3) It is a LINEAR, one-pass classifier for every shape**:
   it records only indexes and counts (sign, digit positions, first and last nonzero digit, exponent as a number or "huge"), decides from those, and builds a BigInt only after reduction to a bounded candidate (at most 16 significant digits).
   No regular expression, no `replace`, no `Number(token)`. A nonzero value below 1 is simply `NON_INTEGER` (the separate underflow status is gone). The tests prove linearity **structurally** (counted character reads, counted BigInt digits), with adversarial zero runs in the middle of
   integer, fractional and exponent forms up to 100,000 characters, plus a coarse wall-clock backstop.
7. **Canonical JWK coordinates** (unpadded base64url, exactly 32 bytes) **(v3) and each coordinate must be below the field prime p**; a canonical 32-byte value that is not a field element is `jwk.coordinate-range`.
8. **`bundleVersion: "1.0.0"`**, unsigned framing, decided before anything else is read.
9. **One domain registry**, one-to-one, distinct, prefix-free.
10. **Unicode is never normalized.**
11. **(v3) The verifier input is BYTES.** A `Uint8Array` of UTF-8. The ceiling is counted in bytes and checked FIRST; then a UTF-8 BOM is refused; then decoding is FATAL (overlong forms, encoded surrogates, truncated or stray bytes and code points above U+10FFFF are refused; U+FFFD is never substituted). A U+FEFF that is not first is a character. There is no normative string entry point.
12. **The semantic cross-checks are a registry, and (v3) every payload field is CLASSIFIED.** `PAYLOAD_FIELDS` lists every signed payload field once, either `cross-checked` (with its registered check) or `independent` (with the reason it needs none); the payload validator is derived from that table. A new payload
    field cannot be admitted without a row, and the tests require: every leaf of every vector payload is a row; every cross-checked row has a registered check and a "the signer lied" vector; every independent row has a reason and a tamper vector.
    **Which cross-checks run under an unsupported schema:** only `assessmentSchemaVersion` (it reads only the top-level `schemaVersion`) and the digest binding; every structure-dependent check is skipped, because nothing can be inferred from a structure that cannot be read.
13. **No key set means fail closed, and the layers stay separate.**
14. **(v3) SUPPORTED is strong.** In order, the first failure decides: `UNSUPPORTED_SCHEMA` (no exact validator for that version) -> `INVALID_ASSESSMENT` (the assessment fails the exact schema: required fields, CLOSED objects, enums, unique evidence ids, resolvable evidence references, coverage counts equal to the checks, control status follows from its checks,
    controls equal the implemented set, implemented and not-implemented disjoint) -> `UNSUPPORTED_PROFILE` -> `UNSUPPORTED_PROFILE_VERSION` -> `PROFILE_DEFINITION_MISMATCH` -> `SUPPORTED`. Integrity is `VALID` for all of them; none but `SUPPORTED` can satisfy a policy.
15. **(v3) Policy is strict and fail-closed.** A plain object with an exact key set, own properties only, exact types; `maxAgeSeconds` a nonnegative safe integer REQUIRING a canonical `now` (same strict timestamp parser); age `<=` max satisfies (inclusive), `>` fails, a future `issuedAt` fails (`ISSUED_AT_IN_FUTURE`);
    `allowedUpstreamCommits` a non-empty list of exact 40-hex commits compared by equality (a bare string is invalid; no substring). Anything else is `INVALID_POLICY`, which can never be `SATISFIED`.
16. **(v3) One strict timestamp parser** for `issuedAt`, key-set dates and the policy clock: `YYYY-MM-DDTHH:MM:SS.mmmZ`, Gregorian calendar validated by arithmetic (no Date; no rollover; `24:00` and `:60` refused; years 0001-9999).
17. **(v3) One shared depth model.** Absolute depth from the bundle root (bundle 1, assessment 2, payload 3); the parser and the canonicalizer use the same comparison. Whatever can be digested also parses inside its bundle, and the reverse.
18. **(v3) Signature spellings are canonical.** Exactly 64 bytes as 88 characters of standard base64 with `==`, and the four unused trailing bits zero. A trailing-bit alias decodes to the same 64 bytes and is refused.

## The product signing boundary (NORMATIVE; not implemented)

Written in [docs/attestation-profile-design.md](../../docs/attestation-profile-design.md), section 10.1, and pinned here only as far as it can be tested without signing: the pure **admission predicate**
(`admitAssessment`, `admission.v3.json`). The signer derives `workspaceId` (authenticated server context), `issuer` (server config), `keyId` (from the actual public key), `issuedAt` (its own clock), the profile fields (through the
closed registry), and every constant itself; refuses a key whose purpose is not `agentverify-profile-v1`; admits the assessment AFTER generation and BEFORE any private-key operation; and never signs a non-admitted assessment.
**No request-controlled override exists for any of these.** The Worker's unsigned `profile` route stays transparent and unsigned, and is not the signing boundary.

## Result model

`{ integrity, keyState, interpretation, policy? }`, never a single boolean. `interpretation`: `SUPPORTED`, `UNSUPPORTED_SCHEMA`, `INVALID_ASSESSMENT`, `UNSUPPORTED_PROFILE`, `UNSUPPORTED_PROFILE_VERSION`, `PROFILE_DEFINITION_MISMATCH`
(with `interpretationReason` for the two structural ones). `policy`: `SATISFIED`, `NOT_SATISFIED`, `INVALID_POLICY`.

## Externally observable changes from v2

| v2 | v3 |
|---|---|
| Known profile id and version, framework differs: `UNSUPPORTED_PROFILE` | `PROFILE_DEFINITION_MISMATCH` (reason `profile.framework`) |
| A validly signed bundle for the known profile with a wrong commit / licence / controls: `SUPPORTED` | `PROFILE_DEFINITION_MISMATCH` |
| A validly signed, structurally malformed assessment: `SUPPORTED` if the ids matched | `INVALID_ASSESSMENT` |
| Bare attestation with `attestationType: null` or `""`: `MALFORMED` `bundle.bundleVersion` | `MALFORMED` `bundle.bare-typed-attestation` |
| Policy: unknown keys, strings for lists, missing clock: silently evaluated | `INVALID_POLICY` |
| `1e-400` and friends: `JSON_NUMBER_UNDERFLOW` | `JSON_NUMBER_NOT_INTEGRAL` |
| Verifier input: text or object | bytes (`verifyProfileBundleBytes`) |
| Depth measured from each sub-object | absolute, from the bundle root |
| EC coordinate up to 2^256 - 1 | must be below p (`jwk.coordinate-range`) |
| Key-set `keys` not an array / empty issuer: `keySet.shape` | `keySet.keys` / `keySet.issuer` |

The frozen legacy scan attestation behaviour is **unchanged** (the same three implementations verify the v3 legacy vectors).

## What these vectors do NOT prove

They do not prove any observation inside an assessment is correct (the bundle assessments are **synthetic**, though the private scanner's test proves REAL assessments satisfy the schema). They do not test signing. The
legacy vectors freeze today's behaviour. Time and freshness: see decisions 4 and 5.

## Keys

Every key is a **throwaway** generated in memory by the generator and discarded. The vectors contain only public keys and signatures. There is no private key anywhere in this directory, and a test enforces it. The issuer is
`agentverify-conformance`; no real Agent Verify issuer or key appears. A key in these files must never be trusted for anything.

## Changing vectors

The vectors are **frozen**. `manifest.v3.json` holds the SHA-256 of every file and a test fails if any file changes. The generator cannot reproduce the same signatures, so re-running it produces an entirely new vector set; it therefore
refuses to run without `--new-vector-set` and refuses to overwrite without `--overwrite`. Doing so is a **new version of the vector set**, to be reviewed as such. If a rule changes, that is a version change of the attestation type first, and a vector change second.

## Mutation testing

`node conformance/v3/tools/mutation-check.mjs` mutates the reference (on a scratch copy; the repository is never modified) in targeted ways and requires the conformance tests to fail for each. It is slow, so it is not part of the gate. A survivor is
not automatically a reference defect (equivalent mutants and weak operators survive), but every survivor must be investigated and explained; the tool lists the equivalent ones with their reasons.

## Questions for the reviewer (third pass)

1. `INVALID_ASSESSMENT` keeps integrity `VALID` (the signature and digest are correct; the content is structurally wrong). Should a structurally invalid assessment instead be an integrity failure?
2. The control-status rule is derived from the scanner (any gap => gap; otherwise any not-assessed => not-assessed; else evidence-observed). The schema pins that rule. Is a closed rule right, or should the schema only require internal consistency of counts?
3. A policy with a non-default prototype is `INVALID_POLICY` rather than "ignore the inherited value". Confirm fail-closed is the better trade.
4. Year 0000 and years above 9999 are refused by the timestamp parser (RFC 3339 allows year 0000). Confirm.
5. Registry pins `upstream.status`. It can legitimately change when OWASP moves from public-review to final; that would be a new profile version. Confirm.
