# Profile-attestation signing key: rotation and compromise runbook

Companion to [profile-attestation-production-checklist.md](profile-attestation-production-checklist.md), which covers
first-time provisioning. This covers replacing the key afterwards. Like that checklist, it contains no secret values and
must stay that way: a private key is never written to a file, a command line, a log, or a chat.

## Read this first: what the current setup can and cannot do

Production signs with a **single published key** (`keyId` pinned in `workers/api/wrangler.toml`). There is **no key set, no
retired/revoked status, and no key history** (design: `docs/attestation-profile-design.md` §7 and §10.2 describe that future
model; none of it exists yet). Rotating therefore has two consequences you must decide on *before* you start:

1. **Old assessments stop matching the published key.** A bundle signed by the old key still verifies cryptographically
   against its own embedded key, but the "pin to the published key" step (see the site's `/profile-attestation` page) fails
   once the published key is the new one. Nothing in the product says "this key was retired, not forged".
2. **Signing is briefly unavailable.** Replacing the secret changes the signing key immediately, while the pinned
   `PROFILE_ATTESTATION_EXPECTED_KEY_ID` changes only on the next deploy. In between, a signed request is refused with
   `503` (`key-identity-mismatch`). It fails closed: unsigned assessments are unaffected and nothing is signed under an
   unpublished key. Do the steps below back to back.

Because of (1), a planned rotation needs an owner's decision on how earlier assessments stay checkable (for example, publishing
the previous *public* key and its dates at a stable URL, linked from the signing key page). That is a statement about
trust, so have it reviewed against design §7 rather than improvised. Do not publish a "retired" or "revoked" status field
in the API response; the design says not to fake one before the real key-set publisher exists.

## Planned rotation

1. **Archive the current public identity.** Save the public values only (issuer, keyId, JWK, date range in use). Decide where
   the archive is published (see above).
2. **Generate the new P-256 key outside the repository** and provision it straight into the Worker secret, exactly as in the
   first-time checklist: generate and pipe in one command so the private value never appears anywhere.
   ```bash
   wrangler secret put PROFILE_ATTESTATION_SIGNING_PRIVATE_KEY_JWK --config workers/api/wrangler.toml
   ```
   From this moment signing is refused until step 4 completes (503, expected).
3. **Derive and verify the new identity.** `GET /v1/profile-attestation/public-key` now returns the new key. Recompute the
   RFC 7638 thumbprint of the returned JWK yourself (SHA-256 over the canonical `{"crv","kty","x","y"}` JSON, base64url) and
   confirm it equals the returned `keyId`.
4. **Change every copy of the identity together.** Three places, and a test fails if they disagree:
   - `workers/api/wrangler.toml` — `PROFILE_ATTESTATION_EXPECTED_KEY_ID`
   - `apps/web/src/data/profileAttestationKey.json`
   - `apps/web/public/profile-attestation-key.json`

   Run `node apps/web/test/siteContent.test.mjs` (it checks the thumbprint and the three-way agreement), then
   `wrangler deploy --config workers/api/wrangler.toml`. Signing resumes.
5. **Publish the site.** `npm run export --workspace=apps/web`, upload `out/agentverify`, then
   `npm run verify:deploy --workspace=apps/web`. Until the upload, the site still shows the old key while the API shows the
   new one; `verify:deploy` reports exactly that mismatch.
6. **Smoke test in production.** Run a signed assessment; confirm the `keyId` is the new one; verify the downloaded bundle
   with the frozen v4 verifier *and* against the freshly fetched published key (see `/profile-attestation`). Confirm a second
   signed run consumes one scan, not two.
7. **Commit** the three identity files and `wrangler.toml` as one change, and record the date.

There is no rollback to the old key: its private half is intentionally not kept. If the new key is wrong, rotate again.

## Suspected compromise

Treat as an incident, not a rotation.

1. **Stop signing now.** `wrangler secret delete PROFILE_ATTESTATION_SIGNING_PRIVATE_KEY_JWK --config workers/api/wrangler.toml`.
   Signed requests then fail with `503`, and the public-key route returns `404`. Unsigned assessments continue.
2. **Tell people which key not to trust.** The site page still lists the old key. Put a dated notice on `/profile-attestation`
   naming the compromised `keyId`. There is no revocation mechanism, so this notice is the only signal until key-set
   publication exists; say so plainly and do not present it as a revocation status.
3. Investigate how the key was exposed. Treat any bundle signed after the suspected exposure date as untrusted.
4. Provision a new key and follow steps 2–7 above, leaving the compromised key's notice in place.

## What must never happen

- The private JWK in a tracked file, a shell history, a log, a ticket, or a chat message.
- Changing `PROFILE_ATTESTATION_EXPECTED_KEY_ID` without verifying the new keyId yourself first. The pin exists so a wrong secret
  cannot silently sign under an identity nobody published.
- Reusing the legacy `ATTESTATION_SIGNING_PRIVATE_KEY_JWK_B64` key for this purpose. They are domain-separated on purpose.
