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
    <div className="mx-auto max-w-lg space-y-6">
      <section className="rounded-xl border border-[#1E2D40] bg-[#0F1623] p-6">
        <h2 className="font-semibold text-white">Your API Key</h2>
        <p className="mb-4 mt-1 text-xs text-[#4B6080]">You&apos;ll need this to run scans.</p>

        {keyLoading ? (
          <div className="h-10 animate-pulse rounded-lg bg-[#080B14]" />
        ) : apiKey ? (
          <>
            <div className="flex gap-2">
              <input
                readOnly
                value={apiKey}
                className="flex-1 rounded-lg border border-[#1E2D40] bg-[#080B14] px-4 py-2.5 font-mono text-sm text-[#06B6D4] outline-none"
              />
              <button
                onClick={copyKey}
                className="min-w-[70px] rounded-lg border border-[#1E2D40] px-4 py-2.5 text-sm text-[#94A3B8] transition-colors hover:text-white"
              >
                {keyCopied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <p className="mt-2 text-xs text-[#4B6080]">Never share this key or commit it to version control</p>
            <button
              onClick={generateKey}
              className="mt-2 inline-block cursor-pointer text-xs text-[#4B6080] transition-colors hover:text-white"
            >
              Regenerate
            </button>
          </>
        ) : (
          <button
            onClick={generateKey}
            className="w-full rounded-lg bg-[#06B6D4] py-3 font-semibold text-[#080B14] transition-colors hover:bg-[#22D3EE]"
          >
            Generate API Key
          </button>
        )}

        {keyError && <p className="mt-2 text-xs text-[#EF4444]">{keyError}</p>}
      </section>

      <section className="rounded-xl border border-[#1E2D40] bg-[#0F1623] p-6">
        <h2 className="font-semibold text-white">Scan your project</h2>
        <p className="mb-5 mt-1 text-xs text-[#4B6080]">Install once, scan any project from your terminal.</p>

        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[#4B6080]">Install</p>
        <div className="relative">
          <pre className="rounded-lg border border-[#1E2D40] bg-[#080B14] px-4 py-3 font-mono text-sm text-[#06B6D4]">{installCommand}</pre>
          <button
            onClick={copyInstall}
            className="absolute right-2 top-2 rounded border border-[#1E2D40] bg-[#080B14] px-2 py-1 text-xs text-[#4B6080] transition-colors hover:text-white"
          >
            {installCopied ? '✓' : 'Copy'}
          </button>
        </div>

        <p className="mb-2 mt-4 text-xs font-medium uppercase tracking-wider text-[#4B6080]">Scan</p>
        <div className="relative">
          <pre className="overflow-x-auto rounded-lg border border-[#1E2D40] bg-[#080B14] px-4 py-3 font-mono text-sm text-[#06B6D4]">{scanCommand}</pre>
          <button
            onClick={copyScan}
            className="absolute right-2 top-2 rounded border border-[#1E2D40] bg-[#080B14] px-2 py-1 text-xs text-[#4B6080] transition-colors hover:text-white"
          >
            {scanCopied ? '✓' : 'Copy'}
          </button>
        </div>

        <p className="mt-3 text-xs text-[#4B6080]">
          Scans every agent file in your project. Results save to your Reports tab automatically.
        </p>
      </section>

      <p className="text-center text-xs text-[#4B6080]">
        Need help?{' '}
        <a href="mailto:hello@aiblockchainventures.com" className="text-[#94A3B8] transition-colors hover:text-white">
          hello@aiblockchainventures.com
        </a>
      </p>
    </div>
  )
}
