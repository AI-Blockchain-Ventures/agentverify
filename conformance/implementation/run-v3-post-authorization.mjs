#!/usr/bin/env node
// NOT part of the frozen v3 tree. v3 carries a byte-identical copy of the same historical 'THE SIGNING GATE'
// tripwire that v4 does (v4 is a narrow correction pass over v3 and did not touch that test); the fourth
// review's gate-lift applies to both. This runs v3's suite the same way run-v4-post-authorization.mjs runs
// v4's: everything except that one test (asserted to genuinely fail when isolated, never silently skipped).
// v3 has no implementation-gate step of its own -- conformance/implementation/postAuthorizationGate.test.mjs
// already covers both sets' product-path implications and is run as part of the v4 script.
// See postAuthorizationRunner.mjs and CHANGELOG.md in this directory for the full account.

import { runPostAuthorization } from './postAuthorizationRunner.mjs'

const ok = await runPostAuthorization('v3')
if (!ok) process.exitCode = 1
