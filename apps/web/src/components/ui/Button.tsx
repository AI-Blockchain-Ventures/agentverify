'use client'

import { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'ghost' | 'danger' | 'outline' | 'link'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary: 'bg-white text-black font-semibold hover:bg-gray-100',
  ghost: 'border border-gray-700 text-white hover:border-gray-600',
  danger: 'bg-red/10 text-red border border-red/30',
  outline: 'border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500',
  link: 'text-gray-400 hover:text-white',
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
