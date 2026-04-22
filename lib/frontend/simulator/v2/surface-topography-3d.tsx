// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Surface Topography 3D (sidecar visualization)
// 가공 표면 3D height map. feed marks + pseudo-Perlin noise + 공구 원호 중첩.
// cutting-simulator-v2.tsx 는 건드리지 않음. 모든 매직넘버는 SSOT.
"use client"

import * as React from "react"
import { Suspense, useMemo } from "react"
import { Canvas } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import * as THREE from "three"
import { HolographicFrame } from "./holographic-frame"
import { LiveIndicator } from "./live-indicator"
import { AnimatedNumber } from "./animated-number"

// ── SSOT — tuning ────────────────────────────────────────────────────
const DEFAULT_HEIGHT = 360
const CAMERA_POS: [number, number, number] = [3, 3, 3]
const CAMERA_FOV = 45
const DPR_RANGE: [number, number] = [1, 2]
const AUTO_ROTATE_SPEED = 0.6
const PLANE_SIZE = 4
const PLANE_SEGMENTS = 128
const RA_MIRROR_MAX = 0.4
const RA_PRECISION_MAX = 1.6
const RA_GENERAL_MAX = 3.2
// 1 3D unit ≈ 1mm. 실제 Ra(μm)는 너무 작아 50x 과장해서 시각화.
const VISUAL_EXAGGERATION = 50
const MICRON_TO_UNIT = 0.001
const RA_HEIGHT_SCALE = MICRON_TO_UNIT * VISUAL_EXAGGERATION
const FEED_RIDGE_RATIO = 1.0
const NOISE_RATIO = 0.6
const TOOL_ARC_RATIO = 0.4
const NOISE_GRID = 8
const VALLEY_COLOR = new THREE.Color("#1e3a8a")
const MID_COLOR = new THREE.Color("#38bdf8")
const PEAK_COLOR = new THREE.Color("#f8fafc")

// ── Types ────────────────────────────────────────────────────────────
export interface SurfaceTopography3DProps {
  /** Ra 표면 거칠기 (μm) */
  raUm: number
  /** Rz (μm) — default raUm * 6 */
  rzUm?: number
  /** feed per tooth (mm) */
  fzMmTooth: number
  /** tool diameter (mm) */
  toolDiameterMm: number
  darkMode?: boolean
  /** canvas height (px) — default 360 */
  height?: number
}

type FinishGrade = "mirror" | "precision" | "general" | "rough"

interface FinishMeta {
  grade: FinishGrade
  korean: string
  textCls: string
  bgCls: string
  ringCls: string
}

function classifyFinish(raUm: number): FinishMeta {
  if (raUm < RA_MIRROR_MAX) {
    return {
      grade: "mirror",
      korean: "경면 마감 (거울)",
      textCls: "text-cyan-300",
      bgCls: "bg-cyan-500/15",
      ringCls: "ring-cyan-500/50",
    }
  }
  if (raUm < RA_PRECISION_MAX) {
    return {
      grade: "precision",
      korean: "정밀 마감",
      textCls: "text-emerald-300",
      bgCls: "bg-emerald-500/15",
      ringCls: "ring-emerald-500/50",
    }
  }
  if (raUm < RA_GENERAL_MAX) {
    return {
      grade: "general",
      korean: "일반 마감",
      textCls: "text-amber-300",
      bgCls: "bg-amber-500/15",
      ringCls: "ring-amber-500/50",
    }
  }
  return {
    grade: "rough",
    korean: "거친 마감 — 2차 가공 권장",
    textCls: "text-rose-300",
    bgCls: "bg-rose-500/15",
    ringCls: "ring-rose-500/50",
  }
}

// ── Pseudo-noise (seeded mulberry32 + bilinear fade; Perlin-like) ────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashSeed(raUm: number, fz: number, dia: number): number {
  let h = 2166136261 >>> 0
  const s = `${raUm.toFixed(4)}|${fz.toFixed(4)}|${dia.toFixed(3)}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function buildNoiseField(seed: number, grid: number): number[][] {
  const rnd = mulberry32(seed)
  const field: number[][] = []
  for (let j = 0; j <= grid; j++) {
    const row: number[] = []
    for (let i = 0; i <= grid; i++) row.push(rnd() * 2 - 1)
    field.push(row)
  }
  return field
}

// Perlin's C2-continuous fade: 6t^5 − 15t^4 + 10t^3
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function sampleNoise(field: number[][], grid: number, u: number, v: number): number {
  const x = u * grid, y = v * grid
  const i0 = Math.floor(x), j0 = Math.floor(y)
  const i1 = Math.min(i0 + 1, grid), j1 = Math.min(j0 + 1, grid)
  const tx = fade(x - i0), ty = fade(y - j0)
  const a = field[j0][i0], b = field[j0][i1]
  const c = field[j1][i0], d = field[j1][i1]
  const ab = a + (b - a) * tx
  const cd = c + (d - c) * tx
  return ab + (cd - ab) * ty
}

// ── Surface geometry construction ────────────────────────────────────
interface GeometryInputs { raUm: number; fzMmTooth: number; toolDiameterMm: number; seed: number }

function buildSurfaceGeometry(inp: GeometryInputs): THREE.PlaneGeometry {
  const { raUm, fzMmTooth, toolDiameterMm, seed } = inp
  const geo = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE, PLANE_SEGMENTS, PLANE_SEGMENTS)
  // rotate flat plane so +Y is up (original plane is XY with Z=0)
  geo.rotateX(-Math.PI / 2)

  const pos = geo.attributes.position
  const count = pos.count

  // PLANE_SIZE(4 unit) ≈ 4mm 시편. wavelength(unit)=fz(mm); 너무 작으면 clamp.
  const feedWavelength = Math.max(0.05, fzMmTooth)
  const feedK = (2 * Math.PI) / feedWavelength
  const toolRadius = Math.max(0.3, Math.min(PLANE_SIZE / 2, toolDiameterMm * 0.25))

  const ampFeed = raUm * RA_HEIGHT_SCALE * FEED_RIDGE_RATIO
  const ampNoise = raUm * RA_HEIGHT_SCALE * NOISE_RATIO
  const ampArc = raUm * RA_HEIGHT_SCALE * TOOL_ARC_RATIO

  const noise = buildNoiseField(seed, NOISE_GRID)
  const zArr = new Float32Array(count)
  let zMin = Infinity, zMax = -Infinity
  const half = PLANE_SIZE / 2

  for (let idx = 0; idx < count; idx++) {
    const x = pos.getX(idx)
    const yPlane = pos.getZ(idx) // after rotateX, plane lives in XZ
    const u = (x + half) / PLANE_SIZE
    const v = (yPlane + half) / PLANE_SIZE
    const periodic = ampFeed * Math.sin(x * feedK)
    const n = ampNoise * sampleNoise(noise, NOISE_GRID, u, v)
    const r = Math.sqrt(x * x + yPlane * yPlane)
    const arc = ampArc * Math.sin((r / Math.max(0.05, toolRadius)) * Math.PI * 2)
    const z = periodic + n + arc
    zArr[idx] = z
    if (z < zMin) zMin = z
    if (z > zMax) zMax = z
    pos.setY(idx, z)
  }
  pos.needsUpdate = true

  // vertex colors: valley → mid → peak
  const range = zMax - zMin > 1e-6 ? zMax - zMin : 1
  const colors = new Float32Array(count * 3)
  const tmp = new THREE.Color()
  for (let idx = 0; idx < count; idx++) {
    const t = (zArr[idx] - zMin) / range
    if (t < 0.5) tmp.copy(VALLEY_COLOR).lerp(MID_COLOR, t * 2)
    else tmp.copy(MID_COLOR).lerp(PEAK_COLOR, (t - 0.5) * 2)
    colors[idx * 3] = tmp.r
    colors[idx * 3 + 1] = tmp.g
    colors[idx * 3 + 2] = tmp.b
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  return geo
}

// ── 3D scene ─────────────────────────────────────────────────────────
interface SurfaceMeshProps { geometry: THREE.PlaneGeometry }

function SurfaceMesh({ geometry }: SurfaceMeshProps): React.ReactElement {
  React.useEffect(() => { return () => { geometry.dispose() } }, [geometry])
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.55} metalness={0.15} side={THREE.DoubleSide} />
    </mesh>
  )
}

interface SceneProps { geometry: THREE.PlaneGeometry; darkMode: boolean }

function Scene({ geometry, darkMode }: SceneProps): React.ReactElement {
  return (
    <>
      <color attach="background" args={[darkMode ? "#0b1120" : "#f1f5f9"]} />
      <ambientLight intensity={darkMode ? 0.4 : 0.65} />
      <directionalLight position={[4, 6, 2]} intensity={darkMode ? 1.2 : 1.0} castShadow />
      <directionalLight
        position={[-3, 2, -4]}
        intensity={darkMode ? 0.5 : 0.4}
        color={darkMode ? "#22d3ee" : "#ffffff"}
      />
      <SurfaceMesh geometry={geometry} />
    </>
  )
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────
export function SurfaceTopography3D({
  raUm, rzUm, fzMmTooth, toolDiameterMm,
  darkMode = false, height = DEFAULT_HEIGHT,
}: SurfaceTopography3DProps): React.ReactElement {
  const effectiveRz = rzUm ?? raUm * 6
  const finish = useMemo(() => classifyFinish(raUm), [raUm])
  const seed = useMemo(
    () => hashSeed(raUm, fzMmTooth, toolDiameterMm),
    [raUm, fzMmTooth, toolDiameterMm],
  )
  const geometry = useMemo(
    () => buildSurfaceGeometry({ raUm, fzMmTooth, toolDiameterMm, seed }),
    [raUm, fzMmTooth, toolDiameterMm, seed],
  )

  const textMuted = darkMode ? "text-slate-400" : "text-slate-600"
  const textPrimary = darkMode ? "text-slate-100" : "text-slate-900"
  const subHeadBg = darkMode ? "bg-slate-900/40" : "bg-slate-100/60"
  const legendBorder = darkMode ? "border-slate-800" : "border-slate-200"
  const canvasBorder = darkMode ? "border-slate-800" : "border-slate-200"
  const auroraBg = darkMode
    ? "bg-gradient-to-br from-slate-950 via-indigo-950/40 to-slate-900"
    : "bg-gradient-to-br from-slate-50 via-cyan-50/60 to-slate-100"
  const gradientStyle = {
    background: `linear-gradient(to right, ${VALLEY_COLOR.getStyle()}, ${MID_COLOR.getStyle()}, ${PEAK_COLOR.getStyle()})`,
  }

  return (
    <HolographicFrame accent="cyan" darkMode={darkMode}>
      <div className="flex flex-col gap-2 p-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-semibold ${textPrimary}`}>표면 지형 3D</span>
            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide ring-1 ${finish.bgCls} ${finish.textCls} ${finish.ringCls}`}
              aria-label={`표면 등급 ${finish.korean}`}
            >
              Ra <AnimatedNumber value={raUm} decimals={2} suffix=" μm" className="ml-1" />
            </span>
          </div>
          <LiveIndicator watch={[raUm, fzMmTooth, toolDiameterMm]} color="amber" darkMode={darkMode} />
        </div>

        {/* Interpretation line */}
        <div className={`rounded-md px-2 py-1 text-[11px] tabular-nums ${subHeadBg} ${textMuted}`}>
          <span>
            fz={fzMmTooth.toFixed(3)} mm/t · D={toolDiameterMm.toFixed(1)} mm · Ra=
            {raUm.toFixed(2)} μm · Rz={effectiveRz.toFixed(2)} μm
          </span>
          <span className="mx-1">→</span>
          <span className={finish.textCls}>{finish.korean}</span>
        </div>

        {/* Canvas */}
        <div
          className={`relative overflow-hidden rounded-md border ${canvasBorder} ${auroraBg}`}
          style={{ height }}
        >
          <Canvas
            shadows
            dpr={DPR_RANGE}
            camera={{ position: CAMERA_POS, fov: CAMERA_FOV }}
            gl={{ antialias: true, powerPreference: "high-performance" }}
          >
            <Suspense fallback={null}>
              <Scene geometry={geometry} darkMode={darkMode} />
            </Suspense>
            <OrbitControls
              enableZoom enablePan autoRotate
              autoRotateSpeed={AUTO_ROTATE_SPEED}
              minDistance={2} maxDistance={12}
            />
          </Canvas>
        </div>

        {/* Legend / scale bar */}
        <div
          className={`flex flex-wrap items-center justify-between gap-2 border-t pt-2 ${legendBorder}`}
          aria-label="표면 거칠기 범례"
        >
          <div className="flex items-center gap-2 text-[10px]">
            <span className={textMuted}>색상:</span>
            <span className="inline-block h-2 w-16 rounded" style={gradientStyle} aria-hidden="true" />
            <span className={textMuted}>계곡 → 정상</span>
          </div>
          <div className={`flex items-center gap-3 text-[10px] tabular-nums ${textMuted}`}>
            <span>Ra <span className={finish.textCls}>{raUm.toFixed(2)} μm</span></span>
            <span>Rz <span className={finish.textCls}>{effectiveRz.toFixed(2)} μm</span></span>
            <span className="italic opacity-80">(시각 과장 {VISUAL_EXAGGERATION}x)</span>
          </div>
        </div>

        {/* Interpretation hint */}
        <div className={`text-[11px] leading-relaxed ${textMuted}`}>
          표면 등급: <span className={`font-semibold ${finish.textCls}`}>{finish.korean}</span>.
          feed mark(줄무늬) + 공구 원호 + 미세 noise 중첩으로 실제 표면 지형을 재현합니다.
        </div>
      </div>
    </HolographicFrame>
  )
}

export default SurfaceTopography3D
