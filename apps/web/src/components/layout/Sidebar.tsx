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
    <aside className="fixed left-0 top-0 flex h-screen w-52 flex-col border-r border-[#1A2535] bg-[#060A0F]">
      <div className="border-b border-[#1A2535] px-4 py-3">
        <img src={assetUrl('/logo.png')} alt="Agent Verify" className="h-10" />
        <span className="text-xs text-[#3D5166]">v1.1.0</span>
      </div>
      <nav className="flex-1 space-y-0.5 px-2 py-4">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-xs transition-colors ${
              active === tab.id
                ? 'border-l-2 border-[#00C4CC] bg-[#0D1321] font-medium text-white'
                : 'text-[#3D5166] hover:bg-[#0D1321]/50 hover:text-[#8896A8]'
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
        <div className="mt-2 border-t border-[#1A2535] px-3 py-2">
          <p className="mb-2 text-xs uppercase tracking-wider text-[#3D5166]">Resources</p>
          <a href="https://github.com/AI-Blockchain-Ventures/agentverify" target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-[#3D5166] transition-colors hover:text-[#8896A8]">↗ GitHub</a>
          <a href="mailto:hello@aiblockchainventures.com" className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-[#3D5166] transition-colors hover:text-[#8896A8]">✉ Support</a>
        </div>
      </nav>
      <div className="border-t border-[#1A2535] px-4 py-4">
        <div className="mb-3 truncate text-xs text-[#3D5166]">{user?.email ?? ''}</div>
        <button onClick={signOut} className="cursor-pointer text-xs text-[#3D5166] transition-colors hover:text-white">
          Sign out
        </button>
      </div>
    </aside>
  )
}
