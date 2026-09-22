# Conformance vectors: profile-assessment attestation (VECTOR SET v4)

Status: **CANDIDATE for a narrow fourth confirmation pass. No signing implementation exists, and none may be started until v4 is confirmed.**
These vectors are the specification of [docs/attestation-profile-design.md](../../docs/attestation-profile-design.md) made executable.

This is **vector set v4, a NEW set, and a NARROW correction pass**. **Vector set v3 is frozen and untouched** (`conformance/v3/`, including its own
`reference/`, `test/`, `tools/`, `vectors/` and `README.md`): its manifest hash remains the reviewed historical artifact of the third review, and
`npm run test:conformance:v3` still runs it. v4 exists to fix exactly the three blockers that third review found, and nothing else:

1. **Evidence-accounting completeness** (a code change: `assessmentSchema.mjs`) — closed here.
2. **Normative key-set sequence discipline** (a documentation change: `docs/attestation-profile-design.md` §10.2) — closed here.
3. **Normative admission-to-signing identity** (a documentation change: `docs/attestation-profile-design.md` §10.3) — closed here.

Every other v3 decision (the O(n) numeric classifier, strict fail-closed policy, the closed profile registry, the shared depth model, bytes as the
normative verifier input, the strict timestamp parser, the payload-field classification registry) is **unchanged**. v4 needed a new vector set only
because item 1 changes assessment-schema *semantics* (a schema-valid assessment under v3 can be schema-invalid under v4); it did not need a vector-set
bump for items 2 and 3, which are documentation-only, but those get exactly the same "frozen once reviewed" treatment as everything else here.
Everything here is **frozen once reviewed**; see "Changing vectors".

## What is here

```
conformance/v4/
  README.md
  reference/            REFERENCE, TEST-ONLY code. Verification only: no signing, no private key handling. Identical to v3 except assessmentSchema.mjs.
    limits.mjs             THE shared limits: the ABSOLUTE depth model (64) and the byte ceiling (16 MiB)
    numberProfile.mjs      THE signed-content numeric profile: ONE linear pass, exact value, no regex, bounded BigInt
    strictJson.mjs         strict JSON parser (duplicate keys, lone surrogates, BOM, absolute depth) and the strict UTF-8 BYTES decoder
    jcs.mjs                strict RFC 8785 serializer (generic) + canonicalizeSigned (serializer PLUS numeric profile, given a base depth)
    timestamp.mjs          THE one strict canonical timestamp parser (arithmetic; no Date)
    plain.mjs              strict-shape helpers (own properties only)
    assessmentSchema.mjs   THE exact assessment schema, 1.1.0: what SUPPORTED requires structurally. (v4) + evidence-accounting completeness.
    profileRegistry.mjs    THE closed profile registry: pins framework, upstream repo/commit/licence/status, controls, schema
    policy.mjs             strict, fail-closed verifier policy
    domains.mjs            THE domain registry: attestation type, signing tag, key purpose, digest tags
    profileAttestation.mjs bytes entry point, payload field classification, cross-check registry, key state, admission predicate
  vectors/              the frozen data (JSON), plus manifest.v4.json with the SHA-256 of every file
    jcs.v4.json                  serializer cases, RFC 8785 number table, the NUMERIC PROFILE, ADVERSARIAL zero-run number vectors, depth model
    timestamps.v4.json           the strict timestamp parser, directly (valid, impossible dates, non-canonical spellings)
    assessment-schema.v4.json    the exact assessment schema: a valid base and single-fault cases, one problem code each, INCLUDING the (v4) evidence-accounting cases
    profile-registry.v4.json     the closed registry, lookups, and one case per pinned value
    admission.v4.json            the signer-side ADMISSION predicate (pure; nothing signs)
    avpkg.v4.json / assessment-digest.v4.json / keyid.v4.json / signing.v4.json / domains.v4.json
    bundles.v4.json               signed bundles + the verification cases (tamper, key state, policy, bytes, depth, schema, registry, ...)
    legacy-attestation.v4.json    frozen EXISTING scan attestations, low-S AND high-S, verified by three implementations
  test/                 the tests that run the vectors (node:test, no dependencies)
  tools/generate-vectors.mjs   ONE-SHOT generator. Read the warning in it before running.
  tools/mutation-check.mjs     mutation testing of the reference on a scratch copy (slow; not part of the gate)
```

The reference implementation is **not the product implementation.** It is a second, small, independently readable statement of the
rules. The future product implementation must produce identical results for every vector; where the two disagree, one of them is
wrong and the vector decides which. Do not import anything under `conformance/` from product code.

## Running

```bash
npm run test:conformance:v4
```

This runs in public CI against the generated scanner stub as well as locally against the real scanner. Two more checks run
elsewhere: the web port of the scan verifier (`apps/web/test/conformanceLegacy.test.mjs`, which now also runs the v4 legacy vectors) and the private
scanner's own check (`packages/scanner/test/conformanceV4.test.mjs`, which validates REAL assessments against the v4 assessment schema, including
evidence-accounting completeness, and the numeric profile — see "A real scanner finding" below).

## Loading the vector files

- **The vector files are not themselves bound by the 64-level verifier limit.** `bundles.v4.json` holds a signed bundle whose assessment is nested to
  exactly absolute depth 64 *inside the bundle*, which sits several levels inside the file. A loader must not apply the verifier's depth rule to the vector file.
- A verifier is given **bytes**. A case's `source` is `{ signed, patch? }` (an object: any serialization of it), `{ text }` (the exact UTF-8 text) or
  `{ bytesHex }` (the exact bytes). Only the last two are byte-exact.
- Values JSON text cannot carry safely are written `{ "$ieeeHex": "<16 hex digits>" }` (an exact IEEE-754 double: a fraction, `-0`, `2^53`, `NaN`) and
  `{ "$nested": k }` (k nested arrays around a string). The adversarial number tokens are rebuilt from a `kind` and a size `N`
  by `adversarialToken` in `test/helpers.mjs`.
- Policies whose defect is not expressible in JSON (an inherited property, a class instance, a symbol key) are named by `policyBuilder`.

## Decisions this vector set pins

Items 1 to 18 below are inherited from v3 unless marked **(v4)**.

1. **The assessment carries its profile id**, cross-checked against the payload. **The profile registry is authoritative**: for each `profileId` + `profileVersion` it
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
   `NOT_BEHIND_RETAINED` (not older than something already seen: NOT "current" and NOT "fresh"), `BEHIND_RETAINED`. What the CALLER must do, because the reference persists nothing:
   update retained state ONLY from an AUTHENTICATED, TRUSTED key-set distribution channel; NEVER from a key set presented inside or alongside a bundle; NEVER turn an unsigned presented key set into persistent trusted state; scope retained state by
   TRUSTED SOURCE and issuer when more than one authenticated source may claim the same issuer; loss of state is `NO_RETAINED_STATE`. **(v4) The mirror obligation on the PUBLISHER** (the service that allocates `sequence` in the
   first place, which does not exist yet) is now normative too: see "Key-set sequence discipline" below.
6. **The signed-content numeric profile (NOT RFC 8785): the mathematical VALUE decides.** An integer, `|n| <= 2^53 - 1`, not negative zero; `98`, `98.0`, `9.8e1` are one number. It is a LINEAR, one-pass classifier for every shape:
   it records only indexes and counts (sign, digit positions, first and last nonzero digit, exponent as a number or "huge"), decides from those, and builds a BigInt only after reduction to a bounded candidate (at most 16 significant digits).
   No regular expression, no `replace`, no `Number(token)`. A nonzero value below 1 is simply `NON_INTEGER` (there is no separate underflow status). The tests prove linearity **structurally** (counted character reads, counted BigInt digits), with adversarial zero runs in the middle of
   integer, fractional and exponent forms up to 100,000 characters, plus a coarse wall-clock backstop.
7. **Canonical JWK coordinates** (unpadded base64url, exactly 32 bytes) **and each coordinate must be below the field prime p**; a canonical 32-byte value that is not a field element is `jwk.coordinate-range`.
8. **`bundleVersion: "1.0.0"`**, unsigned framing, decided before anything else is read.
9. **One domain registry**, one-to-one, distinct, prefix-free.
10. **Unicode is never normalized.**
11. **The verifier input is BYTES.** A `Uint8Array` of UTF-8. The ceiling is counted in bytes and checked FIRST; then a UTF-8 BOM is refused; then decoding is FATAL (overlong forms, encoded surrogates, truncated or stray bytes and code points above U+10FFFF are refused; U+FFFD is never substituted). A U+FEFF that is not first is a character. There is no normative string entry point.
12. **The semantic cross-checks are a registry, and every payload field is CLASSIFIED.** `PAYLOAD_FIELDS` lists every signed payload field once, either `cross-checked` (with its registered check) or `independent` (with the reason it needs none); the payload validator is derived from that table. A new payload
    field cannot be admitted without a row, and the tests require: every leaf of every vector payload is a row; every cross-checked row has a registered check and a "the signer lied" vector; every independent row has a reason and a tamper vector.
    **Which cross-checks run under an unsupported schema:** only `assessmentSchemaVersion` (it reads only the top-level `schemaVersion`) and the digest binding; every structure-dependent check is skipped, because nothing can be inferred from a structure that cannot be read.
13. **No key set means fail closed, and the layers stay separate.**
14. **SUPPORTED is strong, and (v4) now includes evidence-accounting completeness.** In order, the first failure decides: `UNSUPPORTED_SCHEMA` (no exact validator for that version) -> `INVALID_ASSESSMENT` (the assessment fails the exact schema: required fields, CLOSED objects, enums, unique evidence ids, resolvable evidence references,
    **(v4) every evidence item accounted for exactly once — referenced by a check, or listed unmapped, never both, never neither (`assessment.schema.evidence-mapping-conflict`, `assessment.schema.evidence-unaccounted`)**, coverage counts equal to the checks, control status follows from its checks,
    controls equal the implemented set, implemented and not-implemented disjoint) -> `UNSUPPORTED_PROFILE` -> `UNSUPPORTED_PROFILE_VERSION` -> `PROFILE_DEFINITION_MISMATCH` -> `SUPPORTED`. Integrity is `VALID` for all of them; none but `SUPPORTED` can satisfy a policy.
    **(v4) Many-to-many evidence references remain valid**: one evidence item may back several checks, and one check may cite several evidence items; the new rule is about SET MEMBERSHIP (is every evidence id accounted for at all), never about cardinality.
15. **Policy is strict and fail-closed.** A plain object with an exact key set, own properties only, exact types; `maxAgeSeconds` a nonnegative safe integer REQUIRING a canonical `now` (same strict timestamp parser); age `<=` max satisfies (inclusive), `>` fails, a future `issuedAt` fails (`ISSUED_AT_IN_FUTURE`);
    `allowedUpstreamCommits` a non-empty list of exact 40-hex commits compared by equality (a bare string is invalid; no substring). Anything else is `INVALID_POLICY`, which can never be `SATISFIED`.
16. **One strict timestamp parser** for `issuedAt`, key-set dates and the policy clock: `YYYY-MM-DDTHH:MM:SS.mmmZ`, Gregorian calendar validated by arithmetic (no Date; no rollover; `24:00` and `:60` refused; years 0001-9999).
17. **One shared depth model.** Absolute depth from the bundle root (bundle 1, assessment 2, payload 3); the parser and the canonicalizer use the same comparison. Whatever can be digested also parses inside its bundle, and the reverse.
18. **Signature spellings are canonical.** Exactly 64 bytes as 88 characters of standard base64 with `==`, and the four unused trailing bits zero. A trailing-bit alias decodes to the same 64 bytes and is refused.

## Evidence-accounting completeness (v4, blocker #1)

`assessmentSchemaProblem` now requires, for every structurally-valid-so-far assessment:

```
allEvidenceIds === referencedEvidenceIds UNION unmappedEvidenceIds
referencedEvidenceIds INTERSECT unmappedEvidenceIds === ∅
```

where `referencedEvidenceIds` is every id that appears in ANY check's `supportingEvidenceIds`, across every control. Checked as two separate rules, in this
order: an id claimed unmapped while a check also cites it is `assessment.schema.evidence-mapping-conflict` (checked first); an evidence id present in
neither set is `assessment.schema.evidence-unaccounted`. Both are checked only after every reference already resolves (`assessment.schema.evidence-reference`,
`assessment.schema.unmapped-evidence` — unresolved ids were already refused before v4 and still are, by the same earlier checks, not by the new ones).
**Many-to-many stays valid**: one evidence item cited by two checks, or one check citing two evidence items, is unaffected — this is a set-membership rule,
not a cardinality rule. Before v4, a `"gap"`-polarity (or any) evidence item that a signer left out of every check AND out of `unmappedEvidenceIds` was
still `SUPPORTED`; it is now refused, because nothing in the control-level rollup would ever have reflected it.

### A real scanner finding, discovered while building v4 (not a v4 defect)

Testing the new rule against the REAL private scanner (not just synthetic vectors) found one genuine, narrow, pre-existing case: a package that makes
network access unrestricted produces a `network.unrestricted_matches_dynamic_need` (axis `network`, polarity `context`) evidence item that IS routed to
check 3.2 by the scanner's own mapping table, but never actually appears in check 3.2's `supportingEvidenceIds`, and is not caught by the scanner's
"unmapped by kind" computation either (since the *kind* is mapped — only the specific *item* never reaches a check's own list). The v4 rule correctly
refuses this as `assessment.schema.evidence-unaccounted`. This is a real, narrow scanner mapping-table gap, not a defect in this vector set; fixing the
scanner is out of scope for this documentation-and-schema-only correction pass (see the correction instructions: "do not redesign the evidence model").
It is filed as a named, pinned exception in `packages/scanner/test/conformanceV4.test.mjs`, which fails loudly if a second, different, or additional
orphaned-evidence case ever appears, so this cannot silently grow.

## Key-set sequence discipline (v4, blocker #2)

Normative, on the future publisher, in [docs/attestation-profile-design.md](../../docs/attestation-profile-design.md) §10.2: `sequence` must be monotonic
per trusted key-set source + issuer, from one authoritative serialized source of truth (or an equivalent mechanism); a publisher must never emit a lower
sequence than one already committed; key rotation, redeploy/restart and regional failover must never reset or independently reallocate it from stale local
state; retained verifier state may only be advanced from an authenticated, trusted key-set distribution channel, never from a key set presented inside or
alongside a bundle. This is a documentation change only: no publisher exists to hold code to it yet, and how the sequence store is actually implemented
(a serialized counter, a consensus log, a database transaction) is deployment infrastructure work, explicitly out of scope here — the *guarantee* is normative,
the mechanism is not.

## Admission-to-signing identity (v4, blocker #3)

Normative, in the same document, §10.3: the exact assessment object `admitAssessment` approves MUST be the exact object whose canonical bytes are
digested and signed — no regeneration, rescanning, reconstruction, semantic normalization, mutation, field insertion/removal, reordering of semantically
ordered arrays, or second independently-built assessment between the two. A future signer must not admit object A and sign reconstructed object B, even
if B is claimed semantically equivalent. The preferred pattern: admission produces or retains the canonical bytes/digest the signing operation then
consumes directly, exactly as the pure reference functions already compose (`admitAssessment` and `assessmentDigest` both canonicalize with `signedBytes`).
Documentation only; no signing code exists to test this against yet.

## The product signing boundary (NORMATIVE; not implemented)

Written in [docs/attestation-profile-design.md](../../docs/attestation-profile-design.md), §10.1–10.3, and pinned here only as far as it can be tested without signing: the pure **admission predicate**
(`admitAssessment`, `admission.v4.json`). The signer derives `workspaceId` (authenticated server context), `issuer` (server config), `keyId` (from the actual public key), `issuedAt` (its own clock), the profile fields (through the
closed registry), and every constant itself; refuses a key whose purpose is not `agentverify-profile-v1`; admits the assessment AFTER generation and BEFORE any private-key operation; and never signs a non-admitted assessment,
or a reconstructed object different from the one admitted (§10.3). **No request-controlled override exists for any of these.** The Worker's unsigned `profile` route stays transparent and unsigned, and is not the signing boundary.
The publisher of any future key set owes the sequence-monotonicity guarantee of §10.2.

## Result model

`{ integrity, keyState, interpretation, policy? }`, never a single boolean. `interpretation`: `SUPPORTED`, `UNSUPPORTED_SCHEMA`, `INVALID_ASSESSMENT`, `UNSUPPORTED_PROFILE`, `UNSUPPORTED_PROFILE_VERSION`, `PROFILE_DEFINITION_MISMATCH`
(with `interpretationReason` for the structural ones — now including `assessment.schema.evidence-mapping-conflict` and `assessment.schema.evidence-unaccounted`). `policy`: `SATISFIED`, `NOT_SATISFIED`, `INVALID_POLICY`.

**The normative consumer rule:** A consumer may render, count, or act on an assessment only when integrity === 'VALID' AND interpretation === 'SUPPORTED'. Neither one alone is sufficient.

## Externally observable changes from v3

| v3 | v4 |
|---|---|
| Evidence referenced by no check and absent from `unmappedEvidenceIds`: `SUPPORTED` | `INVALID_ASSESSMENT` (`assessment.schema.evidence-unaccounted`) |
| Evidence both referenced by a check AND listed in `unmappedEvidenceIds`: `SUPPORTED` | `INVALID_ASSESSMENT` (`assessment.schema.evidence-mapping-conflict`) |
| Evidence referenced by more than one check, or a check citing more than one evidence item | unchanged: still valid (many-to-many was never forbidden) |

Every other externally observable behaviour is **unchanged** from v3 (see [conformance/v3/README.md](../v3/README.md) for the full v2→v3 table, which
still holds). The frozen legacy scan attestation behaviour is unchanged (the same three implementations verify the v4 legacy vectors).

## What these vectors do NOT prove

They do not prove any observation inside an assessment is correct (the bundle assessments are **synthetic**, though the private scanner's test proves REAL assessments satisfy the schema, with the one named, documented exception above). They do not test signing. The
legacy vectors freeze today's behaviour. Time and freshness: see decisions 4 and 5.

## Keys

Every key is a **throwaway** generated in memory by the generator and discarded. The vectors contain only public keys and signatures. There is no private key anywhere in this directory, and a test enforces it. The issuer is
`agentverify-conformance`; no real Agent Verify issuer or key appears. A key in these files must never be trusted for anything.

## Changing vectors

The vectors are **frozen**. `manifest.v4.json` holds the SHA-256 of every file and a test fails if any file changes. The generator cannot reproduce the same signatures, so re-running it produces an entirely new vector set; it therefore
refuses to run without `--new-vector-set` and refuses to overwrite without `--overwrite`. Doing so is a **new version of the vector set**, to be reviewed as such. If a rule changes, that is a version change of the attestation type first, and a vector change second.

## Mutation testing

`node conformance/v4/tools/mutation-check.mjs` mutates the reference (on a scratch copy; the repository is never modified) in targeted ways and requires the conformance tests to fail for each. It is slow, so it is not part of the gate. A survivor is
not automatically a reference defect (equivalent mutants and weak operators survive), but every survivor must be investigated and explained; the tool lists the equivalent ones with their reasons.

## Questions for the reviewer (fourth pass — a narrow confirmation only)

Per the correction instructions, the next review is **not** another full architecture review. It should confirm only:

1. **Evidence-accounting completeness** — does `assessment.schema.evidence-mapping-conflict` / `assessment.schema.evidence-unaccounted`, as implemented, actually close the gap the third review found, with no remaining way to orphan or double-claim an evidence id?
2. **Key-set sequence discipline** — does §10.2, as written, give a future publisher implementation enough to be checked against, with no normative gap left for "how would we actually know if we violated this"?
3. **Admission-to-signing identity** — does §10.3, as written, actually forbid every substitution path a real signing service could introduce, or is there a "reconstruction" shape not covered by the named list?

Everything else (the third review's lower-severity findings: exact `maxAge` arithmetic hardening, explicit on-curve MUST language, `assessmentSchemaProblem`'s standalone invariant, the `requiredControls` empty-array asymmetry, the evidence-polarity/check-status semantic decision, year 0000, `bundleVersion` future-discipline wording, regex mutation expansion, the combined numeric adversarial vector, and the broader interoperability notes) is **recorded, deliberately deferred**, and out of scope for this pass; it was not touched, and is not expected to be re-litigated here.
