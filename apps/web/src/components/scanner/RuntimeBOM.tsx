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
  if (!value || value === 'Unknown' || value === 'null') return 'text-[#4B6080]'
  if (['Detected', 'Absent', 'Unbounded', 'Unrestricted', 'Unscoped'].includes(value)) return 'text-[#EF4444]'
  if (['Present', 'Restricted', 'Scoped', 'Not Detected', 'Bounded'].includes(value)) return 'text-[#10B981]'
  return 'text-[#94A3B8]'
}

export function RuntimeBOM({ bom }: { bom: RuntimeBOMType }) {
  return (
    <div className="mb-6 rounded-xl border border-[#1E2D40] bg-[#0F1623] p-6">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[#06B6D4]">≡</span>
        <h3 className="font-semibold text-white">Runtime Bill of Materials</h3>
      </div>
      <p className="mb-5 text-xs text-[#4B6080]">Complete inventory of this agent&apos;s execution identity</p>
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg bg-[#1E2D40] md:grid-cols-2">
        {labels.map(([key, label]) => {
          const raw = bom[key]
          const value = raw === null || raw === undefined ? 'Unknown' : String(raw)
          return (
            <div key={key} className="flex items-center justify-between bg-[#0F1623] px-4 py-3">
              <span className="text-xs text-[#4B6080]">{label}</span>
              <span className={`text-sm font-medium ${valueClass(value)}`}>{value}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
