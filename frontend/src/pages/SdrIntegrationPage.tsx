import { useEffect, useState } from 'react'
import { Cable, CircleOff, Radio, RefreshCw, SlidersHorizontal, Wifi } from 'lucide-react'
import { Panel } from '../components/Panel'
import { SectionHeader } from '../components/SectionHeader'
import { api } from '../services/api'
import type { RFInputMode, SDRMode, SDRStatus, SmartMockState } from '../types/sdr'

const emptyStatus: SDRStatus = { inputMode: 'live_sdr', hardwareStatus: 'not_detected', deviceName: 'Live SDR hardware', connected: false, supportedFrequencyMinHz: 0, supportedFrequencyMaxHz: 0, centerFrequencyHz: null, sampleRateHz: null, observedPowerDbm: null, estimatedNoiseFloorDbm: null, activityDetected: null, captureDurationS: null, simulated: false, message: 'Hardware integration placeholder - physical SDR not connected.' }

function ghz(value: number | null): string { return value === null ? 'Not available' : `${(value / 1e9).toFixed(3)} GHz` }
function mhz(value: number | null): string { return value === null ? 'Not available' : `${(value / 1e6).toFixed(2)} MS/s` }
function dbm(value: number | null): string { return value === null ? 'Not available' : `${value.toFixed(1)} dBm` }

export function SdrIntegrationPage() {
  const [modes, setModes] = useState<SDRMode[]>([])
  const [mode, setMode] = useState<RFInputMode>('mock_sdr')
  const [status, setStatus] = useState<SDRStatus>(emptyStatus)
  const [frequency, setFrequency] = useState('915')
  const [sampleRate, setSampleRate] = useState('2.4')
  const [duration, setDuration] = useState('0.25')
  const [error, setError] = useState('')
  const [smartState, setSmartState] = useState<SmartMockState | null>(null)

  useEffect(() => { api.getSdrModes().then(setModes).catch((reason: Error) => setError(reason.message)); api.getSdrStatus().then(setStatus).catch((reason: Error) => setError(reason.message)) }, [])

  const run = async (action: () => Promise<SDRStatus>) => { try { setError(''); setStatus(await action()) } catch (reason) { setError(reason instanceof Error ? reason.message : 'SDR request failed') } }
  const selectMode = (nextMode: RFInputMode) => { setMode(nextMode); setError(''); if (nextMode === 'live_sdr') setStatus(emptyStatus); else if (nextMode === 'tsrd_replay') setStatus({ ...emptyStatus, inputMode: nextMode, hardwareStatus: 'available', deviceName: 'TSRD H5 Replay', simulated: true, message: 'Uses the existing TSRD H5 simulation.' }); else api.getSdrStatus().then(setStatus).catch((reason: Error) => setError(reason.message)) }
  const connect = () => mode === 'mock_sdr' ? run(api.connectSdr) : setError('TSRD Replay does not require a device connection.')
  const capture = async () => { try { setError(''); const observation = await api.captureSdr(Number(duration)); setStatus((current) => ({ ...current, observedPowerDbm: observation.observedPowerDbm, estimatedNoiseFloorDbm: observation.estimatedNoiseFloorDbm, activityDetected: observation.activityDetected, captureDurationS: observation.captureDurationS })) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Capture failed') } }
  const selectedMode = modes.find((item) => item.id === mode)
  const live = mode === 'live_sdr'
  const replay = mode === 'tsrd_replay'
  const runSmart = async (action: () => Promise<SmartMockState>) => { try { setError(''); setSmartState(await action()) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Closed-loop request failed') } }

  return <div className="space-y-7">
    <SectionHeader eyebrow="RF Input / Phase 1" title="SDR Integration" detail="A receive-only hardware boundary for TSRD replay, software simulation, and future physical SDR drivers." />
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
        {live ? <div className="mt-8 border border-[#573536] bg-[#241719] p-5"><CircleOff className="text-[#e79a9a]" size={22} /><p className="mt-3 text-sm text-[#e6e1da]">Hardware integration placeholder - physical SDR not connected.</p><p className="mt-2 text-xs leading-relaxed text-[#b99c9c]">SDR hardware not detected. Software integration layer is ready. Connect a supported SDR receiver to begin hardware-in-the-loop scanning.</p></div> : replay ? <div className="mt-8 border border-[#3a3c40] bg-[#17191d] p-5"><Radio className="text-[#d8bd73]" size={22} /><p className="mt-3 text-sm text-[#e6e1da]">This mode uses the existing TSRD H5 simulation.</p><p className="mt-2 text-xs text-[#89878a]">Use Live Spectrum for the established Smart V3 replay workflow.</p></div> : <div className="mt-6 space-y-4">
          <button type="button" onClick={status.connected ? () => run(api.disconnectSdr) : connect} className="flex w-full items-center justify-center gap-2 bg-[#d94a4a] px-4 py-3 text-sm font-semibold text-white hover:bg-[#bd3d3d]"><Wifi size={16} />{status.connected ? 'Disconnect Mock SDR' : 'Connect Mock SDR'}</button>
          <label className="block text-xs text-[#89878a]">Center frequency (GHz)<input value={frequency} onChange={(event) => setFrequency(event.target.value)} className="mt-2 w-full border border-[#34363c] bg-[#111216] px-3 py-2 text-sm text-[#e6e1da]" type="number" min="0.07" max="6" step="0.001" /></label>
          <button type="button" disabled={!status.connected} onClick={() => run(() => api.tuneSdr(Number(frequency) * 1e9))} className="w-full border border-[#4c4e55] px-4 py-2 text-xs text-[#c8c4bd] disabled:cursor-not-allowed disabled:opacity-40">Tune receiver</button>
          <label className="block text-xs text-[#89878a]">Sample rate (MS/s)<input value={sampleRate} onChange={(event) => setSampleRate(event.target.value)} className="mt-2 w-full border border-[#34363c] bg-[#111216] px-3 py-2 text-sm text-[#e6e1da]" type="number" min="0.25" max="20" step="0.1" /></label>
          <button type="button" disabled={!status.connected} onClick={() => run(() => api.setSdrSampleRate(Number(sampleRate) * 1e6))} className="w-full border border-[#4c4e55] px-4 py-2 text-xs text-[#c8c4bd] disabled:cursor-not-allowed disabled:opacity-40">Apply sample rate</button>
          <div className="flex gap-3"><input value={duration} onChange={(event) => setDuration(event.target.value)} className="min-w-0 flex-1 border border-[#34363c] bg-[#111216] px-3 py-2 text-sm text-[#e6e1da]" type="number" min="0.001" max="60" step="0.01" /><button type="button" disabled={!status.connected} onClick={capture} className="flex items-center gap-2 border border-[#d94a4a] px-4 py-2 text-xs text-[#e6e1da] disabled:cursor-not-allowed disabled:opacity-40"><RefreshCw size={14} />Capture</button></div>
        </div>}
        {error && <p className="mt-5 text-sm text-[#e79a9a]">{error}</p>}
      </Panel>

      <Panel className="p-5 sm:p-7"><div className="flex items-center justify-between"><div><p className="section-kicker">Receiver observation</p><h3 className="mt-2 font-display text-xl text-[#e6e1da]">Current device state</h3></div><SlidersHorizontal className="text-[#67e8c5]" size={22} /></div><div className="mt-6 grid grid-cols-2 gap-px border border-[#303238] bg-[#303238] sm:grid-cols-3">{[['Hardware Status', status.hardwareStatus], ['Device Name', status.deviceName], ['Connection Status', status.connected ? 'Connected' : 'Disconnected'], ['Supported Frequency Range', status.supportedFrequencyMaxHz ? `${ghz(status.supportedFrequencyMinHz)} - ${ghz(status.supportedFrequencyMaxHz)}` : 'Device-specific'], ['Center Frequency', ghz(status.centerFrequencyHz)], ['Sample Rate', mhz(status.sampleRateHz)], ['Observed Power', dbm(status.observedPowerDbm)], ['Noise Floor', dbm(status.estimatedNoiseFloorDbm)], ['Activity Detected', status.activityDetected === null ? 'Not available' : status.activityDetected ? 'Yes' : 'No'], ['Capture / Scan Time', status.captureDurationS === null ? 'Not available' : `${status.captureDurationS.toFixed(3)} s`]].map(([label, value]) => <div key={label} className="min-h-[82px] bg-[#111216] p-4"><p className="text-[10px] uppercase tracking-[0.13em] text-[#6e7078]">{label}</p><p className="mt-2 break-words text-sm text-[#e6e1da]">{value}</p></div>)}</div><p className="mt-5 text-xs leading-relaxed text-[#a6a19a]">{status.message}</p></Panel>
    </div>
    <Panel className="p-5 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="section-kicker">Experimental closed loop</p><h3 className="mt-2 font-display text-xl text-[#e6e1da]">Smart V3 + Mock SDR Closed Loop</h3><p className="mt-2 text-xs text-[#e79a9a]">Software-simulated SDR closed loop - not a physical RF measurement.</p></div><div className="flex gap-2"><button type="button" onClick={() => runSmart(api.startSmartMock)} className="border border-[#67e8c5] px-4 py-2 text-xs text-[#d7eee7]">Start</button><button type="button" disabled={!smartState || smartState.status !== 'running'} onClick={() => runSmart(api.stepSmartMock)} className="border border-[#4c4e55] px-4 py-2 text-xs text-[#c8c4bd] disabled:opacity-40">Step</button><button type="button" onClick={() => runSmart(api.resetSmartMock)} className="border border-[#4c4e55] px-4 py-2 text-xs text-[#c8c4bd]">Reset</button></div></div>
      <div className="mt-6 grid gap-2 text-center text-[11px] uppercase tracking-[0.12em] text-[#a6a19a] sm:grid-cols-5"><div className="border border-[#303238] p-4">Smart V3</div><div className="self-center text-[#d94a4a]">↓</div><div className="border border-[#303238] p-4">Selected Band</div><div className="self-center text-[#d94a4a]">↓</div><div className="border border-[#303238] p-4">Synthetic Observation → History → Next Decision</div></div>
      {smartState?.lastDecision && <div className="mt-6 grid grid-cols-2 gap-px border border-[#303238] bg-[#303238] sm:grid-cols-4">{[['Selected band', `#${smartState.lastDecision.selectedBand.bandId}`], ['Frequency', ghz(smartState.lastDecision.selectedBand.centerFrequencyHz)], ['RF probability', `${(smartState.lastDecision.rfProbability * 100).toFixed(1)}%`], ['V3 score', smartState.lastDecision.v3Score.toFixed(4)], ['Outcome', smartState.lastDecision.outcome], ['Pulse count', String(smartState.lastDecision.pulseCount)], ['Power', dbm(smartState.lastDecision.observedPowerDbm)], ['Noise floor', dbm(smartState.lastDecision.noiseFloorDbm)], ['Decision index', String(smartState.lastDecision.decisionIndex)], ['Elapsed', `${smartState.elapsedTimeS.toFixed(3)} s`]].map(([label, value]) => <div key={label} className="bg-[#111216] p-4"><p className="text-[10px] uppercase tracking-[0.13em] text-[#6e7078]">{label}</p><p className="mt-2 text-sm text-[#e6e1da]">{value}</p></div>)}</div>}
      {smartState && <p className="mt-5 text-xs text-[#89878a]">{smartState.message}</p>}
    </Panel>
  </div>
}