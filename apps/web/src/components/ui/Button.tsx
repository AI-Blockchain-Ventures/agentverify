'use client'

import { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'ghost' | 'danger' | 'outline' | 'link'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  // Text swaps white->dark in sync with the bg swap purple->cyan, so contrast stays AA-safe
  // in both the resting (white on purple, 5.7:1) and hover (dark on cyan, 8.2:1) states.
  primary: 'bg-[#7C3AED] text-white font-semibold hover:bg-[#06B6D4] hover:text-[#060A0F]',
  ghost: 'border border-[var(--border)] text-[var(--text-primary)] hover:opacity-70',
  danger: 'bg-red/10 text-red border border-red/30',
  outline: 'border border-[var(--border)] text-[var(--text-secondary)] hover:opacity-70',
  link: 'text-[var(--text-secondary)] hover:opacity-70',
}

const sizes: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-5 py-2.5 text-sm',
  lg: 'px-6 py-3 text-base',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export function Button({ variant = 'primary', size = 'md', className = '', ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex cursor-pointer items-center gap-2 rounded-lg font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-30 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  )
}
