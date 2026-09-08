import { ArrowLeft, Pause, Play, Radio } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { runtimeConfig } from '../config/runtime'
import type { PageId } from '../types/dashboard'

const pageCopy: Record<PageId, { title: string; subtitle: string }> = {
  overview: { title: 'Executive Overview', subtitle: 'Final SIH demonstration dashboard and verified holdout performance.' },
  spectrum: { title: 'Live Spectrum', subtitle: 'Real-time RF band selection, Smart V3 decisions, and scheduler comparison.' },
  scheduler: { title: 'Smart Scheduler', subtitle: 'How receiver history becomes RF probabilities and final V3 priorities.' },
  comparison: { title: 'Model Comparison', subtitle: 'Verified trade-offs across sequential, adaptive, RF V2, and Smart V3.' },
  energy: { title: 'Energy Efficiency', subtitle: 'Experimental resource-efficiency estimates for useful scan opportunities.' },
  sdr: { title: 'SDR Integration', subtitle: 'Receive-only RF input boundary for TSRD replay, Mock SDR, and future hardware.' },
}

const SignalScene = lazy(() => import('./SignalScene').then((module) => ({ default: module.SignalScene })))

export function TopHeader({ activePage, onNavigate, motionPaused, onToggleMotion }: {
  activePage: PageId; onNavigate: (page: PageId) => void; motionPaused: boolean; onToggleMotion: () => void
}) {
  const copy = pageCopy[activePage]
  const modeLabel = runtimeConfig.useMockApi ? 'MOCK API' : 'LIVE / REAL BACKEND'
  return (
    <header className={`top-header-3d ${activePage === 'sdr' ? 'header-compact' : 'header-spatial'} border-b border-[#202126] bg-[#0d0e12]/95 px-5 py-5 sm:px-8 lg:px-10 xl:px-12`}>
      <div className="header-tools">
        {activePage !== 'overview' && <button className="header-back" onClick={() => onNavigate('overview')}><ArrowLeft size={16} />Back to Overview</button>}
        <button className="motion-toggle" onClick={onToggleMotion} aria-label={motionPaused ? 'Resume animation' : 'Pause animation'} title={motionPaused ? 'Resume animation' : 'Pause animation'} aria-pressed={motionPaused}>
          {motionPaused ? <Play size={16} /> : <Pause size={16} />}
        </button>
      </div>
      <div className="header-copy flex flex-col gap-4">
        <div>
          <p className="section-kicker">Adaptive RF Spectrum Intelligence</p>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-[#e6e1da]">{copy.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-[#89878a]">{copy.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="top-chip surface-card flex items-center gap-2 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#c0bdb7]">
            <span className="status-dot" />
            {modeLabel}
          </div>
          <div className="top-chip surface-card flex items-center gap-2 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#89878a]">
            <Radio size={14} className="text-[#d94a4a]" />
            Random Forest + Smart V3 <span className="text-[#e6e1da]">Candidate 17</span>
          </div>
        </div>
      </div>
      {activePage !== 'sdr' && <div className="header-signal" role="img" aria-label="Animated 3D RF signal array">
        <Suspense fallback={null}><SignalScene activePage={activePage} paused={motionPaused} onNavigate={onNavigate} /></Suspense>
      </div>}
    </header>
  )
}
