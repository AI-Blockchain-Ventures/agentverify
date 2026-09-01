#!/usr/bin/env node
// Generates a LOCAL-DEVELOPMENT-ONLY ECDSA P-256 key pair for signing attestations in the local
// review environment. This key is never production material, is written only to files already
// covered by .gitignore, and must never be reused once a real production key exists.
//
// Usage: node workers/api/scripts/generate-dev-signing-key.mjs
// Then paste the printed lines into workers/api/.dev.vars (gitignored — see workers/api/.dev.vars.example).

import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const devVarsPath = path.join(__dirname, '..', '.dev.vars')

async function main() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  // DEV ONLY — never a production signing key. Regenerate any time; nothing depends on this
  // specific key surviving between local sessions.
  privateJwk.key_ops = ['sign']

  // Base64-encoded — sidesteps any ambiguity in how a given dotenv-style parser handles quotes/
  // escaping around embedded double quotes (wrangler's .dev.vars loader is not guaranteed to
  // match Node's `dotenv` package unescaping behavior). Decoded with atob() wherever it's read.
  const line1 = `ATTESTATION_SIGNING_PRIVATE_KEY_JWK_B64=${Buffer.from(JSON.stringify(privateJwk)).toString('base64')}`
  const line2 = `ATTESTATION_ISSUER=agentverify-dev`

  console.log('\n=== DEV-ONLY Agent Verify attestation signing key generated ===')
  console.log('This key is for LOCAL DEVELOPMENT ONLY. Never use it in production.\n')

  if (existsSync(devVarsPath)) {
    const existing = readFileSync(devVarsPath, 'utf8')
    if (existing.includes('ATTESTATION_SIGNING_PRIVATE_KEY_JWK')) {
      console.log(`workers/api/.dev.vars already has a signing key. Not overwriting.`)
      console.log('Delete the ATTESTATION_SIGNING_PRIVATE_KEY_JWK / ATTESTATION_ISSUER lines from it first if you want to regenerate.\n')
      return
    }
    writeFileSync(devVarsPath, `${existing.trimEnd()}\n${line1}\n${line2}\n`)
  } else {
    writeFileSync(devVarsPath, `${line1}\n${line2}\n`)
  }
  console.log(`Written to ${devVarsPath} (gitignored, local only).`)
  console.log('Restart the API worker (or npm run review) to pick it up.\n')
}

main()
