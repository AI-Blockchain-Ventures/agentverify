// Public demo: repeat scans of the same code reuse the saved result (no scanner time, no allowance used).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { demoCacheKey, readDemoCache, writeDemoCache, clearDemoMemoryCache, DEMO_SCANS_PER_HOUR } from '../dist/demoCache.mjs'

test('same input gives the same key; any change gives a different key', async () => {
  const a = await demoCacheKey('code', 'a.js', 'Public Demo')
  assert.equal(a, await demoCacheKey('code', 'a.js', 'Public Demo'))
  assert.notEqual(a, await demoCacheKey('code ', 'a.js', 'Public Demo'))
  assert.notEqual(a, await demoCacheKey('code', 'b.js', 'Public Demo'))
  assert.notEqual(a, await demoCacheKey('code', 'a.js', 'Agent Marketplace'))
  assert.match(a, /^[0-9a-f]{64}$/)
})

test('saved result is returned until it expires', async () => {
  clearDemoMemoryCache()
  const key = await demoCacheKey('x', 'y', 'z')
  assert.equal(await readDemoCache(key), null)
  await writeDemoCache(key, '{"verdict":"NOT_VERIFIED"}', 1_000)
  assert.equal(await readDemoCache(key, 2_000), '{"verdict":"NOT_VERIFIED"}')
  assert.equal(await readDemoCache(key, 1_000 + 7 * 60 * 60 * 1000), null)
})

test('demo allowance for new code is 20 per hour', () => {
  assert.equal(DEMO_SCANS_PER_HOUR, 20)
})

test('edge rate limiter: blocks when Cloudflare says so, and fails open if it is missing or broken', async () => {
  const { edgeRateLimited } = await import('../dist/rateLimit.mjs')
  assert.equal(await edgeRateLimited(undefined, 'demo:1'), false)
  assert.equal(await edgeRateLimited({ limit: async () => ({ success: true }) }, 'demo:1'), false)
  assert.equal(await edgeRateLimited({ limit: async () => ({ success: false }) }, 'demo:1'), true)
  assert.equal(await edgeRateLimited({ limit: async () => { throw new Error('down') } }, 'demo:1'), false)
})
