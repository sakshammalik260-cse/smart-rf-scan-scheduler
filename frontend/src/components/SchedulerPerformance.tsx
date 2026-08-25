import { modelResults } from '../data/mockData'
import { Panel } from './Panel'

const colors = ['#77777b', '#ad8f57', '#9b5960', '#d94a4a']

function PerformanceRow({ label, values, max, unit = '%' }: { label: string; values: number[]; max: number; unit?: string }) {
  return (
    <div className="grid gap-3 border-b border-[#29423f] py-4 last:border-b-0 sm:grid-cols-[150px_1fr] sm:items-center">
      <div><p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#74938d]">{label}</p><p className="mt-1 text-[10px] text-[#668681]">{unit === '%' ? 'higher is better' : 'lower is better'}</p></div>
      <div className="grid gap-3 sm:grid-cols-4">{values.map((value, index) => <div key={`${label}-${modelResults[index].shortName}`}><div className="mb-1 flex items-center justify-between gap-2"><span className="truncate text-[10px] text-[#9db8b2]">{modelResults[index].shortName}</span><span className="font-mono text-[10px] text-[#d5e9e4]">{value.toFixed(unit === '%' ? 2 : 3)}{unit}</span></div><div className="h-1.5 bg-[#132a2b]"><div className="h-full transition-all" style={{ width: `${Math.min((value / max) * 100, 100)}%`, backgroundColor: colors[index] }} /></div></div>)}</div>
    </div>
  )
}

export function SchedulerPerformance() {
  return <Panel><div className="flex flex-col gap-2 border-b border-[#29423f] px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-7"><div><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#67e8c5]">Final holdout comparison</p><h2 className="mt-2 font-display text-xl font-medium text-[#e7f4f1]">Scheduler Performance</h2></div><span className="font-mono text-[10px] text-[#668681]">4 strategies · fixed benchmark</span></div><div className="px-5 sm:px-7"><PerformanceRow label="Hit Rate" values={modelResults.map((result) => result.hitRate)} max={100} /><PerformanceRow label="Coverage" values={modelResults.map((result) => result.coverage)} max={100} /><PerformanceRow label="Interception Delay" values={modelResults.map((result) => result.delay)} max={1} unit=" s" /></div><div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-[#29423f] px-5 py-4 sm:px-7">{modelResults.map((result, index) => <span className="flex items-center gap-2 text-[10px] text-[#9db8b2]" key={result.name}><span className="h-2 w-2" style={{ backgroundColor: colors[index] }} />{result.shortName}</span>)}</div></Panel>
}