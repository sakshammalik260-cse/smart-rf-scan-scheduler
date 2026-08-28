export type RFInputMode = 'tsrd_replay' | 'mock_sdr' | 'live_sdr'

export type SDRMode = { id: RFInputMode; name: string; description: string }

export type SDRStatus = {
  inputMode: RFInputMode
  hardwareStatus: 'available' | 'not_detected' | 'disconnected'
  deviceName: string
  connected: boolean
  supportedFrequencyMinHz: number
  supportedFrequencyMaxHz: number
  centerFrequencyHz: number | null
  sampleRateHz: number | null
  observedPowerDbm: number | null
  estimatedNoiseFloorDbm: number | null
  activityDetected: boolean | null
  captureDurationS: number | null
  simulated: boolean
  message: string
}

export type SDRObservation = {
  inputMode: RFInputMode
  deviceName: string
  timestampS: number
  bandId: number | null
  centerFrequencyHz: number
  bandwidthHz: number
  sampleRateHz: number
  dwellTimeS: number
  observedPowerDbm: number
  estimatedNoiseFloorDbm: number
  activityDetected: boolean
  captureDurationS: number
  pulseCount: number
  detectedEvents: unknown[]
  simulated: boolean
  message: string
}

export type MockBand = { bandId: number; lowFrequencyHz: number; highFrequencyHz: number; centerFrequencyHz: number; dwellTimeS: number }
export type SmartMockDecision = { decisionIndex: number; selectedBand: MockBand; rfProbability: number; v3Score: number; observedPowerDbm: number; noiseFloorDbm: number; activityDetected: boolean; pulseCount: number; outcome: 'HIT' | 'MISS'; elapsedTimeS: number; captureDurationS: number }
export type SmartMockState = { status: 'idle' | 'running' | 'completed' | 'error'; decisionIndex: number; elapsedTimeS: number; selectedBand: MockBand | null; lastDecision: SmartMockDecision | null; previousScanWasHit: number; previousScanBandId: number; previousScanPulseCount: number; featureCount: number; candidateCount: number; message: string }