import { useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, FileUp, Play, RotateCcw } from 'lucide-react'
import { api } from '../services/api'
import { schedulerOptions } from '../services/simulationApi'
import type { SchedulerName, SimulationState, UploadedTsrdScenario } from '../types/api'
import { runtimeConfig } from '../config/runtime'

const idleState: SimulationState = { status: 'idle', scenarioId: null, scheduler: 'Smart V3', elapsedSeconds: 0, decisionNumber: 0, currentBand: null }
type Feedback = { kind: 'info' | 'success' | 'error'; message: string }

function normalizeControlError(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('backend') || lower.includes('failed to fetch') || lower.includes('network')) return 'Backend unavailable. Start the FastAPI service.'
  if (lower.includes('frozen') && lower.includes('model')) return 'Frozen Smart V3 model is not loaded.'
  if (lower.includes('model is not loaded')) return 'Frozen Smart V3 model is not loaded.'
  return message
}

export function ScenarioControl() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [scenario, setScenario] = useState<UploadedTsrdScenario | null>(null)
  const [scheduler, setScheduler] = useState<SchedulerName>('Smart V3')
  const [simulation, setSimulation] = useState<SimulationState>(idleState)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [uploading, setUploading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [resetting, setResetting] = useState(false)

  const applyError = (message: string) => {
    const normalized = normalizeControlError(message)
    setError(normalized)
    setFeedback({ kind: 'error', message: normalized })
  }

  const chooseFile = async (file: File | undefined) => {
    if (!file) return
    setError('')
    if (!file.name.toLowerCase().endsWith('.h5')) {
      applyError('Select a TSRD .h5 file.')
      return
    }
    setUploading(true)
    setFeedback({ kind: 'info', message: 'Uploading scenario for validation...' })
    try {
      const uploaded = await api.uploadScenario(file)
      setScenario(uploaded)
      setSimulation({ ...idleState, scenarioId: uploaded.id })
      if (uploaded.valid === false) {
        applyError('Upload failure. Invalid TSRD .h5 scenario.')
      } else {
        setFeedback({ kind: 'success', message: 'Upload success. Scenario Validated ✓' })
      }
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
    setFeedback({ kind: 'info', message: 'Creating simulation session...' })
    try {
      setSimulation(await api.startSimulation(scenario.id, scheduler))
      setError('')
      setFeedback({ kind: 'success', message: 'Simulation started. Open Live Spectrum to watch live decisions.' })
    } catch (startError) {
      applyError(startError instanceof Error ? startError.message : 'Simulation start failed.')
    } finally {
      setStarting(false)
    }
  }

  const reset = async () => {
    setResetting(true)
    try {
      setScenario(null)
      const resetState = simulation.simulationId ? await api.resetSimulation(simulation.simulationId) : idleState
      setSimulation({ ...resetState, status: 'idle' })
      setError('')
      setFeedback({ kind: 'info', message: 'Scenario control reset.' })
      if (inputRef.current) inputRef.current.value = ''
    } catch (resetError) {
      applyError(resetError instanceof Error ? resetError.message : 'Reset failed.')
    } finally {
      setResetting(false)
    }
  }

  return (
    <section className="surface-panel mb-7 px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="section-kicker">Scenario control</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button onClick={() => inputRef.current?.click()} disabled={uploading} className="secondary-cta disabled:cursor-not-allowed disabled:opacity-50"><FileUp size={15} /> {uploading ? 'Validating...' : 'Upload Stare H5'}</button>
            <input ref={inputRef} type="file" accept=".h5" className="hidden" onChange={(event) => void chooseFile(event.target.files?.[0])} />
            <span className="text-xs text-[#89878a]">{scenario ? scenario.filename : 'No scenario selected'}</span>
            {scenario?.valid && <span className="surface-card flex items-center gap-1 px-2 py-1 font-mono text-[9px] uppercase text-[#d94a4a]"><CheckCircle2 size={12} /> Scenario Validated ✓</span>}
          </div>
          {scenario?.valid && <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[#89878a]">
            <span>{scenario.pulseCount?.toLocaleString() ?? '-'} pulses</span>
            <span>{scenario.emitterCount ?? '-'} emitters</span>
            <span>{scenario.durationSeconds?.toFixed(3) ?? '-'}s</span>
            <span>{scenario.receiverMode ?? 'Stare'}</span>
          </div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="muted-label">
            Scheduler
            <select value={scheduler} onChange={(event) => setScheduler(event.target.value as SchedulerName)} className="ml-2 border border-[#514044] bg-[#111317] px-2 py-2 text-xs normal-case tracking-normal text-[#e6e1da] outline-none">
              {schedulerOptions.map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
          <button disabled={!scenario?.valid || simulation.status === 'running' || starting} onClick={() => void start()} className="primary-cta disabled:cursor-not-allowed disabled:opacity-40"><Play size={14} /> {starting ? 'Starting...' : simulation.status === 'running' ? 'RUNNING' : 'Start Simulation'}</button>
          <button onClick={() => void reset()} disabled={resetting} title="Reset scenario" className="secondary-cta px-3 disabled:cursor-not-allowed disabled:opacity-50"><RotateCcw size={15} /> {resetting ? 'Resetting...' : ''}</button>
        </div>
      </div>
      <div className="mt-4 grid gap-2 border-t border-[#2d2e33] pt-3 text-xs text-[#c0bdb7] md:grid-cols-5">
        {['Upload Stare H5', 'Wait for validation', 'Start Simulation', 'Watch Smart V3 decisions', 'Compare with Sequential'].map((step, index) => <span key={step} className="flex gap-2"><span className="font-mono text-[#89878a]">{index + 1}.</span>{step}</span>)}
      </div>
      {!scenario?.valid && <p className="mt-3 text-xs text-[#89878a]">Upload and validate a TSRD .h5 scenario first.</p>}
      {feedback && <div className={`mt-3 flex items-center gap-2 border px-3 py-2 text-xs demo-feedback demo-feedback-${feedback.kind}`}>
        {feedback.kind === 'error' ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
        <span>{feedback.message}</span>
      </div>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#2d2e33] pt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[#89878a]">
        <span>Status: <span className={simulation.status === 'running' ? 'text-[#d94a4a]' : 'text-[#c0bdb7]'}>{simulation.status}</span></span>
        <span>{runtimeConfig.useMockApi ? 'Mock API ready' : 'REAL BACKEND • FROZEN SMART V3'}</span>
      </div>
      {error && <p role="alert" className="mt-3 text-xs text-[#e79a9a]">{error}</p>}
    </section>
  )
}
