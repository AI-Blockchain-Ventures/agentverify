import Image from 'next/image'
import { assetUrl } from '@/lib/assets'

/** The Agent Verify logo: shield icon plus "Agent Verify" with "Verify" in the logo's gradient. */
export function Brand({ size = 34, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 whitespace-nowrap font-bold tracking-tight ${className}`}>
      <Image src={assetUrl('/agentverify-icon.png')} alt="" width={size} height={size} className="object-contain" style={{ height: size, width: 'auto' }} priority />
      <span style={{ color: 'var(--text-primary)' }}>
        Agent <span className="av-wordmark-accent">Verify</span>
      </span>
    </span>
  )
}
