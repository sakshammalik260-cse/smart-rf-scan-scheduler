import { RadioTower } from 'lucide-react'
import { PageIcon } from './Icon'
import { SystemStatus } from './SystemStatus'
import type { PageId } from '../types/dashboard'

type SidebarProps = {
  activePage: PageId
  onNavigate: (page: PageId) => void
}

const navigation = [
  { label: 'Overview', page: 'overview' as const },
  { label: 'Live Spectrum', page: 'spectrum' as const },
  { label: 'Smart Scheduler', page: 'scheduler' as const },
  { label: 'Reference Benchmark', page: 'comparison' as const },
  { label: 'Energy Efficiency', page: 'energy' as const },
  { label: 'SDR Integration', page: 'sdr' as const },
]

export function Sidebar({ activePage, onNavigate }: SidebarProps) {
  return (
    <aside className="sidebar-3d flex w-full shrink-0 flex-col border-b border-[#202126] bg-[#0d0e12]/98 lg:min-h-screen lg:w-72 lg:border-b-0 lg:border-r">
      <div className="px-5 py-6 lg:px-6 lg:py-7">
        <div className="flex items-center gap-3">
          <span className="brand-cube grid h-10 w-10 place-items-center bg-[#d94a4a] text-[#fff]"><RadioTower size={20} /></span>
          <div>
            <p className="font-display text-base font-semibold text-[#e6e1da]">SMART V4</p>
            <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-[#89878a]">RF Intelligence Platform</p>
          </div>
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto px-3 pb-4 lg:block lg:px-4" aria-label="Primary navigation">
        {navigation.map((item, index) => {
          const active = item.page === activePage
          return (
            <button
              className={`nav-node group relative flex min-w-max items-center gap-3 px-4 py-3 text-left text-sm transition-colors lg:mb-1 lg:w-full ${active ? 'nav-node-active bg-[#17191d] text-[#e6e1da]' : 'text-[#89878a] hover:bg-[#15171b] hover:text-[#e6e1da]'}`}
              key={item.label}
              onClick={() => onNavigate(item.page)}
              aria-current={active ? 'page' : undefined}
              title={`Open ${item.label}`}
            >
              <span className={`absolute left-0 top-2 h-[calc(100%-16px)] w-0.5 transition-opacity ${active ? 'bg-[#d94a4a] opacity-100' : 'opacity-0'}`} />
              <PageIcon page={item.page} size={17} strokeWidth={1.8} className={active ? 'text-[#d94a4a]' : 'text-[#6e7078] group-hover:text-[#c0bdb7]'} />
              <span className="nav-number font-mono text-[10px] text-[#6e7078]">0{index + 1}</span>
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="mt-auto hidden px-6 pb-6 lg:block">
        <SystemStatus />
      </div>
    </aside>
  )
}
