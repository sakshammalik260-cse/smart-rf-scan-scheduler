import { Radio } from 'lucide-react'
import { runtimeConfig } from '../config/runtime'
import type { PageId } from '../types/dashboard'

const pageCopy: Record<PageId, { title: string; subtitle: string }> = {
  overview: { title: 'Executive Overview', subtitle: 'Final SIH demonstration dashboard and verified holdout performance.' },
  spectrum: { title: 'Live Spectrum', subtitle: 'Real-time RF band selection, Smart V3 decisions, and scheduler comparison.' },
  scheduler: { title: 'Smart Scheduler', subtitle: 'How receiver history becomes RF probabilities and final V3 priorities.' },
  comparison: { title: 'Model Comparison', subtitle: 'Verified trade-offs across sequential, adaptive, RF V2, and Smart V3.' },
  energy: { title: 'Energy Efficiency', subtitle: 'Experimental resource-efficiency estimates for useful scan opportunities.' },
}

export function TopHeader({ activePage }: { activePage: PageId }) {
  const copy = pageCopy[activePage]
  const modeLabel = runtimeConfig.useMockApi ? 'MOCK API' : 'LIVE / REAL BACKEND'
  return (
    <header className="border-b border-[#202126] bg-[#0d0e12]/95 px-5 py-5 sm:px-8 lg:px-10 xl:px-12">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="section-kicker">Adaptive RF Spectrum Intelligence</p>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-[#e6e1da]">{copy.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-[#89878a]">{copy.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="surface-card flex items-center gap-2 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#c0bdb7]">
            <span className="status-dot" />
            {modeLabel}
          </div>
          <div className="surface-card flex items-center gap-2 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#89878a]">
            <Radio size={14} className="text-[#d94a4a]" />
            Random Forest + Smart V3 <span className="text-[#e6e1da]">Candidate 17</span>
          </div>
        </div>
      </div>
    </header>
  )
}
