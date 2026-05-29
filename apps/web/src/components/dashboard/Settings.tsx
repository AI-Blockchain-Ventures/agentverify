'use client'

import Link from 'next/link'
import { useAuth } from '@/components/auth/AuthProvider'
import { Button } from '@/components/ui/Button'

export function Settings() {
  const { user, signOut } = useAuth()
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded-xl border border-gray-800 bg-gray-950 p-6">
        <h2 className="text-xl font-bold text-white">Account</h2>
        <p className="mt-2 text-sm text-gray-400">{user?.email ?? 'Unknown user'}</p>
        <Button className="mt-4" variant="danger" onClick={signOut}>Sign Out</Button>
      </div>
      <div className="rounded-xl border border-gray-800 bg-gray-950 p-6">
        <h2 className="text-xl font-bold text-white">Legal</h2>
        <div className="mt-3 flex gap-4 text-sm text-gray-400">
          <Link className="transition-colors hover:text-white" href="/privacy">Privacy</Link>
          <Link className="transition-colors hover:text-white" href="/terms">Terms</Link>
        </div>
      </div>
      <div className="rounded-xl border border-gray-800 bg-gray-950 p-6">
        <h2 className="text-xl font-bold text-white">Version</h2>
        <p className="mt-2 font-mono text-sm text-gray-500">Agent Verify Web v1.1.0</p>
      </div>
    </div>
  )
}
