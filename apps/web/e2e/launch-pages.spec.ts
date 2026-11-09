import { test, expect } from '@playwright/test'

// 2.0 launch pages: check library, per-check help pages, State of MCP Security, What's new.

test('check library lists every check and filters by search, severity and "new in 2.0"', async ({ page }) => {
  await page.goto('checks/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('124 security checks')
  await expect(page.getByText('Showing 124 of 124 checks')).toBeVisible()
  await page.getByPlaceholder(/Search checks/).fill('tool poisoning')
  await expect(page.getByRole('link', { name: /Hidden instructions inside an MCP tool description/ })).toBeVisible()
  await page.getByPlaceholder(/Search checks/).fill('')
  await page.getByLabel('New in 2.0').check()
  await expect(page.getByText('Showing 48 of 124 checks')).toBeVisible()
  await page.getByPlaceholder(/Search checks/).fill('zzzz-no-such-check')
  await expect(page.getByText('No checks match')).toBeVisible()
})

test('a check help page explains the risk and the fix, without the Pro code snippet', async ({ page }) => {
  await page.goto('checks/av-mcp-105/')
  await expect(page).toHaveTitle(/Hidden instructions inside an MCP tool description \(AV-MCP-105\)/)
  for (const h of ['What it finds', 'Why it matters', 'How to fix it', 'Check details']) await expect(page.getByRole('heading', { name: h })).toBeVisible()
  await expect(page.getByText('What an attacker could do:')).toBeVisible()
  await expect(page.getByText('New in 2.0', { exact: true })).toBeVisible()
  // The Pro-only quick-fix snippet for this check is never published.
  await expect(page.locator('body')).not.toContainText("server.tool('add', 'Adds two numbers")
  await page.getByRole('link', { name: 'Check library' }).first().click()
  await expect(page).toHaveURL(/\/checks\/$/)
})

test('State of MCP Security report shows computed numbers and links to servers', async ({ page }) => {
  await page.goto('state-of-mcp-security/')
  await expect(page.getByRole('heading', { level: 1, name: 'The State of MCP Security' })).toBeVisible()
  await expect(page.getByText('MCP servers scanned')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'What MCP servers can do' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Method' })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test("What's new page is linked from the homepage announcement", async ({ page }) => {
  await page.goto('./')
  await page.getByRole('link', { name: /Agent Verify 2\.0 · 124 checks/ }).click()
  await expect(page).toHaveURL(/\/whats-new\/$/)
  await expect(page.getByRole('heading', { level: 1, name: "What's new in 2.0" })).toBeVisible()
})

test('new homepage examples load into the free scan box', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator('#public-scan-run')).toBeEnabled()
  await page.getByRole('button', { name: 'Poisoned MCP tool' }).click()
  await expect(page.locator('#public-scan-input')).toHaveValue(/<IMPORTANT>/)
  await page.getByRole('button', { name: 'AI agent in CI' }).click()
  await expect(page.locator('#public-scan-input')).toHaveValue(/pull_request_target/)
})

test('every public page has exactly one site header and one site footer', async ({ page }) => {
  for (const path of ['./', 'pricing/', 'developers/', 'docs/', 'mcp/', 'checks/', 'state-of-mcp-security/', 'state-of-agent-security/', 'whats-new/', 'trust/', 'report/demo/', 'agentspoofed/', 'owasp-agentic-skills/', 'privacy/', 'terms/']) {
    await page.goto(path)
    await expect(page.locator('footer:has(a[aria-label="Agent Verify home"])'), `${path} site footers`).toHaveCount(1)
    await expect(page.locator('header a[aria-label="Agent Verify home"]'), `${path} site headers`).toHaveCount(1)
  }
})

test('no page scrolls sideways (phones included)', async ({ page }) => {
  for (const path of ['./', 'pricing/', 'developers/', 'docs/', 'mcp/', 'checks/', 'checks/av-mcp-105/', 'mcp/playwright-mcp/', 'state-of-mcp-security/', 'state-of-agent-security/', 'whats-new/', 'trust/', 'report/demo/', 'agentspoofed/', 'privacy/', 'terms/']) {
    await page.goto(path)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${path} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1)
  }
})

test('MCP server pages offer maintainers a neutral README badge', async ({ page }) => {
  await page.goto('mcp/playwright-mcp/')
  await page.getByRole('link', { name: 'Get a README badge or ask for a re-scan' }).click()
  await expect(page.locator('#maintainers')).toBeInViewport()
  await expect(page.locator('#maintainers').getByText('MCP safety: reviewed by Agent Verify').first()).toBeVisible()
})
