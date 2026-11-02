'use client'

import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { getApiBaseUrl } from '@/lib/billing'
import { apiCall } from '@/lib/v2Api'

/** "Add to Slack", plus finishing `/agentverify connect` (the dashboard opens with ?slack_link=…). */
export function SlackConnect({ user }: { user: User }) {
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('slack_link')
    if (!code) return
    const clean = new URL(window.location.href)
    clean.searchParams.delete('slack_link')
    window.history.replaceState(null, '', clean.toString())
    apiCall<{ team: string }>(user, '/v1/slack/link', { method: 'POST', body: { code } })
      .then(r => setNotice({ ok: true, text: `Slack workspace ${r.team} is now linked to your account. Scans from Slack use your plan.` }))
      .catch(e => setNotice({ ok: false, text: e instanceof Error ? e.message : 'Could not link Slack.' }))
  }, [user])

  return (
    <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="av-hover-lift rounded-3xl p-5">
      <div className="flex items-start justify-between gap-3">
        <p style={{ color: 'var(--text-primary)' }} className="text-base font-semibold">Slack</p>
        <span className="shrink-0 rounded-full bg-[#00B37E]/10 px-3 py-1 text-[11px] font-semibold text-[color:var(--accent-green-text)]">Available</span>
      </div>
      <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-sm leading-relaxed">Scan a public GitHub repo or pasted code from any channel with <code>/agentverify scan</code>, and share the result with your team.</p>
      <p style={{ color: 'var(--text-muted)' }} className="mt-3 text-xs leading-relaxed"><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Setup: </span>Add the app, then run <code>/agentverify connect</code> in Slack to use your plan.</p>
      <a href={`${getApiBaseUrl()}/v1/slack/install`} className="mt-4 inline-flex rounded-xl bg-[#4A154B] px-4 py-2 text-xs font-semibold text-white hover:opacity-90">Add to Slack</a>
      {notice && <p className="mt-3 text-xs" style={{ color: notice.ok ? 'var(--accent-green-text)' : 'var(--accent-orange-text)' }}>{notice.text}</p>}
    </div>
  )
}
