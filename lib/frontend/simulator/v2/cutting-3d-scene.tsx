// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Real 3D Cutting Scene (three.js / @react-three/fiber)
//
// 실시간 WebGL 3D 가공 씬:
//   - 공작물(stock) 박스 + 가공 경로(groove)
//   - 회전하는 엔드밀(shape별 tip), 절삭유 hint 컬러
//   - 칩 파티클(instancedMesh) — Vc 기반 온도 gradient
//   - 스파크(Vc > 임계값)
//   - OrbitControls(드래그 회전 / 휠 줌)
//   - operationType별 공구/이동 방식 분기
//
// 주의:
//   - cutting-simulator-v2.tsx 는 절대 건드리지 않는다. 본 컴포넌트는 독립 마운트 전용.
//   - 매직넘버는 본 파일 상단 SSOT 블록에 집약.
//   - prefers-reduced-motion 시 회전/이동/파티클 정지.
"use client"

import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import * as THREE from "three"

// ─────────────────────────────────────────────
// 로컬 SSOT (외부 config 합치기 전까지 파일 내부 상수)
// ─────────────────────────────────────────────
const DEFAULT_HEIGHT = 420
const DEFAULT_STOCK_L = 80
const DEFAULT_STOCK_W = 60
const DEFAULT_STOCK_H = 30

const CAMERA_POS: [number, number, number] = [80, 60, 100]
const CAMERA_FOV = 35
const DPR_RANGE: [number, number] = [1, 1.5]

const FOG_NEAR = 200
const FOG_FAR = 500

const BG_DARK = "#0a0e1a"
const BG_LIGHT = "#f1f5f9"
const GRID_MAJOR_DARK = "#334155"
const GRID_MINOR_DARK = "#1e293b"
const GRID_MAJOR_LIGHT = "#cbd5e1"
const GRID_MINOR_LIGHT = "#e2e8f0"
const GRID_SIZE = 200
const GRID_DIVISIONS = 20

// 엔드밀 시각 스케일
const SHANK_RATIO = 0.95         // dia 대비 shank 직경 비율
const SHANK_LEN_RATIO = 1.4      // OAL 중 shank 차지 비율 (flute 제외)
const HELIX_STRIPES = 6
const HELIX_THICKNESS = 0.08     // dia 대비

// 회전 감속 (rpm → rad/s 너무 빠르므로 시각 감속)
const ROTATION_VISUAL_MULT = 0.06

// 이송 시각화: Vf mm/min → world units/sec 환산
const FEED_UNITS_PER_MM = 1.0
const FEED_VISUAL_MULT = 0.08

// 칩 파티클
const MAX_CHIPS = 120
const CHIP_LIFETIME_SEC = 1.1
const CHIP_SPAWN_HZ_MAX = 45
const CHIP_GRAVITY = -35
const CHIP_SIZE = 0.55

// 스파크
const MAX_SPARKS = 40
const SPARK_LIFETIME_SEC = 0.35
const SPARK_VC_MIN = 250         // 이 이상일 때 스파크 생성
const SPARK_VC_RED = 400

// 가공 경로(groove) 깊이/폭 — ap/ae 기반, 안전 상한
const GROOVE_MAX_DEPTH_RATIO = 0.5   // stock H 대비 최대
const GROOVE_MAX_WIDTH_RATIO = 0.6   // stock W 대비 최대

// 드릴링: 수직 왕복
const DRILL_PERIOD_SEC = 2.4
const DRILL_PEAK_DEPTH_RATIO = 0.55   // stock H 대비

// ─────────────────────────────────────────────
// Public Types
// ─────────────────────────────────────────────
export type OperationType =
  | "endmill-general"
  | "roughing"
  | "turning"
  | "drilling"
  | "slotting"

export type EndmillShape = "square" | "ball" | "radius" | "chamfer"

export interface Cutting3DSceneProps {
  operationType: OperationType
  shape: EndmillShape
  diameter: number          // mm
  flutes: number
  LOC: number               // mm
  OAL: number               // mm
  rpm: number
  Vf: number                // mm/min
  ap: number                // mm
  ae: number                // mm
  stockL?: number           // default 80mm
  stockW?: number           // default 60mm
  stockH?: number           // default 30mm
  materialColor?: string    // workpiece base color
  coating?: string
  darkMode?: boolean
  autoRotate?: boolean      // default true
  height?: number           // default 420 (px)
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
const COATING_TINTS: Record<string, string> = {
  altin: "#fbbf24",
  tin: "#f59e0b",
  ticn: "#60a5fa",
  dlc: "#a78bfa",
  tialn: "#fde68a",
  uncoated: "#d4d4d8",
}

function coatingColor(coating?: string): string {
  if (!coating) return COATING_TINTS.uncoated
  return COATING_TINTS[coating.toLowerCase()] ?? COATING_TINTS.uncoated
}

// Vc (m/min) 기반 칩 온도 색상 gradient
function chipTempColor(vcMPerMin: number, t01: number): THREE.Color {
  // t01: lifetime 비율 (0→1), 시간이 갈수록 식음
  const intensity = Math.max(0, Math.min(1, vcMPerMin / 400)) * (1 - t01 * 0.6)
  // silver → yellow → orange → red
  const silver = new THREE.Color("#cbd5e1")
  const yellow = new THREE.Color("#fde047")
  const orange = new THREE.Color("#fb923c")
  const red = new THREE.Color("#ef4444")
  let c: THREE.Color
  if (intensity < 0.33) {
    c = silver.clone().lerp(yellow, intensity / 0.33)
  } else if (intensity < 0.66) {
    c = yellow.clone().lerp(orange, (intensity - 0.33) / 0.33)
  } else {
    c = orange.clone().lerp(red, (intensity - 0.66) / 0.34)
  }
  return c
}

// Vc (m/min) 계산 — π × D × n / 1000
function calcVc(dia: number, rpm: number): number {
  return (Math.PI * dia * rpm) / 1000
}

// prefers-reduced-motion 감지
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined") return
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReduced(mq.matches)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])
  return reduced
}

// ─────────────────────────────────────────────
// Workpiece (Stock) + groove
// ─────────────────────────────────────────────
interface StockProps {
  L: number
  W: number
  H: number
  color: string
  grooveDepth: number
  grooveWidth: number
  grooveProgress01: number    // 0 → 1, 경로 진행도
  operationType: OperationType
}

function Stock({ L, W, H, color, grooveDepth, grooveWidth, grooveProgress01, operationType }: StockProps) {
  // 본체
  // 가공 자국 시각화: 상단에 점진적으로 늘어나는 어두운 box 를 subtract 느낌으로 덮는다.
  // CSG 없이도 "이미 가공된 영역" 표시.
  const cutLen = Math.max(0.001, L * grooveProgress01)
  const isTurning = operationType === "turning"
  const isDrilling = operationType === "drilling"

  return (
    <group>
      {/* 본체 박스 (선반 가공의 경우 원통) */}
      {isTurning ? (
        <mesh castShadow receiveShadow rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[H * 0.7, H * 0.7, L, 40]} />
          <meshStandardMaterial color={color} metalness={0.75} roughness={0.35} />
        </mesh>
      ) : (
        <mesh castShadow receiveShadow>
          <boxGeometry args={[L, H, W]} />
          <meshStandardMaterial color={color} metalness={0.6} roughness={0.4} />
        </mesh>
      )}

      {/* 이미 가공된 영역 — 상단에 어두운 overlay */}
      {!isTurning && !isDrilling && cutLen > 0.01 && (
        <mesh position={[-L / 2 + cutLen / 2, H / 2 - grooveDepth / 2 + 0.01, 0]}>
          <boxGeometry args={[cutLen, grooveDepth, grooveWidth]} />
          <meshStandardMaterial
            color="#1e293b"
            metalness={0.2}
            roughness={0.9}
            emissive="#0f172a"
            emissiveIntensity={0.2}
          />
        </mesh>
      )}

      {/* 드릴링: 수직 구멍 시각화 (단순 어두운 실린더) */}
      {isDrilling && grooveProgress01 > 0.02 && (
        <mesh position={[0, H / 2 - (H * grooveProgress01) / 2, 0]}>
          <cylinderGeometry args={[grooveWidth / 2, grooveWidth / 2, H * grooveProgress01, 24]} />
          <meshStandardMaterial color="#0f172a" metalness={0.1} roughness={0.95} />
        </mesh>
      )}
    </group>
  )
}

// ─────────────────────────────────────────────
// Endmill (shape별 tip)
// ─────────────────────────────────────────────
interface EndmillProps {
  shape: EndmillShape
  dia: number
  LOC: number
  OAL: number
  coatingColorHex: string
  rpm: number
  reducedMotion: boolean
}

function Endmill({ shape, dia, LOC, OAL, coatingColorHex, rpm, reducedMotion }: EndmillProps) {
  const groupRef = useRef<THREE.Group>(null)
  const shankR = (dia / 2) * SHANK_RATIO
  const shankLen = Math.max(4, OAL - LOC) * SHANK_LEN_RATIO * 0.5
  const fluteR = dia / 2

  useFrame((_state, delta) => {
    if (!groupRef.current || reducedMotion) return
    const angVel = (rpm / 60) * Math.PI * 2 * ROTATION_VISUAL_MULT
    groupRef.current.rotation.y += angVel * delta
  })

  const helixMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#1f2937", metalness: 0.4, roughness: 0.6 }),
    [],
  )

  return (
    <group ref={groupRef}>
      {/* Shank */}
      <mesh position={[0, shankLen / 2 + LOC / 2, 0]} castShadow>
        <cylinderGeometry args={[shankR, shankR, shankLen, 20]} />
        <meshStandardMaterial color="#9ca3af" metalness={0.9} roughness={0.25} />
      </mesh>

      {/* Flute body */}
      <mesh position={[0, 0, 0]} castShadow>
        <cylinderGeometry args={[fluteR, fluteR, LOC, 20]} />
        <meshStandardMaterial
          color={coatingColorHex}
          metalness={0.75}
          roughness={0.35}
          emissive={coatingColorHex}
          emissiveIntensity={0.08}
        />
      </mesh>

      {/* Helix stripes — 얇은 torus 를 회전 배치 */}
      {Array.from({ length: HELIX_STRIPES }).map((_, i) => {
        const yOff = -LOC / 2 + (LOC / HELIX_STRIPES) * (i + 0.5)
        const rot = (i / HELIX_STRIPES) * Math.PI * 2
        return (
          <mesh
            key={i}
            position={[0, yOff, 0]}
            rotation={[Math.PI / 2, 0, rot]}
            material={helixMaterial}
          >
            <torusGeometry args={[fluteR * 1.001, fluteR * HELIX_THICKNESS, 6, 24]} />
          </mesh>
        )
      })}

      {/* Tip */}
      {shape === "square" && (
        <mesh position={[0, -LOC / 2 - 0.05, 0]} castShadow>
          <cylinderGeometry args={[fluteR, fluteR, 0.4, 20]} />
          <meshStandardMaterial color="#4b5563" metalness={0.9} roughness={0.2} />
        </mesh>
      )}
      {shape === "ball" && (
        <mesh position={[0, -LOC / 2, 0]} rotation={[Math.PI, 0, 0]} castShadow>
          <sphereGeometry args={[fluteR, 20, 20, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={coatingColorHex} metalness={0.8} roughness={0.3} />
        </mesh>
      )}
      {shape === "radius" && (
        <group position={[0, -LOC / 2, 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[fluteR, fluteR * 0.85, fluteR * 0.4, 20]} />
            <meshStandardMaterial color={coatingColorHex} metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[0, -fluteR * 0.2, 0]} castShadow>
            <sphereGeometry args={[fluteR * 0.85, 18, 18, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={coatingColorHex} metalness={0.8} roughness={0.3} />
          </mesh>
        </group>
      )}
      {shape === "chamfer" && (
        <mesh position={[0, -LOC / 2 - dia * 0.15, 0]} rotation={[Math.PI, 0, 0]} castShadow>
          <coneGeometry args={[fluteR, dia * 0.3, 20]} />
          <meshStandardMaterial color={coatingColorHex} metalness={0.85} roughness={0.25} />
        </mesh>
      )}
    </group>
  )
}

// ─────────────────────────────────────────────
// Tool mover — operationType별 경로
// ─────────────────────────────────────────────
interface ToolMoverProps {
  children: React.ReactNode
  operationType: OperationType
  Vf: number
  stockL: number
  stockW: number
  stockH: number
  ap: number
  onProgress: (p01: number, worldPos: THREE.Vector3) => void
  reducedMotion: boolean
}

function ToolMover({
  children,
  operationType,
  Vf,
  stockL,
  stockW,
  stockH,
  ap,
  onProgress,
  reducedMotion,
}: ToolMoverProps) {
  const groupRef = useRef<THREE.Group>(null)
  const tRef = useRef(0)

  useFrame((_state, delta) => {
    if (!groupRef.current) return
    if (reducedMotion) {
      // 초기 포즈 유지
      groupRef.current.position.set(-stockL / 2, stockH / 2 + 2, 0)
      onProgress(0, groupRef.current.position.clone())
      return
    }
    // Vf (mm/min) → units/sec
    const unitsPerSec = (Vf / 60) * FEED_UNITS_PER_MM * FEED_VISUAL_MULT
    tRef.current += delta * Math.max(0.5, unitsPerSec)

    // 경로 길이 기준
    const pathLen = stockL
    const period = Math.max(2, pathLen)
    const tt = (tRef.current % (period * 2)) // 왕복
    const forward = tt <= period
    const phase = forward ? tt / period : 1 - (tt - period) / period
    const p01 = phase

    let x = 0
    let y = stockH / 2 + 1
    let z = 0

    switch (operationType) {
      case "endmill-general": {
        // 측면(z = -stockW/2 근처)에서 x축 따라 이동
        x = -stockL / 2 + pathLen * p01
        y = stockH / 2 - ap * 0.5
        z = -stockW / 2 + 2
        break
      }
      case "roughing": {
        x = -stockL / 2 + pathLen * p01
        y = stockH / 2 - ap * 0.4
        z = 0
        break
      }
      case "slotting": {
        // zigzag: x 진행 + z 사인파
        x = -stockL / 2 + pathLen * p01
        y = stockH / 2 - ap * 0.5
        z = Math.sin(p01 * Math.PI * 4) * (stockW * 0.25)
        break
      }
      case "turning": {
        // 원통 공작물 측면에서 z 축 따라 접근
        x = -stockL / 2 + pathLen * p01
        y = 0
        z = stockH * 0.8
        break
      }
      case "drilling": {
        // 수직 왕복
        x = 0
        z = 0
        const drillPhase = (tRef.current % DRILL_PERIOD_SEC) / DRILL_PERIOD_SEC
        const descent = Math.sin(drillPhase * Math.PI) // 0→1→0
        y = stockH / 2 + 2 - stockH * DRILL_PEAK_DEPTH_RATIO * descent
        onProgress(descent, new THREE.Vector3(x, y, z))
        groupRef.current.position.set(x, y, z)
        return
      }
    }

    groupRef.current.position.set(x, y, z)
    onProgress(p01, new THREE.Vector3(x, y, z))
  })

  return <group ref={groupRef}>{children}</group>
}

// ─────────────────────────────────────────────
// Chip particles (instancedMesh)
// ─────────────────────────────────────────────
interface ChipParticlesProps {
  tipPosRef: React.MutableRefObject<THREE.Vector3>
  active: boolean
  rpm: number
  flutes: number
  vcMPerMin: number
  reducedMotion: boolean
}

interface ChipState {
  pos: THREE.Vector3
  vel: THREE.Vector3
  age: number
  alive: boolean
  color: THREE.Color
}

function ChipParticles({
  tipPosRef,
  active,
  rpm,
  flutes,
  vcMPerMin,
  reducedMotion,
}: ChipParticlesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const chipsRef = useRef<ChipState[]>(
    Array.from({ length: MAX_CHIPS }, () => ({
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      age: 0,
      alive: false,
      color: new THREE.Color(),
    })),
  )
  const spawnAccumRef = useRef(0)
  const dummy = useMemo(() => new THREE.Object3D(), [])

  useFrame((_state, delta) => {
    const mesh = meshRef.current
    if (!mesh) return
    if (reducedMotion || !active) {
      // 전부 숨김
      for (let i = 0; i < MAX_CHIPS; i++) {
        dummy.position.set(0, -9999, 0)
        dummy.scale.set(0, 0, 0)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
      return
    }

    // 스폰 레이트: flute × rpm/60 Hz, 상한 적용
    const rawHz = flutes * (rpm / 60)
    const spawnHz = Math.min(CHIP_SPAWN_HZ_MAX, rawHz * 0.5)
    spawnAccumRef.current += delta * spawnHz
    let toSpawn = Math.floor(spawnAccumRef.current)
    spawnAccumRef.current -= toSpawn

    for (let i = 0; i < MAX_CHIPS; i++) {
      const c = chipsRef.current[i]
      if (!c.alive && toSpawn > 0) {
        c.alive = true
        c.age = 0
        c.pos.copy(tipPosRef.current)
        const theta = Math.random() * Math.PI * 2
        const speed = 10 + Math.random() * 18
        c.vel.set(
          Math.cos(theta) * speed * 0.6,
          8 + Math.random() * 14,
          Math.sin(theta) * speed * 0.6,
        )
        c.color.copy(chipTempColor(vcMPerMin, 0))
        toSpawn--
      }
      if (c.alive) {
        c.age += delta
        if (c.age >= CHIP_LIFETIME_SEC) {
          c.alive = false
          dummy.position.set(0, -9999, 0)
          dummy.scale.set(0, 0, 0)
          dummy.updateMatrix()
          mesh.setMatrixAt(i, dummy.matrix)
          continue
        }
        // physics
        c.vel.y += CHIP_GRAVITY * delta
        c.pos.addScaledVector(c.vel, delta)
        const t01 = c.age / CHIP_LIFETIME_SEC
        const scale = CHIP_SIZE * (1 - t01 * 0.4)
        dummy.position.copy(c.pos)
        dummy.rotation.set(c.age * 8, c.age * 6, c.age * 4)
        dummy.scale.set(scale, scale * 0.3, scale)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        const col = chipTempColor(vcMPerMin, t01)
        mesh.setColorAt(i, col)
      } else {
        dummy.position.set(0, -9999, 0)
        dummy.scale.set(0, 0, 0)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      }
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_CHIPS]} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial vertexColors metalness={0.5} roughness={0.4} />
    </instancedMesh>
  )
}

// ─────────────────────────────────────────────
// Sparks
// ─────────────────────────────────────────────
interface SparksProps {
  tipPosRef: React.MutableRefObject<THREE.Vector3>
  vcMPerMin: number
  reducedMotion: boolean
}

interface SparkState {
  pos: THREE.Vector3
  vel: THREE.Vector3
  age: number
  alive: boolean
}

function Sparks({ tipPosRef, vcMPerMin, reducedMotion }: SparksProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const sparksRef = useRef<SparkState[]>(
    Array.from({ length: MAX_SPARKS }, () => ({
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      age: 0,
      alive: false,
    })),
  )
  const spawnAccumRef = useRef(0)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const red = useMemo(() => new THREE.Color("#ef4444"), [])
  const orange = useMemo(() => new THREE.Color("#fb923c"), [])
  const yellow = useMemo(() => new THREE.Color("#fde047"), [])

  useFrame((_state, delta) => {
    const mesh = meshRef.current
    if (!mesh) return
    if (reducedMotion || vcMPerMin < SPARK_VC_MIN) {
      for (let i = 0; i < MAX_SPARKS; i++) {
        dummy.position.set(0, -9999, 0)
        dummy.scale.set(0, 0, 0)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
      return
    }

    // Vc 가 클수록 스폰 빈도 증가
    const ratio = Math.min(1, (vcMPerMin - SPARK_VC_MIN) / (SPARK_VC_RED - SPARK_VC_MIN))
    const spawnHz = 6 + ratio * 30
    spawnAccumRef.current += delta * spawnHz
    let toSpawn = Math.floor(spawnAccumRef.current)
    spawnAccumRef.current -= toSpawn

    for (let i = 0; i < MAX_SPARKS; i++) {
      const s = sparksRef.current[i]
      if (!s.alive && toSpawn > 0) {
        s.alive = true
        s.age = 0
        s.pos.copy(tipPosRef.current)
        const theta = Math.random() * Math.PI * 2
        const speed = 20 + Math.random() * 30
        s.vel.set(Math.cos(theta) * speed, 10 + Math.random() * 20, Math.sin(theta) * speed)
        toSpawn--
      }
      if (s.alive) {
        s.age += delta
        if (s.age >= SPARK_LIFETIME_SEC) {
          s.alive = false
          dummy.position.set(0, -9999, 0)
          dummy.scale.set(0, 0, 0)
          dummy.updateMatrix()
          mesh.setMatrixAt(i, dummy.matrix)
          continue
        }
        s.vel.y += CHIP_GRAVITY * 0.4 * delta
        s.pos.addScaledVector(s.vel, delta)
        const t01 = s.age / SPARK_LIFETIME_SEC
        const scale = 0.35 * (1 - t01)
        dummy.position.copy(s.pos)
        dummy.scale.set(scale, scale, scale)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        // 색상: ratio 기준 yellow → orange → red
        const col = ratio < 0.5
          ? yellow.clone().lerp(orange, ratio / 0.5)
          : orange.clone().lerp(red, (ratio - 0.5) / 0.5)
        mesh.setColorAt(i, col)
      }
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_SPARKS]}>
      <sphereGeometry args={[0.5, 8, 8]} />
      <meshStandardMaterial
        vertexColors
        emissive="#fbbf24"
        emissiveIntensity={1.4}
        metalness={0.1}
        roughness={0.4}
      />
    </instancedMesh>
  )
}

// ─────────────────────────────────────────────
// Inner scene (Canvas 내부) — hooks 전용
// ─────────────────────────────────────────────
interface InnerSceneProps extends Cutting3DSceneProps {
  reducedMotion: boolean
}

function InnerScene(props: InnerSceneProps) {
  const {
    operationType,
    shape,
    diameter,
    flutes,
    LOC,
    OAL,
    rpm,
    Vf,
    ap,
    ae,
    stockL = DEFAULT_STOCK_L,
    stockW = DEFAULT_STOCK_W,
    stockH = DEFAULT_STOCK_H,
    materialColor,
    coating,
    darkMode = false,
    reducedMotion,
  } = props

  const [progress, setProgress] = useState(0)
  const tipPosRef = useRef(new THREE.Vector3(-stockL / 2, stockH / 2, 0))

  const grooveDepth = Math.min(stockH * GROOVE_MAX_DEPTH_RATIO, Math.max(0.5, ap))
  const grooveWidth = Math.min(
    stockW * GROOVE_MAX_WIDTH_RATIO,
    Math.max(diameter * 0.8, ae > 0 ? ae : diameter),
  )
  const vc = calcVc(diameter, rpm)
  const coatHex = coatingColor(coating)
  const stockColor = materialColor ?? (darkMode ? "#64748b" : "#94a3b8")
  const gridMajor = darkMode ? GRID_MAJOR_DARK : GRID_MAJOR_LIGHT
  const gridMinor = darkMode ? GRID_MINOR_DARK : GRID_MINOR_LIGHT

  return (
    <>
      {/* 환경 */}
      <color attach="background" args={[darkMode ? BG_DARK : BG_LIGHT]} />
      <fog attach="fog" args={[darkMode ? BG_DARK : BG_LIGHT, FOG_NEAR, FOG_FAR]} />

      {/* 조명 */}
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[50, 80, 50]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <spotLight position={[0, 100, 0]} intensity={0.6} angle={0.3} penumbra={0.5} />
      <pointLight position={[-50, 40, 30]} intensity={0.3} color="#22d3ee" />

      {/* 바닥 그리드 */}
      <group position={[0, -stockH / 2 - 0.1, 0]}>
        <gridHelper args={[GRID_SIZE, GRID_DIVISIONS, gridMajor, gridMinor]} />
      </group>

      {/* 공작물 */}
      <Stock
        L={stockL}
        W={stockW}
        H={stockH}
        color={stockColor}
        grooveDepth={grooveDepth}
        grooveWidth={grooveWidth}
        grooveProgress01={progress}
        operationType={operationType}
      />

      {/* 공구 + 이송 */}
      <ToolMover
        operationType={operationType}
        Vf={Vf}
        stockL={stockL}
        stockW={stockW}
        stockH={stockH}
        ap={grooveDepth}
        reducedMotion={reducedMotion}
        onProgress={(p, world) => {
          setProgress(p)
          // tip 은 공구 하단이므로 groupPos - LOC/2 (대략)
          tipPosRef.current.set(world.x, world.y - LOC / 2, world.z)
        }}
      >
        <Endmill
          shape={shape}
          dia={diameter}
          LOC={LOC}
          OAL={OAL}
          coatingColorHex={coatHex}
          rpm={rpm}
          reducedMotion={reducedMotion}
        />
      </ToolMover>

      {/* 파티클 */}
      <ChipParticles
        tipPosRef={tipPosRef}
        active={true}
        rpm={rpm}
        flutes={flutes}
        vcMPerMin={vc}
        reducedMotion={reducedMotion}
      />
      <Sparks tipPosRef={tipPosRef} vcMPerMin={vc} reducedMotion={reducedMotion} />
    </>
  )
}

// ─────────────────────────────────────────────
// UI Overlay (Canvas 위)
// ─────────────────────────────────────────────
interface OverlayProps {
  operationType: OperationType
  rpm: number
  Vf: number
  darkMode: boolean
  autoRotate: boolean
  onToggleAutoRotate: () => void
}

function Overlay({ operationType, rpm, Vf, darkMode, autoRotate, onToggleAutoRotate }: OverlayProps) {
  const bg = darkMode ? "rgba(15,23,42,0.75)" : "rgba(255,255,255,0.85)"
  const fg = darkMode ? "#e2e8f0" : "#0f172a"
  const border = darkMode ? "1px solid #334155" : "1px solid #cbd5e1"
  const chip: React.CSSProperties = {
    position: "absolute",
    padding: "4px 10px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    background: bg,
    color: fg,
    border,
    backdropFilter: "blur(6px)",
    pointerEvents: "none",
    letterSpacing: 0.2,
  }
  return (
    <>
      <div style={{ ...chip, top: 10, left: 10 }}>
        3D Live · {operationType}
      </div>
      <div style={{ ...chip, top: 10, right: 10 }}>
        {rpm.toLocaleString()} rpm · {Vf.toLocaleString()} mm/min
      </div>
      <div style={{ ...chip, bottom: 10, left: 10, fontWeight: 500 }}>
        드래그: 회전 · 휠: 줌
      </div>
      <button
        type="button"
        onClick={onToggleAutoRotate}
        style={{
          ...chip,
          bottom: 10,
          right: 10,
          pointerEvents: "auto",
          cursor: "pointer",
          background: autoRotate ? (darkMode ? "#1e40af" : "#3b82f6") : bg,
          color: autoRotate ? "#f8fafc" : fg,
        }}
        aria-pressed={autoRotate}
      >
        auto-rotate: {autoRotate ? "ON" : "OFF"}
      </button>
    </>
  )
}

// ─────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────
export default function Cutting3DScene(props: Cutting3DSceneProps) {
  const {
    darkMode = false,
    autoRotate: autoRotateProp = true,
    height = DEFAULT_HEIGHT,
  } = props

  const reducedMotion = usePrefersReducedMotion()
  const [autoRotate, setAutoRotate] = useState(autoRotateProp)

  useEffect(() => {
    setAutoRotate(autoRotateProp && !reducedMotion)
  }, [autoRotateProp, reducedMotion])

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height,
        borderRadius: 12,
        overflow: "hidden",
        background: darkMode ? BG_DARK : BG_LIGHT,
        border: darkMode ? "1px solid #1e293b" : "1px solid #cbd5e1",
      }}
    >
      <Canvas
        shadows
        dpr={DPR_RANGE}
        camera={{ position: CAMERA_POS, fov: CAMERA_FOV }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <Suspense fallback={null}>
          <InnerScene {...props} reducedMotion={reducedMotion} />
        </Suspense>
        <OrbitControls
          autoRotate={autoRotate && !reducedMotion}
          autoRotateSpeed={0.5}
          enableZoom
          enablePan={false}
          minDistance={40}
          maxDistance={260}
        />
      </Canvas>
      <Overlay
        operationType={props.operationType}
        rpm={props.rpm}
        Vf={props.Vf}
        darkMode={darkMode}
        autoRotate={autoRotate}
        onToggleAutoRotate={() => setAutoRotate((v) => !v)}
      />
    </div>
  )
}
