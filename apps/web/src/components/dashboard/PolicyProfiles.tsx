'use client'

import { useEffect, useMemo, useState } from 'react'
import type { User } from 'firebase/auth'
import { getReports } from '@/lib/scanStore'
import { groupReportsByAgent } from '@/lib/agentGrouping'
import { BUILTIN_POLICIES, evaluatePolicy, type PolicyId } from '@/lib/policies'
import type { StoredReport } from '@/types'

/**
 * Policy Profiles — browse the built-in policies (real requirements, not a fake editor) and,
 * optionally, evaluate one against a real agent's latest scan evidence. Evaluation reads the
 * scanner's existing findings/securityControlsDetected only — it never re-scans or alters them.
 */
export function PolicyProfiles({ user }: { user: User }) {
  const [reports, setReports] = useState<StoredReport[] | null>(null)
  const [selectedAgentKey, setSelectedAgentKey] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    getReports(user.uid).then(list => { if (!cancelled) setReports(list) }).catch(() => { if (!cancelled) setReports([]) })
    return () => { cancelled = true }
  }, [user.uid])

  const namedGroups = useMemo(() => (reports ? groupReportsByAgent(reports).filter(g => g.agentName !== null) : []), [reports])
  const selectedGroup = namedGroups.find(g => g.key === selectedAgentKey) ?? null
  const latestReport = selectedGroup?.reports[0] ?? null

  return (
    <div className="space-y-5">
      <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-2xl p-4">
        <p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed">
          Policies evaluate an agent&apos;s existing scan evidence against a deployment context — they never change how the scanner itself detects findings. Pick an agent below to see a live evaluation, or just browse the built-in profiles.
        </p>
        {namedGroups.length > 0 && (
          <select
            value={selectedAgentKey}
            onChange={e => setSelectedAgentKey(e.target.value)}
            aria-label="Evaluate policy against agent"
            style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
            className="mt-3 w-full max-w-xs rounded-xl px-3 py-2 text-sm outline-none"
          >
            <option value="">Browse only (no agent selected)</option>
            {namedGroups.map(g => (
              <option key={g.key} value={g.key}>{g.displayName}</option>
            ))}
          </select>
        )}
      </div>

      <div className="av-stagger grid gap-4 md:grid-cols-2">
        {BUILTIN_POLICIES.map(policy => {
          const evaluation = latestReport ? evaluatePolicy(latestReport, policy) : null
          return (
            <div key={policy.id} style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="av-hover-lift rounded-3xl p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p style={{ color: 'var(--text-primary)' }} className="text-base font-semibold">{policy.name}</p>
                  <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs leading-relaxed">{policy.description}</p>
                </div>
                {evaluation && (
                  <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${evaluation.pass ? 'bg-[#00B37E]/10 text-[color:var(--accent-green-text)]' : 'bg-[#E03E3E]/10 text-[color:var(--accent-red-text)]'}`}>
                    {evaluation.pass ? 'PASS' : 'FAIL'}
                  </span>
                )}
              </div>
              <div style={{ borderTop: '1px solid var(--border)' }} className="mt-3 space-y-1.5 pt-3">
                {policy.requirements.map((req, i) => (
                  <p key={i} style={{ color: 'var(--text-muted)' }} className="flex gap-2 text-xs leading-relaxed">
                    <span aria-hidden="true">·</span><span>{req}</span>
                  </p>
                ))}
              </div>
              {evaluation && !evaluation.pass && (
                <div style={{ borderTop: '1px solid var(--border)' }} className="av-animate-fade mt-3 space-y-1.5 pt-3">
                  <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wide">Why {selectedGroup?.displayName} fails this policy</p>
                  {evaluation.reasons.map((r, i) => (
                    <p key={i} className="text-xs leading-relaxed text-[color:var(--accent-red-text)]">{r}</p>
                  ))}
                </div>
              )}
              {evaluation && evaluation.pass && (
                <p className="mt-3 text-xs font-medium text-[color:var(--accent-green-text)]">{selectedGroup?.displayName} meets every requirement of this policy based on its latest scan.</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export type { PolicyId }
