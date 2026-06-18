'use client'

const sections = [
  {
    title: 'What we collect',
    body: `When you create an account, we collect your email address 
and a hashed password (via Firebase Authentication). When you run 
scans, we store your scan results including verdict, score, findings, 
and agent metadata (file name, platform) in Firebase Firestore. 
We do not store the raw agent code you submit for analysis.`,
  },
  {
    title: 'How we use it',
    body: `Your scan results are stored to power your Reports dashboard 
and to generate shareable report links. Your email is used for account 
authentication only. We do not sell your data, share it with third 
parties, or use it for advertising.`,
  },
  {
    title: 'Analytics',
    body: `With your consent (via the cookie banner), we use Firebase 
Analytics to understand how the product is used. This data is 
aggregated and anonymous. You can decline analytics and the product 
will work identically.`,
  },
  {
    title: 'API keys',
    body: `API keys you generate are stored in Firebase Firestore 
under your account. They are used to authenticate CLI and API scans. 
Keep your API key private — do not commit it to version control.`,
  },
  {
    title: 'Data retention',
    body: `Your scan reports are retained until you delete your account. 
You can delete individual reports from your dashboard at any time. 
To delete your account and all associated data, contact us at 
hello@aiblockchainventures.com.`,
  },
  {
    title: 'Security',
    body: `All data is transmitted over HTTPS. Firebase Authentication 
handles password hashing and storage. We do not have access to your 
password. Your scan data is protected by Firebase security rules that 
restrict access to your account only.`,
  },
  {
    title: 'Contact',
    body: `For privacy questions or data deletion requests, contact 
AI Blockchain Ventures LLC at hello@aiblockchainventures.com.`,
  },
]

export default function PrivacyPage() {
  return (
    <>
      <div className="mx-auto max-w-2xl px-6 pt-6">
        <button onClick={() => window.history.back()} style={{ color: 'var(--text-muted)' }} className="mb-6 flex items-center gap-2 text-sm transition-opacity hover:opacity-70">
          ← Back
        </button>
      </div>
      <div style={{ backgroundColor: 'var(--bg)' }} className="mx-auto max-w-2xl px-6 py-16">
        <div className="mb-8">
          <h1 style={{ color: 'var(--text-primary)' }} className="mt-4 text-2xl font-bold">Privacy Policy</h1>
          <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-sm">Last updated: June 2026</p>
        </div>

        {sections.map(section => (
          <div key={section.title} style={{ borderBottom: '1px solid var(--border)' }} className="mb-8 pb-8 last:border-b-0">
            <h2 style={{ color: 'var(--text-primary)' }} className="mb-2 font-semibold">{section.title}</h2>
            <p style={{ color: 'var(--text-secondary)' }} className="whitespace-pre-line text-sm leading-relaxed">{section.body}</p>
          </div>
        ))}
      </div>
    </>
  )
}
