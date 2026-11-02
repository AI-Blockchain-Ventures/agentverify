'use client'

import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { apiCall } from '@/lib/v2Api'

const ROLES: Array<[string, string]> = [['engineer', 'Engineer / developer'], ['security', 'Security'], ['manager', 'Engineering manager / CTO'], ['founder', 'Founder'], ['compliance', 'Compliance / GRC'], ['student', 'Student / hobby'], ['other', 'Other']]
const TEAM_SIZES: Array<[string, string]> = [['1', 'Just me'], ['2-10', '2–10'], ['11-50', '11–50'], ['51-200', '51–200'], ['200+', '200+']]
const FRAMEWORKS: Array<[string, string]> = [['langchain', 'LangChain'], ['openai-agents', 'OpenAI Agents'], ['mcp', 'MCP servers'], ['crewai', 'CrewAI'], ['anthropic', 'Claude / Anthropic'], ['llamaindex', 'LlamaIndex'], ['custom', 'Custom']]
const HEARD: Array<[string, string]> = [['google', 'Google search'], ['github', 'GitHub'], ['friend', 'A friend or colleague'], ['reddit-hn', 'Reddit / Hacker News'], ['x-linkedin', 'X / LinkedIn'], ['product-hunt', 'Product Hunt'], ['other', 'Other']]

/**
 * Signup step 2, "Tell us a bit about you". Shown once, after the account exists, so it never
 * blocks signing up. Everything is optional and "Skip for now" always works.
 */
export function OnboardingProfile({ user }: { user: User }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: user.displayName ?? '', company: '', role: 'engineer', teamSize: '1', building: [] as string[], heardFrom: '', weeklyEmail: false })

  useEffect(() => {
    let cancelled = false
    apiCall<{ onboarded?: boolean }>(user, '/v1/profile')
      .then(p => { if (!cancelled && p.onboarded === false) setOpen(true) })
      .catch(() => { /* profiles not available: never block the dashboard */ })
    return () => { cancelled = true }
  }, [user])

  if (!open) return null

  const submit = async (skip: boolean) => {
    setSaving(true)
    setError('')
    try {
      await apiCall(user, '/v1/profile', { method: 'POST', body: skip ? { skip: true } : { name: form.name, company: form.company, role: form.role, teamSize: form.teamSize, building: form.building, heardFrom: form.heardFrom || undefined } })
      if (!skip && form.weeklyEmail) await apiCall(user, '/v1/digest', { method: 'POST', body: { enabled: true } }).catch(() => undefined)
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. You can skip for now.')
    }
    setSaving(false)
  }

  const toggle = (id: string) => setForm(f => ({ ...f, building: f.building.includes(id) ? f.building.filter(b => b !== id) : [...f.building, id] }))
  const input = { backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }
  const label = 'flex flex-col gap-1.5 text-xs font-semibold'

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto px-4 py-8" style={{ backgroundColor: 'rgba(16,24,40,0.5)' }}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        onSubmit={e => { e.preventDefault(); void submit(false) }}
        className="av-animate-scale w-full max-w-xl rounded-xl p-6 shadow-2xl md:p-8"
        style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border-light)' }}
      >
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span>1 Account ✓</span>
          <span className="h-0.5 flex-1 rounded bg-[#7C3AED]" />
          <span className="font-semibold text-[color:var(--accent-purple-text)]">2 About you</span>
          <span className="h-0.5 flex-1 rounded" style={{ backgroundColor: 'var(--border)' }} />
          <span>3 First scan</span>
        </div>
        <h2 id="onboarding-title" className="mt-5 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Tell us a bit about you</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Helps us set up the right checks. Takes 20 seconds — all optional.</p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2" style={{ color: 'var(--text-primary)' }}>
          <label className={label}>Full name<input autoComplete="name" maxLength={80} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={input} className="rounded-md px-3 py-2 text-sm font-normal" /></label>
          <label className={label}>Company<input autoComplete="organization" maxLength={120} value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} placeholder="Acme Corp" style={input} className="rounded-md px-3 py-2 text-sm font-normal" /></label>
          <label className={label}>Your role
            <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} style={input} className="rounded-md px-3 py-2 text-sm font-normal">
              {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className={label}>Team size
            <select value={form.teamSize} onChange={e => setForm({ ...form, teamSize: e.target.value })} style={input} className="rounded-md px-3 py-2 text-sm font-normal">
              {TEAM_SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <fieldset className="sm:col-span-2">
            <legend className="mb-1.5 text-xs font-semibold">What are you building with? <span className="font-normal" style={{ color: 'var(--text-muted)' }}>(pick any)</span></legend>
            <div className="flex flex-wrap gap-1.5">
              {FRAMEWORKS.map(([v, l]) => {
                const on = form.building.includes(v)
                return (
                  <button key={v} type="button" aria-pressed={on} onClick={() => toggle(v)} className="rounded-full px-3 py-1 text-xs font-medium"
                    style={{ border: `1px solid ${on ? '#7C3AED' : 'var(--border-light)'}`, backgroundColor: on ? 'rgba(124,58,237,0.10)' : 'var(--card)', color: on ? 'var(--accent-purple-text)' : 'var(--text-secondary)' }}>
                    {l}
                  </button>
                )
              })}
            </div>
          </fieldset>
          <label className={`${label} sm:col-span-2`}>How did you hear about us?
            <select value={form.heardFrom} onChange={e => setForm({ ...form, heardFrom: e.target.value })} style={input} className="rounded-md px-3 py-2 text-sm font-normal">
              <option value="">Choose one</option>
              {HEARD.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={form.weeklyEmail} onChange={e => setForm({ ...form, weeklyEmail: e.target.checked })} className="h-4 w-4 accent-[#7C3AED]" />
            Send me the weekly security email (turn it off any time)
          </label>
        </div>

        {error && <p className="mt-3 text-xs text-[color:var(--accent-orange-text)]">{error}</p>}

        <div className="mt-6 flex items-center justify-between gap-3">
          <button type="button" disabled={saving} onClick={() => void submit(true)} className="text-sm underline-offset-2 hover:underline" style={{ color: 'var(--text-muted)' }}>Skip for now</button>
          <button type="submit" disabled={saving} className="rounded-md bg-[#7C3AED] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#6D28D9] disabled:opacity-60">{saving ? 'Saving…' : 'Continue →'}</button>
        </div>
      </form>
    </div>
  )
}
