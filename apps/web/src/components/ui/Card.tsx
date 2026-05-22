import { HTMLAttributes } from 'react'

type Variant = 'default' | 'elevated' | 'danger' | 'success'
type Padding = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  default: 'bg-gray-950 border border-gray-800 rounded-xl',
  elevated: 'bg-gray-950 border border-gray-800 rounded-xl shadow-sm',
  danger: 'bg-gray-950 border border-red/20 rounded-xl',
  success: 'bg-gray-950 border border-green/20 rounded-xl',
}

const paddings: Record<Padding, string> = { sm: 'p-4', md: 'p-6', lg: 'p-8' }

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant
  padding?: Padding
}

export function Card({ variant = 'default', padding = 'md', className = '', ...props }: CardProps) {
  return <div className={`${variants[variant]} ${paddings[padding]} ${className}`} {...props} />
}
