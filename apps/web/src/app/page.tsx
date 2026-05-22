'use client'

import { useState } from 'react'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { Hero } from '@/components/home/Hero'
import { ProblemSection } from '@/components/home/ProblemSection'
import { CategorySection } from '@/components/home/CategorySection'
import { HowItWorks } from '@/components/home/HowItWorks'
import { WhatYouGet } from '@/components/home/WhatYouGet'
import { UseCases } from '@/components/home/UseCases'
import { CTASection } from '@/components/home/CTASection'
import { AuthModal } from '@/components/auth/AuthModal'

export default function Home() {
  const [authModal, setAuthModal] = useState<{ open: boolean; mode: 'signIn' | 'signUp' }>({
    open: false,
    mode: 'signIn',
  })

  const openAuth = (mode: 'signIn' | 'signUp') => setAuthModal({ open: true, mode })

  return (
    <main>
      <Navbar openAuth={openAuth} />
      <Hero openAuth={openAuth} />
      <ProblemSection />
      <CategorySection />
      <HowItWorks />
      <WhatYouGet />
      <UseCases />
      <CTASection />
      <Footer />
      <AuthModal open={authModal.open} defaultMode={authModal.mode} onClose={() => setAuthModal(prev => ({ ...prev, open: false }))} />
    </main>
  )
}
