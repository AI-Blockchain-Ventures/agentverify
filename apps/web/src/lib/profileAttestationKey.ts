import identity from '@/data/profileAttestationKey.json'

/**
 * Agent Verify's published profile-attestation signing key (public half only), for the site pages. It is a trust
 * anchor a verifier can check INDEPENDENTLY of the API route and of any signed bundle's own embedded key.
 * `GET /v1/profile-attestation/public-key` must return exactly these values, and `public/profile-attestation-key.json`
 * must contain exactly these values; apps/web/test/siteContent.test.mjs enforces both, that `keyId` is the RFC 7638
 * thumbprint of `publicKey`, and that the Worker pins the same keyId.
 *
 * Kept in a JSON data file (not spelled in TypeScript) because the post-authorization gate allows only the intended
 * signing modules to spell the profile-attestation domain constants in code. Contains no private material. On a key
 * change, both JSON copies and wrangler.toml's PROFILE_ATTESTATION_EXPECTED_KEY_ID must change together.
 */
export const PROFILE_ATTESTATION_PUBLIC_IDENTITY = identity

export const PROFILE_ATTESTATION_KEY_FILE = '/profile-attestation-key.json'
export const PROFILE_ATTESTATION_KEY_API_ROUTE = '/v1/profile-attestation/public-key'
