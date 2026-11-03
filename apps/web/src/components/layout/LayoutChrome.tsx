'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { installErrorReporter } from '@/lib/errorReporter'
import { useAuthNav } from '@/components/auth/useAuthNav'
import { Footer } from '@/components/layout/Footer'
import { Navbar } from '@/components/layout/Navbar'
import { ReferralCapture } from '@/components/growth/ReferralCapture'
import dynamic from 'next/dynamic'
// Ask (Ctrl+K) loads right after the page, not as part of it.
const AskPalette = dynamic(() => import('@/components/ask/AskPalette').then(m => m.AskPalette), { ssr: false })

export function LayoutChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  // /verify is a standalone public "trust receipt" page (see its own doc comment) — deliberately
  // presented without the marketing site's nav/footer around it, same reasoning as /dashboard.
  const hideChrome = pathname === '/dashboard' || pathname.startsWith('/dashboard/') ||
    pathname === '/verify' || pathname.startsWith('/verify/') ||
    pathname === '/admin' || pathname.startsWith('/admin/') ||
    pathname === '/signup' || pathname.startsWith('/signup/') ||
    pathname === '/login' || pathname.startsWith('/login/')
  const openAuth = useAuthNav()
  // Report crashes on any page to the admin (see lib/errorReporter.ts).
  useEffect(() => installErrorReporter(), [])

  return (
    <>
      <ReferralCapture />
      <AskPalette />
      {!hideChrome && <Navbar openAuth={openAuth} />}
      {children}
      {!hideChrome && <Footer />}
    </>
  )
}
