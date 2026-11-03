import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import Link from 'next/link'
import { scan } from '@agentverify/scanner'
import { DemoReportSwitcher, type DemoSample } from '@/components/report/DemoReportSwitcher'
import { DEMO_AGENTS } from '@/lib/demoAgents'
import type { ScanResult } from '@/types'

export const metadata: Metadata = { ...pageMetadata('/report/demo', 'Demo Report', 'One synthetic Finance Operations Agent scanned before, part-way through, and after fixing: real Agent Verify reports showing the score go from 0 to 100.'), robots: { index: true, follow: true } }

export default function DemoReportPage() {
  // Every version is scanned by the real engine at build time. The public demo shows the Free view, exactly
  // as the API returns it to a Free plan: every finding, but no fixes (same rule as
  // workers/api/src/entitlementView.ts — the fix text is not in the page).
  const samples: DemoSample[] = DEMO_AGENTS.map(agent => {
    const full = scan({ content: agent.content, fileName: agent.fileName, fileSize: agent.content.length, platform: 'Demo' })
    const result = {
      ...full,
      findings: full.findings.map(({ quickFix: _quickFix, fixCode: _fixCode, ...f }) =>
        (f.recommendedFix || _quickFix || _fixCode) ? { ...f, recommendedFix: '', fixLocked: true } : { ...f, quickFix: _quickFix, fixCode: _fixCode }),
    }
    return { id: agent.id, label: agent.label, summary: agent.summary, content: agent.content, result: result as unknown as ScanResult }
  })

  return (
    <main style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen">
      <div className="mx-auto max-w-3xl px-4 pt-6 md:px-6">
        <div style={{ backgroundColor: '#7C3AED1A', border: '1px solid #7C3AED55' }} className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-4">
          <div>
            {/* Dedicated token (not --accent-purple-text) — this banner's own translucent
                purple tint background needs more contrast margin than a solid surface does. */}
            <p style={{ color: 'var(--demo-banner-text)' }} className="text-xs font-bold uppercase tracking-[0.22em]">Demo report — synthetic data</p>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-sm">
              One synthetic <strong>Finance Operations Agent</strong>, shown before, part-way through, and after fixing. Each report is real output from Agent Verify&apos;s scan engine run on the code shown, not a real customer scan. Pick a version to see its findings and score.
            </p>
          </div>
          <Link href="/dashboard" className="shrink-0 rounded-xl bg-[#7C3AED] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90">Scan your own agent</Link>
        </div>
      </div>
      <DemoReportSwitcher samples={samples} />
    </main>
  )
}
