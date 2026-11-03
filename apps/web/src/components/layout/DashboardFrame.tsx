'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DashboardTab } from '@/types'
import { Sidebar } from '@/components/layout/Sidebar'
import { BottomNav } from '@/components/layout/BottomNav'
import { MobileNavDrawer } from '@/components/layout/MobileNav'

/**
 * The dashboard's sidebar (desktop) and bottom bar (phones) around a page that lives outside
 * /dashboard, such as a report opened by its signed-in owner. Tabs open the dashboard.
 */
export function DashboardFrame({ active = 'reports', planLabel, children }: { active?: DashboardTab; planLabel: string; children: React.ReactNode }) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const go = (tab: DashboardTab) => {
    setMenuOpen(false)
    router.push(`/dashboard?tab=${tab}`)
  }
  return (
    <div style={{ backgroundColor: 'var(--bg)' }} className="min-h-screen">
      <div className="no-print hidden md:block">
        <Sidebar active={active} onChange={go} planLabel={planLabel} />
      </div>
      <div className="no-print">
        <MobileNavDrawer open={menuOpen} onClose={() => setMenuOpen(false)} active={active} onChange={go} planLabel={planLabel} />
      </div>
      <main className="min-h-screen pb-20 md:ml-60 md:pb-0 2xl:ml-64 print:ml-0">{children}</main>
      <div className="no-print">
        <BottomNav active={active} onChange={go} onOpenMenu={() => setMenuOpen(true)} />
      </div>
    </div>
  )
}
