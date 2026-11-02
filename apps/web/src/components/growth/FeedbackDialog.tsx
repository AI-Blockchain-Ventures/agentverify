'use client'

import { useEffect, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { apiCall } from '@/lib/v2Api'

export const FEEDBACK_EVENT = 'av:open-feedback'
export const openFeedback = () => window.dispatchEvent(new Event(FEEDBACK_EVENT))

const KINDS = [['bug', 'Something is broken'], ['idea', 'Idea or request'], ['other', 'Other']] as const

/** "Send feedback" dialog for signed-in users. Opened from the dashboard header or sidebar. */
export function FeedbackDialog({ user }: { user: User }) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'bug' | 'idea' | 'other'>('bug')
  const [message, setMessage] = useState('')
  const [state, setState] = useState<{ status: 'idle' | 'sending' | 'sent' } | { status: 'error'; text: string }>({ status: 'idle' })
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const onOpen = () => { setOpen(true); setState({ status: 'idle' }); window.setTimeout(() => textRef.current?.focus(), 20) }
    window.addEventListener(FEEDBACK_EVENT, onOpen)
    return () => window.removeEventListener(FEEDBACK_EVENT, onOpen)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  const send = async () => {
    if (message.trim().length < 3) { setState({ status: 'error', text: 'Write a few words first.' }); return }
    setState({ status: 'sending' })
    try {
      await apiCall(user, '/v1/feedback', { method: 'POST', body: { kind, message: message.trim(), page: window.location.pathname } })
      setState({ status: 'sent' })
      setMessage('')
    } catch (e) {
      setState({ status: 'error', text: e instanceof Error ? e.message : 'Could not send. Email hello@aiblockchainventures.com instead.' })
    }
  }

  const control = { backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-4 sm:items-center" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false) }}>
      <div role="dialog" aria-modal="true" aria-labelledby="feedback-title" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="w-full max-w-md rounded-xl p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id="feedback-title" style={{ color: 'var(--text-primary)' }} className="text-lg font-semibold">Send feedback</h2>
          <button onClick={() => setOpen(false)} aria-label="Close" style={{ color: 'var(--text-muted)' }} className="text-lg leading-none">×</button>
        </div>
        {state.status === 'sent' ? (
          <div className="mt-3">
            <p className="text-sm text-[color:var(--accent-green-text)]">Thanks — it&apos;s on its way to the team. We read every message and reply by email when we can.</p>
            <button onClick={() => setOpen(false)} className="mt-4 rounded-md bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6D28D9]">Close</button>
          </div>
        ) : (
          <>
            <fieldset className="mt-3">
              <legend className="sr-only">Type of feedback</legend>
              <div className="flex flex-wrap gap-2">
                {KINDS.map(([id, label]) => (
                  <label key={id} className="cursor-pointer rounded-full px-3 py-1 text-xs font-medium" style={kind === id ? { backgroundColor: 'rgba(124,58,237,0.12)', color: 'var(--accent-purple-text)', border: '1px solid rgba(124,58,237,0.4)' } : { border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                    <input type="radio" name="feedback-kind" value={id} checked={kind === id} onChange={() => setKind(id)} className="sr-only" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="mt-3 block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              What happened, or what would help?
              <textarea ref={textRef} value={message} onChange={e => setMessage(e.target.value)} maxLength={2000} rows={5} style={control} className="mt-1.5 w-full rounded-md p-2.5 text-sm font-normal outline-none focus:border-[#7C3AED]" placeholder={kind === 'bug' ? 'What did you click, and what did you expect to happen?' : 'Tell us what would make Agent Verify more useful.'} />
            </label>
            <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs">We include the page you&apos;re on so we can find the problem. Please don&apos;t paste secrets.</p>
            {state.status === 'error' && <p role="alert" className="mt-2 text-sm text-[color:var(--accent-red-text)]">{state.text}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} style={{ border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} className="rounded-md px-4 py-2 text-sm font-semibold">Cancel</button>
              <button onClick={() => void send()} disabled={state.status === 'sending'} className="rounded-md bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6D28D9] disabled:opacity-60">{state.status === 'sending' ? 'Sending…' : 'Send'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
