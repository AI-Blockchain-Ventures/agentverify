import Link from 'next/link'

export default function NotFound() {
  return (
    <div style={{ backgroundColor: 'var(--bg)' }} className="flex min-h-[70vh] items-center justify-center px-6 py-20">
      <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="max-w-md rounded-3xl p-8 text-center shadow-2xl shadow-black/5">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#7C3AED]/10 text-lg font-semibold text-[color:var(--accent-purple-text)]">404</div>
        <p style={{ color: 'var(--text-primary)' }} className="text-xl font-semibold">Page not found</p>
        <p style={{ color: 'var(--text-muted)' }} className="mt-2 text-sm">
          The page you&apos;re looking for doesn&apos;t exist, moved, or the link is incorrect.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link href="/" className="rounded-2xl bg-[#7C3AED] px-5 py-3 text-sm font-semibold text-white hover:opacity-90">Back to home</Link>
          <Link href="/docs" style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }} className="rounded-2xl px-5 py-3 text-sm font-semibold hover:opacity-80">View docs</Link>
        </div>
      </div>
    </div>
  )
}
