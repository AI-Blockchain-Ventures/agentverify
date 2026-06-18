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

export function Sidebar({
  active,
  onChange,
  reportBadge,
}: {
  active: DashboardTab
  onChange: (tab: DashboardTab) => void
  reportBadge?: number
}) {
  const { user, signOut } = useAuth()

  return (
    <aside
      style={{
        backgroundColor: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--border)',
      }}
      className="fixed left-0 top-0 flex h-screen w-52 flex-col"
    >
      {/* Logo */}
      <div
        style={{ borderBottom: '1px solid var(--border)' }}
        className="px-4 py-3"
      >
        <div className="flex items-center gap-2">
          <img
            src={assetUrl('/logo.png')}
            alt="Agent Verify"
            className="w-34 object-contain"
            style={{ mixBlendMode: 'screen' }}
          />
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 px-2 py-4">
        {tabs.map(tab => {
          const isActive = active === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              style={{
                backgroundColor: isActive ? 'var(--surface)' : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                borderLeft: isActive ? '2px solid #00C4CC' : '2px solid transparent',
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium transition-all hover:opacity-80"
            >
              <span className="text-base">{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.id === 'api' && (
                <span className="ml-auto rounded border border-[#00C4CC]/20 bg-[#00C4CC]/10 px-1.5 py-0.5 text-xs text-[#00C4CC]">
                  New
                </span>
              )}
              {tab.id === 'reports' && reportBadge && reportBadge > 0 ? (
                <span className="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-[#E03E3E] text-xs font-bold text-white">
                  {reportBadge > 9 ? '9+' : reportBadge}
                </span>
              ) : null}
            </button>
          )
        })}

        <div
          style={{ borderTop: '1px solid var(--border)' }}
          className="mt-3 px-1 pt-3"
        >
          <p
            style={{ color: 'var(--text-muted)' }}
            className="mb-2 px-2 text-xs uppercase tracking-wider"
          >
            Resources
          </p>
          <a
            href="https://github.com/AI-Blockchain-Ventures/agentverify"
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--text-muted)' }}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:text-[#00C4CC]"
          >
            ↗ GitHub
          </a>
          <a
            href="mailto:hello@aiblockchainventures.com"
            style={{ color: 'var(--text-muted)' }}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:text-[#00C4CC]"
          >
            ✉ Support
          </a>
        </div>
      </nav>

      {/* Bottom */}
      <div
        style={{ borderTop: '1px solid var(--border)' }}
        className="px-4 py-4"
      >
        <div
          style={{ color: 'var(--text-muted)' }}
          className="mb-3 truncate text-xs"
        >
          {user?.email ?? ''}
        </div>
        <button
          onClick={signOut}
          style={{ color: 'var(--text-muted)' }}
          className="cursor-pointer text-xs transition-colors hover:text-[#E03E3E]"
        >
          Sign out
        </button>
      </div>
    </aside>
  )
}
