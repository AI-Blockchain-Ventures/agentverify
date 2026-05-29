'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { ScanResult as ScanResultType } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { CategoryScores } from './CategoryScores'
import { FindingCard } from './FindingCard'
import { RuntimeBOM } from './RuntimeBOM'
import { OptimizationTeaser } from './OptimizationTeaser'
import { AgentFixer } from './AgentFixer'
import { generateSummary } from '@/lib/generateSummary'

interface ScanResultProps {
  result: ScanResultType
  onNewScan: () => void
  reportUrl?: string
  originalContent?: string
}

export function ScanResult({ result, onNewScan, reportUrl, originalContent = '' }: ScanResultProps) {
  const verified = result.verdict === 'VERIFIED'
  const verdictRef = useRef<HTMLDivElement>(null)
  const [showSummary, setShowSummary] = useState(false)
  const [copied, setCopied] = useState(false)
  const [view, setView] = useState<'findings' | 'fixer'>('findings')
  const summary = generateSummary(result)
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
        <div className="p-5 md:p-8">
          <div className={`text-xl font-bold md:text-2xl ${verified ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
            {verified ? '✓ Execution Authorized' : '✗ Execution Not Authorized'}
          </div>
          <p className="mt-2 text-sm text-[#4B6080]">{issueText}</p>
          <div className="mt-6 text-xs font-medium uppercase tracking-widest text-[#4B6080]">Risk Score</div>
          <div className="text-5xl font-bold tracking-tight text-white md:text-7xl">
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
          <div className="mt-3 flex flex-wrap justify-center gap-4 text-xs text-[#3D5166]">
            <span>Scanned in {result.metadata.scanDuration ?? 0}ms</span>
            <span>·</span>
            <span>Optimization: {result.optimizationScore ?? 0}/50</span>
            <span>·</span>
            <span>{result.metadata.detectedLanguage}</span>
            {result.metadata.selectedPlatform && <><span>·</span><span>{result.metadata.selectedPlatform}</span></>}
          </div>
          <div className="mt-4 flex flex-col items-center justify-center gap-2 text-xs text-[#4B6080] sm:flex-row sm:flex-wrap sm:gap-4">
            <span>{result.metadata.fileName}</span>
            {result.metadata.selectedPlatform && <span>{result.metadata.selectedPlatform}</span>}
            <span>{new Date(result.metadata.scannedAt).toLocaleString()}</span>
          </div>
        </div>
      </div>

      <CategoryScores scores={result.categoryScores} />

      <div className="mb-6 rounded-xl border border-[#1A2535] bg-[#0D1321] p-5">
        <div className="mb-3 flex items-center gap-2"><span className="text-xs font-bold uppercase tracking-wider text-[#3D5166]">Executive Summary</span></div>
        <p className="mb-3 text-sm font-medium text-white">{summary.headline}</p>
        <ul className="mb-4 space-y-1.5">
          {summary.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-[#8896A8]"><span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${result.verdict === 'VERIFIED' ? 'bg-[#00B37E]' : 'bg-[#E03E3E]'}`} />{b}</li>
          ))}
        </ul>
        {result.verdict !== 'VERIFIED' && <div className="rounded-lg border border-[#E03E3E]/20 bg-[#E03E3E]/5 p-3"><p className="mb-1 text-xs font-medium text-[#E03E3E]">Attack Surface</p><p className="text-xs text-[#8896A8]">{summary.attackerView}</p></div>}
        <p className="mt-3 text-xs text-[#3D5166]">{summary.action}</p>
      </div>

      <div className="mb-6 flex gap-1 border-b border-[#1A2535]">
        <button onClick={() => setView('findings')} className={`px-4 py-2 text-sm font-medium transition-colors ${view === 'findings' ? '-mb-px border-b-2 border-[#00C4CC] text-white' : 'text-[#3D5166] hover:text-[#8896A8]'}`}>Findings ({result.findings.length})</button>
        <button onClick={() => setView('fixer')} className={`px-4 py-2 text-sm font-medium transition-colors ${view === 'fixer' ? '-mb-px border-b-2 border-[#00C4CC] text-white' : 'text-[#3D5166] hover:text-[#8896A8]'}`}>✦ Agent Fixer</button>
      </div>

      {/* Findings */}
      {view === 'findings' ? <div className="mb-6">
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
      </div> : <AgentFixer result={result} originalContent={originalContent} />}

      <RuntimeBOM bom={result.bom} />
      <OptimizationTeaser findings={result.findings} />

      {/* Actions */}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
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
          <Link href={`/report?id=${encodeURIComponent(result.reportId)}`}>
            <button className="w-full rounded-lg border border-[#1E2D40] px-5 py-2.5 text-sm font-semibold text-[#94A3B8] transition-colors hover:border-[#243244] hover:text-white sm:w-auto">
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
