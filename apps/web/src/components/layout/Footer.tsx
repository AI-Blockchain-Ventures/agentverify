import Link from 'next/link'

export function Footer() {
  return (
    <footer style={{ backgroundColor: 'var(--input-bg)', borderTop: '1px solid var(--border)' }} className="px-6 py-12">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 text-center md:flex-row md:text-left">
        <div className="text-center md:text-left">
          <div style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">Agent Verify</div>
          <div style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">© 2026 AI Blockchain Ventures LLC</div>
        </div>
        <nav style={{ color: 'var(--text-secondary)' }} className="flex flex-wrap items-center justify-center gap-5 text-sm">
          <Link className="transition-opacity hover:opacity-70" href="/agentspoofed">Agent Spoofed</Link>
          <Link className="transition-opacity hover:opacity-70" href="/privacy">Privacy</Link>
          <Link className="transition-opacity hover:opacity-70" href="/terms">Terms</Link>
          <a className="transition-opacity hover:opacity-70" href="https://github.com/AI-Blockchain-Ventures/agentverify" target="_blank" rel="noreferrer">GitHub</a>
          <a className="transition-opacity hover:opacity-70" href="mailto:hello@aiblockchainventures.com">Email</a>
        </nav>
        <div style={{ color: 'var(--text-muted)' }} className="text-sm">Powered by A2SPA</div>
      </div>
    </footer>
  )
}
