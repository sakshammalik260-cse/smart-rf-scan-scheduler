import type { LucideProps } from 'lucide-react'
import { Activity, BarChart3, Cpu, Gauge, LayoutDashboard, Radio, RadioTower, Zap } from 'lucide-react'
import type { PageId } from '../types/dashboard'

const icons = { overview: LayoutDashboard, spectrum: Radio, scheduler: Cpu, comparison: BarChart3, energy: Zap, sdr: RadioTower }

export function PageIcon({ page, ...props }: { page: PageId } & LucideProps) {
  const Component = icons[page]
  return <Component {...props} />
}

export { Activity, Gauge }