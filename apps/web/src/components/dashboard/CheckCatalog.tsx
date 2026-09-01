'use client'

import { useEffect, useMemo, useState } from 'react'
import { getApiBaseUrl } from '@/lib/billing'

interface VerificationCheck {
  id: string
  code: string
  isFamily: boolean
  name: string
  category: string
  description: string
  severity: string
  detectionType: string
  evidenceType: string
  supportedContent: string
  whatItDetects: string
  whyItMatters: string
  remediation: string
  status: string
}

interface RiskFamily {
  id: string
  label: string
  description: string
  categories: string[]
}

interface CatalogSummary {
  totalImplemented: number
  totalPlanned: number
  byCategory: Record<string, number>
  capabilityDetectors: number
  mcpToolClassifiers: number
  capabilityChainRules: number
  threatCategories: number
  securityCategories: number
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
const SEVERITY_STYLE: Record<string, string> = {
  critical: 'bg-[#E03E3E]/10 text-[color:var(--accent-red-text)]',
  high: 'bg-[#F59E0B]/10 text-[color:var(--accent-orange-text)]',
  medium: 'bg-[#EAB308]/10 text-[color:var(--accent-yellow-text,#a16207)]',
  low: 'bg-[#06B6D4]/10 text-[color:var(--accent-cyan-text)]',
}

/**
 * Verification Checks — makes the real, auditable check catalog (packages/scanner/src/catalog.ts)
 * a first-class destination instead of something only documented in prose on /docs. Shows what
 * each real check detects, its severity, and why it matters — no regex, no internal pattern
 * strings, nothing that exposes the proprietary detection engine's implementation.
 *
 * Fetched from the Worker's public GET /v1/checks/catalog rather than imported from
 * @agentverify/scanner directly — catalog.ts transitively imports the real secret-detection
 * pattern table to build itself, so it must never be pulled into a client bundle even though the
 * catalog data it produces is itself public. See docs/private-scanner-boundary.md.
 */
export function CheckCatalog() {
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [checks, setChecks] = useState<VerificationCheck[] | null>(null)
  const [summary, setSummary] = useState<CatalogSummary | null>(null)
  const [riskTaxonomy, setRiskTaxonomy] = useState<RiskFamily[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`${getApiBaseUrl()}/v1/checks/catalog`)
      .then(res => { if (!res.ok) throw new Error('catalog fetch failed'); return res.json() })
      .then((data: { checks: VerificationCheck[]; summary: CatalogSummary; riskTaxonomy: RiskFamily[] }) => {
        if (cancelled) return
        setChecks(data.checks)
        setSummary(data.summary)
        setRiskTaxonomy(data.riskTaxonomy)
      })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [])

  const familyFor = (category: string) => riskTaxonomy.find(f => f.categories.includes(category))

  const filtered = useMemo(() => {
    let list = [...(checks ?? [])]
    if (categoryFilter !== 'all') list = list.filter(c => c.category === categoryFilter)
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.whatItDetects.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
    }
    return list.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) || a.id.localeCompare(b.id))
  }, [checks, categoryFilter, query])

  if (error) {
    return (
      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-8 text-center">
        <p style={{ color: 'var(--text-muted)' }} className="text-sm">Could not load the verification check catalog. Refresh to try again.</p>
      </div>
    )
  }

  if (!checks || !summary) {
    return (
      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-8 text-center">
        <p style={{ color: 'var(--text-muted)' }} className="text-sm">Loading check catalog…</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="av-stagger grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Real checks implemented', summary.totalImplemented],
          ['Capability detectors', summary.capabilityDetectors],
          ['MCP tool classifiers', summary.mcpToolClassifiers],
          ['Capability-chain rules', summary.capabilityChainRules],
        ].map(([label, value]) => (
          <div key={label as string} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="av-hover-lift rounded-2xl p-4">
            <p style={{ color: 'var(--text-primary)' }} className="text-2xl font-bold tabular-nums">{value}</p>
            <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">{label}</p>
          </div>
        ))}
      </div>
      <p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed">
        These are distinct, independently-tested pass/fail checks — not raw pattern count. Capability detectors, MCP tool classifiers, capability-chain rules, and threat categories are separate real classification systems, counted honestly on their own rather than folded into the check total.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search checks..."
          aria-label="Search verification checks"
          style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
          className="w-full rounded-xl px-4 py-2.5 text-sm outline-none sm:w-64"
        />
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCategoryFilter('all')}
            style={{ backgroundColor: categoryFilter === 'all' ? 'var(--text-primary)' : 'var(--card)', color: categoryFilter === 'all' ? 'var(--bg)' : 'var(--text-muted)', border: '1px solid var(--border)' }}
            className="av-transition rounded-full px-3 py-1.5 text-xs font-medium"
          >
            All families
          </button>
          {riskTaxonomy.map(family => (
            <button
              key={family.id}
              onClick={() => setCategoryFilter(family.categories[0] ?? 'all')}
              style={{
                backgroundColor: family.categories.includes(categoryFilter) ? 'var(--text-primary)' : 'var(--card)',
                color: family.categories.includes(categoryFilter) ? 'var(--bg)' : 'var(--text-muted)',
                border: '1px solid var(--border)',
              }}
              className="av-transition rounded-full px-3 py-1.5 text-xs font-medium"
              title={family.description}
            >
              {family.label}
            </button>
          ))}
        </div>
      </div>

      <div className="av-stagger space-y-2">
        {filtered.map(check => (
          <CheckRow key={check.id} check={check} family={familyFor(check.category)} />
        ))}
        {filtered.length === 0 && (
          <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-2xl p-8 text-center">
            <p style={{ color: 'var(--text-muted)' }} className="text-sm">No checks match this filter.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function CheckRow({ check, family }: { check: VerificationCheck; family: RiskFamily | undefined }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="av-transition overflow-hidden rounded-2xl">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left" aria-expanded={open}>
        <span style={{ color: 'var(--text-muted)' }} className="w-24 shrink-0 font-mono text-[11px]">{check.id}</span>
        <span style={{ color: 'var(--text-primary)' }} className="min-w-0 flex-1 truncate text-sm font-semibold">{check.name}</span>
        <span className={`hidden shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline ${SEVERITY_STYLE[check.severity] ?? ''}`}>{check.severity}</span>
        <span style={{ color: 'var(--text-muted)' }} className="hidden shrink-0 text-xs md:inline">{family?.label ?? check.category}</span>
        <span style={{ color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : undefined }} className="av-transition shrink-0 text-xs">▾</span>
      </button>
      {open && (
        <div style={{ borderTop: '1px solid var(--border)' }} className="av-animate-fade space-y-3 px-4 py-4 text-sm">
          <div className="flex flex-wrap gap-1.5 sm:hidden">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${SEVERITY_STYLE[check.severity] ?? ''}`}>{check.severity}</span>
            <span style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }} className="rounded-full px-2.5 py-1 text-[11px]">{family?.label ?? check.category}</span>
          </div>
          <div>
            <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wide">What it detects</p>
            <p style={{ color: 'var(--text-primary)' }} className="mt-1 leading-relaxed">{check.whatItDetects}</p>
          </div>
          <div>
            <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wide">Why it matters</p>
            <p style={{ color: 'var(--text-primary)' }} className="mt-1 leading-relaxed">{check.whyItMatters}</p>
          </div>
          <div>
            <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wide">How to fix it</p>
            <p style={{ color: 'var(--text-primary)' }} className="mt-1 leading-relaxed">{check.remediation}</p>
          </div>
          <p style={{ color: 'var(--text-muted)' }} className="text-xs">Applies to: {check.supportedContent}</p>
        </div>
      )}
    </div>
  )
}
