// REFERENCE / TEST-ONLY (vector set v3). Not the product implementation. See conformance/v3/README.md.
//
// ONE SHARED LIMITS MODEL. Everything that bounds the size or depth of attested input is defined here, once, and imported by the
// strict parser, the canonicalizer and the verifier, so no two of them can disagree about whether a valid signed object is too
// large or too deep.
//
// DEPTH IS ABSOLUTE, MEASURED FROM THE BUNDLE ROOT. A container (object or array) has an absolute depth; the bundle object
// itself is at depth 1. A container is refused when its absolute depth is greater than MAX_JSON_DEPTH.
//
//   bundle object ........................ depth 1
//   bundle.attestation ................... depth 2
//   bundle.attestation.payload ........... depth 3   (canonicalized with baseDepth PAYLOAD_BASE_DEPTH = 2)
//   bundle.assessment .................... depth 2   (canonicalized with baseDepth ASSESSMENT_BASE_DEPTH = 1)
//
// The parser counts absolute depth from the bundle root. The canonicalizer (which sees only a sub-object) is given the depth of
// the sub-object's PARENT as `baseDepth`, so a sub-object that is digestible or signable is, by construction, also parseable
// inside its bundle, and one that would not parse inside its bundle is refused when it is digested or signed.

export const MAX_JSON_DEPTH = 64

/** True when a container at this ABSOLUTE depth is over the limit. The only depth comparison in the reference. */
export const exceedsDepth = absoluteDepth => absoluteDepth > MAX_JSON_DEPTH

export const BUNDLE_ROOT_DEPTH = 1
/** baseDepth for the assessment: its parent is the bundle root. */
export const ASSESSMENT_BASE_DEPTH = BUNDLE_ROOT_DEPTH
/** baseDepth for the payload: bundle root -> attestation -> payload. */
export const PAYLOAD_BASE_DEPTH = BUNDLE_ROOT_DEPTH + 1

/** Attested bundle input larger than this many BYTES is refused before it is decoded or parsed (16 MiB). */
export const MAX_BUNDLE_BYTES = 16 * 1024 * 1024
