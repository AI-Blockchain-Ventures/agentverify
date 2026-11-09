import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Baseline automated accessibility check (WCAG 2.0/2.1 A/AA rules via axe-core). This catches
// programmatically-detectable issues (missing labels, contrast, landmark structure) — it is
// not a substitute for manual keyboard/screen-reader testing, which this does not replace.
// Runs both themes: the app picks light/dark from prefers-color-scheme on first load (see
// apps/web/src/app/layout.tsx's inline theme script), so emulating colorScheme drives it.
const pages = ['./', 'pricing/', 'docs/', 'report/demo/', 'owasp-agentic-skills/', 'profile-attestation/', 'trust/', 'status/', 'checks/', 'checks/av-mcp-105/', 'state-of-mcp-security/', 'state-of-agent-security/', 'whats-new/', 'privacy/', 'terms/']
const themes = ['light', 'dark'] as const

for (const theme of themes) {
  for (const path of pages) {
    test(`accessibility baseline [${theme}]: ${path}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.goto(path)
      // Colour fades (the page background easing into dark mode) can still be mid-way when axe reads
      // colours, which reports dark-mode text on a white background. Turn transitions off and settle.
      await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' })
      await page.waitForTimeout(100)
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      if (results.violations.length > 0) {
        console.log(`\n[${theme}] ${path} violations:\n` + results.violations.map(v => `- [${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))`).join('\n'))
      }
      expect(results.violations, JSON.stringify(results.violations.map(v => v.id))).toEqual([])
    })
  }
}
