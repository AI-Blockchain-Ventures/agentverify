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
    <div className="overflow-hidden rounded-lg border border-gray-800 bg-black">
      {label && (
        <div className="flex items-center justify-between border-b border-gray-800 bg-gray-950 px-4 py-2">
          <span className="font-mono text-xs text-gray-500">{label}</span>
          {showCopy && <button onClick={copy} className="text-xs text-gray-500 hover:text-white">{copied ? 'Copied!' : 'Copy'}</button>}
        </div>
      )}
      <pre className="overflow-x-auto p-4 font-mono text-sm leading-relaxed text-green"><code>{code}</code></pre>
    </div>
  )
}
