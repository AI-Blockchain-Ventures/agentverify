'use client'

import { useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    const stored = localStorage.getItem('av_theme') as Theme | null
    const preferred = window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark' : 'light'
    const initial = stored ?? preferred
    applyTheme(initial)
    setTheme(initial)
  }, [])

  const applyTheme = (t: Theme) => {
    if (t === 'light') {
      document.documentElement.classList.add('light')
      document.documentElement.classList.remove('dark')
    } else {
      document.documentElement.classList.remove('light')
      document.documentElement.classList.add('dark')
    }
  }

  const setMode = (t: Theme) => {
    setTheme(t)
    localStorage.setItem('av_theme', t)
    applyTheme(t)
  }

  return { theme, setMode, isDark: theme === 'dark' }
}
