'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/components/auth/AuthProvider'
import { Brand } from '@/components/layout/Brand'
import { openAsk } from '@/components/ask/askEvents'

interface NavbarProps {
  openAuth: (mode: 'signIn' | 'signUp') => void
}

const links = [
  { href: '/agentspoofed', label: 'Live Demo' },
  { href: '/mcp', label: 'MCP Safety' },
  { href: '/developers', label: 'Developers' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/trust', label: 'Trust' },
  { href: '/docs', label: 'Docs' },
]

export function Navbar({ openAuth }: NavbarProps) {
  const { user } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header
      className="no-print sticky top-0 z-50 backdrop-blur-xl"
      style={{ backgroundColor: 'var(--nav-bg)', borderBottom: '1px solid var(--nav-border)' }}
    >
      <div className="av-container flex h-16 items-center gap-6 2xl:h-[72px]">
        <Link href="/" aria-label="Agent Verify home" className="shrink-0 text-base 2xl:text-lg">
          <Brand size={34} />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {links.map(link => (
            <Link key={link.href} href={link.href} style={{ color: 'var(--text-secondary)' }} className="rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-primary)]">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => openAsk()}
            style={{ border: '1px solid var(--border-light)', color: 'var(--text-secondary)', backgroundColor: 'var(--card)' }}
            className="hidden items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:text-[var(--text-primary)] md:inline-flex"
          >
            Ask <span className="av-kbd">Ctrl K</span>
          </button>
          {!user ? (
            <>
              <button
                onClick={() => openAuth('signIn')}
                style={{ border: '1px solid var(--border-light)', color: 'var(--text-primary)', backgroundColor: 'var(--card)' }}
                className="hidden rounded-md px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-80 sm:inline-flex"
              >
                Log in
              </button>
              <button
                onClick={() => openAuth('signUp')}
                className="rounded-md bg-[#7C3AED] px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#6D28D9]"
              >
                Start free
              </button>
            </>
          ) : (
            <Link href="/dashboard" className="rounded-md bg-[#7C3AED] px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#6D28D9]">
              Dashboard
            </Link>
          )}
          <button
            onClick={() => setMenuOpen(open => !open)}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md lg:hidden"
          >
            {menuOpen ? (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" /></svg>
            )}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          id="mobile-nav-menu"
          aria-label="Mobile"
          style={{ backgroundColor: 'var(--card)', borderTop: '1px solid var(--nav-border)' }}
          className="flex flex-col px-4 py-2 lg:hidden"
        >
          {links.map(link => (
            <Link key={link.href} href={link.href} onClick={() => setMenuOpen(false)} style={{ color: 'var(--text-secondary)' }} className="rounded-md px-2 py-3 text-sm font-medium transition-opacity hover:opacity-70">
              {link.label}
            </Link>
          ))}
          <button onClick={() => { setMenuOpen(false); openAsk() }} style={{ color: 'var(--text-secondary)' }} className="rounded-md px-2 py-3 text-left text-sm font-medium">Ask a question</button>
          {!user && (
            <button onClick={() => { setMenuOpen(false); openAuth('signIn') }} style={{ color: 'var(--text-secondary)' }} className="rounded-md px-2 py-3 text-left text-sm font-medium">Log in</button>
          )}
        </nav>
      )}
    </header>
  )
}
