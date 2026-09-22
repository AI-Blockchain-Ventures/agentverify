# Post-authorization implementation gate — changelog

This directory is **not** part of any frozen conformance vector set. Nothing here is signed, hashed, or
covered by a manifest. It exists to record, and to mechanically enforce, the transition from "v4 is frozen
for independent review, no implementation exists yet" to "v4's review is complete, implementation is
authorized". See `docs/attestation-profile-design.md` for the normative design and `conformance/v4/README.md`
for the frozen reference's own account of itself.

## Entry 1 — the gate lifted, and the one historical test this invalidated

- **Frozen v4 manifest (unchanged, still authoritative):**
  `22a6fa2de463a68c17569878aa79b04691c4629f31a6fe67dfca8a3c7dd82014`
- **Review state when the gate lifted:** the fourth independent confirmation review of vector set v4 returned
  `READY FOR SIGNER IMPLEMENTATION`, with no blockers, covering (A) evidence-accounting completeness, (B)
  key-set sequence discipline, (C) admission-to-signing identity, and (D) the real-scanner orphaned-evidence
  exception (confirmed to not block signing). The user then explicitly lifted the review gate and authorized
  signer implementation against frozen v4.
- **Exact historical test now excluded from post-authorization runs:**
  `conformance/v4/test/docs.test.mjs` → `'THE SIGNING GATE: no signing or private-key handling exists in the
  reference or in any product path'`
- **Why it is excluded, not deleted or edited:** that test was written as the mechanical tripwire for the
  review-gate rule "no signing code exists anywhere in product paths until independent review completes". It
  asserts, by regexing every file under `workers/api/src`, `packages/cli/src`, `packages/scanner/src` and
  `apps/web/src`, that none of them contain the profile-attestation's domain constants (`agentverify.profile-
  assessment`, its signing tag, `agentverify-profile-v1`, `PROFILE_KEY_PURPOSE`, `avassess-sha256`). That
  condition was true, and correct, for as long as the gate stood. The fourth review's `READY FOR SIGNER
  IMPLEMENTATION` verdict intentionally ends that condition: the whole point of lifting the gate is that
  `packages/scanner/src/profileAttestation.ts` (and, from here on, the signing module and Worker wiring) now
  legitimately contain those constants. The test's assertion and the authorized state of the world now
  directly contradict each other by design, not by regression.
- **What was NOT changed:** the frozen v4 tree (`conformance/v4/reference/**`, `conformance/v4/vectors/**`,
  `conformance/v4/test/**`, `conformance/v4/README.md`, and its manifest) is byte-identical to what the fourth
  review examined. `docs.test.mjs` itself was not edited. The exclusion is implemented entirely from outside
  the frozen tree, in [`run-v4-post-authorization.mjs`](run-v4-post-authorization.mjs), by test name, via
  Node's `--test-name-pattern`, and that script names the excluded test's exact string so the exclusion is
  never silent or implicit. Every other test in `docs.test.mjs` (the D8 result-model wording, the retained-
  sequence caller requirements, the §10.1 signing-boundary text, the three numbered review blockers, the
  consumer rule, the unsigned-`profile`-route pass-through test) continues to run and is still required to
  pass.
- **What replaces the retired assertion going forward:** `postAuthorizationGate.test.mjs` in this directory —
  see its header for what it checks now that implementation is expected to exist, rather than checking that it
  does not.

Do not rewrite this entry. A future gate-related change gets its own dated entry below it, not an edit to this
one.

## Entry 2 — the same tripwire, discovered a second time, in v3

While running the full security-release gate after implementation, `npm run test:conformance:v3` failed on the
identical test: `conformance/v3/test/docs.test.mjs` → `'THE SIGNING GATE: no signing or private-key handling
exists in the reference or in any product path'`. v3's frozen manifest was not re-derived for this entry (v3
predates the v4-specific per-file manifest mechanism used above), but the relevant fact is simpler: v4's own
README describes v4 as "a narrow correction pass" over v3, and `docs.test.mjs`'s signing-gate test is
byte-identical between the two sets — v4 never touched it. The fourth review's `READY FOR SIGNER
IMPLEMENTATION` verdict and the gate-lift it recorded apply to the same underlying rule ("no implementation
exists yet") in both places, not only to the v4 copy of the test that happens to assert it.

**Resolution:** extracted the shared exclusion logic from `run-v4-post-authorization.mjs` into
[`postAuthorizationRunner.mjs`](postAuthorizationRunner.mjs) (`runPostAuthorization(version)`), and added
[`run-v3-post-authorization.mjs`](run-v3-post-authorization.mjs) alongside it — same mechanism, same named
exclusion, applied to `conformance/v3/test/docs.test.mjs` instead. `conformance/v3/**` was not modified.
`npm run test:conformance:v3:post-authorization` replaces `npm run test:conformance:v3` in
`scripts/verify-security-release.mjs`'s step 3c, exactly as the v4 script already replaced step 3d's direct
call. v3 has no implementation-gate step of its own: `postAuthorizationGate.test.mjs` (this directory) already
covers both sets' product-path implications in one place and continues to run once, as part of the v4 script.

## Entry 3 — actual public CI (`.github/workflows/ci.yml`) was still calling the raw scripts, and the generated
## scanner stub had no profile-attestation exports at all

Running a full simulation of `.github/workflows/ci.yml` (moving the real, gitignored `packages/scanner` aside,
generating the public scanner stub, and running every CI step against it) found two more, more serious gaps
than the local `verify-security-release.mjs` fixes above:

1. **The GitHub Actions workflow file itself still invoked `npm run test:conformance:v3` / `:v4` directly** —
   not the `:post-authorization` variants. `scripts/verify-security-release.mjs` (the LOCAL gate) was fixed in
   Entries 1–2, but `.github/workflows/ci.yml` (the actual public CI pipeline) was never updated to match, so a
   real push or PR would have failed on the same retired tripwire this whole directory exists to retire
   correctly. Fixed by pointing both steps at the `:post-authorization` scripts.
2. **`scripts/create-ci-scanner-stub.mjs` generated no `PROFILE_*`/`admitAssessment`/etc. exports at all.**
   `workers/api/src/profileAttestationSigning.ts` imports these names from `@agentverify/scanner`; against the
   stub, `tsc --noEmit` failed outright (`has no exported member 'admitAssessment'`, ...). Fixed by adding a
   complete, hand-maintained, non-proprietary flattened port of the verification logic (canonicalization,
   schema validation, registry, digests, signature-form checks, admission — everything
   `packages/scanner/src/profileAttestation.ts` itself contains) directly into the stub generator, in both a
   typed variant (for the `.ts`/`.d.ts` output `tsc` checks) and a plain-JS variant (for the runtime
   `dist/index.js` public CI actually executes). This is exactly the SAME pattern the stub already used for the
   legacy scan-attestation verifier and policy evaluator — non-proprietary, verification-only logic is safe and
   correct to duplicate in full; only the SCANNER's detection logic (`assessSkillPackageAst`) stays a stub.
   `postAuthorizationGate.test.mjs`'s three checks that read the real `packages/scanner/src/profileAttestation.ts`
   or its private test suite were also fixed to skip (not fail) when only the stub is present, gated on the one
   thing only the real package creates (`packages/scanner/test/`), matching the `HAS_REAL_SCANNER`/`realOnly`
   pattern already used throughout `workers/api`'s and `packages/cli`'s own suites.

**Verification:** the full `.github/workflows/ci.yml` step sequence was run end to end against the generated
stub (stub generation, CLI build+test, Worker build+test, `test:conformance`, `test:conformance:v3/v4:post-
authorization`, web typecheck, web lint, private-boundary check, "scanner not tracked" check) — all green — and
then re-run in full against the restored real scanner, also all green. If `packages/scanner/src/profileAttestation.ts`
ever changes these algorithms, the stub copy in `scripts/create-ci-scanner-stub.mjs` must be updated by hand to
match; there is no build step that derives one from the other, and nothing currently proves they stay in sync
besides code review and re-running this same simulation.
