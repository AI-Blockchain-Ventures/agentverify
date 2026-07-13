'use client'

import Link from 'next/link'
import Image from 'next/image'
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
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2">
          <Image
            src={assetUrl('/agentverify-icon.png')}
            alt="Agent Verify"
            width={34}
            height={34}
            className="h-8 w-8 cursor-pointer rounded-xl object-contain"
            priority
          />
          <span style={{ color: 'var(--text-primary)' }} className="text-sm font-bold tracking-tight sm:text-base">Agent Verify</span>
        </Link>

        <div className="flex items-center gap-2 md:gap-3">
          <Link href="/agentspoofed" style={{ color: 'var(--text-secondary)' }} className="hidden px-3 py-2 text-sm font-medium transition-opacity hover:opacity-70 md:inline-flex">
            Agent Spoofed
          </Link>
          <Link href="/pricing" style={{ color: 'var(--text-secondary)' }} className="hidden px-3 py-2 text-sm font-medium transition-opacity hover:opacity-70 sm:inline-flex">
            Pricing
          </Link>
          {!user ? (
            <>
              <button
                onClick={() => openAuth('signIn')}
                style={{ color: 'var(--text-secondary)' }}
                className="px-3 py-2 text-sm font-medium transition-opacity hover:opacity-70 md:px-4 md:text-base"
              >
                Sign in
              </button>
              <button
                onClick={() => openAuth('signUp')}
                className="rounded-2xl bg-[#00C4CC] px-4 py-2.5 text-sm font-semibold text-[#060A0F] shadow-[0_16px_44px_rgba(0,196,204,0.20)] transition-all hover:bg-[#00D9E0] md:px-6 md:text-base"
              >
                Start free
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
