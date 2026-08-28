import { useEffect, useState } from 'react'
import { AlertTriangle, Cable, CheckCircle2, CircleOff, Cpu, Radio, RefreshCw, SlidersHorizontal, Wifi } from 'lucide-react'
import { Panel } from '../components/Panel'
import { SectionHeader } from '../components/SectionHeader'
import { api } from '../services/api'
import type { HardwareReadiness, RFInputMode, SDRMode, SDRStatus, SmartMockState } from '../types/sdr'

const emptyStatus: SDRStatus = {
  inputMode: 'live_sdr',
  hardwareStatus: 'not_detected',
  deviceName: 'Live SDR hardware',
  connected: false,
  supportedFrequencyMinHz: 0,
  supportedFrequencyMaxHz: 0,
  centerFrequencyHz: null,
  sampleRateHz: null,
  bandwidthHz: null,
  observedPowerDbm: null,
  estimatedNoiseFloorDbm: null,
  activityDetected: null,
  captureDurationS: null,
  simulated: false,
  message: 'SDR hardware not detected. The hardware integration layer is ready. Connect and configure a supported receive-only SDR device to begin hardware-in-the-loop scanning.',
}

function ghz(value: number | null): string { return value === null ? 'Not available' : `${(value / 1e9).toFixed(3)} GHz` }
function rate(value: number | null): string { return value === null ? 'Not available' : `${(value / 1e6).toFixed(2)} MS/s` }
function bandwidth(value: number | null): string { return value === null ? 'Not available' : `${(value / 1e6).toFixed(1)} MHz` }
function dbm(value: number | null): string { return value === null ? 'Not available' : `${value.toFixed(1)} dBm` }
function range(min: number | null, max: number | null, formatter: (value: number | null) => string): string {
  return min === null || max === null ? 'Not available' : `${formatter(min)} - ${formatter(max)}`
}

export function SdrIntegrationPage() {
  const [modes, setModes] = useState<SDRMode[]>([])
  const [mode, setMode] = useState<RFInputMode>('mock_sdr')
  const [status, setStatus] = useState<SDRStatus>(emptyStatus)
  const [readiness, setReadiness] = useState<HardwareReadiness | null>(null)
  const [frequency, setFrequency] = useState('915')
  const [sampleRate, setSampleRate] = useState('2.4')
  const [duration, setDuration] = useState('0.25')
  const [error, setError] = useState('')
  const [smartState, setSmartState] = useState<SmartMockState | null>(null)

  const refreshReadiness = () => api.getSdrHardwareReadiness().then(setReadiness).catch((reason: Error) => setError(reason.message))

  useEffect(() => {
    api.getSdrModes().then(setModes).catch((reason: Error) => setError(reason.message))
    api.getSdrStatus().then(setStatus).catch((reason: Error) => setError(reason.message))
    refreshReadiness()
  }, [])

  const run = async (action: () => Promise<SDRStatus>) => {
    try {
      setError('')
      setStatus(await action())
      await refreshReadiness()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'SDR request failed')
    }
  }
  const selectMode = (nextMode: RFInputMode) => {
    setMode(nextMode)
    setError('')
    if (nextMode === 'live_sdr') setStatus(emptyStatus)
    else if (nextMode === 'tsrd_replay') setStatus({ ...emptyStatus, inputMode: nextMode, hardwareStatus: 'available', deviceName: 'TSRD H5 Replay', simulated: true, message: 'Uses the existing TSRD H5 simulation.' })
    else api.getSdrStatus().then(setStatus).catch((reason: Error) => setError(reason.message))
  }
  const connect = () => mode === 'mock_sdr' ? run(api.connectSdr) : setError('TSRD Replay does not require a device connection.')
  const capture = async () => {
    try {
      setError('')
      const observation = await api.captureSdr(Number(duration))
      setStatus((current) => ({ ...current, observedPowerDbm: observation.observedPowerDbm, estimatedNoiseFloorDbm: observation.estimatedNoiseFloorDbm, activityDetected: observation.activityDetected, captureDurationS: observation.captureDurationS }))
      await refreshReadiness()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Capture failed')
    }
  }
  const runSmart = async (action: () => Promise<SmartMockState>) => {
    try {
      setError('')
      setSmartState(await action())
      await refreshReadiness()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Closed-loop request failed')
    }
  }

  const selectedMode = modes.find((item) => item.id === mode)
  const live = mode === 'live_sdr'
  const replay = mode === 'tsrd_replay'
  const activeCapabilities = readiness?.capabilities.find((item) => item.deviceId === 'mock_sdr') ?? null
  const validation = readiness?.validation ?? null
  const enabledBands = readiness?.bands.filter((band) => band.enabled).length ?? 0

  return <div className="space-y-7">
    <SectionHeader eyebrow="RF Input / Phase 3" title="SDR Integration" detail="A receive-only hardware boundary for TSRD replay, software simulation, and future physical SDR drivers." />
    <Panel className="p-5 sm:p-7">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="section-kicker">Input source</p><h3 className="mt-2 font-display text-xl text-[#e6e1da]">Choose the receiver observation path</h3></div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="RF input mode">
          {modes.map((item) => <button key={item.id} type="button" onClick={() => selectMode(item.id)} aria-pressed={mode === item.id} className={`border px-4 py-3 text-left transition-colors ${mode === item.id ? 'border-[#d94a4a] bg-[#2a1719] text-[#f0d6cf]' : 'border-[#303238] text-[#89878a] hover:border-[#676871]'}`}><span className="block text-sm">{item.name}</span><span className="mt-1 block max-w-[190px] text-[11px] text-[#89878a]">{item.description}</span></button>)}
        </div>
      </div>
      {selectedMode && <p className="mt-5 border-l-2 border-[#d94a4a] pl-3 text-sm text-[#b9b5ae]">{selectedMode.description}</p>}
    </Panel>

    <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
      <Panel className="p-5 sm:p-7">
        <div className="flex items-center justify-between"><div><p className="section-kicker">Device controls</p><h3 className="mt-2 font-display text-xl text-[#e6e1da]">Receiver command surface</h3></div><Cable className="text-[#d94a4a]" size={22} /></div>
        {live ? <div className="mt-8 border border-[#573536] bg-[#241719] p-5"><CircleOff className="text-[#e79a9a]" size={22} /><p className="mt-3 text-sm text-[#e6e1da]">Hardware integration architecture ready.</p><p className="mt-2 text-xs leading-relaxed text-[#b99c9c]">SDR hardware not detected. The hardware integration layer is ready. Connect and configure a supported receive-only SDR device to begin hardware-in-the-loop scanning.</p></div> : replay ? <div className="mt-8 border border-[#3a3c40] bg-[#17191d] p-5"><Radio className="text-[#d8bd73]" size={22} /><p className="mt-3 text-sm text-[#e6e1da]">This mode uses the existing TSRD H5 simulation.</p><p className="mt-2 text-xs text-[#89878a]">Use Live Spectrum for the established Smart V3 replay workflow.</p></div> : <div className="mt-6 space-y-4">
          <button type="button" onClick={status.connected ? () => run(api.disconnectSdr) : connect} className="flex w-full items-center justify-center gap-2 bg-[#d94a4a] px-4 py-3 text-sm font-semibold text-white hover:bg-[#bd3d3d]"><Wifi size={16} />{status.connected ? 'Disconnect Mock SDR' : 'Connect Mock SDR'}</button>
          <label className="block text-xs text-[#89878a]">Center frequency (GHz)<input value={frequency} onChange={(event) => setFrequency(event.target.value)} className="mt-2 w-full border border-[#34363c] bg-[#111216] px-3 py-2 text-sm text-[#e6e1da]" type="number" min="0.07" max="6" step="0.001" /></label>
          <button type="button" disabled={!status.connected} onClick={() => run(() => api.tuneSdr(Number(frequency) * 1e9))} className="w-full border border-[#4c4e55] px-4 py-2 text-xs text-[#c8c4bd] disabled:cursor-not-allowed disabled:opacity-40">Tune receiver</button>
          <label className="block text-xs text-[#89878a]">Sample rate (MS/s)<input value={sampleRate} onChange={(event) => setSampleRate(event.target.value)} className="mt-2 w-full border border-[#34363c] bg-[#111216] px-3 py-2 text-sm text-[#e6e1da]" type="number" min="0.25" max="20" step="0.1" /></label>
          <button type="button" disabled={!status.connected} onClick={() => run(() => api.setSdrSampleRate(Number(sampleRate) * 1e6))} className="w-full border border-[#4c4e55] px-4 py-2 text-xs text-[#c8c4bd] disabled:cursor-not-allowed disabled:opacity-40">Apply sample rate</button>
          <div className="flex gap-3"><input value={duration} onChange={(event) => setDuration(event.target.value)} className="min-w-0 flex-1 border border-[#34363c] bg-[#111216] px-3 py-2 text-sm text-[#e6e1da]" type="number" min="0.001" max="60" step="0.01" /><button type="button" disabled={!status.connected} onClick={capture} className="flex items-center gap-2 border border-[#d94a4a] px-4 py-2 text-xs text-[#e6e1da] disabled:cursor-not-allowed disabled:opacity-40"><RefreshCw size={14} />Capture</button></div>
        </div>}
        {error && <p className="mt-5 text-sm text-[#e79a9a]">{error}</p>}
      </Panel>

      <Panel className="p-5 sm:p-7">
        <div className="flex items-center justify-between"><div><p className="section-kicker">Receiver observation</p><h3 className="mt-2 font-display text-xl text-[#e6e1da]">Current device state</h3></div><SlidersHorizontal className="text-[#67e8c5]" size={22} /></div>
        <div className="mt-6 grid grid-cols-2 gap-px border border-[#303238] bg-[#303238] sm:grid-cols-3">
          {[
            ['Hardware Status', status.hardwareStatus],
            ['Device Name', status.deviceName],
            ['Connection Status', status.connected ? 'Connected' : 'Disconnected'],
            ['Supported Frequency Range', status.supportedFrequencyMaxHz ? `${ghz(status.supportedFrequencyMinHz)} - ${ghz(status.supportedFrequencyMaxHz)}` : 'Device-specific'],
            ['Center Frequency', ghz(status.centerFrequencyHz)],
            ['Sample Rate', rate(status.sampleRateHz)],
            ['Bandwidth', bandwidth(status.bandwidthHz)],
            ['Observed Power', dbm(status.observedPowerDbm)],
            ['Noise Floor', dbm(status.estimatedNoiseFloorDbm)],
            ['Activity Detected', status.activityDetected === null ? 'Not available' : status.activityDetected ? 'Yes' : 'No'],
            ['Capture / Scan Time', status.captureDurationS === null ? 'Not available' : `${status.captureDurationS.toFixed(3)} s`],
          ].map(([label, value]) => <div key={label} className="min-h-[82px] bg-[#111216] p-4"><p className="text-[10px] uppercase tracking-[0.13em] text-[#6e7078]">{label}</p><p className="mt-2 break-words text-sm text-[#e6e1da]">{value}</p></div>)}
        </div>
        <p className="mt-5 text-xs leading-relaxed text-[#a6a19a]">{status.message}</p>
      </Panel>
    </div>

    <Panel className="p-5 sm:p-7">
      <div className="flex items-center justify-between"><div><p className="section-kicker">Hardware Readiness</p><h3 className="mt-2 font-display text-xl text-[#e6e1da]">Receive-only SDR boundary</h3></div><Cpu className="text-[#67e8c5]" size={22} /></div>
      <div className="mt-6 grid gap-5 xl:grid-cols-3">
        <div>
          <p className="section-kicker">Device</p>
          <div className="mt-3 grid gap-2">
            {(readiness?.devices ?? []).map((device) => <div key={device.deviceId} className="border border-[#303238] bg-[#111216] p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="text-sm text-[#e6e1da]">{device.deviceName}</p><p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-[#6e7078]">{device.driverName}</p></div><span className={`text-[11px] ${device.driverAvailable ? 'text-[#67e8c5]' : 'text-[#e79a9a]'}`}>{device.driverAvailable ? 'Driver available' : 'Driver not installed'}</span></div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[#a6a19a]"><span>{device.connected ? 'Connected' : 'Disconnected'}</span><span>{device.simulated ? 'Software-simulated' : 'Physical'}</span><span>RX {device.receiveSupported ? 'ready' : 'unavailable'}</span><span>TX {device.transmitSupported ? 'informational' : 'none'}</span></div>
              <p className="mt-3 text-xs text-[#89878a]">{device.message}</p>
            </div>)}
          </div>
        </div>
        <div>
          <p className="section-kicker">Band plan</p>
          <div className="mt-3 grid grid-cols-2 gap-px border border-[#303238] bg-[#303238]">
            {[
              ['Enabled bands', String(enabledBands)],
              ['Requested coverage', validation ? range(validation.requestedFrequencyCoverageHz.minFrequencyHz, validation.requestedFrequencyCoverageHz.maxFrequencyHz, ghz) : 'Loading'],
              ['Device coverage', activeCapabilities ? range(activeCapabilities.minFrequencyHz, activeCapabilities.maxFrequencyHz, ghz) : 'Loading'],
              ['Sample-rate range', activeCapabilities ? range(activeCapabilities.minSampleRateHz, activeCapabilities.maxSampleRateHz, rate) : 'Loading'],
              ['Current frequency', activeCapabilities ? ghz(activeCapabilities.currentCenterFrequencyHz) : 'Loading'],
              ['Current sample rate', activeCapabilities ? rate(activeCapabilities.currentSampleRateHz) : 'Loading'],
            ].map(([label, value]) => <div key={label} className="min-h-[74px] bg-[#111216] p-4"><p className="text-[10px] uppercase tracking-[0.13em] text-[#6e7078]">{label}</p><p className="mt-2 break-words text-sm text-[#e6e1da]">{value}</p></div>)}
          </div>
          {validation && <div className={`mt-3 border p-4 ${validation.compatible ? 'border-[#2e6558] bg-[#10201d]' : 'border-[#573536] bg-[#241719]'}`}>
            <div className="flex items-center gap-2 text-sm text-[#e6e1da]">{validation.compatible ? <CheckCircle2 className="text-[#67e8c5]" size={16} /> : <AlertTriangle className="text-[#e79a9a]" size={16} />}{validation.compatible ? 'Compatible' : 'Incompatible'}</div>
            {[...validation.errors, ...validation.warnings].slice(0, 4).map((item) => <p key={item} className="mt-2 text-xs text-[#a6a19a]">{item}</p>)}
          </div>}
        </div>
        <div>
          <p className="section-kicker">Capture pipeline</p>
          <div className="mt-3 grid gap-2 text-xs uppercase tracking-[0.12em] text-[#a6a19a]">
            {['Device', 'Tune', 'Settle', 'Capture', 'Event Extraction', 'Receiver History', 'Smart V3'].map((step, index) => <div key={step} className="flex items-center gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center border border-[#303238] text-[#e6e1da]">{index + 1}</span><span className="border border-[#303238] bg-[#111216] px-3 py-2">{step}</span></div>)}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-[#89878a]">Hardware-in-the-loop support planned. Physical SDR drivers are not installed, and no physical RF receiver is shown as connected.</p>
        </div>
      </div>
    </Panel>

    <Panel className="p-5 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="section-kicker">Experimental closed loop</p><h3 className="mt-2 font-display text-xl text-[#e6e1da]">Smart V3 + Mock SDR Closed Loop</h3><p className="mt-2 text-xs text-[#e79a9a]">Software-simulated SDR closed loop - not a physical RF measurement.</p></div><div className="flex gap-2"><button type="button" onClick={() => runSmart(api.startSmartMock)} className="border border-[#67e8c5] px-4 py-2 text-xs text-[#d7eee7]">Start</button><button type="button" disabled={!smartState || smartState.status !== 'running'} onClick={() => runSmart(api.stepSmartMock)} className="border border-[#4c4e55] px-4 py-2 text-xs text-[#c8c4bd] disabled:opacity-40">Step</button><button type="button" onClick={() => runSmart(api.resetSmartMock)} className="border border-[#4c4e55] px-4 py-2 text-xs text-[#c8c4bd]">Reset</button></div></div>
      <div className="mt-6 grid gap-2 text-center text-[11px] uppercase tracking-[0.12em] text-[#a6a19a] sm:grid-cols-5"><div className="border border-[#303238] p-4">Smart V3</div><div className="self-center text-[#d94a4a]">-&gt;</div><div className="border border-[#303238] p-4">Selected Band</div><div className="self-center text-[#d94a4a]">-&gt;</div><div className="border border-[#303238] p-4">Synthetic Observation -&gt; History -&gt; Next Decision</div></div>
      {smartState?.lastDecision && <div className="mt-6 grid grid-cols-2 gap-px border border-[#303238] bg-[#303238] sm:grid-cols-4">{[['Selected band', `#${smartState.lastDecision.selectedBand.bandId}`], ['Frequency', ghz(smartState.lastDecision.selectedBand.centerFrequencyHz)], ['RF probability', `${(smartState.lastDecision.rfProbability * 100).toFixed(1)}%`], ['V3 score', smartState.lastDecision.v3Score.toFixed(4)], ['Outcome', smartState.lastDecision.outcome], ['Pulse count', String(smartState.lastDecision.pulseCount)], ['Power', dbm(smartState.lastDecision.observedPowerDbm)], ['Noise floor', dbm(smartState.lastDecision.noiseFloorDbm)], ['Decision index', String(smartState.lastDecision.decisionIndex)], ['Elapsed', `${smartState.elapsedTimeS.toFixed(3)} s`]].map(([label, value]) => <div key={label} className="bg-[#111216] p-4"><p className="text-[10px] uppercase tracking-[0.13em] text-[#6e7078]">{label}</p><p className="mt-2 text-sm text-[#e6e1da]">{value}</p></div>)}</div>}
      {smartState && <p className="mt-5 text-xs text-[#89878a]">{smartState.message}</p>}
    </Panel>
  </div>
}
