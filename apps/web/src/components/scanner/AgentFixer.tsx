'use client'

import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import type { ScanResult } from '@/types'
import { canCreateFixPr, findingKey, verifyFixCandidate, type VerifiedFix } from '@/lib/fixVerification'
import { copyToClipboard } from '@/lib/clipboard'

interface AgentFixerProps {
  result: ScanResult
  originalContent: string
  reportId: string
  user: User
}

/** Not currently wired into ReportView — kept correct and ready rather than deleted. Verification
 * now goes through the Worker (see fixVerification.ts), so this needs the report's real id and
 * the signed-in user's token for every fix it checks, hence the added props above. */
export function AgentFixer({ result, originalContent, reportId, user }: AgentFixerProps) {
  const [copied, setCopied] = useState<string | null>(null)
  const [prMessage, setPrMessage] = useState<string | null>(null)
  const [verifications, setVerifications] = useState<VerifiedFix[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setVerifications(null)
    Promise.all(
      result.findings.map(finding => verifyFixCandidate(result, originalContent, finding, reportId, () => user.getIdToken()))
    ).then(next => { if (!cancelled) setVerifications(next) })
    return () => { cancelled = true }
  }, [originalContent, result, reportId, user])

  const copy = async (text: string, key: string) => {
    if (await copyToClipboard(text)) {
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    }
  }

  const createFixPr = (fix: VerifiedFix) => {
    if (!canCreateFixPr(fix)) {
      setPrMessage('Create Fix PR is blocked because this fix is not verified by a re-scan.')
      return
    }
    setPrMessage('Verified fix is eligible for the Phase 3 GitHub App PR flow.')
  }

  return (
    <div className="space-y-4">
      <div style={{ borderBottom: '1px solid var(--border)' }} className="mb-6 pb-4">
        <h3 style={{ color: 'var(--text-primary)' }} className="mb-1 font-semibold">Agent Fixer</h3>
        <p style={{ color: 'var(--text-secondary)' }} className="text-sm">Each generated fix is re-scanned before it is marked verified. Unverified fixes cannot start a Fix PR.</p>
        {prMessage && <p className="mt-3 rounded-xl border border-[#E07B39]/30 bg-[#E07B39]/10 p-3 text-xs font-semibold text-[color:var(--accent-orange-text)]">{prMessage}</p>}
      </div>

      {result.findings.length === 0 ? (
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-xl p-4">
          <p style={{ color: 'var(--text-secondary)' }} className="text-sm">No fixes needed. This scan has no findings.</p>
        </div>
      ) : verifications === null ? (
        <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-xl p-4">
          <p style={{ color: 'var(--text-secondary)' }} className="text-sm">Verifying fixes…</p>
        </div>
      ) : (
        <div className="space-y-4">
          {verifications.map((fix, index) => (
            <div key={`${findingKey(fix.finding)}-${index}`} style={{ backgroundColor: 'var(--card)', border: `1px solid ${fix.verified ? 'rgba(0,179,126,0.35)' : 'rgba(224,123,57,0.35)'}` }} className="rounded-2xl p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{fix.finding.title}</p>
                  <div className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${fix.verified ? 'bg-[#00B37E]/10 text-[color:var(--accent-green-text)]' : 'bg-[#E07B39]/10 text-[color:var(--accent-orange-text)]'}`}>{fix.verified ? 'Verified Fix' : 'Suggested Fix - Not Verified'}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => copy(fix.fixedCode, `fix-${index}`)} style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }} className="rounded-xl px-3 py-2 text-xs font-semibold hover:opacity-75">{copied === `fix-${index}` ? 'Copied' : 'Copy fix'}</button>
                  <button onClick={() => createFixPr(fix)} disabled={!canCreateFixPr(fix)} className="rounded-xl bg-[#7C3AED] px-3 py-2 text-xs font-semibold text-white hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40">Create Fix PR</button>
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div>
                  <p style={{ color: 'var(--text-muted)' }} className="mb-2 text-xs font-semibold uppercase tracking-wider">Generated fix</p>
                  <pre style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)' }} className="max-h-80 overflow-auto rounded-xl p-4 font-mono text-xs leading-relaxed text-[color:var(--accent-purple-text)]">{fix.fixedCode}</pre>
                </div>
                <div>
                  <p style={{ color: 'var(--text-muted)' }} className="mb-2 text-xs font-semibold uppercase tracking-wider">Verification re-scan</p>
                  <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-xl p-4">
                    {fix.error || !fix.rescan ? (
                      <p className="text-sm text-[color:var(--accent-red-text)]">{fix.error ?? 'Could not verify this fix.'}</p>
                    ) : (
                      <>
                        <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{fix.rescan.verdict} - {fix.rescan.riskScore}/100 - {fix.rescan.findings.length} finding{fix.rescan.findings.length === 1 ? '' : 's'}</p>
                        <ul className="mt-3 space-y-2 text-xs">
                          <li className={fix.resolvedOriginal ? 'text-[color:var(--accent-green-text)]' : 'text-[color:var(--accent-orange-text)]'}>{fix.resolvedOriginal ? 'Original finding no longer appears.' : `Original finding still appears (${fix.remainingMatches.length}).`}</li>
                          <li className={fix.newFindings.length === 0 ? 'text-[color:var(--accent-green-text)]' : 'text-[color:var(--accent-orange-text)]'}>{fix.newFindings.length === 0 ? 'No new findings introduced.' : `${fix.newFindings.length} new finding${fix.newFindings.length === 1 ? '' : 's'} introduced.`}</li>
                        </ul>
                        {fix.newFindings.length > 0 && <div className="mt-3 space-y-1">{fix.newFindings.slice(0, 3).map(item => <p key={findingKey(item)} style={{ color: 'var(--text-secondary)' }} className="text-xs">- {item.title}</p>)}</div>}
                        {!fix.resolvedOriginal && <p style={{ color: 'var(--text-secondary)' }} className="mt-3 text-xs">The generated fix remains a suggestion because the vulnerability that triggered this fix is still present in the re-scan.</p>}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
