import type { ApiClient } from '../types/api'
import type { RFInputMode, SDRMode, SDRObservation, SDRStatus, SmartMockState } from '../types/sdr'
import { request } from './api'

const modeList: SDRMode[] = [
  { id: 'tsrd_replay', name: 'TSRD Replay', description: 'Existing TSRD H5 simulation.' },
  { id: 'mock_sdr', name: 'Mock SDR', description: 'Software simulated SDR - no physical RF measurements.' },
  { id: 'live_sdr', name: 'Live SDR', description: 'Hardware integration placeholder - physical SDR not connected.' },
]

const initialMockStatus: SDRStatus = { inputMode: 'mock_sdr', hardwareStatus: 'disconnected', deviceName: 'Mock SDR (software simulation)', connected: false, supportedFrequencyMinHz: 70e6, supportedFrequencyMaxHz: 6e9, centerFrequencyHz: null, sampleRateHz: null, observedPowerDbm: null, estimatedNoiseFloorDbm: null, activityDetected: null, captureDurationS: null, simulated: true, message: 'Software simulated SDR - no physical RF measurements.' }

function mapStatus(value: Record<string, unknown>): SDRStatus {
  return { inputMode: value.input_mode as RFInputMode, hardwareStatus: value.hardware_status as SDRStatus['hardwareStatus'], deviceName: value.device_name as string, connected: value.connected as boolean, supportedFrequencyMinHz: value.supported_frequency_min_hz as number, supportedFrequencyMaxHz: value.supported_frequency_max_hz as number, centerFrequencyHz: value.center_frequency_hz as number | null, sampleRateHz: value.sample_rate_hz as number | null, observedPowerDbm: value.observed_power_dbm as number | null, estimatedNoiseFloorDbm: value.estimated_noise_floor_dbm as number | null, activityDetected: value.activity_detected as boolean | null, captureDurationS: value.capture_duration_s as number | null, simulated: value.simulated as boolean, message: value.message as string }
}

function mapObservation(value: Record<string, unknown>): SDRObservation {
  return { inputMode: value.input_mode as RFInputMode, deviceName: value.device_name as string, timestampS: value.timestamp_s as number, bandId: value.band_id as number | null, centerFrequencyHz: value.center_frequency_hz as number, bandwidthHz: value.bandwidth_hz as number, sampleRateHz: value.sample_rate_hz as number, dwellTimeS: value.dwell_time_s as number, observedPowerDbm: value.observed_power_dbm as number, estimatedNoiseFloorDbm: value.estimated_noise_floor_dbm as number, activityDetected: value.activity_detected as boolean, captureDurationS: value.capture_duration_s as number, pulseCount: value.pulse_count as number, detectedEvents: [], simulated: value.simulated as boolean, message: value.message as string }
}

function mapSmart(value: Record<string, any>): SmartMockState {
  const mapBand = (item: Record<string, any> | null) => item ? { bandId: item.band_id, lowFrequencyHz: item.low_frequency_hz, highFrequencyHz: item.high_frequency_hz, centerFrequencyHz: item.center_frequency_hz, dwellTimeS: item.dwell_time_s } : null
  const item = value.last_decision
  const decision = item ? { decisionIndex: item.decision_index, selectedBand: mapBand(item.selected_band)!, rfProbability: item.rf_probability, v3Score: item.v3_score, observedPowerDbm: item.observed_power_dbm, noiseFloorDbm: item.noise_floor_dbm, activityDetected: item.activity_detected, pulseCount: item.pulse_count, outcome: item.outcome, elapsedTimeS: item.elapsed_time_s, captureDurationS: item.capture_duration_s } : null
  return { status: value.status, decisionIndex: value.decision_index, elapsedTimeS: value.elapsed_time_s, selectedBand: mapBand(value.selected_band), lastDecision: decision, previousScanWasHit: value.previous_scan_was_hit, previousScanBandId: value.previous_scan_band_id, previousScanPulseCount: value.previous_scan_pulse_count, featureCount: value.feature_count, candidateCount: value.candidate_count, message: value.message }
}

export function createSdrApi(mock: boolean): Pick<ApiClient, 'getSdrModes' | 'getSdrStatus' | 'connectSdr' | 'disconnectSdr' | 'setSdrSampleRate' | 'tuneSdr' | 'captureSdr' | 'startSmartMock' | 'stepSmartMock' | 'resetSmartMock' | 'getSmartMockStatus'> {
  if (mock) {
    let status = { ...initialMockStatus }
    let smartState: SmartMockState = { status: 'idle', decisionIndex: 0, elapsedTimeS: 0, selectedBand: null, lastDecision: null, previousScanWasHit: -1, previousScanBandId: -1, previousScanPulseCount: 0, featureCount: 30, candidateCount: 36, message: 'Frontend mock only - use the real backend for frozen Smart V3 inference.' }
    const mockBand = (bandId: number) => ({ bandId, lowFrequencyHz: (100 + bandId * 150) * 1e6, highFrequencyHz: (250 + bandId * 150) * 1e6, centerFrequencyHz: (175 + bandId * 150) * 1e6, dwellTimeS: bandId % 3 ? 0.05 : 0.1 })
    return {
      getSdrModes: async () => modeList,
      getSdrStatus: async () => status,
      connectSdr: async () => (status = { ...status, connected: true, hardwareStatus: 'available', centerFrequencyHz: 915e6, sampleRateHz: 2.4e6 }),
      disconnectSdr: async () => (status = { ...status, connected: false, hardwareStatus: 'disconnected', centerFrequencyHz: null, sampleRateHz: null }),
      setSdrSampleRate: async (sampleRateHz) => (status = { ...status, sampleRateHz }),
      tuneSdr: async (frequencyHz) => (status = { ...status, centerFrequencyHz: frequencyHz, observedPowerDbm: null, activityDetected: null }),
      captureSdr: async (durationS) => { const activityDetected = Math.sin((status.centerFrequencyHz ?? 915e6) / 1e9 * Math.PI) > 0.15; const observation: SDRObservation = { inputMode: 'mock_sdr', deviceName: status.deviceName, timestampS: 0, bandId: null, centerFrequencyHz: status.centerFrequencyHz ?? 915e6, bandwidthHz: 500e6, sampleRateHz: status.sampleRateHz ?? 2.4e6, dwellTimeS: durationS, observedPowerDbm: activityDetected ? -54 : -87, estimatedNoiseFloorDbm: -92, activityDetected, captureDurationS: durationS, pulseCount: activityDetected ? 2 : 0, detectedEvents: [], simulated: true, message: status.message }; status = { ...status, observedPowerDbm: observation.observedPowerDbm, estimatedNoiseFloorDbm: observation.estimatedNoiseFloorDbm, activityDetected, captureDurationS: durationS }; return observation },
      startSmartMock: async () => (smartState = { ...smartState, status: 'running', decisionIndex: 0, elapsedTimeS: 0, selectedBand: null, lastDecision: null, message: 'Frontend mock only - use the real backend for frozen Smart V3 inference.' }),
      stepSmartMock: async () => { const band = mockBand(smartState.decisionIndex % 36); const activityDetected = band.bandId % 4 === 0; const dwell = band.dwellTimeS; const decision = { decisionIndex: smartState.decisionIndex, selectedBand: band, rfProbability: activityDetected ? 0.82 : 0.18, v3Score: activityDetected ? 0.91 : 0.31, observedPowerDbm: activityDetected ? -54 : -87, noiseFloorDbm: -92, activityDetected, pulseCount: activityDetected ? 2 : 0, outcome: activityDetected ? 'HIT' as const : 'MISS' as const, elapsedTimeS: smartState.elapsedTimeS, captureDurationS: dwell }; smartState = { ...smartState, decisionIndex: smartState.decisionIndex + 1, elapsedTimeS: smartState.elapsedTimeS + dwell, selectedBand: band, lastDecision: decision, previousScanWasHit: activityDetected ? 1 : 0, previousScanBandId: band.bandId, previousScanPulseCount: activityDetected ? 2 : 0 }; return smartState },
      resetSmartMock: async () => (smartState = { ...smartState, status: 'idle', decisionIndex: 0, elapsedTimeS: 0, selectedBand: null, lastDecision: null, previousScanWasHit: -1, previousScanBandId: -1, previousScanPulseCount: 0 }),
      getSmartMockStatus: async () => smartState,
    }
  }
  return { getSdrModes: async () => (await request<{ modes: Array<Record<string, string>> }>('/sdr/modes')).modes.map((mode) => ({ id: mode.id as RFInputMode, name: mode.name, description: mode.description })), getSdrStatus: async () => mapStatus(await request<Record<string, unknown>>('/sdr/status')), connectSdr: async () => mapStatus(await request<Record<string, unknown>>('/sdr/connect', { method: 'POST' })), disconnectSdr: async () => mapStatus(await request<Record<string, unknown>>('/sdr/disconnect', { method: 'POST' })), setSdrSampleRate: async (sampleRateHz) => mapStatus(await request<Record<string, unknown>>('/sdr/sample-rate', { method: 'POST', body: JSON.stringify({ sample_rate_hz: sampleRateHz }) })), tuneSdr: async (frequencyHz) => mapStatus(await request<Record<string, unknown>>('/sdr/tune', { method: 'POST', body: JSON.stringify({ frequency_hz: frequencyHz }) })), captureSdr: async (durationS) => mapObservation(await request<Record<string, unknown>>('/sdr/capture', { method: 'POST', body: JSON.stringify({ duration_s: durationS }) })), startSmartMock: async (durationS = 60) => mapSmart(await request<Record<string, any>>('/sdr/smart/start', { method: 'POST', body: JSON.stringify({ scenario_duration_s: durationS }) })), stepSmartMock: async () => mapSmart(await request<Record<string, any>>('/sdr/smart/step', { method: 'POST' })), resetSmartMock: async () => mapSmart(await request<Record<string, any>>('/sdr/smart/reset', { method: 'POST' })), getSmartMockStatus: async () => mapSmart(await request<Record<string, any>>('/sdr/smart/status')) }
}