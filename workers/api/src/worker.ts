import type { ArtifactFingerprint, Finding, ScanInput, ScanResult, SignedAttestation } from '@agentverify/scanner'
import { computeArtifactFingerprint, computeReportHash, buildAttestationPayload, findPolicyById, evaluatePolicy, VERIFICATION_CATALOG, catalogSummary, RISK_TAXONOMY } from '@agentverify/scanner'
import { applyRemediationEntitlement, type LockableFinding } from './entitlementView'
import { checkScanQuota, getPriceInfo, proTrialDays, handleCheckout, handlePortal, handleStatus, handleWebhook, getTeamSeatPrice, hasProFeatures, isPlanCheckoutAvailable, recordMonthlyUsage, TEAM_MAX_SEATS, TEAM_MIN_SEATS, type BillingEnv } from './billing'
import { createScanResult } from './scanResponse'
import { signAttestation, getAttestationPublicKeyInfo, type AttestationSigningEnv } from './attestationSigning'
import { lookupVerificationStatus } from './verificationStatus'
import { firestoreBaseUrl, firestoreAdminAuthHeader, apiKeyQueryParam, type FirebaseServiceAccountEnv } from './firebaseAuth'
import { createOrganization, getMembership, listMembers, listMyOrganizations, lookupAccount, requirePermission, resolveUidByEmail, removeMember, upsertMember, OrganizationsQueryError, type OrganizationsEnv } from './organizations'
import { isValidRole } from './rbac'
import { recordAuditEvent, listAuditEvents, type AuditLogEnv } from './auditLog'
import { createWebhook, listWebhooks, setWebhookStatus, type WebhooksEnv } from './webhooks'
import { enqueueWebhookDeliveries, runDueDeliveries, listDeliveries, retryDelivery, type WebhooksDeliveryEnv } from './webhookDelivery'
import { authenticateRequest, authorize, type AuthzEnv } from './authz'
import { isRateLimited, clientIp, edgeRateLimited, type RateLimiterBinding } from './rateLimit'
import { demoCacheKey, readDemoCache, writeDemoCache, DEMO_SCANS_PER_HOUR } from './demoCache'
import { handleProfileRequest } from './profiles'
import { signProfileAttestation, getProfileAttestationPublicKeyInfo, type ProfileAttestationSigningEnv, type SignFailureCategory } from './profileAttestationSigning'
import { readBoundedBody, decodeBody, isValidUtf8 } from './requestBody'
import { handleGithubWebhook, githubConfig, linkInstallation, listInstallations, type GithubEnv } from './githubWebhook'
import { loadAlertSettings, saveAlertSettings } from './alerts'
import { claimReferral, type GrowthEnv, getDigest, inDigestWindow, POPULAR_MCP_FOR_EMAIL, qualifyReferral, referralSummary, sendDigestBatch, setDigest, unsubscribe } from './growth'
import { listGuardEvents, storeGuardEvents } from './guardEvents'
import { createTarget, deleteTarget, listRedteam, processRedteamTick, startRun, verifyTarget } from './redteam'
import { finishSlackOauth, handleSlackCommand, linkSlackTeam, slackInstallUrl, type SlackEnv } from './slack'
import { createConnection, deleteConnection, handleVcsWebhook, listConnections, type VcsEnv } from './vcs'
import { addMember as addTeamMember, getTeam, removeMember as removeTeamMember } from './team'
import { adminGrant, adminImportFirebaseUsers, adminOverview, adminUsers, isAdmin, type AdminEnv } from './admin'
import { handleAsk, type AskEnv } from './ask'
import { handleAiFix, type AiFixEnv } from './aiFix'
import { bumpCounter, funnel, listErrors, pruneErrors, listFeedback, onboardingUnsubscribe, recordError, saveFeedback, sendOnboardingBatch, setFeedbackStatus, type OpsEnv } from './ops'
import { getUserProfile, saveUserProfile } from './userProfiles'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
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
          fixLocked: { booleanValue: (f as LockableFinding).fixLocked === true },
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

type WorkerEnv = BillingEnv & AdminEnv & AskEnv & AiFixEnv & OpsEnv & AttestationSigningEnv & ProfileAttestationSigningEnv & OrganizationsEnv & AuditLogEnv & WebhooksEnv & WebhooksDeliveryEnv & GithubEnv & GrowthEnv & VcsEnv & SlackEnv & {
  FIREBASE_API_KEY?: string
  FIREBASE_CLIENT_EMAIL?: string
  FIREBASE_PRIVATE_KEY?: string
  /** Cloudflare Workers rate limiter for public, unauthenticated routes (wrangler.toml [[ratelimits]]). */
  PUBLIC_LIMITER?: RateLimiterBinding
}

// HTTP status classification for an `attest: true` signing failure, by the signer's own `category` (never by
// pattern-matching `reason` strings): the specific assessment being inadmissible is a client-content problem
// (422); the signing capability being unconfigured/misconfigured is a server-availability problem (503); an
// unexpected defect inside the signer itself is a genuine server error (500). See
// profileAttestationSigning.ts's module header for the full rationale and the stable `reason` codes.
const ATTEST_FAILURE_STATUS: Record<SignFailureCategory, 422 | 503 | 500> = { inadmissible: 422, unavailable: 503, internal: 500 }
const ATTEST_FAILURE_MESSAGE: Record<SignFailureCategory, string> = {
  inadmissible: 'Assessment not admitted for attestation',
  unavailable: 'Attestation signing unavailable',
  internal: 'Attestation signing failed',
}

// Minimal hand-rolled Cron Trigger types — same convention as billing.ts's D1Database: this
// codebase has no dependency on @cloudflare/workers-types, so only the members actually used are
// declared, matching the real Workers runtime API shape exactly.
interface ScheduledEvent {
  cron: string
  scheduledTime: number
}
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
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
  const fileName = typeof body.fileName === 'string' && body.fileName ? body.fileName.slice(0, 200) : 'demo-agent.txt'
  const platform = typeof body.platform === 'string' ? body.platform.slice(0, 100) : ''

  // Same code as before (the Live Demo, the homepage examples): reuse the saved result. It costs
  // no scanner time, so it doesn't count toward the visitor's demo allowance.
  const cacheKey = await demoCacheKey(body.content, fileName, platform)
  const cached = await readDemoCache(cacheKey)
  if (cached) {
    await bumpCounter(env.BILLING_DB, 'demo_scan')
    return json(JSON.parse(cached))
  }

  // Best-effort per-IP throttle — see rateLimit.ts for why this isn't a complete answer alone;
  // the real production requirement is a Cloudflare Rate Limiting rule bound to this route.
  if (await edgeRateLimited(env.PUBLIC_LIMITER, `demo:${clientIp(request)}`) || isRateLimited(`demo:${clientIp(request)}`, DEMO_SCANS_PER_HOUR, 60 * 60 * 1000)) {
    return json({ error: 'Too many public demo scans from this network. Try again later, or create a free account.' }, 429)
  }

  try {
    // The public demo is unauthenticated, so it is always the Free view: findings without fixes.
    const scanResult = applyRemediationEntitlement(createScanResult({
      content: body.content,
      fileName,
      fileSize: body.content.length,
      platform: platform || undefined,
    }), 'free')
    const response = json(scanResult)
    await writeDemoCache(cacheKey, JSON.stringify(scanResult))
    await bumpCounter(env.BILLING_DB, 'demo_scan')
    return response
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
    // The re-scan follows the caller's plan, so it can never be used to read fixes a Free plan excludes.
    const { plan } = await checkScanQuota(env, principal.uid)
    const rescan = applyRemediationEntitlement(createScanResult({
      content: body.fixedContent,
      fileName: typeof body.fileName === 'string' && body.fileName ? body.fileName : 'fixed-agent.txt',
      fileSize: body.fixedContent.length,
      platform: typeof body.platform === 'string' ? body.platform : undefined,
    }), hasProFeatures(plan) ? 'pro' : 'free')
    return json({ reportId: body.reportId, findingCode: body.findingCode, rescan })
  } catch (e) {
    console.error('Fix verification failed:', e instanceof Error ? e.stack ?? e.message : e)
    return json({ error: 'Verification failed. Please retry.' }, 400)
  }
}

async function routeRequest(request: Request, env: WorkerEnv, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') return json({ ok: true })
    if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, service: 'agentverify-api' })

    if (url.pathname === '/v1/billing/status' && request.method === 'GET') return handleStatus(request, env)
    if (url.pathname === '/v1/billing/plans' && request.method === 'GET') {
      const teamCheckout = isPlanCheckoutAvailable('team', env) && env.BILLING_ENABLED === 'true'
      const [proPrice, proAnnualPrice] = await Promise.all([getPriceInfo(env, env.STRIPE_PRO_PRICE_ID), getPriceInfo(env, env.STRIPE_PRO_ANNUAL_PRICE_ID)])
      return json({ teamCheckout, teamSeatPrice: teamCheckout ? await getTeamSeatPrice(env) : null, teamMinSeats: TEAM_MIN_SEATS, teamMaxSeats: TEAM_MAX_SEATS, proPrice, proAnnualPrice, proTrialDays: proTrialDays(env) })
    }
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
    if (url.pathname === '/v1/fix/ai' && request.method === 'POST') {
      const principal = await authenticateRequest(request, env)
      if (!principal || principal.type !== 'USER') return json({ error: 'Sign in to use AI fixes.' }, 401)
      const raw = await readBoundedBody(request)
      if (!raw.ok) return json({ error: 'Request body too large' }, 413)
      let body: Record<string, unknown>
      try { body = JSON.parse(decodeBody(raw.bytes)) as Record<string, unknown> } catch { return json({ error: 'Invalid JSON body' }, 400) }
      if (isRateLimited(`ai-fix:${principal.uid}`, 6, 60 * 1000)) return json({ error: 'One moment: too many AI fixes in a row. Try again in a minute.' }, 429)
      const pro = hasProFeatures((await checkScanQuota(env, principal.uid)).plan)
      const scan = (content: string, fileName: string, platform?: string) => applyRemediationEntitlement(createScanResult({ content, fileName, fileSize: content.length, platform }), 'pro')
      const res = await handleAiFix(env, { uid: principal.uid, pro }, body, scan)
      return json(res.body, res.status)
    }

    // ── 2.0: "Ask anything" (free Workers AI, capped), signup profile, admin panel ──
    if (url.pathname === '/v1/ask' && request.method === 'POST') {
      const raw = await readBoundedBody(request)
      if (!raw.ok) return json({ error: 'Request body too large' }, 413)
      let body: Record<string, unknown>
      try { body = JSON.parse(decodeBody(raw.bytes)) as Record<string, unknown> } catch { return json({ error: 'Invalid JSON body' }, 400) }
      const principal = await authenticateRequest(request, env)
      const uid = principal && principal.type !== 'SYSTEM' ? principal.uid : undefined
      if (await edgeRateLimited(env.PUBLIC_LIMITER, `ask:${uid ?? clientIp(request)}`)) return json({ error: 'Too many questions at once. Wait a minute and try again.', fallback: true }, 429)
      const pro = uid ? hasProFeatures((await checkScanQuota(env, uid)).plan) : false
      const res = await handleAsk(env, { uid, pro, ip: request.headers.get('CF-Connecting-IP') }, body)
      return json(res.body, res.status)
    }
    if (url.pathname === '/v1/profile' && (request.method === 'GET' || request.method === 'POST')) {
      const principal = await authenticateRequest(request, env)
      if (!principal || principal.type !== 'USER') return unauthorized()
      if (!env.BILLING_DB) return json({ error: 'Not available' }, 503)
      try {
        if (request.method === 'GET') return json(await getUserProfile(env.BILLING_DB, principal.uid))
        const body = await request.json().catch(() => ({})) as Record<string, unknown>
        const res = await saveUserProfile(env.BILLING_DB, principal.uid, principal.email, body)
        return json(res.body, res.status)
      } catch {
        return json({ error: 'Profiles are not available yet' }, 503)
      }
    }
    // ── 2.0: error reports (public), feedback (signed in), welcome-email opt-out ──
    if (url.pathname === '/v1/errors' && request.method === 'POST') {
      const ip = clientIp(request)
      if (await edgeRateLimited(env.PUBLIC_LIMITER, `err:${ip}`) || isRateLimited(`err:${ip}`, 30, 60 * 60 * 1000)) return json({ ok: true })
      const raw = await readBoundedBody(request)
      if (!raw.ok) return json({ error: 'Request body too large' }, 413)
      let body: Record<string, unknown>
      try { body = JSON.parse(decodeBody(raw.bytes)) as Record<string, unknown> } catch { return json({ error: 'Invalid JSON body' }, 400) }
      await recordError(env, { source: 'web', message: String(body.message ?? ''), stack: typeof body.stack === 'string' ? body.stack : undefined, path: typeof body.path === 'string' ? body.path : undefined, userAgent: request.headers.get('User-Agent') ?? undefined })
      return json({ ok: true })
    }
    if (url.pathname === '/v1/feedback' && request.method === 'POST') {
      const principal = await authenticateRequest(request, env)
      if (!principal || principal.type !== 'USER') return unauthorized()
      if (isRateLimited(`feedback:${principal.uid}`, 10, 60 * 60 * 1000)) return json({ error: 'You have sent a lot of feedback this hour. Thank you! Try again a bit later.' }, 429)
      const body = await request.json().catch(() => ({})) as Record<string, unknown>
      const res = await saveFeedback(env, principal.uid, principal.email, body)
      return json(res.body, res.status)
    }
    if (url.pathname === '/v1/onboarding/unsubscribe' && request.method === 'GET') {
      const done = await onboardingUnsubscribe(env.BILLING_DB, url.searchParams.get('token') ?? '')
      return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Agent Verify</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1 style="font-size:1.25rem">${done ? 'Done — no more tips emails.' : 'That link is not valid.'}</h1><p>${done ? 'You will still get important account and billing emails.' : 'It may already have been used.'}</p><p><a href="https://aimodularity.com/agentverify/dashboard/">Open Agent Verify</a></p></body>`, { status: done ? 200 : 404, headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    if (url.pathname.startsWith('/v1/admin/')) {
      const principal = await authenticateRequest(request, env)
      // Not found (not 403) for everyone else, so the admin API does not advertise itself.
      if (!isAdmin(principal, env) || !principal || principal.type !== 'USER') return json({ error: 'Not found' }, 404)
      if (url.pathname === '/v1/admin/me' && request.method === 'GET') return json({ admin: true, email: principal.email })
      if (url.pathname === '/v1/admin/overview' && request.method === 'GET') {
        const res = await adminOverview(env)
        return json(res.body, res.status)
      }
      if (url.pathname === '/v1/admin/users' && request.method === 'GET') {
        const res = await adminUsers(env, { filter: url.searchParams.get('filter'), q: url.searchParams.get('q'), limit: Number(url.searchParams.get('limit')) || undefined, offset: Number(url.searchParams.get('offset')) || undefined })
        return json(res.body, res.status)
      }
      if (url.pathname === '/v1/admin/grants' && request.method === 'POST') {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>
        const res = await adminGrant(env, principal.email ?? 'admin', body, query => lookupAccount(env, query))
        return json(res.body, res.status)
      }
      if (url.pathname === '/v1/admin/funnel' && request.method === 'GET') {
        if (!env.BILLING_DB) return json({ error: 'Database not available' }, 503)
        return json(await funnel(env.BILLING_DB, Number(url.searchParams.get('days')) || 30))
      }
      if (url.pathname === '/v1/admin/errors' && request.method === 'GET') {
        if (!env.BILLING_DB) return json({ error: 'Database not available' }, 503)
        try { return json({ errors: await listErrors(env.BILLING_DB) }) } catch { return json({ errors: [], setup: 'Apply schema/ops.sql' }) }
      }
      if (url.pathname === '/v1/admin/feedback' && request.method === 'GET') {
        if (!env.BILLING_DB) return json({ error: 'Database not available' }, 503)
        try { return json({ feedback: await listFeedback(env.BILLING_DB) }) } catch { return json({ feedback: [], setup: 'Apply schema/ops.sql' }) }
      }
      if (url.pathname === '/v1/admin/feedback/status' && request.method === 'POST') {
        if (!env.BILLING_DB) return json({ error: 'Database not available' }, 503)
        const body = await request.json().catch(() => ({})) as Record<string, unknown>
        const res = await setFeedbackStatus(env.BILLING_DB, String(body.id ?? ''), body.status)
        return json(res.body, res.status)
      }
      if (url.pathname === '/v1/admin/import' && request.method === 'POST') {
        const res = await adminImportFirebaseUsers(env)
        return json(res.body, res.status)
      }
      return json({ error: 'Not found' }, 404)
    }

    // ── 2.0: GitHub App (PR bot + repo monitoring) and alert settings ──
    if (url.pathname === '/v1/github/webhook' && request.method === 'POST') {
      return handleGithubWebhook(request, env, ctx ?? { waitUntil: (p: Promise<unknown>) => { void p } })
    }
    if (url.pathname === '/v1/github/config' && request.method === 'GET') return json(githubConfig(env))
    if (url.pathname === '/v1/github/link' && request.method === 'POST') {
      // Linking needs a signed-in dashboard user (not an API key): it attaches an installation to that account.
      const principal = await authenticateRequest(request, env)
      if (!principal || principal.type !== 'USER') return unauthorized()
      const body = await request.json().catch(() => ({})) as Record<string, unknown>
      const res = await linkInstallation(principal.uid, body, env)
      return json(res.body, res.status)
    }
    if (url.pathname === '/v1/github/installations' && request.method === 'GET') {
      const principal = await authenticateRequest(request, env)
      if (!principal || principal.type === 'SYSTEM') return unauthorized()
      return json(await listInstallations(principal.uid, env))
    }
    if (url.pathname === '/v1/digest/unsubscribe' && request.method === 'GET') {
      const done = env.BILLING_DB ? await unsubscribe(env.BILLING_DB, url.searchParams.get('token') ?? '') : false
      return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Agent Verify</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1 style="font-size:1.25rem">${done ? 'You are unsubscribed.' : 'That unsubscribe link is not valid.'}</h1><p>${done ? 'You will not get the Agent Verify weekly email any more. You can turn it back on in your dashboard settings.' : 'It may already have been used.'}</p><p><a href="https://aimodularity.com/agentverify/dashboard/">Open Agent Verify</a></p></body>`, { status: done ? 200 : 404, headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    if (url.pathname === '/v1/referrals' || url.pathname === '/v1/referrals/claim' || url.pathname === '/v1/digest') {
      const principal = await authenticateRequest(request, env)
      if (!principal || principal.type !== 'USER') return unauthorized()
      if (!env.BILLING_DB) return json({ error: 'Not available' }, 503)
      if (url.pathname === '/v1/referrals' && request.method === 'GET') return json(await referralSummary(env.BILLING_DB, principal.uid))
      if (url.pathname === '/v1/referrals/claim' && request.method === 'POST') {
        if (isRateLimited(`ref-claim:${principal.uid}`, 10, 60 * 60 * 1000)) return json({ error: 'Too many attempts' }, 429)
        const body = await request.json().catch(() => ({})) as Record<string, unknown>
        const res = await claimReferral(env.BILLING_DB, principal.uid, body.code)
        return json(res.body, res.status)
      }
      if (url.pathname === '/v1/digest' && request.method === 'GET') return json({ ...(await getDigest(env.BILLING_DB, principal.uid)), available: Boolean(env.RESEND_API_KEY && env.ALERT_FROM_EMAIL) })
      if (url.pathname === '/v1/digest' && request.method === 'POST') {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>
        const res = await setDigest(env.BILLING_DB, principal.uid, principal.email, body)
        return json(res.body, res.status)
      }
      return json({ error: 'Not found' }, 404)
    }
    if (url.pathname === '/v1/redteam' || url.pathname.startsWith('/v1/redteam/')) {
      const principal = await authenticateRequest(request, env)
      if (!principal || principal.type !== 'USER') return unauthorized()
      if (!env.BILLING_DB) return json({ error: 'Not available' }, 503)
      const body = request.method === 'POST' ? await request.json().catch(() => ({})) as Record<string, unknown> : {}
      if (url.pathname === '/v1/redteam' && request.method === 'GET') return json(await listRedteam(env.BILLING_DB, principal.uid))
      if (url.pathname === '/v1/redteam/targets' && request.method === 'POST') {
        if (isRateLimited(`redteam-target:${principal.uid}`, 20, 60 * 60 * 1000)) return json({ error: 'Too many attempts' }, 429)
        const res = await createTarget(env, principal.uid, body)
        return json(res.body, res.status)
      }
      if (url.pathname === '/v1/redteam/targets' && request.method === 'DELETE') return json(await deleteTarget(env.BILLING_DB, principal.uid, url.searchParams.get('id') ?? ''))
      if (url.pathname === '/v1/redteam/verify' && request.method === 'POST') {
        if (isRateLimited(`redteam-verify:${principal.uid}`, 30, 60 * 60 * 1000)) return json({ error: 'Too many attempts' }, 429)
        const res = await verifyTarget(env, principal.uid, String(body.id ?? ''))
        return json(res.body, res.status)
      }
      if (url.pathname === '/v1/redteam/runs' && request.method === 'POST') {
        const res = await startRun(env, principal.uid, String(body.targetId ?? ''))
        return json(res.body, res.status)
      }
      return json({ error: 'Not found' }, 404)
    }
    if (url.pathname === '/v1/slack/command' && request.method === 'POST') {
      return handleSlackCommand(request, env, ctx ?? { waitUntil: (p: Promise<unknown>) => { void p } })
    }
    if (url.pathname === '/v1/slack/install' && request.method === 'GET') {
      const to = slackInstallUrl(env)
      return to ? Response.redirect(to, 302) : json({ error: 'Slack is not configured' }, 503)
    }
    if (url.pathname === '/v1/slack/oauth' && request.method === 'GET') {
      const done = await finishSlackOauth(env, url.searchParams.get('code'))
      const msg = done.ok ? `Agent Verify is installed${done.team ? ` in ${done.team.replace(/[<>&"]/g, '')}` : ''}. In any channel, type <code>/agentverify help</code>.` : 'Installation did not finish. Please try again from Agent Verify.'
      return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Agent Verify for Slack</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1 style="font-size:1.25rem">${msg}</h1><p><a href="https://aimodularity.com/agentverify/dashboard/">Open Agent Verify</a></p></body>`, { status: done.ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    if (url.pathname === '/v1/slack/link' && request.method === 'POST') {
      const principal = await authenticateRequest(request, env)
      if (!principal || principal.type !== 'USER') return unauthorized()
      const body = await request.json().catch(() => ({})) as Record<string, unknown>
      const res = await linkSlackTeam(env, principal.uid, body.code)
      return json(res.body, res.status)
    }
    if (url.pathname.startsWith('/v1/vcs/webhook/') && request.method === 'POST') {
      return handleVcsWebhook(request, env, url.pathname.slice('/v1/vcs/webhook/'.length), ctx ?? { waitUntil: (p: Promise<unknown>) => { void p } })
    }
    if (url.pathname === '/v1/vcs/connections') {
      const principal = await authenticateRequest(request, env)
      if (!principal || principal.type !== 'USER') return unauthorized()
      if (!env.BILLING_DB) return json({ error: 'Not available' }, 503)
      if (request.method === 'GET') return json(await listConnections(env.BILLING_DB, principal.uid))
      if (request.method === 'POST') {
        if (isRateLimited(`vcs-connect:${principal.uid}`, 20, 60 * 60 * 1000)) return json({ error: 'Too many attempts' }, 429)
        const body = await request.json().catch(() => ({})) as Record<string, unknown>
        const res = await createConnection(env, principal.uid, body)
        return json(res.body, res.status)
      }
      if (request.method === 'DELETE') return json(await deleteConnection(env.BILLING_DB, principal.uid, url.searchParams.get('id') ?? ''))
      return json({ error: 'Not found' }, 404)
    }
    if (url.pathname === '/v1/guard/events') {
      // POST: the agentverify/guard library reports decisions with an API key. GET: the dashboard lists them.
      const principal = await authenticateRequest(request, env)
      if (!principal || principal.type === 'SYSTEM') return unauthorized()
      if (!env.BILLING_DB) return json({ error: 'Not available' }, 503)
      if (request.method === 'POST') {
        if (isRateLimited(`guard:${principal.uid}`, 120, 60 * 1000)) return json({ error: 'Too many requests' }, 429)
        const raw = await readBoundedBody(request)
        if (!raw.ok) return json({ error: 'Request body too large' }, 413)
        let body: unknown
        try { body = JSON.parse(decodeBody(raw.bytes)) } catch { return json({ error: 'Invalid JSON body' }, 400) }
        const res = await storeGuardEvents(env.BILLING_DB, principal.uid, body)
        return json(res.body, res.status)
      }
      if (request.method === 'GET') {
        return json(await listGuardEvents(env.BILLING_DB, principal.uid, { agent: url.searchParams.get('agent'), decision: url.searchParams.get('decision'), limit: Number(url.searchParams.get('limit')) || undefined }))
      }
      return json({ error: 'Not found' }, 404)
    }
    if (url.pathname === '/v1/team' || url.pathname === '/v1/team/members') {
      const principal = await authenticateRequest(request, env)
      if (!principal || principal.type !== 'USER') return unauthorized()
      if (url.pathname === '/v1/team' && request.method === 'GET') {
        const res = await getTeam(principal.uid, env)
        return json(res.body, res.status)
      }
      if (url.pathname === '/v1/team/members' && request.method === 'POST') {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>
        const res = await addTeamMember(principal.uid, body, env, { resolveUid: email => resolveUidByEmail(email, env) })
        return json(res.body, res.status)
      }
      if (url.pathname === '/v1/team/members' && request.method === 'DELETE') {
        const res = await removeTeamMember(principal.uid, url.searchParams.get('uid') ?? '', env)
        return json(res.body, res.status)
      }
      return json({ error: 'Not found' }, 404)
    }
    if (url.pathname === '/v1/alerts/settings' && (request.method === 'GET' || request.method === 'POST')) {
      const principal = await authenticateRequest(request, env)
      if (!principal || principal.type !== 'USER') return unauthorized()
      if (!env.BILLING_DB) return json({ error: 'Alerts are not available' }, 503)
      if (request.method === 'GET') {
        const settings = await loadAlertSettings(env.BILLING_DB, principal.uid)
        return json({ slackWebhookUrl: settings?.slack_webhook_url ?? '', email: settings?.email ?? '', minSeverity: settings?.min_severity ?? 'high', emailAvailable: Boolean(env.RESEND_API_KEY && env.ALERT_FROM_EMAIL) })
      }
      const body = await request.json().catch(() => ({})) as Record<string, unknown>
      const saved = await saveAlertSettings(env.BILLING_DB, principal.uid, body)
      return saved.ok ? json({ ok: true }) : json({ error: saved.error }, 400)
    }

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

    // Public — the trusted publication channel for the profile-attestation key (design doc §10.1, review
    // requirement): a third party MUST fetch the signing key's identity from HERE, independent of any bundle,
    // and never treat a bundle's own embedded publicKey as a trust anchor merely because a signature verifies
    // against it. Contains only { issuer, keyId, publicKey: {kty,crv,x,y}, algorithm, purpose } — never secret
    // material — and keyId is always derived from publicKey itself, so what is published here can never
    // diverge from what the signer actually signs with. INTERIM SCOPE: a single trusted key, not a key set —
    // no sequence, keySetVersion, generatedAt or status field exists here on purpose (see
    // getProfileAttestationPublicKeyInfo's own header for why those must not be faked yet).
    if (request.method === 'GET' && url.pathname === '/v1/profile-attestation/public-key') {
      const info = await getProfileAttestationPublicKeyInfo(env)
      if (!info) return json({ error: 'Profile-attestation signing is not configured for this environment' }, 404)
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
      try {
        const orgs = await listMyOrganizations(principal.uid, env)
        return json({ organizations: orgs })
      } catch (err) {
        // A genuine query failure (see OrganizationsQueryError's own comment — e.g. a missing
        // Firestore index) must never look identical to "this uid has zero workspaces": that
        // silent collapse is exactly what made workspace creation appear to do nothing on
        // 2026-09-02, since the create call succeeds but the immediate list-refresh came back
        // looking empty either way. Surface it as a real error instead.
        if (err instanceof OrganizationsQueryError) return json({ error: 'Could not load your workspaces. Please try again shortly.' }, 503)
        throw err
      }
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
        await enqueueWebhookDeliveries(orgId, 'MEMBER_ADDED', { uid: targetUid, role }, env)
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
        await enqueueWebhookDeliveries(orgId, 'ROLE_CHANGED', { uid: targetUid, newRole: body.role, previousRole: targetMembership?.role ?? null }, env)
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

    // Delivery history — attempt/outcome metadata only, never the payload or signing secret.
    const webhookDeliveriesMatch = url.pathname.match(/^\/v1\/organizations\/([^/]+)\/webhooks\/([^/]+)\/deliveries\/?$/)
    if (webhookDeliveriesMatch && request.method === 'GET') {
      const orgId = decodeURIComponent(webhookDeliveriesMatch[1])
      const webhookId = decodeURIComponent(webhookDeliveriesMatch[2])
      const check = await authorize(request, orgId, 'configure_webhook', env)
      if (!check.ok) return json({ error: check.error }, check.status)
      return json({ deliveries: await listDeliveries(webhookId, env) })
    }

    // Manual retry of a dead-lettered delivery — an operator's explicit decision, never automatic.
    const webhookRetryMatch = url.pathname.match(/^\/v1\/organizations\/([^/]+)\/webhooks\/([^/]+)\/deliveries\/([^/]+)\/retry\/?$/)
    if (webhookRetryMatch && request.method === 'POST') {
      const orgId = decodeURIComponent(webhookRetryMatch[1])
      const webhookId = decodeURIComponent(webhookRetryMatch[2])
      const deliveryId = decodeURIComponent(webhookRetryMatch[3])
      const check = await authorize(request, orgId, 'configure_webhook', env)
      if (!check.ok) return json({ error: check.error }, check.status)
      const result = await retryDelivery(webhookId, deliveryId, env)
      if (!result.ok) return json({ error: result.error }, 400)
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

      // Authentication and quota came first, so an unauthenticated caller never reaches the body at all.
      // The body is then read as bytes under a hard ceiling BEFORE any parsing (requestBody.ts).
      const raw = await readBoundedBody(request)
      if (!raw.ok) return json({ error: 'Request body too large' }, 413)
      const body = JSON.parse(decodeBody(raw.bytes)) as Partial<ScanInput> & { policyId?: string; organizationId?: string; profile?: unknown; files?: unknown; attest?: unknown }

      // An explicit `profile` opts in to an assessment profile (see profiles.ts): package in, the private
      // scanner's frozen assessment out, nothing saved or signed. When `profile` is absent — the only
      // case existing clients produce — none of this runs and everything below is exactly as before.
      if (body.profile !== undefined) {
        // Profile requests must be valid UTF-8; malformed bytes are refused, not silently repaired.
        if (!isValidUtf8(raw.bytes)) return json({ error: 'Request body must be valid UTF-8' }, 400)
        const profiled = await handleProfileRequest(body as Record<string, unknown>, auth.uid)

        // METERING (public release, RD-2 resolved): a completed profile assessment consumes exactly one
        // Agent Verify scan unit — the SAME metering path an ordinary scan uses (same usage_monthly ledger,
        // same `quota` already computed above before the profile/ordinary split; never a separate OWASP
        // billing product or entitlement). Recorded HERE, once, the moment the assessment itself succeeds —
        // deliberately BEFORE the attest:true branch below, so: a malformed/rejected/timed-out/quota-blocked
        // request (profiled.status !== 200, or never reaching this line at all) never consumes a unit; an
        // `attest: true` request that then fails to sign (422/503/500 below) has ALREADY been charged exactly
        // once here and is never charged a second time; a successful attest:true costs the same one unit as
        // an unsigned assessment, since signing is not a second scan.
        if (profiled.status === 200) await recordMonthlyUsage(env, auth.uid, quota.month, quota.plan)

        // `attest: true` is an explicit, separate opt-in on top of `profile` (docs/attestation-profile-design.md
        // §10.1). Its absence changes NOTHING here: profiled.body is returned exactly as handleProfileRequest
        // built it, attestation: null included, byte-identical to before this branch existed. THE WORKER IS THE
        // SIGNING BOUNDARY for this branch ONLY, and only when the caller asked for it: profiles.ts itself never
        // signs anything (see its own header) and is not touched by this code.
        if (profiled.status === 200 && body.attest === true) {
          // The EXACT object handleProfileRequest just returned as `assessment` — the same JS reference the
          // scanner produced, never rescanned, reconstructed or mutated (design doc §10.3). No workspace context
          // is wired into the profile route yet (profiles.ts hard-rejects organizationId on this path today), so
          // workspaceId is correctly omitted here rather than sourced from anything request-controlled.
          const assessment = (profiled.body as { assessment: unknown }).assessment
          const signed = await signProfileAttestation(assessment, env)
          if (!signed.ok) {
            // Fails cleanly and closed: never a 200 with attestation: null pretending the plain path was taken,
            // and never an unsigned bundle returned as though signing succeeded. The HTTP status is classified
            // by the signer's own `category` (see profileAttestationSigning.ts's header), not by pattern-
            // matching `reason` strings here: 'inadmissible' (this specific assessment cannot be attested) is
            // 422; 'unavailable' (the signing capability itself is unconfigured or misconfigured) is 503;
            // 'internal' (an unexpected defect in the signer) is 500. `reason` is always a stable public code,
            // never a raw error message — see signProfileAttestation's own doc comment for the full code list.
            const status = ATTEST_FAILURE_STATUS[signed.category]
            const error = ATTEST_FAILURE_MESSAGE[signed.category]
            return json({ error, reason: signed.reason }, status)
          }
          // bundleVersion is additive, unsigned framing (never part of any digest or signing input — design
          // doc / conformance/v4): included so a non-JS client can reconstruct the frozen v4 bundle shape
          // { bundleVersion, attestation, assessment } without out-of-band knowledge of the constant's value.
          return json({ ...profiled.body, attestation: signed.attestation, bundleVersion: signed.bundle.bundleVersion }, 200)
        }
        return json(profiled.body, profiled.status)
      }

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

      // Free plans receive findings without fixes. Applied BEFORE hashing, signing, and saving so the
      // stored report, its integrity hash, and its attestation all describe exactly what was returned.
      const scanResult = applyRemediationEntitlement(createScanResult({
        content: body.content,
        fileName: body.fileName,
        fileSize: body.fileSize,
        platform: body.platform,
      }), hasProFeatures(quota.plan) ? 'pro' : 'free')
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
      // A referred user's first successful scan rewards both people (no-op for everyone else). Only
      // verified-email accounts count, so throwaway sign-ups can't farm free Pro for the referrer.
      if (principal.type === 'USER' && principal.emailVerified === true) await qualifyReferral(env.BILLING_DB, auth.uid)

      if (orgIdForAudit) {
        const actorType = principal.type === 'USER' ? 'user' : 'api_key'
        const commonMeta = { scanId: scanResult.reportId, verdict: scanResult.verdict, score: scanResult.riskScore, fileName }
        const verificationAction = scanResult.verdict === 'VERIFIED' ? 'VERIFICATION_PASSED' : 'VERIFICATION_FAILED'
        await recordAuditEvent({ organizationId: orgIdForAudit, actorId: auth.uid, actorType, action: 'SCAN_COMPLETED', targetType: 'scan', targetId: scanResult.reportId, metadata: commonMeta }, env)
        await enqueueWebhookDeliveries(orgIdForAudit, 'SCAN_COMPLETED', commonMeta, env)
        await recordAuditEvent({ organizationId: orgIdForAudit, actorId: auth.uid, actorType, action: verificationAction, targetType: 'scan', targetId: scanResult.reportId, metadata: commonMeta }, env)
        await enqueueWebhookDeliveries(orgIdForAudit, verificationAction, commonMeta, env)
        if (attestation) {
          const attestationMeta = { scanId: scanResult.reportId, artifactHash: artifactFingerprint.artifactHash }
          await recordAuditEvent({ organizationId: orgIdForAudit, actorId: auth.uid, actorType, action: 'ATTESTATION_ISSUED', targetType: 'scan', targetId: scanResult.reportId, metadata: { artifactHash: artifactFingerprint.artifactHash } }, env)
          await enqueueWebhookDeliveries(orgIdForAudit, 'ATTESTATION_ISSUED', attestationMeta, env)
        }
        if (policyProfile) {
          const policyMeta = { scanId: scanResult.reportId, policyProfile, policyResult }
          await recordAuditEvent({ organizationId: orgIdForAudit, actorId: auth.uid, actorType, action: 'POLICY_APPLIED', targetType: 'scan', targetId: scanResult.reportId, metadata: { policyProfile, policyResult } }, env)
          await enqueueWebhookDeliveries(orgIdForAudit, 'POLICY_APPLIED', policyMeta, env)
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
}

export default {
  /** Every request goes through routeRequest; anything it throws is recorded for the admin and answered with a plain 500. */
  async fetch(request: Request, env: WorkerEnv, ctx?: ExecutionContext): Promise<Response> {
    try {
      return await routeRequest(request, env, ctx)
    } catch (e) {
      console.error('Unhandled API error:', e instanceof Error ? e.stack ?? e.message : e)
      const err = e instanceof Error ? e : new Error(String(e))
      const report = recordError(env, { source: 'api', message: err.message || 'Unknown error', stack: err.stack, path: `${request.method} ${new URL(request.url).pathname}` })
      if (ctx) ctx.waitUntil(report)
      else await report
      return json({ error: 'Something went wrong on our side. Please try again.' }, 500)
    }
  },

  /**
   * Cron Trigger entry point (see wrangler.toml's [triggers] block) — the only thing that actually
   * sends a queued webhook delivery. A Worker has no background process of its own; this is what
   * "delivery eventually happens" means in this runtime. ctx.waitUntil keeps the sweep running
   * after the trigger's own event returns, same pattern any Workers scheduled handler uses.
   */
  async scheduled(_event: ScheduledEvent, env: WorkerEnv, ctx: ExecutionContext): Promise<void> {
    // Welcome emails: once an hour is plenty (steps are minutes to days apart).
    if (new Date().getUTCMinutes() === 7) {
      ctx.waitUntil(pruneErrors(env.BILLING_DB))
      ctx.waitUntil(sendOnboardingBatch(env).then(n => { if (n) console.log(`Welcome emails: sent ${n}`) }).catch(e => console.error('Welcome emails failed:', e instanceof Error ? e.message : e)))
    }
    ctx.waitUntil(processRedteamTick(env).catch(e => console.error('Injection test tick failed:', e instanceof Error ? e.message : e)))
    if (inDigestWindow()) {
      ctx.waitUntil(sendDigestBatch(env, POPULAR_MCP_FOR_EMAIL).then(n => { if (n) console.log(`Weekly email: sent ${n}`) }).catch(e => console.error('Weekly email batch failed:', e instanceof Error ? e.message : e)))
    }
    ctx.waitUntil(
      runDueDeliveries(env).then(result => {
        if (result.attempted > 0 || result.skippedDisabled > 0) {
          console.log('Webhook delivery sweep:', JSON.stringify(result))
        }
      }).catch(e => console.error('Webhook delivery sweep failed:', e instanceof Error ? e.message : e))
    )
  },
}
