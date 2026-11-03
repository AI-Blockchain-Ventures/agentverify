'use client'

import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { apiCall } from '@/lib/v2Api'

interface ReferralSummary { code: string; link: string; invited: number; qualified: number; bonusUntil: string | null; rewardDays: number; friendDays: number }

/** "Invite friends, get Pro free" — shown in the Billing tab. */
export function InviteCard({ user }: { user: User }) {
  const [data, setData] = useState<ReferralSummary | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    apiCall<ReferralSummary>(user, '/v1/referrals').then(setData).catch(() => setData(null))
  }, [user])

  if (!data) return null
  const until = data.bonusUntil ? new Date(data.bonusUntil).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked */ }
  }
  const share = `Agent Verify scans AI agents for security risks before they ship — free to try: ${data.link}`

  return (
    <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-3xl p-6 shadow-xl shadow-black/5">
      <h2 style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold uppercase tracking-wider">Invite friends, get Pro free</h2>
      <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-sm">
        For every friend who signs up and runs a scan, you get <strong style={{ color: 'var(--text-primary)' }}>1 month of Pro</strong> and they get {data.friendDays} days of Pro.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="invite-link" className="sr-only">Your invite link</label>
        <input id="invite-link" readOnly value={data.link} onFocus={e => e.currentTarget.select()} style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }} className="min-w-0 flex-1 rounded-xl px-3 py-2 font-mono text-xs" />
        <button onClick={copy} className="av-press rounded-xl bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white">{copied ? 'Copied' : 'Copy link'}</button>
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(share)}`} target="_blank" rel="noreferrer" className="font-semibold text-[color:var(--accent-purple-text)] hover:underline">Share on X</a>
        <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(data.link)}`} target="_blank" rel="noreferrer" className="font-semibold text-[color:var(--accent-purple-text)] hover:underline">Share on LinkedIn</a>
        <a href={`mailto:?subject=${encodeURIComponent('Check your AI agent before you ship it')}&body=${encodeURIComponent(share)}`} className="font-semibold text-[color:var(--accent-purple-text)] hover:underline">Email a friend</a>
      </div>
      <p style={{ color: 'var(--text-muted)' }} className="mt-4 text-xs">
        {data.invited} invited · {data.qualified} earned you Pro{until ? ` · free Pro until ${until}` : ''}
      </p>
    </section>
  )
}
