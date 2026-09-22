// Shared logic behind run-v3-post-authorization.mjs and run-v4-post-authorization.mjs. NOT part of either
// frozen tree. See CHANGELOG.md in this directory for the full account of why this exists.
//
// v3 and v4 both carry a BYTE-IDENTICAL copy of the same historical review-gate tripwire test
// ('THE SIGNING GATE: no signing or private-key handling exists in the reference or in any product path', in
// each set's own test/docs.test.mjs) -- v4 is "a narrow correction pass" over v3 (per v4/README.md) and did
// not touch that test, so the fourth review's gate-lift applies identically to both frozen copies. Running
// `npm run test:conformance:v3` or `:v4` directly now fails on exactly that one test, in each set, for the
// same reason: it asserts no implementation exists, which stopped being true on purpose. This module runs
// EITHER set's suite the same way: everything except that one test (asserted to genuinely fail when isolated,
// never silently skipped).

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.join(here, '..', '..')

const TRIPWIRE_TEST_NAME = 'THE SIGNING GATE: no signing or private-key handling exists in the reference or in any product path'
const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function readTestNames(file) {
  const src = readFileSync(file, 'utf8')
  const names = []
  const re = /(?:^|\n)test\(\s*(['"`])/g
  let m
  while ((m = re.exec(src))) {
    const quote = m[1]
    let i = m.index + m[0].length
    let name = ''
    while (i < src.length && src[i] !== quote) {
      if (src[i] === '\\') { name += src[i + 1]; i += 2 } else { name += src[i]; i += 1 }
    }
    names.push(name)
  }
  return names
}

// --test-reporter=tap: see run-v4-post-authorization.mjs's original note -- the default "spec" reporter's
// Unicode-icon summary lines are not a documented, version-stable contract; TAP's `# tests`/`# pass`/`# fail` is.
function runNodeTest(files, patternArgs = []) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap', '--test-reporter-destination=stdout', ...patternArgs, ...files], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    child.on('close', code => resolve({ code, out }))
  })
}
const summaryOf = out => {
  const grab = re => Number(out.match(re)?.[1] ?? -1)
  return { tests: grab(/# tests (\d+)/), pass: grab(/# pass (\d+)/), fail: grab(/# fail (\d+)/) }
}

const TEST_FILE_NAMES = ['jcs', 'limits', 'timestamp', 'policy', 'assessment', 'profileAttestation', 'legacyAttestation', 'vectorHygiene', 'domains']

/** Runs `version`'s (e.g. 'v3' or 'v4') post-authorization suite. Returns true iff everything expected passed. */
export async function runPostAuthorization(version) {
  const testDir = path.join(repo, 'conformance', version, 'test')
  const docsFile = path.join(testDir, 'docs.test.mjs')
  const otherFiles = TEST_FILE_NAMES.map(n => path.join(testDir, `${n}.test.mjs`))

  const docsTestNames = readTestNames(docsFile)
  if (!docsTestNames.includes(TRIPWIRE_TEST_NAME)) {
    console.error(`FATAL: could not locate the exact tripwire test name in conformance/${version}/test/docs.test.mjs. Refusing to proceed.`)
    return false
  }
  const otherDocsTestNames = docsTestNames.filter(n => n !== TRIPWIRE_TEST_NAME)
  const EXCLUDE_TRIPWIRE_PATTERN = otherDocsTestNames.map(n => `^${escapeRegExp(n)}$`).join('|')
  const ONLY_TRIPWIRE_PATTERN = `^${escapeRegExp(TRIPWIRE_TEST_NAME)}$`

  const semanticOther = await runNodeTest(otherFiles)
  const semanticDocs = await runNodeTest([docsFile], ['--test-name-pattern', EXCLUDE_TRIPWIRE_PATTERN])
  const docsSummary = summaryOf(semanticDocs.out)
  const docsFilteredCorrectly = docsSummary.tests === otherDocsTestNames.length && docsSummary.fail === 0
  const semanticOk = semanticOther.code === 0 && semanticDocs.code === 0 && docsFilteredCorrectly
  console.log(semanticOk
    ? `${version} semantic/reference/vector conformance: PASS`
    : `${version} semantic/reference/vector conformance: FAIL`)
  if (!semanticOk) {
    if (!docsFilteredCorrectly) console.log(`  docs.test.mjs filtering ran ${docsSummary.tests} test(s), expected exactly ${otherDocsTestNames.length} (the tripwire excluded); fail=${docsSummary.fail}`)
    console.log(semanticOther.out)
    console.log(semanticDocs.out)
  }

  const tripwire = await runNodeTest([docsFile], ['--test-name-pattern', ONLY_TRIPWIRE_PATTERN])
  const tripwireSummary = summaryOf(tripwire.out)
  const tripwireIsolatedCorrectly = tripwireSummary.tests === 1
  let tripwireOk
  if (!tripwireIsolatedCorrectly) {
    console.log(`${version} historical review-gate tripwire: COULD NOT ISOLATE THE NAMED TEST (ran ${tripwireSummary.tests}, expected 1 — treat as a failure of this script, not of ${version})`)
    console.log(tripwire.out)
    tripwireOk = false
  } else if (tripwire.code !== 0) {
    console.log(`${version} historical review-gate tripwire: EXPECTEDLY INAPPLICABLE POST-AUTHORIZATION (fails, as designed — see CHANGELOG.md)`)
    tripwireOk = true
  } else {
    console.log(`${version} historical review-gate tripwire: UNEXPECTEDLY PASSING (implementation appears absent from product paths again — investigate before trusting this run)`)
    tripwireOk = false
  }

  return semanticOk && tripwireOk
}
