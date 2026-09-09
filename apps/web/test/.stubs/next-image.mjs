// Test-only stub for next/image — renders a plain <img>, real enough for a static-markup render test.
import React from 'react'
export default function Image({ src, alt, ...props }) {
  return React.createElement('img', { src, alt, ...props })
}
