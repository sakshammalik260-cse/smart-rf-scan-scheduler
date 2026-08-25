import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ArrowRight, BarChart3, CheckCircle2, Gauge, Pause, Play, RotateCcw, Upload } from 'lucide-react'
import { runtimeConfig } from '../config/runtime'
import { api } from '../services/api'
import type { SimulationDecision, SimulationState, UploadedTsrdScenario } from '../types/api'
import { Panel } from '../components/Panel'
import { SectionHeader } from '../components/SectionHeader'

const SPEEDS = [0.5, 1, 2, 5]
const FLOW_STAGES = ['Receiver History', 'Random Forest', 'RF Probability', 'V3 Score', 'Selected Band', 'HIT / MISS']
const RESOURCE_COMPARISON_STORAGE_KEY = 'smart-v3-live-resource-comparison'
const EMPTY_DECISIONS: SimulationDecision[] = []
const EMPTY_SIMULATION: SimulationState = {
  status: 'idle',
  scenarioId: null,
  scheduler: 'Smart V3',
  elapsedSeconds: 0,
  progressPercent: 0,
  decisionNumber: 0,
  currentBand: null,
  scanHistory: [],
  recentDecisions: [],
  bandVisitCounts: {},
  lastVisitTimesSeconds: {},
}

type ComparisonState = {
  sequential: SimulationState | null
  smart: SimulationState | null
  running: boolean
}

type Feedback = {
  kind: 'info' | 'success' | 'error'
  message: string
}

interface LiveSpectrumPageProps {
  demoRequest?: number
}

function formatSeconds(value: number | undefined | null): string {
  return value === undefined || value === null ? '-' : `${value.toFixed(3)}s`
}

function formatMHzRange(startMHz: number | undefined, endMHz: number | undefined): string {
  if (startMHz === undefined || endMHz === undefined) return '-'
  return `${(startMHz / 1000).toFixed(2)}-${(endMHz / 1000).toFixed(2)} GHz`
}

function statusTone(status: SimulationState['status']): string {
  if (status === 'running') return 'text-[#67e8c5]'
  if (status === 'completed' || status === 'complete') return 'text-[#d8bd73]'
  if (status === 'error') return 'text-[#e79a9a]'
  return 'text-[#9db8b2]'
}

function percent(value: number | undefined): string {
  return `${Math.round((value ?? 0) * 100)}%`
}

function liveStats(state: SimulationState | null) {
  const outcomes = state?.hitMissHistory ?? []
  const hits = outcomes.filter((outcome) => outcome === 'HIT').length
  const misses = outcomes.filter((outcome) => outcome === 'MISS').length
  const decisions = state?.decisionNumber ?? 0
  const visited = Object.values(state?.bandVisitCounts ?? {}).filter((count) => count > 0).length
  return {
    decisions,
    hits,
    misses,
    hitRate: decisions ? hits / decisions : 0,
    missRate: decisions ? misses / decisions : 0,
    uniqueBands: visited,
    coverage: visited / 36,
    currentBand: state?.currentBand ?? null,
    time: state?.elapsedSeconds ?? 0,
  }
}

function deltaText(value: number, suffix = 'pp'): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)} ${suffix}`
}

function valueOrUnavailable(value: number | null | undefined, formatter: (numberValue: number) => string): string {
  return value === null || value === undefined || !Number.isFinite(value) ? 'Not available' : formatter(value)
}

function sessionHistory(state: SimulationState | null): SimulationDecision[] {
  if (state?.scanHistory?.length) return state.scanHistory
  return state?.recentDecisions ?? EMPTY_DECISIONS
}

function averageTimeBetweenHits(history: SimulationDecision[]): number | null {
  const hitTimes = history.filter((decision) => decision.outcome === 'HIT').map((decision) => decision.simulationTimeSeconds).sort((a, b) => a - b)
  if (hitTimes.length < 2) return null
  const gaps = hitTimes.slice(1).map((time, index) => time - hitTimes[index])
  return gaps.reduce((total, gap) => total + gap, 0) / gaps.length
}

function maxDecisionValue(history: SimulationDecision[], key: 'rfProbability' | 'v3Score'): number | null {
  if (!history.length) return null
  return Math.max(...history.map((decision) => decision[key]))
}

function topVisitedBands(state: SimulationState | null, limit = 5): Array<{ bandId: number; count: number }> {
  return Object.entries(state?.bandVisitCounts ?? {})
    .map(([bandId, count]) => ({ bandId: Number(bandId), count }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count || left.bandId - right.bandId)
    .slice(0, limit)
}

function topHitBands(history: SimulationDecision[], limit = 5): Array<{ bandId: number; count: number }> {
  const counts = new Map<number, number>()
  history.forEach((decision) => {
    if (decision.outcome === 'HIT') counts.set(decision.bandId, (counts.get(decision.bandId) ?? 0) + 1)
  })
  return Array.from(counts.entries())
    .map(([bandId, count]) => ({ bandId, count }))
    .sort((left, right) => right.count - left.count || left.bandId - right.bandId)
    .slice(0, limit)
}

function cumulativeHits(history: SimulationDecision[]): Array<{ decisionNumber: number; hits: number }> {
  let hits = 0
  return history
    .slice()
    .sort((left, right) => left.decisionNumber - right.decisionNumber)
    .map((decision, index) => {
      if (decision.outcome === 'HIT') hits += 1
      return { decisionNumber: decision.decisionNumber || index + 1, hits }
    })
}

function metricDelta(smartValue: number, sequentialValue: number, suffix = ''): string {
  const difference = smartValue - sequentialValue
  const sign = difference > 0 ? '+' : ''
  return `${sign}${difference.toFixed(1)}${suffix}`
}

function signedInteger(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value}`
}

function normalizeDemoError(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('backend') && (lower.includes('offline') || lower.includes('unavailable') || lower.includes('unreachable'))) return 'Backend unavailable. Start the FastAPI service.'
  if (lower.includes('failed to fetch') || lower.includes('network')) return 'Backend unavailable. Start the FastAPI service.'
  if (lower.includes('frozen') && lower.includes('model')) return 'Frozen Smart V3 model is not loaded.'
  if (lower.includes('model is not loaded')) return 'Frozen Smart V3 model is not loaded.'
  return message
}

export function LiveSpectrumPage({ demoRequest = 0 }: LiveSpectrumPageProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadButtonRef = useRef<HTMLButtonElement>(null)
  const resultsRef = useRef<HTMLElement>(null)
  const steppingRef = useRef(false)
  const [scenario, setScenario] = useState<UploadedTsrdScenario | null>(null)
  const [simulation, setSimulation] = useState<SimulationState>(EMPTY_SIMULATION)
  const [live, setLive] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [uploading, setUploading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [pausing, setPausing] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [uploadHighlight, setUploadHighlight] = useState(false)
  const [flowStage, setFlowStage] = useState(0)
  const [updateFlash, setUpdateFlash] = useState(false)
  const [comparison, setComparison] = useState<ComparisonState>({ sequential: null, smart: null, running: false })
  const comparisonSteppingRef = useRef(false)

  const recentDecisions = simulation.recentDecisions ?? EMPTY_DECISIONS
  const selectedBand = simulation.selectedBand
  const selectedBandId = simulation.currentBand
  const visits = simulation.bandVisitCounts ?? {}
  const lastVisitTimes = simulation.lastVisitTimesSeconds ?? {}
  const latestRf = simulation.latestRfProbabilities ?? []
  const latestScores = simulation.latestV3Scores ?? []
  const topCandidates = simulation.topCandidates ?? []
  const maxVisits = Math.max(1, ...Object.values(visits))
  const maxCandidateScore = Math.max(1e-9, ...topCandidates.map((candidate) => candidate.v3Score))
  const selectedVisitCount = selectedBandId === null ? 0 : visits[String(selectedBandId)] ?? 0
  const selectedLastVisit = selectedBandId === null ? null : lastVisitTimes[String(selectedBandId)] ?? null
  const selectedTimeSinceVisit = selectedLastVisit === null ? null : Math.max(0, simulation.elapsedSeconds - selectedLastVisit)
  const revisitSignal = selectedBandId === null ? 0 : Math.min(1, ((selectedTimeSinceVisit ?? simulation.elapsedSeconds) + (selectedVisitCount === 0 ? 1 : 0)) / Math.max(1, simulation.elapsedSeconds + 0.05))
  const latestDecision = recentDecisions[recentDecisions.length - 1]
  const sequentialStats = liveStats(comparison.sequential)
  const smartStats = liveStats(comparison.smart)
  const hitRateDiff = (smartStats.hitRate - sequentialStats.hitRate) * 100
  const missReduction = (sequentialStats.missRate - smartStats.missRate) * 100
  const coverageDiff = (smartStats.coverage - sequentialStats.coverage) * 100
  const primarySmartState = simulation.decisionNumber > 0 ? simulation : comparison.smart
  const primarySmartStats = liveStats(primarySmartState)
  const primarySmartHistory = sessionHistory(primarySmartState)
  const primarySelectedBand = primarySmartState?.selectedBand ?? null
  const sequentialHistory = sessionHistory(comparison.sequential)
  const comparisonSmartHistory = sessionHistory(comparison.smart)
  const hasSmartResults = primarySmartStats.decisions > 0
  const hasComparisonResults = sequentialStats.decisions > 0 || smartStats.decisions > 0
  const smartAverageHitGap = averageTimeBetweenHits(primarySmartHistory)
  const smartBestRf = maxDecisionValue(primarySmartHistory, 'rfProbability')
  const smartBestV3 = maxDecisionValue(primarySmartHistory, 'v3Score')
  const smartMostVisited = topVisitedBands(primarySmartState)
  const smartHitBands = topHitBands(primarySmartHistory)
  const sequentialHitSeries = cumulativeHits(sequentialHistory)
  const smartHitSeries = cumulativeHits(comparisonSmartHistory.length ? comparisonSmartHistory : primarySmartHistory)
  const chartMaxDecision = Math.max(1, ...sequentialHitSeries.map((point) => point.decisionNumber), ...smartHitSeries.map((point) => point.decisionNumber))
  const chartMaxHits = Math.max(1, ...sequentialHitSeries.map((point) => point.hits), ...smartHitSeries.map((point) => point.hits))
  const chartWidth = 720
  const chartHeight = 260
  const chartPadding = { top: 20, right: 24, bottom: 38, left: 48 }
  const chartInnerWidth = chartWidth - chartPadding.left - chartPadding.right
  const chartInnerHeight = chartHeight - chartPadding.top - chartPadding.bottom
  const toChartPoint = (point: { decisionNumber: number; hits: number }) => {
    const x = chartPadding.left + (point.decisionNumber / chartMaxDecision) * chartInnerWidth
    const y = chartPadding.top + chartInnerHeight - (point.hits / chartMaxHits) * chartInnerHeight
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }
  const sequentialPath = sequentialHitSeries.map(toChartPoint).join(' ')
  const smartPath = smartHitSeries.map(toChartPoint).join(' ')
  const workflowStep = simulation.decisionNumber > 0 ? 3 : simulation.status === 'running' || simulation.status === 'paused' || simulation.status === 'completed' || simulation.status === 'complete' ? 2 : scenario?.valid ? 1 : 0
  const runtimeLabel = runtimeConfig.useMockApi ? 'MOCK API READY' : 'REAL BACKEND • FROZEN SMART V3'

  const recentOutcomeByBand = useMemo(() => {
    const values = new Map<number, 'HIT' | 'MISS'>()
    recentDecisions.forEach((decision) => values.set(decision.bandId, decision.outcome))
    return values
  }, [recentDecisions])

  const applyError = useCallback((message: string) => {
    const normalized = normalizeDemoError(message)
    setLive(false)
    setError(normalized)
    setFeedback({ kind: 'error', message: normalized })
  }, [])

  const viewResults = () => {
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    if (!demoRequest || scenario) return
    const noticeTimer = window.setTimeout(() => {
      setError('')
      setFeedback({ kind: 'info', message: 'Upload a TSRD Stare scenario to begin the live demo.' })
      setUploadHighlight(true)
      uploadButtonRef.current?.focus()
    }, 80)
    const highlightTimer = window.setTimeout(() => setUploadHighlight(false), 3200)
    return () => {
      window.clearTimeout(noticeTimer)
      window.clearTimeout(highlightTimer)
    }
  }, [demoRequest, scenario])

  const stepOnce = useCallback(async () => {
    if (!simulation.simulationId || steppingRef.current) return
    steppingRef.current = true
    setFlowStage(0)
    setUpdateFlash(true)
    try {
      const next = await api.stepSimulation(simulation.simulationId)
      setSimulation(next)
      setError('')
      if (next.status === 'completed' || next.status === 'complete') {
        setLive(false)
        setFeedback({ kind: 'success', message: 'Simulation completed.' })
      }
    } catch (stepError) {
      applyError(stepError instanceof Error ? stepError.message : 'Simulation step failed.')
    } finally {
      steppingRef.current = false
      window.setTimeout(() => setUpdateFlash(false), 520)
    }
  }, [applyError, simulation.simulationId])

  useEffect(() => {
    if (!live || simulation.status !== 'running') return
    const timer = window.setInterval(() => { void stepOnce() }, 1000 / speed)
    return () => window.clearInterval(timer)
  }, [live, simulation.simulationId, simulation.status, speed, stepOnce])

  useEffect(() => {
    if (simulation.decisionNumber === 0) return
    const timers = FLOW_STAGES.map((_, index) => window.setTimeout(() => setFlowStage(index), index * 120))
    return () => timers.forEach(window.clearTimeout)
  }, [simulation.decisionNumber])

  const chooseFile = async (file: File | undefined) => {
    if (!file) return
    setError('')
    if (!file.name.toLowerCase().endsWith('.h5')) {
      applyError('Select a TSRD .h5 file.')
      return
    }
    setUploading(true)
    setLive(false)
    setFeedback({ kind: 'info', message: 'Uploading scenario for validation...' })
    try {
      const uploaded = await api.uploadScenario(file)
      setScenario(uploaded)
      setSimulation({ ...EMPTY_SIMULATION, scenarioId: uploaded.id })
      setComparison({ sequential: null, smart: null, running: false })
      window.localStorage.removeItem(RESOURCE_COMPARISON_STORAGE_KEY)
      setFlowStage(0)
      setUploadHighlight(false)
      if (uploaded.valid === false) {
        applyError('Upload failure. Invalid TSRD .h5 scenario.')
      } else {
        setFeedback({ kind: 'success', message: 'Upload success. Scenario Validated ✓' })
      }
      if (inputRef.current) inputRef.current.value = ''
    } catch (uploadError) {
      applyError(uploadError instanceof Error ? uploadError.message : 'Scenario upload failed.')
    } finally {
      setUploading(false)
    }
  }

  const start = async () => {
    if (!scenario?.valid) {
      applyError('Upload and validate a TSRD .h5 scenario first.')
      return
    }
    setStarting(true)
    setFeedback({ kind: 'info', message: 'Creating Smart V3 simulation session...' })
    try {
      const started = await api.startSimulation(scenario.id, 'Smart V3')
      const firstState = started.status === 'running' && started.simulationId ? await api.stepSimulation(started.simulationId) : started
      setSimulation(firstState)
      setLive(firstState.status === 'running')
      setSpeed(1)
      setFlowStage(0)
      setError('')
      setFeedback({ kind: firstState.status === 'completed' || firstState.status === 'complete' ? 'success' : 'success', message: firstState.status === 'completed' || firstState.status === 'complete' ? 'Simulation completed.' : 'Simulation started. Smart V3 is running at 1x.' })
    } catch (startError) {
      applyError(startError instanceof Error ? startError.message : 'Simulation start failed.')
    } finally {
      setStarting(false)
    }
  }

  const pause = async () => {
    setLive(false)
    if (!simulation.simulationId) return
    setPausing(true)
    try {
      setSimulation(await api.pauseSimulation(simulation.simulationId))
      setError('')
      setFeedback({ kind: 'info', message: 'Simulation paused.' })
    } catch (pauseError) {
      applyError(pauseError instanceof Error ? pauseError.message : 'Simulation pause failed.')
    } finally {
      setPausing(false)
    }
  }

  const reset = async () => {
    setLive(false)
    if (!simulation.simulationId) {
      setSimulation(scenario ? { ...EMPTY_SIMULATION, scenarioId: scenario.id } : EMPTY_SIMULATION)
      setFlowStage(0)
      setFeedback({ kind: 'info', message: 'Simulation reset to t=0.' })
      return
    }
    setResetting(true)
    try {
      const resetState = await api.resetSimulation(simulation.simulationId)
      setSimulation({ ...resetState, status: 'idle' })
      setFlowStage(0)
      setError('')
      setFeedback({ kind: 'info', message: 'Simulation reset to t=0.' })
    } catch (resetError) {
      applyError(resetError instanceof Error ? resetError.message : 'Simulation reset failed.')
    } finally {
      setResetting(false)
    }
  }

  const startComparison = async () => {
    if (!scenario?.valid) {
      applyError('Upload and validate a TSRD .h5 scenario first.')
      return
    }
    window.localStorage.removeItem(RESOURCE_COMPARISON_STORAGE_KEY)
    setFeedback({ kind: 'info', message: 'Starting Sequential vs Smart V3 comparison...' })
    try {
      const [sequential, smart] = await Promise.all([
        api.startSimulation(scenario.id, 'sequential'),
        api.startSimulation(scenario.id, 'smart_v3'),
      ])
      setComparison({ sequential, smart, running: true })
      setError('')
      setFeedback({ kind: 'success', message: 'Comparison started on the uploaded scenario.' })
    } catch (comparisonError) {
      applyError(comparisonError instanceof Error ? comparisonError.message : 'Comparison start failed.')
    }
  }

  const stepComparison = useCallback(async () => {
    if (!comparison.sequential?.simulationId || !comparison.smart?.simulationId || comparisonSteppingRef.current) return
    comparisonSteppingRef.current = true
    try {
      const stepIfRunning = (state: SimulationState) => state.status === 'completed' || state.status === 'complete'
        ? Promise.resolve(state)
        : api.stepSimulation(state.simulationId ?? '')
      const [sequential, smart] = await Promise.all([
        stepIfRunning(comparison.sequential),
        stepIfRunning(comparison.smart),
      ])
      setComparison((current) => ({ ...current, sequential, smart, running: sequential.status === 'running' || smart.status === 'running' }))
      setError('')
      if (sequential.status === 'completed' || sequential.status === 'complete' || smart.status === 'completed' || smart.status === 'complete') {
        setFeedback({ kind: 'success', message: 'Comparison simulation completed.' })
      }
    } catch (comparisonError) {
      setComparison((current) => ({ ...current, running: false }))
      applyError(comparisonError instanceof Error ? comparisonError.message : 'Comparison step failed.')
    } finally {
      comparisonSteppingRef.current = false
    }
  }, [applyError, comparison.sequential, comparison.smart])

  useEffect(() => {
    if (!comparison.running) return
    const timer = window.setInterval(() => { void stepComparison() }, 1000 / speed)
    return () => window.clearInterval(timer)
  }, [comparison.running, speed, stepComparison])

  useEffect(() => {
    const sequentialDecisions = comparison.sequential?.decisionNumber ?? 0
    const smartDecisions = comparison.smart?.decisionNumber ?? 0
    if (sequentialDecisions === 0 && smartDecisions === 0) return
    window.localStorage.setItem(RESOURCE_COMPARISON_STORAGE_KEY, JSON.stringify({
      updatedAt: new Date().toISOString(),
      scenario: scenario ? { id: scenario.id, filename: scenario.filename } : null,
      sequential: comparison.sequential,
      smart: comparison.smart,
    }))
  }, [comparison.sequential, comparison.smart, scenario])

  const pauseComparison = async () => {
    setComparison((current) => ({ ...current, running: false }))
    try {
      const [sequential, smart] = await Promise.all([
        comparison.sequential?.simulationId && comparison.sequential.status === 'running' ? api.pauseSimulation(comparison.sequential.simulationId) : Promise.resolve(comparison.sequential),
        comparison.smart?.simulationId && comparison.smart.status === 'running' ? api.pauseSimulation(comparison.smart.simulationId) : Promise.resolve(comparison.smart),
      ])
      setComparison({ sequential, smart, running: false })
      setError('')
      setFeedback({ kind: 'info', message: 'Comparison paused.' })
    } catch (comparisonError) {
      applyError(comparisonError instanceof Error ? comparisonError.message : 'Comparison pause failed.')
    }
  }

  const resetComparison = async () => {
    setComparison((current) => ({ ...current, running: false }))
    try {
      const [sequential, smart] = await Promise.all([
        comparison.sequential?.simulationId ? api.resetSimulation(comparison.sequential.simulationId) : Promise.resolve(null),
        comparison.smart?.simulationId ? api.resetSimulation(comparison.smart.simulationId) : Promise.resolve(null),
      ])
      setComparison({ sequential, smart, running: false })
      setError('')
      window.localStorage.removeItem(RESOURCE_COMPARISON_STORAGE_KEY)
      setFeedback({ kind: 'info', message: 'Comparison reset to t=0.' })
    } catch (comparisonError) {
      applyError(comparisonError instanceof Error ? comparisonError.message : 'Comparison reset failed.')
    }
  }

  const spectrumBands = Array.from({ length: 36 }, (_, bandId) => {
    const visitCount = visits[String(bandId)] ?? 0
    const recentOutcome = recentOutcomeByBand.get(bandId)
    const rfProbability = latestRf[bandId] ?? 0
    const v3Score = latestScores[bandId] ?? 0
    const isSelected = selectedBandId === bandId
    const visitIntensity = visitCount / maxVisits
    const visualIntensity = Math.max(0.08, Math.min(1, Math.max(rfProbability, visitIntensity)))
    return { bandId, visitCount, recentOutcome, rfProbability, v3Score, isSelected, visualIntensity }
  })

  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={runtimeLabel} title="Spectrum monitor" detail={runtimeConfig.useMockApi ? 'Mock API mode remains available for frontend-only review.' : 'Uploaded TSRD scenarios drive the real Smart V3 simulation session.'} />

      <Panel>
        <div className="grid gap-3 border-b border-[#243c3a] p-5 md:grid-cols-4">
          {['Upload', 'Validate', 'Run', 'Analyze'].map((step, index) => (
            <div key={step} className={`demo-workflow-step ${index <= workflowStep ? 'demo-workflow-step-active' : ''}`}>
              <span className="font-mono text-[9px] uppercase tracking-[0.14em]">0{index + 1}</span>
              <strong>{step}</strong>
            </div>
          ))}
        </div>
        <div className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#67e8c5]">Scenario control</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button ref={uploadButtonRef} onClick={() => inputRef.current?.click()} disabled={uploading} className={`flex items-center gap-2 border border-[#416b62] bg-[#102326] px-3 py-2 text-xs text-[#d5e9e4] transition-colors hover:border-[#67e8c5] hover:bg-[#153b39] disabled:cursor-not-allowed disabled:opacity-50 ${uploadHighlight ? 'demo-upload-highlight' : ''}`}><Upload size={15} /> {uploading ? 'Validating...' : 'Upload Stare H5'}</button>
              <input ref={inputRef} type="file" accept=".h5" className="hidden" onChange={(event) => void chooseFile(event.target.files?.[0])} />
              <span className="text-xs text-[#9db8b2]">{scenario ? scenario.filename : 'No scenario loaded'}</span>
              {scenario?.valid && <span className="flex items-center gap-1 border border-[#416b62] px-2 py-1 font-mono text-[9px] uppercase text-[#67e8c5]"><CheckCircle2 size={12} /> Scenario Validated ✓</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={starting || simulation.status === 'running'} onClick={() => void start()} title="Start simulation" className="flex items-center gap-2 border border-[#4ab99e] bg-[#153b39] px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#67e8c5] hover:bg-[#1b4944] disabled:cursor-not-allowed disabled:opacity-50"><Play size={15} /> {starting ? 'Starting...' : simulation.status === 'running' ? 'RUNNING' : 'Start Simulation'}</button>
            <button disabled={!simulation.simulationId || simulation.status !== 'running' || pausing} onClick={() => void pause()} title="Pause simulation" className="flex items-center gap-2 border border-[#416b62] px-3 py-2 text-xs uppercase tracking-[0.08em] text-[#d8bd73] hover:bg-[#173634] disabled:cursor-not-allowed disabled:opacity-40"><Pause size={15} /> {pausing ? 'Pausing...' : 'Pause'}</button>
            <button disabled={resetting || (!scenario && !simulation.simulationId)} onClick={() => void reset()} title="Reset simulation" className="flex items-center gap-2 border border-[#416b62] px-3 py-2 text-xs uppercase tracking-[0.08em] text-[#9db8b2] hover:bg-[#173634] disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw size={15} /> {resetting ? 'Resetting...' : 'Reset'}</button>
            <button disabled={!hasSmartResults && !hasComparisonResults} onClick={viewResults} className="flex items-center gap-2 border border-[#514044] bg-[#111317] px-3 py-2 text-xs uppercase tracking-[0.08em] text-[#e6e1da] hover:bg-[#2a1b1f] disabled:cursor-not-allowed disabled:opacity-40"><BarChart3 size={15} /> View Results</button>
            <div className="ml-1 flex items-center gap-2 border border-[#416b62] bg-[#102326] px-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#9db8b2]"><Gauge size={14} />{SPEEDS.map((option) => <button key={option} onClick={() => setSpeed(option)} className={`px-2 py-1 ${speed === option ? 'bg-[#153b39] text-[#67e8c5]' : 'text-[#9db8b2] hover:bg-[#173634]'}`}>{option}x</button>)}</div>
          </div>
        </div>
        {feedback && <div className={`mx-5 mb-5 flex items-center gap-2 border px-3 py-2 text-xs demo-feedback demo-feedback-${feedback.kind}`}>
          {feedback.kind === 'error' ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
          <span>{feedback.message}</span>
        </div>}
        <div className="grid gap-3 border-t border-[#243c3a] px-5 py-4 lg:grid-cols-[minmax(0,1fr)_330px]">
          {scenario ? <div className="grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-3">
            <div className="border border-[#514044] bg-[#17191d] px-3 py-2"><span className="block font-mono text-[9px] uppercase tracking-[0.14em] text-[#668681]">Validation</span><span className="text-[#d5e9e4]">{scenario.valid === false ? 'Validation failed' : 'Scenario Validated ✓'}</span></div>
            <div className="border border-[#2d2e33] bg-[#111317] px-3 py-2"><span className="block font-mono text-[9px] uppercase tracking-[0.14em] text-[#668681]">Filename</span><span className="break-all text-[#d5e9e4]">{scenario.filename}</span></div>
            <div className="border border-[#2d2e33] bg-[#111317] px-3 py-2"><span className="block font-mono text-[9px] uppercase tracking-[0.14em] text-[#668681]">Pulses</span><span className="text-[#d5e9e4]">{scenario.pulseCount?.toLocaleString() ?? '-'}</span></div>
            <div className="border border-[#2d2e33] bg-[#111317] px-3 py-2"><span className="block font-mono text-[9px] uppercase tracking-[0.14em] text-[#668681]">Emitters</span><span className="text-[#d5e9e4]">{scenario.emitterCount ?? '-'}</span></div>
            <div className="border border-[#2d2e33] bg-[#111317] px-3 py-2"><span className="block font-mono text-[9px] uppercase tracking-[0.14em] text-[#668681]">Duration</span><span className="text-[#d5e9e4]">{formatSeconds(scenario.durationSeconds)}</span></div>
            <div className="border border-[#2d2e33] bg-[#111317] px-3 py-2"><span className="block font-mono text-[9px] uppercase tracking-[0.14em] text-[#668681]">Receiver mode</span><span className="text-[#d5e9e4]">{scenario.receiverMode ?? 'Stare'}</span></div>
            <div className="border border-[#2d2e33] bg-[#111317] px-3 py-2"><span className="block font-mono text-[9px] uppercase tracking-[0.14em] text-[#668681]">Frequency</span><span className="text-[#d5e9e4]">{formatMHzRange(scenario.frequencyMinMHz, scenario.frequencyMaxMHz)}</span></div>
            <div className="border border-[#2d2e33] bg-[#111317] px-3 py-2"><span className="block font-mono text-[9px] uppercase tracking-[0.14em] text-[#668681]">Scenario ID</span><span className="font-mono text-[10px] text-[#d5e9e4]">{scenario.id.slice(0, 12)}</span></div>
          </div> : <div className="border border-[#2d2e33] bg-[#111317] px-4 py-4 text-sm text-[#89878a]">Upload and validate a TSRD .h5 scenario first.</div>}
          <div className="surface-card p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#d94a4a]">How to Run Demo</p>
            <ol className="mt-3 space-y-2 text-xs text-[#c0bdb7]">
              {['Upload Stare H5', 'Wait for validation', 'Start Simulation', 'Watch Smart V3 decisions', 'Compare with Sequential'].map((step, index) => <li key={step} className="flex gap-2"><span className="font-mono text-[#89878a]">{index + 1}.</span><span>{step}</span></li>)}
            </ol>
          </div>
        </div>
        <div className="grid gap-3 border-t border-[#243c3a] px-5 py-4 md:grid-cols-[minmax(0,1fr)_220px] md:items-center">
          <div>
            <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-[#668681]">
              <span>Status: <span className={statusTone(simulation.status)}>{simulation.status}</span></span>
              <span>{formatSeconds(simulation.elapsedSeconds)} / {simulation.decisionNumber} decisions</span>
            </div>
            <div className="h-2 overflow-hidden border border-[#514044] bg-[#17191d]"><div className="h-full bg-[#d94a4a] transition-all duration-500" style={{ width: `${simulation.progressPercent ?? 0}%` }} /></div>
          </div>
          <div className="border border-[#514044] bg-[#17191d] px-3 py-2 text-right">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#668681]">Progress</p>
            <p className="font-mono text-xl text-[#e6e1da]">{(simulation.progressPercent ?? 0).toFixed(1)}%</p>
          </div>
        </div>
        {(simulation.status === 'completed' || simulation.status === 'complete') && <div className="mx-5 mb-5 flex flex-col gap-3 border border-[#7a3538] bg-[#2a1b1f] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#d94a4a]">Simulation completed</p>
            <p className="mt-1 text-sm text-[#e6e1da]">Current scenario results are ready for review.</p>
          </div>
          <button onClick={viewResults} className="primary-cta"><BarChart3 size={15} /> View Results</button>
        </div>}
        {error && <div role="alert" className="mx-5 mb-5 flex items-center gap-2 border border-[#7a3538] bg-[#2a1b1f] px-3 py-2 text-xs text-[#e79a9a]"><AlertCircle size={15} /> {error}</div>}
      </Panel>

      <Panel className={`overflow-hidden ${updateFlash ? 'decision-update-flash' : ''}`}>
        <div className="border-b border-[#29423f] px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#67e8c5]">RF spectrum - 36 bands across 0-18 GHz</p><p className="mt-1 text-xs text-[#74938d]">Height shows RF probability or visit intensity. Red is selected, bright red is recent HIT, charcoal is recent MISS.</p></div>
            <div className="flex items-center gap-3 font-mono text-[9px] uppercase tracking-[0.12em] text-[#668681]"><span className="h-3 w-3 bg-[#d94a4a]" /> selected <span className="h-3 w-3 bg-[#b83b3b]" /> hit <span className="h-3 w-3 bg-[#34363d]" /> miss</div>
          </div>
        </div>
        <div className="overflow-x-auto p-5">
          <div className="min-w-[980px]">
            <div className="flex items-end gap-1 border-b border-[#514044] pb-4">
              {spectrumBands.map((band) => (
                <div key={band.bandId} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                  <div className="flex h-28 w-full items-end border-x border-[#202126] bg-[#111317]">
                    <div
                      title={`Band ${band.bandId}: ${formatMHzRange(band.bandId * 500, (band.bandId + 1) * 500)} / RF ${percent(band.rfProbability)} / V3 ${band.v3Score.toFixed(3)} / visits ${band.visitCount}`}
                      className={`spectrum-bar w-full ${band.isSelected ? 'spectrum-bar-selected' : band.recentOutcome === 'HIT' ? 'spectrum-bar-hit' : band.recentOutcome === 'MISS' ? 'spectrum-bar-miss' : 'spectrum-bar-idle'} ${band.isSelected && latestDecision?.outcome === 'HIT' ? 'hit-pulse-flash' : ''}`}
                      style={{ height: `${18 + band.visualIntensity * 82}%`, opacity: 0.55 + band.visualIntensity * 0.45 }}
                    />
                  </div>
                  <span className={`font-mono text-[9px] ${band.isSelected ? 'text-[#ffb0a8]' : 'text-[#668681]'}`}>{band.bandId}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-between font-mono text-[9px] uppercase tracking-[0.12em] text-[#668681]"><span>0 GHz</span><span>6 GHz</span><span>12 GHz</span><span>18 GHz</span></div>
          </div>
        </div>
      </Panel>

      <Panel>
        <div className="border-b border-[#29423f] px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#67e8c5]">Compare schedulers</p>
              <p className="mt-1 text-xs text-[#74938d]">Sequential and Smart V3 run as independent sessions on the same uploaded scenario.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button disabled={!scenario || comparison.running} onClick={() => void startComparison()} className="flex items-center gap-2 border border-[#4ab99e] bg-[#153b39] px-3 py-2 text-xs text-[#67e8c5] hover:bg-[#1b4944] disabled:cursor-not-allowed disabled:opacity-40"><Play size={14} /> Start Comparison</button>
              <button disabled={!comparison.sequential || comparison.running} onClick={() => void stepComparison()} className="border border-[#416b62] px-3 py-2 text-xs text-[#d5e9e4] hover:bg-[#173634] disabled:cursor-not-allowed disabled:opacity-40">Step</button>
              <button disabled={!comparison.running} onClick={() => void pauseComparison()} className="border border-[#416b62] p-2 text-[#d8bd73] hover:bg-[#173634] disabled:cursor-not-allowed disabled:opacity-40"><Pause size={14} /></button>
              <button disabled={!comparison.sequential && !comparison.smart} onClick={() => void resetComparison()} className="border border-[#416b62] p-2 text-[#9db8b2] hover:bg-[#173634] disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw size={14} /></button>
            </div>
          </div>
        </div>
        <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-5">
            {[
              { label: 'SEQUENTIAL', state: comparison.sequential, stats: sequentialStats },
              { label: 'SMART V3', state: comparison.smart, stats: smartStats },
            ].map((row) => {
              const rowVisits = row.state?.bandVisitCounts ?? {}
              const rowOutcomes = new Map((row.state?.recentDecisions ?? []).map((decision) => [decision.bandId, decision.outcome] as const))
              const rowMaxVisits = Math.max(1, ...Object.values(rowVisits))
              return (
                <div key={row.label} className="comparison-row">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#d94a4a]">{row.label}</p><p className="text-xs text-[#74938d]">t {formatSeconds(row.stats.time)} / current {row.stats.currentBand === null ? '-' : `B${row.stats.currentBand.toString().padStart(2, '0')}`}</p></div>
                    <div className="grid grid-cols-4 gap-2 text-right font-mono text-[10px] text-[#9db8b2]">
                      <span>{row.stats.decisions} dec</span>
                      <span>{row.stats.hits} hit</span>
                      <span>{row.stats.misses} miss</span>
                      <span>{percent(row.stats.hitRate)} HR</span>
                    </div>
                  </div>
                  <div className="grid gap-[3px]" style={{ gridTemplateColumns: 'repeat(36, minmax(0, 1fr))' }}>
                    {Array.from({ length: 36 }, (_, bandId) => {
                      const visitCount = rowVisits[String(bandId)] ?? 0
                      const outcome = rowOutcomes.get(bandId)
                      const selected = row.state?.currentBand === bandId
                      const height = 22 + (visitCount / rowMaxVisits) * 34
                      return <span key={bandId} title={`${row.label} B${bandId} / visits ${visitCount}${outcome ? ` / ${outcome}` : ''}`} className={`comparison-band ${selected ? 'comparison-band-selected' : outcome === 'HIT' ? 'comparison-band-hit' : outcome === 'MISS' ? 'comparison-band-miss' : ''}`} style={{ height }} />
                    })}
                  </div>
                  <div className="mt-2 flex justify-between font-mono text-[9px] uppercase tracking-[0.12em] text-[#668681]"><span>0 GHz</span><span>9 GHz</span><span>18 GHz</span></div>
                </div>
              )
            })}
          </div>
          <div className="border border-[#514044] bg-[#111317] p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#d94a4a]">Smart V3 vs Sequential</p>
            <p className="mt-1 text-xs text-[#74938d]">Current uploaded scenario - live simulation metrics.</p>
            <dl className="mt-4 space-y-4">
              <div><dt className="text-xs text-[#74938d]">Hit-rate difference</dt><dd className="mt-1 font-display text-2xl text-[#e6e1da]">{deltaText(hitRateDiff)}</dd></div>
              <div><dt className="text-xs text-[#74938d]">Miss reduction</dt><dd className="mt-1 font-display text-2xl text-[#e6e1da]">{deltaText(missReduction)}</dd></div>
              <div><dt className="text-xs text-[#74938d]">Spectrum coverage difference</dt><dd className="mt-1 font-display text-2xl text-[#e6e1da]">{deltaText(coverageDiff)}</dd></div>
            </dl>
            <div className="mt-5 border-t border-[#2d2e33] pt-4 text-xs text-[#9db8b2]">
              <p>Sequential coverage: {percent(sequentialStats.coverage)} / {sequentialStats.uniqueBands} bands</p>
              <p className="mt-1">Smart V3 coverage: {percent(smartStats.coverage)} / {smartStats.uniqueBands} bands</p>
            </div>
          </div>
        </div>
      </Panel>

      <section ref={resultsRef} className="space-y-5" aria-label="Results and analytics">
        <SectionHeader eyebrow="CURRENT SCENARIO RESULTS" title="Results & Analytics" detail="Metrics in this section are calculated only from the currently uploaded scenario and live simulation sessions." />

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Panel>
            <div className="border-b border-[#29423f] px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#67e8c5]">Smart V3 summary</p>
                  <p className="mt-1 text-xs text-[#74938d]">{scenario ? scenario.filename : 'No scenario loaded'}</p>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#89878a]">Live scenario metrics</span>
              </div>
            </div>
            {hasSmartResults ? <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ['Total decisions', primarySmartStats.decisions.toString()],
                ['HIT count', primarySmartStats.hits.toString()],
                ['MISS count', primarySmartStats.misses.toString()],
                ['Live hit rate', percent(primarySmartStats.hitRate)],
                ['Unique bands visited', `${primarySmartStats.uniqueBands} / 36`],
                ['Spectrum coverage', percent(primarySmartStats.coverage)],
                ['Simulation duration', formatSeconds(primarySmartStats.time)],
                ['Emitter detections', 'Not available'],
                ['Average time between HITs', valueOrUnavailable(smartAverageHitGap, (value) => `${value.toFixed(3)}s`)],
              ].map(([label, value]) => <div key={label} className="surface-card p-4"><p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#89878a]">{label}</p><p className="mt-2 font-display text-xl text-[#e6e1da]">{value}</p></div>)}
            </div> : <div className="p-5 text-sm text-[#89878a]">Run Smart V3 to generate scenario results.</div>}
          </Panel>

          <Panel>
            <div className="border-b border-[#29423f] px-5 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#d94a4a]">FINAL HOLDOUT BENCHMARK</p>
              <p className="mt-1 text-xs text-[#74938d]">Pre-evaluated final HOLDOUT benchmark - not calculated from the uploaded scenario.</p>
            </div>
            <div className="space-y-4 p-5">
              <div className="border border-[#514044] bg-[#2a1b1f] p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#d94a4a]">Final Smart V3</p>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <div><p className="font-display text-xl text-[#e6e1da]">71.76%</p><p className="text-[10px] text-[#9db8b2]">hit rate</p></div>
                  <div><p className="font-display text-xl text-[#e6e1da]">95.67%</p><p className="text-[10px] text-[#9db8b2]">emitter coverage</p></div>
                  <div><p className="font-display text-xl text-[#e6e1da]">0.257s</p><p className="text-[10px] text-[#9db8b2]">avg delay</p></div>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-[#89878a]">These benchmark values are fixed reference results. They are intentionally kept separate from current scenario analytics.</p>
            </div>
          </Panel>
        </div>

        <Panel>
          <div className="border-b border-[#29423f] px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#67e8c5]">Sequential vs Smart V3</p>
                <p className="mt-1 text-xs text-[#74938d]">Current uploaded scenario - live simulation metrics only.</p>
              </div>
              {hasComparisonResults && <span className={`font-display text-xl ${hitRateDiff >= 0 ? 'text-[#e6e1da]' : 'text-[#d8bd73]'}`}>Smart V3 hit-rate improvement: {deltaText(hitRateDiff)}</span>}
            </div>
          </div>
          {hasComparisonResults ? <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="border-b border-[#243c3a] font-mono text-[9px] uppercase tracking-[0.14em] text-[#668681]"><tr><th className="px-4 py-3 font-normal">Metric</th><th className="px-4 py-3 font-normal">Sequential</th><th className="px-4 py-3 font-normal">Smart V3</th><th className="px-4 py-3 font-normal">Difference</th></tr></thead>
                <tbody className="divide-y divide-[#243c3a]">
                  {[
                    ['Hit rate', percent(sequentialStats.hitRate), percent(smartStats.hitRate), metricDelta(smartStats.hitRate * 100, sequentialStats.hitRate * 100, ' pp')],
                    ['Hits', sequentialStats.hits.toString(), smartStats.hits.toString(), signedInteger(smartStats.hits - sequentialStats.hits)],
                    ['Misses', sequentialStats.misses.toString(), smartStats.misses.toString(), signedInteger(smartStats.misses - sequentialStats.misses)],
                    ['Unique bands visited', sequentialStats.uniqueBands.toString(), smartStats.uniqueBands.toString(), signedInteger(smartStats.uniqueBands - sequentialStats.uniqueBands)],
                    ['Spectrum coverage', percent(sequentialStats.coverage), percent(smartStats.coverage), metricDelta(smartStats.coverage * 100, sequentialStats.coverage * 100, ' pp')],
                    ['Decisions', sequentialStats.decisions.toString(), smartStats.decisions.toString(), signedInteger(smartStats.decisions - sequentialStats.decisions)],
                  ].map(([metric, sequential, smart, difference]) => <tr key={metric}><td className="px-4 py-3 text-[#e6e1da]">{metric}</td><td className="px-4 py-3 font-mono text-[#c0bdb7]">{sequential}</td><td className="px-4 py-3 font-mono text-[#c0bdb7]">{smart}</td><td className="px-4 py-3 font-mono text-[#e6e1da]">{difference}</td></tr>)}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <div className="surface-card p-4"><p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#89878a]">Hit-rate difference</p><p className="mt-2 font-display text-2xl text-[#e6e1da]">{deltaText(hitRateDiff)}</p></div>
              <div className="surface-card p-4"><p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#89878a]">Miss reduction</p><p className="mt-2 font-display text-2xl text-[#e6e1da]">{deltaText(missReduction)}</p></div>
              <div className="surface-card p-4"><p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#89878a]">Coverage difference</p><p className="mt-2 font-display text-2xl text-[#e6e1da]">{deltaText(coverageDiff)}</p></div>
            </div>
          </div> : <div className="p-5 text-sm text-[#89878a]">Run Compare Schedulers to generate live comparison metrics.</div>}
        </Panel>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Panel>
            <div className="border-b border-[#29423f] px-5 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#67e8c5]">Cumulative HIT chart</p>
              <p className="mt-1 text-xs text-[#74938d]">X-axis: decision number. Y-axis: cumulative HITs.</p>
            </div>
            {hasComparisonResults ? <div className="p-5">
              <div className="mb-3 flex flex-wrap gap-4 font-mono text-[10px] uppercase tracking-[0.12em] text-[#89878a]"><span className="flex items-center gap-2"><span className="h-2 w-6 bg-[#d8bd73]" /> Sequential</span><span className="flex items-center gap-2"><span className="h-2 w-6 bg-[#d94a4a]" /> Smart V3</span></div>
              <svg className="results-hit-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Cumulative HITs by decision number">
                <title>Cumulative HITs</title>
                <desc>Sequential and Smart V3 cumulative HIT counts across the current comparison run.</desc>
                <rect x={chartPadding.left} y={chartPadding.top} width={chartInnerWidth} height={chartInnerHeight} className="results-chart-frame" />
                {[0, 0.5, 1].map((tick) => {
                  const y = chartPadding.top + chartInnerHeight - tick * chartInnerHeight
                  const value = Math.round(tick * chartMaxHits)
                  return <g key={tick}><line x1={chartPadding.left} x2={chartPadding.left + chartInnerWidth} y1={y} y2={y} className="results-chart-grid" /><text x={chartPadding.left - 10} y={y + 4} textAnchor="end" className="results-chart-label">{value}</text></g>
                })}
                {[0, 0.5, 1].map((tick) => {
                  const x = chartPadding.left + tick * chartInnerWidth
                  const value = Math.round(tick * chartMaxDecision)
                  return <g key={tick}><line x1={x} x2={x} y1={chartPadding.top + chartInnerHeight} y2={chartPadding.top + chartInnerHeight + 5} className="results-chart-axis" /><text x={x} y={chartPadding.top + chartInnerHeight + 22} textAnchor="middle" className="results-chart-label">{value}</text></g>
                })}
                <line x1={chartPadding.left} x2={chartPadding.left} y1={chartPadding.top} y2={chartPadding.top + chartInnerHeight} className="results-chart-axis" />
                <line x1={chartPadding.left} x2={chartPadding.left + chartInnerWidth} y1={chartPadding.top + chartInnerHeight} y2={chartPadding.top + chartInnerHeight} className="results-chart-axis" />
                {sequentialPath && <polyline points={sequentialPath} className="results-line results-line-sequential" />}
                {smartPath && <polyline points={smartPath} className="results-line results-line-smart" />}
                <text x={chartPadding.left + chartInnerWidth / 2} y={chartHeight - 4} textAnchor="middle" className="results-chart-axis-title">Decision number</text>
                <text x={14} y={chartPadding.top + chartInnerHeight / 2} textAnchor="middle" className="results-chart-axis-title" transform={`rotate(-90 14 ${chartPadding.top + chartInnerHeight / 2})`}>Cumulative HITs</text>
              </svg>
            </div> : <div className="p-5 text-sm text-[#89878a]">Run Compare Schedulers to generate the Sequential and Smart V3 HIT curves.</div>}
          </Panel>

          <Panel>
            <div className="border-b border-[#29423f] px-5 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#67e8c5]">Smart V3 Decision Insights</p>
              <p className="mt-1 text-xs text-[#74938d]">Derived from the actual Smart V3 session history.</p>
            </div>
            {hasSmartResults ? <div className="divide-y divide-[#243c3a]">
              <div className="px-5 py-4"><p className="text-xs text-[#74938d]">Most visited bands</p><p className="mt-2 font-mono text-xs text-[#e6e1da]">{smartMostVisited.length ? smartMostVisited.map((band) => `B${band.bandId} (${band.count})`).join(', ') : 'Not available'}</p></div>
              <div className="px-5 py-4"><p className="text-xs text-[#74938d]">Bands producing the most HITs</p><p className="mt-2 font-mono text-xs text-[#e6e1da]">{smartHitBands.length ? smartHitBands.map((band) => `B${band.bandId} (${band.count})`).join(', ') : 'Not available'}</p></div>
              <div className="px-5 py-4"><p className="text-xs text-[#74938d]">Current RF probability observed</p><p className="mt-2 font-mono text-xs text-[#e6e1da]">{primarySelectedBand ? percent(primarySelectedBand.rfProbability) : 'Not available'}</p></div>
              <div className="px-5 py-4"><p className="text-xs text-[#74938d]">Best RF probability observed</p><p className="mt-2 font-mono text-xs text-[#e6e1da]">{valueOrUnavailable(smartBestRf, percent)}</p></div>
              <div className="px-5 py-4"><p className="text-xs text-[#74938d]">Highest V3 score observed</p><p className="mt-2 font-mono text-xs text-[#e6e1da]">{valueOrUnavailable(smartBestV3, (value) => value.toFixed(4))}</p></div>
            </div> : <div className="p-5 text-sm text-[#89878a]">Run Smart V3 to generate decision insights.</div>}
          </Panel>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <div className="border-b border-[#29423f] px-5 py-4"><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#67e8c5]">Live decision flow</p></div>
          <div className="grid gap-3 p-5 md:grid-cols-[repeat(6,minmax(0,1fr))]">
            {FLOW_STAGES.map((stage, index) => (
              <div key={stage} className={`decision-flow-stage ${index === flowStage ? 'decision-flow-stage-active' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#668681]">0{index + 1}</span>
                  {index < FLOW_STAGES.length - 1 && <ArrowRight size={13} className="text-[#668681]" />}
                </div>
                <p className="mt-3 text-sm text-[#e6e1da]">{stage}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <div className="border-b border-[#29423f] px-5 py-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#67e8c5]">Why this band?</p>
            <h3 className="mt-1 font-display text-lg text-[#e7f4f1]">{selectedBand ? `Band ${selectedBand.bandId}` : 'Awaiting selection'}</h3>
          </div>
          <dl className="divide-y divide-[#243c3a]">
            {[
              ['Frequency range', selectedBand ? formatMHzRange(selectedBand.frequencyStartMHz, selectedBand.frequencyEndMHz) : '-'],
              ['RF probability', selectedBand ? percent(selectedBand.rfProbability) : '-'],
              ['Revisit signal', selectedBand ? `${Math.round(revisitSignal * 100)}% derived` : '-'],
              ['V3 score', selectedBand ? selectedBand.v3Score.toFixed(4) : '-'],
              ['Last visit time', formatSeconds(selectedLastVisit)],
              ['Visit count', selectedBand ? selectedVisitCount.toString() : '-'],
            ].map(([label, value]) => <div className="flex items-center justify-between gap-3 px-5 py-3" key={label}><dt className="text-xs text-[#74938d]">{label}</dt><dd className="text-right font-mono text-xs text-[#d5e9e4]">{value}</dd></div>)}
          </dl>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel>
          <div className="border-b border-[#29423f] px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#67e8c5]">Top candidates</p><p className="mt-1 text-xs text-[#74938d]">RF probability predicts activity; V3 score is the final scheduling priority.</p></div>
              <BarChart3 size={18} className="text-[#9db8b2]" />
            </div>
          </div>
          <div className="space-y-3 p-5">
            {topCandidates.length ? topCandidates.slice(0, 5).map((candidate, index) => (
              <div key={candidate.bandId} className="grid gap-2 border border-[#2d2e33] bg-[#111317] p-3 md:grid-cols-[42px_110px_1fr_130px] md:items-center">
                <span className="font-mono text-xs text-[#d94a4a]">#{index + 1}</span>
                <span className="font-mono text-xs text-[#e6e1da]">B{candidate.bandId.toString().padStart(2, '0')}</span>
                <span className="text-xs text-[#9db8b2]">{formatMHzRange(candidate.frequencyStartMHz, candidate.frequencyEndMHz)}</span>
                <div>
                  <div className="mb-1 flex justify-between font-mono text-[10px] text-[#9db8b2]"><span>RF {percent(candidate.rfProbability)}</span><span>V3 {candidate.v3Score.toFixed(3)}</span></div>
                  <div className="h-2 bg-[#202126]"><div className="h-full bg-[#d94a4a] transition-all duration-500" style={{ width: `${Math.max(4, (candidate.v3Score / maxCandidateScore) * 100)}%` }} /></div>
                </div>
              </div>
            )) : <p className="text-sm text-[#74938d]">Start the session to see ranked candidate bands.</p>}
          </div>
        </Panel>

        <Panel>
          <div className="border-b border-[#29423f] px-5 py-4"><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#67e8c5]">Live comparison</p></div>
          <div className="space-y-4 p-5">
            <p className="text-xs text-[#74938d]">Final HOLDOUT benchmark - not live scenario metrics.</p>
            <div className="border border-[#2d2e33] bg-[#111317] p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#668681]">Sequential baseline</p>
              <p className="mt-2 font-display text-2xl text-[#e6e1da]">27.24%</p>
              <p className="text-xs text-[#9db8b2]">hit rate</p>
            </div>
            <div className="border border-[#514044] bg-[#2a1b1f] p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#d94a4a]">Final Smart V3</p>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <div><p className="font-display text-xl text-[#e6e1da]">71.76%</p><p className="text-[10px] text-[#9db8b2]">hit rate</p></div>
                <div><p className="font-display text-xl text-[#e6e1da]">95.67%</p><p className="text-[10px] text-[#9db8b2]">coverage</p></div>
                <div><p className="font-display text-xl text-[#e6e1da]">0.257s</p><p className="text-[10px] text-[#9db8b2]">avg delay</p></div>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <Panel>
        <div className="border-b border-[#29423f] px-5 py-4"><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#67e8c5]">Recent decisions</p></div>
        <div className="grid gap-4 p-5 xl:grid-cols-[260px_minmax(0,1fr)]">
          <div className="space-y-2">
            {recentDecisions.length ? recentDecisions.slice(-10).map((decision) => <div key={`${decision.decisionNumber}-${decision.bandId}`} className={`decision-timeline-item ${decision.outcome === 'HIT' ? 'decision-hit' : 'decision-miss'}`}><span className="font-mono text-[10px]">#{decision.decisionNumber}</span><span className="font-mono text-[10px]">B{decision.bandId.toString().padStart(2, '0')}</span><span className="font-mono text-[10px]">{decision.outcome}</span></div>) : <p className="text-sm text-[#74938d]">No live decisions recorded.</p>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="border-b border-[#243c3a] font-mono text-[9px] uppercase tracking-[0.14em] text-[#668681]"><tr>{['Decision', 'Time', 'Band', 'Frequency', 'RF Probability', 'V3 Score', 'HIT/MISS'].map((header) => <th key={header} className="px-4 py-3 font-normal">{header}</th>)}</tr></thead>
              <tbody className="divide-y divide-[#243c3a]">
                {recentDecisions.length ? recentDecisions.slice().reverse().map((decision) => <tr key={`${decision.decisionNumber}-${decision.bandId}`} className="decision-row"><td className="px-4 py-3 font-mono text-[#d5e9e4]">#{decision.decisionNumber}</td><td className="px-4 py-3 font-mono text-[#9db8b2]">{formatSeconds(decision.simulationTimeSeconds)}</td><td className="px-4 py-3 font-mono text-[#d5e9e4]">B{decision.bandId.toString().padStart(2, '0')}</td><td className="px-4 py-3 text-[#9db8b2]">{formatMHzRange(decision.frequencyStartMHz, decision.frequencyEndMHz)}</td><td className="px-4 py-3 font-mono text-[#d5e9e4]">{percent(decision.rfProbability)}</td><td className="px-4 py-3 font-mono text-[#d5e9e4]">{decision.v3Score.toFixed(4)}</td><td className="px-4 py-3"><span className={`outcome-pill ${decision.outcome === 'HIT' ? 'outcome-hit' : 'outcome-miss'}`}>{decision.outcome}</span></td></tr>) : <tr><td colSpan={7} className="px-5 py-6 text-center text-[#74938d]">No live decisions recorded.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </Panel>
    </div>
  )
}
