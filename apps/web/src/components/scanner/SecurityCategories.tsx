import type { SecurityCategoryStatus } from '@/types'

const statusStyle: Record<SecurityCategoryStatus['status'], { color: string; label: string }> = {
  strong: { color: 'text-[color:var(--accent-green-text)]', label: 'Strong' },
  needs_attention: { color: 'text-[color:var(--accent-orange-text)]', label: 'Needs attention' },
  critical: { color: 'text-[color:var(--accent-red-text)]', label: 'Critical' },
  not_assessed: { color: 'text-[var(--text-muted)]', label: 'Not assessed' },
}

const statusDot: Record<SecurityCategoryStatus['status'], string> = {
  strong: 'bg-[#00B37E]',
  needs_attention: 'bg-[#E07B39]',
  critical: 'bg-[#E03E3E]',
  not_assessed: 'bg-[var(--text-muted)]',
}

export function SecurityCategories({ categories }: { categories: SecurityCategoryStatus[] }) {
  if (categories.length === 0) return null

  return (
    <section style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mb-6 rounded-3xl p-6 shadow-xl shadow-black/5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-purple-text)]">Security categories</p>
      <h2 style={{ color: 'var(--text-primary)' }} className="mt-1 text-lg font-semibold">Coverage across 11 security categories</h2>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map(cat => (
          <div key={cat.id} style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} className="flex items-center justify-between gap-2 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot[cat.status]}`} />
              <span style={{ color: 'var(--text-primary)' }} className="text-sm font-medium">{cat.label}</span>
            </div>
            <span className={`text-xs font-semibold ${statusStyle[cat.status].color}`}>
              {statusStyle[cat.status].label}{cat.findingCount > 0 ? ` (${cat.findingCount})` : ''}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
