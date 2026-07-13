export function SharingSection() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-16 md:py-20">
      <div className="mb-12 text-center">
        <p style={{ color: 'var(--text-muted)' }} className="mb-3 text-xs font-bold uppercase tracking-widest">
          Sharing and trust
        </p>
        <h2 style={{ color: 'var(--text-primary)' }} className="text-3xl font-semibold tracking-tight md:text-4xl">
          Keep reports private until they are ready.
        </h2>
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        {[
          { label: 'Private', title: 'Private report', desc: 'New dashboard reports start private so you can review findings before sharing.' },
          { label: 'Share', title: 'Public report', desc: 'When your plan supports sharing, make a report public and send a clean report link.' },
          { label: 'Badge', title: 'Verified badge', desc: 'Verified reports can show an embeddable badge for README and documentation pages.' },
        ].map(item => (
          <div
            key={item.title}
            style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
            className="rounded-3xl p-6 shadow-xl shadow-black/5"
          >
            <div className="mb-4 inline-flex rounded-full bg-[#00C4CC]/10 px-3 py-1 text-xs font-semibold text-[#00C4CC]">{item.label}</div>
            <h3 style={{ color: 'var(--text-primary)' }} className="mb-2 font-semibold">{item.title}</h3>
            <p style={{ color: 'var(--text-secondary)' }} className="text-sm leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
