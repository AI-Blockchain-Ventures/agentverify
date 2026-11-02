'use client'

import Link from 'next/link'
import type { DashboardTab } from '@/types'
import { useAuth } from '@/components/auth/AuthProvider'
import { Brand } from '@/components/layout/Brand'
import { NavIcon } from '@/components/layout/NavIcon'
import { APP_VERSION_SHORT } from '@/lib/release'

interface NavItem {
  id: DashboardTab
  label: string
}

interface NavSection {
  label: string
  items: NavItem[]
}

export const SIDEBAR_SECTIONS: NavSection[] = [
  { label: '', items: [
    { id: 'overview', label: 'Overview' },
    { id: 'agents', label: 'Agents' },
  ] },
  { label: 'Verify', items: [
    { id: 'scan', label: 'Scan' },
    { id: 'reports', label: 'Reports' },
    { id: 'checks', label: 'Verification Checks' },
    { id: 'policies', label: 'Policies' },
  ] },
  { label: 'Protect', items: [
    { id: 'github', label: 'Repos & PR checks' },
    { id: 'guard', label: 'Agent Guard' },
    { id: 'redteam', label: 'Injection tests' },
  ] },
  { label: 'Workspace', items: [
    { id: 'workspace', label: 'Team & roles' },
    { id: 'integrations', label: 'Integrations' },
    { id: 'api', label: 'API / CLI' },
  ] },
]

const itemClass = 'av-transition flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium'
const itemStyle = (active: boolean) => ({
  backgroundColor: active ? 'rgba(124,58,237,0.10)' : 'transparent',
  color: active ? 'var(--accent-purple-text)' : 'var(--text-secondary)',
  fontWeight: active ? 600 : 500,
})

export function Sidebar({
  active,
  onChange,
  reportBadge,
  planLabel,
  isAdmin = false,
}: {
  active: DashboardTab
  onChange: (tab: DashboardTab) => void
  reportBadge?: number
  planLabel: string
  isAdmin?: boolean
}) {
  const { user, signOut } = useAuth()

  return (
    <aside
      style={{ backgroundColor: 'var(--sidebar-bg)', borderRight: '1px solid var(--border)' }}
      className="fixed left-0 top-0 flex h-screen w-60 flex-col 2xl:w-64"
    >
      <div className="px-4 pb-3 pt-4">
        <button onClick={() => onChange('overview')} aria-label="Dashboard overview" className="block text-[15px] transition-opacity hover:opacity-80">
          <Brand size={30} />
        </button>
        <div style={{ border: '1px solid var(--border)' }} className="mt-4 flex items-center gap-2.5 rounded-lg px-2.5 py-2">
          <span style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border-light)', color: 'var(--text-secondary)' }} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold">
            {(user?.email?.[0] ?? 'U').toUpperCase()}
          </span>
          <div className="min-w-0 leading-tight">
            <p style={{ color: 'var(--text-primary)' }} className="truncate text-xs font-semibold">{user?.email ?? 'Your workspace'}</p>
            <p style={{ color: 'var(--text-muted)' }} className="text-[11px]">{planLabel} plan</p>
          </div>
        </div>
      </div>

      <nav aria-label="Dashboard" className="flex-1 space-y-4 overflow-y-auto px-2.5 py-2">
        {SIDEBAR_SECTIONS.map(section => (
          <div key={section.label || 'main'}>
            {section.label && <p style={{ color: 'var(--text-muted)' }} className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider">{section.label}</p>}
            <div className="space-y-0.5">
              {section.items.map(item => {
                const isActive = active === item.id
                return (
                  <button key={item.id} onClick={() => onChange(item.id)} aria-current={isActive ? 'page' : undefined} style={itemStyle(isActive)} className={`${itemClass} hover:bg-[var(--surface)]`}>
                    <NavIcon id={item.id} />
                    <span>{item.label}</span>
                    {item.id === 'reports' && reportBadge && reportBadge > 0 ? (
                      <span className="ml-auto rounded-full bg-[#D92D20] px-1.5 py-0.5 text-[11px] font-bold text-white">
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

      <div style={{ borderTop: '1px solid var(--border)' }} className="space-y-0.5 px-2.5 py-3">
        {isAdmin && (
          <Link href="/admin" style={itemStyle(false)} className={`${itemClass} hover:bg-[var(--surface)]`}>
            <NavIcon id="admin" />
            <span>Admin</span>
          </Link>
        )}
        <Link href="/docs" target="_blank" style={itemStyle(false)} className={`${itemClass} hover:bg-[var(--surface)]`}>
          <NavIcon id="docs" />
          <span>Docs</span>
        </Link>
        <button
          onClick={() => onChange('billing')}
          aria-current={active === 'billing' ? 'page' : undefined}
          style={itemStyle(active === 'billing')}
          className={`${itemClass} hover:bg-[var(--surface)]`}
        >
          <NavIcon id="billing" />
          <span>Billing / Plan</span>
        </button>
        <button
          onClick={() => onChange('settings')}
          aria-current={active === 'settings' ? 'page' : undefined}
          style={itemStyle(active === 'settings')}
          className={`${itemClass} hover:bg-[var(--surface)]`}
        >
          <NavIcon id="settings" />
          <span>Settings</span>
        </button>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }} className="flex items-center justify-between px-4 py-3 text-xs">
        <span>{APP_VERSION_SHORT}</span>
        <a href="mailto:hello@aiblockchainventures.com" className="transition-colors hover:text-[color:var(--accent-purple-text)]">Support</a>
        <button onClick={signOut} className="cursor-pointer transition-colors hover:text-[color:var(--accent-red-text)]">Sign out</button>
      </div>
    </aside>
  )
}
