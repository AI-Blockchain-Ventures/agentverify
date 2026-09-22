'use client'

import { useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { getApiBaseUrl } from '@/lib/billing'
import { OWASP_PROFILE_ID, OWASP_ATTRIBUTION_DISCLAIMER } from '@/lib/owaspProfile'
import { OwaspProfileResult } from './OwaspProfileResult'
import type { ProfileAssessmentErrorResponse, ProfileAssessmentResponse } from '@/types/profileAssessment'

interface OwaspProfilePanelProps {
  user: User | null
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

/**
 * Requests an OWASP Agentic Skills profile assessment — an EXPLICIT, separate assessment option from the
 * standard scan (ScannerPanel), never a silent replacement for it (requirement 8). This component only calls
 * the existing `/v1/scan` API with `profile`/`attest` and renders exactly what it returns
 * (OwaspProfileResult); it never parses the submitted file, infers a status, or reimplements any AST
 * interpretation itself (requirement 9).
 */
export function OwaspProfilePanel({ user }: OwaspProfilePanelProps) {
  const [tab, setTab] = useState<'upload' | 'paste'>('paste')
  const [content, setContent] = useState('')
  const [fileName, setFileName] = useState('SKILL.md')
  const [attest, setAttest] = useState(false)
  const [drag, setDrag] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ProfileAssessmentResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const readFile = async (file: File) => {
    setError(null)
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)}MB, over the ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit.`)
      return
    }
    setFileName(file.name)
    setContent(await file.text())
    setTab('paste')
  }

  const run = async () => {
    if (!content.trim() || !user) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${getApiBaseUrl()}/v1/scan`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: OWASP_PROFILE_ID,
          files: [{ path: fileName || 'SKILL.md', content }],
          ...(attest ? { attest: true } : {}),
        }),
      })
      const data = await res.json().catch(() => ({})) as ProfileAssessmentResponse & ProfileAssessmentErrorResponse
      if (res.status === 200) {
        // The API's own returned contract is followed exactly: only a genuine 200 is ever rendered as a
        // result, whether or not attest:true was requested and whether or not it succeeded. A 422/503/500
        // in response to an attest:true request is never reinterpreted as "unsigned success" — it falls
        // through to the error handling below instead (requirement 10).
        setResult(data)
        return
      }
      setError(errorMessageFor(res.status, data))
    } catch {
      setError('Network error while assessing. Please retry.')
    } finally {
      setLoading(false)
    }
  }

  if (result) return <OwaspProfileResult response={result} onNewAssessment={() => setResult(null)} />

  return (
    <div className="mx-auto max-w-4xl rounded-[2rem] border border-[var(--border)] bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,0.10),transparent_32%),var(--card)] p-5 shadow-2xl shadow-black/10 backdrop-blur md:p-7">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-purple-text)]">OWASP profile assessment</p>
        <h2 style={{ color: 'var(--text-primary)' }} className="mt-2 text-2xl font-semibold tracking-tight">OWASP Agentic Skills Top 10</h2>
        <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">Assess a skill package against AST02 (Supply Chain Compromise), AST03 (Over-Privileged Skills), and AST04 (Insecure Metadata).</p>
      </div>

      <div style={{ borderBottom: '1px solid var(--border)' }} className="mb-6 flex gap-6 pb-3">
        <button onClick={() => setTab('upload')} style={{ color: tab === 'upload' ? 'var(--text-primary)' : 'var(--text-muted)' }} className={`text-sm font-medium hover:opacity-70 ${tab === 'upload' ? 'border-b-2 border-[#7C3AED] pb-3 -mb-3' : ''}`}>Upload file</button>
        <button onClick={() => setTab('paste')} style={{ color: tab === 'paste' ? 'var(--text-primary)' : 'var(--text-muted)' }} className={`text-sm font-medium hover:opacity-70 ${tab === 'paste' ? 'border-b-2 border-[#7C3AED] pb-3 -mb-3' : ''}`}>Paste content</button>
      </div>

      {tab === 'upload' ? (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); const file = e.dataTransfer.files[0]; if (file) void readFile(file) }}
          style={{ borderColor: drag ? '#7C3AED' : 'var(--border)', backgroundColor: drag ? 'rgba(124,58,237,0.05)' : 'transparent' }}
          className="cursor-pointer rounded-3xl border-2 border-dashed p-12 text-center transition-all hover:opacity-80"
        >
          <input ref={inputRef} type="file" className="hidden" accept=".md,.json,.yaml,.yml" onChange={e => { const file = e.target.files?.[0]; if (file) void readFile(file) }} />
          <div style={{ color: 'var(--text-muted)' }} className="mb-4 text-3xl">+</div>
          <div style={{ color: 'var(--text-primary)' }} className="font-medium">Drop your SKILL.md here</div>
          <div style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">or choose a file</div>
        </div>
      ) : (
        <div>
          <textarea
            aria-label="Skill content to assess"
            value={content}
            onChange={e => setContent(e.target.value)}
            style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
            className="h-48 w-full resize-none rounded-3xl p-4 font-mono text-sm outline-none placeholder:text-[var(--input-placeholder)] focus:border-[#7C3AED]/50 md:h-60"
            placeholder="Paste SKILL.md frontmatter and content here..."
          />
          <input
            value={fileName}
            onChange={e => setFileName(e.target.value)}
            style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
            className="mt-3 w-full rounded-2xl px-4 py-3 text-sm outline-none placeholder:text-[var(--input-placeholder)] focus:border-[#7C3AED]/50"
            placeholder="File name (e.g. SKILL.md)"
          />
        </div>
      )}

      <label className="mt-6 flex items-start gap-3 rounded-2xl border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
        <input type="checkbox" checked={attest} onChange={e => setAttest(e.target.checked)} className="mt-0.5" />
        <span>
          <span style={{ color: 'var(--text-primary)' }} className="block text-sm font-medium">Request cryptographic signing</span>
          <span style={{ color: 'var(--text-muted)' }} className="mt-0.5 block text-xs">
            Equivalent to <code className="rounded bg-[var(--card)] px-1 py-0.5 font-mono text-[11px]">attest: true</code>. Signing does not change the assessment result and costs the same one scan as an unsigned assessment.
          </span>
        </span>
      </label>

      {error && (
        <div className="mt-6 rounded-xl border border-[#E03E3E]/30 bg-[#E03E3E]/10 p-4">
          <p className="text-sm text-[color:var(--accent-red-text)]">{error}</p>
        </div>
      )}

      <button
        onClick={run}
        disabled={!content.trim() || loading}
        className="mt-6 w-full rounded-2xl bg-[#7C3AED] py-4 font-semibold text-white shadow-[0_18px_50px_rgba(124,58,237,0.22)] transition-colors hover:bg-[#06B6D4] hover:text-[#060A0F] disabled:opacity-30"
      >
        {loading ? 'Assessing...' : 'Run OWASP assessment'}
      </button>
      <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-center text-xs">{OWASP_ATTRIBUTION_DISCLAIMER}</p>
    </div>
  )
}

/** Maps the frozen, documented status codes to a customer-facing message. Never exposes an internal signer reason string or stack trace (requirement 10) — only the stable public `reason` code the API itself returns, when present. */
function errorMessageFor(status: number, data: ProfileAssessmentErrorResponse): string {
  if (status === 400) return data.error ?? 'That request could not be read as a skill package.'
  if (status === 401) return 'Sign in again to run an assessment.'
  if (status === 413) return 'That package is too large to assess.'
  if (status === 422) {
    const detail = data.rejection?.message ?? data.reason
    return `The package or assessment could not be admitted${detail ? `: ${detail}` : '.'}`
  }
  if (status === 429) return "You've used all the scans included this month. An OWASP assessment uses the same monthly scan quota as a standard scan."
  if (status === 503) return 'Signing is currently unavailable. The assessment itself may still succeed without requesting a signature.'
  if (status === 500) return 'Something went wrong while assessing this package. Please retry.'
  return data.error ?? 'Assessment failed. Please retry.'
}
