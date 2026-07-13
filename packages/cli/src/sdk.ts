import type { ScanInput, ScanResult, ScanOptions } from './types'

export type { ScanInput, ScanResult, ScanOptions, Finding } from './types'

const DEFAULT_API_URL = 'https://agentverify-api.agentverify.workers.dev/v1/scan'
const DEFAULT_TIMEOUT = 30000

function normalizeVerdict(value: unknown): ScanResult['verdict'] {
  if (value === 'VERIFIED') return 'VERIFIED'
  if (value === 'NOT_ASSESSED' || value === 'NOT ASSESSED') return 'NOT_ASSESSED'
  return 'NOT_VERIFIED'
}

function normalizeScanResult(data: Partial<ScanResult>): ScanResult {
  const findings = Array.isArray(data.findings) ? data.findings : []
  const riskScore = typeof data.riskScore === 'number' ? data.riskScore : 0
  return {
    ...data,
    reportId: typeof data.reportId === 'string' ? data.reportId : '',
    verdict: normalizeVerdict(data.verdict),
    riskScore,
    riskLevel: data.riskLevel ?? 'High Risk',
    confidence: typeof data.confidence === 'number' ? data.confidence : riskScore > 0 ? 80 : 0,
    optimizationScore: typeof data.optimizationScore === 'number' ? data.optimizationScore : 0,
    reportInsights: data.reportInsights,
    threatCategories: Array.isArray(data.threatCategories) ? data.threatCategories : [],
    findings,
    categoryScores: Array.isArray(data.categoryScores) ? data.categoryScores : [],
    bom: data.bom ?? {
      detectedLanguage: 'Unknown',
      detectedFramework: null,
      detectedPlatform: null,
      agentName: null,
      toolAccessLevel: 'Unknown',
      credentialExposure: 'Not Detected',
      memoryPersistence: 'Unknown',
      auditLogging: 'Unknown',
      humanGates: 'Unknown',
      rateLimiting: 'Unknown',
      promptInjectionSurface: 'Unknown',
      delegationScope: 'Unknown',
    },
    metadata: data.metadata ?? {
      schemaVersion: '1.3.0',
      scannerVersion: 'unknown',
      fileName: 'unknown',
      fileSize: 0,
      scannedAt: new Date().toISOString(),
      detectedLanguage: 'Unknown',
      detectedFramework: null,
      selectedPlatform: null,
      agentName: null,
      scanDuration: 0,
    },
    saved: data.saved === true,
    reportUrl: data.reportUrl ?? null,
  } as ScanResult
}

/**
 * Scan an agent configuration for execution trust issues.
 *
 * @example
 * import { scan } from 'agentverify'
 *
 * const result = await scan(
 *   { content: agentCode, fileName: 'agent.js' },
 *   { apiKey: process.env.AGENTVERIFY_API_KEY }
 * )
 *
 * result.verdict    // 'VERIFIED' | 'NOT_VERIFIED' | 'NOT_ASSESSED'
 * result.riskScore  // 0-100
 * result.findings   // Array of findings
 */
export async function scan(
  input: ScanInput,
  options: ScanOptions
): Promise<ScanResult> {
  const { apiKey, apiUrl = DEFAULT_API_URL, timeout = DEFAULT_TIMEOUT } = options

  if (!apiKey) {
    throw new Error(
      'API key required. Generate one at https://aimodularity.com/agentverify/dashboard'
    )
  }

  if (!input.content || input.content.trim().length === 0) {
    throw new Error('content is required and cannot be empty')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'agentverify-sdk/1.0.0',
      },
      body: JSON.stringify({
        content: input.content,
        fileName: input.fileName ?? 'agent',
        platform: input.platform,
      }),
      signal: controller.signal,
    })

    if (response.status === 401) {
      throw new Error(
        'Invalid or unauthorized Agent Verify API key. Generate a valid key at https://aimodularity.com/agentverify/dashboard/'
      )
    }

    if (response.status === 400) {
      const err = await response.json().catch(() => ({})) as { error?: string }
      throw new Error(err.error ?? 'Invalid request')
    }

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json() as Partial<ScanResult>
    return normalizeScanResult(data)
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Scan multiple files concurrently.
 *
 * @example
 * import { scanMany } from 'agentverify'
 *
 * const results = await scanMany(files, { apiKey: 'av_...' })
 */
export async function scanMany(
  inputs: ScanInput[],
  options: ScanOptions,
  concurrency = 3
): Promise<Array<{ input: ScanInput; result: ScanResult | null; error: string | null }>> {
  const results: Array<{ input: ScanInput; result: ScanResult | null; error: string | null }> = []

  // Process in batches to respect concurrency limit
  for (let i = 0; i < inputs.length; i += concurrency) {
    const batch = inputs.slice(i, i + concurrency)
    const batchResults = await Promise.allSettled(
      batch.map(input => scan(input, options))
    )
    batchResults.forEach((res, j) => {
      if (res.status === 'fulfilled') {
        results.push({ input: batch[j], result: res.value, error: null })
      } else {
        results.push({ input: batch[j], result: null, error: res.reason instanceof Error ? res.reason.message : String(res.reason) })
      }
    })
  }

  return results
}
