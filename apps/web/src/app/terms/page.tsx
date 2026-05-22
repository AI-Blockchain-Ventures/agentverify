import Link from 'next/link'

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <Link href="/" className="text-sm text-gray-400 transition-colors hover:text-white">← Agent Verify</Link>
      <h1 className="mt-8 text-4xl font-bold text-white">Terms of Service</h1>
      <div className="mt-8 space-y-5 text-gray-400">
        <p>Agent Verify provides deterministic execution trust analysis for AI agent configurations. Results are informational and do not replace independent security review.</p>
        <p>You are responsible for validating findings before deploying agents in production environments.</p>
        <p>Do not submit secrets unless you intend to scan for credential exposure. Public reports redact finding evidence where applicable.</p>
        <p>MIT — AI Blockchain Ventures LLC.</p>
        <p>Contact: hello@aiblockchainventures.com</p>
        <p>Copyright 2026 AI Blockchain Ventures LLC.</p>
      </div>
    </main>
  )
}
