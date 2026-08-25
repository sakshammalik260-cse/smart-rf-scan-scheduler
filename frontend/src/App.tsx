import { DashboardLayout } from './components/DashboardLayout'
import { OverviewPage } from './components/OverviewPage'
import { useState } from 'react'
import type { PageId } from './types/dashboard'
import { LiveSpectrumPage } from './pages/LiveSpectrumPage'
import { SchedulerPage } from './pages/SchedulerPage'
import { ModelComparisonPage } from './pages/ModelComparisonPage'
import { EnergyEfficiencyPage } from './pages/EnergyEfficiencyPage'
import './App.css'

function App() {
  const [activePage, setActivePage] = useState<PageId>('overview')
  const [liveDemoRequest, setLiveDemoRequest] = useState(0)

  const startLiveDemo = () => {
    setActivePage('spectrum')
    setLiveDemoRequest((request) => request + 1)
  }

  const pages = {
    overview: <OverviewPage onStartLiveDemo={startLiveDemo} />,
    spectrum: <LiveSpectrumPage demoRequest={liveDemoRequest} />,
    scheduler: <SchedulerPage />,
    comparison: <ModelComparisonPage />,
    energy: <EnergyEfficiencyPage />,
  }

  return (
    <DashboardLayout activePage={activePage} onNavigate={setActivePage}>
      {pages[activePage]}
    </DashboardLayout>
  )
}

export default App
