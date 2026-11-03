import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The public Live Demo (/agentspoofed) without an account. The scan API is faked here so the
// tests are fast, never hit the real per-network demo limit, and can force each failure mode.
// The success body is a real response captured from POST /v1/demo/scan.
const SCAN_URL = '**/v1/demo/scan'
const scanFixture = readFileSync(join(__dirname, 'fixtures', 'live-demo-scan.json'), 'utf8')

async function openDemo(page: Page) {
  await page.goto('agentspoofed/')
  const button = page.getByTestId('run-live-scan')
  // Enabled only once the page's JavaScript is running, so the click can't be lost.
  await expect(button).toBeEnabled()
  await expect(button).toHaveText('Run live scan')
  return button
}

test('live demo: Run live scan calls the API and shows the report', async ({ page }) => {
  let calls = 0
  await page.route(SCAN_URL, async route => {
    calls++
    expect(route.request().method()).toBe('POST')
    expect(route.request().postDataJSON()).toMatchObject({ fileName: 'agent-marketplace.js' })
    await route.fulfill({ status: 200, contentType: 'application/json', body: scanFixture })
  })
  const button = await openDemo(page)
  await button.click()
  await expect(page.getByRole('status').filter({ hasText: 'Scanner returned NOT_VERIFIED with 7 findings' })).toBeVisible()
  await expect(page.getByText('NOT VERIFIED', { exact: true }).first()).toBeVisible()
  await expect(button).toHaveText('Run again')
  expect(calls).toBe(1)
})

test('live demo: hitting the demo limit shows a clear message and a way forward', async ({ page }) => {
  await page.route(SCAN_URL, route => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'Too many public demo scans from this network.' }) }))
  const button = await openDemo(page)
  await button.click()
  const alert = page.getByTestId('live-scan-error')
  await expect(alert).toBeVisible()
  await expect(alert).toContainText('free demo limit')
  await expect(alert.getByRole('link', { name: 'Open sample report' })).toHaveAttribute('href', '/agentverify/report/demo/')
  await expect(alert.getByRole('link', { name: 'Create free account' })).toBeVisible()
})

test('live demo: a server error shows a message and Try again works', async ({ page }) => {
  let calls = 0
  await page.route(SCAN_URL, async route => {
    calls++
    if (calls === 1) await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    else await route.fulfill({ status: 200, contentType: 'application/json', body: scanFixture })
  })
  const button = await openDemo(page)
  await button.click()
  const alert = page.getByTestId('live-scan-error')
  await expect(alert).toContainText('temporarily unavailable')
  await alert.getByRole('button', { name: 'Try again' }).click()
  await expect(alert).toBeHidden()
  await expect(page.getByText('NOT VERIFIED', { exact: true }).first()).toBeVisible()
})

test('live demo: no connection shows a message instead of doing nothing', async ({ page }) => {
  await page.route(SCAN_URL, route => route.abort('failed'))
  const button = await openDemo(page)
  await button.click()
  await expect(page.getByTestId('live-scan-error')).toContainText('Could not reach the scanner')
  await expect(button).toBeEnabled()
})

test('live demo: page fits the screen width (no sideways scrolling)', async ({ page }) => {
  await page.route(SCAN_URL, route => route.fulfill({ status: 200, contentType: 'application/json', body: scanFixture }))
  const button = await openDemo(page)
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(await overflow()).toBeLessThanOrEqual(1)
  await button.click()
  await expect(page.getByText('NOT VERIFIED', { exact: true }).first()).toBeVisible()
  expect(await overflow()).toBeLessThanOrEqual(1)
})

test('homepage free scan: hitting the demo limit shows a clear message under the button', async ({ page }) => {
  await page.route(SCAN_URL, route => route.fulfill({ status: 429, contentType: 'application/json', body: '{}' }))
  await page.goto('./')
  const run = page.locator('#public-scan-run')
  await expect(run).toBeEnabled()
  await run.click()
  await expect(page.getByTestId('public-scan-error')).toContainText('free demo limit')
})

test('live demo: the cookie banner never covers the Run button (phones included)', async ({ page }) => {
  const button = await openDemo(page)
  await expect(page.getByRole('region', { name: 'Cookie choice' })).toBeVisible()
  await button.scrollIntoViewIfNeeded()
  const covered = await button.evaluate(el => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return !(hit && (hit === el || el.contains(hit)))
  })
  expect(covered).toBe(false)
})
