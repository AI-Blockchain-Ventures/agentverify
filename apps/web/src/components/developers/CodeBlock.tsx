'use client'

import { useState } from 'react'
import { copyToClipboard } from '@/lib/clipboard'

export function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="relative">
      <pre
        tabIndex={0}
        role="region"
        aria-label={label}
        style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
        className="overflow-x-auto rounded-2xl px-4 py-3.5 pr-20 font-mono text-xs leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#06B6D4]"
      >
        {code}
      </pre>
      <button
        onClick={async () => { if (await copyToClipboard(code)) { setCopied(true); setTimeout(() => setCopied(false), 2000) } }}
        style={{ border: '1px solid var(--border)', color: copied ? 'var(--accent-green-text)' : 'var(--text-muted)', backgroundColor: 'var(--card)' }}
        className="absolute right-2.5 top-2.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-opacity hover:opacity-70"
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
    </div>
  )
}
