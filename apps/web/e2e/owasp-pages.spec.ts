import { test, expect } from '@playwright/test'

// The public OWASP Agentic Skills pages, against a real production build. Like public-pages.spec.ts these need no
// Firebase credentials. The authenticated request flow is out of scope here (see e2e/README.md).

test('sample assessment page shows all ten controls and never renders a not-assessed control as a pass', async ({ page }) => {
  await page.goto('owasp-agentic-skills/')
  await expect(page.getByRole('heading', { name: 'OWASP Agentic Skills Top 10', exact: true }).first()).toBeVisible()
  await expect(page.getByText('Only AST02, AST03 and AST04 are implemented in this profile version. Every other control is not assessed, which is not a pass.').first()).toBeVisible()
  await expect(page.getByText('Not an OWASP certification or endorsement.').first()).toBeVisible()
  for (let i = 1; i <= 10; i++) await expect(page.getByText(`AST${String(i).padStart(2, '0')}`, { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Not implemented in this profile version')).toHaveCount(7)
  await expect(page.getByText('Signed attestation: Not requested')).toBeVisible()
  await expect(page.getByText('Cryptographically signed')).toHaveCount(0)
})

test('sample assessment: a control expands to its checks and evidence, and technical details stay secondary', async ({ page }) => {
  await page.goto('owasp-agentic-skills/')
  await expect(page.getByText('1.0.0-alpha.1')).toHaveCount(0)
  await page.getByRole('button', { name: /AST03/ }).click()
  await expect(page.getByText(/Checks \(\d+ of \d+ checks assessed\)/)).toBeVisible()
  await page.getByRole('heading', { name: 'Profile & technical details' }).click()
  await expect(page.getByText('1.0.0-alpha.1')).toBeVisible()
  await expect(page.getByText('Agent Verify is released as v1.5.0')).toBeVisible()
})

test('signing key page publishes the key and the verification steps', async ({ page }) => {
  await page.goto('profile-attestation/')
  await expect(page.getByRole('heading', { name: 'Profile attestation signing key' })).toBeVisible()
  await expect(page.getByText('agentverify-profile-prod').first()).toBeVisible()
  await expect(page.getByText('eIO7_uhceQOQ0FDx5bGCODcYEUPkbSgAcuXczunT1QA').first()).toBeVisible()
  await expect(page.getByText('It does not independently prove that every finding is correct or complete.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'What this release does not provide' })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('"d":')
})

test('the machine-readable signing key file is served as JSON with no private member', async ({ request }) => {
  const res = await request.get('profile-attestation-key.json')
  expect(res.ok()).toBe(true)
  expect(res.headers()['content-type']).toMatch(/json/)
  const key = await res.json()
  expect(Object.keys(key.publicKey).sort()).toEqual(['crv', 'kty', 'x', 'y'])
  expect(key.purpose).toBe('agentverify-profile-v1')
})

test('landing page introduces the OWASP assessment and links to the sample and the signing key', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /Assess agent skills against the OWASP Agentic Skills Top 10/ })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View a sample assessment' })).toHaveAttribute('href', '/agentverify/owasp-agentic-skills/')
  await expect(page.getByRole('link', { name: 'How signing works' })).toHaveAttribute('href', '/agentverify/profile-attestation/')
})

test('docs cover the OWASP profile and the pricing page states how it is metered', async ({ page }) => {
  await page.goto('docs/')
  await expect(page.getByRole('heading', { name: 'OWASP Agentic Skills Profile', exact: true })).toBeVisible()
  await expect(page.getByText('agentverify scan ./my-skill --profile owasp-agentic-skills-2026').first()).toBeVisible()
  await page.goto('pricing/')
  await expect(page.getByText('uses one scan from the same monthly quota, whether or not you ask for a signature')).toBeVisible()
})
