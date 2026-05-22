'use client'

import { useState } from 'react'
import { AuthModal } from '@/components/auth/AuthModal'

export function CTASection() {
  const [open, setOpen] = useState(false)
  return (
    <section className="border-t border-[#1E2D40] px-6 py-24 text-center">
      <h2 className="mb-4 text-4xl font-bold text-white">Start with a free analysis.</h2>
      <p className="mb-10 text-[#94A3B8]">Free to start. No credit card required.</p>
      <button onClick={() => setOpen(true)} className="rounded-lg bg-[#06B6D4] px-6 py-3 font-semibold text-[#080B14] transition-colors hover:bg-[#22D3EE]">Start for free →</button>
      <AuthModal open={open} onClose={() => setOpen(false)} defaultMode="signUp" />
    </section>
  )
}
