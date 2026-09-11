import type { HardwareReadiness, SDRMode, SDRObservation, SDRStatus, SmartMockState } from './sdr'

export type SchedulerName = 'Sequential' | 'Adaptive V1' | 'RF V2' | 'Smart V3'
export type SimulationSchedulerKey = 'sequential' | 'smart_v3'
export type BackendMode = 'mock' | 'real'

export interface ModelStatus {
  name: string
  version: string
  state: 'frozen' | 'loading' | 'ready' | 'error'
  backendMode: BackendMode
}

export interface UploadedTsrdScenario {
  id: string
  filename: string
  sha256?: string
  sizeBytes: number
  status: 'selected' | 'ready' | 'processing' | 'complete' | 'error'
  selectedAt: string
  valid?: boolean
  pulseCount?: number
  emitterCount?: number
  durationSeconds?: number
  receiverMode?: string
  frequencyMinMHz?: number
  frequencyMaxMHz?: number
  toaMinSeconds?: number
  toaMaxSeconds?: number
  validationMessages?: string[]
  receiverPlan?: {
    bandCount: number
    bandwidthMHz: number
    centresMHz: number[]
    dwellTimesSeconds: number[]
    source: string
  }
}

export interface SimulationState {
  simulationId?: string
  schedulerKey?: SimulationSchedulerKey
  status: 'idle' | 'running' | 'paused' | 'completed' | 'complete' | 'error'
  scenarioId: string | null
  scheduler: SchedulerName
  elapsedSeconds: number
  progressPercent?: number
  decisionNumber: number
  currentBand: number | null
  selectedBand?: SimulationBand | null
  lastOutcome?: 'HIT' | 'MISS' | null
  hitMissHistory?: Array<'HIT' | 'MISS'>
  latestRfProbabilities?: number[]
  latestV3Scores?: number[]
  topCandidates?: SimulationBand[]
  scanHistory?: SimulationDecision[]
  recentDecisions?: SimulationDecision[]
  bandVisitCounts?: Record<string, number>
  lastVisitTimesSeconds?: Record<string, number | null>
  errorMessage?: string
}

export interface SimulationBand {
  bandId: number
  frequencyStartMHz: number
  frequencyEndMHz: number
  rfProbability: number
  v3Score: number
}

export interface SimulationDecision {
  decisionNumber: number
  simulationTimeSeconds: number
  dwellDurationSeconds: number
  bandId: number
  outcome: 'HIT' | 'MISS'
  pulseCountObserved: number
  rfProbability: number
  v3Score: number
  frequencyStartMHz?: number
  frequencyEndMHz?: number
}

export interface ScanDecision {
  decisionNumber: number
  band: number
  frequencyStartGHz: number
  frequencyEndGHz: number
  outcome: 'hit' | 'miss' | 'pending'
  decidedAt: string
}

export interface BandScore {
  band: number
  frequencyStartGHz: number
  frequencyEndGHz: number
  rfProbability: number
  explorationScore: number
  timeSinceVisitSeconds: number
  priorityScore: number
  status: 'selected' | 'candidate' | 'visited'
}

export interface SchedulerMetrics {
  hitRate: number
  missRate: number
  emitterCoverage: number
  averageInterceptionDelaySeconds: number
  scanEntropy: number
}

export interface ModelComparisonResult {
  model: SchedulerName
  metrics: SchedulerMetrics
}

export interface ApiClient {
  getModelStatus(): Promise<ModelStatus>
  getModelComparison(): Promise<ModelComparisonResult[]>
  getSchedulerMetrics(): Promise<SchedulerMetrics>
  getBandScores(): Promise<BandScore[]>
  uploadScenario(file: File): Promise<UploadedTsrdScenario>
  getSimulationState(simulationId: string): Promise<SimulationState>
  startSimulation(scenarioId: string, scheduler?: SchedulerName | SimulationSchedulerKey): Promise<SimulationState>
  stepSimulation(simulationId: string): Promise<SimulationState>
  pauseSimulation(simulationId: string): Promise<SimulationState>
  resetSimulation(simulationId: string): Promise<SimulationState>
  getSdrModes(): Promise<SDRMode[]>
  getSdrStatus(): Promise<SDRStatus>
  connectSdr(): Promise<SDRStatus>
  disconnectSdr(): Promise<SDRStatus>
  setSdrSampleRate(sampleRateHz: number): Promise<SDRStatus>
  tuneSdr(frequencyHz: number): Promise<SDRStatus>
  captureSdr(durationS: number): Promise<SDRObservation>
  getSdrHardwareReadiness(): Promise<HardwareReadiness>
  startSmartMock(durationS?: number): Promise<SmartMockState>
  stepSmartMock(): Promise<SmartMockState>
  resetSmartMock(): Promise<SmartMockState>
  getSmartMockStatus(): Promise<SmartMockState>
}
