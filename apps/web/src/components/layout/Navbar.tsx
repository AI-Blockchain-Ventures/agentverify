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
    <header
      className="no-print sticky top-0 z-50 backdrop-blur-xl"
      style={{
        backgroundColor: 'var(--nav-bg)',
        borderBottom: '1px solid var(--nav-border)',
      }}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/">
          <img
            src={assetUrl('/logo.png')}
            alt="Agent Verify"
            className="w-26 object-contain cursor-pointer"
          />
        </Link>

        <div className="flex items-center gap-3">
          <Link href="/agentspoofed" style={{ color: 'var(--text-secondary)' }} className="hidden px-3 py-2 text-sm font-medium transition-opacity hover:opacity-70 sm:inline-flex">
            Agent Spoofed
          </Link>
          {!user ? (
            <>
              <button
                onClick={() => openAuth('signIn')}
                style={{ color: 'var(--text-secondary)' }}
                className="px-4 py-2 text-base font-medium transition-opacity hover:opacity-70"
              >
                Sign In
              </button>
              <button
                onClick={() => openAuth('signUp')}
                className="rounded-xl bg-[#00C4CC] px-6 py-2.5 text-base font-bold text-[#060A0F] transition-all hover:bg-[#00D9E0] shadow-[0_0_20px_rgba(0,196,204,0.25)]"
              >
                Start Free
              </button>
            </>
          ) : (
            <>
              <Link href="/dashboard">
                <button className="rounded-xl bg-[#00C4CC] px-6 py-2.5 text-base font-bold text-[#060A0F] transition-all hover:bg-[#00D9E0]">
                  Dashboard
                </button>
              </Link>
              <div
                style={{
                  backgroundColor: 'var(--card)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-secondary)',
                }}
                className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium"
              >
                {user.email?.[0]?.toUpperCase() ?? 'U'}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
