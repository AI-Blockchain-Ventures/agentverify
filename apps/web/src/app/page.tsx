'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Hero } from '@/components/home/Hero'
import { TrustSignals } from '@/components/home/TrustSignals'
import { PublicScanDemo } from '@/components/home/PublicScanDemo'
import { ProblemSection } from '@/components/home/ProblemSection'
import { WhyAgentVerify } from '@/components/home/WhyAgentVerify'
import { CategorySection } from '@/components/home/CategorySection'
import { HowItWorks } from '@/components/home/HowItWorks'
import { WhatYouGet } from '@/components/home/WhatYouGet'
import { SecurityControls } from '@/components/home/SecurityControls'
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
      <Hero openAuth={openAuth} />
      <TrustSignals />
      <PublicScanDemo />
      <ProblemSection />
      <WhyAgentVerify />
      <CategorySection />
      <HowItWorks />
      <WhatYouGet />
      <SecurityControls />
      <SharingSection />
      <UseCases />
      <CTASection />
      <AuthModal open={authModal.open} defaultMode={authModal.mode} onClose={() => setAuthModal(prev => ({ ...prev, open: false }))} />
    </main>
  )
}
