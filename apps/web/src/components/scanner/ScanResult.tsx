'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { ScanResult as ScanResultType } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { CategoryScores } from './CategoryScores'
import { FindingCard } from './FindingCard'
import { RuntimeBOM } from './RuntimeBOM'
import { OptimizationTeaser } from './OptimizationTeaser'

export function ScanResult({ result, onNewScan, reportUrl }: { result: ScanResultType; onNewScan: () => void; reportUrl?: string }) {
  const verified = result.verdict === 'VERIFIED'
  const verdictRef = useRef<HTMLDivElement>(null)
  const [showSummary, setShowSummary] = useState(false)
  const [copied, setCopied] = useState(false)
  const catA = result.findings.filter(f => f.category === 'A').length
  const catB = result.findings.filter(f => f.category === 'B').length
  const issueText = result.findings.length === 0
    ? 'No issues detected — all checks passed'
    : `${result.findings.length} issue${result.findings.length === 1 ? '' : 's'} found across ${catA} protocol check${catA !== 1 ? 's' : ''} and ${catB} security check${catB !== 1 ? 's' : ''}`

  useEffect(() => {
    const target = verdictRef.current
    if (!target) return
    const observer = new IntersectionObserver(([entry]) => setShowSummary(!entry.isIntersecting), { threshold: 0 })
    observer.observe(target)
    return () => observer.disconnect()
  }, [])

  const copy = async () => {
    if (!reportUrl) return
    await navigator.clipboard.writeText(reportUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="mx-auto max-w-3xl pb-24">
      {/* Verdict card */}
      <div ref={verdictRef} className="mb-6 overflow-hidden rounded-xl border border-[#1E2D40] bg-[#0F1623] text-center">
        <div className={`h-1 w-full ${verified ? 'bg-[#10B981]' : 'bg-[#EF4444]'}`} />
        <div className="p-8">
          <div className={`text-2xl font-bold ${verified ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
            {verified ? '✓ Execution Authorized' : '✗ Execution Not Authorized'}
          </div>
          <p className="mt-2 text-sm text-[#4B6080]">{issueText}</p>
          <div className="mt-6 text-xs font-medium uppercase tracking-widest text-[#4B6080]">Risk Score</div>
          <div className="text-7xl font-bold tracking-tight text-white">
            {result.riskScore}
            <span className="text-2xl text-[#4B6080]">/100</span>
          </div>
          {result.findings.length === 0 ? (
            <p className="mt-2 text-xs text-[#10B981]">
              All 15 security checks passed
            </p>
          ) : (
            <p className="mt-2 text-xs text-[#4B6080]">
              {result.findings.filter(f => f.severity === 'critical').length} critical ·{' '}
              {result.findings.filter(f => f.severity === 'high').length} high ·{' '}
              {result.findings.filter(f => f.severity === 'medium').length} medium
            </p>
          )}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Badge variant={verified ? 'verified' : 'failed'}>{result.verdict}</Badge>
            <Badge variant="muted">{result.riskLevel}</Badge>
            <Badge variant="cli">{result.confidence}% confidence</Badge>
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-4 text-xs text-[#4B6080]">
            <span>{result.metadata.fileName}</span>
            {result.metadata.selectedPlatform && <span>{result.metadata.selectedPlatform}</span>}
            <span>{new Date(result.metadata.scannedAt).toLocaleString()}</span>
          </div>
        </div>
      </div>

      <CategoryScores scores={result.categoryScores} />

      {/* Findings */}
      <div className="mb-6">
        <h3 className="mb-3 font-semibold text-white">
          Findings
          {result.findings.length > 0 && (
            <span className="ml-2 rounded-full bg-[#0D1117] border border-[#1E2D40] px-2 py-0.5 text-xs text-[#4B6080]">
              {result.findings.length}
            </span>
          )}
        </h3>
        {result.findings.length ? (
          <div className="space-y-2">
            {result.findings.map(finding => <FindingCard key={finding.id} finding={finding} />)}
          </div>
        ) : (
          <div className="rounded-xl border border-[#10B981]/20 bg-[#10B981]/5 p-8 text-center">
            <div className="text-3xl mb-2">✓</div>
            <div className="font-semibold text-[#10B981]">No issues detected</div>
            <div className="mt-1 text-sm text-[#4B6080]">This agent passed all 15 security checks</div>
          </div>
        )}
      </div>

      <RuntimeBOM bom={result.bom} />
      <OptimizationTeaser findings={result.findings} />

      {/* Actions */}
      <div className="mt-8 flex flex-wrap gap-3">
        <button
          onClick={onNewScan}
          className="rounded-lg bg-[#06B6D4] px-5 py-2.5 text-sm font-semibold text-[#080B14] transition-colors hover:bg-[#22D3EE]"
        >
          Run New Scan
        </button>
        <button
          onClick={copy}
          disabled={!reportUrl}
          className="rounded-lg border border-[#1E2D40] px-5 py-2.5 text-sm font-semibold text-[#94A3B8] transition-colors hover:border-[#243244] hover:text-white disabled:opacity-30"
        >
          {copied ? 'Copied!' : 'Copy Report Link'}
        </button>
        {reportUrl && (
          <Link href={`/agentverify/report?id=${encodeURIComponent(result.reportId)}`}>
            <button className="rounded-lg border border-[#1E2D40] px-5 py-2.5 text-sm font-semibold text-[#94A3B8] transition-colors hover:border-[#243244] hover:text-white">
              View Full Report →
            </button>
          </Link>
        )}
      </div>

      {/* Sticky summary bar */}
      {showSummary && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-[#1E2D40] bg-[#080B14]/95 px-6 py-3 backdrop-blur-xl">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Badge variant={verified ? 'verified' : 'failed'}>{result.verdict}</Badge>
              <span className="text-sm font-medium text-white">Score {result.riskScore}/100</span>
              <span className="text-xs text-[#4B6080]">{result.findings.length} findings</span>
            </div>
            <button
              onClick={onNewScan}
              className="rounded-lg bg-[#06B6D4] px-4 py-1.5 text-xs font-semibold text-[#080B14] hover:bg-[#22D3EE]"
            >
              New Scan
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
