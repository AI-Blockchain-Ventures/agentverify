'use client'

import { useEffect, useRef, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/components/auth/AuthProvider'
import { trackAPIPage } from '@/lib/analytics'
import { copyToClipboard, selectTextIn } from '@/lib/clipboard'
import { isRetiredApiKey } from '@/lib/apiKeyRetirement'

const installCommand = 'npm install -g agentverify'

export function APIAccess() {
  const { user } = useAuth()
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [keyCreatedAt, setKeyCreatedAt] = useState<unknown>(null)
  const [keyLoading, setKeyLoading] = useState(true)
  const [keyError, setKeyError] = useState<string | null>(null)
  // What each Copy button shows: copied, or "press Ctrl+C" when the browser refused (the text is then selected).
  const [copyState, setCopyState] = useState<Record<string, 'ok' | 'manual'>>({})
  const keyRef = useRef<HTMLInputElement>(null)
  const installRef = useRef<HTMLPreElement>(null)
  const scanRef = useRef<HTMLPreElement>(null)

  const keyRetired = apiKey !== null && isRetiredApiKey(keyCreatedAt)
  const scanCommand = `agentverify scan . --key ${apiKey && !keyRetired ? apiKey : 'YOUR_KEY'}`

  useEffect(() => { trackAPIPage() }, [])
  useEffect(() => {
    if (!user) {
      setKeyLoading(false)
      return
    }
    setKeyLoading(true)
    getDoc(doc(db, 'users', user.uid, 'apiKeys', 'default'))
      .then(snap => {
        setApiKey(snap.exists() ? String(snap.data().key) : null)
        setKeyCreatedAt(snap.exists() ? snap.data().createdAt : null)
      })
      .finally(() => setKeyLoading(false))
  }, [user])

  const generateKey = async () => {
    if (!user) return
    setKeyLoading(true)
    setKeyError(null)
    try {
      const previousKey = apiKey
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

      // Regenerating must revoke the previous key — otherwise a rotated or leaked key
      // stays valid against the API forever. This is best-effort and must not block the
      // user from seeing their new (already-valid) key: if revocation fails, the new key
      // still works, and failing the whole flow here would hide a real success from the
      // user and could send them into a confusing retry loop.
      if (previousKey) {
        try {
          await setDoc(doc(db, 'apiKeyIndex', previousKey), {
            uid: user.uid,
            disabled: true,
            revokedAt: createdAt,
          }, { merge: true })
        } catch (revokeErr) {
          console.error('Failed to revoke previous API key:', revokeErr)
          setKeyError('New key created, but the previous key could not be revoked automatically. Treat it as compromised and contact support if needed.')
        }
      }

      setApiKey(newKey)
      setKeyCreatedAt(createdAt)
      window.dispatchEvent(new Event('agentverify:api-key-changed'))
    } catch (err) {
      console.error('Key generation error:', err)
      setKeyError('Failed to generate key. Please try again.')
    } finally {
      setKeyLoading(false)
    }
  }

  const copy = async (which: string, text: string | null, element: HTMLElement | null) => {
    if (!text) return
    const ok = await copyToClipboard(text)
    if (!ok) selectTextIn(element)
    setCopyState(s => ({ ...s, [which]: ok ? 'ok' : 'manual' }))
    setTimeout(() => setCopyState(s => { const next = { ...s }; delete next[which]; return next }), ok ? 2000 : 5000)
  }
  const copyLabel = (which: string, idle: string) => (copyState[which] === 'ok' ? '✓ Copied' : copyState[which] === 'manual' ? 'Press Ctrl+C' : idle)
  const copyColor = (which: string) => (copyState[which] === 'ok' ? 'var(--accent-green-text)' : copyState[which] === 'manual' ? 'var(--accent-orange-text)' : undefined)

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-6 shadow-xl shadow-black/5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-purple-text)]">CLI access</p>
        <h2 style={{ color: 'var(--text-primary)' }} className="font-semibold">API key</h2>
        <p style={{ color: 'var(--text-muted)' }} className="mb-4 mt-1 text-xs">Use this key to connect CLI scans to your Reports tab.</p>

        {keyLoading ? (
          <div style={{ backgroundColor: 'var(--input-bg)' }} className="h-10 animate-pulse rounded-lg" />
        ) : keyRetired ? (
          <div role="alert" style={{ border: '1px solid var(--accent-orange-text)' }} className="rounded-2xl p-4">
            <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">This key was retired for security</p>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-1 text-xs leading-relaxed">
              On November 24, 2026 we found and fixed a problem that let API keys be read by others, and retired every key made before the fix. Your old key no longer works. Create a new one, then update it wherever you use it: your terminal, CI, and the <code className="font-mono">AGENTVERIFY_API_KEY</code> setting for Agent Guard.
            </p>
            <p style={{ color: 'var(--text-muted)' }} className="mt-2 truncate font-mono text-xs line-through" aria-label="Retired key">{apiKey}</p>
            <button onClick={generateKey} className="mt-3 w-full rounded-2xl bg-[#7C3AED] py-3 font-semibold text-white transition-colors hover:bg-[#6D28D9]">
              Create new key
            </button>
          </div>
        ) : apiKey ? (
          <>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                ref={keyRef}
                readOnly
                aria-label="API key"
                value={apiKey}
                style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)' }}
                className="min-w-0 flex-1 rounded-lg px-4 py-2.5 font-mono text-sm text-[color:var(--accent-cyan-text)] outline-none"
              />
              <button
                onClick={() => copy('key', apiKey, keyRef.current)}
                aria-live="polite"
                style={{ border: '1px solid var(--border)', color: copyColor('key') ?? 'var(--text-secondary)' }}
                className="min-w-[110px] rounded-lg px-4 py-2.5 text-sm transition-colors hover:opacity-70"
              >
                {copyLabel('key', 'Copy')}
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
            className="w-full rounded-2xl bg-[#7C3AED] py-3 font-semibold text-white transition-colors hover:bg-[#6D28D9]"
          >
            Generate API key
          </button>
        )}

        {keyError && <p className="mt-2 text-xs text-[color:var(--accent-red-text)]">{keyError}</p>}
      </section>

      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-6 shadow-xl shadow-black/5">
        <h2 style={{ color: 'var(--text-primary)' }} className="font-semibold">Scan your project</h2>
        <p style={{ color: 'var(--text-muted)' }} className="mb-5 mt-1 text-xs">Install once, then create security reports from your terminal.</p>

        <p style={{ color: 'var(--text-muted)' }} className="mb-2 text-xs font-medium uppercase tracking-wider">Install</p>
        <div className="relative">
          <pre ref={installRef} tabIndex={0} role="region" aria-label="Install command" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)' }} className="overflow-x-auto rounded-lg px-4 py-3 pr-16 font-mono text-sm text-[color:var(--accent-purple-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#06B6D4]">{installCommand}</pre>
          <button
            onClick={() => copy('install', installCommand, installRef.current)}
            aria-live="polite"
            style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: copyColor('install') ?? 'var(--text-muted)' }}
            className="absolute right-2 top-2 rounded px-2 py-1 text-xs transition-colors hover:opacity-70"
          >
            {copyLabel('install', 'Copy')}
          </button>
        </div>

        <p style={{ color: 'var(--text-muted)' }} className="mb-2 mt-4 text-xs font-medium uppercase tracking-wider">Scan</p>
        <div className="relative">
          <pre ref={scanRef} tabIndex={0} role="region" aria-label="Scan command" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)' }} className="overflow-x-auto rounded-lg px-4 py-3 pr-16 font-mono text-sm text-[color:var(--accent-purple-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#06B6D4]">{scanCommand}</pre>
          <button
            onClick={() => copy('scan', scanCommand, scanRef.current)}
            aria-live="polite"
            style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: copyColor('scan') ?? 'var(--text-muted)' }}
            className="absolute right-2 top-2 rounded px-2 py-1 text-xs transition-colors hover:opacity-70"
          >
            {copyLabel('scan', 'Copy')}
          </button>
        </div>

        <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs">
          CLI results save to your Reports tab automatically. Do not place API keys or production secrets in source code.
        </p>
      </section>

      <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-6 shadow-xl shadow-black/5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-purple-text)]">Developer CI</p>
        <h2 style={{ color: 'var(--text-primary)' }} className="font-semibold">GitHub pull request scans</h2>
        <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs leading-relaxed">Add the Agent Verify GitHub Action (or run the CLI with `--ci`) to fail a pull request when it adds a critical or high-risk finding.</p>
        <a href="https://github.com/AI-Blockchain-Ventures/agentverify/blob/main/docs/github-action.md" target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-2xl border border-[#7C3AED]/30 px-4 py-2 text-xs font-semibold text-[color:var(--accent-purple-text)] transition-opacity hover:opacity-80">
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
