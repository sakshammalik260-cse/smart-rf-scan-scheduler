import { ArrowRight, Radio, ShieldCheck, Upload } from 'lucide-react'
import { MetricCard } from './MetricCard'
import { baselineResults, HOLDOUT_LABEL, holdoutResults, modelResults } from '../data/mockData'

const metrics = [
  { label: 'Hit Rate', value: `${holdoutResults.hitRate}%`, detail: 'Final Smart V3 interception rate', accent: 'bg-[#d94a4a]' },
  { label: 'Emitter Coverage', value: `${holdoutResults.coverage}%`, detail: 'Highest verified coverage in benchmark', accent: 'bg-[#d94a4a]' },
  { label: 'Avg Delay', value: `${holdoutResults.delay} s`, detail: 'Lowest verified average delay', accent: 'bg-[#d8bd73]' },
  { label: 'Miss Rate', value: `${holdoutResults.missRate}%`, detail: 'Complement of holdout hit rate', accent: 'bg-[#6e7078]' },
  { label: 'Scan Entropy', value: holdoutResults.entropy.toString(), detail: 'Broad spectrum attention index', accent: 'bg-[#514044]' },
]

const whyCards = [
  ['RF activity prediction', 'Random Forest estimates where useful activity is likely before each scan.'],
  ['Intelligent exploration', 'V3 keeps attention broad so inactive-looking bands are not permanently ignored.'],
  ['Reduced repeated scanning', 'Recent visits and repetition penalties avoid over-focusing one region.'],
  ['Broad emitter coverage', 'The scheduler balances interception with coverage across the RF range.'],
]

interface OverviewPageProps {
  onStartLiveDemo: () => void
}

export function OverviewPage({ onStartLiveDemo }: OverviewPageProps) {
  const maxHit = Math.max(...modelResults.map((result) => result.hitRate))
  return (
    <div className="space-y-8">
      <section className="overview-hero surface-panel overflow-hidden">
        <div className="grid gap-8 p-7 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-9">
          <div>
            <p className="section-kicker">Smart Scan Scheduler</p>
            <h2 className="mt-4 max-w-4xl font-display text-4xl font-semibold tracking-tight text-[#e6e1da] lg:text-5xl">Adaptive RF Spectrum Intelligence</h2>
            <p className="mt-5 max-w-3xl text-base leading-7 text-[#c0bdb7]">An ML-assisted receiver scheduling system that predicts high-value frequency bands while maintaining broad spectrum exploration.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <button className="primary-cta" onClick={onStartLiveDemo}><Radio size={16} /> Start Live Demo</button>
              <button className="secondary-cta" onClick={onStartLiveDemo}><Upload size={16} /> Upload TSRD Scenario</button>
            </div>
          </div>
          <div className="overview-radar-panel metric-soft p-5">
            <p className="section-kicker">Final Holdout Performance</p>
            <p className="mt-2 text-xs text-[#89878a]">5 unseen TSRD Stare scenarios</p>
            <div className="overview-orbit-visual" aria-hidden="true">
              <span />
              <span />
              <span />
              <i />
            </div>
            <div className="mt-6 space-y-4">
              {metrics.slice(0, 3).map((metric) => <div key={metric.label} className="flex items-end justify-between gap-4 border-b border-[#2d2e33] pb-3"><span className="text-sm text-[#89878a]">{metric.label}</span><span className="font-display text-2xl text-[#e6e1da]">{metric.value}</span></div>)}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-label="Final holdout metrics">
        {metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}
      </section>

      <section className="surface-panel p-5 sm:p-7">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="section-kicker">Verified benchmark</p>
            <h3 className="mt-2 font-display text-xl font-semibold text-[#e6e1da]">Strategy comparison</h3>
            <p className="mt-1 text-sm text-[#89878a]">{HOLDOUT_LABEL}</p>
          </div>
          <ShieldCheck className="text-[#d94a4a]" size={22} />
        </div>
        <div className="grid gap-4 lg:grid-cols-4">
          {modelResults.map((result) => {
            const smart = result.shortName === 'Smart V3'
            return (
              <article key={result.shortName} className={`surface-card p-4 ${smart ? 'border-[#d94a4a] bg-[#2a1b1f]' : ''}`}>
                <div className="flex items-center justify-between gap-3">
                  <h4 className="font-display text-lg text-[#e6e1da]">{result.shortName}</h4>
                  {smart && <span className="rounded-full bg-[#d94a4a] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-white">Smart V3</span>}
                </div>
                <div className="mt-5 h-2 bg-[#202126]"><div className="h-full bg-[#d94a4a]" style={{ width: `${(result.hitRate / maxHit) * 100}%` }} /></div>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div><p className="font-mono text-sm text-[#e6e1da]">{result.hitRate.toFixed(2)}%</p><p className="text-[10px] text-[#89878a]">hit</p></div>
                  <div><p className="font-mono text-sm text-[#e6e1da]">{result.coverage.toFixed(2)}%</p><p className="text-[10px] text-[#89878a]">coverage</p></div>
                  <div><p className="font-mono text-sm text-[#e6e1da]">{result.delay.toFixed(3)}s</p><p className="text-[10px] text-[#89878a]">delay</p></div>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section className="surface-panel p-5 sm:p-7">
        <p className="section-kicker">Why Smart V3?</p>
        <div className="mt-5 grid gap-3 md:grid-cols-[repeat(4,minmax(0,1fr))]">
          {whyCards.map(([title, body], index) => (
            <article className="surface-card p-4" key={title}>
              <div className="mb-4 flex items-center justify-between"><span className="font-mono text-[10px] text-[#d94a4a]">0{index + 1}</span>{index < whyCards.length - 1 && <ArrowRight size={14} className="text-[#514044]" />}</div>
              <h4 className="font-display text-base text-[#e6e1da]">{title}</h4>
              <p className="mt-2 text-xs leading-relaxed text-[#89878a]">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="surface-card p-4 text-xs text-[#89878a]">
        Sequential baseline: {baselineResults.hitRate}% hit rate. Smart V3 improves hit rate while preserving broad spectral coverage and lower delay in the final benchmark.
      </section>
    </div>
  )
}
