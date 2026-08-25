import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { TopHeader } from './TopHeader'
import type { PageId } from '../types/dashboard'
import { ScenarioControl } from './ScenarioControl'
import { WorkflowSteps } from './WorkflowSteps'

type DashboardLayoutProps = {
  children: ReactNode
  activePage: PageId
  onNavigate: (page: PageId) => void
}

export function DashboardLayout({ children, activePage, onNavigate }: DashboardLayoutProps) {
  return (
    <main className="app-shell scan-grid">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <Sidebar activePage={activePage} onNavigate={onNavigate} />
        <div className="min-w-0 flex-1">
          <TopHeader activePage={activePage} />
          <div className="mx-auto max-w-[1560px] px-5 py-7 sm:px-8 sm:py-9 lg:px-10 xl:px-12">
            <WorkflowSteps />
            <ScenarioControl />
            <div className="page-enter mt-7">
              {children}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
