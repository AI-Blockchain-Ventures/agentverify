'use client'

import type { DashboardTab } from '@/types'
import { useAuth } from '@/components/auth/AuthProvider'
import { assetUrl } from '@/lib/assets'

const tabs: Array<{ id: DashboardTab; label: string; icon: string }> = [
  { id: 'scan', label: 'Scan', icon: '⌕' },
  { id: 'reports', label: 'Reports', icon: '≡' },
  { id: 'api', label: 'API', icon: '◈' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
]

export function Sidebar({ active, onChange, reportBadge }: { active: DashboardTab; onChange: (tab: DashboardTab) => void; reportBadge?: number }) {
  const { user, signOut } = useAuth()
  return (
    <aside className="fixed left-0 top-0 flex h-screen w-56 flex-col border-r border-[#1E2D40] bg-[#080B14]">
      <div className="flex items-center gap-2.5 border-b border-[#1E2D40] px-4 py-4">
        <img src={assetUrl('/logo.png')} alt="Agent Verify" className="h-13" />
      </div>
      <nav className="flex-1 space-y-0.5 px-2 py-4">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
              active === tab.id
                ? 'bg-[#0D1117] font-medium text-white border-l-2 border-[#06B6D4]'
                : 'text-[#4B6080] hover:bg-[#0D1117]/50 hover:text-[#94A3B8]'
            }`}
          >
            <span className="text-base">{tab.icon}</span>
            {tab.label}
            {tab.id === 'reports' && reportBadge && reportBadge > 0 ? (
              <span className="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-[#EF4444] text-xs font-bold text-white">
                {reportBadge > 9 ? '9+' : reportBadge}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
      <div className="border-t border-[#1E2D40] px-4 py-4">
        <div className="mb-3 truncate text-xs text-[#4B6080]">{user?.email ?? ''}</div>
        <button onClick={signOut} className="cursor-pointer text-xs text-[#4B6080] transition-colors hover:text-white">
          Sign out
        </button>
      </div>
    </aside>
  )
}
