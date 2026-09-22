# Profile assessment attestation: design

**Status: DRAFT, decisions D10, RD-2, RD-3 and RD-7 accepted (see §14). No signing code has been written and none should be until the conformance vectors and an independent review are done (§15).**
Scope: how Agent Verify signs a profile assessment (`owasp-agentic-skills-2026`, assessment schema `1.1.0`, the first schema eligible for attestation) so that
third parties can verify and store it. Out of scope: any change to existing scan attestations, and any
deployment.

The one sentence this whole design exists to protect:

> The signature proves the report's integrity and origin. It does not prove that every observation inside the report is correct.

## 0. Your questions, answered

| Question | Answer | § |
|---|---|---|
| Does `attestationVersion` bump globally, or a distinct type? | **A distinct type** with its own version line and a domain-separated signing input. The existing `attestationVersion: "1.0.0"` is untouched. | 3 |
| Canonicalization algorithm for the signed digest? | **RFC 8785 (JCS)**, applied strictly: fail rather than coerce. Digest is SHA-256 over a domain tag plus the canonical bytes. | 5 |
| Are timestamps part of the signed payload? | **Yes, `issuedAt`.** The assessment itself contains no timestamp, so it stays deterministic. `issuedAt` is the signer's clock, not a trusted time source. | 8 |
| Does a new evidence kind change the digest? | **Yes**, and that is correct. Old attestations are unaffected because each bundle carries the exact object that was signed. | 5.4 |
| Does reordering evidence change the digest? | **Yes, by design.** Order is part of what the user saw. The producer's order is deterministic and contract-tested. | 5.5 |
| What is the package identity? | The `avpkg-sha256` digest of the **submitted set** of (path, content) pairs, and nothing more. What it excludes is listed. | 6 |
| How does key rotation affect historical verification? | Adds a `keyId` and a published key set with statuses. Old bundles stay cryptographically verifiable; the key STATE is a separate, explicit result, and acceptance is a verifier policy. | 7 |
| Can it be verified offline? | **Yes**, given the bundle and a trusted key set. What offline cannot establish is stated. | 9.3 |
| Verifier knows v1, receives v2? | Fails closed with a specific status, never a partial verification. Full matrix in §3.3. | 3.3 |
| Does any UI imply the findings are cryptographically proven? | Not if the wording rules in §11 are enforced. Today's "ATTESTATION VALID" (green) is unsafe next to findings and is not reused. | 11 |

## 1. What exists today (verified against the code)

| Fact | Where |
|---|---|
| Payload fields: `attestationVersion`, `artifactHash`, `artifactHashAlgorithm`, `artifactFingerprintVersion`, `scanId`, `reportHash`, `verdict`, `score`, optional `policyProfile`/`policyResult`, `scannerVersion`, `rulesetVersion`, `schemaVersion`, `issuedAt`, `issuer` | `packages/scanner/src/attestation.ts` |
| Signed bytes are `JSON.stringify(canonicalizeForHash(payload))`. Keys are sorted recursively, so this is JCS-compatible for ordinary JSON. There is **no domain-separation tag**. | same |
| ECDSA P-256 with SHA-256, signature as standard base64 of the raw 64-byte `r‖s` | same, `attestationSigning.ts` |
| The public key is **embedded** in every attestation. Verification uses it unless the caller passes `expectedPublicKey`, so by default `VALID` means internal consistency only. | `verifyAttestation` |
| `issuer` is a plain string (for example `agentverify-prod`) naming the key's environment. **There is no key id and no rotation mechanism.** | `attestationSigning.ts` |
| The public key is served at `GET /v1/attestation/public-key` (one key, no history). | `worker.ts` |
| The verifier is strict: the version must equal `1.0.0`, and every required field must be present. | `verifyAttestation` |
| There is a second, independent verifier port in the web app, and a third in the CI stub. All three must agree. | `apps/web/src/lib/verifyAttestation.ts`, `scripts/create-ci-scanner-stub.mjs` |
| `GET /v1/verification/{artifactHash}` returns a verdict and score keyed by a 64-hex artifact hash. | `verificationStatus.ts` |
| The verify page shows a **green "ATTESTATION VALID"**, followed by a paragraph saying what a valid signature does not prove. | `apps/web/src/app/verify/page.tsx` |

### Findings that change the design

**F1. `canonicalizeForHash` turns `undefined` into `null`, and JSON transport drops `undefined` keys.**
If a signer hashes an in-memory object that has `{ line: undefined }` and a verifier hashes the parsed JSON (which
has no `line` key), the two canonical forms differ: `"line":null` versus absent. Today this is harmless because the
scan payload is built from defined values. A profile assessment contains many optional fields, so the rule for the
new type is: **the digest is computed over the JSON that is actually serialized**, and the canonicalizer **rejects**
`undefined`, non-finite numbers and non-plain values instead of coercing them.

**F2. The frozen assessment did not carry everything the payload should bind. RESOLVED by D10 (assessment schema `1.1.0`).**
Schema `1.0.0` had the upstream commit, the profile version and the implemented controls, but not `scannerVersion` or the
versions of the interpretation inputs. A signed field that cannot be checked against the assessment is a bare claim.
Schema `1.1.0` adds `scannerVersion`, `assessmentEngineVersion`, `riskRubricVersion`, `keyAllowlistVersion` and
`normalizationVersion` to `assessment.profile`. The rule that decides membership, enforced by a test that fails when a new
version constant is unaccounted for:

> If changing a versioned interpretation could change the same package's findings, that version belongs inside the signed assessment.

`1.0.0` stays as a frozen historical vector (`packages/scanner/test/fixtures/assessment-1.0.0.historical.json`), was never
released or deployed, and is **not** attestation-eligible. Verifiers and the CLI reject it as an unsupported schema.

**F3. There is no key identity.** With one key per environment and the key embedded, "which key signed this" is
answerable only by comparing key bytes. Rotation, retirement and revocation have nothing to attach to. See D7.

**F4. Assessment strings can contain attacker-influenced text** (file paths, manifest key names, tokens quoted in
summaries). A signature makes that text authentic, not safe. Consumers must treat it as untrusted display data.

## 2. What a signature does and does not prove

A valid profile attestation proves, and only proves:

1. This exact assessment object (the JSON bytes) is what Agent Verify produced.
2. It was produced for a package whose identity digest is the one in the payload.
3. It was produced under this exact profile definition, this pinned OWASP revision, this profile version and this
   assessment schema.
4. It was signed by the holder of the key identified by `keyId`, at or after `issuedAt` as that signer claims.
5. None of the above has been altered since.

It does **not** prove: that any observation, gap or `EVIDENCE_OBSERVED` status is correct; that the scanner found
everything; that the package is safe, compliant or certified; that what is deployed is this package; that the
`issuedAt` time is true; or that OWASP endorses anything. It never asserts an overall pass, because the assessment
has none.

**Forbidden words**, in the payload, in any UI and in any documentation of this feature: *certified, compliant,
passed, proven, guaranteed, secure, safe, OWASP-verified, OWASP-approved, immutable, tamper-proof.*

## 3. Decision D1: type and version strategy

### 3.1 Options

| Option | Effect | Verdict |
|---|---|---|
| A. Bump `attestationVersion` globally (for example to `1.1.0` or `2.0.0`) | Every attestation shares one schema line. The required-field list would need to become conditional (`verdict`, `artifactHash` and `reportHash` mean nothing for a profile assessment). Old verifiers would reject the new version cleanly, but the schema mixes two meanings, and a scan-verdict verifier could be tempted to accept a profile object. | Rejected |
| B. **Distinct attestation type with its own version line** | Existing `attestationVersion: "1.0.0"` attestations keep their exact bytes, fields and semantics, and keep verifying in every deployed verifier. The new type has its own required fields, so nothing is conditional. | **Recommended** |
| C. Reuse v1 and repurpose fields | Would silently change what existing signatures mean. | Rejected outright |

### 3.2 The recommended shape

- Payload discriminator: `attestationType: "agentverify.profile-assessment"` and `attestationVersion: "1.0.0"` (this type's
  own line). An attestation with no `attestationType` **is by definition** the existing scan-verdict type, unchanged.
- **Domain-separated signing input.** The signed bytes are
  `UTF8("agentverify-attestation/profile-assessment/v1\n") ‖ UTF8(JCS(payload))`, not the bare JCS payload. The existing
  type signs the bare JSON (it starts with `{`); the new type's input starts with the tag. The two inputs can never be
  equal, so a signature made for one type can never verify as the other even if both use the same key. Cross-type replay
  is closed structurally, not by field checks.
- Algorithm and encoding stay the same (ECDSA P-256, SHA-256, base64 of `r‖s`), so the same key infrastructure and
  WebCrypto code apply.
- Profile attestations use a **separate signing key** with an explicit purpose (RD-7 accepted, §7.1). The domain tag protects the
  signing input; the key purpose protects the key. Both are required.

### 3.3 What happens when a verifier meets something it does not know

| Verifier | Receives | Result |
|---|---|---|
| Existing scan verifier (today's code) | Profile attestation | `MALFORMED`: required scan fields are absent. Fails closed. Never `VALID`. |
| Profile verifier | Existing scan attestation | Dispatches on the missing `attestationType` to the legacy verifier, unchanged semantics. |
| Profile verifier, type `X` | Unknown `attestationType` | `UNSUPPORTED_TYPE`. No partial verification. |
| Profile verifier, version `1.0.0` | `attestationVersion: "1.1.0"` | `UNSUPPORTED_VERSION` (checked before any field). Payloads are strict (D13), so an unknown field is also rejected. |
| Profile verifier | Valid signature, `assessmentSchemaVersion` it cannot interpret | **Integrity is still `VALID`** (the digest is over opaque JSON). Interpretation is `UNSUPPORTED_SCHEMA`: tools show raw JSON only and never a rendered status. |

Rule: a verifier never guesses, never verifies a subset, and never upgrades an unknown version to "close enough".

## 4. The payload (D11, D13)

All fields are signed. **Nothing here is presentation state, and there is deliberately no aggregate result.**

```json
{
  "attestationType": "agentverify.profile-assessment",
  "attestationVersion": "1.0.0",
  "profile": "owasp-agentic-skills-2026",
  "profileVersion": "1.0.0-alpha.1",
  "framework": "OWASP_AGENTIC_SKILLS_TOP_10",
  "upstream": {
    "repo": "OWASP/www-project-agentic-skills-top-10",
    "commit": "d6f7d7d0de314f52a83a85d1828e06ab096e595c",
    "license": "CC-BY-SA-4.0"
  },
  "implementedControls": ["AST02", "AST03", "AST04"],
  "assessmentSchemaVersion": "1.1.0",
  "interpretationVersions": {
    "scannerVersion": "1.4.0",
    "assessmentEngineVersion": "1.0.0",
    "riskRubricVersion": "1.0.0",
    "keyAllowlistVersion": "1.0.0",
    "normalizationVersion": "1.0.0"
  },
  "package": { "digest": "avpkg-sha256:<64 hex>", "fileCount": 14 },
  "assessment": { "digest": "avassess-sha256:<64 hex>", "canonicalization": "RFC8785" },
  "workspaceId": "<present only when the assessment was requested inside a workspace; otherwise the field is omitted>",
  "issuer": "agentverify-prod",
  "keyId": "<RFC 7638 thumbprint>",
  "issuedAt": "<ISO-8601 UTC>"
}
```

| Field | Why it is signed | Cross-checked against the assessment? |
|---|---|---|
| `attestationType`, `attestationVersion` | Select the verifier and its rules | n/a |
| `profile` | The id that selects the interpretation. The assessment states it itself, so it is never a bare claim. | `assessment.profile.profileId` |
| `profileVersion` | Pin the profile definition | `assessment.profile.agentverifyProfileVersion` |
| `framework`, `upstream.*` | Pin the exact OWASP revision assessed against, and its licence for attribution | `assessment.profile.*` |
| `implementedControls` | **Downgrade defence.** An attestation from when only AST03 existed cannot pass as full coverage; a verifier can require a set without parsing the assessment. | `assessment.profile.implementedControls` |
| `assessmentSchemaVersion` | How to interpret the assessment | `assessment.schemaVersion` |
| `interpretationVersions.*` | Every versioned interpretation that can change findings for the same package. Key names are identical to the assessment's, so the cross-check is key-for-key. | `assessment.profile.scannerVersion`, `assessmentEngineVersion`, `riskRubricVersion`, `keyAllowlistVersion`, `normalizationVersion` |
| `package.digest`, `fileCount` | Binds the exact submitted package (§6) | `assessment.package.digest`, `fileCount` |
| `assessment.digest` | Binds the complete object the user saw (§5) | recomputed |
| `workspaceId` | Context the assessment was produced in (RD-3, §4.1). **Not** a verification restriction. | n/a |
| `issuer`, `keyId` | Who signed, with which key (§7) | n/a |
| `issuedAt` | When the signer says it signed (§8) | n/a |

**Single source of truth (D11).** The payload does **not** repeat control or check statuses. Repeating them would create a second copy that could
diverge from the assessment. Statuses are read from the assessment, whose integrity the digest proves. The few payload
fields that duplicate assessment fields (`profileVersion`, `upstream`, `implementedControls`, `assessmentSchemaVersion`,
`package`) exist so a verifier can **apply policy without parsing the assessment**. They are cross-checked, and a
mismatch is `BINDING_MISMATCH`, never trusted.

**Deliberately absent:** file paths, contents, findings text, any verdict, score, `passed`/`result` field, and any
customer or user identity. The payload leaks nothing about the package beyond a digest and a count. The only identity-like
field is the optional `workspaceId` below.

### 4.1 Workspace binding (RD-3, accepted)

- `workspaceId` is present **only** when the assessment was requested inside a workspace. When there is none, the field is
  **omitted**, never `null`, never an invented "global" workspace. One canonical encoding per meaning: a verifier rejects an
  explicit `null` (`MALFORMED`), so the same claim cannot have two different signed byte strings.
- It records context. It **never** means "only this workspace may verify this". Verification stays portable and offline from
  the bundle and trusted key material; no verifier needs, or is told, workspace membership.
- Today the profile route rejects `organizationId`, so in the first release the field is always omitted. The field is
  reserved now so that accepting it later does not need a new `attestationVersion`.
- The requesting principal (user or API key) is **not** bound: the existing scan attestation model does not treat it as
  meaningful, and it would leak a person's identity into a document that is designed to be handed to third parties.

**Strictness (D13).** A verifier rejects a payload with any field it does not know. Any change that adds a field with
meaning is a new `attestationVersion`, so a v1 verifier can never silently ignore a constraint the signer intended.

## 5. The assessment digest (D2, D4, D5)

`assessmentDigest = "avassess-sha256:" + hex( SHA-256( UTF8("agentverify-assessment-digest/v1\n") ‖ UTF8(JCS(assessment)) ) )`

### 5.1 What is hashed

The `assessment` object **exactly as returned in the response**, as JSON. Not the envelope, not an in-memory object,
and not a re-derived summary. The signer serializes once, parses those exact bytes back, and hashes that value (F1).

### 5.2 Canonicalization

RFC 8785 (JSON Canonicalization Scheme): object keys sorted by UTF-16 code units, ECMAScript number serialization,
minimal string escaping, no insignificant whitespace, UTF-8 output. Reasons: it is a published standard with
libraries in every major language (a third party need not copy our function), and it is what the existing
`canonicalizeForHash` already yields for ordinary JSON, so the ecosystem is not fragmented.

**Strict value domain.** Canonicalization fails (and signing fails closed) on: `undefined`, `NaN`/`±Infinity`,
non-plain objects (`Map`, `Set`, class instances, functions, symbols, `BigInt`), and strings containing lone
surrogates (I-JSON). Today's coercions (`undefined→null`, `String(x)`) are **not** inherited.

**Numbers: the Agent Verify signed-content numeric profile (NOT RFC 8785).** RFC 8785 serializes any finite IEEE-754 double, which
includes values a decimal-preserving runtime reads differently (integers beyond 2^53, decimals with more digits than a double holds,
`1e-400` collapsing to `0`, `-0` collapsing to `0`). The generic JCS serializer keeps that full domain so RFC 8785's own table can be
tested. Anything hashed or signed is held to a much narrower application rule about the **mathematical value, not the spelling**: **a signed
number is an integer with `|n| <= 2^53 - 1` that is not negative zero.** `98`, `98.0`, `9.8e1` and `0.98e2` are the same exact safe integer and are
admitted (JCS then canonicalizes it as `98`); `9007199254740993.0`, `9007199254740992.5`, `1e-400`, `0.1`, `98e-1` and `-0.0` are refused. A numeric
token is evaluated **exactly**, with arbitrary-precision integer arithmetic, before anything becomes a JavaScript number, so no spelling can round into
a different admitted integer and no nonzero value can underflow to zero. A naturally fractional quantity is encoded by the producer as a scaled integer
under an explicit name (the scanner's only former decimal, `printableRatio`, is now `printablePercent`, a whole percent). The parser, the
canonicalizer's admission check and the signer's pre-check implement one rule and must agree exactly.

**The classifier is linear in the length of the token, for every shape, admitted or refused.** It makes ONE left-to-right pass that records only indexes and counts (sign, where the integer and fraction digits are, the first and last nonzero digit, the exponent as a number when it has at most 15 significant digits and otherwise as "huge"), decides sign, significant-digit count, scale and exponent from those, and builds an arbitrary-precision integer ONLY after the token has been reduced to a bounded candidate (at most 16 significant digits, a bounded scale). It uses no regular expression, no `replace`, no `Number(token)`: nothing whose cost depends on the shape of the digits (a long run of zeros in the middle of an integer, a fraction or an exponent was quadratic in v2). An attacker-sized digit string never reaches the big-integer type. The conformance suite proves this structurally (counted reads and counted big-integer digits) and not only with a clock.

**One depth model.** Nesting is measured as an ABSOLUTE depth from the bundle root (the bundle is depth 1, the assessment root depth 2, the payload root depth 3) and limited to 64 by one shared rule. The canonicalizer is told the depth of the sub-object's parent, so anything that can be digested or signed also parses inside its bundle and the reverse. (In v2 an assessment nested to depth 64 measured alone was digestible but could not be parsed inside its bundle.)

**Duplicate keys.** A bundle containing duplicate JSON object keys is `MALFORMED`. JCS is defined on parsed values,
and parsers disagree on duplicates, so verifiers must reject them.

### 5.3 The domain tag and the prefix

The tag `agentverify-assessment-digest/v1\n` makes the digest unforgeable as any other hash of the same bytes, exactly as
the `avpkg-sha256` digest does. The `avassess-sha256:` prefix is the scheme identifier: a different scheme would use a
different prefix, never a reinterpretation of this one.

### 5.4 A new evidence kind changes the digest. Yes, correctly.

Any change to the assessment object changes its digest. That does not affect stored attestations: each bundle carries
the exact object that was signed, and verification recomputes its digest, never re-runs the scanner. Consequences to
accept explicitly:

- **A re-scan is a new assessment with a new digest** as the scanner evolves. Digests identify an assessment, not a package.
- **The assessment must be retained** by whoever wants to verify it later. Agent Verify does not save profile
  assessments today (`saved: false`), and it cannot regenerate one from a digest, because the package is not stored and the scanner changes. (RD-4.)

### 5.5 Reordering changes the digest. By design.

Options considered: sort "set-like" arrays (evidence by `id`, controls by `controlId`, and so on) before hashing so
reordering is irrelevant, or hash the object as delivered. Recommended: **as delivered**.

- The requirement is to sign what the user saw. Display order (evidence order, control order) is part of that.
- A normalization step becomes a second specification every verifier must implement identically, which is exactly where
  ports drift. The three existing verifier ports already show the cost.
- Arrays keep their order through JSON transport and all common stores; the realistic reorder risks are rare.
- The producer's order is **deterministic** (same input, same output; already covered by the frozen-contract test), so it
  can be relied upon.

If order-insensitivity is ever required, it is a new digest scheme (`avassess2-…`), not a change to this one.

## 6. Package identity (D6)

The package identity is the existing **`avpkg-sha256` digest** (scheme `agentverify-skill-package-digest/v1`): SHA-256 over
length-prefixed, domain-separated `(path, content)` pairs sorted by the UTF-8 bytes of the path, content hashed byte-exact
(no newline or whitespace normalization).

**It identifies the set of files that were submitted.** It therefore does **not** cover, and no consumer may infer:

| Not covered | Consequence |
|---|---|
| Files the CLI skipped: vendored directories (`node_modules`, `.git`, `__pycache__`) and binary assets | They were never assessed and are outside the identity. The CLI reports them; the service is never told. |
| File modes, ownership, timestamps, extended attributes | Not part of identity. |
| Empty directories | Not part of identity. |
| Symlinks | Not representable: rejected, so a package containing one has no identity at all. |
| Case-folded and NFC-equivalent spellings | Rejected as duplicates or non-NFC, so identity is over NFC paths only (RD-1). |
| Anything about the repository the files came from | Identity is not provenance. |

To reproduce the digest a third party needs the **same inclusion rules** the CLI applied. Those rules should be given a
stable identifier and published (RD-6), and a future `verify-package <dir> <bundle>` command can recompute the digest
locally. Until then the digest proves "this set of submitted files", not "this repository".

## 7. Keys, rotation and historical verification (D7)

### 7.1 Key identity

- `keyId` = the RFC 7638 JWK thumbprint (base64url SHA-256) of the public key, **inside the signed payload**. A verifier
  recomputes it from the embedded or pinned key and requires equality, so the signed key identity and the verifying key
  cannot diverge.
- Agent Verify publishes a **key set** (an addition beside `/v1/attestation/public-key`): each entry has `keyId`, the public
  JWK (exactly `{kty, crv, x, y}`), `purpose`, `status` (`active` | `retired` | `revoked`), `notBefore`, and `retiredAt` / `revokedAt` where applicable.
  The existing single-key endpoint stays as is.
- **Separate key, explicit purpose (RD-7, accepted).** Profile attestations are signed by their own key, and its key-set entry
  declares `"purpose": "agentverify-profile-v1"`. (The conformance vectors use `purpose`, not `use`: JWK already defines `use` as `sig` or `enc`, and the JWK itself stays exactly `{kty, crv, x, y}`.) The legacy scan-attestation key is not reused and
  is not listed with that purpose. Key set mechanism and issuer namespace are shared, so there is one place to publish, pin,
  rotate and revoke keys, but **purposes are not interchangeable**: a verifier rejects a key whose declared `purpose` does not
  match the attestation type being verified, even when the signature is otherwise valid (`KEY_PURPOSE_MISMATCH`, a key-state
  result distinct from `INVALID_SIGNATURE` and `KEY_UNKNOWN`; integrity is unaffected). The purpose is compared exactly, case-sensitively. The purpose is a property of the **key set
  entry only**: an attestation cannot carry one, because an attacker controls everything inside it. This means compromise or
  revocation of one purpose's key does not touch the other's, and a signature made by a scan key can never satisfy a
  profile verifier, or the reverse, by any confusion of the signing input.

### 7.2 What rotation means for verification

| Situation | Integrity | Key state |
|---|---|---|
| Recorded as active for the profile purpose | `VALID` | `KEY_ACTIVE` |
| Recorded as retired | `VALID` | `KEY_RETIRED`: what the key set records. A retired key's signatures remain cryptographically valid; whether to ACCEPT them is verifier policy (`acceptedKeyStates`, default active only). **Nothing here says when the signature was made.** |
| Recorded as revoked | `VALID` cryptographically | `KEY_REVOKED`. Never accepted by any policy, whatever `issuedAt` says. |
| `keyId` not in the verifier's key set | `VALID` cryptographically | `KEY_UNKNOWN`: internally consistent only. Never accepted. |
| In the key set, but for another purpose | `VALID` cryptographically | `KEY_PURPOSE_MISMATCH` |
| Key set malformed, or an unknown format version | `VALID` cryptographically | `KEY_SET_INVALID` |
| Key set older than one the verifier already accepted | `VALID` cryptographically | `KEY_SET_ROLLBACK_DETECTED` (only for a verifier that retains state) |
| Embedded key differs from `keyId` | `INVALID_SIGNATURE` | n/a |

Integrity and key **state** are **separate results** (D8); the existing verifier's "`VALID` means internal consistency by
default" behavior becomes explicit rather than implicit (`NOT_EVALUATED`). There is no state named "trusted": acceptance is a verifier
policy decision.

**`notBefore`, `retiredAt` and `revokedAt` are METADATA in v1, and `issuedAt` is never compared with them.** `issuedAt` is a signer claim, not trusted time, so no result
depends on it and no anomaly is flagged: the same bundle against a key retired before its `issuedAt` and one retired after it gives the same
result. The key-set dates are recorded and validated for form and are information for a human; **no verifier result or policy in v1 uses them**. A verifier policy may use them only after it has obtained a TRUSTED time from a source this design does not have (a signed timestamp or a transparency log, RD-5); until then no result may say that a signature predates a retirement, or is "too old" because of a key date.

**Key-set metadata and rollback state.** The key set carries `keySetVersion`, a monotonic `sequence` and `generatedAt`, because a strict schema makes
adding them later disruptive. This is rollback **detection** support, not rollback **protection**, and not a freshness guarantee. Detection needs the
verifier to actually **retain** prior state, and that state is **keyed by issuer**: the verifier looks up the retained sequence with the issuer named in
the bundle's own payload (never a bare number, never another issuer's state), and a lower sequence for that issuer is `KEY_SET_ROLLBACK_DETECTED`. The
result distinguishes `NO_RETAINED_STATE` (nothing to compare with: the number tells the verifier nothing), `NOT_BEHIND_RETAINED` (not older than something
already seen for this issuer, which is not "current") and `BEHIND_RETAINED`. The key set is unsigned, so anyone who can present one can present any
sequence, and `generatedAt` is informational (validated for form, never evaluated) unless a future authenticated freshness mechanism (a signed key set)
makes it more.

**What a caller that retains state MUST do** (the reference verifier is pure: it persists nothing, so all of this is the caller's responsibility):

1. **Update retained state only from an AUTHENTICATED, TRUSTED key-set distribution channel** (for example a pinned Agent Verify endpoint over TLS with a pinned origin, or an out-of-band published key set the operator chose). **Never** record a sequence from a key set that was presented inside or alongside a bundle being verified: the bundle's author controls that key set, and would otherwise be able to walk the verifier's state forward (denying every honest later key set) or seed it.
2. **Never turn an unsigned, presented key set into persistent trusted state.** A presented key set may be USED for one verification; it may not be REMEMBERED.
3. **Scope retained state by trusted source AND issuer.** If more than one authenticated source can claim the same issuer name, keep separate state per (source, issuer); a per-issuer number is only correct for state that already belongs to one trusted source.
4. **Sequence metadata is rollback-detection support, not freshness.** `NOT_BEHIND_RETAINED` means "not older than something already seen", never "current".
5. **Loss of retained state is `NO_RETAINED_STATE`**: the verifier learns nothing from the number, and must not report anything stronger.

**No key set means no conclusion, and no policy is satisfied.** A bundle can have valid cryptographic **integrity** while its key state is `NOT_EVALUATED`
because no key set was supplied. That never becomes a trust conclusion: `NOT_EVALUATED` is not an acceptable key state, so no verification policy is
satisfied. Integrity, key state and policy remain three separate results.

### 7.3 The honest limit on compromise

If a key is compromised, an attacker can sign new bundles and put **any `issuedAt`** on them, including a date before
the revocation. `issuedAt` is a signer claim, so **after a compromise every signature under that key is suspect,
whatever it says about time**, unless an independent record fixes when each attestation existed. That record is an
append-only transparency log (or an RFC 3161 timestamp). It is out of scope for the first version but is the only real fix (RD-5). Until then the design
states the limit and does not pretend `issuedAt` is trusted time.

## 8. Timestamps (D3)

- `issuedAt` is in the signed payload: it makes the object self-describing and lets a verifier apply an age policy.
- It is the **Worker's clock at signing**. It is not a trusted timestamp and gives no non-repudiation about *when*.
- The assessment contains **no timestamp**, so it is a pure function of the package and the scanner build. The same
  package and scanner always give the same assessment digest. That makes internal regression checks and audits possible,
  and keeps the digest free of time noise.
- No `expiresAt`. How long an assessment stays useful is a **verifier policy** (max age, minimum `profileVersion`, allowed
  upstream commits, required `implementedControls`), not a property the signer can decide for them.

## 9. Verification (D8)

### 9.1 The distributable artifact is a bundle

`{ bundleVersion: "1.0.0", attestation, assessment }`. An attestation alone proves only that some digest exists; it is useless without the
assessment. Bundles contain file paths, so sharing one shares paths (the payload alone does not). `bundleVersion` versions the CONTAINER and is
independent of `attestationVersion` (which versions the payload) and of the version inside any domain tag (which versions a signing-input
construction). It is unsigned framing in v1: changing it can only make a verifier refuse, never change what an accepting verifier verifies.

### 9.2 Algorithm

1. **The verifier input is BYTES.** Refuse input over the size ceiling (16 MiB, counted in bytes) before decoding anything. Decode strictly: UTF-8 with fatal error handling (invalid UTF-8 is refused, never replaced with U+FFFD), and refuse a UTF-8 byte order mark. Parse strictly under the signed-content numeric profile and the shared depth limit; reject duplicate keys and non-JSON. Otherwise `MALFORMED`.
2. A bare attestation whose payload has no `attestationType` is routed to the legacy verifier. Otherwise require `bundleVersion` (missing: `MALFORMED`; unsupported: `UNSUPPORTED_BUNDLE_VERSION`, decided before anything else in the bundle is read).
3. Dispatch on `attestationType`; unknown means `UNSUPPORTED_TYPE`. The signing tag comes from the registry entry for that type, never from the payload.
4. Require `attestationVersion` in the verifier's supported set, else `UNSUPPORTED_VERSION`. Reject unknown payload fields.
5. Require the algorithm `ECDSA-P256-SHA256` (else `UNSUPPORTED_ALGORITHM`) and the embedded key to be exactly `{kty, crv, x, y}` on P-256 with **canonical** coordinates (unpadded base64url, 32 bytes, re-encodes identically).
6. **Signature form, before any cryptography:** canonical base64, `1 <= r < n`, and `s <= floor(n/2)` (**low-S**). High-S is `MALFORMED` with reason `signature.high-s`. Low-S is an Agent Verify canonical-signature rule for this type; it is **not** an RFC 7518 requirement, and legacy verification is unchanged.
7. Recompute `keyId` from the key (RFC 7638 over `crv, kty, x, y` only); require equality with the payload, else `INVALID_SIGNATURE`. Verify the signature over `tag ‖ JCS(payload)`, else `INVALID_SIGNATURE`.
8. Recompute `assessmentDigest` (strict JCS plus the numeric profile). Mismatch is `BINDING_MISMATCH`.
9. Run the **cross-check registry**: every payload field that duplicates the assessment (profile id, profile version, framework, upstream, implemented controls, the five interpretation versions, package digest and count, schema version). Mismatch is `BINDING_MISMATCH`. A correct signature never overrides one.
10. Report **integrity** = `VALID` only if steps 1-9 pass.
11. Decide **interpretation**, in this order, the first failure deciding: the assessment schema version has an exact validator (`UNSUPPORTED_SCHEMA`); the assessment validates against that exact schema (`INVALID_ASSESSMENT`: required fields, closed objects, enums, evidence ids resolve, coverage and control status consistent, controls equal the implemented set, implemented and not-implemented disjoint, and every evidence item accounted for exactly once — referenced by at least one check's `supportingEvidenceIds`, or listed in `unmappedEvidenceIds`, never both, never neither; many-to-many references remain valid, this is a set-membership rule, not a cardinality one); the profile id is in the closed registry (`UNSUPPORTED_PROFILE`); the profile version is (`UNSUPPORTED_PROFILE_VERSION`); and every value the registry PINS for that id and version matches: framework, upstream repository, pinned upstream commit, upstream licence and status, implemented controls (and so the not-implemented controls), expected schema version (`PROFILE_DEFINITION_MISMATCH`). Otherwise `SUPPORTED`. The five interpretation versions are deliberately not pinned; each is bound independently by the cross-check registry. **Integrity stays `VALID` for every one of these outcomes**; nothing that is not `SUPPORTED` may be rendered or satisfy a policy. Under a schema this verifier cannot read, the structure-dependent cross-checks of step 9 are skipped (only `assessmentSchemaVersion` and the digest binding always run).
12. Resolve the **key state** against the verifier's key set (§7.2). Reported separately, never folded into integrity.
13. Apply **policy** (optional, verifier-owned, **strict and fail-closed**): `acceptedKeyStates` (default `KEY_ACTIVE`; `KEY_RETIRED` only by explicit opt-in; `KEY_REVOKED` never), required profile, allowed upstream commits (a non-empty LIST of exact 40-hex commits, compared by equality: no substring, and a bare string is invalid), required controls, package digest, maximum age. The policy must be a plain object with exactly these keys, own properties only, each of the exact type and form; anything else (an unknown key, a wrong type, a non-plain object, a missing or garbage clock) is `INVALID_POLICY`, which can never become `SATISFIED`. `maxAgeSeconds` is a nonnegative safe integer and REQUIRES a canonical `now` (checked by the same strict timestamp parser as every other timestamp; a missing or malformed `now` is `INVALID_POLICY`). Age `<=` the maximum satisfies the bound, age `>` fails (`TOO_OLD`), and an `issuedAt` after `now` fails (`ISSUED_AT_IN_FUTURE`). `minProfileVersion` is out of scope for v1: unknown type, version, profile and profile version fail closed instead.

Result model: `{ integrity, keyState, interpretation, policy? }`. There is no single boolean, and nothing anywhere named "verified" or "trusted".

### 9.3 Offline verification

Yes. Steps 1-11 need only the bundle. Step 12 needs a key set obtained once (or pinned). What offline **cannot** establish:
whether a key was revoked after the key set was cached, whether `issuedAt` is true, whether the package on disk still
matches, and whether a newer assessment exists.

### 9.4 What a verifier must not do

Treat integrity `VALID` as "the package is safe"; render statuses from an assessment whose integrity was not `VALID`;
verify only the fields it understands; trust the embedded key without a key-set check when making a trust decision;
interpret unknown assessment schemas; render assessment strings unescaped (F4).

**The normative consumer rule, stated once and referenced everywhere else:**

> A consumer may render, count, or act on an assessment only when integrity === 'VALID' AND interpretation === 'SUPPORTED'. Neither one alone is sufficient.

`integrity` answers "is this exactly what was signed"; `interpretation` answers "do I understand this structure well enough to read it." Neither answers the other's question, and a consumer that checks only one of the
two — most plausibly `integrity`, since it sounds the most authoritative — can be shown an assessment whose signature is perfectly valid but whose structure or profile this verifier cannot actually interpret.

## 10. Issuance API (D9)

Today the frozen profile response is `{ profile, assessment, attestation: null, saved: false }` and the contract test freezes
`attestation` as `null`. To keep that guarantee exactly:

- Issuance is **explicit opt-in**: a request field `attest: true` (strict boolean; anything else is a 400). Without it, nothing changes.
- With it, `attestation` becomes the signed profile attestation object. This is an **additive, versioned** widening of the frozen
  contract (contract `1.1.0`), documented as such.
- If `attest: true` is requested and signing is unavailable, the request **fails (503)**. It does not silently return
  `attestation: null`, because the caller asked for a signature and a silent unsigned result would be misread. (Existing scans
  do return an unsigned result quietly; that precedent is not extended to an explicit request.)
- The private scanner package builds the payload and the digest and can verify (public-safe, like `attestation.ts` today).
  Only the Worker signs, in `attestationSigning.ts`, the only place that touches the private key. The Worker stays orchestration:
  it hashes and signs an opaque object and adds no interpretation.
- Profile assessments still write nothing. Issuance does not change `saved: false`.
- **The Worker is not the signing boundary.** The unsigned profile response may keep containing values outside the signed-content numeric profile. When `attest: true`
  exists, the admission check (the numeric profile, applied to the assessment exactly as the digest and signature would consume it) runs **after** the assessment
  is generated and **before** any signing operation. An assessment that is not admitted is **never signed**: the request fails (it is not silently returned unsigned).
  This is to be tested when signing exists; no signing code exists now.
- **Metering (RD-2, RESOLVED for the v1.5.0 public release).** A completed profile assessment counts as exactly one Agent
  Verify scan unit, through the same metering path (the same `usage_monthly` ledger, the same `recordMonthlyUsage` call, the
  same quota already checked for an ordinary scan) an ordinary scan already uses — never a separate OWASP billing product or
  entitlement. `attest: true` is not metered separately: signing an assessment you already paid for is not a second scan, and
  a signing failure (422/503/500) after the assessment already succeeded never removes or duplicates that charge. A request
  that never reaches a completed assessment (malformed, over a size limit, unauthenticated, over quota, or a package the
  scanner rejects) consumes nothing. This closes the local-alpha "quota-gated but not consuming" state that could not ship
  publicly; see `workers/api/src/worker.ts` (the recording call sits in the Worker, immediately after `handleProfileRequest`
  returns success, and before the `attest: true` branch) and `workers/api/test/profileContract.test.mjs` section 13 for the
  frozen contract this now is.

### 10.1 The product signing boundary (NORMATIVE; no signing code exists)

Everything below is a **requirement on the future signing service**, written now so the implementation is checked against it rather than the other way round. It is
not implemented and no private-key handling exists in any product or reference path. Vector set v3 pins the verification side (and the pure admission predicate); a later
review must confirm a signer implementation against this list before it ships.

**Values the signer derives itself, from trusted sources only.** A request may carry only what the frozen contract already allows (the package, the profile id, `attest: true`).
No request field can set or override any of these:

| Payload field | Source |
|---|---|
| `workspaceId` | The authenticated server-side workspace context of the request. Never a request field. Omitted when there is no workspace. |
| `issuer` | Server-side configuration. |
| `keyId` | Derived (RFC 7638) from the PUBLIC key of the private key actually used to sign. Never configured separately, never accepted from a request. |
| `issuedAt` | The signing service's own clock, in the canonical timestamp form. |
| `profile`, `framework`, `upstream.*`, `implementedControls` | Resolved through the CLOSED profile registry from the accepted request profile id, and equal to the assessment's own `profile` block. |
| `profileVersion` | The registry's version for that profile. Never a request value. |
| `attestationType`, `attestationVersion`, `bundleVersion`, `assessment.canonicalization`, the signing-domain tag, the algorithm | Constants of the registry. No request can select or override them. |
| `package.digest`, `package.fileCount` | Computed from the package actually assessed. |
| `assessment.digest` | Computed from the assessment actually being attested, using the same canonicalization the verifier uses. |

**Key discipline.** The signer must **refuse to sign with a key whose declared purpose is not the profile-attestation purpose** (`agentverify-profile-v1`). The legacy scan key is never used.
The purpose is read from the key set / key configuration, never from the request.

**Admission before the private key is touched.** After the assessment is generated and **before any private-key operation**, the signer runs the admission predicate
(reference: `admitAssessment`): the assessment must canonicalize under the signed-content numeric profile within the shared depth limit (measured from the bundle root) **and** be
`SUPPORTED` (exact schema plus the pinned profile definition). An assessment that is not admitted is **never signed**; the request fails. Signing an assessment the reference verifier would
call anything but `SUPPORTED` is a defect.

**No request-controlled override** of issuer, keyId, issuedAt, workspaceId, profile version, signing domain or algorithm, by any parameter, header or default.

**The Worker's unsigned `profile` route remains transparent and unsigned**; it is not the signing boundary.

### 10.2 Key-set sequence discipline (NORMATIVE on the publisher; no publisher exists)

Section 7.2 already tells a **verifier** what to do with a retained sequence it holds (compare, never trust a key set presented alongside a bundle, scope by issuer). This section is the mirror obligation on the **publisher**: the
service that allocates `sequence` values and serves the key set in the first place. A verifier's rollback *detection* (§7.2) is only as good as the publisher's own *monotonicity*, and that has never been written down as a
requirement until now. The third independent review of vector set v3 found this gap; it is closed here as a documentation change, because no publisher exists yet to hold code to it.

- **`sequence` must be monotonic per trusted key-set source + issuer.** Two key sets ever served, for the same issuer, from the same trusted distribution channel, must never let a later one carry a `sequence` lower than
  (or equal in a way that hides a real change to) an earlier one a verifier could already have retained.
- **Sequence allocation must come from one authoritative serialized source of truth**, or from another mechanism that gives the same guarantee — monotonic issuance across regions, key rotations, deployments and
  failover — even under concurrent requests. A counter that is `sequence = sequence + 1` in two independent processes with no shared, serialized state is not such a mechanism.
- **A publisher must never emit a lower sequence than one already committed for that trusted source + issuer.** This holds even when the publisher believes its own local state was reset; if it cannot prove otherwise, it
  must treat its own last-known value as a floor, not start over.
- **Key rotation must not reset sequence.** Rotating the signing key changes which `keyId` is active; it is not an event that resets or restarts the sequence counter for the issuer's key set.
- **Redeploy or restart must not reset sequence.** An in-memory counter that returns to zero (or to a stale checkpoint) on every deploy is exactly the failure mode this section exists to forbid.
- **Regional failover must not allocate sequence independently from stale local state.** A region that becomes primary during failover must not resume allocating from whatever sequence it last observed locally if that
  observation could be behind what another region already committed; it must consult the same authoritative source of truth (or refuse to publish until it can).
- **Retained verifier state may only be advanced from an authenticated, trusted key-set distribution channel** (already normative for the verifier side, §7.2; restated here because the publisher is the thing that channel's
  trustworthiness ultimately rests on).
- **Arbitrary bundle-adjacent or presented key sets must never advance retained state.** A key set that arrived bundled with, or alongside, an attestation being verified is not the trusted distribution channel, however
  it got there, and must never be treated as one by anything the publisher operates or recommends.
- **Sequence metadata remains rollback-detection support, not freshness proof**, exactly as §7.2 states for the verifier side. Satisfying every rule above makes rollback *detectable* by a verifier that retains state; it does
  not make an attestation "fresh", and does not substitute for §8's honest limit on what `issuedAt` proves.

**How the sequence store is actually implemented — one serialized counter, a consensus log, a database transaction, or something else — is deployment infrastructure work, out of scope for this document.** What is
normative here is the guarantee it must provide (monotonic per trusted source + issuer, never regressing across rotation, redeploy or failover), not the mechanism. A future signer/publisher implementation must be checked
against this list before it ships, exactly as §10.1 is checked against its own list.

### 10.3 Admission-to-signing identity (NORMATIVE; no signing code exists)

**The exact assessment object admitted by `admitAssessment` MUST be the exact assessment object whose canonical bytes are digested and whose digest is included in the signed payload.** Admission (§10.1, "Admission before
the private key is touched") is only a meaningful gate if the thing it approves is the thing that gets signed. The third independent review of vector set v3 found this identity assumed but never written down; it is now explicit.

Between the admission check and the digest/signature that follow it, there must be no:

- regeneration;
- rescanning;
- reconstruction;
- semantic normalization;
- mutation;
- field insertion or removal;
- reordering of semantically ordered arrays;
- or second independently-built assessment.

**The future signer must not admit object A and then sign reconstructed object B, even when B is expected to be semantically equivalent to A.** "Semantically equivalent" is exactly the kind of claim that cannot be verified
from outside the signing service, and the entire point of admission is that a verifier — and a reviewer — can trust that whatever was admitted is what was signed, without having to trust that claim.

**Preferred implementation pattern:** admission produces or retains the canonical assessment bytes/digest that the signing operation consumes directly, rather than admitting one
in-memory object and later re-deriving canonical bytes from a different one. The pure reference functions already compose this way — `admitAssessment` canonicalizes with `signedBytes` before checking `SUPPORTED`, and
`assessmentDigest` canonicalizes the same way — so a signer that calls `admitAssessment(assessment)` and then, on success, digests that exact same `assessment` value (not a re-fetched or re-scanned one) satisfies this rule
by construction. No signing code exists yet; a later review must confirm an actual signer implementation holds this identity, not just that the reference functions could be composed to hold it.

## 11. Surfaces that must not consume it, and wording rules (D12)

Profile attestations have no `artifactHash`, no verdict and no score. They must **never** feed:
`/v1/verification/{artifactHash}`, the `VERIFIED` badge, policy evaluation, or the existing `ATTESTATION_ISSUED` scan-event
semantics. If a lookup is ever added it lives in a separate namespace.

**Wording.** The existing verify page's green "ATTESTATION VALID" is safe beside a single verdict it does not endorse; beside
per-control findings it is not (see §1). For profile bundles:

| Allowed | Not allowed |
|---|---|
| "Signature intact: this report is unaltered since Agent Verify produced it" | "Verified", "Valid", "Certified", "Compliant", "Passed", "Secure" |
| "Signed by Agent Verify key `<keyId>` (status: active / retired / revoked / unknown)" | A single green shield or tick for the whole bundle |
| Control and check statuses shown exactly as written (`GAP_IDENTIFIED`, `NOT_ASSESSED`) | Any colour, icon or wording that turns a status into a verdict |
| "This signature does not show the findings are correct or complete." (always shown next to the signature result) | OWASP logos or wording implying endorsement; the licence and "assessed against, not certified" attribution must be present |

The signature indicator and the control statuses are **visually separate components**. A valid signature with `GAP_IDENTIFIED`
is a normal, expected screen.

## 12. Compatibility and tests required before any code

1. **Legacy vectors.** Generate and freeze a set of existing scan attestations (dev key). They must verify unchanged in the
   scanner, the web port and the stub for as long as the product exists. This is the guarantee that existing signatures keep
   their meaning.
2. **Conformance vectors** shared by every implementation (scanner, web port, CLI port, CI stub): JCS cases (key order,
   Unicode escapes, `-0`, `1e21`, decimals, nesting, empty containers), digest cases, the signing input with its tag, keyId
   thumbprints, and a full signed bundle.
3. **Tamper matrix:** flip every payload field; mutate, add, remove and reorder every assessment field and array; swap
   package digests; downgrade `implementedControls`; substitute another bundle's assessment.
4. **Cross-type tests:** legacy verifier rejects a profile attestation; profile verifier routes legacy correctly; a
   signature over the tagged input never verifies as untagged, and vice versa.
5. **Strictness tests:** unknown payload field, duplicate JSON keys, `undefined`/`NaN`/lone-surrogate rejection in the canonicalizer, and
   the F1 round-trip case (in-memory object with an `undefined` property versus its serialized form).
6. **Key tests:** active, retired, revoked, unknown, embedded-key-mismatch.
7. **Offline test:** a bundle verifies with no network.
8. **UI lint:** the forbidden-word list (§2) is checked against every string in the new components.
9. **Contract:** the frozen profile contract test gains the additive `1.1.0` rows; the `attestation: null` default row stays.

## 13. Threat model

| Threat | Mitigation |
|---|---|
| Swap in a different assessment | Digest over the whole object, signed |
| Swap the package | `package.digest` signed and cross-checked against the assessment |
| Present an older, narrower attestation as current | `implementedControls`, `profileVersion`, `upstream.commit` in the payload; verifier policy pins them |
| Replay a scan attestation as a profile one (or reverse) | Distinct type and domain-separated signing input |
| Canonicalization ambiguity between signer and verifier | RFC 8785, strict domain, conformance vectors, sign the serialized JSON (F1) |
| Duplicate-key smuggling | Duplicate keys are `MALFORMED` |
| Key substitution in the bundle | `keyId` signed and recomputed; pinned key set |
| Backdating after key compromise | Stated limit (§7.3); transparency log or timestamping is the only fix (RD-5) |
| Rollback to an attestation from a revoked key | Key-set status; offline staleness limit stated |
| Attacker-influenced text in signed content (F4) | Consumers escape; the CLI already does; the wording rules keep signed text from reading as endorsement |
| Path leakage when sharing a bundle | Documented; the payload alone carries no paths |
| Signature read as "the findings are true" | §2 statement, §11 wording rules, separate UI components |
| Same key signs two types | Domain separation makes the inputs disjoint |

## 14. Decisions and release decisions

**Design decisions** (recommendation stated; D10 accepted):

| # | Decision | Recommendation |
|---|---|---|
| D1 | Global bump or distinct type | Distinct type, own version line, domain-separated signing input |
| D2 | Canonicalization | RFC 8785 strict; digest = tag + JCS |
| D3 | Timestamps | `issuedAt` signed; assessment timestamp-free; verifier owns age policy |
| D4 | Array order | As delivered; deterministic producer order |
| D5 | New evidence kind changes digest | Yes; bundles carry the signed object |
| D6 | Package identity | `avpkg-sha256` of the submitted set, exclusions documented |
| D7 | Key id and rotation | `keyId` thumbprint, published key set with key states; a retired key stays cryptographically verifiable and its acceptance is verifier policy (default: not accepted) |
| D8 | Verification result | Integrity, key state, interpretation and policy reported separately |
| D9 | Issuance | Explicit `attest: true`; 503 if unavailable; contract `1.1.0` additive |
| **D10** | **ACCEPTED. The assessment lacked `scannerVersion` and interpretation versions (F2)** | **Done: added to `assessment.profile` as assessment schema `1.1.0`, before anything is signed. Implemented and frozen by tests. Assessment `1.0.0` is frozen but was never released or deployed, so this is cheap now and expensive later. The alternative, keeping `1.0.0` and putting them only in the payload, leaves them unverifiable claims.** |
| D11 | No aggregate result, no repeated statuses in the payload | Single source of truth |
| D12 | Separation from existing surfaces | Never feeds verdict lookup, badge or policy |
| D13 | Strict payload | Unknown fields rejected; semantic additions need a version |

**Release decisions** (not for this design to settle, but each blocks something):

| # | Decision | Blocks | Notes |
|---|---|---|---|
| **RD-1** | **macOS and NFC.** The scanner rejects non-NFC paths, and macOS commonly reports accented names decomposed, so some legitimate macOS skills get a deterministic 422. **Not changed here.** Rejecting is defensible: package identity is defined over NFC paths and never silently rewritten. But it will surprise real users. | **Public CLI documentation** | Options: (a) keep rejecting and improve the error (name the file, say why, say how to rename), recommended for now; (b) have the service accept NFD and record that it normalized, which changes what identity means; (c) have the CLI normalize, which contradicts the faithful-package principle and makes the digest not match the disk. Any change to identity is a **new digest scheme** (`avpkg2-…`) and a new profile version, never an in-place edit, and the attestation binds the scheme so that is safe to do later. |
| RD-2 | **ACCEPTED (first pass).** A profile assessment counts as one scan when publicly released; unmetered during the local alpha; `attest: true` is not metered separately. | Public release | The current "quota-gated but not consuming" state must not ship publicly. |
| RD-3 | **ACCEPTED (first pass).** Bind workspace context when present: optional `workspaceId`, omitted (never `null`) when absent, no fake global workspace. Never a verification restriction. Requesting principal not bound. | Attestation `1.0.0` payload | See §4.1. Reserved now so accepting `organizationId` on the profile route later needs no new `attestationVersion`. |
| RD-4 | Retain and look up assessments? | Long-term verifiability | Profile assessments are not saved. A retention or lookup service brings privacy and authorization work. |
| RD-5 | Transparency log or trusted timestamping | Meaningful revocation and backdating defence | Out of scope for v1; the design states the limit instead. |
| RD-6 | Publish the packaging rules with an identifier and add `verify-package` | Third-party package binding | Without it the digest proves "these submitted files", not "this repository". |
| RD-7 | **ACCEPTED (first pass).** Separate signing key, explicit purpose (`use: "profile-attestation"`), shared key-set mechanism and issuer namespace, reject a key whose declared purpose does not match the attestation type. | Key management | See §7.1. |

## 15. Implementation plan (after decisions)

Agreed sequence: **assessment `1.1.0` → conformance vectors → independent review → signing implementation.** No signing code exists yet.

1. **DONE.** Assessment schema `1.1.0`: fields added, frozen contract updated deliberately, historical `1.0.0` vector kept, regression vectors and a version-accounting test added, Worker/CLI/CI stub moved to `1.1.0`.
2. **DONE (vector set v2), awaiting a second independent review.** Conformance and legacy vectors in `conformance/` (see its README). v2 replaces v1 after the first review: profile id in the assessment, `bundleVersion`, low-S, key states and key-set metadata, the signed-content numeric profile, canonical JWK coordinates, a closed profile registry, a domain registry, and a hardened test matrix. No signing code exists.
3. Strict canonicalizer and digest in the scanner package, with the public-safe payload builder and verifier.
4. Ports: web verifier and the CI stub, checked against the shared vectors; CLI verification after that.
5. Worker: `attest: true`, signing only in `attestationSigning.ts`, key-set endpoint, contract `1.1.0` rows.
6. Presentation, using the wording rules and the lint from §12.
7. Deploy decision, separately, after RD-2 and a real GitHub Actions run.

## Appendix A: signing input, concretely

```
signingInput  = UTF8("agentverify-attestation/profile-assessment/v1\n") ‖ UTF8(JCS(payload))
signature     = base64( ECDSA-P256-SHA256( privateKey, signingInput ) )        // raw r‖s, as today
assessmentDigest = "avassess-sha256:" + hex( SHA-256( UTF8("agentverify-assessment-digest/v1\n") ‖ UTF8(JCS(assessment)) ) )
keyId         = base64url( SHA-256( JCS({ crv, kty, x, y }) ) )                 // RFC 7638
```

## Appendix B: what stays exactly as it is

The existing scan attestation type, its `attestationVersion: "1.0.0"`, its bare-JCS signing input, its payload fields, its
three verifier implementations, `GET /v1/attestation/public-key`, `GET /v1/verification/{artifactHash}`, the `VERIFIED`
badge, and the verify page's current behavior. None of it is modified by this design.
