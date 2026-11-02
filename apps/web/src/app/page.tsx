'use client'

import { Hero } from '@/components/home/Hero'
import { TrustSignals } from '@/components/home/TrustSignals'
import { ProofStrip } from '@/components/home/ProofStrip'
import { PublicScanDemo } from '@/components/home/PublicScanDemo'
import { ProblemSection } from '@/components/home/ProblemSection'
import { WhyAgentVerify } from '@/components/home/WhyAgentVerify'
import { CategorySection } from '@/components/home/CategorySection'
import { OwaspProfileSection } from '@/components/home/OwaspProfileSection'
import { HowItWorks } from '@/components/home/HowItWorks'
import { WhatYouGet } from '@/components/home/WhatYouGet'
import { SecurityControls } from '@/components/home/SecurityControls'
import { SharingSection } from '@/components/home/SharingSection'
import { UseCases } from '@/components/home/UseCases'
import { CTASection } from '@/components/home/CTASection'
import { LogoMarquee } from '@/components/home/LogoMarquee'
import { SecurityTeamsSection } from '@/components/home/SecurityTeamsSection'
import { useAuthNav } from '@/components/auth/useAuthNav'

export default function Home() {
  // Signed-in people can still read the homepage; the header shows a Dashboard button for them.
  const openAuth = useAuthNav()

  return (
    <main>
      <Hero openAuth={openAuth} />
      <LogoMarquee />
      <PublicScanDemo openAuth={openAuth} />
      <ProofStrip />
      <TrustSignals />
      <ProblemSection />
      <WhyAgentVerify />
      <CategorySection />
      <OwaspProfileSection />
      <HowItWorks />
      <WhatYouGet />
      <SecurityControls />
      <SharingSection />
      <UseCases />
      <SecurityTeamsSection />
      <CTASection />
    </main>
  )
}
