import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { TopHeader } from './TopHeader'
import type { PageId } from '../types/dashboard'
import { WorkflowSteps } from './WorkflowSteps'

type DashboardLayoutProps = {
  children: ReactNode
  activePage: PageId
  onNavigate: (page: PageId) => void
  motionPaused: boolean
  onToggleMotion: () => void
}

export function DashboardLayout({ children, activePage, onNavigate, motionPaused, onToggleMotion }: DashboardLayoutProps) {
  const immersive = activePage === 'sdr'
  return (
    <main className="app-shell scan-grid" data-motion={motionPaused ? 'paused' : 'running'}>
      <div className="ambient-orbit" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="flex min-h-screen flex-col lg:flex-row">
        <Sidebar activePage={activePage} onNavigate={onNavigate} />
        <div className="min-w-0 flex-1">
          <TopHeader activePage={activePage} onNavigate={onNavigate} motionPaused={motionPaused} onToggleMotion={onToggleMotion} />
          <div className={immersive ? 'mx-auto max-w-none px-3 py-4 sm:px-5 sm:py-5 lg:px-6 xl:px-7' : 'mx-auto max-w-[1560px] px-5 py-7 sm:px-8 sm:py-9 lg:px-10 xl:px-12'}>
            {!immersive && <WorkflowSteps />}
            <div key={activePage} className={immersive ? 'page-enter' : 'page-enter mt-7'}>
              {children}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
