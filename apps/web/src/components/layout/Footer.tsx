import Link from 'next/link'
import { Brand } from '@/components/layout/Brand'
import { APP_VERSION_SHORT } from '@/lib/release'

const columns: Array<{ title: string; links: Array<{ href: string; label: string; external?: boolean }> }> = [
  { title: 'Product', links: [
    { href: '/developers#github-app', label: 'PR checks' },
    { href: '/developers#guard', label: 'Agent Guard' },
    { href: '/agentspoofed', label: 'Live demo' },
    { href: '/report/demo', label: 'Sample report' },
    { href: '/pricing', label: 'Pricing' },
  ] },
  { title: 'Developers', links: [
    { href: '/docs', label: 'Docs' },
    { href: '/developers#cli', label: 'CLI & npm' },
    { href: '/developers#mcp', label: 'VS Code & MCP' },
    { href: '/docs#ci-cd', label: 'GitHub Action' },
    { href: 'https://github.com/AI-Blockchain-Ventures/agentverify', label: 'GitHub', external: true },
  ] },
  { title: 'Resources', links: [
    { href: '/checks', label: 'Check library' },
    { href: '/mcp', label: 'MCP safety directory' },
    { href: '/state-of-mcp-security', label: 'State of MCP Security' },
    { href: '/state-of-agent-security', label: 'State of AI Agent Security' },
    { href: '/owasp-agentic-skills', label: 'OWASP agentic profile' },
    { href: '/profile-attestation', label: 'Signing key' },
    { href: '/whats-new', label: "What's new in 2.0" },
    { href: '/status', label: 'Status' },
    { href: 'https://github.com/AI-Blockchain-Ventures/agentverify/blob/main/CHANGELOG.md', label: 'Changelog', external: true },
  ] },
  { title: 'Company', links: [
    { href: 'https://aimodularity.com', label: 'AI Modularity', external: true },
    { href: '/trust', label: 'Trust Center' },
    { href: 'mailto:hello@aiblockchainventures.com', label: 'Contact', external: true },
    { href: '/privacy', label: 'Privacy' },
    { href: '/terms', label: 'Terms' },
  ] },
]

export function Footer() {
  return (
    <footer className="no-print mt-8" style={{ backgroundColor: 'var(--card)', borderTop: '1px solid var(--border)' }}>
      <div className="av-container">
        <div className="grid grid-cols-2 gap-8 py-12 md:grid-cols-[1.6fr_repeat(4,1fr)]">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" aria-label="Agent Verify home" className="inline-block text-base"><Brand size={32} /></Link>
            <p style={{ color: 'var(--text-secondary)' }} className="mt-3 max-w-xs text-sm leading-6">
              Security for AI agents — scan, guard and prove your agents are safe before they run. Powered by A2SPA.
            </p>
            <Link href="/status" style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }} className="mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs">
              <span className="h-2 w-2 rounded-full bg-[#12B76A]" aria-hidden="true" /> System status
            </Link>
          </div>
          {columns.map(col => (
            <div key={col.title}>
              <h2 style={{ color: 'var(--text-muted)' }} className="mb-3 text-xs font-semibold uppercase tracking-wider">{col.title}</h2>
              <ul className="space-y-2">
                {col.links.map(link => (
                  <li key={link.label}>
                    {link.external ? (
                      <a href={link.href} target={link.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" style={{ color: 'var(--text-secondary)' }} className="text-sm transition-colors hover:text-[var(--text-primary)]">{link.label}</a>
                    ) : (
                      <Link href={link.href} style={{ color: 'var(--text-secondary)' }} className="text-sm transition-colors hover:text-[var(--text-primary)]">{link.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }} className="flex flex-wrap items-center justify-between gap-3 py-5 text-xs">
          <span>© 2026 AI Blockchain Ventures LLC. All rights reserved.</span>
          <span>Agent Verify {APP_VERSION_SHORT}</span>
        </div>
      </div>
    </footer>
  )
}
