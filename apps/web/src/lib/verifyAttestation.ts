/**
 * Independent, client-side attestation verification — deliberately NOT imported from
 * @agentverify/scanner, even though packages/scanner/src/attestation.ts's own verifyAttestation
 * is source-level self-contained (only imports a pure canonicalization helper, nothing from the
 * detection engine).
 *
 * WHY THIS IS DUPLICATED RATHER THAN IMPORTED: packages/scanner builds via a single tsup entry
 * point (`tsup src/index.ts`) that bundles its whole barrel — engine.ts, secrets.ts (the real
 * credential-detection regex table), mcp.ts (the MCP tool classifier table), catalog.ts — into
 * ONE compiled dist/index.js. Importing ANYTHING from '@agentverify/scanner' in a browser
 * component, even a single type-safe value like verifyAttestation, pulls that entire compiled
 * file into the client bundle; webpack cannot tree-shake within one pre-bundled file the way it
 * can across separate ES modules. This was confirmed empirically: building the app and grepping
 * the output chunks for secret-pattern label strings and MCP regex fragments found them present
 * merely from importing verifyAttestation, before this file existed.
 *
 * Signature verification is legitimately meant to run client-side against a PUBLISHED PUBLIC key
 * (that's the entire point of asymmetric verification — no secret is needed, and a truly
 * independent verifier arguably shouldn't even depend on Agent Verify's own package). So rather
 * than solve the packaging problem (giving the scanner package a second, minimal build entry —
 * a real fix, but a build-tooling change to the proprietary package, not undertaken here),
 * this file re-implements the same verification faithfully and independently. Logic is mirrored
 * from packages/scanner/src/attestation.ts + reportIntegrity.ts's canonicalizeForHash — if that
 * canonicalization ever changes, this file must be updated to match, or verification will
 * (safely) start reporting MALFORMED/INVALID_SIGNATURE rather than silently diverging.
 */

export type AttestationVerificationStatus = 'VALID' | 'INVALID_SIGNATURE' | 'MALFORMED' | 'UNSUPPORTED_VERSION'

export interface AttestationVerificationResult {
  status: AttestationVerificationStatus
  reason?: string
}

export interface AttestationPayload {
  attestationVersion: string
  artifactHash: string
  artifactHashAlgorithm: string
  artifactFingerprintVersion: string
  scanId: string
  reportHash: string
  verdict: string
  score: number
  policyProfile?: string
  policyResult?: 'PASS' | 'FAIL'
  scannerVersion: string
  rulesetVersion: string
  schemaVersion: string
  issuedAt: string
  issuer: string
}

export interface SignedAttestation {
  payload: AttestationPayload
  signature: string
  algorithm: 'ECDSA-P256-SHA256'
  publicKey: JsonWebKey
}

const ATTESTATION_VERSION = '1.0.0'

type CanonicalValue = string | number | boolean | null | CanonicalValue[] | { [key: string]: CanonicalValue }

function canonicalizeForHash(value: unknown): CanonicalValue {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value.map(canonicalizeForHash)
  if (typeof value === 'object') {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort()
    const out: { [key: string]: CanonicalValue } = {}
    for (const key of sortedKeys) out[key] = canonicalizeForHash((value as Record<string, unknown>)[key])
    return out
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return String(value)
}

function canonicalAttestationJson(payload: AttestationPayload): string {
  return JSON.stringify(canonicalizeForHash(payload as unknown as Record<string, unknown>))
}

const REQUIRED_PAYLOAD_FIELDS: (keyof AttestationPayload)[] = [
  'attestationVersion', 'artifactHash', 'artifactHashAlgorithm', 'artifactFingerprintVersion',
  'scanId', 'reportHash', 'verdict', 'score', 'scannerVersion', 'rulesetVersion', 'schemaVersion',
  'issuedAt', 'issuer',
]

function isWellFormed(signed: unknown): signed is SignedAttestation {
  if (typeof signed !== 'object' || signed === null) return false
  const s = signed as Record<string, unknown>
  if (typeof s.signature !== 'string' || s.signature.length === 0) return false
  if (s.algorithm !== 'ECDSA-P256-SHA256') return false
  if (typeof s.publicKey !== 'object' || s.publicKey === null) return false
  if (typeof s.payload !== 'object' || s.payload === null) return false
  const payload = s.payload as Record<string, unknown>
  return REQUIRED_PAYLOAD_FIELDS.every(field => payload[field] !== undefined && payload[field] !== null)
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function verifyAttestation(signed: unknown, expectedPublicKey?: JsonWebKey): Promise<AttestationVerificationResult> {
  if (!isWellFormed(signed)) {
    return { status: 'MALFORMED', reason: 'Attestation is missing required fields or has an unrecognized shape.' }
  }

  if (signed.payload.attestationVersion !== ATTESTATION_VERSION) {
    return { status: 'UNSUPPORTED_VERSION', reason: `This verifier supports attestationVersion ${ATTESTATION_VERSION}, got ${signed.payload.attestationVersion}.` }
  }

  if (expectedPublicKey && JSON.stringify(canonicalizeForHash(expectedPublicKey as unknown as Record<string, unknown>)) !== JSON.stringify(canonicalizeForHash(signed.publicKey as unknown as Record<string, unknown>))) {
    return { status: 'INVALID_SIGNATURE', reason: 'The embedded public key does not match the expected Agent Verify signing key.' }
  }

  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      signed.publicKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    )
    const signatureBytes = base64ToBytes(signed.signature)
    const dataBytes = new TextEncoder().encode(canonicalAttestationJson(signed.payload))
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signatureBytes as BufferSource,
      dataBytes as BufferSource
    )
    return valid ? { status: 'VALID' } : { status: 'INVALID_SIGNATURE', reason: 'Signature does not match the payload under the embedded public key.' }
  } catch {
    return { status: 'MALFORMED', reason: 'Public key or signature could not be parsed.' }
  }
}
