'use client'

import { useAuthNav } from '@/components/auth/useAuthNav'

export function CTASection() {
  const goAuth = useAuthNav()
  return (
    <section style={{ borderTop: '1px solid var(--border)' }} className="px-6 py-20 text-center md:py-24">
      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mx-auto max-w-3xl rounded-3xl p-8 shadow-2xl shadow-black/5 md:p-12">
        <h2 style={{ color: 'var(--text-primary)' }} className="mb-4 text-3xl font-semibold tracking-tight md:text-4xl">Start with a private security report.</h2>
        <p style={{ color: 'var(--text-secondary)' }} className="mx-auto mb-8 max-w-xl">Scan agent code or configuration, review findings, apply fixes, and re-scan before deployment.</p>
        <button onClick={() => goAuth('signUp')} className="rounded-md bg-[#7C3AED] px-7 py-3 font-semibold text-white transition-colors hover:bg-[#6D28D9]">Create free account</button>
        <p style={{ color: 'var(--text-muted)' }} className="mt-4 text-sm">Free includes 10 scans/month and basic findings.</p>
      </div>
    </section>
  )
}
