import type { NormalizedReport } from '@/lib/normalizeReport'
import { CategoryScores } from '@/components/scanner/CategoryScores'
import { FindingCard } from '@/components/scanner/FindingCard'
import { RuntimeBOM } from '@/components/scanner/RuntimeBOM'
import { BlastRadius } from '@/components/scanner/BlastRadius'
import { ControlsAndLimits } from '@/components/scanner/ControlsAndLimits'
import { Capabilities } from '@/components/scanner/Capabilities'
import { McpExposures } from '@/components/scanner/McpExposures'
import { SecurityCategories } from '@/components/scanner/SecurityCategories'
import { ScoreExplainer } from '@/components/scanner/ScoreExplainer'

/**
 * Full Technical Report — essentially everything Agent Verify knows about this scan, in one
 * place: every finding (uncollapsed context via FindingCard), every capability, every MCP
 * relationship, every category, every control, BOM, score calculation, and scanner metadata.
 * Explains results; never exposes the proprietary detection engine's implementation (regexes,
 * signal names, source) — only its OUTPUT, same as every other view.
 */
export function FullTechnicalReportView({ data, scannerVersion, schemaVersion, reportHash }: { data: NormalizedReport; scannerVersion?: string; schemaVersion?: string; reportHash?: string }) {
  return (
    <div className="space-y-6">
      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-5">
        <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Scan metadata</p>
        <div className="mt-2 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div><span style={{ color: 'var(--text-muted)' }}>Report ID</span><p style={{ color: 'var(--text-secondary)' }} className="font-mono">{data.reportId}</p></div>
          <div><span style={{ color: 'var(--text-muted)' }}>Scanned</span><p style={{ color: 'var(--text-secondary)' }}>{data.formattedDate}</p></div>
          {schemaVersion && <div><span style={{ color: 'var(--text-muted)' }}>Schema version</span><p style={{ color: 'var(--text-secondary)' }}>{schemaVersion}</p></div>}
          {scannerVersion && <div><span style={{ color: 'var(--text-muted)' }}>Scanner version</span><p style={{ color: 'var(--text-secondary)' }}>{scannerVersion}</p></div>}
        </div>
        {reportHash && (
          <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wider">Report integrity (SHA-256)</p>
            <code style={{ color: 'var(--text-secondary)' }} className="mt-1 block break-all font-mono text-[11px]">{reportHash}</code>
            <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-[11px]">Recomputing this hash from the same evidence and getting a match proves the stored data hasn&apos;t changed since it was hashed — it is not a signature and does not prove the scan itself was accurate. See docs for details.</p>
          </div>
        )}
        {data.artifactHash && (
          <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wider">Artifact fingerprint ({data.artifactHashAlgorithm ?? 'SHA-256'})</p>
            <code style={{ color: 'var(--text-secondary)' }} className="mt-1 block break-all font-mono text-[11px]">{data.artifactHash}</code>
            <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-[11px]">This identifies the exact artifact analyzed by this scan — a hash of the submitted content itself, independent of the scan result. The same content always produces this same fingerprint, even if scanned again later under a different ruleset version.</p>
          </div>
        )}
      </section>

      <RuntimeBOM bom={data.bom} />
      <Capabilities capabilities={data.capabilities} />
      <McpExposures exposures={data.mcpExposures} />
      <BlastRadius chains={data.capabilityChains} />
      <CategoryScores scores={data.categoryScores} />
      <SecurityCategories categories={data.securityCategories} />
      <ControlsAndLimits controls={data.securityControlsDetected} notDetermined={data.notDetermined} />

      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-5">
        <p style={{ color: 'var(--text-primary)' }} className="mb-3 text-sm font-semibold">Score calculation</p>
        <ScoreExplainer formula={data.reportInsights.scoreFormula} />
      </section>

      <div>
        <div className="mb-3 flex items-center gap-3">
          <h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-bold uppercase tracking-widest">All findings ({data.findings.length})</h2>
          <div style={{ backgroundColor: 'var(--border)' }} className="h-px flex-1" />
        </div>
        <div className="space-y-3">
          {data.findings.map(f => <FindingCard key={f.id} finding={f} />)}
        </div>
      </div>
    </div>
  )
}
