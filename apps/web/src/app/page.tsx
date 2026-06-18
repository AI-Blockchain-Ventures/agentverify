'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { Hero } from '@/components/home/Hero'
import { ProblemSection } from '@/components/home/ProblemSection'
import { CategorySection } from '@/components/home/CategorySection'
import { HowItWorks } from '@/components/home/HowItWorks'
import { WhatYouGet } from '@/components/home/WhatYouGet'
import { SharingSection } from '@/components/home/SharingSection'
import { UseCases } from '@/components/home/UseCases'
import { CTASection } from '@/components/home/CTASection'
import { AuthModal } from '@/components/auth/AuthModal'
import { useAuth } from '@/components/auth/AuthProvider'

export default function Home() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [authModal, setAuthModal] = useState<{ open: boolean; mode: 'signIn' | 'signUp' }>({
    open: false,
    mode: 'signIn',
  })

  const openAuth = (mode: 'signIn' | 'signUp') => setAuthModal({ open: true, mode })

  useEffect(() => {
    if (!loading && user) {
      router.push('/dashboard')
    }
  }, [user, loading, router])

  if (loading) return null
  if (user) return null

  return (
    <main>
      <Navbar openAuth={openAuth} />
      <Hero openAuth={openAuth} />
      <ProblemSection />
      <CategorySection />
      <HowItWorks />
      <WhatYouGet />
      <SharingSection />
      <UseCases />
      <CTASection />
      <Footer />
      <AuthModal open={authModal.open} defaultMode={authModal.mode} onClose={() => setAuthModal(prev => ({ ...prev, open: false }))} />
    </main>
  )
}
