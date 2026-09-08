import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Activity, Aperture, Cable, CircleOff, Crosshair, Eye, Power, Radar, RefreshCw, SlidersHorizontal } from 'lucide-react'
import { api } from '../services/api'
import type { CommandTarget } from '../types/rfCommand'
import type { HardwareReadiness, MockBand, RFInputMode, SDRMode, SDRObservation, SDRStatus, SmartMockState } from '../types/sdr'

const RfCommandScene = lazy(() => import('../components/RfCommandScene').then((module) => ({ default: module.RfCommandScene })))

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

const pipeline = ['DEVICE', 'TUNE', 'SETTLE', 'CAPTURE', 'EVENT EXTRACTION', 'RECEIVER HISTORY', 'SMART V3']

function ghz(value: number | null): string { return value === null ? 'Not available' : `${(value / 1e9).toFixed(3)} GHz` }
function mhz(value: number | null): string { return value === null ? 'Not available' : `${(value / 1e6).toFixed(3)} MHz` }
function msps(value: number | null): string { return value === null ? 'Not available' : `${(value / 1e6).toFixed(3)} MS/s` }
function dbm(value: number | null): string { return value === null ? 'Not available' : `${value.toFixed(1)} dBm` }
function seconds(value: number | null): string { return value === null ? 'Not available' : `${value.toFixed(3)} s` }
function range(min: number | null, max: number | null, formatter: (value: number | null) => string): string {
  return min === null || max === null ? 'Not available' : `${formatter(min)} - ${formatter(max)}`
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

export function SdrIntegrationPage({ motionPaused = false }: { motionPaused?: boolean }) {
  const [modes, setModes] = useState<SDRMode[]>([])
  const [mode, setMode] = useState<RFInputMode>('mock_sdr')
  const [status, setStatus] = useState<SDRStatus>(emptyStatus)
  const [readiness, setReadiness] = useState<HardwareReadiness | null>(null)
  const [frequency, setFrequency] = useState('915')
  const [sampleRate, setSampleRate] = useState('2.4')
  const [duration, setDuration] = useState('0.25')
  const [error, setError] = useState('')
  const [smartState, setSmartState] = useState<SmartMockState | null>(null)
  const [lastObservation, setLastObservation] = useState<SDRObservation | null>(null)
  const [effectsEnabled, setEffectsEnabled] = useState(true)
  const [selectedTarget, setSelectedTarget] = useState<CommandTarget | null>(null)
  const [hoveredTarget, setHoveredTarget] = useState<CommandTarget | null>(null)
  const [tooltipPoint, setTooltipPoint] = useState({ x: 0, y: 0 })
  const reducedMotion = useReducedMotion()

  const refreshReadiness = () => api.getSdrHardwareReadiness().then(setReadiness).catch((reason: Error) => setError(reason.message))

  useEffect(() => {
    api.getSdrModes().then(setModes).catch((reason: Error) => setError(reason.message))
    api.getSdrStatus().then((value) => {
      setStatus(value)
      setFrequency(value.centerFrequencyHz ? String(value.centerFrequencyHz / 1e6) : '915')
      setSampleRate(value.sampleRateHz ? String(value.sampleRateHz / 1e6) : '2.4')
    }).catch((reason: Error) => setError(reason.message))
    refreshReadiness()
  }, [])

  const selectedBand = useMemo(() => {
    const closedLoopBand = smartState?.lastDecision?.selectedBand
    if (closedLoopBand) return closedLoopBand
    const tunedHz = status.centerFrequencyHz
    const bands = readiness?.bands ?? []
    return bands.find((band) => tunedHz !== null && band.lowFrequencyHz <= tunedHz && tunedHz <= band.highFrequencyHz) ?? bands[0] ?? null
  }, [readiness?.bands, smartState?.lastDecision?.selectedBand, status.centerFrequencyHz])

  const htmlTargets = useMemo(() => buildHtmlTargets(readiness, status, smartState), [readiness, status, smartState])

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
  const capture = async () => {
    try {
      setError('')
      const observation = await api.captureSdr(Number(duration))
      setLastObservation(observation)
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
  const showTarget = (target: CommandTarget | null, point?: { x: number; y: number }) => {
    setHoveredTarget(target)
    if (point) setTooltipPoint(point)
  }
  const focusTarget = (target: CommandTarget) => {
    setHoveredTarget(target)
    setTooltipPoint({ x: window.innerWidth * 0.5, y: 140 })
  }

  const live = mode === 'live_sdr'
  const replay = mode === 'tsrd_replay'
  const activeDevice = readiness?.devices.find((device) => device.deviceId === 'mock_sdr')
  const compatibility = readiness?.validation.compatible ? 'COMPATIBLE' : 'PENDING'
  const inspectionTarget = selectedTarget ?? hoveredTarget ?? (selectedBand ? bandTarget(selectedBand, readiness) : htmlTargets[0])
  const tooltipTarget = hoveredTarget

  return <div className="rf-command-center">
    <section className="rf-topbar" aria-label="SMART V4 command state">
      <div>
        <p className="rf-kicker">SMART V4</p>
        <h1>RF COMMAND CENTER</h1>
      </div>
      <div className="rf-topbar-metrics">
        <div className="rf-mode-switch" role="radiogroup" aria-label="RF input mode">
          {modes.map((item) => <button key={item.id} type="button" aria-pressed={mode === item.id} onClick={() => selectMode(item.id)} title={item.description}>{item.name}</button>)}
        </div>
        <StatusChip label="Input mode" value={mode.replace('_', ' ').toUpperCase()} icon={<Radar size={15} />} />
        <StatusChip label="Receiver state" value={status.connected ? 'MOCK SDR CONNECTED' : live ? 'HARDWARE NOT DETECTED' : 'DISCONNECTED'} icon={<Cable size={15} />} />
        <StatusChip label="Compatibility" value={compatibility} icon={<Aperture size={15} />} />
        <button type="button" className="rf-effects-toggle" aria-pressed={effectsEnabled} onClick={() => setEffectsEnabled((enabled) => !enabled)}>
          <Eye size={15} /> FX {effectsEnabled ? 'ON' : 'OFF'}
        </button>
      </div>
    </section>

    <section className="rf-mission-strip" aria-label="Current RF command summary">
      <div><span>Selected band</span><strong>{selectedBand ? `BAND ${String(selectedBand.bandId).padStart(2, '0')}` : 'NONE'}</strong></div>
      <div><span>Center frequency</span><strong>{selectedBand ? mhz(selectedBand.centerFrequencyHz) : ghz(status.centerFrequencyHz)}</strong></div>
      <div><span>Bandwidth</span><strong>{selectedBand ? mhz(selectedBand.bandwidthHz) : mhz(status.bandwidthHz)}</strong></div>
      <div><span>Observation</span><strong>{status.activityDetected === null ? 'WAITING' : status.activityDetected ? 'ACTIVITY DETECTED' : 'QUIET'}</strong></div>
      <div><span>Hardware boundary</span><strong>{live ? 'READY / NOT DETECTED' : 'RX ONLY'}</strong></div>
    </section>

    <section className="rf-command-layout">
      <aside className="rf-hud-panel rf-left-hud" aria-label="Selected RF inspection">
        <p className="rf-kicker">Selected inspection</p>
        <h2>{inspectionTarget?.label ?? 'RF OBJECT'}</h2>
        <p className="rf-status-code">{inspectionTarget?.status ?? 'READY'}</p>
        <p className="rf-hud-summary">{inspectionTarget?.summary ?? 'Select a band, device, or processing stage.'}</p>
        <dl className="rf-meter-grid">
          {(inspectionTarget?.metadata ?? defaultInspection(status, selectedBand, lastObservation)).map((item) => <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>)}
        </dl>
        <div className="rf-command-actions">
          <button type="button" disabled={status.connected || replay || live} onClick={() => run(api.connectSdr)}><Power size={15} />Connect Mock SDR</button>
          <button type="button" disabled={!status.connected || replay || live} onClick={() => run(api.disconnectSdr)}><CircleOff size={15} />Disconnect</button>
        </div>
        <label>Center frequency MHz<input value={frequency} onChange={(event) => setFrequency(event.target.value)} type="number" min="70" max="6000" step="1" /></label>
        <button type="button" disabled={!status.connected || replay || live} onClick={() => run(() => api.tuneSdr(Number(frequency) * 1e6))}><Crosshair size={15} />Tune Receiver</button>
        <label>Sample rate MS/s<input value={sampleRate} onChange={(event) => setSampleRate(event.target.value)} type="number" min="0.25" max="20" step="0.1" /></label>
        <button type="button" disabled={!status.connected || replay || live} onClick={() => run(() => api.setSdrSampleRate(Number(sampleRate) * 1e6))}><SlidersHorizontal size={15} />Apply Sample Rate</button>
        <div className="rf-inline-control">
          <input aria-label="Capture dwell duration seconds" value={duration} onChange={(event) => setDuration(event.target.value)} type="number" min="0.001" max="60" step="0.01" />
          <button type="button" disabled={!status.connected || replay || live} onClick={capture}><RefreshCw size={15} />Capture</button>
        </div>
        {error && <p className="rf-error">{error}</p>}
      </aside>

      <div className="rf-viewport-shell">
        <Suspense fallback={<div className="rf-scene-loading">Loading RF operations table</div>}>
          <RfCommandScene
            readiness={readiness}
            status={status}
            smartState={smartState}
            selectedTargetId={inspectionTarget?.id ?? ''}
            hoveredTargetId={hoveredTarget?.id ?? null}
            effectsEnabled={effectsEnabled}
            reducedMotion={reducedMotion || motionPaused}
            onHover={showTarget}
            onSelect={setSelectedTarget}
          />
        </Suspense>
        {tooltipTarget && <div className="rf-tooltip" style={{ left: Math.min(tooltipPoint.x + 18, window.innerWidth - 290), top: Math.max(84, tooltipPoint.y - 18) }} role="tooltip">
          <p>{tooltipTarget.label}</p>
          <strong>{tooltipTarget.status}</strong>
          <span>{tooltipTarget.summary}</span>
        </div>}
      </div>

      <aside className="rf-hud-panel rf-right-hud" aria-label="SDR device readiness">
        <p className="rf-kicker">Device registry</p>
        <h2>Receiver inventory</h2>
        <div className="rf-device-list">
          {(readiness?.devices ?? []).map((device) => {
            const target = htmlTargets.find((item) => item.id === `device-${device.deviceId}`)!
            return <button key={device.deviceId} type="button" onFocus={() => focusTarget(target)} onBlur={() => setHoveredTarget(null)} onMouseEnter={() => focusTarget(target)} onMouseLeave={() => setHoveredTarget(null)} onClick={() => setSelectedTarget(target)} className={inspectionTarget?.id === target.id ? 'rf-device-card rf-selected' : 'rf-device-card'}>
              <span>{device.deviceName}</span>
              <strong>{device.driverAvailable ? device.connected ? 'CONNECTED' : 'DISCONNECTED' : 'DRIVER NOT INSTALLED'}</strong>
              <em>{device.simulated ? 'SIMULATION' : 'PHYSICAL PLACEHOLDER'}</em>
            </button>
          })}
        </div>
        <div className="rf-capability-strip">
          <span>Frequency {range(activeDevice?.deviceId === 'mock_sdr' ? status.supportedFrequencyMinHz : null, activeDevice?.deviceId === 'mock_sdr' ? status.supportedFrequencyMaxHz : null, ghz)}</span>
          <span>Sample rate {msps(status.sampleRateHz)}</span>
          <span>Bandwidth {mhz(status.bandwidthHz)}</span>
        </div>
      </aside>
    </section>

    <section className="rf-band-console" aria-label="Keyboard selectable frequency bands">
      <div className="rf-band-header">
        <div><p className="rf-kicker">Band plan</p><h2>{readiness?.bands.filter((band) => band.enabled).length ?? 0} enabled sectors</h2></div>
        <p>{readiness?.validation.compatible ? 'Compatible with Mock SDR simulation' : 'Awaiting compatibility report'}</p>
      </div>
      <div className="rf-band-grid">
        {(readiness?.bands ?? []).map((band) => {
          const target = htmlTargets.find((item) => item.id === `band-${band.bandId}`) ?? bandTarget(band, readiness)
          return <button key={band.bandId} type="button" className={inspectionTarget?.id === target.id ? 'rf-band-button rf-selected' : 'rf-band-button'} onFocus={() => focusTarget(target)} onBlur={() => setHoveredTarget(null)} onMouseEnter={() => focusTarget(target)} onMouseLeave={() => setHoveredTarget(null)} onClick={() => setSelectedTarget(target)}>
            <span>BAND {String(band.bandId).padStart(2, '0')}</span>
            <strong>{mhz(band.centerFrequencyHz)}</strong>
            <em>{target.status}</em>
          </button>
        })}
      </div>
    </section>

    <section className="rf-pipeline" aria-label="Receive-only capture pipeline">
      {pipeline.map((step, index) => {
        const target = htmlTargets.find((item) => item.id === `pipeline-${index}`)!
        return <button key={step} type="button" className={inspectionTarget?.id === target.id ? 'rf-pipeline-step rf-selected' : 'rf-pipeline-step'} onFocus={() => focusTarget(target)} onBlur={() => setHoveredTarget(null)} onMouseEnter={() => focusTarget(target)} onMouseLeave={() => setHoveredTarget(null)} onClick={() => setSelectedTarget(target)}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <strong>{step}</strong>
          <em>{target.status}</em>
        </button>
      })}
    </section>

    <section className="rf-smart-panel" aria-label="Smart V3 simulated closed loop">
      <div>
        <p className="rf-kicker">Smart V3 output</p>
        <h2>Mock SDR closed loop</h2>
        <p>Software-simulated observation path. No physical RF measurement is claimed.</p>
      </div>
      <div className="rf-smart-actions">
        <button type="button" onClick={() => runSmart(api.startSmartMock)}><Activity size={15} />Start</button>
        <button type="button" disabled={!smartState || smartState.status !== 'running'} onClick={() => runSmart(api.stepSmartMock)}>Step</button>
        <button type="button" onClick={() => runSmart(api.resetSmartMock)}>Reset</button>
      </div>
      {smartState?.lastDecision && <dl className="rf-smart-readout">
        <div><dt>Selected band</dt><dd>#{smartState.lastDecision.selectedBand.bandId}</dd></div>
        <div><dt>Center</dt><dd>{mhz(smartState.lastDecision.selectedBand.centerFrequencyHz)}</dd></div>
        <div><dt>RF probability</dt><dd>{(smartState.lastDecision.rfProbability * 100).toFixed(1)}%</dd></div>
        <div><dt>V3 score</dt><dd>{smartState.lastDecision.v3Score.toFixed(4)}</dd></div>
        <div><dt>Outcome</dt><dd>{smartState.lastDecision.outcome}</dd></div>
        <div><dt>Power</dt><dd>{dbm(smartState.lastDecision.observedPowerDbm)}</dd></div>
      </dl>}
    </section>
  </div>
}

function StatusChip({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return <div className="rf-status-chip">{icon}<span>{label}</span><strong>{value}</strong></div>
}

function buildHtmlTargets(readiness: HardwareReadiness | null, status: SDRStatus, smartState: SmartMockState | null): CommandTarget[] {
  const targets: CommandTarget[] = [{
    id: 'core-receiver',
    kind: 'core',
    label: 'RECEIVE CORE',
    status: status.connected ? 'MOCK SDR CONNECTED' : 'RECEIVE ONLY',
    summary: 'Smart V4 accepts receiver observations only.',
    metadata: defaultInspection(status, null, null),
  }]
  targets.push(...(readiness?.bands ?? []).map((band) => bandTarget(band, readiness)))
  targets.push(...(readiness?.devices ?? []).map((device) => ({
    id: `device-${device.deviceId}`,
    kind: 'device' as const,
    label: device.deviceName.toUpperCase(),
    status: device.driverAvailable ? device.connected ? 'CONNECTED' : 'DISCONNECTED' : 'DRIVER NOT INSTALLED',
    summary: device.simulated ? 'Simulation receiver path' : 'Physical SDR driver placeholder.',
    metadata: [
      { label: 'Driver', value: device.driverName },
      { label: 'Availability', value: device.driverAvailable ? 'Driver available' : 'Driver not installed' },
      { label: 'Connection', value: device.connected ? 'Connected' : 'Disconnected' },
      { label: 'Mode', value: device.simulated ? 'Simulation' : 'Physical' },
      { label: 'Receive', value: device.receiveSupported ? 'Supported' : 'Unavailable' },
      { label: 'Transmit', value: device.transmitSupported ? 'Informational only' : 'Not exposed' },
    ],
  })))
  targets.push(...pipeline.map((step, index) => ({
    id: `pipeline-${index}`,
    kind: 'pipeline' as const,
    label: step,
    status: pipelineStatus(step, status, smartState),
    summary: 'Receive-only command path from SDR device to Smart V3.',
    metadata: [
      { label: 'Stage', value: String(index + 1) },
      { label: 'Contract', value: 'RX observation only' },
      { label: 'State', value: pipelineStatus(step, status, smartState) },
    ],
  })))
  return targets
}

function bandTarget(band: MockBand, readiness: HardwareReadiness | null): CommandTarget {
  const rejected = readiness?.validation.rejectedBands.some((item) => item.bandId === band.bandId) ?? false
  return {
    id: `band-${band.bandId}`,
    kind: 'band',
    label: `BAND ${String(band.bandId).padStart(2, '0')}`,
    status: rejected ? 'REJECTED' : band.enabled ? 'COMPATIBLE' : 'DISABLED',
    summary: `${mhz(band.lowFrequencyHz)} to ${mhz(band.highFrequencyHz)}`,
    metadata: [
      { label: 'Low frequency', value: mhz(band.lowFrequencyHz) },
      { label: 'High frequency', value: mhz(band.highFrequencyHz) },
      { label: 'Center frequency', value: mhz(band.centerFrequencyHz) },
      { label: 'Bandwidth', value: mhz(band.bandwidthHz) },
      { label: 'Dwell', value: `${band.dwellTimeS.toFixed(3)} s` },
      { label: 'Enabled', value: band.enabled ? 'Yes' : 'No' },
      { label: 'Compatibility', value: rejected ? 'Rejected by validator' : 'Compatible' },
    ],
  }
}

function pipelineStatus(step: string, status: SDRStatus, smartState: SmartMockState | null): string {
  if (step === 'DEVICE') return status.connected ? 'MOCK SDR CONNECTED' : 'READY'
  if (step === 'TUNE') return status.centerFrequencyHz ? mhz(status.centerFrequencyHz) : 'WAITING'
  if (step === 'SETTLE') return 'UNKNOWN / SIMULATED'
  if (step === 'CAPTURE') return status.captureDurationS ? seconds(status.captureDurationS) : 'WAITING'
  if (step === 'SMART V3') return smartState?.status ? smartState.status.toUpperCase() : 'FROZEN MODEL'
  return 'RX ONLY'
}

function defaultInspection(status: SDRStatus, band: MockBand | null, observation: SDRObservation | null): Array<{ label: string; value: string }> {
  return [
    { label: 'Selected band', value: band ? `BAND ${String(band.bandId).padStart(2, '0')}` : 'None' },
    { label: 'Center frequency', value: band ? mhz(band.centerFrequencyHz) : ghz(status.centerFrequencyHz) },
    { label: 'Bandwidth', value: band ? mhz(band.bandwidthHz) : mhz(status.bandwidthHz) },
    { label: 'Sample rate', value: msps(status.sampleRateHz) },
    { label: 'Dwell', value: band ? seconds(band.dwellTimeS) : seconds(status.captureDurationS) },
    { label: 'Observed power', value: dbm(status.observedPowerDbm) },
    { label: 'Tune latency', value: seconds(observation?.captureMetadata?.tuningLatencyS ?? null) },
    { label: 'Settling', value: seconds(observation?.captureMetadata?.settlingDurationS ?? null) },
  ]
}
