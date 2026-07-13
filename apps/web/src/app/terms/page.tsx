'use client'

const sections = [
  {
    title: 'Acceptance',
    body: `By using Agent Verify, you agree to these terms. 
If you do not agree, do not use the service.`,
  },
  {
    title: 'What Agent Verify does',
    body: `Agent Verify analyzes AI agent configurations for security 
issues. Our analysis is deterministic and based on static analysis 
of the configuration you submit. Results are informational — they 
identify potential security issues but do not guarantee complete 
security coverage or prove that every possible risk has been found.`,
  },
  {
    title: 'Free use',
    body: `Agent Verify is free to use for individual developers and 
teams. We reserve the right to introduce paid tiers for advanced 
features in the future. Existing free features will remain free.`,
  },
  {
    title: 'Acceptable use',
    body: `You may not use Agent Verify to analyze agents you do not 
own or have permission to analyze. You may not attempt to reverse 
engineer our analysis engine. You may not use the service to generate 
false security certifications.`,
  },
  {
    title: 'API keys',
    body: `Your API key is personal and must not be shared publicly. 
You are responsible for all scans run with your API key. If your key 
is compromised, regenerate it immediately from your dashboard.`,
  },
  {
    title: 'Intellectual property',
    body: `The Agent Verify analysis engine, scoring methodology, 
execution trust framework, and A2SPA protocol are proprietary to 
AI Blockchain Ventures LLC. The web application and CLI client are 
open source under the MIT license. See our GitHub repository for details.`,
  },
  {
    title: 'Disclaimer',
    body: `Agent Verify is provided as-is without warranty. We are 
not liable for security incidents that occur after using our service. 
Our analysis is a tool to assist your security review, not a 
replacement for it.`,
  },
  {
    title: 'Contact',
    body: `AI Blockchain Ventures LLC
hello@aiblockchainventures.com`,
  },
]

export default function TermsPage() {
  return (
    <>
      <div className="mx-auto max-w-2xl px-6 pt-6">
        <button onClick={() => window.history.back()} style={{ color: 'var(--text-muted)' }} className="mb-6 flex items-center gap-2 text-sm transition-opacity hover:opacity-70">
          ← Back
        </button>
      </div>
      <div style={{ backgroundColor: 'var(--bg)' }} className="mx-auto max-w-2xl px-6 py-16">
        <div className="mb-8">
          <h1 style={{ color: 'var(--text-primary)' }} className="mt-4 text-2xl font-bold">Terms of Use</h1>
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
