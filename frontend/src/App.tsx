import { DashboardLayout } from './components/DashboardLayout'
import { OverviewPage } from './components/OverviewPage'
import { lazy, Suspense, useState } from 'react'
import type { PageId } from './types/dashboard'
import { LiveSpectrumPage } from './pages/LiveSpectrumPage'
import { SchedulerPage } from './pages/SchedulerPage'
import { ModelComparisonPage } from './pages/ModelComparisonPage'
import { EnergyEfficiencyPage } from './pages/EnergyEfficiencyPage'
import './App.css'

const SdrIntegrationPage = lazy(() => import('./pages/SdrIntegrationPage').then((module) => ({ default: module.SdrIntegrationPage })))

function App() {
  const [activePage, setActivePage] = useState<PageId>('overview')
  const [liveDemoRequest, setLiveDemoRequest] = useState(0)
  const [motionPaused, setMotionPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  const navigate = (page: PageId) => {
    setActivePage(page)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  const startLiveDemo = () => {
    navigate('spectrum')
    setLiveDemoRequest((request) => request + 1)
  }

  const pages = {
    overview: <OverviewPage onStartLiveDemo={startLiveDemo} />,
    spectrum: <LiveSpectrumPage demoRequest={liveDemoRequest} />,
    scheduler: <SchedulerPage />,
    comparison: <ModelComparisonPage />,
    energy: <EnergyEfficiencyPage />,
    sdr: <Suspense fallback={<div className="surface-panel p-6 text-sm text-[#c0bdb7]">Loading RF command center</div>}><SdrIntegrationPage motionPaused={motionPaused} /></Suspense>,
  }

  return (
    <DashboardLayout activePage={activePage} onNavigate={navigate} motionPaused={motionPaused} onToggleMotion={() => setMotionPaused((paused) => !paused)}>
      {pages[activePage]}
    </DashboardLayout>
  )
}

export default App
