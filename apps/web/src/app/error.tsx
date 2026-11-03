'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { reportClientError } from '@/lib/errorReporter'

/** Shown instead of a blank "Application error" when a page crashes. The error is reported to the admin. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportClientError(error, 'page') }, [error])
  return (
    <main style={{ backgroundColor: 'var(--bg)' }} className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <div role="alert" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="w-full max-w-md rounded-xl p-6 text-center">
        <h1 style={{ color: 'var(--text-primary)' }} className="text-xl font-semibold">Something went wrong on this page</h1>
        <p style={{ color: 'var(--text-secondary)' }} className="mt-2 text-sm leading-6">We&apos;ve been notified automatically. Try again, or go back to the homepage.</p>
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={() => reset()} className="rounded-md bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6D28D9]">Try again</button>
          <Link href="/" style={{ border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} className="rounded-md px-4 py-2 text-sm font-semibold">Homepage</Link>
        </div>
      </div>
    </main>
  )
}
