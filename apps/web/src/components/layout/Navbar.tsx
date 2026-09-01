'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useAuth } from '@/components/auth/AuthProvider'
import { assetUrl } from '@/lib/assets'

interface NavbarProps {
  openAuth: (mode: 'signIn' | 'signUp') => void
}

const mobileLinks = [
  { href: '/agentspoofed', label: 'Live Demo' },
  { href: '/docs', label: 'Docs' },
  { href: '/pricing', label: 'Pricing' },
]

export function Navbar({ openAuth }: NavbarProps) {
  const { user } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)

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
            Live Demo
          </Link>
          <Link href="/docs" style={{ color: 'var(--text-secondary)' }} className="hidden px-3 py-2 text-sm font-medium transition-opacity hover:opacity-70 md:inline-flex">
            Docs
          </Link>
          <Link href="/pricing" style={{ color: 'var(--text-secondary)' }} className="hidden px-3 py-2 text-sm font-medium transition-opacity hover:opacity-70 sm:inline-flex">
            Pricing
          </Link>
          <button
            onClick={() => setMenuOpen(open => !open)}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg sm:hidden"
          >
            {menuOpen ? (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" /></svg>
            )}
          </button>
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
                className="rounded-2xl bg-[#7C3AED] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_16px_44px_rgba(6,182,212,0.20)] transition-all hover:bg-[#06B6D4] hover:text-[#060A0F] md:px-6 md:text-base"
              >
                Start free
              </button>
            </>
          ) : (
            <>
              <Link href="/dashboard">
                <button className="rounded-xl bg-[#7C3AED] px-6 py-2.5 text-base font-bold text-white transition-all hover:bg-[#06B6D4] hover:text-[#060A0F]">
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

      {menuOpen && (
        <nav
          id="mobile-nav-menu"
          style={{ backgroundColor: 'var(--nav-bg)', borderTop: '1px solid var(--nav-border)' }}
          className="flex flex-col px-4 py-2 sm:hidden"
        >
          {mobileLinks.map(link => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              style={{ color: 'var(--text-secondary)' }}
              className="rounded-lg px-2 py-3 text-sm font-medium transition-opacity hover:opacity-70"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  )
}
