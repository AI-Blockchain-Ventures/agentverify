import { HTMLAttributes } from 'react'

type Variant = 'verified' | 'failed' | 'cat-a' | 'cat-b' | 'cli' | 'warning' | 'muted'

const variants: Record<Variant, string> = {
  verified: 'bg-green/10 text-green border border-green/20',
  failed: 'bg-red/10 text-red border border-red/20',
  'cat-a': 'bg-red/5 text-red border border-red/10',
  'cat-b': 'bg-orange/5 text-orange border border-orange/10',
  cli: 'bg-blue/10 text-blue border border-blue/20',
  warning: 'bg-orange/10 text-orange border border-orange/20',
  muted: 'bg-gray-900 text-gray-500 border border-gray-800',
}

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant
}

export function Badge({ variant = 'muted', className = '', ...props }: BadgeProps) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${variants[variant]} ${className}`} {...props} />
}
