'use client'

import { useEffect, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/components/auth/AuthProvider'
import { trackAPIPage } from '@/lib/analytics'

const installCommand = 'npm install -g agentverify'

export function APIAccess() {
  const { user } = useAuth()
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [keyLoading, setKeyLoading] = useState(true)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [keyCopied, setKeyCopied] = useState(false)
  const [installCopied, setInstallCopied] = useState(false)
  const [scanCopied, setScanCopied] = useState(false)

  const scanCommand = `agentverify scan . --key ${apiKey ?? 'YOUR_KEY'}`

  useEffect(() => { trackAPIPage() }, [])
  useEffect(() => {
    if (!user) {
      setKeyLoading(false)
      return
    }
    setKeyLoading(true)
    getDoc(doc(db, 'users', user.uid, 'apiKeys', 'default'))
      .then(snap => setApiKey(snap.exists() ? String(snap.data().key) : null))
      .finally(() => setKeyLoading(false))
  }, [user])

  const generateKey = async () => {
    if (!user) return
    setKeyLoading(true)
    setKeyError(null)
    try {
      const newKey = 'av_' + crypto.randomUUID().replace(/-/g, '')
      const createdAt = new Date().toISOString()

      await setDoc(doc(db, 'users', user.uid, 'apiKeys', 'default'), {
        key: newKey,
        uid: user.uid,
        createdAt,
      })

      await setDoc(doc(db, 'apiKeyIndex', newKey), {
        uid: user.uid,
        createdAt,
      })

      setApiKey(newKey)
    } catch (err) {
      console.error('Key generation error:', err)
      setKeyError('Failed to generate key. Please try again.')
    } finally {
      setKeyLoading(false)
    }
  }

  const copyKey = () => {
    if (!apiKey) return
    navigator.clipboard.writeText(apiKey)
    setKeyCopied(true)
    setTimeout(() => setKeyCopied(false), 2000)
  }

  const copyInstall = () => {
    navigator.clipboard.writeText(installCommand)
    setInstallCopied(true)
    setTimeout(() => setInstallCopied(false), 2000)
  }

  const copyScan = () => {
    navigator.clipboard.writeText(scanCommand)
    setScanCopied(true)
    setTimeout(() => setScanCopied(false), 2000)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-6 shadow-xl shadow-black/5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#00C4CC]">CLI access</p>
        <h2 style={{ color: 'var(--text-primary)' }} className="font-semibold">API key</h2>
        <p style={{ color: 'var(--text-muted)' }} className="mb-4 mt-1 text-xs">Use this key to connect CLI scans to your Reports tab.</p>

        {keyLoading ? (
          <div style={{ backgroundColor: 'var(--input-bg)' }} className="h-10 animate-pulse rounded-lg" />
        ) : apiKey ? (
          <>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                readOnly
                value={apiKey}
                style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)' }}
                className="min-w-0 flex-1 rounded-lg px-4 py-2.5 font-mono text-sm text-[#06B6D4] outline-none"
              />
              <button
                onClick={copyKey}
                style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                className="min-w-[70px] rounded-lg px-4 py-2.5 text-sm transition-colors hover:opacity-70"
              >
                {keyCopied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-xs">Never share this key or commit it to version control.</p>
            <button
              onClick={generateKey}
              style={{ color: 'var(--text-muted)' }}
              className="mt-2 inline-block cursor-pointer text-xs transition-colors hover:opacity-70"
            >
              Regenerate key
            </button>
          </>
        ) : (
          <button
            onClick={generateKey}
            className="w-full rounded-2xl bg-[#06B6D4] py-3 font-semibold text-[#080B14] transition-colors hover:bg-[#22D3EE]"
          >
            Generate API key
          </button>
        )}

        {keyError && <p className="mt-2 text-xs text-[#EF4444]">{keyError}</p>}
      </section>

      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-6 shadow-xl shadow-black/5">
        <h2 style={{ color: 'var(--text-primary)' }} className="font-semibold">Scan your project</h2>
        <p style={{ color: 'var(--text-muted)' }} className="mb-5 mt-1 text-xs">Install once, then create security reports from your terminal.</p>

        <p style={{ color: 'var(--text-muted)' }} className="mb-2 text-xs font-medium uppercase tracking-wider">Install</p>
        <div className="relative">
          <pre style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)' }} className="overflow-x-auto rounded-lg px-4 py-3 pr-16 font-mono text-sm text-[#00C4CC]">{installCommand}</pre>
          <button
            onClick={copyInstall}
            style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            className="absolute right-2 top-2 rounded px-2 py-1 text-xs transition-colors hover:opacity-70"
          >
            {installCopied ? '✓' : 'Copy'}
          </button>
        </div>

        <p style={{ color: 'var(--text-muted)' }} className="mb-2 mt-4 text-xs font-medium uppercase tracking-wider">Scan</p>
        <div className="relative">
          <pre style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)' }} className="overflow-x-auto rounded-lg px-4 py-3 pr-16 font-mono text-sm text-[#00C4CC]">{scanCommand}</pre>
          <button
            onClick={copyScan}
            style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            className="absolute right-2 top-2 rounded px-2 py-1 text-xs transition-colors hover:opacity-70"
          >
            {scanCopied ? '✓' : 'Copy'}
          </button>
        </div>

        <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">
          CLI results save to your Reports tab automatically. Do not place API keys or production secrets in source code.
        </p>
      </section>

      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-6 shadow-xl shadow-black/5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#00C4CC]">Developer CI</p>
        <h2 style={{ color: 'var(--text-primary)' }} className="font-semibold">GitHub pull request scans</h2>
        <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs leading-relaxed">Run Agent Verify in GitHub pull requests with the CLI and `--ci`. Production API enforcement must be deployed before broad rollout.</p>
        <a href="https://github.com/AI-Blockchain-Ventures/agentverify/blob/main/docs/github-action.md" target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-2xl border border-[#00C4CC]/30 px-4 py-2 text-xs font-semibold text-[#00C4CC] transition-opacity hover:opacity-80">
          View CI docs
        </a>
      </section>

      <p style={{ color: 'var(--text-muted)' }} className="text-center text-xs">
        Need help?{' '}
        <a href="mailto:hello@aiblockchainventures.com" style={{ color: 'var(--text-secondary)' }} className="transition-colors hover:opacity-70">
          hello@aiblockchainventures.com
        </a>
      </p>
    </div>
  )
}
