#!/usr/bin/env node
// NOT part of the frozen v4 tree. Runs v4's suite with only the historical 'THE SIGNING GATE' tripwire
// separated out (asserted to fail, not silently skipped), then the post-authorization implementation gate
// that replaces it. See postAuthorizationRunner.mjs and CHANGELOG.md in this directory for the full account.

import { runPostAuthorization } from './postAuthorizationRunner.mjs'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.join(here, '..', '..')

const semanticOk = await runPostAuthorization('v4')

function runNodeTest(files) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap', '--test-reporter-destination=stdout', ...files], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    child.on('close', code => resolve({ code, out }))
  })
}

const gateFiles = readdirSync(here).filter(f => f.endsWith('.test.mjs')).map(f => path.join(here, f))
const gate = await runNodeTest(gateFiles)
console.log(gate.code === 0 ? 'post-authorization implementation gate: PASS' : 'post-authorization implementation gate: FAIL')
if (gate.code !== 0) console.log(gate.out)

if (!(semanticOk && gate.code === 0)) process.exitCode = 1
