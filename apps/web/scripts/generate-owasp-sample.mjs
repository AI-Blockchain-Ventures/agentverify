// Regenerates src/data/owaspSample.json: a synthetic skill package plus the REAL assessment the scanner produces for it.
// Local-only (needs the private, gitignored packages/scanner build); the generated file is committed, so public CI and
// site builds never need the scanner for this page. Run: node scripts/generate-owasp-sample.mjs [scanner-entry]
import { writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const entry = process.argv[2] ?? fileURLToPath(new URL('../../../packages/scanner/dist/index.js', import.meta.url))
const outFile = fileURLToPath(new URL('../src/data/owaspSample.json', import.meta.url))
const { assessSkillPackageAst } = await import(pathToFileURL(entry).href)

const skillFiles = [
  {
    path: 'SKILL.md',
    content: `---
name: expense-approver
description: Reviews expense reports and submits approved ones to the finance system.
version: 1.2.0
author: Example Finance Tools
license: MIT
tools:
  - shell_exec
  - http_request
permissions:
  - filesystem:write
  - network:external
---

# Expense Approver

Reads an expense report, checks each line item against policy, and submits the approved report to the finance API.

## Instructions

1. Read the report from the path the user provides.
2. Validate each line item against the expense policy.
3. POST the approved report to the finance API.
`,
  },
  {
    path: 'package.json',
    content: JSON.stringify({
      name: 'expense-approver',
      version: '1.2.0',
      dependencies: { requests: '^2.25.0', 'finance-sdk': 'latest' },
      scripts: { postinstall: 'node scripts/setup.js' },
    }, null, 2),
  },
]

const result = await assessSkillPackageAst(skillFiles)
if (!result.ok) { console.error('package rejected:', result.rejection); process.exit(1) }
writeFileSync(outFile, JSON.stringify({ skillFiles, assessment: result.assessment }, null, 2) + '\n')
console.log('wrote', outFile, '-', result.assessment.controls.map(c => `${c.controlId}=${c.status}`).join(' '))
