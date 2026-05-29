'use client'

import type { DashboardTab } from '@/types'

const tabs = [
  { id: 'scan' as DashboardTab, label: 'Scan', icon: '⌕' },
  { id: 'reports' as DashboardTab, label: 'Reports', icon: '≡' },
  { id: 'api' as DashboardTab, label: 'API', icon: '◈' },
  { id: 'settings' as DashboardTab, label: 'Settings', icon: '⚙' },
]

export function BottomNav({ active, onChange, reportBadge }: {
  active: DashboardTab
  onChange: (tab: DashboardTab) => void
  reportBadge?: number
}) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-[#1E2D40] bg-[#080B14] md:hidden">
      <div className="flex items-center justify-around px-2 py-2">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`relative flex flex-col items-center gap-0.5 rounded-lg px-4 py-2 transition-colors ${
              active === tab.id
                ? 'text-[#06B6D4]'
                : 'text-[#4B6080] hover:text-[#94A3B8]'
            }`}
          >
            <span className="text-lg">{tab.icon}</span>
            <span className="text-xs font-medium">{tab.label}</span>
            {tab.id === 'reports' && reportBadge && reportBadge > 0 && (
              <span className="absolute right-2 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#EF4444] text-xs font-bold text-white">
                {reportBadge > 9 ? '9+' : reportBadge}
              </span>
            )}
          </button>
        ))}
      </div>
    </nav>
  )
}
