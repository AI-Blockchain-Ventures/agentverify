import Link from 'next/link'

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <Link href="/" className="text-sm text-gray-400 transition-colors hover:text-white">← Agent Verify</Link>
      <h1 className="mt-8 text-4xl font-bold text-white">Privacy Policy</h1>
      <div className="mt-8 space-y-5 text-gray-400">
        <p>Agent Verify stores scan reports you explicitly save through authenticated dashboard scans or public report generation.</p>
        <p>Authentication and report storage are provided by Firebase. Analytics only initializes when cookie consent is accepted.</p>
        <p>We do not sell usage data. Uploaded or pasted scan content is processed client-side by the scanner package before optional report storage.</p>
        <p>Contact: hello@aiblockchainventures.com</p>
        <p>Copyright 2026 AI Blockchain Ventures LLC.</p>
      </div>
    </main>
  )
}
