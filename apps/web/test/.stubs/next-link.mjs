// Test-only stub for next/link — renders a plain <a>, real enough for a static-markup render test.
import React from 'react'
export default function Link({ href, children, ...props }) {
  return React.createElement('a', { href, ...props }, children)
}
