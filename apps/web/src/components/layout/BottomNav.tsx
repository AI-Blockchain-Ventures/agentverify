'use client'

import type { DashboardTab } from '@/types'

// The 4 most-reached-for destinations, thumb-accessible without opening the drawer. Everything
// else (Verification Checks, Policies, Integrations, Docs, Settings, Sign out) lives in
// MobileNavDrawer, opened via "Menu" here — a proper mobile nav pattern, not the desktop
// sidebar's 8+ items squeezed into a 375px bar.
const tabs = [
  { id: 'overview' as DashboardTab, label: 'Dashboard', icon: '◧' },
  { id: 'scan' as DashboardTab, label: 'Scan', icon: '⌕' },
  { id: 'reports' as DashboardTab, label: 'Reports', icon: '≡' },
]

export function BottomNav({ active, onChange, reportBadge, onOpenMenu }: {
  active: DashboardTab
  onChange: (tab: DashboardTab) => void
  reportBadge?: number
  onOpenMenu: () => void
}) {
  return (
    <nav style={{ backgroundColor: 'var(--sidebar-bg)', borderTop: '1px solid var(--border)' }} className="fixed bottom-0 left-0 right-0 z-50 md:hidden">
      <div className="flex items-center justify-around px-2 py-2">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            aria-current={active === tab.id ? 'page' : undefined}
            style={{ color: active === tab.id ? '#06B6D4' : 'var(--text-muted)' }}
            className="av-press relative flex flex-col items-center gap-0.5 rounded-lg px-4 py-2 transition-colors hover:opacity-70"
          >
            <span className="text-lg" aria-hidden="true">{tab.icon}</span>
            <span className="text-xs font-medium">{tab.label}</span>
            {tab.id === 'reports' && reportBadge && reportBadge > 0 ? (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#E03E3E] text-xs font-bold text-white">
                {reportBadge > 9 ? '9+' : reportBadge}
              </span>
            ) : null}
          </button>
        ))}
        <button
          onClick={onOpenMenu}
          aria-label="Open menu"
          style={{ color: 'var(--text-muted)' }}
          className="av-press flex flex-col items-center gap-0.5 rounded-lg px-4 py-2 transition-colors hover:opacity-70"
        >
          <span className="text-lg" aria-hidden="true">☰</span>
          <span className="text-xs font-medium">Menu</span>
        </button>
      </div>
    </nav>
  )
}
