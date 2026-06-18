'use client'

import { useState } from 'react'
import { AuthModal } from '@/components/auth/AuthModal'

export function CTASection() {
  const [open, setOpen] = useState(false)
  return (
    <section style={{ borderTop: '1px solid var(--border)' }} className="px-6 py-24 text-center">
      <h2 style={{ color: 'var(--text-primary)' }} className="mb-4 text-4xl font-bold">Free to use. No signup required to try.</h2>
      <p style={{ color: 'var(--text-secondary)' }} className="mb-10">Paste any agent config and get results in seconds.</p>
      <button onClick={() => setOpen(true)} className="rounded-lg bg-[#06B6D4] px-6 py-3 font-semibold text-[#080B14] transition-colors hover:bg-[#22D3EE]">Analyze your agent →</button>
      <p style={{ color: 'var(--text-muted)' }} className="mt-4 text-sm">Sign up to save reports and use the CLI scanner.</p>
      <AuthModal open={open} onClose={() => setOpen(false)} defaultMode="signUp" />
    </section>
  )
}
