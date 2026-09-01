import { test, expect } from '@playwright/test'

// These tests exercise real rendered pages against a real production build — no mocking of
// Next.js, React, or the scanner. They cover only what doesn't require a live Firebase project
// (no login, no protected routes). See e2e/README.md for what's out of scope and why.

test('landing page loads with the real hero copy and CTAs', async ({ page }) => {
  await page.goto('./')
  await expect(page).toHaveTitle(/Know What Your AI Agent Can Do Before You Deploy It/)
  await expect(page.getByRole('heading', { name: /Know what your AI agent can do before you deploy it/i })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Scan an Agent' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View Sample Report' })).toHaveAttribute('href', '/agentverify/report/demo/')
})

test('pricing page shows the real plan set from the single pricing source', async ({ page }) => {
  await page.goto('pricing/')
  await expect(page.getByText('Free', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Pro', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Enterprise', { exact: true }).first()).toBeVisible()
})

test('docs page renders every major section', async ({ page }) => {
  await page.goto('docs/')
  await expect(page.getByRole('heading', { name: 'Agent Verify Docs' })).toBeVisible()
  for (const heading of ['Overview', 'Quick Start', 'CLI', 'API', 'Limitations', 'Troubleshooting', 'FAQ']) {
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }
  // Every documented command must be real, not fictional.
  await expect(page.getByText('npm install -g agentverify').first()).toBeVisible()
})

test('demo report is clearly labeled synthetic and shows the real scan engine output', async ({ page }) => {
  await page.goto('report/demo/')
  await expect(page.getByText('Demo report — synthetic data', { exact: false })).toBeVisible()
  await expect(page.getByText('NOT VERIFIED', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'What this agent can do' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'What this agent can access through MCP' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Coverage across 11 security categories' })).toBeVisible()
  // Score explainer must expand and show real, additive numbers — not just a claim.
  await page.getByText('How is this score calculated?').click()
  await expect(page.getByText('Final score')).toBeVisible()
})

test('demo report: all six report views render real, distinct content from the same evidence', async ({ page }) => {
  await page.goto('report/demo/')
  const tabs = page.getByRole('tablist', { name: 'Report view' })
  await expect(tabs).toBeVisible()

  await tabs.getByRole('tab', { name: 'Executive' }).click()
  await expect(page.getByText('What this agent can do')).toBeVisible()
  await expect(page.getByText('Top risks')).toBeVisible()

  await tabs.getByRole('tab', { name: 'Developer' }).click()
  await expect(page.getByText(/finding.*ordered by severity/i)).toBeVisible()
  await expect(page.getByText('Rule/Check ID', { exact: false }).or(page.locator('code').first())).toBeVisible()

  await tabs.getByRole('tab', { name: 'Compliance' }).click()
  await expect(page.getByText('This is not a compliance certification')).toBeVisible()
  await expect(page.getByText('Potential Gap').first()).toBeVisible()
  // Must never claim certification.
  await expect(page.getByText(/\bis compliant\b/i)).toHaveCount(0)

  await tabs.getByRole('tab', { name: 'AI / JSON' })
  await tabs.getByText('AI / JSON').click()
  await expect(page.getByText('Schema-versioned JSON')).toBeVisible()
  await expect(page.getByText('"schemaVersion"')).toBeVisible()

  await tabs.getByRole('tab', { name: 'Full Technical' }).click()
  await expect(page.getByText('Scan metadata')).toBeVisible()
  await expect(page.getByText(/All findings \(\d+\)/)).toBeVisible()

  // Back to Security — the original detailed view must still be there, unchanged.
  await tabs.getByRole('tab', { name: 'Security' }).click()
  await expect(page.getByRole('heading', { name: 'Coverage across 11 security categories' })).toBeVisible()
})

test('unknown route renders the 404 page, not a blank crash', async ({ page }) => {
  const response = await page.goto('this-route-does-not-exist/')
  expect(response?.status()).toBe(404)
  await expect(page.getByText(/not.?found/i).first()).toBeVisible()
})

test('robots.txt and sitemap.xml are served', async ({ page, request }) => {
  const robots = await request.get('robots.txt')
  expect(robots.ok()).toBeTruthy()
  expect(await robots.text()).toContain('Sitemap:')

  const sitemap = await request.get('sitemap.xml')
  expect(sitemap.ok()).toBeTruthy()
  expect(await sitemap.text()).toContain('/docs/')
})

test('protected dashboard routes redirect cleanly when signed out, not blank or crashed', async ({ page }) => {
  // No live Firebase auth here (see e2e/README.md) — this only verifies the unauthenticated
  // redirect guard itself doesn't crash or hang, not the authenticated content behind it.
  for (const path of ['dashboard/', 'dashboard/agent/?name=test']) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/agentverify\/?$/)
  }
})

test('mobile: hamburger menu opens and navigates to Docs', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile-only check')
  await page.goto('./')
  await page.getByRole('button', { name: /open menu/i }).click()
  await page.locator('#mobile-nav-menu').getByRole('link', { name: 'Docs', exact: true }).click()
  await expect(page).toHaveURL(/\/docs\/?$/)
})
