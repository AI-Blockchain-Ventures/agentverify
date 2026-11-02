#!/usr/bin/env node
/**
 * Builds src/data/checkLibrary.json — the data behind the public check library (/checks and
 * /checks/<id>): one help page per scanner check.
 *
 * Runs locally (needs the private scanner); the committed JSON is what the static site renders,
 * so public CI (which only has the scanner stub) still builds every page.
 *
 * Publishes only what is already public through GET /v1/checks/catalog — what a check finds, why
 * it matters, and the general fix — plus the attacker-impact line and compliance mapping. The
 * Pro-only code snippet (quickFix) and the detection patterns are never written here.
 *
 *   node scripts/build-check-library.mjs
 */
import { writeFileSync } from 'node:fs'
import { VERIFICATION_CATALOG, ADVANCED_CHECKS, SCANNER_VERSION } from '@agentverify/scanner'

const OUT = new URL('../src/data/checkLibrary.json', import.meta.url)
// Tiny code -> page map for report finding cards (so they don't ship the whole library).
const SLUGS_OUT = new URL('../src/data/checkSlugs.json', import.meta.url)

if (!VERIFICATION_CATALOG.length) {
  console.error('The scanner catalog is empty (public CI stub?). Run this with the private scanner installed.')
  process.exit(1)
}

const extra = new Map(ADVANCED_CHECKS.map(d => [d.code, d]))

const checks = VERIFICATION_CATALOG.map(c => {
  const def = extra.get(c.code)
  return {
    id: c.id,
    slug: c.id.toLowerCase(),
    code: c.code,
    name: c.name,
    category: c.category,
    severity: c.severity,
    pack: c.pack ?? 'core',
    addedIn: c.addedIn ?? '1.5.0',
    family: Boolean(c.isFamily),
    detectionType: c.detectionType,
    evidenceType: c.evidenceType,
    supportedContent: c.supportedContent,
    whatItDetects: c.whatItDetects,
    whyItMatters: c.whyItMatters,
    remediation: c.remediation,
    ...(def?.capabilityImpact ? { impact: def.capabilityImpact } : {}),
    ...(def?.compliance ? { compliance: def.compliance } : {}),
  }
})

const data = { generatedAt: new Date().toISOString(), scannerVersion: SCANNER_VERSION, total: checks.length, checks }
writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n')
const slugs = {
  exact: Object.fromEntries(checks.filter(c => !c.family).map(c => [c.code, c.slug])),
  families: checks.filter(c => c.family).map(c => [c.code, c.slug]),
}
writeFileSync(SLUGS_OUT, JSON.stringify(slugs) + '\n')
console.log(`checkLibrary.json: ${checks.length} checks (scanner ${SCANNER_VERSION})`)
