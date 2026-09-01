'use client'

import { useState } from 'react'
import type { NormalizedReport } from '@/lib/normalizeReport'
import { copyToClipboard } from '@/lib/clipboard'

/**
 * AI / JSON Report — the stable, schema-versioned machine-readable shape for CI/CD, SIEM, and
 * API clients. Built from the SAME NormalizedReport every other view uses — this is a
 * re-serialization of that canonical evidence, not a separately-computed report.
 * Schema: packages/scanner/schema/report.schema.json (validated in test/schema.test.mjs).
 */
export function AiJsonReportView({ data, reportHash }: { data: NormalizedReport; reportHash?: string }) {
  const [copied, setCopied] = useState(false)

  const jsonReport = {
    schemaVersion: '1.3.0',
    scanId: data.reportId,
    timestamp: data.scannedAt,
    verdict: data.verdict === 'VERIFIED' ? 'VERIFIED' : 'NOT_VERIFIED',
    riskScore: data.riskScore,
    riskLevel: data.riskLevel,
    confidence: data.confidence,
    scoreFormula: data.reportInsights.scoreFormula,
    agent: {
      fileName: data.fileName,
      agentName: data.bom.agentName,
      detectedLanguage: data.bom.detectedLanguage,
      detectedFramework: data.bom.detectedFramework,
      platform: data.platform,
    },
    findings: data.findings,
    securityCategories: data.securityCategories,
    capabilities: data.capabilities,
    mcpServers: data.mcpExposures,
    capabilityChains: data.capabilityChains,
    a2spaStatus: data.a2spaStatus ?? 'cannot_determine',
    securityControls: data.securityControlsDetected,
    runtimeBOM: data.bom,
    notDetermined: data.notDetermined,
    reportIntegrity: reportHash ? { reportHash, algorithm: 'SHA-256' } : null,
    artifactFingerprint: data.artifactHash
      ? { artifactHash: data.artifactHash, artifactHashAlgorithm: data.artifactHashAlgorithm ?? 'SHA-256', artifactFingerprintVersion: data.artifactFingerprintVersion ?? null }
      : null,
  }

  const text = JSON.stringify(jsonReport, null, 2)

  const copy = async () => {
    if (await copyToClipboard(text)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const download = () => {
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${data.reportId}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div>
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Schema-versioned JSON</p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-xs">schemaVersion {jsonReport.schemaVersion} · see /docs for the full field reference</p>
        </div>
        <div className="flex gap-2">
          <button onClick={copy} className="rounded-xl px-3.5 py-2 text-xs font-semibold" style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }}>{copied ? 'Copied' : 'Copy JSON'}</button>
          <button onClick={download} className="rounded-xl bg-[#7C3AED] px-3.5 py-2 text-xs font-semibold text-white">Download</button>
        </div>
      </div>
      <pre tabIndex={0} role="region" aria-label="Report JSON" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)' }} className="max-h-[70vh] overflow-auto rounded-2xl p-4 font-mono text-xs leading-relaxed text-[color:var(--accent-cyan-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#06B6D4]">
        {text}
      </pre>
    </div>
  )
}
