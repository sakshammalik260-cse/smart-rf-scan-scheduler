import { useMemo, useState } from 'react'
import { Calculator, Info, Leaf, Zap } from 'lucide-react'
import { HOLDOUT_LABEL, modelResults } from '../data/mockData'
import { Panel } from '../components/Panel'
import { SectionHeader } from '../components/SectionHeader'
import type { ModelResult } from '../types/dashboard'
import type { SimulationDecision, SimulationState } from '../types/api'

const RESOURCE_COMPARISON_STORAGE_KEY = 'smart-v3-live-resource-comparison'

type EfficiencyModel = ModelResult & {
  usefulRatio: number
  unproductiveRatio: number
  usefulPer100: number
  unproductivePer100: number
  effortPerHit: number
  coveragePer100: number
  timeEfficiencyIndex: number
}

type StoredComparison = {
  updatedAt: string
  scenario: { id: string; filename: string } | null
  sequential: SimulationState | null
  smart: SimulationState | null
}

function deriveEfficiency(result: ModelResult): EfficiencyModel {
  const usefulRatio = result.hitRate / 100
  return {
    ...result,
    usefulRatio,
    unproductiveRatio: 1 - usefulRatio,
    usefulPer100: result.hitRate,
    unproductivePer100: 100 - result.hitRate,
    effortPerHit: usefulRatio > 0 ? 1 / usefulRatio : Number.POSITIVE_INFINITY,
    coveragePer100: result.coverage,
    timeEfficiencyIndex: result.delay > 0 ? 1 / result.delay : Number.POSITIVE_INFINITY,
  }
}

function percent(value: number): string {
  return `${value.toFixed(2)}%`
}

function scans(value: number): string {
  return value.toFixed(2)
}

function seconds(value: number): string {
  return `${value.toFixed(3)} s`
}

function units(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : 'Not available'
}

function signed(value: number, suffix = ''): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}${suffix}`
}

function formula(label: string, text: string) {
  return (
    <span title={text} className="inline-flex items-center gap-1">
      {label}
      <Info size={12} className="text-[#89878a]" />
    </span>
  )
}

function historyFor(state: SimulationState | null): SimulationDecision[] {
  if (state?.scanHistory?.length) return state.scanHistory
  return state?.recentDecisions ?? []
}

function liveResourceStats(state: SimulationState | null) {
  const history = historyFor(state)
  const totalScans = state?.decisionNumber || history.length
  const outcomes = state?.hitMissHistory?.length ? state.hitMissHistory : history.map((decision) => decision.outcome)
  const hits = outcomes.filter((outcome) => outcome === 'HIT').length
  const misses = outcomes.filter((outcome) => outcome === 'MISS').length
  const uniqueBands = Object.values(state?.bandVisitCounts ?? {}).filter((count) => count > 0).length
  const activeSensingTime = history.length
    ? history.reduce((total, decision) => total + decision.dwellDurationSeconds, 0)
    : state?.elapsedSeconds ?? 0
  return {
    totalScans,
    hits,
    misses,
    usefulPct: totalScans ? (hits / totalScans) * 100 : 0,
    unproductivePct: totalScans ? (misses / totalScans) * 100 : 0,
    effortPerHit: hits ? totalScans / hits : null,
    uniqueBands,
    coverage: (uniqueBands / 36) * 100,
    activeSensingTime,
  }
}

function readStoredComparison(): StoredComparison | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(RESOURCE_COMPARISON_STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredComparison
  } catch {
    return null
  }
}

function MetricCard({ label, value, detail, accent = false }: { label: string; value: string; detail?: string; accent?: boolean }) {
  return (
    <div className={`surface-card p-4 ${accent ? 'border-[#d94a4a] bg-[#2a1b1f]' : ''}`}>
      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#89878a]">{label}</p>
      <p className="mt-2 font-display text-2xl text-[#e6e1da]">{value}</p>
      {detail && <p className="mt-1 text-xs text-[#89878a]">{detail}</p>}
    </div>
  )
}

function RatioBar({ model }: { model: EfficiencyModel }) {
  return (
    <div className="surface-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm text-[#e6e1da]">{model.shortName === 'Sequential' ? 'Sequential scanning baseline' : model.shortName}</p>
          <p className="text-[11px] text-[#89878a]">{model.name}</p>
        </div>
        <span className="font-mono text-xs text-[#d94a4a]">{scans(model.usefulPer100)} useful / 100</span>
      </div>
      <div className="flex h-8 overflow-hidden bg-[#202126]" title="Useful Scan Ratio = Hit Rate; Unproductive Scan Ratio = 1 - Hit Rate">
        <div className={model.shortName === 'Smart V3' ? 'bg-[#d94a4a]' : 'bg-[#6e7078]'} style={{ width: `${model.usefulPer100}%` }} />
        <div className="flex flex-1 items-center justify-end px-3 font-mono text-[10px] text-[#89878a]">{scans(model.unproductivePer100)} unproductive</div>
      </div>
    </div>
  )
}

function ScanOpportunityGrid({ title, useful, smart = false }: { title: string; useful: number; smart?: boolean }) {
  const usefulCells = Math.round(useful)
  return (
    <div className="surface-card p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm text-[#e6e1da]">{title}</p>
          <p className="text-xs text-[#89878a]">Normalized comparison assumes equal scan opportunity cost.</p>
        </div>
        <span className="font-mono text-xs text-[#d94a4a]">{scans(useful)} useful, {scans(100 - useful)} unproductive</span>
      </div>
      <div className="grid grid-cols-10 gap-1" aria-label={`${title} 100 scan opportunity visualization`}>
        {Array.from({ length: 100 }, (_, index) => (
          <span key={index} className={`aspect-square ${index < usefulCells ? (smart ? 'bg-[#d94a4a]' : 'bg-[#6e7078]') : 'bg-[#202126]'}`} />
        ))}
      </div>
    </div>
  )
}

function ProjectionRow({ model, scansCount, totalEnergyJ, totalEnergyWh }: { model: EfficiencyModel; scansCount: number; totalEnergyJ: number; totalEnergyWh: number }) {
  const projectedHits = scansCount * model.usefulRatio
  const joulesPerHit = projectedHits > 0 ? totalEnergyJ / projectedHits : null
  const whPerHit = projectedHits > 0 ? totalEnergyWh / projectedHits : null
  return (
    <tr>
      <td className="px-4 py-3 text-[#e6e1da]">{model.shortName === 'Sequential' ? 'Sequential scanning baseline' : model.shortName}</td>
      <td className="px-4 py-3 font-mono text-[#c0bdb7]">{projectedHits.toFixed(2)}</td>
      <td className="px-4 py-3 font-mono text-[#c0bdb7]">{joulesPerHit === null ? 'Not available' : `${joulesPerHit.toFixed(2)} J / hit`}</td>
      <td className="px-4 py-3 font-mono text-[#c0bdb7]">{whPerHit === null ? 'Not available' : `${whPerHit.toFixed(4)} Wh / hit`}</td>
    </tr>
  )
}

export function EnergyEfficiencyPage() {
  const [power, setPower] = useState('100')
  const [scanCount, setScanCount] = useState('1000')
  const [dwellDuration, setDwellDuration] = useState('0.05')
  const [storedComparison] = useState<StoredComparison | null>(() => readStoredComparison())

  const models = useMemo(() => modelResults.map(deriveEfficiency), [])
  const sequential = models.find((model) => model.shortName === 'Sequential') ?? models[0]
  const smart = models.find((model) => model.shortName === 'Smart V3') ?? models[models.length - 1]
  const maxEffort = Math.max(...models.map((model) => model.effortPerHit))

  const hitRateDiff = smart.hitRate - sequential.hitRate
  const coverageDiff = smart.coverage - sequential.coverage
  const delayReduction = sequential.delay - smart.delay
  const delayReductionRelative = (delayReduction / sequential.delay) * 100
  const unproductiveReduction = sequential.unproductivePer100 - smart.unproductivePer100
  const unproductiveReductionRelative = (unproductiveReduction / sequential.unproductivePer100) * 100
  const effortReduction = sequential.effortPerHit - smart.effortPerHit
  const effortReductionRelative = (effortReduction / sequential.effortPerHit) * 100

  const assumedPower = Math.max(0, Number(power) || 0)
  const scansCount = Math.max(0, Number(scanCount) || 0)
  const dwellSeconds = Math.max(0, Number(dwellDuration) || 0)
  const activeSensingTime = scansCount * dwellSeconds
  const projectedEnergyJ = assumedPower * activeSensingTime
  const projectedEnergyWh = projectedEnergyJ / 3600

  const liveSequential = liveResourceStats(storedComparison?.sequential ?? null)
  const liveSmart = liveResourceStats(storedComparison?.smart ?? null)
  const hasLiveComparison = liveSequential.totalScans > 0 || liveSmart.totalScans > 0

  return (
    <div className="space-y-8">
      <SectionHeader eyebrow="RESOURCE-EFFICIENCY ANALYSIS" title="Clean & Green Impact" detail="How intelligent scan scheduling can reduce wasted sensing effort and improve useful RF intelligence per scan." />

      <div className="surface-card flex items-start gap-3 border-[#675c3b] bg-[#251f12] p-4 text-sm leading-relaxed text-[#d8c99c]">
        <Info size={18} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em]">Resource-efficiency analysis</p>
          <p className="mt-1">Operational receiver power-consumption data is not available. Energy values shown here are normalized or projected estimates, not measured DRDO hardware electricity consumption.</p>
        </div>
      </div>

      <Panel>
        <div className="border-b border-[#29423f] px-5 py-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#67e8c5]">FINAL HOLDOUT BENCHMARK - 5 unseen synthetic TSRD Stare scenarios</p>
          <p className="mt-1 text-xs text-[#89878a]">{HOLDOUT_LABEL}. These are recorded benchmark metrics, not hardware energy measurements.</p>
        </div>
        <div className="overflow-x-auto p-5">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="border-b border-[#243c3a] font-mono text-[9px] uppercase tracking-[0.14em] text-[#668681]">
              <tr>{['Scheduler', 'Hit rate', 'Coverage', 'Avg delay', 'Entropy', formula('Useful scan ratio', 'Useful Scan Ratio = Hit Rate'), formula('Unproductive ratio', 'Unproductive Scan Ratio = 1 - Hit Rate'), formula('Effort / HIT', 'Normalized Scan Effort per HIT = 1 / Hit Rate'), formula('Time efficiency', 'Time Efficiency Index = 1 / Average Delay')].map((header, index) => <th key={index} className="px-4 py-3 font-normal">{header}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-[#243c3a]">
              {models.map((model) => (
                <tr key={model.shortName} className={model.shortName === 'Smart V3' ? 'bg-[#2a1b1f]' : ''}>
                  <td className="px-4 py-3 text-[#e6e1da]">{model.shortName === 'Sequential' ? 'Sequential scanning baseline' : model.shortName}</td>
                  <td className="px-4 py-3 font-mono text-[#c0bdb7]">{percent(model.hitRate)}</td>
                  <td className="px-4 py-3 font-mono text-[#c0bdb7]">{percent(model.coverage)}</td>
                  <td className="px-4 py-3 font-mono text-[#c0bdb7]">{seconds(model.delay)}</td>
                  <td className="px-4 py-3 font-mono text-[#c0bdb7]">{model.entropy.toFixed(3)}</td>
                  <td className="px-4 py-3 font-mono text-[#c0bdb7]">{model.usefulRatio.toFixed(4)}</td>
                  <td className="px-4 py-3 font-mono text-[#c0bdb7]">{model.unproductiveRatio.toFixed(4)}</td>
                  <td className="px-4 py-3 font-mono text-[#c0bdb7]">{model.effortPerHit.toFixed(2)}</td>
                  <td className="px-4 py-3 font-mono text-[#c0bdb7]">{model.timeEfficiencyIndex.toFixed(2)} / s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6" aria-label="Smart V3 impact cards">
        <MetricCard label="Useful scans / 100" value={scans(smart.usefulPer100)} detail="Useful Scan Ratio x 100" accent />
        <MetricCard label="Unproductive scans / 100" value={scans(smart.unproductivePer100)} detail="1 - Hit Rate" />
        <MetricCard label="Emitter coverage" value={percent(smart.coverage)} detail="Recorded holdout benchmark" accent />
        <MetricCard label="Avg interception delay" value={seconds(smart.delay)} detail="Recorded holdout benchmark" />
        <MetricCard label="Scan entropy" value={smart.entropy.toFixed(3)} detail="Broad scan distribution" />
        <MetricCard label="Scan effort / HIT" value={`~${smart.effortPerHit.toFixed(2)}`} detail="Normalized units per HIT" accent />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel className="p-5 sm:p-7">
          <p className="section-kicker">Derived resource-efficiency metrics</p>
          <h3 className="mt-2 font-display text-xl text-[#e6e1da]">Useful vs unproductive scan effort</h3>
          <p className="mt-2 text-xs text-[#89878a]">All derived values use normalized scan opportunity units. No electrical energy measurement is implied.</p>
          <div className="mt-6 space-y-4">{models.map((model) => <RatioBar key={model.shortName} model={model} />)}</div>
        </Panel>

        <Panel className="p-5 sm:p-7">
          <p className="section-kicker">Relative to the Sequential scanning baseline</p>
          <div className="mt-5 space-y-4">
            <MetricCard label="Hit-rate difference" value={signed(hitRateDiff, ' pp')} detail="Smart V3 hit rate - Sequential hit rate" accent />
            <MetricCard label="Coverage difference" value={signed(coverageDiff, ' pp')} detail="Smart V3 coverage - Sequential coverage" />
            <MetricCard label="Delay reduction" value={`${delayReduction.toFixed(3)} s`} detail={`${delayReductionRelative.toFixed(2)}% relative reduction`} accent />
            <MetricCard label="Unproductive-scan reduction" value={`${unproductiveReduction.toFixed(2)} pp`} detail={`${unproductiveReductionRelative.toFixed(2)}% fewer unproductive scan opportunities`} />
            <MetricCard label="Effort-per-HIT reduction" value={`${effortReduction.toFixed(2)} units`} detail={`${effortReductionRelative.toFixed(2)}% lower normalized effort per HIT`} accent />
          </div>
        </Panel>
      </div>

      <Panel>
        <div className="border-b border-[#29423f] px-5 py-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#67e8c5]">100 scan opportunities</p>
          <p className="mt-1 text-xs text-[#89878a]">Useful cells represent successful interception opportunities; dark cells represent unproductive scan opportunities.</p>
        </div>
        <div className="grid gap-5 p-5 xl:grid-cols-2">
          <ScanOpportunityGrid title="Sequential scanning baseline" useful={sequential.usefulPer100} />
          <ScanOpportunityGrid title="Smart V3 Candidate 17" useful={smart.usefulPer100} smart />
        </div>
      </Panel>

      <Panel>
        <div className="border-b border-[#29423f] px-5 py-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#67e8c5]">NORMALIZED SENSING ENERGY</p>
          <p className="mt-1 text-xs text-[#89878a]">Assumption: 1 scan opportunity = 1 normalized energy unit. This is a resource-efficiency proxy, not actual electrical energy consumption.</p>
        </div>
        <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-3">
            {models.map((model) => (
              <div key={model.shortName} className="grid gap-3 border border-[#2d2e33] bg-[#111317] p-3 md:grid-cols-[180px_1fr_80px] md:items-center">
                <span className="text-xs text-[#e6e1da]">{model.shortName === 'Sequential' ? 'Sequential baseline' : model.shortName}</span>
                <div className="h-2 bg-[#202126]" title="Normalized energy per successful interception = Total normalized scan energy / successful interceptions">
                  <div className="h-full bg-[#d94a4a]" style={{ width: `${Math.max(3, (model.effortPerHit / maxEffort) * 100)}%` }} />
                </div>
                <span className="font-mono text-xs text-[#c0bdb7]">{model.effortPerHit.toFixed(2)} units</span>
              </div>
            ))}
          </div>
          <div className="surface-card p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#d94a4a]">Formula</p>
            <p className="mt-3 text-sm leading-relaxed text-[#c0bdb7]">Normalized energy per successful interception = total normalized scan energy / successful interceptions.</p>
            <p className="mt-3 text-xs text-[#89878a]">Because each scan opportunity is assigned one normalized unit, this equals normalized scan-effort units per HIT.</p>
          </div>
        </div>
      </Panel>

      <Panel>
        <div className="border-b border-[#29423f] px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <Calculator size={18} className="text-[#d94a4a]" />
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#d94a4a]">USER-ASSUMED HARDWARE PROJECTION</p>
              <p className="mt-1 text-xs text-[#89878a]">This calculator does not represent measured DRDO receiver power.</p>
            </div>
          </div>
        </div>
        <div className="grid gap-5 p-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-4">
            <label className="block muted-label">Receiver active power (W)<input value={power} onChange={(event) => setPower(event.target.value)} min="0" type="number" className="mt-2 block w-full border border-[#514044] bg-[#111317] px-3 py-3 text-sm normal-case tracking-normal text-[#e6e1da] outline-none focus:border-[#d94a4a]" /></label>
            <label className="block muted-label">Number of scans<input value={scanCount} onChange={(event) => setScanCount(event.target.value)} min="0" type="number" className="mt-2 block w-full border border-[#514044] bg-[#111317] px-3 py-3 text-sm normal-case tracking-normal text-[#e6e1da] outline-none focus:border-[#d94a4a]" /></label>
            <label className="block muted-label">Dwell duration per scan (seconds)<input value={dwellDuration} onChange={(event) => setDwellDuration(event.target.value)} min="0" step="0.01" type="number" className="mt-2 block w-full border border-[#514044] bg-[#111317] px-3 py-3 text-sm normal-case tracking-normal text-[#e6e1da] outline-none focus:border-[#d94a4a]" /></label>
          </div>
          <div>
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard label="Active sensing time" value={`${activeSensingTime.toFixed(2)} s`} detail="scans x dwell duration" />
              <MetricCard label="Projected energy" value={`${projectedEnergyJ.toFixed(2)} J`} detail="Power x active sensing time" accent />
              <MetricCard label="Projected energy" value={`${projectedEnergyWh.toFixed(4)} Wh`} detail="J / 3600" />
            </div>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="border-b border-[#243c3a] font-mono text-[9px] uppercase tracking-[0.14em] text-[#668681]"><tr><th className="px-4 py-3 font-normal">Scheduler</th><th className="px-4 py-3 font-normal">Projected useful interceptions</th><th className="px-4 py-3 font-normal">Projected J / useful interception</th><th className="px-4 py-3 font-normal">Projected Wh / useful interception</th></tr></thead>
                <tbody className="divide-y divide-[#243c3a]">{models.map((model) => <ProjectionRow key={model.shortName} model={model} scansCount={scansCount} totalEnergyJ={projectedEnergyJ} totalEnergyWh={projectedEnergyWh} />)}</tbody>
              </table>
            </div>
          </div>
        </div>
      </Panel>

      <Panel>
        <div className="border-b border-[#29423f] px-5 py-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#67e8c5]">CURRENT SCENARIO RESOURCE EFFICIENCY</p>
          <p className="mt-1 text-xs text-[#89878a]">Calculated only from the live Sequential vs Smart V3 comparison session.</p>
        </div>
        {hasLiveComparison ? <div className="overflow-x-auto p-5">
          <table className="w-full min-w-[860px] text-left text-xs">
            <thead className="border-b border-[#243c3a] font-mono text-[9px] uppercase tracking-[0.14em] text-[#668681]"><tr>{['Metric', 'Sequential', 'Smart V3'].map((header) => <th key={header} className="px-4 py-3 font-normal">{header}</th>)}</tr></thead>
            <tbody className="divide-y divide-[#243c3a]">
              {[
                ['Total scans', liveSequential.totalScans.toString(), liveSmart.totalScans.toString()],
                ['HITs', liveSequential.hits.toString(), liveSmart.hits.toString()],
                ['MISSes', liveSequential.misses.toString(), liveSmart.misses.toString()],
                ['Useful scan %', percent(liveSequential.usefulPct), percent(liveSmart.usefulPct)],
                ['Unproductive scan %', percent(liveSequential.unproductivePct), percent(liveSmart.unproductivePct)],
                ['Normalized scan effort per HIT', liveSequential.effortPerHit === null ? 'Not available' : units(liveSequential.effortPerHit), liveSmart.effortPerHit === null ? 'Not available' : units(liveSmart.effortPerHit)],
                ['Unique bands visited', liveSequential.uniqueBands.toString(), liveSmart.uniqueBands.toString()],
                ['Spectrum coverage', percent(liveSequential.coverage), percent(liveSmart.coverage)],
                ['Active sensing time', `${liveSequential.activeSensingTime.toFixed(3)} s`, `${liveSmart.activeSensingTime.toFixed(3)} s`],
              ].map(([metric, sequentialValue, smartValue]) => <tr key={metric}><td className="px-4 py-3 text-[#e6e1da]">{metric}</td><td className="px-4 py-3 font-mono text-[#c0bdb7]">{sequentialValue}</td><td className="px-4 py-3 font-mono text-[#c0bdb7]">{smartValue}</td></tr>)}
            </tbody>
          </table>
          <p className="mt-4 text-xs text-[#89878a]">Snapshot: {storedComparison?.scenario?.filename ?? 'uploaded scenario'} at {storedComparison ? new Date(storedComparison.updatedAt).toLocaleString() : '-'}</p>
        </div> : <div className="p-5 text-sm text-[#89878a]">Run Sequential vs Smart V3 comparison to generate live resource-efficiency metrics.</div>}
      </Panel>

      <Panel className="p-5 sm:p-7">
        <div className="flex items-center gap-3">
          <Leaf size={20} className="text-[#d94a4a]" />
          <div>
            <p className="section-kicker">Why this supports Clean & Green Technology</p>
            <h3 className="mt-1 font-display text-xl text-[#e6e1da]">More useful RF intelligence per sensing opportunity</h3>
          </div>
        </div>
        <p className="mt-5 max-w-4xl text-sm leading-7 text-[#c0bdb7]">Smart scheduling can reduce unnecessary receiver dwell on low-value frequency bands and increase useful interceptions per sensing opportunity. The practical engineering value is better resource utilization: fewer unproductive sensing operations, more useful RF intelligence per scan, and lower normalized sensing effort per successful interception.</p>
        <div className="mt-5 grid gap-3 md:grid-cols-5">
          {['reduced unnecessary sensing operations', 'better utilization of receiver resources', 'more useful RF intelligence per scan', 'lower computational/sensing effort per successful interception', 'potential reduction in energy demand when deployed on real hardware'].map((item) => <div key={item} className="surface-card p-3 text-xs leading-relaxed text-[#c0bdb7]"><Zap size={14} className="mb-2 text-[#d94a4a]" />{item}</div>)}
        </div>
        <div className="mt-5 border border-[#675c3b] bg-[#251f12] p-4 text-xs leading-relaxed text-[#d8c99c]">Actual electrical energy savings require hardware power measurements and real receiver deployment validation.</div>
      </Panel>
    </div>
  )
}
