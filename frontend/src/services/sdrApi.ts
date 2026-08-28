import type { ApiClient } from '../types/api'
import type {
  BandPlanValidationReport,
  CaptureMetadata,
  DeviceCapabilities,
  HardwareReadiness,
  MockBand,
  RFInputMode,
  SDRDeviceDescriptor,
  SDRMode,
  SDRObservation,
  SDRStatus,
  SmartMockState,
} from '../types/sdr'
import { request } from './api'

const modeList: SDRMode[] = [
  { id: 'tsrd_replay', name: 'TSRD Replay', description: 'Existing TSRD H5 simulation.' },
  { id: 'mock_sdr', name: 'Mock SDR', description: 'Software simulated SDR - no physical RF measurements.' },
  { id: 'live_sdr', name: 'Live SDR', description: 'SDR hardware not detected. The hardware integration layer is ready.' },
]

const initialMockStatus: SDRStatus = {
  inputMode: 'mock_sdr',
  hardwareStatus: 'disconnected',
  deviceName: 'Mock SDR (software simulation)',
  connected: false,
  supportedFrequencyMinHz: 70e6,
  supportedFrequencyMaxHz: 6e9,
  centerFrequencyHz: null,
  sampleRateHz: null,
  bandwidthHz: null,
  observedPowerDbm: null,
  estimatedNoiseFloorDbm: null,
  activityDetected: null,
  captureDurationS: null,
  simulated: true,
  message: 'Software simulated SDR - no physical RF measurements.',
}

function mapStatus(value: Record<string, unknown>): SDRStatus {
  return {
    inputMode: value.input_mode as RFInputMode,
    hardwareStatus: value.hardware_status as SDRStatus['hardwareStatus'],
    deviceName: value.device_name as string,
    connected: value.connected as boolean,
    supportedFrequencyMinHz: value.supported_frequency_min_hz as number,
    supportedFrequencyMaxHz: value.supported_frequency_max_hz as number,
    centerFrequencyHz: value.center_frequency_hz as number | null,
    sampleRateHz: value.sample_rate_hz as number | null,
    bandwidthHz: value.bandwidth_hz as number | null,
    observedPowerDbm: value.observed_power_dbm as number | null,
    estimatedNoiseFloorDbm: value.estimated_noise_floor_dbm as number | null,
    activityDetected: value.activity_detected as boolean | null,
    captureDurationS: value.capture_duration_s as number | null,
    simulated: value.simulated as boolean,
    message: value.message as string,
  }
}

function mapCaptureMetadata(value: Record<string, unknown> | null | undefined): CaptureMetadata | null {
  if (!value) return null
  return {
    requestedCenterFrequencyHz: value.requested_center_frequency_hz as number | null,
    actualCenterFrequencyHz: value.actual_center_frequency_hz as number | null,
    requestedSampleRateHz: value.requested_sample_rate_hz as number | null,
    actualSampleRateHz: value.actual_sample_rate_hz as number | null,
    requestedBandwidthHz: value.requested_bandwidth_hz as number | null,
    actualBandwidthHz: value.actual_bandwidth_hz as number | null,
    requestedDwellDurationS: value.requested_dwell_duration_s as number | null,
    actualCaptureDurationS: value.actual_capture_duration_s as number | null,
    captureTimestampS: value.capture_timestamp_s as number | null,
    tuningLatencyS: value.tuning_latency_s as number | null,
    settlingDurationS: value.settling_duration_s as number | null,
    droppedSamples: value.dropped_samples as number | null,
    overflow: value.overflow as boolean | null,
    simulated: value.simulated as boolean,
    driverName: value.driver_name as string,
    deviceId: value.device_id as string,
    deviceName: value.device_name as string,
  }
}

function mapObservation(value: Record<string, unknown>): SDRObservation {
  return {
    inputMode: value.input_mode as RFInputMode,
    deviceName: value.device_name as string,
    timestampS: value.timestamp_s as number,
    bandId: value.band_id as number | null,
    centerFrequencyHz: value.center_frequency_hz as number,
    bandwidthHz: value.bandwidth_hz as number,
    sampleRateHz: value.sample_rate_hz as number,
    dwellTimeS: value.dwell_time_s as number,
    observedPowerDbm: value.observed_power_dbm as number,
    estimatedNoiseFloorDbm: value.estimated_noise_floor_dbm as number,
    activityDetected: value.activity_detected as boolean,
    captureDurationS: value.capture_duration_s as number,
    pulseCount: value.pulse_count as number,
    detectedEvents: [],
    captureMetadata: mapCaptureMetadata(value.capture_metadata as Record<string, unknown> | null),
    simulated: value.simulated as boolean,
    message: value.message as string,
  }
}

function mapBand(item: Record<string, any> | null): MockBand | null {
  return item
    ? {
        bandId: item.band_id,
        lowFrequencyHz: item.low_frequency_hz,
        highFrequencyHz: item.high_frequency_hz,
        centerFrequencyHz: item.center_frequency_hz,
        bandwidthHz: item.bandwidth_hz,
        dwellTimeS: item.dwell_time_s,
        enabled: item.enabled,
      }
    : null
}

function mapSmart(value: Record<string, any>): SmartMockState {
  const item = value.last_decision
  const decision = item
    ? {
        decisionIndex: item.decision_index,
        selectedBand: mapBand(item.selected_band)!,
        rfProbability: item.rf_probability,
        v3Score: item.v3_score,
        observedPowerDbm: item.observed_power_dbm,
        noiseFloorDbm: item.noise_floor_dbm,
        activityDetected: item.activity_detected,
        pulseCount: item.pulse_count,
        outcome: item.outcome,
        elapsedTimeS: item.elapsed_time_s,
        captureDurationS: item.capture_duration_s,
      }
    : null
  return {
    status: value.status,
    decisionIndex: value.decision_index,
    elapsedTimeS: value.elapsed_time_s,
    selectedBand: mapBand(value.selected_band),
    lastDecision: decision,
    previousScanWasHit: value.previous_scan_was_hit,
    previousScanBandId: value.previous_scan_band_id,
    previousScanPulseCount: value.previous_scan_pulse_count,
    featureCount: value.feature_count,
    candidateCount: value.candidate_count,
    message: value.message,
  }
}

function mapDevice(value: Record<string, unknown>): SDRDeviceDescriptor {
  return {
    deviceId: value.device_id as string,
    deviceName: value.device_name as string,
    driverName: value.driver_name as string,
    inputMode: value.input_mode as RFInputMode,
    driverAvailable: value.driver_available as boolean,
    connected: value.connected as boolean,
    simulated: value.simulated as boolean,
    receiveSupported: value.receive_supported as boolean,
    transmitSupported: value.transmit_supported as boolean,
    hardwareStatus: value.hardware_status as SDRDeviceDescriptor['hardwareStatus'],
    message: value.message as string,
  }
}

function mapCapabilities(value: Record<string, unknown>): DeviceCapabilities {
  return {
    deviceId: value.device_id as string,
    deviceName: value.device_name as string,
    driverName: value.driver_name as string,
    manufacturer: value.manufacturer as string | null,
    connected: value.connected as boolean,
    simulated: value.simulated as boolean,
    receiveSupported: value.receive_supported as boolean,
    transmitSupported: value.transmit_supported as boolean,
    minFrequencyHz: value.min_frequency_hz as number | null,
    maxFrequencyHz: value.max_frequency_hz as number | null,
    minSampleRateHz: value.min_sample_rate_hz as number | null,
    maxSampleRateHz: value.max_sample_rate_hz as number | null,
    supportedSampleRatesHz: value.supported_sample_rates_hz as number[] | null,
    maxBandwidthHz: value.max_bandwidth_hz as number | null,
    recommendedBandwidthHz: value.recommended_bandwidth_hz as number | null,
    currentCenterFrequencyHz: value.current_center_frequency_hz as number | null,
    currentSampleRateHz: value.current_sample_rate_hz as number | null,
    currentBandwidthHz: value.current_bandwidth_hz as number | null,
    serial: value.serial as string | null,
    metadata: value.metadata as Record<string, unknown>,
    warnings: value.warnings as string[],
  }
}

function mapValidation(value: Record<string, any>): BandPlanValidationReport {
  return {
    deviceId: value.device_id,
    compatible: value.compatible,
    errors: value.errors,
    warnings: value.warnings,
    usableBandCount: value.usable_band_count,
    rejectedBands: value.rejected_bands.map((item: Record<string, any>) => ({ bandId: item.band_id, reasons: item.reasons })),
    deviceFrequencyCoverageHz: {
      minFrequencyHz: value.device_frequency_coverage_hz.min_frequency_hz,
      maxFrequencyHz: value.device_frequency_coverage_hz.max_frequency_hz,
    },
    requestedFrequencyCoverageHz: {
      minFrequencyHz: value.requested_frequency_coverage_hz.min_frequency_hz,
      maxFrequencyHz: value.requested_frequency_coverage_hz.max_frequency_hz,
    },
    simulated: value.simulated,
  }
}

async function getSdrHardwareReadiness(): Promise<HardwareReadiness> {
  const [devices, capabilities, bandPlan, validation] = await Promise.all([
    request<{ devices: Array<Record<string, unknown>> }>('/sdr/devices'),
    request<{ capabilities: Array<Record<string, unknown>> }>('/sdr/capabilities'),
    request<{ bands: Array<Record<string, any>> }>('/sdr/band-plan'),
    request<Record<string, any>>('/sdr/band-plan/validate', { method: 'POST', body: JSON.stringify({ device_id: 'mock_sdr' }) }),
  ])
  return {
    devices: devices.devices.map(mapDevice),
    capabilities: capabilities.capabilities.map(mapCapabilities),
    bands: bandPlan.bands.map((item) => mapBand(item)!),
    validation: mapValidation(validation),
  }
}

function mockReadiness(status: SDRStatus): HardwareReadiness {
  const bands = Array.from({ length: 36 }, (_, bandId) => ({
    bandId,
    lowFrequencyHz: (100 + bandId * 150) * 1e6,
    highFrequencyHz: (250 + bandId * 150) * 1e6,
    centerFrequencyHz: (175 + bandId * 150) * 1e6,
    bandwidthHz: 150e6,
    dwellTimeS: bandId % 3 ? 0.05 : 0.1,
    enabled: true,
  }))
  const devices: SDRDeviceDescriptor[] = [
    { deviceId: 'mock_sdr', deviceName: status.deviceName, driverName: 'mock_sdr', inputMode: 'mock_sdr', driverAvailable: true, connected: status.connected, simulated: true, receiveSupported: true, transmitSupported: false, hardwareStatus: status.hardwareStatus, message: 'Software simulated SDR - no physical RF measurements.' },
    { deviceId: 'rtl_sdr', deviceName: 'RTL-SDR', driverName: 'rtl_sdr', inputMode: 'live_sdr', driverAvailable: false, connected: false, simulated: false, receiveSupported: true, transmitSupported: false, hardwareStatus: 'driver_not_installed', message: 'Physical SDR driver not installed.' },
    { deviceId: 'hackrf', deviceName: 'HackRF', driverName: 'hackrf', inputMode: 'live_sdr', driverAvailable: false, connected: false, simulated: false, receiveSupported: true, transmitSupported: true, hardwareStatus: 'driver_not_installed', message: 'Physical SDR driver not installed.' },
    { deviceId: 'plutosdr', deviceName: 'PlutoSDR', driverName: 'plutosdr', inputMode: 'live_sdr', driverAvailable: false, connected: false, simulated: false, receiveSupported: true, transmitSupported: true, hardwareStatus: 'driver_not_installed', message: 'Physical SDR driver not installed.' },
  ]
  const capabilities: DeviceCapabilities[] = [{
    deviceId: 'mock_sdr',
    deviceName: status.deviceName,
    driverName: 'mock_sdr',
    manufacturer: 'SMART V4',
    connected: status.connected,
    simulated: true,
    receiveSupported: true,
    transmitSupported: false,
    minFrequencyHz: 70e6,
    maxFrequencyHz: 6e9,
    minSampleRateHz: 250e3,
    maxSampleRateHz: 20e6,
    supportedSampleRatesHz: null,
    maxBandwidthHz: 500e6,
    recommendedBandwidthHz: 150e6,
    currentCenterFrequencyHz: status.centerFrequencyHz,
    currentSampleRateHz: status.sampleRateHz,
    currentBandwidthHz: status.bandwidthHz,
    serial: null,
    metadata: {},
    warnings: ['Software-simulated observation path; no physical RF measurements are produced.'],
  }]
  return {
    devices,
    capabilities,
    bands,
    validation: {
      deviceId: 'mock_sdr',
      compatible: true,
      errors: [],
      warnings: capabilities[0].warnings,
      usableBandCount: bands.length,
      rejectedBands: [],
      deviceFrequencyCoverageHz: { minFrequencyHz: 70e6, maxFrequencyHz: 6e9 },
      requestedFrequencyCoverageHz: { minFrequencyHz: 100e6, maxFrequencyHz: 5.5e9 },
      simulated: true,
    },
  }
}

export function createSdrApi(mock: boolean): Pick<ApiClient, 'getSdrModes' | 'getSdrStatus' | 'connectSdr' | 'disconnectSdr' | 'setSdrSampleRate' | 'tuneSdr' | 'captureSdr' | 'getSdrHardwareReadiness' | 'startSmartMock' | 'stepSmartMock' | 'resetSmartMock' | 'getSmartMockStatus'> {
  if (mock) {
    let status = { ...initialMockStatus }
    let smartState: SmartMockState = { status: 'idle', decisionIndex: 0, elapsedTimeS: 0, selectedBand: null, lastDecision: null, previousScanWasHit: -1, previousScanBandId: -1, previousScanPulseCount: 0, featureCount: 30, candidateCount: 36, message: 'Frontend mock only - use the real backend for frozen Smart V3 inference.' }
    const mockBand = (bandId: number) => ({ bandId, lowFrequencyHz: (100 + bandId * 150) * 1e6, highFrequencyHz: (250 + bandId * 150) * 1e6, centerFrequencyHz: (175 + bandId * 150) * 1e6, bandwidthHz: 150e6, dwellTimeS: bandId % 3 ? 0.05 : 0.1, enabled: true })
    return {
      getSdrModes: async () => modeList,
      getSdrStatus: async () => status,
      connectSdr: async () => (status = { ...status, connected: true, hardwareStatus: 'available', centerFrequencyHz: 915e6, sampleRateHz: 2.4e6, bandwidthHz: 500e6 }),
      disconnectSdr: async () => (status = { ...status, connected: false, hardwareStatus: 'disconnected', centerFrequencyHz: null, sampleRateHz: null, bandwidthHz: null }),
      setSdrSampleRate: async (sampleRateHz) => (status = { ...status, sampleRateHz }),
      tuneSdr: async (frequencyHz) => (status = { ...status, centerFrequencyHz: frequencyHz, observedPowerDbm: null, activityDetected: null }),
      captureSdr: async (durationS) => {
        const activityDetected = Math.sin((status.centerFrequencyHz ?? 915e6) / 1e9 * Math.PI) > 0.15
        const observation: SDRObservation = { inputMode: 'mock_sdr', deviceName: status.deviceName, timestampS: 0, bandId: null, centerFrequencyHz: status.centerFrequencyHz ?? 915e6, bandwidthHz: status.bandwidthHz ?? 500e6, sampleRateHz: status.sampleRateHz ?? 2.4e6, dwellTimeS: durationS, observedPowerDbm: activityDetected ? -54 : -87, estimatedNoiseFloorDbm: -92, activityDetected, captureDurationS: durationS, pulseCount: activityDetected ? 2 : 0, detectedEvents: [], captureMetadata: null, simulated: true, message: status.message }
        status = { ...status, observedPowerDbm: observation.observedPowerDbm, estimatedNoiseFloorDbm: observation.estimatedNoiseFloorDbm, activityDetected, captureDurationS: durationS }
        return observation
      },
      getSdrHardwareReadiness: async () => mockReadiness(status),
      startSmartMock: async () => (smartState = { ...smartState, status: 'running', decisionIndex: 0, elapsedTimeS: 0, selectedBand: null, lastDecision: null, message: 'Frontend mock only - use the real backend for frozen Smart V3 inference.' }),
      stepSmartMock: async () => {
        const band = mockBand(smartState.decisionIndex % 36)
        const activityDetected = band.bandId % 4 === 0
        const dwell = band.dwellTimeS
        const decision = { decisionIndex: smartState.decisionIndex, selectedBand: band, rfProbability: activityDetected ? 0.82 : 0.18, v3Score: activityDetected ? 0.91 : 0.31, observedPowerDbm: activityDetected ? -54 : -87, noiseFloorDbm: -92, activityDetected, pulseCount: activityDetected ? 2 : 0, outcome: activityDetected ? 'HIT' as const : 'MISS' as const, elapsedTimeS: smartState.elapsedTimeS, captureDurationS: dwell }
        smartState = { ...smartState, decisionIndex: smartState.decisionIndex + 1, elapsedTimeS: smartState.elapsedTimeS + dwell, selectedBand: band, lastDecision: decision, previousScanWasHit: activityDetected ? 1 : 0, previousScanBandId: band.bandId, previousScanPulseCount: activityDetected ? 2 : 0 }
        return smartState
      },
      resetSmartMock: async () => (smartState = { ...smartState, status: 'idle', decisionIndex: 0, elapsedTimeS: 0, selectedBand: null, lastDecision: null, previousScanWasHit: -1, previousScanBandId: -1, previousScanPulseCount: 0 }),
      getSmartMockStatus: async () => smartState,
    }
  }
  return {
    getSdrModes: async () => (await request<{ modes: Array<Record<string, string>> }>('/sdr/modes')).modes.map((mode) => ({ id: mode.id as RFInputMode, name: mode.name, description: mode.description })),
    getSdrStatus: async () => mapStatus(await request<Record<string, unknown>>('/sdr/status')),
    connectSdr: async () => mapStatus(await request<Record<string, unknown>>('/sdr/connect', { method: 'POST' })),
    disconnectSdr: async () => mapStatus(await request<Record<string, unknown>>('/sdr/disconnect', { method: 'POST' })),
    setSdrSampleRate: async (sampleRateHz) => mapStatus(await request<Record<string, unknown>>('/sdr/sample-rate', { method: 'POST', body: JSON.stringify({ sample_rate_hz: sampleRateHz }) })),
    tuneSdr: async (frequencyHz) => mapStatus(await request<Record<string, unknown>>('/sdr/tune', { method: 'POST', body: JSON.stringify({ frequency_hz: frequencyHz }) })),
    captureSdr: async (durationS) => mapObservation(await request<Record<string, unknown>>('/sdr/capture', { method: 'POST', body: JSON.stringify({ duration_s: durationS }) })),
    getSdrHardwareReadiness,
    startSmartMock: async (durationS = 60) => mapSmart(await request<Record<string, any>>('/sdr/smart/start', { method: 'POST', body: JSON.stringify({ scenario_duration_s: durationS }) })),
    stepSmartMock: async () => mapSmart(await request<Record<string, any>>('/sdr/smart/step', { method: 'POST' })),
    resetSmartMock: async () => mapSmart(await request<Record<string, any>>('/sdr/smart/reset', { method: 'POST' })),
    getSmartMockStatus: async () => mapSmart(await request<Record<string, any>>('/sdr/smart/status')),
  }
}
