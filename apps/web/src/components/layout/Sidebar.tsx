'use client'

import Link from 'next/link'
import Image from 'next/image'
import type { DashboardTab } from '@/types'
import { useAuth } from '@/components/auth/AuthProvider'
import { assetUrl } from '@/lib/assets'

interface NavItem {
  id: DashboardTab
  label: string
  icon: string
}

interface NavSection {
  label: string
  items: NavItem[]
}

const SECTIONS: NavSection[] = [
  { label: 'Overview', items: [
    { id: 'overview', label: 'Dashboard', icon: '◧' },
    { id: 'agents', label: 'Agents', icon: '▤' },
  ] },
  { label: 'Verify', items: [
    { id: 'scan', label: 'Scan', icon: '⌕' },
    { id: 'reports', label: 'Reports', icon: '≡' },
    { id: 'checks', label: 'Verification Checks', icon: '✓' },
    { id: 'policies', label: 'Policies', icon: '▣' },
  ] },
  { label: 'Platform', items: [
    { id: 'workspace', label: 'Workspace', icon: '▣' },
    { id: 'integrations', label: 'Integrations', icon: '⇄' },
    { id: 'api', label: 'API / CLI', icon: '◈' },
  ] },
]

export function Sidebar({
  active,
  onChange,
  reportBadge,
  planLabel,
}: {
  active: DashboardTab
  onChange: (tab: DashboardTab) => void
  reportBadge?: number
  planLabel: string
}) {
  const { user, signOut } = useAuth()

  return (
    <aside
      style={{ backgroundColor: 'var(--sidebar-bg)', borderRight: '1px solid var(--border)' }}
      className="fixed left-0 top-0 flex h-screen w-60 flex-col"
    >
      <Link href="/" style={{ borderBottom: '1px solid var(--border)' }} className="flex items-center gap-2 px-4 py-3.5 transition-opacity hover:opacity-80">
        <Image src={assetUrl('/agentverify-icon.png')} alt="Agent Verify" width={34} height={34} className="h-8 w-8 rounded-xl object-contain" />
        <div className="leading-tight">
          <p style={{ color: 'var(--text-primary)' }} className="text-sm font-bold tracking-tight">Agent Verify</p>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--accent-purple-text)]">v1.4 · {planLabel}</p>
        </div>
      </Link>

      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-4">
        {SECTIONS.map(section => (
          <div key={section.label}>
            <p style={{ color: 'var(--text-muted)' }} className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em]">{section.label}</p>
            <div className="space-y-0.5">
              {section.items.map(item => {
                const isActive = active === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => onChange(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    style={{
                      backgroundColor: isActive ? 'var(--surface)' : 'transparent',
                      color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                      borderLeft: isActive ? '2px solid #7C3AED' : '2px solid transparent',
                    }}
                    className="av-transition flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-xs font-semibold hover:opacity-90"
                  >
                    <span className="w-4 text-center text-sm" aria-hidden="true">{item.icon}</span>
                    <span>{item.label}</span>
                    {item.id === 'reports' && reportBadge && reportBadge > 0 ? (
                      <span className="ml-auto rounded-full bg-[#E03E3E] px-2 py-0.5 text-[11px] font-bold text-white">
                        {reportBadge > 9 ? '9+' : reportBadge}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div style={{ borderTop: '1px solid var(--border)' }} className="space-y-0.5 px-2 py-3">
        <Link href="/docs" style={{ color: 'var(--text-muted)' }} className="av-transition flex items-center gap-3 rounded-2xl px-3 py-2.5 text-xs font-semibold hover:bg-[var(--surface)] hover:text-[var(--text-primary)]">
          <span className="w-4 text-center text-sm" aria-hidden="true">▥</span>
          <span>Docs</span>
        </Link>
        <button
          onClick={() => onChange('billing')}
          aria-current={active === 'billing' ? 'page' : undefined}
          style={{
            backgroundColor: active === 'billing' ? 'var(--surface)' : 'transparent',
            color: active === 'billing' ? 'var(--text-primary)' : 'var(--text-muted)',
          }}
          className="av-transition flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-xs font-semibold hover:opacity-90"
        >
          <span className="w-4 text-center text-sm" aria-hidden="true">◆</span>
          <span>Billing / Plan</span>
        </button>
        <button
          onClick={() => onChange('settings')}
          aria-current={active === 'settings' ? 'page' : undefined}
          style={{
            backgroundColor: active === 'settings' ? 'var(--surface)' : 'transparent',
            color: active === 'settings' ? 'var(--text-primary)' : 'var(--text-muted)',
          }}
          className="av-transition flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-xs font-semibold hover:opacity-90"
        >
          <span className="w-4 text-center text-sm" aria-hidden="true">⚙</span>
          <span>Settings</span>
        </button>
      </div>

      <div style={{ borderTop: '1px solid var(--border)' }} className="px-4 py-3.5">
        <div style={{ color: 'var(--text-muted)' }} className="mb-2 truncate text-xs">{user?.email ?? ''}</div>
        <div className="flex items-center justify-between text-xs">
          <a href="https://github.com/AI-Blockchain-Ventures/agentverify" target="_blank" rel="noreferrer" style={{ color: 'var(--text-muted)' }} className="transition-colors hover:text-[color:var(--accent-purple-text)]">GitHub</a>
          <a href="mailto:hello@aiblockchainventures.com" style={{ color: 'var(--text-muted)' }} className="transition-colors hover:text-[color:var(--accent-purple-text)]">Support</a>
          <button onClick={signOut} style={{ color: 'var(--text-muted)' }} className="cursor-pointer transition-colors hover:text-[color:var(--accent-red-text)]">Sign out</button>
        </div>
      </div>
    </aside>
  )
}
