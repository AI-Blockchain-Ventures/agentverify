'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import type { User } from 'firebase/auth'
import type { Finding } from '@/types'
import { getApiBaseUrl } from '@/lib/billing'
import { copyToClipboard } from '@/lib/clipboard'
import { A2SPA_DOCS_URL } from '@/lib/links'

interface CheckResult { riskScore: number; verdict: string; findings: Finding[] }

export interface FixWorkspaceProps {
  /** The code that was scanned, when the browser still has it (right after a dashboard scan). */
  initialContent?: string
  fileName: string
  platform?: string | null
  reportId: string
  user: User
  findings: Finding[]
  baseScore: number
  canUse: boolean
  /** Saves the edited code as a new report (a normal scan). Only offered on the dashboard. */
  onSaveAsNewScan?: (content: string) => void
}

const sevStyle: Record<string, string> = {
  critical: 'bg-[#E03E3E]/10 text-[color:var(--accent-red-text)]',
  high: 'bg-[#E07B39]/10 text-[color:var(--accent-orange-text)]',
  medium: 'bg-[#7C3AED]/10 text-[color:var(--accent-purple-text)]',
  low: 'bg-[var(--text-muted)]/10 text-[var(--text-muted)]',
}
// A basic shared-secret request check, as the AI fixer writes it (JavaScript or Python).
const SIGNING = /createHmac|hmac\.new\(|\bHMAC\b/i
const sevOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

/**
 * Pro "Fix & re-check" loop: edit the code (or let AI fix it), check it again in seconds without using
 * a monthly scan, repeat until the score is where you want it, then save it as a new report.
 */
export function FixWorkspace({ initialContent = '', fileName, platform, reportId, user, findings, baseScore, canUse, onSaveAsNewScan }: FixWorkspaceProps) {
  const [code, setCode] = useState(initialContent)
  const [check, setCheck] = useState<CheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // Set when an AI fix added a basic shared-secret (HMAC) request check, so we can point to A2SPA.
  const [addedSigning, setAddedSigning] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const editor = useRef<HTMLTextAreaElement>(null)

  const issues = [...(check ? check.findings : findings)].sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9))
  const score = check ? check.riskScore : baseScore
  const delta = score - baseScore
  const edited = code !== initialContent

  if (!canUse) {
    return (
      <section id="av-fixloop" style={{ backgroundColor: 'var(--card)', border: '1px solid #7C3AED55' }} className="no-print mb-6 scroll-mt-32 rounded-3xl p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-purple-text)]">Fix &amp; re-check · Pro</p>
        <h2 style={{ color: 'var(--text-primary)' }} className="mt-1 text-lg font-semibold">Get this agent to a high score, step by step</h2>
        <ul style={{ color: 'var(--text-secondary)' }} className="mt-3 space-y-1.5 text-sm">
          <li>• See the corrected code for every finding, next to your own code</li>
          <li>• Let AI rewrite the file to fix the findings, then review it</li>
          <li>• Re-check your changes in seconds, as often as you like, without using a scan</li>
        </ul>
        <Link href="/pricing" className="mt-4 inline-flex rounded-xl bg-[#7C3AED] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-85">Try Pro free for 14 days</Link>
      </section>
    )
  }

  const flash = (key: string) => { setCopied(key); setTimeout(() => setCopied(null), 2000) }

  const runCheck = async (content = code) => {
    if (!content.trim()) { setError('Paste your code first.'); return }
    setChecking(true); setError(null); setNote(null)
    try {
      const res = await fetch(`${getApiBaseUrl()}/v1/verify-fix`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, findingCode: 'ALL', fixedContent: content, fileName, platform: platform ?? undefined }),
      })
      const data = await res.json().catch(() => ({})) as { rescan?: CheckResult; error?: string }
      if (!res.ok || !data.rescan) { setError(data.error ?? 'Could not check your changes. Try again.'); return }
      setCheck(data.rescan)
    } catch {
      setError('Network error while checking. Try again.')
    } finally {
      setChecking(false)
    }
  }

  const aiFix = async () => {
    if (!code.trim()) { setError('Paste your code first.'); return }
    setAiBusy(true); setError(null); setNote(null); setAddedSigning(false)
    try {
      const res = await fetch(`${getApiBaseUrl()}/v1/fix/ai`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: code, fileName, platform: platform ?? undefined }),
      })
      const data = await res.json().catch(() => ({})) as { fixedContent?: string; before?: CheckResult; after?: CheckResult; unchanged?: boolean; error?: string }
      if (!res.ok || !data.fixedContent || !data.after) { setError(data.error ?? 'The AI fix did not work this time. Try again.'); return }
      if (data.unchanged) { setNote('Nothing to fix in this code.'); setCheck(data.after); return }
      const before = data.before?.riskScore ?? score
      if (data.after.riskScore < before) {
        setNote(`The AI version scored lower (${data.after.riskScore} vs ${before}), so your code was kept. Try the suggested fixes below instead.`)
        return
      }
      setCode(data.fixedContent)
      setCheck(data.after)
      setAddedSigning(SIGNING.test(data.fixedContent) && !SIGNING.test(code))
      setNote(`AI fixed version is in the editor: score ${before} → ${data.after.riskScore}. Read it over before you use it; AI can make mistakes.`)
    } catch {
      setError('Network error while fixing. Try again.')
    } finally {
      setAiBusy(false)
    }
  }

  const showLine = (line?: number) => {
    const el = editor.current
    if (!el || !line || !code) return
    const lines = code.split('\n')
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0)
    const end = start + (lines[line - 1]?.length ?? 0)
    el.focus()
    el.setSelectionRange(start, end)
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 18
    el.scrollTop = Math.max(0, (line - 4) * lineHeight)
  }

  const download = () => {
    const blob = new Blob([code], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = fileName.split(/[\\/]/).pop() || 'agent.txt'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const btn = 'rounded-xl px-4 py-2 text-sm font-semibold hover:opacity-85 disabled:opacity-50'
  const outline = { border: '1px solid var(--border)', color: 'var(--text-primary)' }

  return (
    <section id="av-fixloop" data-testid="fix-workspace" style={{ backgroundColor: 'var(--card)', border: '1px solid #7C3AED55' }} className="no-print mb-6 scroll-mt-32 rounded-3xl p-5 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-purple-text)]">Fix &amp; re-check</p>
          <h2 style={{ color: 'var(--text-primary)' }} className="mt-1 text-lg font-semibold">Fix it here, then check again</h2>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">Edit the code or let AI fix it, then press Check. Checks are instant and don&apos;t use your monthly scans. Your code is not stored.</p>
        </div>
        <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="shrink-0 rounded-2xl px-4 py-3 text-center">
          <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wider">{check ? 'Latest check' : 'Current score'}</p>
          <p data-testid="fix-score" className={`text-2xl font-bold ${score >= 90 ? 'text-[color:var(--accent-green-text)]' : score >= 70 ? 'text-[color:var(--accent-orange-text)]' : 'text-[color:var(--accent-red-text)]'}`}>{score}<span style={{ color: 'var(--text-muted)' }} className="text-sm">/100</span></p>
          {check && delta !== 0 && <p className={`text-xs font-semibold ${delta > 0 ? 'text-[color:var(--accent-green-text)]' : 'text-[color:var(--accent-red-text)]'}`}>{delta > 0 ? '+' : ''}{delta} from {baseScore}</p>}
          {check && <p style={{ color: 'var(--text-muted)' }} className="text-[11px]">{check.verdict === 'VERIFIED' ? 'Would pass ✓' : `${issues.length} issue${issues.length === 1 ? '' : 's'} left`}</p>}
        </div>
      </div>

      <textarea
        ref={editor}
        aria-label="Your agent code"
        value={code}
        onChange={e => setCode(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        placeholder={'Paste your agent code here.\nAgent Verify does not keep your code, so after leaving the page you paste it again to keep fixing.'}
        style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
        className="mt-4 h-72 w-full resize-y rounded-xl p-3 font-mono text-xs leading-[18px] outline-none focus:border-[#7C3AED]"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => void aiFix()} disabled={aiBusy || checking} className={`${btn} bg-[#7C3AED] text-white`}>{aiBusy ? 'Fixing… (up to a minute)' : '✨ Fix my file with AI'}</button>
        <button onClick={() => void runCheck()} disabled={aiBusy || checking} style={outline} className={btn}>{checking ? 'Checking…' : 'Check my changes'}</button>
        <button onClick={async () => { if (await copyToClipboard(code)) flash('code') }} disabled={!code} style={outline} className={btn}>{copied === 'code' ? '✓ Copied' : 'Copy code'}</button>
        <button onClick={download} disabled={!code} style={outline} className={btn}>Download</button>
        {edited && initialContent && <button onClick={() => { setCode(initialContent); setCheck(null); setNote(null) }} style={{ color: 'var(--text-muted)' }} className="px-2 text-xs font-semibold hover:opacity-70">Undo all changes</button>}
      </div>

      {error && <p role="alert" className="mt-3 text-sm font-semibold text-[color:var(--accent-red-text)]">{error}</p>}
      {note && <p role="status" style={{ color: 'var(--text-secondary)' }} className="mt-3 rounded-xl border border-[#7C3AED]/30 bg-[#7C3AED]/10 p-3 text-sm">{note}</p>}
      {addedSigning && (
        <p data-testid="a2spa-tip" style={{ color: 'var(--text-secondary)' }} className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs leading-5">
          The AI added a basic shared-secret check (HMAC) so only genuine requests make the agent act. Anyone holding that secret can sign requests, though. For a separate key per agent and signed proof of every action, see <a href={A2SPA_DOCS_URL} target="_blank" rel="noreferrer" className="font-semibold text-[color:var(--accent-purple-text)] underline">A2SPA</a>.
        </p>
      )}

      {check && onSaveAsNewScan && delta > 0 && (
        <div className="mt-4 flex flex-col gap-2 rounded-xl border border-[#10B981]/30 bg-[#10B981]/10 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p style={{ color: 'var(--text-primary)' }} className="text-sm">Happy with it? Save it as a new report to keep the higher score and share it.</p>
          <button onClick={() => onSaveAsNewScan(code)} className={`${btn} bg-[#10B981] text-white`}>Save as new report</button>
        </div>
      )}
      {check && !onSaveAsNewScan && delta > 0 && (
        <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">To save this as a new report, scan the updated file from your dashboard.</p>
      )}

      <div className="mt-5">
        <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{issues.length ? `${issues.length} thing${issues.length === 1 ? '' : 's'} to fix${check ? '' : ' (from the scan)'}` : 'Nothing left to fix 🎉'}</p>
        <div className="mt-2 space-y-2">
          {issues.slice(0, 30).map((f, i) => {
            const fix = f.fixCode || f.quickFix
            return (
              <details key={`${f.code}-${f.line ?? ''}-${i}`} style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="rounded-xl px-4 py-3">
                <summary className="flex cursor-pointer list-none items-start gap-2">
                  <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${sevStyle[f.severity] ?? sevStyle.low}`}>{f.severity}</span>
                  <span style={{ color: 'var(--text-primary)' }} className="flex-1 text-sm font-medium">{f.title}</span>
                  {f.line ? <button onClick={e => { e.preventDefault(); showLine(f.line) }} style={{ color: 'var(--accent-purple-text)' }} className="shrink-0 text-xs font-semibold hover:opacity-70">Line {f.line}</button> : null}
                </summary>
                <div className="mt-3 space-y-2">
                  {f.recommendedFix && <p style={{ color: 'var(--text-secondary)' }} className="whitespace-pre-line text-xs leading-relaxed">{f.recommendedFix}</p>}
                  {fix && (
                    <div className="relative">
                      <pre tabIndex={0} className="overflow-x-auto rounded-lg border border-[#00B37E]/20 bg-[#00B37E]/5 px-3 py-2 pr-16 font-mono text-xs leading-relaxed text-[color:var(--accent-green-text)]">{fix}</pre>
                      <button onClick={async () => { if (await copyToClipboard(fix)) flash(`fix-${i}`) }} style={{ border: '1px solid var(--border)', color: 'var(--text-muted)', backgroundColor: 'var(--card)' }} className="absolute right-2 top-2 rounded px-2 py-0.5 text-[11px] font-semibold">{copied === `fix-${i}` ? '✓' : 'Copy'}</button>
                    </div>
                  )}
                </div>
              </details>
            )
          })}
        </div>
      </div>
    </section>
  )
}
