import type { Finding, ScanInput, ScanResult } from '@agentverify/scanner'
import { handleCheckout, handlePortal, handleStatus, handleWebhook, type BillingEnv } from './billing'
import { createScanResult } from './scanResponse'

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

function extractApiKey(request: Request): string | null {
  const raw = request.headers.get('Authorization')?.trim() ?? ''
  const match = raw.match(/^Bearer\s+(.+)$/i)
  if (!match) return null
  const token = match[1].trim()
  if (!/^av_[a-zA-Z0-9_-]{20,}$/.test(token)) return null
  return token
}

async function validateApiKey(request: Request, env: WorkerEnv): Promise<{ ok: true; apiKey: string; uid: string } | { ok: false }> {
  const apiKey = extractApiKey(request)
  if (!apiKey || !env.FIREBASE_API_KEY) return { ok: false }

  try {
    const indexUrl = `https://firestore.googleapis.com/v1/projects/agentverify-26e26/databases/(default)/documents/apiKeyIndex/${encodeURIComponent(apiKey)}?key=${env.FIREBASE_API_KEY}`
    const indexRes = await fetch(indexUrl)
    if (!indexRes.ok) return { ok: false }

    const indexData = await indexRes.json() as {
      fields?: {
        uid?: { stringValue?: string }
        status?: { stringValue?: string }
        disabled?: { booleanValue?: boolean }
        revoked?: { booleanValue?: boolean }
      }
    }
    const fields = indexData.fields ?? {}
    const uid = fields.uid?.stringValue
    const status = fields.status?.stringValue?.toLowerCase()
    const disabled = fields.disabled?.booleanValue === true || fields.revoked?.booleanValue === true || status === 'disabled' || status === 'revoked'
    if (!uid || disabled) return { ok: false }
    return { ok: true, apiKey, uid }
  } catch {
    return { ok: false }
  }
}

async function saveReportToFirebase(
  auth: ApiKeyValidation,
  result: ScanResult,
  fileName: string,
  firebaseApiKey: string
): Promise<string | null> {
  try {
    if (!firebaseApiKey) return null
    const uid = auth.uid
    const reportId = result.reportId
    const reportUrl = `https://firestore.googleapis.com/v1/projects/agentverify-26e26/databases/(default)/documents/cliReports/${reportId}?key=${firebaseApiKey}`

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
        scannedAt: { stringValue: result.metadata?.scannedAt ?? new Date().toISOString() },
        source: { stringValue: 'cli' },
        platform: { stringValue: result.metadata?.selectedPlatform ?? '' },
        isPrivate: { booleanValue: true },
        isPublic: { booleanValue: false },
        password: { nullValue: null },
      }
    }

    const saveRes = await fetch(reportUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
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

type WorkerEnv = BillingEnv & { AGENT_VERIFY_API_KEY?: string; FIREBASE_API_KEY?: string }

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') return json({ ok: true })
    if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, service: 'agentverify-api' })

    if (url.pathname === '/v1/billing/status' && request.method === 'GET') return handleStatus(request, env)
    if (url.pathname === '/v1/billing/checkout' && request.method === 'POST') return handleCheckout(request, env)
    if (url.pathname === '/v1/billing/portal' && request.method === 'POST') return handlePortal(request, env)
    if (url.pathname === '/v1/billing/webhook' && request.method === 'POST') return handleWebhook(request, env)

    if (request.method === 'GET' && url.pathname.startsWith('/v1/badge/')) {
      const reportId = url.pathname.split('/v1/badge/')[1]
      if (!reportId) return json({ error: 'Report ID required' }, 400)

      let verdict = 'UNKNOWN'
      let score = 0
      let verified = false

      const reportsUrl = `https://firestore.googleapis.com/v1/projects/agentverify-26e26/databases/(default)/documents/reports/${reportId}?key=${env.FIREBASE_API_KEY}`
      let res = await fetch(reportsUrl)

      if (!res.ok) {
        const cliUrl = `https://firestore.googleapis.com/v1/projects/agentverify-26e26/databases/(default)/documents/cliReports/${reportId}?key=${env.FIREBASE_API_KEY}`
        res = await fetch(cliUrl)
      }

      if (res.ok) {
        const data = await res.json() as { fields?: Record<string, unknown> }
        const fields = data?.fields as Record<string, {
          stringValue?: string
          integerValue?: string
          doubleValue?: number
        }> | undefined
        verdict = fields?.verdict?.stringValue ?? 'UNKNOWN'
        score = parseInt(fields?.riskScore?.integerValue ?? '0') || Math.round(fields?.riskScore?.doubleValue ?? 0)
        verified = verdict === 'VERIFIED'
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

    if (request.method !== 'POST' || url.pathname !== '/v1/scan') {
      return json({ error: 'Not found' }, 404)
    }

    try {
      const auth = await validateApiKey(request, env)
      if (!auth.ok) return unauthorized()

      const body = (await request.json()) as Partial<ScanInput>
      if (!body.content || typeof body.content !== 'string') {
        return json({ error: 'content is required' }, 400)
      }

      const scanResult = createScanResult({
        content: body.content,
        fileName: body.fileName,
        fileSize: body.fileSize,
        platform: body.platform,
      })
      const fileName = body.fileName ?? 'unknown'
      const reportId = await saveReportToFirebase(auth, scanResult, fileName, env.FIREBASE_API_KEY ?? '')

      return json({
        ...scanResult,
        reportId,
        saved: !!reportId,
        reportUrl: reportId
          ? `https://aimodularity.com/agentverify/report/?id=${reportId}`
          : null,
      })
    } catch {
      return json({ error: 'Invalid JSON body' }, 400)
    }
  },
}
