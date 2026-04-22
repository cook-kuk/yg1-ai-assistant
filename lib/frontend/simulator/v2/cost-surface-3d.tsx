// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Cost Surface 3D (sidecar visualization)
//
// Vc × fz 2축 sweep → 파트당 총원가(Z) 를 3D 표면으로.
// Taylor-Ackoff 수명 모델 + 선형 사이클타임 스케일링으로 (Vc, fz) 그리드를 훑고
// viridis 계열 컬러맵으로 셰이딩. economic valley(Vc 컬럼별 fz-min)를 glowing tube
// 로 오버레이하고 현재 점(rose pulse) / 최저원가 점(emerald burst) 를 spike beam
// 으로 강조. Bloom + ChromaticAberration 포스트프로세싱으로 SF UI 느낌.
//
// 주의: 사이드카 전용 — cutting-simulator-v2.tsx 의 기존 계산 흐름은 건드리지 않음.
//       모든 매직넘버는 상단 SSOT 블록에 집약.
"use client"

import * as React from "react"
import { Suspense, useMemo, useRef } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { OrbitControls, Line, Grid, Text, Billboard } from "@react-three/drei"
import { EffectComposer, Bloom, ChromaticAberration, Vignette } from "@react-three/postprocessing"
import { BlendFunction } from "postprocessing"
import * as THREE from "three"

import { HolographicFrame } from "./holographic-frame"
import { LiveIndicator } from "./live-indicator"
import { AnimatedNumber } from "./animated-number"

// ── SSOT — tuning ────────────────────────────────────────────────────
const DEFAULT_HEIGHT = 440
const CAMERA_POS: [number, number, number] = [6.5, 5.2, 6.5]
const CAMERA_FOV = 40
const DPR_RANGE: [number, number] = [1, 2]
const AUTO_ROTATE_SPEED = 0.55

// 표면 해상도 & 월드 좌표
const GRID = 36                  // (GRID+1)² = 1369 vertices — 가벼움
const PLANE_SIZE = 6             // XZ 평면 6×6 월드 단위
const COST_Y_SCALE = 3.0         // 월드 Y 최대치
const FLOOR_PAD = 0.4            // 바닥 그리드가 서피스보다 더 낮게 내려가는 양

// sweep range (현재값 기준 배수)
const VC_LOW_MULT = 0.45, VC_HIGH_MULT = 1.65
const FZ_LOW_MULT = 0.45, FZ_HIGH_MULT = 1.85
const MIN_VC = 15                // 하한 안전값 (m/min)
const MIN_FZ = 0.005             // 하한 안전값 (mm/tooth)

// Taylor 확장: T = T_ref · (Vc_ref/Vc)^(1/n) · (fz_ref/fz)^fzLifeExp
const DEFAULT_TOOL_LIFE_REF_MIN = 45
const FZ_LIFE_EXP = 0.3

// colormap stops (low-cost → high-cost)
const COLOR_LOW = new THREE.Color("#34d399")    // emerald-400
const COLOR_MID = new THREE.Color("#fbbf24")    // amber-400
const COLOR_HIGH = new THREE.Color("#f43f5e")   // rose-500
const COLOR_PEAK = new THREE.Color("#a855f7")   // violet-500
const EMISSIVE_MIN = 0.15
const EMISSIVE_MAX = 1.25

// iso-cost ring levels (normalized 0..1)
const ISO_LEVELS = [0.12, 0.24, 0.38, 0.55, 0.75]

// ── Types ────────────────────────────────────────────────────────────
export interface CostSurface3DProps {
  /** 현재 작동 Vc (m/min) — sweep center & marker */
  VcCurrent: number
  /** 현재 작동 fz (mm/tooth) — sweep center & marker */
  fzCurrent: number
  /** Taylor 기준 Vc (catalog 중앙값) */
  VcReference: number
  /** 공구 단가 (원) */
  toolCostKrw: number
  /** 머신 시간당 단가 (원/h) */
  machineCostPerHourKrw: number
  /** 현재 파라미터에서의 사이클 타임 (분/파트) */
  cycleTimeMinCurrent: number
  /** Taylor 지수 n (default 0.25) */
  taylorN?: number
  /** 기준 공구 수명 (분) — default 45 */
  toolLifeRefMin?: number
  /** 최저원가 추천 Vc (동기화용 annotation) */
  economicVc?: number
  darkMode?: boolean
  height?: number
}

// ── 컬러맵: 4-stop gradient (emerald→amber→rose→violet) ─────────────
function sampleCostColor(t: number, target: THREE.Color): void {
  const clamped = Math.min(1, Math.max(0, t))
  if (clamped < 1 / 3) {
    target.copy(COLOR_LOW).lerp(COLOR_MID, clamped * 3)
  } else if (clamped < 2 / 3) {
    target.copy(COLOR_MID).lerp(COLOR_HIGH, (clamped - 1 / 3) * 3)
  } else {
    target.copy(COLOR_HIGH).lerp(COLOR_PEAK, (clamped - 2 / 3) * 3)
  }
}

// ── 원가 모델 (사이드카 전용, 시각화 목적의 간략화) ─────────────────
interface CostModelInputs {
  Vc: number
  fz: number
  VcRef: number
  fzRef: number
  cycleRef: number
  toolLifeRef: number
  taylorN: number
  toolCostKrw: number
  machineCostPerHourKrw: number
}
function estimateCostAt(inp: CostModelInputs): number {
  const { Vc, fz, VcRef, fzRef, cycleRef, toolLifeRef, taylorN, toolCostKrw, machineCostPerHourKrw } = inp
  const safeVc = Math.max(MIN_VC, Vc)
  const safeFz = Math.max(MIN_FZ, fz)
  const life = toolLifeRef
    * Math.pow(VcRef / safeVc, 1 / taylorN)
    * Math.pow(fzRef / safeFz, FZ_LIFE_EXP)
  const cycle = cycleRef * (VcRef * fzRef) / (safeVc * safeFz)
  const partsPerTool = cycle > 0 ? life / cycle : 0
  const toolPart = partsPerTool > 0 ? toolCostKrw / partsPerTool : 0
  const machinePart = (machineCostPerHourKrw / 60) * cycle
  return Math.max(0, toolPart + machinePart)
}

// ── Surface geometry + colors + markers 구축 (useMemo 결과물) ───────
interface SurfaceBuild {
  geometry: THREE.PlaneGeometry
  wireframeGeometry: THREE.BufferGeometry
  gridBounds: { vcMin: number; vcMax: number; fzMin: number; fzMax: number; costMin: number; costMax: number }
  valleyPoints: THREE.Vector3[]
  minPoint: THREE.Vector3
  currentPoint: THREE.Vector3
  currentCost: number
  minCost: number
  isoRings: THREE.Vector3[][]
}

function buildSurface(props: Required<Omit<CostSurface3DProps, "darkMode" | "height" | "economicVc">>): SurfaceBuild {
  const {
    VcCurrent, fzCurrent, VcReference,
    toolCostKrw, machineCostPerHourKrw, cycleTimeMinCurrent,
    taylorN, toolLifeRefMin,
  } = props

  const VcCenter = Math.max(MIN_VC, VcCurrent || VcReference || 120)
  const fzCenter = Math.max(MIN_FZ, fzCurrent || 0.08)
  const vcMin = VcCenter * VC_LOW_MULT, vcMax = VcCenter * VC_HIGH_MULT
  const fzMin = fzCenter * FZ_LOW_MULT, fzMax = fzCenter * FZ_HIGH_MULT
  const cycleRef = Math.max(0.05, cycleTimeMinCurrent)

  // 1) cost grid 샘플링
  const costGrid: number[] = new Array((GRID + 1) * (GRID + 1))
  let costMin = Infinity, costMax = -Infinity
  let minIdx = 0
  for (let j = 0; j <= GRID; j++) {
    const tFz = j / GRID
    const fz = fzMin + (fzMax - fzMin) * tFz
    for (let i = 0; i <= GRID; i++) {
      const tVc = i / GRID
      const Vc = vcMin + (vcMax - vcMin) * tVc
      const cost = estimateCostAt({
        Vc, fz,
        VcRef: VcCenter, fzRef: fzCenter, cycleRef,
        toolLifeRef: toolLifeRefMin, taylorN,
        toolCostKrw, machineCostPerHourKrw,
      })
      const idx = j * (GRID + 1) + i
      costGrid[idx] = cost
      if (cost < costMin) { costMin = cost; minIdx = idx }
      if (cost > costMax) costMax = cost
    }
  }
  const costRange = Math.max(1, costMax - costMin)

  // 2) PlaneGeometry — XZ 평면. X = Vc axis, Z = fz axis, Y = cost
  const geo = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE, GRID, GRID)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position
  const count = pos.count
  const colors = new Float32Array(count * 3)
  const tmpColor = new THREE.Color()
  for (let idx = 0; idx < count; idx++) {
    const cost = costGrid[idx] ?? costMin
    const norm = (cost - costMin) / costRange
    const y = (1 - norm) * COST_Y_SCALE * 0.95  // low cost = high visually? No — invert: low cost = low, high = high for intuitive "valley"
    // Correction: 원가가 낮을수록 **낮게** 그려서 골짜기로 — 직관적
    pos.setY(idx, norm * COST_Y_SCALE)
    sampleCostColor(norm, tmpColor)
    colors[idx * 3] = tmpColor.r
    colors[idx * 3 + 1] = tmpColor.g
    colors[idx * 3 + 2] = tmpColor.b
    // suppress unused var warning — y is computed for reference/comment only
    void y
  }
  pos.needsUpdate = true
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()

  // 3) wireframe overlay (edges)
  const wireGeo = new THREE.WireframeGeometry(geo)

  // 4) economic valley — 각 Vc(i) 컬럼의 fz-min 위치
  const valley: THREE.Vector3[] = []
  for (let i = 0; i <= GRID; i++) {
    let best = Infinity, bestJ = 0
    for (let j = 0; j <= GRID; j++) {
      const c = costGrid[j * (GRID + 1) + i]
      if (c < best) { best = c; bestJ = j }
    }
    const idx = bestJ * (GRID + 1) + i
    const x = pos.getX(idx), y = pos.getY(idx), z = pos.getZ(idx)
    valley.push(new THREE.Vector3(x, y + 0.03, z))
  }

  // 5) min & current points — 월드좌표 계산
  const minX = pos.getX(minIdx), minY = pos.getY(minIdx), minZ = pos.getZ(minIdx)
  const minPoint = new THREE.Vector3(minX, minY, minZ)

  // current → interpolate
  const uVc = Math.min(1, Math.max(0, (VcCurrent - vcMin) / (vcMax - vcMin)))
  const uFz = Math.min(1, Math.max(0, (fzCurrent - fzMin) / (fzMax - fzMin)))
  const curGridI = Math.round(uVc * GRID)
  const curGridJ = Math.round(uFz * GRID)
  const curIdx = curGridJ * (GRID + 1) + curGridI
  const curX = pos.getX(curIdx), curY = pos.getY(curIdx), curZ = pos.getZ(curIdx)
  const currentPoint = new THREE.Vector3(curX, curY, curZ)

  // 6) iso-cost rings (marching-squares 간이 — 셀에서 level 교차 시 선분 추출)
  const isoRings: THREE.Vector3[][] = ISO_LEVELS.map(() => [])
  const nx = GRID + 1
  for (let lvlIdx = 0; lvlIdx < ISO_LEVELS.length; lvlIdx++) {
    const level = costMin + ISO_LEVELS[lvlIdx] * costRange
    const segs: THREE.Vector3[] = []
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const a = costGrid[j * nx + i]
        const b = costGrid[j * nx + i + 1]
        const c = costGrid[(j + 1) * nx + i + 1]
        const d = costGrid[(j + 1) * nx + i]
        // 4 vertex world positions
        const ia = j * nx + i, ib = j * nx + i + 1, ic = (j + 1) * nx + i + 1, id = (j + 1) * nx + i
        const pa = new THREE.Vector3(pos.getX(ia), pos.getY(ia) + 0.01, pos.getZ(ia))
        const pb = new THREE.Vector3(pos.getX(ib), pos.getY(ib) + 0.01, pos.getZ(ib))
        const pc = new THREE.Vector3(pos.getX(ic), pos.getY(ic) + 0.01, pos.getZ(ic))
        const pd = new THREE.Vector3(pos.getX(id), pos.getY(id) + 0.01, pos.getZ(id))
        const cross: THREE.Vector3[] = []
        const push = (v0: number, v1: number, p0: THREE.Vector3, p1: THREE.Vector3) => {
          if ((v0 - level) * (v1 - level) < 0) {
            const t = (level - v0) / (v1 - v0)
            cross.push(new THREE.Vector3().lerpVectors(p0, p1, t))
          }
        }
        push(a, b, pa, pb)
        push(b, c, pb, pc)
        push(c, d, pc, pd)
        push(d, a, pd, pa)
        if (cross.length === 2) { segs.push(cross[0], cross[1]) }
      }
    }
    isoRings[lvlIdx] = segs
  }

  return {
    geometry: geo,
    wireframeGeometry: wireGeo,
    gridBounds: { vcMin, vcMax, fzMin, fzMax, costMin, costMax },
    valleyPoints: valley,
    minPoint,
    currentPoint,
    currentCost: costGrid[curIdx] ?? costMin,
    minCost: costMin,
    isoRings,
  }
}

// ── Sub-components ──────────────────────────────────────────────────

function CostSurfaceMesh({ geometry }: { geometry: THREE.PlaneGeometry }): React.ReactElement {
  React.useEffect(() => { return () => geometry.dispose() }, [geometry])
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        vertexColors
        roughness={0.35}
        metalness={0.45}
        emissive={new THREE.Color("#1e1b4b")}
        emissiveIntensity={EMISSIVE_MIN + (EMISSIVE_MAX - EMISSIVE_MIN) * 0.6}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

function WireframeOverlay({ geometry }: { geometry: THREE.BufferGeometry }): React.ReactElement {
  React.useEffect(() => { return () => geometry.dispose() }, [geometry])
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#22d3ee" transparent opacity={0.18} />
    </lineSegments>
  )
}

function IsoRing({ points, accent = "#e2e8f0", opacity = 0.45 }: { points: THREE.Vector3[]; accent?: string; opacity?: number }): React.ReactElement | null {
  const geo = useMemo(() => {
    if (points.length < 2) return null
    const g = new THREE.BufferGeometry()
    const arr = new Float32Array(points.length * 3)
    for (let i = 0; i < points.length; i++) { arr[i * 3] = points[i].x; arr[i * 3 + 1] = points[i].y; arr[i * 3 + 2] = points[i].z }
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3))
    return g
  }, [points])
  React.useEffect(() => { return () => { geo?.dispose() } }, [geo])
  if (!geo) return null
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color={accent} transparent opacity={opacity} />
    </lineSegments>
  )
}

function PulsingMarker({
  position, color, beamColor, scale = 0.14, beamHeight = COST_Y_SCALE + 0.4,
}: { position: THREE.Vector3; color: string; beamColor: string; scale?: number; beamHeight?: number }): React.ReactElement {
  const meshRef = useRef<THREE.Mesh>(null!)
  const ringRef = useRef<THREE.Mesh>(null!)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (meshRef.current) {
      const s = 1 + Math.sin(t * 3.4) * 0.18
      meshRef.current.scale.setScalar(s)
    }
    if (ringRef.current) {
      ringRef.current.rotation.z = t * 0.8
      ringRef.current.scale.setScalar(1 + Math.sin(t * 2) * 0.12)
    }
  })
  return (
    <group position={position}>
      {/* glow core */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[scale, 20, 20]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.6} toneMapped={false} />
      </mesh>
      {/* vertical spike beam */}
      <mesh position={[0, beamHeight / 2, 0]}>
        <cylinderGeometry args={[scale * 0.18, scale * 0.06, beamHeight, 12, 1, true]} />
        <meshBasicMaterial color={beamColor} transparent opacity={0.5} toneMapped={false} />
      </mesh>
      {/* halo ring */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[scale * 2.4, scale * 3.2, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.55} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  )
}

function ValleyTube({ points }: { points: THREE.Vector3[] }): React.ReactElement | null {
  const geo = useMemo(() => {
    if (points.length < 2) return null
    const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.25)
    return new THREE.TubeGeometry(curve, Math.min(240, points.length * 4), 0.045, 10, false)
  }, [points])
  React.useEffect(() => { return () => { geo?.dispose() } }, [geo])
  const matRef = useRef<THREE.MeshStandardMaterial>(null!)
  useFrame(({ clock }) => {
    if (matRef.current) {
      matRef.current.emissiveIntensity = 1.6 + Math.sin(clock.elapsedTime * 1.5) * 0.5
    }
  })
  if (!geo) return null
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial
        ref={matRef}
        color="#10b981"
        emissive="#10b981"
        emissiveIntensity={2}
        roughness={0.2}
        metalness={0.6}
        toneMapped={false}
      />
    </mesh>
  )
}

function FloorProjection({ valley, isoRings }: { valley: THREE.Vector3[]; isoRings: THREE.Vector3[][] }): React.ReactElement {
  const floorY = -FLOOR_PAD
  const valleyProj = useMemo(() => valley.map(v => [v.x, floorY + 0.001, v.z] as [number, number, number]), [valley, floorY])
  return (
    <group>
      {/* valley projected (emerald shadow) */}
      {valleyProj.length > 1 && (
        <Line points={valleyProj} color="#10b981" lineWidth={1.4} transparent opacity={0.55} />
      )}
      {/* iso projection ghosts */}
      {isoRings.map((segs, idx) => {
        if (segs.length < 2) return null
        const geo = new THREE.BufferGeometry()
        const arr = new Float32Array(segs.length * 3)
        for (let i = 0; i < segs.length; i++) {
          arr[i * 3] = segs[i].x
          arr[i * 3 + 1] = floorY + 0.002
          arr[i * 3 + 2] = segs[i].z
        }
        geo.setAttribute("position", new THREE.BufferAttribute(arr, 3))
        const accent = ["#67e8f9", "#a5f3fc", "#fde68a", "#fca5a5", "#d8b4fe"][idx % 5]
        return (
          <lineSegments key={idx} geometry={geo}>
            <lineBasicMaterial color={accent} transparent opacity={0.35} />
          </lineSegments>
        )
      })}
    </group>
  )
}

function AxisLabels({
  darkMode, bounds,
}: { darkMode: boolean; bounds: SurfaceBuild["gridBounds"] }): React.ReactElement {
  const half = PLANE_SIZE / 2
  const labelColor = darkMode ? "#e2e8f0" : "#1e293b"
  const faintColor = darkMode ? "#94a3b8" : "#64748b"
  const tickY = -FLOOR_PAD + 0.02
  return (
    <group>
      {/* X axis — Vc */}
      <Billboard position={[0, tickY, -half - 0.6]}>
        <Text fontSize={0.28} color={labelColor} anchorX="center" anchorY="middle">Vc (m/min)</Text>
      </Billboard>
      <Billboard position={[-half, tickY, -half - 0.15]}>
        <Text fontSize={0.18} color={faintColor} anchorX="center" anchorY="middle">{bounds.vcMin.toFixed(0)}</Text>
      </Billboard>
      <Billboard position={[half, tickY, -half - 0.15]}>
        <Text fontSize={0.18} color={faintColor} anchorX="center" anchorY="middle">{bounds.vcMax.toFixed(0)}</Text>
      </Billboard>
      {/* Z axis — fz */}
      <Billboard position={[-half - 0.8, tickY, 0]}>
        <Text fontSize={0.28} color={labelColor} anchorX="center" anchorY="middle">fz (mm/t)</Text>
      </Billboard>
      <Billboard position={[-half - 0.15, tickY, -half]}>
        <Text fontSize={0.18} color={faintColor} anchorX="center" anchorY="middle">{bounds.fzMin.toFixed(3)}</Text>
      </Billboard>
      <Billboard position={[-half - 0.15, tickY, half]}>
        <Text fontSize={0.18} color={faintColor} anchorX="center" anchorY="middle">{bounds.fzMax.toFixed(3)}</Text>
      </Billboard>
      {/* Y axis — Cost */}
      <Billboard position={[half + 0.5, COST_Y_SCALE / 2, half + 0.5]}>
        <Text fontSize={0.3} color={labelColor} anchorX="center" anchorY="middle">Cost (₩/part)</Text>
      </Billboard>
      <Billboard position={[half + 0.15, COST_Y_SCALE, half + 0.15]}>
        <Text fontSize={0.2} color="#f43f5e" anchorX="left" anchorY="middle">
          {`MAX ${Math.round(bounds.costMax).toLocaleString()}`}
        </Text>
      </Billboard>
      <Billboard position={[half + 0.15, 0, half + 0.15]}>
        <Text fontSize={0.2} color="#10b981" anchorX="left" anchorY="middle">
          {`MIN ${Math.round(bounds.costMin).toLocaleString()}`}
        </Text>
      </Billboard>
    </group>
  )
}

function Scene({
  build, darkMode,
}: { build: SurfaceBuild; darkMode: boolean }): React.ReactElement {
  const half = PLANE_SIZE / 2
  return (
    <>
      <color attach="background" args={[darkMode ? "#030712" : "#f8fafc"]} />
      <fog attach="fog" args={[darkMode ? "#030712" : "#e2e8f0", 10, 22]} />
      <ambientLight intensity={darkMode ? 0.45 : 0.7} />
      <directionalLight position={[5, 8, 5]} intensity={1.2} color="#ffffff" />
      <directionalLight position={[-4, 4, -6]} intensity={0.55} color="#7c3aed" />
      <pointLight position={[0, COST_Y_SCALE + 1, 0]} intensity={18} distance={12} color="#22d3ee" />

      {/* Floor grid below surface — sci-fi hologram floor */}
      <Grid
        args={[PLANE_SIZE * 1.4, PLANE_SIZE * 1.4]}
        position={[0, -FLOOR_PAD, 0]}
        cellSize={0.3}
        cellThickness={0.5}
        cellColor={darkMode ? "#1e293b" : "#cbd5e1"}
        sectionSize={1.2}
        sectionThickness={1}
        sectionColor={darkMode ? "#334155" : "#94a3b8"}
        fadeDistance={14}
        fadeStrength={1.2}
        infiniteGrid={false}
      />

      <FloorProjection valley={build.valleyPoints} isoRings={build.isoRings} />

      {/* The main surface + wireframe + iso rings */}
      <CostSurfaceMesh geometry={build.geometry} />
      <WireframeOverlay geometry={build.wireframeGeometry} />
      {build.isoRings.map((pts, idx) => (
        <IsoRing key={idx} points={pts} accent={idx < 2 ? "#67e8f9" : idx < 4 ? "#fcd34d" : "#f472b6"} opacity={0.55} />
      ))}

      {/* economic valley glow tube + markers */}
      <ValleyTube points={build.valleyPoints} />
      <PulsingMarker position={build.minPoint} color="#10b981" beamColor="#34d399" scale={0.18} />
      <PulsingMarker position={build.currentPoint} color="#f43f5e" beamColor="#fda4af" scale={0.16} />

      {/* Axis frame — thin emissive edges */}
      <group>
        {[[-half, 0, -half], [half, 0, -half], [half, 0, half], [-half, 0, half]].map((p, i) => (
          <mesh key={i} position={[p[0], COST_Y_SCALE / 2, p[2]]}>
            <boxGeometry args={[0.02, COST_Y_SCALE, 0.02]} />
            <meshBasicMaterial color="#22d3ee" transparent opacity={0.25} toneMapped={false} />
          </mesh>
        ))}
      </group>

      <AxisLabels darkMode={darkMode} bounds={build.gridBounds} />

      <EffectComposer>
        <Bloom intensity={1.1} luminanceThreshold={0.25} luminanceSmoothing={0.35} mipmapBlur />
        <ChromaticAberration
          blendFunction={BlendFunction.NORMAL}
          offset={new THREE.Vector2(0.0006, 0.0006)}
          radialModulation={false}
          modulationOffset={0}
        />
        <Vignette eskil={false} offset={0.18} darkness={0.55} />
      </EffectComposer>
    </>
  )
}

// ── Main component ──────────────────────────────────────────────────
export function CostSurface3D({
  VcCurrent, fzCurrent, VcReference,
  toolCostKrw, machineCostPerHourKrw, cycleTimeMinCurrent,
  taylorN = 0.25,
  toolLifeRefMin = DEFAULT_TOOL_LIFE_REF_MIN,
  economicVc,
  darkMode = false,
  height = DEFAULT_HEIGHT,
}: CostSurface3DProps): React.ReactElement {

  const build = useMemo(() => buildSurface({
    VcCurrent, fzCurrent, VcReference,
    toolCostKrw, machineCostPerHourKrw, cycleTimeMinCurrent,
    taylorN, toolLifeRefMin,
  }), [VcCurrent, fzCurrent, VcReference, toolCostKrw, machineCostPerHourKrw, cycleTimeMinCurrent, taylorN, toolLifeRefMin])

  const savingsKrw = Math.max(0, build.currentCost - build.minCost)
  const savingsPct = build.currentCost > 0 ? (savingsKrw / build.currentCost) * 100 : 0

  const textMuted = darkMode ? "text-slate-400" : "text-slate-600"
  const textPrimary = darkMode ? "text-slate-100" : "text-slate-900"
  const subHeadBg = darkMode ? "bg-slate-900/50" : "bg-slate-100/70"
  const canvasBorder = darkMode ? "border-violet-900/50" : "border-violet-200"
  const auroraBg = darkMode
    ? "bg-gradient-to-br from-slate-950 via-violet-950/30 to-slate-950"
    : "bg-gradient-to-br from-slate-50 via-violet-50/60 to-slate-100"

  return (
    <HolographicFrame accent="violet" intensity="strong" darkMode={darkMode}>
      <div className="flex flex-col gap-2 p-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-semibold ${textPrimary}`}>💠 Cost Surface 3D</span>
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wide bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/50">
              Taylor-Ackoff × Feed Law
            </span>
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wide bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/50">
              {GRID}×{GRID} sweep
            </span>
          </div>
          <LiveIndicator watch={[VcCurrent, fzCurrent, toolCostKrw, machineCostPerHourKrw, cycleTimeMinCurrent]} color="violet" darkMode={darkMode} />
        </div>

        {/* Sub-head */}
        <div className={`rounded-md px-2 py-1 text-[11px] tabular-nums ${subHeadBg} ${textMuted}`}>
          <span>Vc ∈ [{build.gridBounds.vcMin.toFixed(0)}, {build.gridBounds.vcMax.toFixed(0)}] m/min</span>
          <span className="mx-1.5">·</span>
          <span>fz ∈ [{build.gridBounds.fzMin.toFixed(3)}, {build.gridBounds.fzMax.toFixed(3)}] mm/t</span>
          <span className="mx-1.5">·</span>
          <span>n={taylorN.toFixed(3)}</span>
          {economicVc != null && (<>
            <span className="mx-1.5">·</span>
            <span className="text-emerald-400">Vc_econ ≈ {economicVc.toFixed(0)}</span>
          </>)}
        </div>

        {/* Canvas */}
        <div className={`relative overflow-hidden rounded-md border ${canvasBorder} ${auroraBg}`} style={{ height }}>
          <Canvas
            dpr={DPR_RANGE}
            camera={{ position: CAMERA_POS, fov: CAMERA_FOV }}
            gl={{ antialias: true, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping }}
          >
            <Suspense fallback={null}>
              <Scene build={build} darkMode={darkMode} />
            </Suspense>
            <OrbitControls
              enableZoom enablePan={false} autoRotate
              autoRotateSpeed={AUTO_ROTATE_SPEED}
              minDistance={5} maxDistance={16}
              minPolarAngle={Math.PI / 8} maxPolarAngle={Math.PI / 2.05}
            />
          </Canvas>

          {/* HUD overlay */}
          <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1.5">
            <div className="rounded-md bg-rose-500/15 ring-1 ring-rose-500/40 px-2 py-1 backdrop-blur-sm">
              <div className="text-[9px] font-bold text-rose-300 tracking-widest">● CURRENT</div>
              <div className="text-sm font-mono text-rose-100">
                <AnimatedNumber value={Math.round(build.currentCost)} suffix="₩" className="tabular-nums" />
              </div>
            </div>
            <div className="rounded-md bg-emerald-500/15 ring-1 ring-emerald-500/40 px-2 py-1 backdrop-blur-sm">
              <div className="text-[9px] font-bold text-emerald-300 tracking-widest">◆ MIN</div>
              <div className="text-sm font-mono text-emerald-100">
                <AnimatedNumber value={Math.round(build.minCost)} suffix="₩" className="tabular-nums" />
              </div>
            </div>
          </div>
          <div className="pointer-events-none absolute right-3 top-3">
            <div className="rounded-md bg-violet-500/15 ring-1 ring-violet-500/40 px-2.5 py-1 backdrop-blur-sm text-right">
              <div className="text-[9px] font-bold text-violet-300 tracking-widest">Δ SAVINGS POTENTIAL</div>
              <div className="text-lg font-mono text-violet-100 font-bold">
                <AnimatedNumber value={Math.round(savingsKrw)} suffix="₩" className="tabular-nums" />
              </div>
              <div className="text-[10px] text-violet-300 tabular-nums">
                ({savingsPct.toFixed(1)}% 절감 여지)
              </div>
            </div>
          </div>

          {/* Legend gradient */}
          <div className="pointer-events-none absolute left-1/2 bottom-3 -translate-x-1/2 flex items-center gap-2">
            <span className="text-[9px] font-bold text-emerald-300">LOW</span>
            <div
              className="h-1.5 w-48 rounded-full ring-1 ring-white/30"
              style={{ background: `linear-gradient(to right, ${COLOR_LOW.getStyle()}, ${COLOR_MID.getStyle()}, ${COLOR_HIGH.getStyle()}, ${COLOR_PEAK.getStyle()})` }}
            />
            <span className="text-[9px] font-bold text-violet-300">HIGH</span>
          </div>
        </div>

        {/* Interpretation footer */}
        <div className={`rounded-md px-2 py-1.5 text-[10px] ${subHeadBg} ${textMuted} leading-relaxed`}>
          <b className="text-emerald-400">초록 골짜기</b> = 각 Vc에서 원가 최저 fz (economic valley) ·
          <b className="text-rose-400"> 빨강 점</b> = 현재 작동점 ·
          <b className="text-emerald-400"> 초록 점</b> = 전역 최저원가 ·
          색상 = 파트당 단가 (낮음 → 높음)
        </div>
      </div>
    </HolographicFrame>
  )
}

export default CostSurface3D
