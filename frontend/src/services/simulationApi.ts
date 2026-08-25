import { spectrumBands } from '../data/mockData'
import type { ApiClient, BandScore, SchedulerName, SimulationBand, SimulationDecision, SimulationSchedulerKey, SimulationState, UploadedTsrdScenario } from '../types/api'
import { request } from './api'

let scenario: UploadedTsrdScenario | null = null
let state: SimulationState = { status: 'idle', scenarioId: null, scheduler: 'Smart V3', elapsedSeconds: 0, progressPercent: 0, decisionNumber: 0, currentBand: null, scanHistory: [], recentDecisions: [], bandVisitCounts: {}, lastVisitTimesSeconds: {} }
const mockSessions: Record<string, SimulationState> = {}

export const bandScores: BandScore[] = spectrumBands.map((band) => ({ band: band.id, frequencyStartGHz: band.startGHz, frequencyEndGHz: band.endGHz, rfProbability: band.activity, explorationScore: ((band.id * 0.07) % 0.28) + 0.58, timeSinceVisitSeconds: band.visitedAt, priorityScore: band.priority, status: band.id === 17 ? 'selected' : 'candidate' }))

interface BackendScenarioUpload {
  scenario_id: string
  filename: string
  valid: boolean
  receiver_mode: string
  pulse_count: number
  unique_emitter_count: number
  frequency_min: number
  frequency_max: number
  toa_min: number
  toa_max: number
  file_size: number
  validation_messages: string[]
}

interface BackendDecisionBand {
  band_id: number
  frequency_start_mhz: number
  frequency_end_mhz: number
  rf_probability: number
  v3_score: number
}

interface BackendScanHistoryItem {
  decision_number: number
  simulation_time_seconds: number
  dwell_duration_seconds: number
  band_id: number
  outcome: 'HIT' | 'MISS'
  pulse_count_observed: number
  rf_probability: number
  v3_score: number
}

interface BackendSimulationState {
  simulation_id: string
  scenario_id: string
  scheduler: SimulationSchedulerKey
  status: 'running' | 'paused' | 'completed'
  current_simulation_time_seconds: number
  selected_band: number | null
  selected_band_details: BackendDecisionBand | null
  last_outcome: 'HIT' | 'MISS' | null
  decision_count: number
  scan_history: BackendScanHistoryItem[]
  recent_decisions: BackendScanHistoryItem[]
  hit_miss_history: Array<'HIT' | 'MISS'>
  latest_rf_probabilities: number[]
  latest_v3_scores: number[]
  top_candidates: BackendDecisionBand[]
  band_visit_counts: Record<string, number>
  per_band_visit_counts: Record<string, number>
  last_visit_times_seconds: Record<string, number | null>
  progress_percent: number
}

function frequencyForBand(bandId: number): Pick<SimulationBand, 'frequencyStartMHz' | 'frequencyEndMHz'> {
  return { frequencyStartMHz: bandId * 500, frequencyEndMHz: (bandId + 1) * 500 }
}

function mapBand(band: BackendDecisionBand): SimulationBand {
  return {
    bandId: band.band_id,
    frequencyStartMHz: band.frequency_start_mhz,
    frequencyEndMHz: band.frequency_end_mhz,
    rfProbability: band.rf_probability,
    v3Score: band.v3_score,
  }
}

function mapDecision(item: BackendScanHistoryItem): SimulationDecision {
  const frequency = frequencyForBand(item.band_id)
  return {
    decisionNumber: item.decision_number,
    simulationTimeSeconds: item.simulation_time_seconds,
    dwellDurationSeconds: item.dwell_duration_seconds,
    bandId: item.band_id,
    outcome: item.outcome,
    pulseCountObserved: item.pulse_count_observed,
    rfProbability: item.rf_probability,
    v3Score: item.v3_score,
    ...frequency,
  }
}

function mapSimulationState(response: BackendSimulationState): SimulationState {
  const selectedBand = response.selected_band_details ? mapBand(response.selected_band_details) : response.selected_band === null ? null : { bandId: response.selected_band, ...frequencyForBand(response.selected_band), rfProbability: response.latest_rf_probabilities[response.selected_band] ?? 0, v3Score: response.latest_v3_scores[response.selected_band] ?? 0 }
  return {
    simulationId: response.simulation_id,
    schedulerKey: response.scheduler,
    status: response.status,
    scenarioId: response.scenario_id,
    scheduler: response.scheduler === 'sequential' ? 'Sequential' : 'Smart V3',
    elapsedSeconds: response.current_simulation_time_seconds,
    progressPercent: response.progress_percent,
    decisionNumber: response.decision_count,
    currentBand: response.selected_band,
    selectedBand,
    lastOutcome: response.last_outcome,
    hitMissHistory: response.hit_miss_history,
    latestRfProbabilities: response.latest_rf_probabilities,
    latestV3Scores: response.latest_v3_scores,
    topCandidates: response.top_candidates.map(mapBand),
    scanHistory: response.scan_history.map(mapDecision),
    recentDecisions: response.recent_decisions.map(mapDecision),
    bandVisitCounts: response.band_visit_counts ?? response.per_band_visit_counts,
    lastVisitTimesSeconds: response.last_visit_times_seconds,
  }
}

function normalizeScheduler(scheduler: SchedulerName | SimulationSchedulerKey | undefined): SimulationSchedulerKey {
  if (scheduler === 'sequential' || scheduler === 'Sequential') return 'sequential'
  return 'smart_v3'
}

function mapUpload(response: BackendScenarioUpload): UploadedTsrdScenario {
  return {
    id: response.scenario_id,
    filename: response.filename,
    sizeBytes: response.file_size,
    status: response.valid ? 'ready' : 'error',
    selectedAt: new Date().toISOString(),
    valid: response.valid,
    receiverMode: response.receiver_mode,
    pulseCount: response.pulse_count,
    emitterCount: response.unique_emitter_count,
    durationSeconds: Math.max(0, (response.toa_max - response.toa_min) / 1_000_000),
    frequencyMinMHz: response.frequency_min,
    frequencyMaxMHz: response.frequency_max,
    toaMinSeconds: response.toa_min / 1_000_000,
    toaMaxSeconds: response.toa_max / 1_000_000,
    validationMessages: response.validation_messages,
  }
}

function nextMockDecision(previous: SimulationState): SimulationState {
  const decisionNumber = previous.decisionNumber + 1
  const bandId = previous.schedulerKey === 'sequential' ? previous.decisionNumber % 36 : (decisionNumber * 17) % 36
  const band = spectrumBands[bandId]
  const rfProbability = Math.max(0.05, Math.min(0.95, band.activity))
  const v3Score = band.priority + 0.12
  const outcome: 'HIT' | 'MISS' = rfProbability > 0.55 ? 'HIT' : 'MISS'
  const decision: SimulationDecision = {
    decisionNumber: previous.decisionNumber,
    simulationTimeSeconds: previous.elapsedSeconds,
    dwellDurationSeconds: 0.05,
    bandId,
    outcome,
    pulseCountObserved: outcome === 'HIT' ? 1 : 0,
    rfProbability,
    v3Score,
    frequencyStartMHz: bandId * 500,
    frequencyEndMHz: (bandId + 1) * 500,
  }
  const bandVisitCounts = { ...(previous.bandVisitCounts ?? {}) }
  const lastVisitTimesSeconds = { ...(previous.lastVisitTimesSeconds ?? {}) }
  bandVisitCounts[String(bandId)] = (bandVisitCounts[String(bandId)] ?? 0) + 1
  lastVisitTimesSeconds[String(bandId)] = previous.elapsedSeconds
  return {
    ...previous,
    status: decisionNumber >= 60 ? 'completed' : 'running',
    elapsedSeconds: previous.elapsedSeconds + 0.05,
    progressPercent: Math.min(100, (decisionNumber / 60) * 100),
    decisionNumber,
    currentBand: bandId,
    selectedBand: { bandId, frequencyStartMHz: bandId * 500, frequencyEndMHz: (bandId + 1) * 500, rfProbability, v3Score },
    lastOutcome: outcome,
    hitMissHistory: [...(previous.hitMissHistory ?? []), outcome],
    latestRfProbabilities: Array.from({ length: 36 }, (_, index) => Math.max(0.05, Math.min(0.95, spectrumBands[index].activity))),
    latestV3Scores: Array.from({ length: 36 }, (_, index) => spectrumBands[index].priority + 0.1),
    topCandidates: spectrumBands.slice(0, 5).map((item, index) => ({ bandId: item.id - 1, frequencyStartMHz: (item.id - 1) * 500, frequencyEndMHz: item.id * 500, rfProbability: item.activity, v3Score: item.priority + 0.1 - index * 0.01 })),
    scanHistory: [...(previous.scanHistory ?? []), decision],
    recentDecisions: [...(previous.recentDecisions ?? []), decision].slice(-10),
    bandVisitCounts,
    lastVisitTimesSeconds,
  }
}

export function createSimulationApi(mock: boolean): Pick<ApiClient, 'uploadScenario' | 'getSimulationState' | 'startSimulation' | 'stepSimulation' | 'pauseSimulation' | 'resetSimulation' | 'getBandScores'> {
  if (!mock) return {
    uploadScenario: async (file) => { const form = new FormData(); form.append('file', file); return mapUpload(await request<BackendScenarioUpload>('/scenarios/upload', { method: 'POST', body: form, headers: {} })) },
    getSimulationState: async (simulationId) => mapSimulationState(await request<BackendSimulationState>(`/simulation/${simulationId}/state`)),
    startSimulation: async (scenarioId, scheduler) => mapSimulationState(await request<BackendSimulationState>('/simulation/start', { method: 'POST', body: JSON.stringify({ scenario_id: scenarioId, scheduler: normalizeScheduler(scheduler) }) })),
    stepSimulation: async (simulationId) => mapSimulationState(await request<BackendSimulationState>(`/simulation/${simulationId}/step`, { method: 'POST' })),
    pauseSimulation: async (simulationId) => mapSimulationState(await request<BackendSimulationState>(`/simulation/${simulationId}/pause`, { method: 'POST' })),
    resetSimulation: async (simulationId) => mapSimulationState(await request<BackendSimulationState>(`/simulation/${simulationId}/reset`, { method: 'POST' })),
    getBandScores: async () => bandScores,
  }
  return {
    uploadScenario: async (file) => { scenario = { id: `mock-${Date.now()}`, filename: file.name, sizeBytes: file.size, status: 'ready', selectedAt: new Date().toISOString(), valid: true, receiverMode: 'Stare', pulseCount: 124820, emitterCount: 18, durationSeconds: 3, frequencyMinMHz: 500, frequencyMaxMHz: 18000, validationMessages: ['Mock H5 structure, feature names, and summary statistics validated'] }; return scenario },
    getSimulationState: async (simulationId) => mockSessions[simulationId] ?? state,
    startSimulation: async (scenarioId, scheduler = 'Smart V3') => { const schedulerKey = normalizeScheduler(scheduler); const simulationId = `mock-sim-${schedulerKey}-${Date.now()}-${Math.round(Math.random() * 1000)}`; state = { status: 'running', simulationId, schedulerKey, scenarioId, scheduler: schedulerKey === 'sequential' ? 'Sequential' : 'Smart V3', elapsedSeconds: 0, progressPercent: 0, decisionNumber: 0, currentBand: null, scanHistory: [], recentDecisions: [], bandVisitCounts: {}, lastVisitTimesSeconds: {} }; mockSessions[simulationId] = state; return state },
    stepSimulation: async (simulationId) => { state = nextMockDecision(mockSessions[simulationId] ?? state); if (state.simulationId) mockSessions[state.simulationId] = state; return state },
    pauseSimulation: async (simulationId) => { state = { ...(mockSessions[simulationId] ?? state), status: 'paused' }; if (state.simulationId) mockSessions[state.simulationId] = state; return state },
    resetSimulation: async (simulationId) => { const previous = mockSessions[simulationId] ?? state; state = { status: 'idle', simulationId: previous.simulationId, schedulerKey: previous.schedulerKey, scenarioId: previous.scenarioId ?? scenario?.id ?? null, scheduler: previous.scheduler, elapsedSeconds: 0, progressPercent: 0, decisionNumber: 0, currentBand: null, scanHistory: [], recentDecisions: [], bandVisitCounts: {}, lastVisitTimesSeconds: {} }; if (state.simulationId) mockSessions[state.simulationId] = state; return state },
    getBandScores: async () => bandScores,
  }
}

export const schedulerOptions: SchedulerName[] = ['Sequential', 'Adaptive V1', 'RF V2', 'Smart V3']
