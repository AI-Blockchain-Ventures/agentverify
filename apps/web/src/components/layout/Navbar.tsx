'use client'

import Link from 'next/link'
import { useAuth } from '@/components/auth/AuthProvider'
import { assetUrl } from '@/lib/assets'

interface NavbarProps {
  openAuth: (mode: 'signIn' | 'signUp') => void
}

export function Navbar({ openAuth }: NavbarProps) {
  const { user } = useAuth()

  return (
      <header className="no-print sticky top-0 z-50 h-14 border-b border-[#1E2D40] bg-[#080B14]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-4 md:px-6">
          <Link href="/" className="flex items-center gap-2">
            <img src={assetUrl('/logo.png')} alt="Agent Verify" className="h-12" />
          </Link>
          <div className="flex items-center gap-2">
            {!user ? (
              <>
                <button onClick={() => openAuth('signIn')} className="px-3 py-1.5 text-sm text-[#94A3B8] transition-colors hover:text-white">Sign In</button>
                <button onClick={() => openAuth('signUp')} className="rounded-lg bg-[#06B6D4] px-4 py-1.5 text-sm font-semibold text-[#080B14] transition-colors hover:bg-[#22D3EE]">Start Free</button>
              </>
            ) : (
              <>
                <Link href="/dashboard"><button className="rounded-lg bg-[#06B6D4] px-4 py-1.5 text-sm font-semibold text-[#080B14] transition-colors hover:bg-[#22D3EE]">Dashboard</button></Link>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0D1117] text-xs text-[#94A3B8]">{user.email?.[0]?.toUpperCase() ?? 'U'}</div>
              </>
            )}
          </div>
        </div>
      </header>
  )
}
