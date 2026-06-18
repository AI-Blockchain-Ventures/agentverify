import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const loadSpoofEnv = () => {
  const envPath = fileURLToPath(new URL('../../spoof/.env', import.meta.url))
  if (!existsSync(envPath)) return {}

  return Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && line.includes('='))
      .map(line => {
        const index = line.indexOf('=')
        const key = line.slice(0, index).trim()
        const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
        return [key, value]
      })
  )
}

const spoofEnv = loadSpoofEnv()

/** @type {import('next').NextConfig} */
const isExport = process.env.NEXT_EXPORT === 'true'

const nextConfig = {
  ...(isExport ? { output: 'export' } : {}),
  basePath: '/agentverify',
  trailingSlash: true,
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_SPOOF_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_SPOOF_FIREBASE_API_KEY ?? spoofEnv.FIREBASE_API_KEY ?? '',
    NEXT_PUBLIC_SPOOF_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_SPOOF_FIREBASE_AUTH_DOMAIN ?? spoofEnv.FIREBASE_AUTH_DOMAIN ?? '',
    NEXT_PUBLIC_SPOOF_FIREBASE_DATABASE_URL: process.env.NEXT_PUBLIC_SPOOF_FIREBASE_DATABASE_URL ?? spoofEnv.FIREBASE_DATABASE_URL ?? '',
    NEXT_PUBLIC_SPOOF_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_SPOOF_FIREBASE_PROJECT_ID ?? spoofEnv.FIREBASE_PROJECT_ID ?? '',
    NEXT_PUBLIC_SPOOF_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_SPOOF_FIREBASE_STORAGE_BUCKET ?? spoofEnv.FIREBASE_STORAGE_BUCKET ?? '',
    NEXT_PUBLIC_SPOOF_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_SPOOF_FIREBASE_MESSAGING_SENDER_ID ?? spoofEnv.FIREBASE_MESSAGING_SENDER_ID ?? '',
    NEXT_PUBLIC_SPOOF_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_SPOOF_FIREBASE_APP_ID ?? spoofEnv.FIREBASE_APP_ID ?? '',
  },
}

export default nextConfig
