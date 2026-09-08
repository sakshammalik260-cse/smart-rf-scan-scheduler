import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { AdaptiveDpr, Html, OrbitControls } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import * as THREE from 'three'
import type { CommandTarget } from '../types/rfCommand'
import type { HardwareReadiness, SDRStatus, SmartMockState } from '../types/sdr'
import { SceneBoundary } from './SceneBoundary'
import { useSceneMotion } from './useSceneMotion'

type SceneProps = {
  readiness: HardwareReadiness | null
  status: SDRStatus
  smartState: SmartMockState | null
  selectedTargetId: string
  hoveredTargetId: string | null
  effectsEnabled: boolean
  reducedMotion: boolean
  onHover: (target: CommandTarget | null, point?: { x: number; y: number }) => void
  onSelect: (target: CommandTarget) => void
}

const RED = '#FF3B3B'
const HOT_RED = '#FF5A5F'
const STRUCTURAL_RED = '#71181C'
const PANEL_BLACK = '#070707'
const DIM = '#727985'

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')))
  } catch {
    return false
  }
}

export function RfCommandScene(props: SceneProps) {
  const available = useMemo(() => webglAvailable(), [])
  const moving = useSceneMotion(props.reducedMotion)
  if (!available) {
    return <div className="rf-scene-fallback" role="img" aria-label="WebGL unavailable fallback for RF operations table">
      <div>
        <p className="font-mono text-xs uppercase text-[#FF3B3B]">WebGL unavailable</p>
        <p className="mt-2 text-sm text-[#F5F7FA]">The RF command-center visualization is unavailable, but all device, band, and pipeline controls remain accessible in HTML.</p>
      </div>
    </div>
  }

  return <SceneBoundary><Canvas
    camera={{ position: [0, 8.8, 10.8], fov: 50, near: 0.1, far: 80 }}
    dpr={[1, 1.5]}
    gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
    className="rf-command-canvas"
    frameloop={moving ? 'always' : 'demand'}
  >
    <color attach="background" args={[PANEL_BLACK]} />
    <fog attach="fog" args={[PANEL_BLACK, 15, 28]} />
    <ambientLight intensity={1.5} />
    <directionalLight position={[2, 7, 5]} intensity={3} color="#d1edf0" />
    <pointLight position={[0, 6, 0]} intensity={1.05} color={RED} distance={12} decay={2} />
    <spotLight position={[-3.8, 6.2, 5.2]} angle={0.5} penumbra={0.85} intensity={0.55} color={HOT_RED} distance={16} />
    <CameraFraming />
    <SceneContents {...props} reducedMotion={!moving} />
    <AdaptiveDpr pixelated />
    <OrbitControls
      enableDamping
      dampingFactor={0.08}
      enablePan={false}
      enableZoom={false}
      enableRotate={!props.reducedMotion}
      minPolarAngle={Math.PI / 4.1}
      maxPolarAngle={Math.PI / 2.35}
      minAzimuthAngle={-0.22}
      maxAzimuthAngle={0.22}
    />
    {props.effectsEnabled && <EffectComposer multisampling={0}>
      <Bloom intensity={0.28} luminanceThreshold={0.82} luminanceSmoothing={0.28} mipmapBlur />
    </EffectComposer>}
  </Canvas></SceneBoundary>
}

function CameraFraming() {
  const { camera, size, invalidate } = useThree()
  useEffect(() => {
    // Leave room for the foreground pipeline, which is closer than the core.
    const distance = Math.max(14, 6.4 / (Math.tan(25 * Math.PI / 180) * size.width / size.height) + 3.5)
    camera.position.set(0, distance * 0.68, distance * 0.74)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    invalidate()
  }, [camera, size.width, size.height, invalidate])
  return null
}

function SceneContents(props: SceneProps) {
  const pointerWorld = useRef(new THREE.Vector3(99, 99, 99))
  const cameraOffset = useRef(new THREE.Vector2(0, 0))
  const groupRef = useRef<THREE.Group>(null)
  const scannerRef = useRef<THREE.Mesh>(null)
  const scanArcRef = useRef<THREE.Mesh>(null)
  const bands = props.readiness?.bands ?? []
  const devices = props.readiness?.devices ?? []
  const bandTargets = bands.map((band) => ({
    id: `band-${band.bandId}`,
    label: `BAND ${String(band.bandId).padStart(2, '0')}`,
    status: props.readiness?.validation.rejectedBands.some((item) => item.bandId === band.bandId) ? 'REJECTED' : band.enabled ? 'COMPATIBLE' : 'DISABLED',
    summary: `${mhz(band.lowFrequencyHz)} to ${mhz(band.highFrequencyHz)}`,
    kind: 'band' as const,
    metadata: [
      { label: 'Low', value: mhz(band.lowFrequencyHz) },
      { label: 'High', value: mhz(band.highFrequencyHz) },
      { label: 'Center', value: mhz(band.centerFrequencyHz) },
      { label: 'Bandwidth', value: band.bandwidthHz ? mhz(band.bandwidthHz) : 'Not reported' },
      { label: 'Dwell', value: `${band.dwellTimeS.toFixed(3)} s` },
      { label: 'Enabled', value: band.enabled ? 'Yes' : 'No' },
    ],
  }))
  const deviceTargets = devices.map((device) => ({
    id: `device-${device.deviceId}`,
    label: device.deviceName.toUpperCase(),
    status: device.driverAvailable ? device.connected ? 'CONNECTED' : 'DISCONNECTED' : 'DRIVER NOT INSTALLED',
    summary: device.simulated ? 'Simulation receiver path' : 'Physical receiver placeholder',
    kind: 'device' as const,
    metadata: [
      { label: 'Driver', value: device.driverName },
      { label: 'Driver available', value: device.driverAvailable ? 'Yes' : 'No' },
      { label: 'Connection', value: device.connected ? 'Connected' : 'Disconnected' },
      { label: 'Mode', value: device.simulated ? 'Simulation' : 'Physical' },
      { label: 'Receive', value: device.receiveSupported ? 'Supported' : 'Unavailable' },
      { label: 'Transmit', value: device.transmitSupported ? 'Informational only' : 'Not exposed' },
    ],
  }))
  const pipelineTargets = PIPELINE.map((step, index) => ({
    id: `pipeline-${index}`,
    label: step,
    status: pipelineStatus(step, props.status, props.smartState),
    summary: 'Receive-only processing stage',
    kind: 'pipeline' as const,
    metadata: [
      { label: 'Stage', value: String(index + 1) },
      { label: 'Path', value: 'RX observation only' },
      { label: 'State', value: pipelineStatus(step, props.status, props.smartState) },
    ],
  }))
  const coreTarget: CommandTarget = {
    id: 'core-receiver',
    label: 'RECEIVE CORE',
    status: props.status.connected ? 'MOCK SDR CONNECTED' : 'RECEIVE ONLY',
    summary: 'Smart V4 accepts receiver observations only.',
    kind: 'core',
    metadata: [
      { label: 'Input mode', value: props.status.inputMode },
      { label: 'Device', value: props.status.deviceName },
      { label: 'Frequency', value: props.status.centerFrequencyHz ? mhz(props.status.centerFrequencyHz) : 'Not tuned' },
      { label: 'Sample rate', value: props.status.sampleRateHz ? `${(props.status.sampleRateHz / 1e6).toFixed(3)} MS/s` : 'Not set' },
    ],
  }

  useFrame((state) => {
    const elapsed = state.clock.elapsedTime
    if (groupRef.current && !props.reducedMotion) {
      groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, cameraOffset.current.y * 0.035, 0.06)
      groupRef.current.rotation.z = THREE.MathUtils.lerp(groupRef.current.rotation.z, -cameraOffset.current.x * 0.035, 0.06)
    }
    if (scannerRef.current) {
      scannerRef.current.position.lerp(pointerWorld.current, 0.22)
      const active = pointerWorld.current.x < 90
      scannerRef.current.visible = active
      scannerRef.current.scale.setScalar(active ? 1 + Math.sin(elapsed * 4) * 0.08 : 0.001)
    }
    if (scanArcRef.current && !props.reducedMotion) {
      scanArcRef.current.rotation.z = elapsed * 0.12
    }
  })

  const movePointer = (event: ThreeEvent<PointerEvent>) => {
    pointerWorld.current.copy(event.point)
    cameraOffset.current.set(event.pointer.x, event.pointer.y)
  }

  return <group ref={groupRef}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]} onPointerMove={movePointer} onPointerOut={() => props.onHover(null)}>
      <planeGeometry args={[18, 18]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
    <GridField pointerWorld={pointerWorld} reducedMotion={props.reducedMotion} />
    <ParticleField pointerWorld={pointerWorld} reducedMotion={props.reducedMotion} />
    <ReceiverCore target={coreTarget} selectedTargetId={props.selectedTargetId} hoveredTargetId={props.hoveredTargetId} pointerWorld={pointerWorld} onHover={props.onHover} onSelect={props.onSelect} />
    {bandTargets.map((target, index) => <BandSector
      key={target.id}
      target={target}
      index={index}
      count={Math.max(bandTargets.length, 1)}
      rejected={target.status === 'REJECTED'}
      selectedTargetId={props.selectedTargetId}
      hoveredTargetId={props.hoveredTargetId}
      pointerWorld={pointerWorld}
      onHover={props.onHover}
      onSelect={props.onSelect}
    />)}
    {deviceTargets.map((target, index) => <DeviceNode
      key={target.id}
      target={target}
      index={index}
      count={Math.max(deviceTargets.length, 1)}
      selectedTargetId={props.selectedTargetId}
      hoveredTargetId={props.hoveredTargetId}
      pointerWorld={pointerWorld}
      onHover={props.onHover}
      onSelect={props.onSelect}
    />)}
    {pipelineTargets.map((target, index) => <PipelineNode
      key={target.id}
      target={target}
      index={index}
      selectedTargetId={props.selectedTargetId}
      hoveredTargetId={props.hoveredTargetId}
      reducedMotion={props.reducedMotion}
      onHover={props.onHover}
      onSelect={props.onSelect}
    />)}
    <MeasurementRings />
    <mesh ref={scanArcRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
      <ringGeometry args={[3.65, 3.72, 96, 1, 0, Math.PI * 0.38]} />
      <meshBasicMaterial color={RED} transparent opacity={0.34} />
    </mesh>
    <mesh ref={scannerRef} position={[0, 0.08, 0]}>
      <sphereGeometry args={[0.07, 16, 16]} />
      <meshBasicMaterial color={HOT_RED} />
    </mesh>
    <Html position={[0, 0.58, 0]} center distanceFactor={9} transform occlude={false} zIndexRange={[2, 0]} style={{ pointerEvents: 'none' }}>
      <div className="rf-core-label">
        <span>RX ONLY</span>
        <strong>SMART V4</strong>
      </div>
    </Html>
  </group>
}

function MeasurementRings() {
  return <group rotation={[-Math.PI / 2, 0, 0]}>
    {[1.8, 2.7, 3.9, 5.25].map((radius, index) => <mesh key={radius} position={[0, 0, -0.03 - index * 0.002]}>
      <ringGeometry args={[radius, radius + 0.012, 128]} />
      <meshBasicMaterial color={index % 2 ? STRUCTURAL_RED : DIM} transparent opacity={index % 2 ? 0.42 : 0.18} />
    </mesh>)}
    {Array.from({ length: 18 }, (_, index) => {
      const angle = index / 18 * Math.PI * 2
      return <mesh key={index} position={[Math.cos(angle) * 4.05, Math.sin(angle) * 4.05, -0.02]} rotation={[0, 0, angle]}>
        <boxGeometry args={[0.012, 0.34, 0.01]} />
        <meshBasicMaterial color={STRUCTURAL_RED} transparent opacity={0.45} />
      </mesh>
    })}
  </group>
}

function ReceiverCore(props: NodeProps & { pointerWorld: MutableRefObject<THREE.Vector3> }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const matRef = useRef<THREE.MeshStandardMaterial>(null)
  const selected = props.selectedTargetId === props.target.id
  const hovered = props.hoveredTargetId === props.target.id
  useFrame(() => {
    const mesh = meshRef.current
    const mat = matRef.current
    if (!mesh || !mat) return
    const distance = mesh.position.distanceTo(props.pointerWorld.current)
    const proximity = THREE.MathUtils.clamp(1 - distance / 2.8, 0, 1)
    const lift = selected || hovered ? 0.18 : proximity * 0.08
    mesh.position.y = THREE.MathUtils.lerp(mesh.position.y, lift, 0.12)
    mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity, selected || hovered ? 0.72 : 0.18 + proximity * 0.32, 0.12)
  })
  return <group>
    <mesh ref={meshRef} onClick={() => props.onSelect(props.target)} onPointerOver={(event) => props.onHover(props.target, pointer(event))} onPointerMove={(event) => props.onHover(props.target, pointer(event))} onPointerOut={() => props.onHover(null)}>
      <cylinderGeometry args={[1.18, 1.34, 0.24, 96]} />
      <meshStandardMaterial ref={matRef} color="#536770" emissive={STRUCTURAL_RED} roughness={0.4} metalness={0.5} />
    </mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.18, 0]}>
      <ringGeometry args={[1.46, 1.52, 96]} />
      <meshBasicMaterial color={RED} transparent opacity={0.5} />
    </mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.2, 0]}>
      <ringGeometry args={[2.1, 2.12, 128]} />
      <meshBasicMaterial color={STRUCTURAL_RED} transparent opacity={0.45} />
    </mesh>
  </group>
}

function BandSector(props: NodeProps & { index: number; count: number; rejected: boolean; pointerWorld: MutableRefObject<THREE.Vector3> }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const matRef = useRef<THREE.MeshStandardMaterial>(null)
  const geometry = useMemo(() => sectorGeometry(2.2, 3.35, props.index, props.count), [props.index, props.count])
  const midpoint = useMemo(() => {
    const angle = (props.index + 0.5) / props.count * Math.PI * 2
    return new THREE.Vector3(Math.cos(angle) * 2.78, 0, Math.sin(angle) * 2.78)
  }, [props.index, props.count])
  const selected = props.selectedTargetId === props.target.id
  const hovered = props.hoveredTargetId === props.target.id
  useFrame(() => {
    const mesh = meshRef.current
    const mat = matRef.current
    if (!mesh || !mat) return
    const distance = midpoint.distanceTo(props.pointerWorld.current)
    const proximity = THREE.MathUtils.clamp(1 - distance / 1.5, 0, 1)
    mesh.position.y = THREE.MathUtils.lerp(mesh.position.y, selected || hovered ? 0.2 : proximity * 0.1, 0.13)
    mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity, selected || hovered ? 0.86 : 0.1 + proximity * 0.3, 0.12)
  })
  return <mesh ref={meshRef} geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} onClick={() => props.onSelect(props.target)} onPointerOver={(event) => props.onHover(props.target, pointer(event))} onPointerMove={(event) => props.onHover(props.target, pointer(event))} onPointerOut={() => props.onHover(null)}>
    <meshStandardMaterial ref={matRef} color={props.rejected ? '#3d4247' : '#bc5554'} emissive={props.rejected ? '#332326' : STRUCTURAL_RED} roughness={0.42} metalness={0.35} side={THREE.DoubleSide} />
  </mesh>
}

function DeviceNode(props: NodeProps & { index: number; count: number; pointerWorld: MutableRefObject<THREE.Vector3> }) {
  const groupRef = useRef<THREE.Group>(null)
  const matRef = useRef<THREE.MeshStandardMaterial>(null)
  const angle = -Math.PI * 0.72 + props.index * (Math.PI * 1.44 / Math.max(props.count - 1, 1))
  const position = useMemo(() => new THREE.Vector3(Math.cos(angle) * 4.65, 0.26, Math.sin(angle) * 4.65), [angle])
  const lineGeometry = useMemo(() => new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(-position.x * 0.48, -0.2, -position.z * 0.48)]), [position])
  const selected = props.selectedTargetId === props.target.id
  const hovered = props.hoveredTargetId === props.target.id
  useFrame(() => {
    const group = groupRef.current
    const mat = matRef.current
    if (!group || !mat) return
    const proximity = THREE.MathUtils.clamp(1 - position.distanceTo(props.pointerWorld.current) / 1.6, 0, 1)
    const scale = selected || hovered ? 1.12 : 1 + proximity * 0.05
    group.scale.lerp(new THREE.Vector3(scale, scale, scale), 0.14)
    group.position.y = THREE.MathUtils.lerp(group.position.y, position.y + (selected || hovered ? 0.18 : proximity * 0.08), 0.13)
    mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity, selected || hovered ? 0.75 : 0.16 + proximity * 0.24, 0.1)
  })
  return <group ref={groupRef} position={position}>
    <line>
      <primitive object={lineGeometry} attach="geometry" />
      <lineBasicMaterial color={props.target.status === 'CONNECTED' ? RED : STRUCTURAL_RED} transparent opacity={selected || hovered ? 0.85 : 0.32} />
    </line>
    <mesh onClick={() => props.onSelect(props.target)} onPointerOver={(event) => props.onHover(props.target, pointer(event))} onPointerMove={(event) => props.onHover(props.target, pointer(event))} onPointerOut={() => props.onHover(null)}>
      <boxGeometry args={[0.5, 0.18, 0.5]} />
      <meshStandardMaterial ref={matRef} color="#7ca5aa" emissive={props.target.status === 'CONNECTED' ? RED : '#174b52'} roughness={0.36} metalness={0.38} />
    </mesh>
  </group>
}

function PipelineNode(props: NodeProps & { index: number; reducedMotion: boolean }) {
  const groupRef = useRef<THREE.Group>(null)
  const selected = props.selectedTargetId === props.target.id
  const hovered = props.hoveredTargetId === props.target.id
  useFrame((state) => {
    if (!groupRef.current) return
    const pulse = props.reducedMotion ? 0 : Math.sin(state.clock.elapsedTime * 1.2 - props.index * 0.55) * 0.025
    const scale = selected || hovered ? 1.1 : 1 + pulse
    groupRef.current.scale.lerp(new THREE.Vector3(scale, scale, scale), 0.12)
  })
  return <group ref={groupRef} position={[-4.8 + props.index * 1.6, -0.02, 4.65]}>
    <mesh onClick={() => props.onSelect(props.target)} onPointerOver={(event) => props.onHover(props.target, pointer(event))} onPointerMove={(event) => props.onHover(props.target, pointer(event))} onPointerOut={() => props.onHover(null)}>
      <boxGeometry args={[0.82, 0.1, 0.32]} />
      <meshStandardMaterial color="#81adb1" emissive={selected || hovered ? RED : '#174b52'} emissiveIntensity={selected || hovered ? 0.58 : 0.18} roughness={0.5} metalness={0.4} />
    </mesh>
  </group>
}

function GridField({ pointerWorld, reducedMotion }: { pointerWorld: MutableRefObject<THREE.Vector3>; reducedMotion: boolean }) {
  const pointsRef = useRef<THREE.Points>(null)
  const positions = useMemo(() => {
    const values: number[] = []
    for (let x = -7; x <= 7; x += 0.7) {
      for (let z = -5.6; z <= 5.6; z += 0.7) values.push(x, -0.09, z)
    }
    return new Float32Array(values)
  }, [])
  useFrame((state) => {
    if (!pointsRef.current || reducedMotion) return
    pointsRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.18) * 0.01
    pointsRef.current.position.x = THREE.MathUtils.lerp(pointsRef.current.position.x, pointerWorld.current.x * 0.006, 0.04)
  })
  return <points ref={pointsRef}>
    <bufferGeometry>
      <bufferAttribute attach="attributes-position" args={[positions, 3]} />
    </bufferGeometry>
    <pointsMaterial color={DIM} size={0.018} transparent opacity={0.62} />
  </points>
}

function ParticleField({ pointerWorld, reducedMotion }: { pointerWorld: MutableRefObject<THREE.Vector3>; reducedMotion: boolean }) {
  const pointsRef = useRef<THREE.Points>(null)
  const basePositions = useMemo(() => {
    const values: number[] = []
    for (let index = 0; index < 90; index += 1) {
      const radius = 2 + seeded(index, 1) * 4.8
      const angle = seeded(index, 2) * Math.PI * 2
      values.push(Math.cos(angle) * radius, 0.25 + seeded(index, 3) * 1.8, Math.sin(angle) * radius)
    }
    return new Float32Array(values)
  }, [])
  useFrame((state) => {
    const points = pointsRef.current
    if (!points || reducedMotion) return
    const position = points.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let index = 0; index < position.count; index += 1) {
      const x = basePositions[index * 3]
      const y = basePositions[index * 3 + 1]
      const z = basePositions[index * 3 + 2]
      const dx = x - pointerWorld.current.x
      const dz = z - pointerWorld.current.z
      const distance = Math.max(Math.sqrt(dx * dx + dz * dz), 0.001)
      const push = Math.max(0, 1 - distance / 1.6) * 0.18
      position.setXYZ(index, x + dx / distance * push, y + Math.sin(state.clock.elapsedTime * 0.4 + index) * 0.025, z + dz / distance * push)
    }
    position.needsUpdate = true
  })
  return <points ref={pointsRef}>
    <bufferGeometry>
      <bufferAttribute attach="attributes-position" args={[basePositions, 3]} />
    </bufferGeometry>
    <pointsMaterial color={RED} size={0.026} transparent opacity={0.36} />
  </points>
}

type NodeProps = {
  target: CommandTarget
  selectedTargetId: string
  hoveredTargetId: string | null
  onHover: (target: CommandTarget | null, point?: { x: number; y: number }) => void
  onSelect: (target: CommandTarget) => void
}

const PIPELINE = ['DEVICE', 'TUNE', 'SETTLE', 'CAPTURE', 'EVENT EXTRACTION', 'RECEIVER HISTORY', 'SMART V3']

function pipelineStatus(step: string, status: SDRStatus, smartState: SmartMockState | null): string {
  if (step === 'DEVICE') return status.connected ? 'MOCK SDR CONNECTED' : 'READY'
  if (step === 'SMART V3') return smartState?.status ? smartState.status.toUpperCase() : 'FROZEN MODEL'
  if (step === 'CAPTURE') return status.captureDurationS ? `${status.captureDurationS.toFixed(3)} S DWELL` : 'WAITING'
  return 'RX ONLY'
}

function sectorGeometry(innerRadius: number, outerRadius: number, index: number, count: number): THREE.ExtrudeGeometry {
  const padding = 0.012
  const start = index / count * Math.PI * 2 + padding
  const end = (index + 1) / count * Math.PI * 2 - padding
  const shape = new THREE.Shape()
  shape.moveTo(Math.cos(start) * innerRadius, Math.sin(start) * innerRadius)
  for (let step = 0; step <= 5; step += 1) {
    const angle = start + (end - start) * (step / 5)
    shape.lineTo(Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius)
  }
  for (let step = 5; step >= 0; step -= 1) {
    const angle = start + (end - start) * (step / 5)
    shape.lineTo(Math.cos(angle) * innerRadius, Math.sin(angle) * innerRadius)
  }
  shape.closePath()
  return new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.02, bevelSegments: 1, steps: 1 })
}

function mhz(value: number): string {
  return `${(value / 1e6).toFixed(3)} MHz`
}

function pointer(event: ThreeEvent<PointerEvent>): { x: number; y: number } {
  return { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY }
}

function seeded(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453
  return value - Math.floor(value)
}
