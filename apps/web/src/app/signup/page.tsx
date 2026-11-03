import type { Metadata } from 'next'
import { AuthPage } from '@/components/auth/AuthPage'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata('/signup/', 'Create a free account', 'Start free: 10 scans a month, private reports, and PR checks for your AI agents. No credit card.')

export default function SignupPage() {
  return <AuthPage initialMode="signUp" />
}
