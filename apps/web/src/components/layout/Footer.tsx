import Link from 'next/link'

export function Footer() {
  return (
    <footer className="border-t border-[#1E2D40] bg-[#080B14] px-6 py-12">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 md:flex-row">
        <div className="text-center md:text-left">
          <div className="text-sm font-semibold text-white">Agent Verify</div>
          <div className="mt-1 text-sm text-[#4B6080]">© 2026 AI Blockchain Ventures LLC</div>
        </div>
        <nav className="flex flex-wrap items-center justify-center gap-5 text-sm text-[#94A3B8]">
          <Link className="transition-colors hover:text-white" href="/privacy">Privacy</Link>
          <Link className="transition-colors hover:text-white" href="/terms">Terms</Link>
          <a className="transition-colors hover:text-white" href="https://github.com/AI-Blockchain-Ventures/agentverify" target="_blank" rel="noreferrer">GitHub</a>
          <a className="transition-colors hover:text-white" href="mailto:hello@aiblockchainventures.com">Email</a>
        </nav>
        <div className="text-sm text-[#4B6080]">Powered by A2SPA</div>
      </div>
    </footer>
  )
}
