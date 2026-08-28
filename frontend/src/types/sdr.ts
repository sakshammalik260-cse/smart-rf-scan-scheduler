export type RFInputMode = 'tsrd_replay' | 'mock_sdr' | 'live_sdr'
export type HardwareStatus = 'available' | 'not_detected' | 'disconnected' | 'driver_not_installed' | 'connected'

export type SDRMode = { id: RFInputMode; name: string; description: string }

export type SDRStatus = {
  inputMode: RFInputMode
  hardwareStatus: HardwareStatus
  deviceName: string
  connected: boolean
  supportedFrequencyMinHz: number
  supportedFrequencyMaxHz: number
  centerFrequencyHz: number | null
  sampleRateHz: number | null
  bandwidthHz: number | null
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
  captureMetadata: CaptureMetadata | null
  simulated: boolean
  message: string
}

export type CaptureMetadata = {
  requestedCenterFrequencyHz: number | null
  actualCenterFrequencyHz: number | null
  requestedSampleRateHz: number | null
  actualSampleRateHz: number | null
  requestedBandwidthHz: number | null
  actualBandwidthHz: number | null
  requestedDwellDurationS: number | null
  actualCaptureDurationS: number | null
  captureTimestampS: number | null
  tuningLatencyS: number | null
  settlingDurationS: number | null
  droppedSamples: number | null
  overflow: boolean | null
  simulated: boolean
  driverName: string
  deviceId: string
  deviceName: string
}

export type MockBand = { bandId: number; lowFrequencyHz: number; highFrequencyHz: number; centerFrequencyHz: number; bandwidthHz: number | null; dwellTimeS: number; enabled: boolean }
export type DeviceCapabilities = {
  deviceId: string
  deviceName: string
  driverName: string
  manufacturer: string | null
  connected: boolean
  simulated: boolean
  receiveSupported: boolean
  transmitSupported: boolean
  minFrequencyHz: number | null
  maxFrequencyHz: number | null
  minSampleRateHz: number | null
  maxSampleRateHz: number | null
  supportedSampleRatesHz: number[] | null
  maxBandwidthHz: number | null
  recommendedBandwidthHz: number | null
  currentCenterFrequencyHz: number | null
  currentSampleRateHz: number | null
  currentBandwidthHz: number | null
  serial: string | null
  metadata: Record<string, unknown>
  warnings: string[]
}
export type SDRDeviceDescriptor = {
  deviceId: string
  deviceName: string
  driverName: string
  inputMode: RFInputMode
  driverAvailable: boolean
  connected: boolean
  simulated: boolean
  receiveSupported: boolean
  transmitSupported: boolean
  hardwareStatus: HardwareStatus
  message: string
}
export type BandPlanValidationReport = {
  deviceId: string
  compatible: boolean
  errors: string[]
  warnings: string[]
  usableBandCount: number
  rejectedBands: Array<{ bandId: number; reasons: string[] }>
  deviceFrequencyCoverageHz: { minFrequencyHz: number | null; maxFrequencyHz: number | null }
  requestedFrequencyCoverageHz: { minFrequencyHz: number | null; maxFrequencyHz: number | null }
  simulated: boolean
}
export type HardwareReadiness = { devices: SDRDeviceDescriptor[]; capabilities: DeviceCapabilities[]; bands: MockBand[]; validation: BandPlanValidationReport }
export type SmartMockDecision = { decisionIndex: number; selectedBand: MockBand; rfProbability: number; v3Score: number; observedPowerDbm: number; noiseFloorDbm: number; activityDetected: boolean; pulseCount: number; outcome: 'HIT' | 'MISS'; elapsedTimeS: number; captureDurationS: number }
export type SmartMockState = { status: 'idle' | 'running' | 'completed' | 'error'; decisionIndex: number; elapsedTimeS: number; selectedBand: MockBand | null; lastDecision: SmartMockDecision | null; previousScanWasHit: number; previousScanBandId: number; previousScanPulseCount: number; featureCount: number; candidateCount: number; message: string }
