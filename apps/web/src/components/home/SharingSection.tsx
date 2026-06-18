export function SharingSection() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-20">
      <div className="mb-12 text-center">
        <p style={{ color: 'var(--text-muted)' }} className="mb-3 text-xs font-bold uppercase tracking-widest">
          SHARING & TRUST
        </p>
        <h2 style={{ color: 'var(--text-primary)' }} className="text-3xl font-bold md:text-4xl">
          Share results your way
        </h2>
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        {[
          { icon: '🔒', title: 'Private by default', desc: 'New reports are only visible to you until you choose to share them.' },
          { icon: '🌐', title: 'Public link', desc: 'Make any report public and share the link with your team or clients.' },
          { icon: '🛡️', title: 'README badge', desc: 'Verified agents get an embeddable badge showing live trust score.' },
        ].map(item => (
          <div
            key={item.title}
            style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
            className="rounded-xl p-6"
          >
            <div className="mb-3 text-2xl">{item.icon}</div>
            <h3 style={{ color: 'var(--text-primary)' }} className="mb-2 font-semibold">{item.title}</h3>
            <p style={{ color: 'var(--text-secondary)' }} className="text-sm leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
