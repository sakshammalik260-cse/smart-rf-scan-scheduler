import { runtimeConfig } from '../config/runtime'

export function SystemStatus() {
  const backend = runtimeConfig.useMockApi ? 'Mock Mode' : 'Backend Online'
  return (
    <div className="surface-card px-4 py-4">
      <p className="muted-label">System</p>
      <div className="mt-4 space-y-3 text-xs">
        <div className="flex items-center justify-between gap-3"><span className="text-[#89878a]">{backend}</span><span className="status-dot" /></div>
        <div className="flex items-center justify-between gap-3"><span className="text-[#89878a]">RF Model Loaded</span><span className="status-dot" /></div>
        <div className="border-t border-[#2d2e33] pt-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#c0bdb7]">Smart V3</p>
          <p className="mt-1 text-xs text-[#89878a]">Candidate 17</p>
        </div>
      </div>
    </div>
  )
}
