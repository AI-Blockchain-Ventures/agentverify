const controls = [
  { label: 'Private reports by default', detail: 'A new report is owner-only until you explicitly make it public.' },
  { label: 'Owner-bound access', detail: 'Firestore Security Rules enforce ownership server-side on every read/write — not just hidden in the UI.' },
  { label: 'Secret redaction', detail: 'Detected credentials are redacted before they are ever stored or displayed — raw secret values never leave the scan.' },
  { label: 'Cross-account isolation', detail: 'One account can never list or read another account\'s reports, scans, or API keys.' },
  { label: 'Revocable share links', detail: 'Turn public sharing off at any time; the report goes private again immediately.' },
  { label: 'Report integrity hashing', detail: 'A SHA-256 hash lets you verify a report\'s evidence hasn\'t changed since it was scanned.' },
  { label: 'API key rotation', detail: 'Regenerating a key immediately revokes the previous one.' },
  { label: 'Server-side entitlement', detail: 'Pro-only features are enforced by the backend, not just hidden client-side.' },
  { label: 'Fail-closed authorization', detail: 'Access rules deny by default; nothing is readable unless a rule explicitly allows it.' },
  { label: 'Private proprietary scanner backend', detail: 'The detection engine runs server-side and is never shipped to the browser or the CLI.' },
]

export function SecurityControls() {
  return (
    <section style={{ backgroundColor: 'var(--bg)' }} className="px-6 pb-16">
      <div className="mx-auto max-w-6xl">
        <div style={{ border: '1px solid var(--border)', backgroundColor: 'var(--card)' }} className="rounded-[2rem] p-6 shadow-2xl shadow-black/5 md:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-cyan-text)]">Enterprise privacy &amp; security controls</p>
          <h2 style={{ color: 'var(--text-primary)' }} className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">What actually protects your data — not a slogan.</h2>
          <p style={{ color: 'var(--text-muted)' }} className="mt-2 max-w-2xl text-sm leading-relaxed">
            We don&apos;t claim absolute security guarantees — no one honestly can. Here is exactly what Agent Verify does, verifiable in the open-source web app, CLI, and Worker API, and tested against the real Firestore emulator.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {controls.map(c => (
              <div key={c.label} style={{ border: '1px solid var(--border)', backgroundColor: 'var(--surface)' }} className="rounded-2xl p-4">
                <p style={{ color: 'var(--text-primary)' }} className="text-sm font-semibold">{c.label}</p>
                <p style={{ color: 'var(--text-muted)' }} className="mt-1 text-xs leading-relaxed">{c.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
