import type { Metadata } from 'next'
import { AuthPage } from '@/components/auth/AuthPage'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata('/login/', 'Log in', 'Log in to Agent Verify to see your reports, repos and security checks.')

export default function LoginPage() {
  return <AuthPage initialMode="signIn" />
}
