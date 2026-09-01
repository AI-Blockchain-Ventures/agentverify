import type { ArtifactFingerprint, Finding, ScanInput, ScanResult, SignedAttestation } from '@agentverify/scanner'
import { computeArtifactFingerprint, computeReportHash, buildAttestationPayload, findPolicyById, evaluatePolicy, VERIFICATION_CATALOG, catalogSummary, RISK_TAXONOMY } from '@agentverify/scanner'
import { checkScanQuota, handleCheckout, handlePortal, handleStatus, handleWebhook, recordMonthlyUsage, type BillingEnv } from './billing'
import { createScanResult } from './scanResponse'
import { signAttestation, getAttestationPublicKeyInfo, type AttestationSigningEnv } from './attestationSigning'
import { lookupVerificationStatus } from './verificationStatus'
import { firestoreBaseUrl, firestoreAdminAuthHeader, apiKeyQueryParam, type FirebaseServiceAccountEnv } from './firebaseAuth'
import { createOrganization, getMembership, listMembers, listMyOrganizations, requirePermission, resolveUidByEmail, removeMember, upsertMember, type OrganizationsEnv } from './organizations'
import { isValidRole } from './rbac'
import { recordAuditEvent, listAuditEvents, type AuditLogEnv } from './auditLog'
import { createWebhook, listWebhooks, setWebhookStatus, type WebhooksEnv } from './webhooks'
import { authenticateRequest, authorize, type AuthzEnv } from './authz'
import { isRateLimited, clientIp } from './rateLimit'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, User-Agent',
    },
  })

interface ApiKeyValidation {
  uid: string
}

const unauthorized = () => json({ error: 'Invalid or unauthorized Agent Verify API key' }, 401)
const MAX_SCAN_CONTENT_LENGTH = 5 * 1024 * 1024 // 5MB — matches the CLI/web scan-upload limit

// API-key resolution for /v1/scan now goes through authz.ts's authenticateRequest (shared with
// every org/audit/webhook route) instead of a locally hand-rolled check — see the dual-auth
// comment at the /v1/scan handler below. The old single-purpose validateApiKey/extractApiKey
// pair (API-key-only, no Firebase-token path) is gone; authz.ts's resolveApiKey does the same
// apiKeyIndex lookup.

interface ScanEnrichment {
  artifactFingerprint: ArtifactFingerprint
  reportHash: string | null
  attestation: SignedAttestation | null
  policyProfile: string | null
  policyResult: string | null
}

async function saveReportToFirebase(
  auth: ApiKeyValidation,
  result: ScanResult,
  fileName: string,
  env: WorkerEnv,
  enrichment: ScanEnrichment,
  source: 'cli' | 'dashboard' | 'api' = 'cli'
): Promise<string | null> {
  try {
    const headers = await firestoreAdminAuthHeader(env)
    if (!headers) return null
    const uid = auth.uid
    const reportId = result.reportId
    const reportUrl = `${firestoreBaseUrl(env)}/cliReports/${encodeURIComponent(reportId)}`

    // Evidence is safe to store here: the scanner redacts any live secret value before it
    // ever leaves scan() (see packages/scanner/src/engine.ts), so this applies uniformly
    // regardless of caller. Nested structures (capabilities, MCP exposures, category
    // breakdown) are stored as JSON strings, matching the existing reportInsights/
    // threatCategories pattern, rather than hand-built nested Firestore value trees.
    const firestoreFindings = (result.findings ?? []).map((f: Finding) => ({
      mapValue: {
        fields: {
          title: { stringValue: f.title ?? '' },
          code: { stringValue: f.code ?? '' },
          category: { stringValue: f.category ?? 'B' },
          severity: { stringValue: f.severity ?? 'medium' },
          whatIsWrong: { stringValue: f.whatIsWrong ?? '' },
          whyItMatters: { stringValue: f.whyItMatters ?? '' },
          recommendedFix: { stringValue: f.recommendedFix ?? '' },
          evidence: { stringValue: f.evidence ?? '' },
          quickFix: { stringValue: f.quickFix ?? '' },
          fixCode: { stringValue: f.fixCode ?? '' },
          line: f.line !== undefined ? { integerValue: String(f.line) } : { nullValue: null },
          evidenceType: { stringValue: f.evidenceType ?? '' },
          securityCategory: { stringValue: f.securityCategory ?? '' },
          capabilityImpact: { stringValue: f.capabilityImpact ?? '' },
        }
      }
    }))

    const payload = {
      fields: {
        reportId: { stringValue: reportId },
        uid: { stringValue: uid },
        fileName: { stringValue: fileName ?? 'unknown' },
        verdict: { stringValue: result.verdict ?? 'NOT_VERIFIED' },
        riskScore: { integerValue: String(result.riskScore ?? 0) },
        riskLevel: { stringValue: result.riskLevel ?? 'High Risk' },
        confidence: { integerValue: String(result.confidence ?? 0) },
        findings: { arrayValue: { values: firestoreFindings } },
        reportInsights: { stringValue: JSON.stringify(result.reportInsights ?? null) },
        threatCategories: { stringValue: JSON.stringify(result.threatCategories ?? []) },
        categoryScores: { stringValue: JSON.stringify(result.categoryScores ?? []) },
        securityCategories: { stringValue: JSON.stringify(result.securityCategories ?? []) },
        capabilities: { stringValue: JSON.stringify(result.capabilities ?? []) },
        mcpExposures: { stringValue: JSON.stringify(result.mcpExposures ?? []) },
        capabilityChains: { stringValue: JSON.stringify(result.capabilityChains ?? []) },
        a2spaStatus: { stringValue: result.a2spaStatus ?? '' },
        securityControlsDetected: { stringValue: JSON.stringify(result.securityControlsDetected ?? []) },
        notDetermined: { stringValue: JSON.stringify(result.notDetermined ?? []) },
        bom: { stringValue: JSON.stringify(result.bom ?? null) },
        scannedAt: { stringValue: result.metadata?.scannedAt ?? new Date().toISOString() },
        scannerVersion: { stringValue: result.metadata?.scannerVersion ?? '' },
        agentName: { stringValue: result.bom?.agentName ?? '' },
        source: { stringValue: source },
        platform: { stringValue: result.metadata?.selectedPlatform ?? '' },
        isPrivate: { booleanValue: true },
        isPublic: { booleanValue: false },
        password: { nullValue: null },
        artifactHash: { stringValue: enrichment.artifactFingerprint.artifactHash },
        artifactHashAlgorithm: { stringValue: enrichment.artifactFingerprint.artifactHashAlgorithm },
        artifactFingerprintVersion: { stringValue: enrichment.artifactFingerprint.artifactFingerprintVersion },
        reportHash: enrichment.reportHash ? { stringValue: enrichment.reportHash } : { nullValue: null },
        attestation: enrichment.attestation ? { stringValue: JSON.stringify(enrichment.attestation) } : { nullValue: null },
        policyProfile: enrichment.policyProfile ? { stringValue: enrichment.policyProfile } : { nullValue: null },
        policyResult: enrichment.policyResult ? { stringValue: enrichment.policyResult } : { nullValue: null },
      }
    }

    const saveRes = await fetch(reportUrl, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!saveRes.ok) {
      const errText = await saveRes.text()
      console.error('Firestore save failed:', saveRes.status, errText)
      return null
    }

    return reportId
  } catch (e) {
    console.error('saveReportToFirebase error:', e instanceof Error ? e.message : e)
    return null
  }
}

type WorkerEnv = BillingEnv & AttestationSigningEnv & OrganizationsEnv & AuditLogEnv & WebhooksEnv & {
  FIREBASE_API_KEY?: string
  FIREBASE_CLIENT_EMAIL?: string
  FIREBASE_PRIVATE_KEY?: string
}

const MAX_DEMO_CONTENT_LENGTH = 200 * 1024 // 200KB — generous for one pasted demo file, far below the real 5MB scan limit

/**
 * Unauthenticated public demo scan (landing page "Try one real scan" + the Live Demo page).
 * Deliberately minimal: no persistence, no quota/billing interaction, no attestation, no
 * organization data — a disposable, anonymous demonstration of the engine's OUTPUT. The engine
 * itself runs ONLY here, server-side; PublicScanDemo.tsx and AgentSpoofedPage.tsx call this
 * instead of importing @agentverify/scanner directly (see docs/private-scanner-boundary.md).
 */
async function handleDemoScan(request: Request, env: WorkerEnv): Promise<Response> {
  // Best-effort per-IP throttle — see rateLimit.ts for why this isn't a complete answer alone;
  // the real production requirement is a Cloudflare Rate Limiting rule bound to this route.
  if (isRateLimited(`demo:${clientIp(request)}`, 5, 60 * 60 * 1000)) {
    return json({ error: 'Too many public demo scans from this network. Try again later, or create a free account.' }, 429)
  }

  let body: { content?: unknown; fileName?: unknown; platform?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  if (typeof body.content !== 'string' || !body.content.trim()) return json({ error: 'content is required' }, 400)
  if (body.content.length > MAX_DEMO_CONTENT_LENGTH) {
    return json({ error: `Demo content must be under ${MAX_DEMO_CONTENT_LENGTH / 1024}KB. Create a free account for full-size scans.` }, 413)
  }

  try {
    const scanResult = createScanResult({
      content: body.content,
      fileName: typeof body.fileName === 'string' && body.fileName ? body.fileName : 'demo-agent.txt',
      fileSize: body.content.length,
      platform: typeof body.platform === 'string' ? body.platform : undefined,
    })
    return json(scanResult)
  } catch (e) {
    console.error('Demo scan failed:', e instanceof Error ? e.stack ?? e.message : e)
    return json({ error: 'Scan failed. Please try different content.' }, 400)
  }
}

/** Reads a report's uid (for ownership checks) from either collection reports can live in — same
 * fallback the badge lookup route already uses. Admin auth (not the public apiKeyQueryParam
 * read) since this feeds an authorization decision, not public content. */
async function fetchReportOwner(reportId: string, env: WorkerEnv): Promise<string | null> {
  const headers = await firestoreAdminAuthHeader(env)
  if (!headers) return null
  const encodedReportId = encodeURIComponent(reportId)
  for (const collectionName of ['reports', 'cliReports']) {
    const res = await fetch(`${firestoreBaseUrl(env)}/${collectionName}/${encodedReportId}`, { headers })
    if (!res.ok) continue
    const data = await res.json() as { fields?: { uid?: { stringValue?: string } } }
    const uid = data.fields?.uid?.stringValue
    if (uid) return uid
  }
  return null
}

const MAX_VERIFY_FIX_CONTENT_LENGTH = 1024 * 1024 // 1MB — one fixed file, not a scan-quota-sized upload

/**
 * Fix-verification re-scan for AgentFixer / "Create Fix PR" (Pro remediation flow). Firebase-auth
 * only (no API key — dashboard-only), requires the caller to actually own the report the finding
 * came from, and deliberately does NOT touch the monthly scan quota — it has its own, separate,
 * tighter rate limit instead, so it can never become a free unlimited full-scan bypass. The
 * engine runs ONLY here, server-side; fixVerification.ts calls this instead of importing
 * @agentverify/scanner directly.
 */
async function handleVerifyFix(request: Request, env: WorkerEnv): Promise<Response> {
  const principal = await authenticateRequest(request, env)
  if (!principal || principal.type !== 'USER') return json({ error: 'Sign in to verify a fix.' }, 401)

  // Separate, tighter budget than the real scan quota — a fix-verification re-scan isn't "a
  // scan" for billing purposes, but it's still bounded per user rather than unlimited.
  if (isRateLimited(`verify-fix:${principal.uid}`, 30, 60 * 60 * 1000)) {
    return json({ error: 'Too many fix-verification attempts this hour. Try again later.' }, 429)
  }

  let body: { reportId?: unknown; findingCode?: unknown; fixedContent?: unknown; fileName?: unknown; platform?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  if (typeof body.reportId !== 'string' || !body.reportId) return json({ error: 'reportId is required' }, 400)
  if (typeof body.findingCode !== 'string' || !body.findingCode) return json({ error: 'findingCode is required' }, 400)
  if (typeof body.fixedContent !== 'string' || !body.fixedContent.trim()) return json({ error: 'fixedContent is required' }, 400)
  if (body.fixedContent.length > MAX_VERIFY_FIX_CONTENT_LENGTH) {
    return json({ error: `Content is too large to verify (max ${MAX_VERIFY_FIX_CONTENT_LENGTH / 1024 / 1024}MB).` }, 413)
  }

  const ownerUid = await fetchReportOwner(body.reportId, env)
  if (!ownerUid) return json({ error: 'Report not found.' }, 404)
  if (ownerUid !== principal.uid) return json({ error: 'You do not have access to that report.' }, 403)

  try {
    const rescan = createScanResult({
      content: body.fixedContent,
      fileName: typeof body.fileName === 'string' && body.fileName ? body.fileName : 'fixed-agent.txt',
      fileSize: body.fixedContent.length,
      platform: typeof body.platform === 'string' ? body.platform : undefined,
    })
    return json({ reportId: body.reportId, findingCode: body.findingCode, rescan })
  } catch (e) {
    console.error('Fix verification failed:', e instanceof Error ? e.stack ?? e.message : e)
    return json({ error: 'Verification failed. Please retry.' }, 400)
  }
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') return json({ ok: true })
    if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, service: 'agentverify-api' })

    if (url.pathname === '/v1/billing/status' && request.method === 'GET') return handleStatus(request, env)
    if (url.pathname === '/v1/billing/checkout' && request.method === 'POST') return handleCheckout(request, env)
    if (url.pathname === '/v1/billing/portal' && request.method === 'POST') return handlePortal(request, env)
    if (url.pathname === '/v1/billing/webhook' && request.method === 'POST') return handleWebhook(request, env)

    // Public, unauthenticated, cacheable — the check catalog is deliberately public product
    // content (see docs/private-scanner-boundary.md). Served here, not imported client-side,
    // because VERIFICATION_CATALOG's own module (catalog.ts) transitively imports the REAL
    // secret-detection regex table (secrets.ts's SECRET_PATTERNS) and MCP tool classifier table
    // to build itself from the same source of truth the engine uses — safe to import here (this
    // code never ships to a browser) but never safe to import from a 'use client' file, even
    // though the catalog objects THEMSELVES contain only public metadata (id/name/description),
    // never a `.pattern` field.
    if (url.pathname === '/v1/checks/catalog' && request.method === 'GET') {
      return json({ checks: VERIFICATION_CATALOG, summary: catalogSummary(), riskTaxonomy: RISK_TAXONOMY })
    }

    if (url.pathname === '/v1/demo/scan' && request.method === 'POST') return handleDemoScan(request, env)
    if (url.pathname === '/v1/verify-fix' && request.method === 'POST') return handleVerifyFix(request, env)

    if (request.method === 'GET' && url.pathname.startsWith('/v1/badge/')) {
      const reportId = url.pathname.split('/v1/badge/')[1]
      if (!reportId) return json({ error: 'Report ID required' }, 400)

      let verdict = 'UNKNOWN'
      let score = 0
      let verified = false

      {
        const encodedReportId = encodeURIComponent(reportId)
        const reportsUrl = `${firestoreBaseUrl(env)}/reports/${encodedReportId}?key=${apiKeyQueryParam(env)}`
        const reportsRes = await fetch(reportsUrl)
        let res = reportsRes

        if (!reportsRes.ok) {
          const cliUrl = `${firestoreBaseUrl(env)}/cliReports/${encodedReportId}?key=${apiKeyQueryParam(env)}`
          const cliRes = await fetch(cliUrl)
          res = cliRes

          if (reportsRes.status === 404 && cliRes.status === 404) {
            console.warn('Badge lookup failed: report not found in reports or cliReports', { reportId })
          } else if (!cliRes.ok) {
            console.warn('Badge lookup failed: Firestore lookup failed', {
              reportId,
              reportsStatus: reportsRes.status,
              cliReportsStatus: cliRes.status,
            })
          }
        }

        if (res.ok) {
          const data = await res.json() as { fields?: Record<string, unknown> }
          const fields = data?.fields as Record<string, {
            stringValue?: string
            integerValue?: string
            doubleValue?: number | string
          }> | undefined
          const parsedVerdict = fields?.verdict?.stringValue
          const rawScore = fields?.riskScore?.integerValue ?? fields?.riskScore?.doubleValue
          const parsedScore = typeof rawScore === 'number' ? rawScore : typeof rawScore === 'string' ? Number(rawScore) : NaN

          if (!parsedVerdict || !Number.isFinite(parsedScore)) {
            console.warn('Badge lookup failed: report fields could not be parsed', {
              reportId,
              hasVerdict: !!parsedVerdict,
              rawScore,
            })
          } else {
            verdict = parsedVerdict
            score = Math.round(parsedScore)
            verified = verdict === 'VERIFIED'
          }
        }
      }

      const color = verified ? '#00B37E' : score >= 50 ? '#E07B39' : '#E03E3E'
      const label = verified ? 'VERIFIED' : verdict === 'NOT_ASSESSED' ? 'NOT ASSESSED' : 'NOT VERIFIED'
      const labelWidth = verified ? 80 : 104
      const totalWidth = labelWidth + 110
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20"><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${totalWidth}" height="20" rx="3"/></clipPath><g clip-path="url(#r)"><rect width="110" height="20" fill="#0D1321"/><rect x="110" width="${labelWidth}" height="20" fill="${color}"/><rect width="${totalWidth}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11"><text x="55" y="15" fill="#000" fill-opacity=".15">Agent Verify ${score}/100</text><text x="55" y="14">Agent Verify ${score}/100</text><text x="${110 + labelWidth / 2}" y="15" fill="#000" fill-opacity=".15">${label}</text><text x="${110 + labelWidth / 2}" y="14">${label}</text></g></svg>`

      return new Response(svg, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, User-Agent',
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'max-age=3600',
        },
      })
    }

    // Public — contains only the verification public key, never secret material. Lets an
    // external system verify an attestation without trusting whatever public key an attestation
    // response itself embeds.
    if (request.method === 'GET' && url.pathname === '/v1/attestation/public-key') {
      const info = getAttestationPublicKeyInfo(env)
      if (!info) return json({ error: 'Attestation signing is not configured for this environment' }, 404)
      return json(info)
    }

    if (request.method === 'GET' && url.pathname.startsWith('/v1/verification/')) {
      const artifactHash = decodeURIComponent(url.pathname.split('/v1/verification/')[1] ?? '')
      if (!artifactHash || !/^[0-9a-f]{64}$/i.test(artifactHash)) {
        return json({ error: 'A valid 64-character hex SHA-256 artifactHash is required' }, 400)
      }
      // Authentication is optional here (unlike /v1/scan) — an invalid/absent credential still
      // allows a PUBLIC-only lookup; only a genuinely malformed/rejected credential with an
      // Authorization header present is treated as a hard 401, matching normal API semantics
      // (attempted-and-failed auth is distinct from no-auth-attempted).
      const hasAuthHeader = request.headers.has('Authorization')
      const principal = await authenticateRequest(request, env)
      if (hasAuthHeader && !principal) return unauthorized()

      const outcome = await lookupVerificationStatus(artifactHash, principal && principal.type !== 'SYSTEM' ? principal.uid : null, env)
      if (outcome.kind === 'not_found') return json({ error: 'No verification record found for this artifact hash' }, 404)
      return json(outcome.status)
    }

    // ------------------------------------------------------------------------------------------
    // Organizations / RBAC / Audit Log / Webhooks
    //
    // Every route below authenticates via authz.ts's authenticateRequest()/authorize() — the
    // SAME gate whether the caller presents an Agent Verify API key (CLI/CI/server integrations)
    // or a Firebase ID token (browser dashboard sessions). uid is resolved server-side either
    // way; role is re-read from Firestore on every call. RBAC is enforced HERE, never by hiding
    // a button in the UI.
    // ------------------------------------------------------------------------------------------

    if (request.method === 'POST' && url.pathname === '/v1/organizations') {
      const principal = await authenticateRequest(request, env)
      if (!principal || principal.type === 'SYSTEM') return unauthorized()
      const body = await request.json().catch(() => ({})) as { name?: string }
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : 'My Workspace'
      const org = await createOrganization(name, principal.uid, env)
      if (!org) return json({ error: 'Failed to create organization' }, 500)
      return json(org, 201)
    }

    if (request.method === 'GET' && url.pathname === '/v1/organizations/mine') {
      const principal = await authenticateRequest(request, env)
      if (!principal || principal.type === 'SYSTEM') return unauthorized()
      const orgs = await listMyOrganizations(principal.uid, env)
      return json({ organizations: orgs })
    }

    const orgMembersMatch = url.pathname.match(/^\/v1\/organizations\/([^/]+)\/members\/?$/)
    if (orgMembersMatch) {
      const orgId = decodeURIComponent(orgMembersMatch[1])

      if (request.method === 'GET') {
        const check = await authorize(request, orgId, 'view_members', env)
        if (!check.ok) return json({ error: check.error }, check.status)
        return json({ members: await listMembers(orgId, env) })
      }

      if (request.method === 'POST') {
        const check = await authorize(request, orgId, 'invite_members', env)
        if (!check.ok) return json({ error: check.error }, check.status)
        const body = await request.json().catch(() => ({})) as { email?: string; role?: string }
        if (!body.email || typeof body.email !== 'string') return json({ error: 'email is required' }, 400)
        const role = isValidRole(body.role) ? body.role : 'MEMBER'
        if (role === 'OWNER') return json({ error: 'Cannot invite a member directly as OWNER — transfer ownership is not supported by this endpoint' }, 400)
        const targetUid = await resolveUidByEmail(body.email, env)
        if (!targetUid) return json({ error: 'No Agent Verify account found for that email' }, 404)
        const ok = await upsertMember(orgId, targetUid, role, check.principal.uid, env)
        if (!ok) return json({ error: 'Failed to add member' }, 500)
        await recordAuditEvent({ organizationId: orgId, actorId: check.principal.uid, actorType: check.principal.type === 'USER' ? 'user' : 'api_key', action: 'MEMBER_ADDED', targetType: 'member', targetId: targetUid, metadata: { role } }, env)
        return json({ ok: true, uid: targetUid, role })
      }

      return json({ error: 'Method not allowed' }, 405)
    }

    const orgMemberMatch = url.pathname.match(/^\/v1\/organizations\/([^/]+)\/members\/([^/]+)\/?$/)
    if (orgMemberMatch) {
      const orgId = decodeURIComponent(orgMemberMatch[1])
      const targetUid = decodeURIComponent(orgMemberMatch[2])

      if (request.method === 'PATCH') {
        const check = await authorize(request, orgId, 'modify_roles', env)
        if (!check.ok) return json({ error: check.error }, check.status)
        const body = await request.json().catch(() => ({})) as { role?: string }
        if (!isValidRole(body.role)) return json({ error: 'A valid role is required' }, 400)
        const targetMembership = await getMembership(orgId, targetUid, env)
        if (targetMembership?.role === 'OWNER' && body.role !== 'OWNER') {
          return json({ error: 'Cannot demote the last OWNER through this endpoint' }, 400)
        }
        const ok = await upsertMember(orgId, targetUid, body.role, check.principal.uid, env)
        if (!ok) return json({ error: 'Failed to update role' }, 500)
        await recordAuditEvent({ organizationId: orgId, actorId: check.principal.uid, actorType: check.principal.type === 'USER' ? 'user' : 'api_key', action: 'ROLE_CHANGED', targetType: 'member', targetId: targetUid, metadata: { newRole: body.role, previousRole: targetMembership?.role ?? null } }, env)
        return json({ ok: true, uid: targetUid, role: body.role })
      }

      if (request.method === 'DELETE') {
        const check = await authorize(request, orgId, 'invite_members', env)
        if (!check.ok) return json({ error: check.error }, check.status)
        const targetMembership = await getMembership(orgId, targetUid, env)
        if (targetMembership?.role === 'OWNER') return json({ error: 'Cannot remove the OWNER' }, 400)
        const ok = await removeMember(orgId, targetUid, env)
        if (!ok) return json({ error: 'Failed to remove member' }, 500)
        await recordAuditEvent({ organizationId: orgId, actorId: check.principal.uid, actorType: check.principal.type === 'USER' ? 'user' : 'api_key', action: 'MEMBER_REMOVED', targetType: 'member', targetId: targetUid, metadata: {} }, env)
        return json({ ok: true })
      }

      return json({ error: 'Method not allowed' }, 405)
    }

    const auditLogMatch = url.pathname.match(/^\/v1\/organizations\/([^/]+)\/audit-log\/?$/)
    if (auditLogMatch && request.method === 'GET') {
      const orgId = decodeURIComponent(auditLogMatch[1])
      const check = await authorize(request, orgId, 'view_audit_log', env)
      if (!check.ok) return json({ error: check.error }, check.status)
      return json({ events: await listAuditEvents(orgId, env) })
    }

    const webhooksMatch = url.pathname.match(/^\/v1\/organizations\/([^/]+)\/webhooks\/?$/)
    if (webhooksMatch) {
      const orgId = decodeURIComponent(webhooksMatch[1])

      if (request.method === 'GET') {
        const check = await authorize(request, orgId, 'configure_webhook', env)
        if (!check.ok) return json({ error: check.error }, check.status)
        return json({ webhooks: await listWebhooks(orgId, env) })
      }

      if (request.method === 'POST') {
        const check = await authorize(request, orgId, 'configure_webhook', env)
        if (!check.ok) return json({ error: check.error }, check.status)
        const body = await request.json().catch(() => ({})) as { endpoint?: string; events?: string[] }
        if (typeof body.endpoint !== 'string' || !Array.isArray(body.events)) {
          return json({ error: 'endpoint and events are required' }, 400)
        }
        const result = await createWebhook(orgId, body.endpoint, body.events, check.principal.uid, env)
        if ('error' in result) return json({ error: result.error }, 400)
        await recordAuditEvent({ organizationId: orgId, actorId: check.principal.uid, actorType: check.principal.type === 'USER' ? 'user' : 'api_key', action: 'WEBHOOK_CREATED', targetType: 'webhook', targetId: result.config.webhookId, metadata: { endpoint: result.config.endpoint, events: result.config.enabledEvents.join(',') } }, env)
        // The signing secret is returned exactly once, here, to the creator — never retrievable again afterward. Same convention as the existing API key UI.
        return json({ ...result.config, secret: result.secret }, 201)
      }

      return json({ error: 'Method not allowed' }, 405)
    }

    const webhookDisableMatch = url.pathname.match(/^\/v1\/organizations\/([^/]+)\/webhooks\/([^/]+)\/disable\/?$/)
    if (webhookDisableMatch && request.method === 'POST') {
      const orgId = decodeURIComponent(webhookDisableMatch[1])
      const webhookId = decodeURIComponent(webhookDisableMatch[2])
      const check = await authorize(request, orgId, 'configure_webhook', env)
      if (!check.ok) return json({ error: check.error }, check.status)
      const ok = await setWebhookStatus(orgId, webhookId, 'disabled', env)
      if (!ok) return json({ error: 'Failed to disable webhook' }, 500)
      await recordAuditEvent({ organizationId: orgId, actorId: check.principal.uid, actorType: check.principal.type === 'USER' ? 'user' : 'api_key', action: 'WEBHOOK_DISABLED', targetType: 'webhook', targetId: webhookId, metadata: {} }, env)
      return json({ ok: true })
    }

    if (request.method !== 'POST' || url.pathname !== '/v1/scan') {
      return json({ error: 'Not found' }, 404)
    }

    try {
      // Dual auth, same as every org/audit/webhook route: an Agent Verify API key (CLI/CI/server
      // integrations) OR a Firebase ID token (the browser dashboard). Whichever resolves it, the
      // rest of this handler — quota, scan, save, attestation — is identical from here on; the
      // web dashboard is no longer a separate, unmetered path. See authz.ts.
      const principal = await authenticateRequest(request, env)
      if (!principal || principal.type === 'SYSTEM') return unauthorized()
      const auth: ApiKeyValidation = { uid: principal.uid }
      // 'api' vs 'cli' is a best-effort distinction from the caller's own declared User-Agent —
      // both authenticate identically via the same av_... API key, so this is honest labeling
      // ("did this come through our official CLI/SDK, or a direct API call"), not a security
      // boundary. A raw curl call with no recognized User-Agent is correctly labeled 'api'.
      const userAgent = request.headers.get('User-Agent') ?? ''
      const reportSource: 'cli' | 'dashboard' | 'api' = principal.type === 'USER'
        ? 'dashboard'
        : userAgent.startsWith('agentverify-sdk') || userAgent.startsWith('agentverify-cli') ? 'cli' : 'api'

      const quota = await checkScanQuota(env, auth.uid)
      if (!quota.allowed) {
        return json({
          error: 'Monthly scan quota exceeded',
          plan: quota.plan,
          used: quota.used,
          limit: quota.limit,
          upgradeUrl: quota.plan === 'free' ? 'https://aimodularity.com/agentverify/pricing' : undefined,
        }, 429)
      }

      const body = (await request.json()) as Partial<ScanInput> & { policyId?: string; organizationId?: string }
      if (!body.content || typeof body.content !== 'string') {
        return json({ error: 'content is required' }, 400)
      }

      // organizationId is entirely optional and additive — scans remain uid-scoped by default
      // (unchanged from before Organizations existed). When provided, the caller must actually
      // be a member of that org with start_scan permission, checked here in code — never trusted
      // from the request alone — before anything is attributed to that organization's audit log.
      let orgIdForAudit: string | null = null
      if (typeof body.organizationId === 'string' && body.organizationId) {
        const orgCheck = await requirePermission(body.organizationId, auth.uid, 'start_scan', env)
        if (!orgCheck.ok) return json({ error: orgCheck.error }, orgCheck.status)
        orgIdForAudit = body.organizationId
      }
      // Defense in depth beyond the scanner's own internal truncation guard: reject an
      // oversized payload outright with a clear error, rather than silently truncating server
      // findings the caller didn't ask for.
      if (body.content.length > MAX_SCAN_CONTENT_LENGTH) {
        return json({ error: `content exceeds the ${MAX_SCAN_CONTENT_LENGTH / 1024 / 1024}MB scan limit` }, 413)
      }

      const scanResult = createScanResult({
        content: body.content,
        fileName: body.fileName,
        fileSize: body.fileSize,
        platform: body.platform,
      })
      // Fingerprints the exact submitted content — independent of the scan result itself, so the
      // same artifact always fingerprints identically even if the ruleset changes between scans.
      const artifactFingerprint = await computeArtifactFingerprint(body.content)
      const reportIntegrity = await computeReportHash(scanResult)

      // Policy evaluation is a layer on top of the fixed scan evidence — it NEVER changes
      // scanResult.verdict/riskScore/findings. A scan can be VERIFIED and still fail a policy;
      // both facts are bound separately into the attestation (see policy.ts, attestation.ts).
      let policyProfile: string | null = null
      let policyResult: string | null = null
      if (typeof body.policyId === 'string' && body.policyId) {
        const policy = findPolicyById(body.policyId)
        if (policy) {
          const evaluation = evaluatePolicy(scanResult, policy)
          policyProfile = policy.id
          policyResult = evaluation.pass ? 'PASS' : 'FAIL'
        }
      }

      const attestationPayload = buildAttestationPayload({
        artifactHash: artifactFingerprint.artifactHash,
        artifactHashAlgorithm: artifactFingerprint.artifactHashAlgorithm,
        artifactFingerprintVersion: artifactFingerprint.artifactFingerprintVersion,
        scanId: scanResult.reportId,
        reportHash: reportIntegrity.reportHash,
        verdict: scanResult.verdict,
        score: scanResult.riskScore,
        ...(policyProfile ? { policyProfile } : {}),
        ...(policyResult ? { policyResult: policyResult as 'PASS' | 'FAIL' } : {}),
        scannerVersion: scanResult.metadata.scannerVersion,
        schemaVersion: scanResult.schemaVersion,
        issuer: env.ATTESTATION_ISSUER ?? 'agentverify-dev',
      })
      // Signing is skipped (never faked) when no signing key is configured for this environment.
      const attestation = await signAttestation(attestationPayload, env)

      const fileName = body.fileName ?? 'unknown'
      const reportId = await saveReportToFirebase(auth, scanResult, fileName, env, {
        artifactFingerprint,
        reportHash: reportIntegrity.reportHash,
        attestation,
        policyProfile,
        policyResult,
      }, reportSource)
      await recordMonthlyUsage(env, auth.uid, quota.month, quota.plan)

      if (orgIdForAudit) {
        const actorType = principal.type === 'USER' ? 'user' : 'api_key'
        const commonMeta = { scanId: scanResult.reportId, verdict: scanResult.verdict, score: scanResult.riskScore, fileName }
        await recordAuditEvent({ organizationId: orgIdForAudit, actorId: auth.uid, actorType, action: 'SCAN_COMPLETED', targetType: 'scan', targetId: scanResult.reportId, metadata: commonMeta }, env)
        await recordAuditEvent({ organizationId: orgIdForAudit, actorId: auth.uid, actorType, action: scanResult.verdict === 'VERIFIED' ? 'VERIFICATION_PASSED' : 'VERIFICATION_FAILED', targetType: 'scan', targetId: scanResult.reportId, metadata: commonMeta }, env)
        if (attestation) {
          await recordAuditEvent({ organizationId: orgIdForAudit, actorId: auth.uid, actorType, action: 'ATTESTATION_ISSUED', targetType: 'scan', targetId: scanResult.reportId, metadata: { artifactHash: artifactFingerprint.artifactHash } }, env)
        }
        if (policyProfile) {
          await recordAuditEvent({ organizationId: orgIdForAudit, actorId: auth.uid, actorType, action: 'POLICY_APPLIED', targetType: 'scan', targetId: scanResult.reportId, metadata: { policyProfile, policyResult } }, env)
        }
      }

      return json({
        ...scanResult,
        artifactFingerprint,
        reportIntegrity,
        policyProfile,
        policyResult,
        attestation,
        reportId,
        saved: !!reportId,
        reportUrl: reportId
          ? `https://aimodularity.com/agentverify/report/?id=${reportId}`
          : null,
      })
    } catch (e) {
      // Logged server-side only — the response body deliberately stays generic (never echoes
      // internal error detail to the caller), but a silently-swallowed exception here was
      // genuinely painful to diagnose once, so it's logged now.
      console.error('Scan request failed:', e instanceof Error ? e.stack ?? e.message : e)
      return json({ error: 'Invalid JSON body' }, 400)
    }
  },
}
