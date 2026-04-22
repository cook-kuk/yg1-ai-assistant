// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Cinematic 3D Cutting Scene (three.js / @react-three/fiber)
//
// 영화급 실시간 WebGL 3D 가공 씬 (v3 Cinematic Upgrade):
//   - 3-point lighting (key · fill · rim) + tip point light
//   - PBR-quality 공구 (metalness 1.0 샹크 · coating-tinted flute · spiral groove)
//   - procedural-noise 텍스처 공작물 + stepped machined surface
//   - 300개 chip instancedMesh (온도 기반 emissive)
//   - 100개 spark (포물선 궤적 · bloom-emissive)
//   - EffectComposer (Bloom · ChromaticAberration · Vignette) — 모바일 disable
//   - 초기 dolly-in 카메라 애니메이션
//   - Environment preset="warehouse"
//
// 주의:
//   - cutting-simulator-v2.tsx 는 절대 건드리지 않는다. 본 컴포넌트는 독립 마운트 전용.
//   - Cutting3DSceneProps 인터페이스 변경 금지.
//   - 매직넘버는 본 파일 상단 SSOT 블록에 집약.
//   - prefers-reduced-motion 시 회전/이동/파티클 축소 + 포스트프로세싱 disable.
"use client"

import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { OrbitControls, Environment } from "@react-three/drei"
import {
  EffectComposer,
  Bloom,
  ChromaticAberration,
  Vignette,
} from "@react-three/postprocessing"
import { BlendFunction } from "postprocessing"
import * as THREE from "three"

// ─────────────────────────────────────────────
// 로컬 SSOT (Cinematic tuned)
// ─────────────────────────────────────────────
const DEFAULT_HEIGHT = 420
const DEFAULT_STOCK_L = 80
const DEFAULT_STOCK_W = 60
const DEFAULT_STOCK_H = 30

const CAMERA_POS_START: [number, number, number] = [120, 90, 150]
const CAMERA_POS_END: [number, number, number] = [80, 60, 100]
const CAMERA_FOV = 28
const CAMERA_DOLLY_SEC = 3.0
const DPR_RANGE: [number, number] = [1, 2]

const FOG_NEAR = 100
const FOG_FAR = 400

const BG_DARK = "#05070d"
const BG_LIGHT = "#f1f5f9"
const GRID_MAJOR_DARK = "#334155" // slate-700
const GRID_MINOR_DARK = "#1e293b" // slate-800
const GRID_MAJOR_LIGHT = "#cbd5e1"
const GRID_MINOR_LIGHT = "#e2e8f0"
const GRID_SIZE = 220
const GRID_DIVISIONS = 22

// 엔드밀 시각 스케일
const SHANK_RATIO = 0.95
const SHANK_LEN_RATIO = 1.4
const HELIX_STRIPES = 18            // spiral resolution (24 was 6)
const HELIX_THICKNESS = 0.07
const TIP_SEGMENTS = 48             // 24 → 48

// 회전
const ROTATION_VISUAL_MULT = 0.06

// 이송
const FEED_UNITS_PER_MM = 1.0
const FEED_VISUAL_MULT = 0.08

// 칩 파티클 ×3
const MAX_CHIPS = 300
const CHIP_LIFETIME_SEC = 1.2
const CHIP_SPAWN_HZ_MAX = 120
const CHIP_GRAVITY = -35
const CHIP_SIZE = 0.55
const CHIP_AIR_DRAG = 0.35

// 스파크 ×2.5
const MAX_SPARKS = 100
const SPARK_LIFETIME_SEC = 0.42
const SPARK_VC_MIN = 250
const SPARK_VC_RED = 400
const SPARK_AIR_DRAG = 0.55
const SPARK_EMISSIVE = 2.5

// Groove
const GROOVE_MAX_DEPTH_RATIO = 0.5
const GROOVE_MAX_WIDTH_RATIO = 0.6
const STEPPED_PATTERN_ROWS = 4       // 얕은 홈 개수

// 드릴링
const DRILL_PERIOD_SEC = 2.4
const DRILL_PEAK_DEPTH_RATIO = 0.55

// 공구 tip emissive point light
const TIP_LIGHT_COLOR = "#ff8844"
const TIP_LIGHT_INTENSITY = 1.8
const TIP_LIGHT_DISTANCE = 30

// Polished carbide PBR (공구 본체)
const TOOL_PBR_COLOR = "#d4d4d4"
const TOOL_PBR_METALNESS = 1.0
const TOOL_PBR_ROUGHNESS = 0.25

// Stock materials (PBR 팔레트)
export type StockMaterialKind = "steel" | "aluminum" | "copper" | "titanium"
interface StockMaterialStyle {
  color: string
  metalness: number
  roughness: number
}
const STOCK_MATERIAL_STYLES: Record<StockMaterialKind, StockMaterialStyle> = {
  steel:     { color: "#9aa4b2", metalness: 0.3, roughness: 0.6 },
  aluminum:  { color: "#c9cdd2", metalness: 0.3, roughness: 0.6 },
  copper:    { color: "#c97a4a", metalness: 0.3, roughness: 0.6 },
  titanium:  { color: "#a5aab0", metalness: 0.3, roughness: 0.6 },
}

// Coolant stream (particle cone)
const MAX_COOLANT_PARTICLES = 90
const COOLANT_SPAWN_HZ = 180
const COOLANT_LIFETIME_SEC = 0.5
const COOLANT_COLOR = "#7fd4ff"
const COOLANT_SPEED = 44
const COOLANT_SPREAD = 0.08

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
  diameter: number
  flutes: number
  LOC: number
  OAL: number
  rpm: number
  Vf: number
  ap: number
  ae: number
  stockL?: number
  stockW?: number
  stockH?: number
  materialColor?: string
  coating?: string
  darkMode?: boolean
  autoRotate?: boolean
  height?: number
  stockMaterial?: StockMaterialKind
  fluteCount?: 2 | 3 | 4 | 5 | 6
  coolant?: boolean
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
// Coating tints + emissive strengths
interface CoatingStyle {
  color: string
  emissive: string
  emissiveIntensity: number
}
const COATING_STYLES: Record<string, CoatingStyle> = {
  altin: { color: "#fbbf24", emissive: "#d97706", emissiveIntensity: 0.12 },
  altinn: { color: "#a78bfa", emissive: "#7c3aed", emissiveIntensity: 0.28 }, // AlTiN 보라 발광
  tin: { color: "#f59e0b", emissive: "#b45309", emissiveIntensity: 0.18 },
  ticn: { color: "#60a5fa", emissive: "#2563eb", emissiveIntensity: 0.15 },
  alcrn: { color: "#38bdf8", emissive: "#0284c7", emissiveIntensity: 0.3 },   // AlCrN 블루
  dlc: { color: "#a78bfa", emissive: "#6d28d9", emissiveIntensity: 0.22 },
  tialn: { color: "#fde68a", emissive: "#f59e0b", emissiveIntensity: 0.1 },
  uncoated: { color: "#d4d4d8", emissive: "#71717a", emissiveIntensity: 0.02 },
}

function coatingStyle(coating?: string): CoatingStyle {
  if (!coating) return COATING_STYLES.uncoated
  const key = coating.toLowerCase().replace(/[^a-z]/g, "")
  return COATING_STYLES[key] ?? COATING_STYLES.uncoated
}

function chipTempColor(vcMPerMin: number, t01: number): THREE.Color {
  const intensity = Math.max(0, Math.min(1, vcMPerMin / 400)) * (1 - t01 * 0.6)
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

function calcVc(dia: number, rpm: number): number {
  return (Math.PI * dia * rpm) / 1000
}

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

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined") return
    const mq = window.matchMedia("(max-width: 768px), (pointer: coarse)")
    const update = () => setMobile(mq.matches)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])
  return mobile
}

// ─────────────────────────────────────────────
// Procedural workpiece texture (noise-based CanvasTexture)
// ─────────────────────────────────────────────
function useWorkpieceTexture(baseColor: string): THREE.CanvasTexture | null {
  return useMemo(() => {
    if (typeof document === "undefined") return null
    const size = 256
    const canvas = document.createElement("canvas")
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    // 기본 채움
    ctx.fillStyle = baseColor
    ctx.fillRect(0, 0, size, size)
    // 가벼운 노이즈 overlay
    const img = ctx.getImageData(0, 0, size, size)
    const data = img.data
    for (let i = 0; i < data.length; i += 4) {
      const n = (Math.random() - 0.5) * 28
      data[i] = Math.max(0, Math.min(255, data[i] + n))
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n))
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n))
    }
    ctx.putImageData(img, 0, 0)
    // 가로 brushed metal 라인
    ctx.globalAlpha = 0.12
    ctx.strokeStyle = "#000"
    for (let y = 0; y < size; y += 2) {
      ctx.beginPath()
      ctx.moveTo(0, y + Math.random())
      ctx.lineTo(size, y + Math.random())
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(2, 1.2)
    tex.anisotropy = 4
    return tex
  }, [baseColor])
}

// ─────────────────────────────────────────────
// Workpiece (Stock) + stepped groove
// ─────────────────────────────────────────────
interface StockProps {
  L: number
  W: number
  H: number
  color: string
  grooveDepth: number
  grooveWidth: number
  grooveProgress01: number
  operationType: OperationType
  stockMaterial: StockMaterialKind
}

function Stock({ L, W, H, color, grooveDepth, grooveWidth, grooveProgress01, operationType, stockMaterial }: StockProps) {
  const cutLen = Math.max(0.001, L * grooveProgress01)
  const isTurning = operationType === "turning"
  const isDrilling = operationType === "drilling"
  const tex = useWorkpieceTexture(color)
  const mat = STOCK_MATERIAL_STYLES[stockMaterial]

  return (
    <group>
      {/* 본체 — PBR (metalness/roughness depends on stockMaterial) */}
      {isTurning ? (
        <mesh castShadow receiveShadow rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[H * 0.7, H * 0.7, L, 48]} />
          <meshStandardMaterial
            color={color}
            map={tex ?? undefined}
            metalness={mat.metalness}
            roughness={mat.roughness}
            envMapIntensity={1.0}
          />
        </mesh>
      ) : (
        <mesh castShadow receiveShadow>
          <boxGeometry args={[L, H, W]} />
          <meshStandardMaterial
            color={color}
            map={tex ?? undefined}
            metalness={mat.metalness}
            roughness={mat.roughness}
            envMapIntensity={1.0}
          />
        </mesh>
      )}

      {/* Stepped pattern — 얕은 홈들 */}
      {!isTurning && !isDrilling && cutLen > 0.01 && (
        <group>
          {/* 메인 홈 */}
          <mesh position={[-L / 2 + cutLen / 2, H / 2 - grooveDepth / 2 + 0.01, 0]}>
            <boxGeometry args={[cutLen, grooveDepth, grooveWidth]} />
            <meshStandardMaterial
              color="#0f172a"
              metalness={0.35}
              roughness={0.8}
              emissive="#1e293b"
              emissiveIntensity={0.15}
            />
          </mesh>
          {/* stepped 얕은 홈들 (기어자국) */}
          {Array.from({ length: STEPPED_PATTERN_ROWS }).map((_, i) => {
            const step = (i + 1) / (STEPPED_PATTERN_ROWS + 1)
            const zOff = (step - 0.5) * grooveWidth * 0.9
            const depth = grooveDepth * 0.35
            return (
              <mesh
                key={i}
                position={[-L / 2 + cutLen / 2, H / 2 - depth / 2 + 0.02, zOff]}
              >
                <boxGeometry args={[cutLen * 0.98, depth, grooveWidth * 0.08]} />
                <meshStandardMaterial
                  color="#020617"
                  metalness={0.15}
                  roughness={0.95}
                />
              </mesh>
            )
          })}
        </group>
      )}

      {isDrilling && grooveProgress01 > 0.02 && (
        <mesh position={[0, H / 2 - (H * grooveProgress01) / 2, 0]}>
          <cylinderGeometry args={[grooveWidth / 2, grooveWidth / 2, H * grooveProgress01, 28]} />
          <meshStandardMaterial color="#020617" metalness={0.15} roughness={0.95} />
        </mesh>
      )}
    </group>
  )
}

// ─────────────────────────────────────────────
// Endmill — PBR-quality, spiral helix flutes
// ─────────────────────────────────────────────
interface EndmillProps {
  shape: EndmillShape
  dia: number
  LOC: number
  OAL: number
  coatingStyle: CoatingStyle
  rpm: number
  reducedMotion: boolean
  fluteCount: 2 | 3 | 4 | 5 | 6
}

// Build a helical flute groove as an ExtrudeGeometry that sweeps a small
// cross-section along a spiral path. Reused per flute index.
function buildHelicalFluteGeometry(
  fluteR: number,
  LOC: number,
  helixTurns: number,
  grooveWidth: number,
  grooveDepth: number,
  segments: number,
): THREE.BufferGeometry {
  // Cross-section (almond / lens shape) in XY plane; extrude along Z then bend.
  // Simplified: use a TubeGeometry along a helix curve — easier & robust.
  class HelixCurve extends THREE.Curve<THREE.Vector3> {
    constructor(
      private r: number,
      private h: number,
      private turns: number,
    ) {
      super()
    }
    getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
      const a = this.turns * Math.PI * 2 * t
      return target.set(
        Math.cos(a) * this.r,
        -this.h / 2 + this.h * t,
        Math.sin(a) * this.r,
      )
    }
  }
  const curve = new HelixCurve(fluteR * 0.98, LOC, helixTurns)
  const tube = new THREE.TubeGeometry(curve, segments, grooveWidth * 0.5, 8, false)
  // Slightly squash tube on radial axis to mimic a scoop
  tube.scale(1.0, 1.0, grooveDepth > 0 ? 1.0 : 1.0)
  return tube
}

function Endmill({ shape, dia, LOC, OAL, coatingStyle: cs, rpm, reducedMotion, fluteCount }: EndmillProps) {
  const groupRef = useRef<THREE.Group>(null)
  const shankR = (dia / 2) * SHANK_RATIO
  const shankLen = Math.max(4, OAL - LOC) * SHANK_LEN_RATIO * 0.5
  const fluteR = dia / 2

  useFrame((_state, delta) => {
    if (!groupRef.current || reducedMotion) return
    const angVel = (rpm / 60) * Math.PI * 2 * ROTATION_VISUAL_MULT
    groupRef.current.rotation.y += angVel * delta
  })

  // Build helical flute geometry once per (dia, LOC, fluteCount).
  const fluteGeom = useMemo(() => {
    const helixTurns = 1.1
    const grooveWidth = Math.max(0.25, fluteR * 0.28)
    const grooveDepth = fluteR * 0.22
    return buildHelicalFluteGeometry(fluteR, LOC, helixTurns, grooveWidth, grooveDepth, 48)
  }, [fluteR, LOC])

  // Cutting-edge helix (slight radial offset, brighter) — one per flute
  const edgeGeom = useMemo(() => {
    const helixTurns = 1.1
    // TubeGeometry는 CurvePath/Curve 인스턴스 요구 — function 기반 Curve 로 구성
    const curve = new (THREE.Curve as unknown as new () => THREE.Curve<THREE.Vector3>)()
    ;(curve as unknown as { getPoint: (t: number, target?: THREE.Vector3) => THREE.Vector3 }).getPoint = (t: number, target = new THREE.Vector3()) => {
      const a = helixTurns * Math.PI * 2 * t
      return target.set(
        Math.cos(a) * (fluteR * 1.015),
        -LOC / 2 + LOC * t,
        Math.sin(a) * (fluteR * 1.015),
      )
    }
    return new THREE.TubeGeometry(curve, 48, Math.max(0.06, fluteR * 0.04), 6, false)
  }, [fluteR, LOC])

  const fluteAngles = useMemo(
    () => Array.from({ length: fluteCount }, (_, i) => (i / fluteCount) * Math.PI * 2),
    [fluteCount],
  )

  return (
    <group ref={groupRef}>
      {/* Shank — PBR polished carbide */}
      <mesh position={[0, shankLen / 2 + LOC / 2, 0]} castShadow>
        <cylinderGeometry args={[shankR, shankR, shankLen, 32]} />
        <meshStandardMaterial
          color={TOOL_PBR_COLOR}
          metalness={TOOL_PBR_METALNESS}
          roughness={TOOL_PBR_ROUGHNESS}
          envMapIntensity={1.5}
        />
      </mesh>

      {/* Shank-to-flute fillet */}
      <mesh position={[0, LOC / 2, 0]} castShadow>
        <cylinderGeometry args={[shankR * 1.02, fluteR * 1.02, Math.max(0.6, dia * 0.1), 24]} />
        <meshStandardMaterial
          color={TOOL_PBR_COLOR}
          metalness={TOOL_PBR_METALNESS}
          roughness={TOOL_PBR_ROUGHNESS + 0.05}
          envMapIntensity={1.3}
        />
      </mesh>

      {/* Flute body — polished carbide PBR base */}
      <mesh position={[0, 0, 0]} castShadow>
        <cylinderGeometry args={[fluteR, fluteR, LOC, 48]} />
        <meshStandardMaterial
          color={TOOL_PBR_COLOR}
          metalness={TOOL_PBR_METALNESS}
          roughness={TOOL_PBR_ROUGHNESS}
          emissive={cs.emissive}
          emissiveIntensity={cs.emissiveIntensity * 0.5}
          envMapIntensity={1.4}
        />
      </mesh>

      {/* Helical flute channels — proper tube-sweep along helix, one per flute */}
      {fluteAngles.map((a, i) => (
        <group key={`f-${i}`} rotation={[0, a, 0]}>
          <mesh castShadow geometry={fluteGeom}>
            <meshStandardMaterial
              color="#1f2937"
              metalness={0.6}
              roughness={0.55}
              emissive={cs.emissive}
              emissiveIntensity={cs.emissiveIntensity * 0.3}
            />
          </mesh>
          {/* Cutting edge — slight radial offset, brighter coating tint */}
          <mesh castShadow geometry={edgeGeom}>
            <meshStandardMaterial
              color={cs.color}
              metalness={0.95}
              roughness={0.18}
              emissive={cs.emissive}
              emissiveIntensity={cs.emissiveIntensity * 1.4}
              envMapIntensity={1.6}
            />
          </mesh>
        </group>
      ))}

      {/* Tip shapes — PBR polished carbide + coating emissive tint */}
      {shape === "square" && (
        <mesh position={[0, -LOC / 2 - 0.05, 0]} castShadow>
          <cylinderGeometry args={[fluteR, fluteR, 0.4, TIP_SEGMENTS]} />
          <meshStandardMaterial
            color={TOOL_PBR_COLOR}
            metalness={TOOL_PBR_METALNESS}
            roughness={TOOL_PBR_ROUGHNESS}
          />
        </mesh>
      )}
      {shape === "ball" && (
        <mesh position={[0, -LOC / 2, 0]} rotation={[Math.PI, 0, 0]} castShadow>
          <sphereGeometry args={[fluteR, TIP_SEGMENTS, TIP_SEGMENTS, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial
            color={TOOL_PBR_COLOR}
            metalness={TOOL_PBR_METALNESS}
            roughness={TOOL_PBR_ROUGHNESS}
            emissive={cs.emissive}
            emissiveIntensity={cs.emissiveIntensity * 0.6}
          />
        </mesh>
      )}
      {shape === "radius" && (
        <group position={[0, -LOC / 2, 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[fluteR, fluteR * 0.85, fluteR * 0.4, TIP_SEGMENTS]} />
            <meshStandardMaterial
              color={TOOL_PBR_COLOR}
              metalness={TOOL_PBR_METALNESS}
              roughness={TOOL_PBR_ROUGHNESS}
              emissive={cs.emissive}
              emissiveIntensity={cs.emissiveIntensity * 0.6}
            />
          </mesh>
          <mesh position={[0, -fluteR * 0.2, 0]} castShadow>
            <sphereGeometry args={[fluteR * 0.85, TIP_SEGMENTS, TIP_SEGMENTS, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial
              color={TOOL_PBR_COLOR}
              metalness={TOOL_PBR_METALNESS}
              roughness={TOOL_PBR_ROUGHNESS}
              emissive={cs.emissive}
              emissiveIntensity={cs.emissiveIntensity * 0.6}
            />
          </mesh>
        </group>
      )}
      {shape === "chamfer" && (
        <mesh position={[0, -LOC / 2 - dia * 0.15, 0]} rotation={[Math.PI, 0, 0]} castShadow>
          <coneGeometry args={[fluteR, dia * 0.3, TIP_SEGMENTS]} />
          <meshStandardMaterial
            color={TOOL_PBR_COLOR}
            metalness={TOOL_PBR_METALNESS}
            roughness={TOOL_PBR_ROUGHNESS}
            emissive={cs.emissive}
            emissiveIntensity={cs.emissiveIntensity * 0.6}
          />
        </mesh>
      )}

      {/* Tip emissive point light — 공구 끝 작은 orange 불빛 */}
      <pointLight
        position={[0, -LOC / 2 - 1, 0]}
        color={TIP_LIGHT_COLOR}
        intensity={TIP_LIGHT_INTENSITY}
        distance={TIP_LIGHT_DISTANCE}
        decay={2}
      />
    </group>
  )
}

// ─────────────────────────────────────────────
// Tool mover
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
      groupRef.current.position.set(-stockL / 2, stockH / 2 + 2, 0)
      onProgress(0, groupRef.current.position.clone())
      return
    }
    const unitsPerSec = (Vf / 60) * FEED_UNITS_PER_MM * FEED_VISUAL_MULT
    tRef.current += delta * Math.max(0.5, unitsPerSec)

    const pathLen = stockL
    const period = Math.max(2, pathLen)
    const tt = (tRef.current % (period * 2))
    const forward = tt <= period
    const phase = forward ? tt / period : 1 - (tt - period) / period
    const p01 = phase

    let x = 0
    let y = stockH / 2 + 1
    let z = 0

    switch (operationType) {
      case "endmill-general": {
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
        x = -stockL / 2 + pathLen * p01
        y = stockH / 2 - ap * 0.5
        z = Math.sin(p01 * Math.PI * 4) * (stockW * 0.25)
        break
      }
      case "turning": {
        x = -stockL / 2 + pathLen * p01
        y = 0
        z = stockH * 0.8
        break
      }
      case "drilling": {
        x = 0
        z = 0
        const drillPhase = (tRef.current % DRILL_PERIOD_SEC) / DRILL_PERIOD_SEC
        const descent = Math.sin(drillPhase * Math.PI)
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
// Chip particles — 300개, emissive glow, 다양한 크기/회전
// ─────────────────────────────────────────────
interface ChipParticlesProps {
  tipPosRef: React.MutableRefObject<THREE.Vector3>
  active: boolean
  rpm: number
  flutes: number
  vcMPerMin: number
  reducedMotion: boolean
  maxChips: number
}

interface ChipState {
  pos: THREE.Vector3
  vel: THREE.Vector3
  age: number
  alive: boolean
  color: THREE.Color
  sizeMult: number
  rotAxis: THREE.Vector3
  rotSpeed: number
}

function ChipParticles({
  tipPosRef,
  active,
  rpm,
  flutes,
  vcMPerMin,
  reducedMotion,
  maxChips,
}: ChipParticlesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const chipsRef = useRef<ChipState[]>(
    Array.from({ length: maxChips }, () => ({
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      age: 0,
      alive: false,
      color: new THREE.Color(),
      sizeMult: 1,
      rotAxis: new THREE.Vector3(0, 1, 0),
      rotSpeed: 1,
    })),
  )
  const spawnAccumRef = useRef(0)
  const dummy = useMemo(() => new THREE.Object3D(), [])

  useFrame((_state, delta) => {
    const mesh = meshRef.current
    if (!mesh) return
    if (reducedMotion || !active) {
      for (let i = 0; i < maxChips; i++) {
        dummy.position.set(0, -9999, 0)
        dummy.scale.set(0, 0, 0)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
      return
    }

    const rawHz = flutes * (rpm / 60)
    const spawnHz = Math.min(CHIP_SPAWN_HZ_MAX, rawHz * 0.8)
    spawnAccumRef.current += delta * spawnHz
    let toSpawn = Math.floor(spawnAccumRef.current)
    spawnAccumRef.current -= toSpawn

    for (let i = 0; i < maxChips; i++) {
      const c = chipsRef.current[i]
      if (!c.alive && toSpawn > 0) {
        c.alive = true
        c.age = 0
        c.pos.copy(tipPosRef.current)
        const theta = Math.random() * Math.PI * 2
        const speed = 10 + Math.random() * 22
        c.vel.set(
          Math.cos(theta) * speed * 0.7,
          8 + Math.random() * 16,
          Math.sin(theta) * speed * 0.7,
        )
        c.color.copy(chipTempColor(vcMPerMin, 0))
        c.sizeMult = 0.6 + Math.random() * 0.9 // 다양화
        c.rotAxis.set(
          Math.random() - 0.5,
          Math.random() - 0.5,
          Math.random() - 0.5,
        ).normalize()
        c.rotSpeed = 4 + Math.random() * 10
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
        // physics: 중력 + 공기저항
        c.vel.y += CHIP_GRAVITY * delta
        c.vel.multiplyScalar(1 - CHIP_AIR_DRAG * delta)
        c.pos.addScaledVector(c.vel, delta)
        const t01 = c.age / CHIP_LIFETIME_SEC
        const scale = CHIP_SIZE * c.sizeMult * (1 - t01 * 0.4)
        dummy.position.copy(c.pos)
        dummy.quaternion.setFromAxisAngle(c.rotAxis, c.age * c.rotSpeed)
        dummy.scale.set(scale, scale * 0.28, scale * 1.2)
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
    <instancedMesh ref={meshRef} args={[undefined, undefined, maxChips]} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        vertexColors
        metalness={0.75}
        roughness={0.32}
        emissive="#ff6600"
        emissiveIntensity={0.35}
      />
    </instancedMesh>
  )
}

// ─────────────────────────────────────────────
// Sparks — 100, parabolic trajectory, bloom-emissive
// ─────────────────────────────────────────────
interface SparksProps {
  tipPosRef: React.MutableRefObject<THREE.Vector3>
  vcMPerMin: number
  reducedMotion: boolean
  maxSparks: number
}

interface SparkState {
  pos: THREE.Vector3
  vel: THREE.Vector3
  age: number
  alive: boolean
}

function Sparks({ tipPosRef, vcMPerMin, reducedMotion, maxSparks }: SparksProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const sparksRef = useRef<SparkState[]>(
    Array.from({ length: maxSparks }, () => ({
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
  const white = useMemo(() => new THREE.Color("#fef9c3"), [])

  useFrame((_state, delta) => {
    const mesh = meshRef.current
    if (!mesh) return
    if (reducedMotion || vcMPerMin < SPARK_VC_MIN) {
      for (let i = 0; i < maxSparks; i++) {
        dummy.position.set(0, -9999, 0)
        dummy.scale.set(0, 0, 0)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
      return
    }

    const ratio = Math.min(1, (vcMPerMin - SPARK_VC_MIN) / (SPARK_VC_RED - SPARK_VC_MIN))
    const spawnHz = 10 + ratio * 60
    spawnAccumRef.current += delta * spawnHz
    let toSpawn = Math.floor(spawnAccumRef.current)
    spawnAccumRef.current -= toSpawn

    for (let i = 0; i < maxSparks; i++) {
      const s = sparksRef.current[i]
      if (!s.alive && toSpawn > 0) {
        s.alive = true
        s.age = 0
        s.pos.copy(tipPosRef.current)
        const theta = Math.random() * Math.PI * 2
        const speed = 22 + Math.random() * 36
        const upBias = 12 + Math.random() * 22
        s.vel.set(Math.cos(theta) * speed, upBias, Math.sin(theta) * speed)
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
        // 포물선 궤적: 중력 + 공기저항
        s.vel.y += CHIP_GRAVITY * 0.6 * delta
        s.vel.multiplyScalar(1 - SPARK_AIR_DRAG * delta)
        s.pos.addScaledVector(s.vel, delta)
        const t01 = s.age / SPARK_LIFETIME_SEC
        const scale = 0.45 * (1 - t01 * 0.85)
        dummy.position.copy(s.pos)
        // 속도 방향으로 늘어뜨림 (motion streak)
        const velLen = s.vel.length()
        dummy.scale.set(scale, scale, scale + Math.min(1.2, velLen * 0.02))
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        // color: white-hot → yellow → orange → red
        let col: THREE.Color
        if (t01 < 0.2) {
          col = white.clone().lerp(yellow, t01 / 0.2)
        } else if (t01 < 0.5) {
          col = yellow.clone().lerp(orange, (t01 - 0.2) / 0.3)
        } else {
          col = orange.clone().lerp(red, (t01 - 0.5) / 0.5)
        }
        mesh.setColorAt(i, col)
      }
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, maxSparks]}>
      <sphereGeometry args={[0.55, 10, 10]} />
      <meshStandardMaterial
        vertexColors
        emissive="#fde047"
        emissiveIntensity={SPARK_EMISSIVE}
        metalness={0.05}
        roughness={0.3}
        toneMapped={false}
      />
    </instancedMesh>
  )
}

// ─────────────────────────────────────────────
// Coolant stream — thin particle cone emitted from side toward contact point
// ─────────────────────────────────────────────
interface CoolantProps {
  tipPosRef: React.MutableRefObject<THREE.Vector3>
  active: boolean
  reducedMotion: boolean
}

interface CoolantState {
  pos: THREE.Vector3
  vel: THREE.Vector3
  age: number
  alive: boolean
}

function Coolant({ tipPosRef, active, reducedMotion }: CoolantProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const dropsRef = useRef<CoolantState[]>(
    Array.from({ length: MAX_COOLANT_PARTICLES }, () => ({
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      age: 0,
      alive: false,
    })),
  )
  const spawnAccumRef = useRef(0)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  // Nozzle offset (to the side/above the tool tip in world space)
  const nozzleOffset = useMemo(() => new THREE.Vector3(18, 16, 10), [])

  useFrame((_state, delta) => {
    const mesh = meshRef.current
    if (!mesh) return
    if (!active || reducedMotion) {
      for (let i = 0; i < MAX_COOLANT_PARTICLES; i++) {
        dummy.position.set(0, -9999, 0)
        dummy.scale.set(0, 0, 0)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
      return
    }

    spawnAccumRef.current += delta * COOLANT_SPAWN_HZ
    let toSpawn = Math.floor(spawnAccumRef.current)
    spawnAccumRef.current -= toSpawn

    // Nozzle source in world coords
    const source = tipPosRef.current.clone().add(nozzleOffset)
    // Direction from nozzle toward tip
    const dir = tipPosRef.current.clone().sub(source).normalize()

    for (let i = 0; i < MAX_COOLANT_PARTICLES; i++) {
      const p = dropsRef.current[i]
      if (!p.alive && toSpawn > 0) {
        p.alive = true
        p.age = 0
        p.pos.copy(source)
        // Spread: small random jitter perpendicular
        const jx = (Math.random() - 0.5) * COOLANT_SPREAD
        const jy = (Math.random() - 0.5) * COOLANT_SPREAD
        const jz = (Math.random() - 0.5) * COOLANT_SPREAD
        p.vel
          .copy(dir)
          .multiplyScalar(COOLANT_SPEED)
          .add(new THREE.Vector3(jx, jy, jz).multiplyScalar(COOLANT_SPEED))
        toSpawn--
      }
      if (p.alive) {
        p.age += delta
        if (p.age >= COOLANT_LIFETIME_SEC) {
          p.alive = false
          dummy.position.set(0, -9999, 0)
          dummy.scale.set(0, 0, 0)
          dummy.updateMatrix()
          mesh.setMatrixAt(i, dummy.matrix)
          continue
        }
        // Slight gravity
        p.vel.y += CHIP_GRAVITY * 0.15 * delta
        p.pos.addScaledVector(p.vel, delta)
        const t01 = p.age / COOLANT_LIFETIME_SEC
        const scale = 0.35 * (1 - t01 * 0.5)
        dummy.position.copy(p.pos)
        // Streak along velocity
        const velLen = p.vel.length()
        dummy.scale.set(scale, scale, scale + Math.min(1.6, velLen * 0.015))
        // Orient streak toward velocity
        const q = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          p.vel.clone().normalize(),
        )
        dummy.quaternion.copy(q)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      }
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_COOLANT_PARTICLES]}>
      <cylinderGeometry args={[0.12, 0.18, 1, 6]} />
      <meshStandardMaterial
        color={COOLANT_COLOR}
        emissive={COOLANT_COLOR}
        emissiveIntensity={0.8}
        metalness={0.0}
        roughness={0.2}
        transparent
        opacity={0.65}
        toneMapped={false}
      />
    </instancedMesh>
  )
}

// ─────────────────────────────────────────────
// Camera Dolly-in controller (마운트 시 카메라 zoom-in)
// ─────────────────────────────────────────────
function CameraDolly({ active }: { active: boolean }) {
  const { camera } = useThree()
  const tRef = useRef(0)
  const doneRef = useRef(false)

  useEffect(() => {
    camera.position.set(...CAMERA_POS_START)
    camera.lookAt(0, 0, 0)
  }, [camera])

  useFrame((_s, delta) => {
    if (!active || doneRef.current) return
    tRef.current += delta
    const t = Math.min(1, tRef.current / CAMERA_DOLLY_SEC)
    // easeOutCubic
    const e = 1 - Math.pow(1 - t, 3)
    const lerp = (a: number, b: number) => a + (b - a) * e
    camera.position.set(
      lerp(CAMERA_POS_START[0], CAMERA_POS_END[0]),
      lerp(CAMERA_POS_START[1], CAMERA_POS_END[1]),
      lerp(CAMERA_POS_START[2], CAMERA_POS_END[2]),
    )
    camera.lookAt(0, 0, 0)
    if (t >= 1) doneRef.current = true
  })
  return null
}

// ─────────────────────────────────────────────
// Inner scene
// ─────────────────────────────────────────────
interface InnerSceneProps extends Cutting3DSceneProps {
  reducedMotion: boolean
  isMobile: boolean
  enableEnvironment: boolean
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
    isMobile,
    enableEnvironment,
    stockMaterial = "steel",
    fluteCount,
    coolant = false,
  } = props

  const [progress, setProgress] = useState(0)
  const tipPosRef = useRef(new THREE.Vector3(-stockL / 2, stockH / 2, 0))

  const grooveDepth = Math.min(stockH * GROOVE_MAX_DEPTH_RATIO, Math.max(0.5, ap))
  const grooveWidth = Math.min(
    stockW * GROOVE_MAX_WIDTH_RATIO,
    Math.max(diameter * 0.8, ae > 0 ? ae : diameter),
  )
  const vc = calcVc(diameter, rpm)
  const cs = coatingStyle(coating)
  const stockColor = materialColor ?? STOCK_MATERIAL_STYLES[stockMaterial].color
  // Clamp fluteCount prop to supported set; fall back to runtime `flutes` if valid, else 4.
  const allowedFlutes: Array<2 | 3 | 4 | 5 | 6> = [2, 3, 4, 5, 6]
  const resolvedFluteCount: 2 | 3 | 4 | 5 | 6 =
    fluteCount ??
    ((allowedFlutes as number[]).includes(flutes)
      ? (flutes as 2 | 3 | 4 | 5 | 6)
      : 4)
  const gridMajor = darkMode ? GRID_MAJOR_DARK : GRID_MAJOR_LIGHT
  const gridMinor = darkMode ? GRID_MINOR_DARK : GRID_MINOR_LIGHT

  // 모바일/reducedMotion일 때 파티클 축소
  const chipBudget = reducedMotion || isMobile ? Math.floor(MAX_CHIPS * 0.5) : MAX_CHIPS
  const sparkBudget = reducedMotion || isMobile ? Math.floor(MAX_SPARKS * 0.5) : MAX_SPARKS

  return (
    <>
      {/* 환경 */}
      <color attach="background" args={[darkMode ? BG_DARK : BG_LIGHT]} />
      <fog attach="fog" args={[darkMode ? BG_DARK : BG_LIGHT, FOG_NEAR, FOG_FAR]} />

      {enableEnvironment && (
        <Suspense fallback={null}>
          <Environment preset="warehouse" background={false} />
        </Suspense>
      )}

      {/* 3-point lighting */}
      {/* Key: cool white directional (8000K-ish) w/ shadows */}
      <directionalLight
        position={[60, 90, 50]}
        intensity={1.6}
        color="#e0ecff"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
        shadow-camera-near={1}
        shadow-camera-far={260}
        shadow-bias={-0.0005}
      />
      {/* Fill: warm ambient */}
      <ambientLight intensity={0.3} color="#ffd9b0" />
      {/* Rim: back spotlight cyan accent */}
      <spotLight
        position={[-40, 60, -80]}
        intensity={1.4}
        angle={0.5}
        penumbra={0.7}
        color="#22d3ee"
        distance={260}
        decay={2}
      />
      {/* Subtle floor bounce */}
      <hemisphereLight args={["#93c5fd", "#1e293b", 0.25]} />

      {/* 바닥 그리드 + shadow-catcher 플레인 */}
      <group position={[0, -stockH / 2 - 0.1, 0]}>
        <gridHelper args={[GRID_SIZE, GRID_DIVISIONS, gridMajor, gridMinor]} />
        {/* 그림자 받는 바닥면 (미세한 offset) */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
          <planeGeometry args={[GRID_SIZE, GRID_SIZE]} />
          <shadowMaterial transparent opacity={0.35} />
        </mesh>
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
        stockMaterial={stockMaterial}
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
          tipPosRef.current.set(world.x, world.y - LOC / 2, world.z)
        }}
      >
        <Endmill
          shape={shape}
          dia={diameter}
          LOC={LOC}
          OAL={OAL}
          coatingStyle={cs}
          rpm={rpm}
          reducedMotion={reducedMotion}
          fluteCount={resolvedFluteCount}
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
        maxChips={chipBudget}
      />
      <Sparks
        tipPosRef={tipPosRef}
        vcMPerMin={vc}
        reducedMotion={reducedMotion}
        maxSparks={sparkBudget}
      />

      {/* 냉각유(coolant) 분사 스트림 */}
      <Coolant tipPosRef={tipPosRef} active={coolant} reducedMotion={reducedMotion} />

      <CameraDolly active={!reducedMotion} />
    </>
  )
}

// ─────────────────────────────────────────────
// UI Overlay — cinematic LIVE badge + gradient KPI + tool thumbnail
// ─────────────────────────────────────────────
interface OverlayProps {
  operationType: OperationType
  rpm: number
  Vf: number
  diameter: number
  flutes: number
  shape: EndmillShape
  coating?: string
  darkMode: boolean
  autoRotate: boolean
  onToggleAutoRotate: () => void
}

function Overlay({
  operationType,
  rpm,
  Vf,
  diameter,
  flutes,
  shape,
  coating,
  darkMode,
  autoRotate,
  onToggleAutoRotate,
}: OverlayProps) {
  const bg = darkMode ? "rgba(5,7,13,0.72)" : "rgba(255,255,255,0.88)"
  const fg = darkMode ? "#e2e8f0" : "#0f172a"
  const border = darkMode ? "1px solid rgba(51,65,85,0.7)" : "1px solid #cbd5e1"

  const baseChip: React.CSSProperties = {
    position: "absolute",
    padding: "6px 12px",
    borderRadius: 10,
    fontSize: 12,
    fontWeight: 600,
    background: bg,
    color: fg,
    border,
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    pointerEvents: "none",
    letterSpacing: 0.3,
  }

  // 우상단 KPI: gradient text + tabular-nums
  const kpiStyle: React.CSSProperties = {
    ...baseChip,
    top: 10,
    right: 10,
    padding: "8px 14px",
    fontSize: 14,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    fontFeatureSettings: '"tnum"',
    background: darkMode
      ? "linear-gradient(135deg, rgba(15,23,42,0.85) 0%, rgba(30,41,59,0.85) 100%)"
      : "linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(241,245,249,0.9) 100%)",
  }

  const kpiNumber: React.CSSProperties = {
    background: darkMode
      ? "linear-gradient(90deg, #22d3ee, #a78bfa)"
      : "linear-gradient(90deg, #0ea5e9, #7c3aed)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    color: "transparent",
    fontWeight: 800,
  }

  const coatingColorHex = coatingStyle(coating).color
  const shapeLabel = shape.charAt(0).toUpperCase() + shape.slice(1)

  return (
    <>
      {/* Scanline keyframes */}
      <style>
        {`
          @keyframes cf3d-scanline {
            0% { transform: translateY(-100%); }
            100% { transform: translateY(100%); }
          }
          @keyframes cf3d-livepulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.5), 0 0 12px rgba(239,68,68,0.6); }
            50% { box-shadow: 0 0 0 6px rgba(239,68,68,0), 0 0 20px rgba(239,68,68,0.9); }
          }
        `}
      </style>

      {/* 좌상단: LIVE 배지 w/ scanline + glow */}
      <div
        style={{
          ...baseChip,
          top: 10,
          left: 10,
          padding: "6px 10px 6px 14px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          overflow: "hidden",
          position: "absolute",
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#ef4444",
            animation: "cf3d-livepulse 1.6s infinite ease-in-out",
          }}
        />
        <span
          style={{
            fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, monospace',
            fontWeight: 800,
            fontSize: 11,
            letterSpacing: 2,
            color: darkMode ? "#f8fafc" : "#0f172a",
          }}
        >
          LIVE · 3D
        </span>
        <span
          style={{
            fontSize: 11,
            color: darkMode ? "#94a3b8" : "#64748b",
            textTransform: "uppercase",
            letterSpacing: 1.5,
          }}
        >
          {operationType}
        </span>
        {/* Scanline overlay */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "30%",
            background: darkMode
              ? "linear-gradient(180deg, rgba(34,211,238,0.12), transparent)"
              : "linear-gradient(180deg, rgba(14,165,233,0.12), transparent)",
            animation: "cf3d-scanline 3.2s infinite linear",
            pointerEvents: "none",
          }}
        />
      </div>

      {/* 우상단: KPI (rpm · Vf) — gradient · tabular-nums */}
      <div style={kpiStyle}>
        <span style={kpiNumber}>{rpm.toLocaleString()}</span>
        <span style={{ opacity: 0.6, margin: "0 4px" }}>rpm</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span style={{ ...kpiNumber, marginLeft: 6 }}>{Vf.toLocaleString()}</span>
        <span style={{ opacity: 0.6, marginLeft: 4 }}>mm/min</span>
      </div>

      {/* 좌하단: control hint */}
      <div style={{ ...baseChip, bottom: 10, left: 10, fontWeight: 500, opacity: 0.9 }}>
        드래그: 회전 · 휠: 줌
      </div>

      {/* 우하단: 공구 thumbnail + coating 뱃지 + helix */}
      <div
        style={{
          ...baseChip,
          bottom: 10,
          right: 10,
          padding: "6px 10px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          pointerEvents: "auto",
          cursor: "pointer",
          background: autoRotate
            ? (darkMode
                ? "linear-gradient(135deg, rgba(30,64,175,0.85), rgba(67,56,202,0.85))"
                : "linear-gradient(135deg, rgba(59,130,246,0.92), rgba(124,58,237,0.92))")
            : bg,
          color: autoRotate ? "#f8fafc" : fg,
        }}
        onClick={onToggleAutoRotate}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onToggleAutoRotate()
        }}
        aria-pressed={autoRotate}
      >
        {/* Thumbnail: mini tool */}
        <svg width={22} height={22} viewBox="0 0 24 24" aria-hidden>
          <defs>
            <linearGradient id="cf3d-shank" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#e5e7eb" />
              <stop offset="1" stopColor="#9ca3af" />
            </linearGradient>
          </defs>
          <rect x="10" y="2" width="4" height="10" fill="url(#cf3d-shank)" rx="1" />
          <rect x="9" y="12" width="6" height="9" fill={coatingColorHex} rx="1" />
          {shape === "ball" && <circle cx="12" cy="21" r="3" fill={coatingColorHex} />}
          {shape === "chamfer" && (
            <polygon points="9,21 15,21 12,23" fill={coatingColorHex} />
          )}
        </svg>
        <span style={{ fontWeight: 700, fontSize: 11 }}>
          ⌀{diameter}·{flutes}FL·{shapeLabel}
        </span>
        {coating && (
          <span
            style={{
              padding: "2px 6px",
              borderRadius: 6,
              background: coatingColorHex,
              color: "#0f172a",
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: 0.5,
              textTransform: "uppercase",
            }}
          >
            {coating}
          </span>
        )}
        <span
          style={{
            padding: "2px 6px",
            borderRadius: 6,
            background: autoRotate ? "rgba(255,255,255,0.2)" : (darkMode ? "#334155" : "#e2e8f0"),
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.5,
          }}
          title="auto-rotate"
        >
          ⟳ {autoRotate ? "ON" : "OFF"}
        </span>
      </div>
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
  const isMobile = useIsMobile()
  const [autoRotate, setAutoRotate] = useState(autoRotateProp)

  useEffect(() => {
    setAutoRotate(autoRotateProp && !reducedMotion)
  }, [autoRotateProp, reducedMotion])

  // 포스트프로세싱: 모바일/reducedMotion 시 disable
  const enablePostFX = !isMobile && !reducedMotion
  // Environment: 모바일에서는 가벼운 버전 위해 skip 가능 (성능), reducedMotion도 skip
  const enableEnvironment = !isMobile && !reducedMotion

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
        camera={{ position: CAMERA_POS_END, fov: CAMERA_FOV }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        performance={{ min: 0.5 }}
      >
        <Suspense fallback={null}>
          <InnerScene
            {...props}
            reducedMotion={reducedMotion}
            isMobile={isMobile}
            enableEnvironment={enableEnvironment}
          />
        </Suspense>
        <OrbitControls
          autoRotate={autoRotate && !reducedMotion}
          autoRotateSpeed={0.3}
          enableZoom
          enablePan={false}
          minDistance={40}
          maxDistance={260}
        />
        {enablePostFX && (
          <EffectComposer>
            <Bloom
              intensity={0.9}
              luminanceThreshold={1.0}
              luminanceSmoothing={0.3}
              mipmapBlur
            />
            <ChromaticAberration
              blendFunction={BlendFunction.NORMAL}
              offset={new THREE.Vector2(0.0008, 0.0008)}
              radialModulation={false}
              modulationOffset={0}
            />
            <Vignette eskil={false} offset={0.15} darkness={0.55} />
          </EffectComposer>
        )}
      </Canvas>
      <Overlay
        operationType={props.operationType}
        rpm={props.rpm}
        Vf={props.Vf}
        diameter={props.diameter}
        flutes={props.flutes}
        shape={props.shape}
        coating={props.coating}
        darkMode={darkMode}
        autoRotate={autoRotate}
        onToggleAutoRotate={() => setAutoRotate((v) => !v)}
      />
    </div>
  )
}
