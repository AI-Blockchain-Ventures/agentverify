'use client'

import { Component, type ReactNode } from 'react'
import { reportClientError } from '@/lib/errorReporter'

/**
 * Keeps one broken section from taking down the whole page ("Application error"). Shows a short
 * message with a retry button instead; the rest of the dashboard keeps working.
 */
export class SectionErrorBoundary extends Component<{ children: ReactNode; label?: string }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error('Section failed to render:', error)
    reportClientError(error, this.props.label ?? 'section')
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="rounded-xl p-6 text-center">
        <p style={{ color: 'var(--text-primary)' }} className="font-semibold">{this.props.label ?? 'This section'} could not load.</p>
        <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">The rest of Agent Verify still works. Try again, or email hello@aiblockchainventures.com if it keeps happening.</p>
        <button onClick={() => this.setState({ failed: false })} className="mt-4 rounded-md bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6D28D9]">Try again</button>
      </div>
    )
  }
}
