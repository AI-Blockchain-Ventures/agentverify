import type { RuntimeBOM as RuntimeBOMType } from '@/types'

const labels: Array<[keyof RuntimeBOMType, string]> = [
  ['detectedLanguage', 'Language'],
  ['detectedFramework', 'Framework'],
  ['detectedPlatform', 'Platform'],
  ['agentName', 'Agent Name'],
  ['toolAccessLevel', 'Tool Access'],
  ['credentialExposure', 'Credentials'],
  ['memoryPersistence', 'Memory'],
  ['auditLogging', 'Audit Logging'],
  ['humanGates', 'Human Gates'],
  ['rateLimiting', 'Rate Limiting'],
  ['promptInjectionSurface', 'Prompt Injection'],
  ['delegationScope', 'Delegation'],
]

const valueClass = (value: string | null) => {
  if (!value || value === 'Unknown' || value === 'null') return 'text-[var(--text-muted)]'
  if (['Detected', 'Absent', 'Unbounded', 'Unrestricted', 'Unscoped'].includes(value)) return 'text-[#EF4444]'
  if (['Present', 'Restricted', 'Scoped', 'Not Detected', 'Bounded'].includes(value)) return 'text-[#10B981]'
  return 'text-[var(--text-secondary)]'
}

export function RuntimeBOM({ bom }: { bom: RuntimeBOMType }) {
  return (
    <div style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} className="mb-6 rounded-xl p-6">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[#06B6D4]">≡</span>
        <h3 style={{ color: 'var(--text-primary)' }} className="font-semibold">Runtime Bill of Materials</h3>
      </div>
      <p style={{ color: 'var(--text-muted)' }} className="mb-5 text-xs">Complete inventory of this agent&apos;s execution identity</p>
      <div style={{ backgroundColor: 'var(--border)' }} className="grid grid-cols-1 gap-px overflow-hidden rounded-lg md:grid-cols-2">
        {labels.map(([key, label]) => {
          const raw = bom[key]
          const value = raw === null || raw === undefined ? 'Unknown' : String(raw)
          return (
            <div key={key} style={{ backgroundColor: 'var(--card)' }} className="flex items-center justify-between px-4 py-3">
              <span style={{ color: 'var(--text-muted)' }} className="text-xs">{label}</span>
              <span className={`text-sm font-medium ${valueClass(value)}`}>{value}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
