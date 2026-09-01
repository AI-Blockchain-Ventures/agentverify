'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { AuthModal } from '@/components/auth/AuthModal'
import { Footer } from '@/components/layout/Footer'
import { Navbar } from '@/components/layout/Navbar'

export function LayoutChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  // /verify is a standalone public "trust receipt" page (see its own doc comment) — deliberately
  // presented without the marketing site's nav/footer around it, same reasoning as /dashboard.
  const hideChrome = pathname === '/dashboard' || pathname.startsWith('/dashboard/') ||
    pathname === '/verify' || pathname.startsWith('/verify/')
  const [authModal, setAuthModal] = useState<{ open: boolean; mode: 'signIn' | 'signUp' }>({
    open: false,
    mode: 'signIn',
  })

  const openAuth = (mode: 'signIn' | 'signUp') => setAuthModal({ open: true, mode })

  return (
    <>
      {!hideChrome && <Navbar openAuth={openAuth} />}
      {children}
      {!hideChrome && <Footer />}
      {!hideChrome && <AuthModal open={authModal.open} defaultMode={authModal.mode} onClose={() => setAuthModal(prev => ({ ...prev, open: false }))} />}
    </>
  )
}
