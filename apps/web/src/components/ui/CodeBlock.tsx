'use client'

import { useState } from 'react'

interface CodeBlockProps {
  code: string
  language?: string
  showCopy?: boolean
  filename?: string
}

export function CodeBlock({ code, language, showCopy = true, filename }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const label = filename ?? language

  const copy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)' }} className="overflow-hidden rounded-lg">
      {label && (
        <div style={{ backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--border)' }} className="flex items-center justify-between px-4 py-2">
          <span style={{ color: 'var(--text-muted)' }} className="font-mono text-xs">{label}</span>
          {showCopy && <button onClick={copy} style={{ color: 'var(--text-muted)' }} className="text-xs hover:opacity-70">{copied ? 'Copied!' : 'Copy'}</button>}
        </div>
      )}
      <pre className="overflow-x-auto p-4 font-mono text-sm leading-relaxed text-green"><code>{code}</code></pre>
    </div>
  )
}
