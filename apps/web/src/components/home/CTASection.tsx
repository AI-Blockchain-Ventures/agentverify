'use client'

import { useState } from 'react'
import { AuthModal } from '@/components/auth/AuthModal'

export function CTASection() {
  const [open, setOpen] = useState(false)
  return (
    <section style={{ borderTop: '1px solid var(--border)' }} className="px-6 py-20 text-center md:py-24">
      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mx-auto max-w-3xl rounded-3xl p-8 shadow-2xl shadow-black/5 md:p-12">
        <h2 style={{ color: 'var(--text-primary)' }} className="mb-4 text-3xl font-semibold tracking-tight md:text-4xl">Start with a private security report.</h2>
        <p style={{ color: 'var(--text-secondary)' }} className="mx-auto mb-8 max-w-xl">Scan agent code or configuration, review findings, apply fixes, and re-scan before deployment.</p>
        <button onClick={() => setOpen(true)} className="rounded-2xl bg-[#06B6D4] px-7 py-3.5 font-semibold text-[#080B14] shadow-[0_20px_60px_rgba(6,182,212,0.24)] transition-colors hover:bg-[#22D3EE]">Scan agent</button>
        <p style={{ color: 'var(--text-muted)' }} className="mt-4 text-sm">Free includes 10 scans/month and basic findings.</p>
      </div>
      <AuthModal open={open} onClose={() => setOpen(false)} defaultMode="signUp" />
    </section>
  )
}
