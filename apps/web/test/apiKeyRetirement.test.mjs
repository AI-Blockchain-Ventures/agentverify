// The dashboard's "your key was retired" check must agree with the API's cutoff (2026-11-24 key retirement).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(__dirname, '..', 'src', 'lib', 'apiKeyRetirement.ts'), 'utf8')
const { code } = transformSync(source, { loader: 'ts', format: 'esm', target: 'node20' })
const { API_KEYS_ISSUED_AFTER, isRetiredApiKey } = await import('data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64'))

const toml = readFileSync(path.join(__dirname, '..', '..', '..', 'workers', 'api', 'wrangler.toml'), 'utf8')
const apiCutoff = toml.match(/API_KEYS_ISSUED_AFTER = "([^"]+)"/)?.[1]
assert.equal(API_KEYS_ISSUED_AFTER, apiCutoff, 'the dashboard and the API must retire keys at the same moment')

assert.equal(isRetiredApiKey('2026-11-20T10:00:00.000Z'), true, 'a key made before the fix is retired')
assert.equal(isRetiredApiKey('2026-11-24T18:16:59.000Z'), true)
assert.equal(isRetiredApiKey('2026-11-24T18:17:00.000Z'), false)
assert.equal(isRetiredApiKey('2026-11-25T09:00:00.000Z'), false, 'a key made after the fix is fine')
assert.equal(isRetiredApiKey(undefined), true, 'no creation time counts as retired (same as the API)')
assert.equal(isRetiredApiKey(12345), true, 'a non-string creation time counts as retired (same as the API)')
assert.equal(isRetiredApiKey('2026-11-20T10:00:00.000Z', 'garbage'), false, 'a broken cutoff never locks anyone out')

console.log('apiKeyRetirement: all assertions passed')
