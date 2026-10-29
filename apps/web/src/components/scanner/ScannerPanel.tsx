'use client'

import { useRef, useState, type SyntheticEvent } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import type { ScanResult as ScanResultType } from '@/types'
import type { User } from 'firebase/auth'
import { ScanResult } from './ScanResult'
import { OwaspProfilePanel } from './OwaspProfilePanel'
import { trackScan } from '@/lib/analytics'
import { assetUrl } from '@/lib/assets'
import { getApiBaseUrl } from '@/lib/billing'
import { useBillingStatusState } from '@/lib/useBillingStatus'
import { SCAN_EXAMPLES as examples } from '@/lib/scanExamples'
import { importFromGitHub, importFromZip } from '@/lib/repoImport'

// The four examples shown by default; the rest sit behind "Show all".
const FEATURED_EXAMPLES = ['Prompt injection', 'MCP config', 'Risky payment', 'A2SPA-ready']

const ACCEPTED_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.md', '.txt', '.env.example', '.sh', '.ps1', '.ipynb']

const platforms = [
  { name: 'AWS', svg: '/platforms/aws.svg' },
  { name: 'Azure', svg: '/platforms/azure.svg' },
  { name: 'Google Cloud', svg: '/platforms/google-cloud.svg' },
  { name: 'IBM Cloud', svg: '/platforms/ibm-cloud.svg' },
  { name: 'Oracle', svg: '/platforms/Oracle.svg' },
]

interface ScannerPanelProps {
  user: User | null
  onScanComplete?: () => void
}

/** Explicit assessment-type choice. 'standard' is the default and preserves the pre-existing scan exactly; 'owasp' is an additive option, never a silent replacement (requirement 8). */
function AssessmentTypeToggle({ value, onChange }: { value: 'standard' | 'owasp'; onChange: (v: 'standard' | 'owasp') => void }) {
  return (
    <div role="tablist" aria-label="Assessment type" className="mb-4 flex flex-wrap gap-1.5 rounded-2xl p-1.5" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <button
        role="tab"
        aria-selected={value === 'standard'}
        onClick={() => onChange('standard')}
        style={{ backgroundColor: value === 'standard' ? 'var(--text-primary)' : 'transparent', color: value === 'standard' ? 'var(--bg)' : 'var(--text-muted)' }}
        className="rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors sm:text-sm"
      >
        Standard scan
      </button>
      <button
        role="tab"
        aria-selected={value === 'owasp'}
        onClick={() => onChange('owasp')}
        style={{ backgroundColor: value === 'owasp' ? 'var(--text-primary)' : 'transparent', color: value === 'owasp' ? 'var(--bg)' : 'var(--text-muted)' }}
        className="rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors sm:text-sm"
      >
        OWASP Agentic Skills profile
      </button>
    </div>
  )
}

export function ScannerPanel({ user, onScanComplete }: ScannerPanelProps) {
  const billing = useBillingStatusState(user)
  const billingStatus = billing.status
  // An explicit assessment-type choice, defaulting to the standard scan every existing client already gets —
  // choosing OWASP here is additive and never silently replaces a standard scan (requirement 8). Nothing
  // below this toggle in the 'standard' branch changes: same state, same run() function, same ScanResult.
  const [assessmentType, setAssessmentType] = useState<'standard' | 'owasp'>('standard')
  const [tab, setTab] = useState<'upload' | 'paste' | 'github' | 'mcp'>('paste')
  const [repoUrl, setRepoUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState('')
  const [importNotes, setImportNotes] = useState<string[]>([])
  const [showAllExamples, setShowAllExamples] = useState(false)
  const [content, setContent] = useState('')
  const [fileName, setFileName] = useState('')
  const [selectedPlatform, setSelectedPlatform] = useState('')
  const [drag, setDrag] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ScanResultType | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reject oversized files before ever reading them into memory — an unbounded file.text()
  // read on a multi-GB selection can hang or crash the tab well before the scanner's own
  // truncation guard ever runs.
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 // 5MB, across all selected files combined
  const MAX_FILES = 20
  // v1.6: several files (agent code + its config, MCP settings, Dockerfile...) can be scanned
  // together as one report. Each file is labeled with a header line so findings' line numbers and
  // evidence stay easy to trace back. Still one scan from the monthly quota.
  const readFiles = async (fileList: FileList | File[]) => {
    setUploadError(null)
    const files = Array.from(fileList)
    if (!files.length) return
    const zip = files.find(file => /\.zip$/i.test(file.name))
    if (zip) {
      if (files.length > 1) {
        setUploadError('Drop a single .zip on its own, or drop individual files without a .zip.')
        return
      }
      await runImport(() => importFromZip(zip, setImportProgress))
      return
    }
    setImportNotes([])
    if (files.length > MAX_FILES) {
      setUploadError(`You selected ${files.length} files. Scan up to ${MAX_FILES} files at a time — pick the agent code and its configuration rather than a whole project.`)
      return
    }
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
    if (totalBytes > MAX_UPLOAD_BYTES) {
      setUploadError(`${files.length === 1 ? `"${files[0].name}" is` : `These ${files.length} files are`} ${(totalBytes / 1024 / 1024).toFixed(1)}MB, over the ${MAX_UPLOAD_BYTES / 1024 / 1024}MB scan limit. Scan the specific agent files rather than a whole bundle or vendored directory.`)
      return
    }
    if (files.length === 1) {
      setFileName(files[0].name)
      setContent(await files[0].text())
    } else {
      const parts = await Promise.all(files.map(async file => `// ===== File: ${file.name} =====\n${await file.text()}`))
      setFileName(`${files[0].name} + ${files.length - 1} more`)
      setContent(parts.join('\n\n'))
    }
    setTab('paste')
  }

  // v1.6 project import (GitHub repo or .zip) — runs entirely in the browser; see lib/repoImport.ts.
  const runImport = async (load: () => Promise<{ content: string; fileName: string; notes: string[] }>) => {
    setUploadError(null)
    setScanError(null)
    setImporting(true)
    setImportProgress('Starting…')
    try {
      const imported = await load()
      setContent(imported.content)
      setFileName(imported.fileName)
      setImportNotes(imported.notes)
      setTab('paste')
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Import failed. Please try again.')
    } finally {
      setImporting(false)
      setImportProgress('')
    }
  }

  const clearInput = () => {
    setContent('')
    setFileName('')
    setImportNotes([])
    setUploadError(null)
    setScanError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  // The actual scan now runs server-side, in the Worker (POST /v1/scan, same endpoint the CLI
  // and API-key path already use — see workers/api/src/worker.ts) rather than in the browser:
  // this is what makes the monthly quota a real, server-enforced limit instead of a localStorage
  // counter anyone could clear, and it's also what keeps the proprietary scanner engine off the
  // client entirely (it no longer ships in this bundle at all).
  const run = async () => {
    if (!content.trim() || !user) return
    setLoading(true)
    setScanError(null)
    try {
      const res = await fetch(`${getApiBaseUrl()}/v1/scan`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          fileName: fileName || 'agent.txt',
          fileSize: content.length,
          platform: selectedPlatform || undefined,
        }),
      })
      const data = await res.json().catch(() => ({})) as (ScanResultType & { error?: string; limit?: number; used?: number; saved?: boolean })
      if (res.status === 429) {
        setScanError(`You've used all ${data.limit ?? billingStatus.scanQuota} scans included this month. ${billingStatus.plan === 'pro' ? 'Your quota resets next month.' : 'Upgrade to Pro for 100 scans/month.'}`)
        return
      }
      if (res.status === 401) {
        setScanError('Sign in again to scan.')
        return
      }
      if (res.status === 413) {
        setScanError('That content is too large to scan. Scan the specific agent file rather than a whole bundle.')
        return
      }
      if (!res.ok || !data.reportId) {
        setScanError(data.error ?? 'Scan failed. Please retry.')
        return
      }
      setResult(data)
      trackScan(data)
      billing.refresh() // real used-count changed server-side; reflect it without a full reload
      onScanComplete?.()
    } catch {
      setScanError('Network error while scanning. Please retry.')
    } finally {
      setLoading(false)
    }
  }

  if (result) return (
    <ScanResult
      result={result}
      originalContent={content}
      onNewScan={() => setResult(null)}
      reportUrl={`https://aimodularity.com/agentverify/report/?id=${encodeURIComponent(result.reportId)}`}
      billingStatus={billingStatus}
    />
  )

  // OWASP is an explicit, additive assessment option (requirement 8): selecting it renders a completely
  // separate panel (its own request UI, its own result rendering) rather than altering anything about the
  // standard scan below. Nothing in the 'standard' branch (state, run(), ScanResult) is reachable or changed
  // from this branch, and the reverse — the default ('standard') behavior below is byte-for-byte what existed
  // before this toggle, unaffected by the OWASP feature's existence.
  if (assessmentType === 'owasp') {
    return (
      <div className="mx-auto max-w-4xl">
        <AssessmentTypeToggle value={assessmentType} onChange={setAssessmentType} />
        <div className="mt-4">
          <OwaspProfilePanel user={user} />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl rounded-[2rem] border border-[var(--border)] bg-[radial-gradient(circle_at_top_right,rgba(6,182,212,0.10),transparent_32%),var(--card)] p-5 shadow-2xl shadow-black/10 backdrop-blur md:p-7">
      <AssessmentTypeToggle value={assessmentType} onChange={setAssessmentType} />
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-purple-text)]">Private scan</p>
        <h2 style={{ color: 'var(--text-primary)' }} className="mt-2 text-2xl font-semibold tracking-tight">Scan agent</h2>
        <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">Upload or paste your agent&apos;s code or config. You&apos;ll get a plain-English report with what to fix first.</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-[11px] font-semibold text-[color:var(--accent-purple-text)]">
          <span className="rounded-full bg-[#7C3AED]/10 px-3 py-1.5">Risk</span>
          <span className="rounded-full bg-[#7C3AED]/10 px-3 py-1.5">A2SPA</span>
          <span className="rounded-full bg-[#7C3AED]/10 px-3 py-1.5">Fixes</span>
        </div>
      </div>
      {/* Tabs */}
      <div style={{ borderBottom: '1px solid var(--border)' }} className="mb-6 flex gap-6 pb-3">
        <button
          onClick={() => setTab('upload')}
          style={{ color: tab === 'upload' ? 'var(--text-primary)' : 'var(--text-muted)' }}
          className={`text-sm font-medium transition-colors hover:opacity-70 ${tab === 'upload' ? 'border-b-2 border-[#06B6D4] pb-3 -mb-3' : ''}`}
        >
          Upload files
        </button>
        <button
          onClick={() => setTab('paste')}
          style={{ color: tab === 'paste' ? 'var(--text-primary)' : 'var(--text-muted)' }}
          className={`text-sm font-medium transition-colors hover:opacity-70 ${tab === 'paste' ? 'border-b-2 border-[#06B6D4] pb-3 -mb-3' : ''}`}
        >
          Paste code
        </button>
        <button
          onClick={() => setTab('github')}
          style={{ color: tab === 'github' ? 'var(--text-primary)' : 'var(--text-muted)' }}
          className={`text-sm font-medium transition-colors hover:opacity-70 ${tab === 'github' ? 'border-b-2 border-[#06B6D4] pb-3 -mb-3' : ''}`}
        >
          GitHub repo
        </button>
        <button
          onClick={() => setTab('mcp')}
          style={{ color: tab === 'mcp' ? 'var(--text-primary)' : 'var(--text-muted)' }}
          className={`text-sm font-medium transition-colors hover:opacity-70 ${tab === 'mcp' ? 'border-b-2 border-[#06B6D4] pb-3 -mb-3' : ''}`}
        >
          MCP config
        </button>
      </div>

      {uploadError && (
        <div className="mb-4 rounded-xl border border-[#E07B39]/30 bg-[#E07B39]/10 p-3">
          <p className="text-xs font-semibold text-[color:var(--accent-orange-text)]">Could not load that</p>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-xs">{uploadError}</p>
        </div>
      )}
      {importing && (
        <div className="mb-4 rounded-xl border border-[#06B6D4]/30 bg-[#06B6D4]/10 p-3" aria-live="polite">
          <p style={{ color: 'var(--text-primary)' }} className="text-xs font-semibold">{importProgress || 'Importing…'}</p>
        </div>
      )}
      {tab === 'github' ? (
        <div>
          <label htmlFor="github-repo-url" style={{ color: 'var(--text-primary)' }} className="block text-sm font-semibold">Scan a public GitHub repository</label>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs leading-5">Paste a repo link, or a link to the agent&apos;s folder (…/tree/main/agents). We pick the files that define the agent — code, tools, prompts, MCP and config — and skip dependencies and build output. Your browser downloads them straight from GitHub; nothing is scanned until you press Scan agent.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              id="github-repo-url"
              value={repoUrl}
              onChange={e => setRepoUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && repoUrl.trim() && !importing) void runImport(() => importFromGitHub(repoUrl, setImportProgress)) }}
              placeholder="https://github.com/owner/repo"
              style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
              className="w-full rounded-2xl px-4 py-3 text-sm outline-none placeholder:text-[var(--input-placeholder)] focus:border-[#06B6D4]/50"
            />
            <button
              onClick={() => void runImport(() => importFromGitHub(repoUrl, setImportProgress))}
              disabled={!repoUrl.trim() || importing}
              className="shrink-0 rounded-2xl bg-[#06B6D4] px-5 py-3 text-sm font-semibold text-[#060A0F] transition-opacity hover:opacity-85 disabled:opacity-40"
            >
              {importing ? 'Importing…' : 'Import files'}
            </button>
          </div>
          <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">Private repo? Download it as a .zip (Code → Download ZIP) and drop it on the Upload files tab.</p>
        </div>
      ) : tab === 'mcp' ? (
        <div>
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Check the MCP servers connected to your AI tools</p>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs leading-5">Your MCP config decides what Claude, Cursor, or VS Code can read, change, and send on your behalf. Agent Verify flags whole-drive file access, tokens pasted into the file, unpinned servers, unauthenticated remote servers, and tools set to run without asking.</p>
          <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="mt-4 rounded-2xl p-4 text-xs">
            <p style={{ color: 'var(--text-primary)' }} className="font-semibold">Where to find your config file</p>
            <ul style={{ color: 'var(--text-secondary)' }} className="mt-2 space-y-1.5 leading-5">
              <li><strong>Claude Desktop</strong> — Mac: <code>~/Library/Application Support/Claude/claude_desktop_config.json</code> · Windows: <code>%APPDATA%\Claude\claude_desktop_config.json</code> (or Settings → Developer → Edit Config)</li>
              <li><strong>Claude Code</strong> — <code>.mcp.json</code> in your project folder</li>
              <li><strong>Cursor</strong> — <code>~/.cursor/mcp.json</code> or <code>.cursor/mcp.json</code> in your project</li>
              <li><strong>VS Code</strong> — <code>.vscode/mcp.json</code> in your project</li>
              <li><strong>Windsurf / Cline</strong> — <code>mcp_config.json</code> / <code>cline_mcp_settings.json</code></li>
            </ul>
            <p style={{ color: 'var(--text-muted)' }} className="mt-3">Any detected token is redacted in the report — but if one is found, rotate it.</p>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button onClick={() => inputRef.current?.click()} className="rounded-2xl bg-[#06B6D4] px-4 py-2.5 text-sm font-semibold text-[#060A0F] transition-opacity hover:opacity-85">Choose config file</button>
            <button onClick={() => { setTab('paste'); setFileName('mcp.json'); setImportNotes([]) }} style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }} className="rounded-2xl px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-80">Paste config</button>
            <button onClick={() => { const ex = examples['MCP config']; setTab('paste'); setContent(ex.content); setFileName(ex.fileName); setImportNotes([]) }} style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }} className="rounded-2xl px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-80">Load a risky example</button>
          </div>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".json,.jsonc"
            onChange={e => { if (e.target.files?.length) void readFiles(e.target.files) }}
          />
        </div>
      ) : tab === 'upload' ? (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) void readFiles(e.dataTransfer.files) }}
          style={{ borderColor: drag ? '#06B6D4' : 'var(--border)', backgroundColor: drag ? 'rgba(6,182,212,0.05)' : 'transparent' }}
          className="cursor-pointer rounded-3xl border-2 border-dashed p-12 text-center transition-all hover:opacity-80"
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            multiple
            accept={[...ACCEPTED_EXTENSIONS, '.zip'].join(',')}
            onChange={e => { if (e.target.files?.length) void readFiles(e.target.files) }}
          />
          <div style={{ color: 'var(--text-muted)' }} className="mb-4 text-3xl">+</div>
          <div style={{ color: 'var(--text-primary)' }} className="font-medium">Drop your agent files — or a whole project .zip — here</div>
          <div style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">or choose files. Code and config together give the most accurate report (up to {MAX_FILES} files, 5MB total; a .zip is filtered to the agent files automatically)</div>
          <div style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">{ACCEPTED_EXTENSIONS.join(' ')}</div>
        </div>
      ) : (
        <div>
          {importNotes.length > 0 && (
            <div className="mb-3 rounded-xl border border-[#06B6D4]/30 bg-[#06B6D4]/10 p-3">
              {importNotes.map(note => <p key={note} style={{ color: 'var(--text-secondary)' }} className="text-xs leading-5">{note}</p>)}
              <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">Review below, then press Scan agent. This counts as one scan.</p>
            </div>
          )}
          <textarea
            aria-label="Agent code to scan"
            value={content}
            onChange={e => setContent(e.target.value)}
            style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
            className="h-44 w-full resize-y rounded-3xl p-4 font-mono text-sm outline-none transition-colors placeholder:text-[var(--input-placeholder)] focus:border-[#06B6D4]/50 md:h-52"
            placeholder="// Paste agent code or configuration here..."
          />
          <input
            value={fileName}
            onChange={e => setFileName(e.target.value)}
            style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
            className="mt-3 w-full rounded-2xl px-4 py-3 text-sm outline-none transition-colors placeholder:text-[var(--input-placeholder)] focus:border-[#06B6D4]/50"
            placeholder="File name (optional, for example agent.json)"
          />
          <div style={{ color: 'var(--text-muted)' }} className="mt-2 flex items-center justify-between text-xs">
            <span>{content ? `${content.split('\n').length.toLocaleString()} lines · ${(content.length / 1024).toFixed(1)} KB` : 'Tip: drop several files on the Upload tab to scan code and config together.'}</span>
            {content && <button onClick={clearInput} className="rounded-lg px-2 py-1 font-semibold underline-offset-2 hover:underline">Clear</button>}
          </div>
        </div>
      )}

      {/* Run button — directly under the input so a first-time user never has to scroll to find it */}
      {!billing.loading && billingStatus.used >= billingStatus.scanQuota && (
        <div className="mt-5 rounded-xl border border-[#E07B39]/30 bg-[#E07B39]/10 p-4">
          <p className="text-sm font-semibold text-[color:var(--accent-orange-text)]">You&apos;ve used all {billingStatus.scanQuota} scans included this month</p>
          <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-xs">
            {billingStatus.plan === 'pro' ? 'Your quota resets at the start of next month.' : 'Free includes 10 scans/month. Pro includes 100 scans/month plus full remediation and PDF export.'}
          </p>
          {billingStatus.plan !== 'pro' && <Link href="/pricing" className="mt-3 inline-flex rounded-lg bg-[#7C3AED] px-3 py-2 text-xs font-semibold text-white">View Pro</Link>}
        </div>
      )}
      {scanError && (
        <div className="mt-5 rounded-xl border border-[#E03E3E]/30 bg-[#E03E3E]/10 p-4">
          <p className="text-sm text-[color:var(--accent-red-text)]">{scanError}</p>
        </div>
      )}
      <button
        onClick={run}
        disabled={!content.trim() || loading || importing || (!billing.loading && billingStatus.used >= billingStatus.scanQuota)}
        className="mt-5 w-full rounded-2xl bg-[#7C3AED] py-4 font-semibold text-white hover:text-[#060A0F] shadow-[0_18px_50px_rgba(6,182,212,0.22)] transition-colors hover:bg-[#06B6D4] disabled:opacity-30"
      >
        {loading ? 'Scanning...' : 'Scan agent'}
      </button>
      <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-center text-xs">
        {content.trim()
          ? `Ready to scan ${fileName || 'your code'}. Uses 1 of your ${billingStatus.scanQuota} monthly scans.`
          : 'Add your code above — or pick an example below — then press Scan agent.'}
      </p>
      {content.length > 50000 && (
        <p className="mt-1 text-center text-xs text-[color:var(--accent-orange-text)]">Large file detected. The scan may take a little longer.</p>
      )}

      {/* Examples — four shown, the rest behind "Show all" */}
      <div className="mt-6 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Try an example</p>
            <p style={{ color: 'var(--text-muted)' }} className="mt-0.5 text-xs">Safe demo agents that show risky and fixed patterns.</p>
          </div>
          <button onClick={() => setShowAllExamples(v => !v)} className="shrink-0 text-xs font-semibold text-[color:var(--accent-purple-text)] underline-offset-2 hover:underline">
            {showAllExamples ? 'Show fewer' : `Show all ${Object.keys(examples).length}`}
          </button>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {Object.entries(examples).filter(([label]) => showAllExamples || FEATURED_EXAMPLES.includes(label)).map(([label, example]) => (
            <button
              key={label}
              style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              className="rounded-2xl bg-[var(--card)] px-3 py-2.5 text-left text-xs transition-colors hover:opacity-80"
              onClick={() => { setTab('paste'); setContent(example.content); setFileName(example.fileName); setImportNotes([]); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
            >
              <span style={{ color: 'var(--text-primary)' }} className="block font-semibold">{label}</span>
              <span className="mt-0.5 block leading-relaxed">{example.description}</span>
              {showAllExamples && <span style={{ color: 'var(--text-muted)' }} className="mt-1 block leading-relaxed">Checks: {example.demonstrates}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Optional details — the platform is a label on the report only; it does not change any result */}
      <details className="mt-4 rounded-2xl border border-[var(--border)] px-4 py-3">
        <summary style={{ color: 'var(--text-muted)' }} className="cursor-pointer text-xs font-medium">
          Optional: label the cloud platform{selectedPlatform ? ` (${selectedPlatform})` : ''}
        </summary>
        <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs">Shown on the report for your records. It does not change the checks or the score.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {platforms.map(item => (
            <button
              key={item.name}
              onClick={() => setSelectedPlatform(current => current === item.name ? '' : item.name)}
              aria-pressed={selectedPlatform === item.name}
              className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-colors md:px-3 md:py-2 ${
                selectedPlatform === item.name
                  ? 'border-[#7C3AED]/50 bg-[#7C3AED]/10 text-[color:var(--accent-purple-text)]'
                  : 'border-[var(--border)] text-[var(--text-muted)] hover:opacity-70'
              }`}
            >
              <Image
                src={assetUrl(item.svg)}
                alt={item.name}
                width={16}
                height={16}
                className="h-4 w-4"
                onError={(e: SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = 'none' }}
              />
              {item.name}
            </button>
          ))}
        </div>
      </details>

      <p style={{ color: 'var(--text-muted)' }} className="mt-4 text-center text-[11px] leading-5">
        Scans run through Agent Verify&apos;s secure API, never stored longer than needed to produce your report. Never paste a production private key into Agent Verify, source code, or a public repository. Store it in an environment variable or a secret manager.
      </p>
    </div>
  )
}
