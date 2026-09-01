'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import type { DashboardTab } from '@/types'
import { useAuth } from '@/components/auth/AuthProvider'
import { assetUrl } from '@/lib/assets'

interface NavItem { id: DashboardTab; label: string; icon: string }
interface NavSection { label: string; items: NavItem[] }

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
    { id: 'settings', label: 'Settings', icon: '⚙' },
  ] },
]

/** Full-navigation slide-in drawer for mobile — the "everything else" complement to BottomNav's
 * 4 thumb-reachable shortcuts. Traps focus loosely (closes on Escape/backdrop) and respects
 * prefers-reduced-motion via the shared .av-animate-slide utility. */
export function MobileNavDrawer({
  open,
  onClose,
  active,
  onChange,
  reportBadge,
  planLabel,
}: {
  open: boolean
  onClose: () => void
  active: DashboardTab
  onChange: (tab: DashboardTab) => void
  reportBadge?: number
  planLabel: string
}) {
  const { user, signOut } = useAuth()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[90] md:hidden">
      <button
        aria-label="Close menu"
        onClick={onClose}
        className="av-animate-fade absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        style={{ backgroundColor: 'var(--sidebar-bg)', borderLeft: '1px solid var(--border)' }}
        className="av-animate-slide absolute right-0 top-0 flex h-full w-[82%] max-w-xs flex-col shadow-2xl"
      >
        <div style={{ borderBottom: '1px solid var(--border)' }} className="flex items-center justify-between px-4 py-3.5">
          <div className="flex items-center gap-2">
            <Image src={assetUrl('/agentverify-icon.png')} alt="Agent Verify" width={30} height={30} className="h-7 w-7 rounded-xl object-contain" />
            <div className="leading-tight">
              <p style={{ color: 'var(--text-primary)' }} className="text-sm font-bold">Agent Verify</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--accent-purple-text)]">{planLabel}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close menu" style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }} className="flex h-8 w-8 items-center justify-center rounded-lg">✕</button>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-4">
          {SECTIONS.map(section => (
            <div key={section.label}>
              <p style={{ color: 'var(--text-muted)' }} className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em]">{section.label}</p>
              <div className="space-y-0.5">
                {section.items.map(item => (
                  <button
                    key={item.id}
                    onClick={() => { onChange(item.id); onClose() }}
                    aria-current={active === item.id ? 'page' : undefined}
                    style={{
                      backgroundColor: active === item.id ? 'var(--surface)' : 'transparent',
                      color: active === item.id ? 'var(--text-primary)' : 'var(--text-muted)',
                      borderLeft: active === item.id ? '2px solid #7C3AED' : '2px solid transparent',
                    }}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold"
                  >
                    <span className="w-4 text-center" aria-hidden="true">{item.icon}</span>
                    <span>{item.label}</span>
                    {item.id === 'reports' && reportBadge && reportBadge > 0 ? (
                      <span className="ml-auto rounded-full bg-[#E03E3E] px-2 py-0.5 text-[11px] font-bold text-white">{reportBadge > 9 ? '9+' : reportBadge}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div style={{ borderTop: '1px solid var(--border)' }} className="space-y-0.5 pt-3">
            <Link href="/docs" onClick={onClose} style={{ color: 'var(--text-muted)' }} className="flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold">
              <span className="w-4 text-center" aria-hidden="true">▥</span><span>Docs</span>
            </Link>
            <Link href="/" onClick={onClose} style={{ color: 'var(--text-muted)' }} className="flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold">
              <span className="w-4 text-center" aria-hidden="true">⌂</span><span>Agent Verify home</span>
            </Link>
          </div>
        </nav>

        <div style={{ borderTop: '1px solid var(--border)' }} className="px-4 py-3.5">
          <div style={{ color: 'var(--text-muted)' }} className="mb-2 truncate text-xs">{user?.email ?? ''}</div>
          <button onClick={signOut} style={{ color: 'var(--accent-red-text)' }} className="text-xs font-semibold">Sign out</button>
        </div>
      </div>
    </div>
  )
}
