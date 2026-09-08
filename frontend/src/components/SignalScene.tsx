import { Canvas, useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import type { PageId } from '../types/dashboard'
import { SceneBoundary } from './SceneBoundary'
import { useSceneMotion } from './useSceneMotion'

const pages: PageId[] = ['overview', 'spectrum', 'scheduler', 'comparison', 'energy', 'sdr']

type Props = { activePage: PageId; paused: boolean; onNavigate: (page: PageId) => void }

export function SignalScene(props: Props) {
  const moving = useSceneMotion(props.paused)
  return <SceneBoundary>
    <Canvas camera={{ position: [0, 5.8, 8.5], fov: 38 }} dpr={[1, 1.5]}
      frameloop={moving ? 'always' : 'demand'} gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}>
      <ambientLight intensity={1.5} />
      <directionalLight position={[2, 6, 4]} intensity={3} color="#e5f6ff" />
      <pointLight position={[-3, 2, 1]} intensity={18} color="#ff665e" />
      <SignalArray {...props} paused={!moving} />
    </Canvas>
  </SceneBoundary>
}

function SignalArray({ activePage, paused, onNavigate }: Props) {
  const group = useRef<THREE.Group>(null)
  const sweep = useRef<THREE.Group>(null)
  const fins = useRef<THREE.Group>(null)
  const phase = useRef(0)
  useFrame((state, delta) => {
    if (paused) return
    phase.current += Math.min(delta, 0.05)
    if (group.current) {
      group.current.rotation.y = THREE.MathUtils.damp(group.current.rotation.y, state.pointer.x * 0.2, 3, delta)
      group.current.rotation.x = THREE.MathUtils.damp(group.current.rotation.x, state.pointer.y * 0.07, 3, delta)
    }
    if (sweep.current) sweep.current.rotation.y = phase.current * 0.4
    fins.current?.children.forEach((fin, i) => {
      fin.scale.y = 0.55 + (Math.sin(phase.current * 1.8 - i * 0.36) + 1) * 0.55
    })
  })
  return <group ref={group}>
    <mesh position={[0, -0.12, 0]}>
      <cylinderGeometry args={[2.2, 2.4, 0.18, 80]} />
      <meshStandardMaterial color="#252a30" metalness={0.65} roughness={0.35} />
    </mesh>
    {[1.1, 2.25, 3.2].map((radius, i) => <mesh key={radius} rotation={[-Math.PI / 2, 0, 0]}>
      <torusGeometry args={[radius, 0.014, 8, 96]} />
      <meshBasicMaterial color={i === 1 ? '#ff6961' : '#7ed6da'} transparent opacity={0.7} />
    </mesh>)}
    <group ref={fins}>
      {Array.from({ length: 48 }, (_, i) => {
        const angle = i / 48 * Math.PI * 2
        return <group key={i} position={[Math.cos(angle) * 1.66, 0, Math.sin(angle) * 1.66]} rotation={[0, -angle, 0]}>
          <mesh position={[0, 0.3, 0]}>
            <boxGeometry args={[0.22, 0.6, 0.075]} />
            <meshStandardMaterial color={i % 8 < 2 ? '#a5eef0' : '#f0776d'} metalness={0.45} roughness={0.3} />
          </mesh>
        </group>
      })}
    </group>
    <mesh position={[0, 0.35, 0]}>
      <cylinderGeometry args={[0.65, 0.85, 0.7, 6]} />
      <meshStandardMaterial color="#7b8b94" metalness={0.7} roughness={0.25} />
    </mesh>
    <group ref={sweep}>
      <mesh position={[0, 1.1, 0]} rotation={[Math.PI / 3, 0, 0]}>
        <torusGeometry args={[0.85, 0.035, 10, 64]} />
        <meshBasicMaterial color="#98e2e5" />
      </mesh>
      <mesh position={[0, 1.1, 0]} rotation={[0, 0, Math.PI / 3]}>
        <torusGeometry args={[0.85, 0.022, 10, 64]} />
        <meshBasicMaterial color="#ff776d" />
      </mesh>
    </group>
    {pages.map((page, i) => {
      const angle = i / pages.length * Math.PI * 2
      const selected = page === activePage
      return <mesh key={page} position={[Math.cos(angle) * 2.85, 0.12, Math.sin(angle) * 2.85]}
        rotation={[0, -angle, 0]} onClick={(event) => { event.stopPropagation(); onNavigate(page) }}>
        <boxGeometry args={[0.4, selected ? 0.45 : 0.16, 0.6]} />
        <meshStandardMaterial color={selected ? '#ff776d' : '#829ba5'} emissive={selected ? '#a12e26' : '#13383b'} emissiveIntensity={0.5} metalness={0.55} roughness={0.28} />
      </mesh>
    })}
  </group>
}
