// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Chip Morphology 3D (sidecar visualization)
//
// fz / Vc / 재료 조합에서 생성되는 칩의 3D 형상을 실시간 예측·시각화.
// 4가지 분류: continuous(amber) / serrated(rose) / segmented(sky) / built-up(violet).
// 주의: 사이드카 전용 — cutting-simulator-v2.tsx 는 건드리지 않음.
//       모든 매직넘버는 상단 SSOT 블록에 집약.
"use client"

import * as React from "react"
import { Suspense, useMemo, useRef } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import * as THREE from "three"

import { HolographicFrame } from "./holographic-frame"
import { LiveIndicator } from "./live-indicator"

// ── SSOT — Chip Morphology tuning ────────────────────────────────────
const DEFAULT_HEIGHT = 320
const CAMERA_POS: [number, number, number] = [6, 3, 6]
const CAMERA_FOV = 38
const DPR_RANGE: [number, number] = [1, 2]
const AUTO_ROTATE_SPEED = 0.8
const GROUP_ROTATE_SPEED = 0.25
// 분류 임계값
const FZ_CONTINUOUS_MAX = 0.08, FZ_SEGMENTED_MIN = 0.15
const THERMAL_LOW = 0.4, THERMAL_HIGH = 1.2
// 재료별 기준 Vc (m/min) proxy
const MATERIAL_BASE_VC: Record<string, number> = {
  AL6061: 500, S45C: 180, SUS304: 110, Ti6Al4V: 60, Inconel718: 35,
}
const DEFAULT_BASE_VC = 150
// 칩 튜브 해상도
const TUBE_TUBULAR_SEGMENTS = 64, TUBE_RADIUS = 0.06, TUBE_RADIAL_SEGMENTS = 8
// continuous / serrated / segmented / built-up 커브 파라미터
const CONT_TURNS = 6, CONT_RADIUS = 0.25, CONT_LENGTH = 3, CONT_CURVE_SAMPLES = 220
const SERR_TURNS = 5, SERR_BASE_R = 0.2, SERR_PULSE_AMP = 0.08, SERR_PULSE_FREQ = 8, SERR_LENGTH = 3, SERR_CURVE_SAMPLES = 220
const SEG_COUNT = 3, SEG_TURNS = 1.2, SEG_RADIUS = 0.28, SEG_LENGTH = 0.7, SEG_GAP = 0.35, SEG_CURVE_SAMPLES = 64
const BUE_POINTS = 24, BUE_SPREAD = 0.55, BUE_VERTICAL_STEP = 0.12

// ── Types ────────────────────────────────────────────────────────────
export type ChipType = "continuous" | "serrated" | "segmented" | "built-up"

export interface ChipMorphology3DProps {
  fzMmTooth: number
  VcMmin: number
  material: string
  apMm: number
  darkMode?: boolean
  height?: number
}

interface ChipTypeMeta {
  label: string
  colorHex: string
  textCls: string
  bgCls: string
  ringCls: string
  korean: string
  description: string
}

const CHIP_META: Record<ChipType, ChipTypeMeta> = {
  continuous: {
    label: "Continuous", colorHex: "#f59e0b",
    textCls: "text-amber-400", bgCls: "bg-amber-500/15", ringCls: "ring-amber-500/50",
    korean: "연속형",
    description: "길고 꼬인 나선. 고속·저이송, 연성 재료에서 전형적.",
  },
  serrated: {
    label: "Serrated", colorHex: "#f43f5e",
    textCls: "text-rose-400", bgCls: "bg-rose-500/15", ringCls: "ring-rose-500/50",
    korean: "톱니형",
    description: "주기적 파동. 중고온·Ti계 합금에서 전단면 불안정.",
  },
  segmented: {
    label: "Segmented", colorHex: "#0ea5e9",
    textCls: "text-sky-400", bgCls: "bg-sky-500/15", ringCls: "ring-sky-500/50",
    korean: "분절형",
    description: "거친 이송에서 끊어지는 짧은 칩. 배출성은 양호.",
  },
  "built-up": {
    label: "Built-up Edge", colorHex: "#a855f7",
    textCls: "text-violet-400", bgCls: "bg-violet-500/15", ringCls: "ring-violet-500/50",
    korean: "비정형 (구성인선)",
    description: "저온·저속에서 공구날에 재료가 달라붙는 불규칙 형상.",
  },
}

// ── 분류 로직 (Merchant-inspired, deterministic) ─────────────────────
interface ClassifiedChip {
  type: ChipType
  chipThicknessRatio: number
  thermalFactor: number
  reasonTag: string
}

function classifyChip(fz: number, Vc: number, material: string): ClassifiedChip {
  const chipThicknessRatio = fz * Math.sin(Math.PI / 4)
  const baseVc = MATERIAL_BASE_VC[material] ?? DEFAULT_BASE_VC
  const thermalFactor = baseVc > 0 ? Vc / baseVc : 0

  // 우선순위: built-up → segmented → serrated → continuous
  let type: ChipType
  let reasonTag: string
  if (thermalFactor < THERMAL_LOW) {
    type = "built-up"; reasonTag = "저온 → 구성인선 위험"
  } else if (fz > FZ_SEGMENTED_MIN) {
    type = "segmented"; reasonTag = "거친 이송 → 분절"
  } else if (fz >= FZ_CONTINUOUS_MAX && thermalFactor > THERMAL_HIGH) {
    type = "serrated"; reasonTag = "중고온 파동"
  } else if (fz < FZ_CONTINUOUS_MAX && thermalFactor < THERMAL_HIGH) {
    type = "continuous"; reasonTag = "고속·저이송 긴 나선"
  } else if (thermalFactor > THERMAL_HIGH) {
    type = "serrated"; reasonTag = "중고온 경계"
  } else {
    type = "continuous"; reasonTag = "안정 연속"
  }
  return { type, chipThicknessRatio, thermalFactor, reasonTag }
}

// ── 의사난수 (props 기반 seed) ───────────────────────────────────────
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

function hashPropsSeed(fz: number, Vc: number, material: string): number {
  let h = 2166136261
  const str = `${fz.toFixed(4)}|${Vc.toFixed(2)}|${material}`
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// ── 커브 생성 ────────────────────────────────────────────────────────
function makeContinuousCurve(): THREE.CatmullRomCurve3 {
  const points: THREE.Vector3[] = []
  for (let i = 0; i <= CONT_CURVE_SAMPLES; i++) {
    const t = i / CONT_CURVE_SAMPLES
    const a = t * CONT_TURNS * Math.PI * 2
    const y = (t - 0.5) * CONT_LENGTH
    points.push(new THREE.Vector3(Math.cos(a) * CONT_RADIUS, y, Math.sin(a) * CONT_RADIUS))
  }
  return new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.5)
}

function makeSerratedCurve(): THREE.CatmullRomCurve3 {
  const points: THREE.Vector3[] = []
  for (let i = 0; i <= SERR_CURVE_SAMPLES; i++) {
    const t = i / SERR_CURVE_SAMPLES
    const a = t * SERR_TURNS * Math.PI * 2
    const r = SERR_BASE_R + SERR_PULSE_AMP * Math.sin(t * SERR_PULSE_FREQ * Math.PI)
    const y = (t - 0.5) * SERR_LENGTH
    points.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r))
  }
  return new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.5)
}

function makeSegmentedCurves(): THREE.CatmullRomCurve3[] {
  const curves: THREE.CatmullRomCurve3[] = []
  const totalSpan = SEG_COUNT * SEG_LENGTH + (SEG_COUNT - 1) * SEG_GAP
  const startY = -totalSpan / 2
  for (let s = 0; s < SEG_COUNT; s++) {
    const pts: THREE.Vector3[] = []
    const yOffset = startY + s * (SEG_LENGTH + SEG_GAP) + SEG_LENGTH / 2
    for (let i = 0; i <= SEG_CURVE_SAMPLES; i++) {
      const t = i / SEG_CURVE_SAMPLES
      const a = t * SEG_TURNS * Math.PI * 2
      const y = yOffset + (t - 0.5) * SEG_LENGTH
      pts.push(new THREE.Vector3(Math.cos(a) * SEG_RADIUS, y, Math.sin(a) * SEG_RADIUS))
    }
    curves.push(new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5))
  }
  return curves
}

function makeBuiltUpCurve(seed: number): THREE.CatmullRomCurve3 {
  const rnd = mulberry32(seed)
  const pts: THREE.Vector3[] = []
  let y = -(BUE_POINTS * BUE_VERTICAL_STEP) / 2
  for (let i = 0; i < BUE_POINTS; i++) {
    const angle = rnd() * Math.PI * 2
    const radius = BUE_SPREAD * (0.35 + rnd() * 0.65)
    pts.push(new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius))
    y += BUE_VERTICAL_STEP * (0.5 + rnd())
  }
  return new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.3)
}

// ── 3D 메시 ──────────────────────────────────────────────────────────
interface ChipMeshProps {
  chipType: ChipType
  seed: number
  color: string
}

function ChipMesh({ chipType, seed, color }: ChipMeshProps): React.ReactElement {
  const geometries = useMemo(() => {
    const curves: THREE.CatmullRomCurve3[] =
      chipType === "continuous" ? [makeContinuousCurve()]
        : chipType === "serrated" ? [makeSerratedCurve()]
          : chipType === "segmented" ? makeSegmentedCurves()
            : [makeBuiltUpCurve(seed)]
    return curves.map((c) => new THREE.TubeGeometry(
      c, TUBE_TUBULAR_SEGMENTS, TUBE_RADIUS, TUBE_RADIAL_SEGMENTS, false,
    ))
  }, [chipType, seed])

  React.useEffect(() => {
    return () => { for (const g of geometries) g.dispose() }
  }, [geometries])

  return (
    <group>
      {geometries.map((geom, i) => (
        <mesh key={i} geometry={geom} castShadow receiveShadow>
          <meshStandardMaterial
            color={color}
            metalness={0.9}
            roughness={0.25}
            emissive={color}
            emissiveIntensity={0.15}
          />
        </mesh>
      ))}
    </group>
  )
}

function RotatingChipGroup({ chipType, seed, color }: ChipMeshProps): React.ReactElement {
  const groupRef = useRef<THREE.Group>(null)
  useFrame((_s, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += GROUP_ROTATE_SPEED * delta
  })
  return (
    <group ref={groupRef}>
      <ChipMesh chipType={chipType} seed={seed} color={color} />
    </group>
  )
}

interface SceneProps extends ChipMeshProps { darkMode: boolean }

function Scene({ chipType, seed, color, darkMode }: SceneProps): React.ReactElement {
  return (
    <>
      <color attach="background" args={[darkMode ? "#0b1120" : "#f8fafc"]} />
      <ambientLight intensity={darkMode ? 0.35 : 0.6} />
      <directionalLight position={[5, 8, 4]} intensity={darkMode ? 1.1 : 0.9} castShadow />
      <pointLight position={[-4, 2, -3]} intensity={0.6} color={color} />
      <RotatingChipGroup chipType={chipType} seed={seed} color={color} />
    </>
  )
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────
export function ChipMorphology3D({
  fzMmTooth, VcMmin, material, apMm,
  darkMode = false, height = DEFAULT_HEIGHT,
}: ChipMorphology3DProps): React.ReactElement {
  const classified = useMemo(
    () => classifyChip(fzMmTooth, VcMmin, material),
    [fzMmTooth, VcMmin, material],
  )
  const meta = CHIP_META[classified.type]
  const seed = useMemo(
    () => hashPropsSeed(fzMmTooth, VcMmin, material),
    [fzMmTooth, VcMmin, material],
  )

  const textMuted = darkMode ? "text-slate-400" : "text-slate-600"
  const textPrimary = darkMode ? "text-slate-100" : "text-slate-900"
  const subHeadBg = darkMode ? "bg-slate-900/40" : "bg-slate-100/60"
  const legendBorder = darkMode ? "border-slate-800" : "border-slate-200"
  const canvasBorder = darkMode ? "border-slate-800" : "border-slate-200"

  return (
    <HolographicFrame accent="violet" darkMode={darkMode}>
      <div className="flex flex-col gap-2 p-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-semibold ${textPrimary}`}>Chip Morphology 3D</span>
            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide ring-1 ${meta.bgCls} ${meta.textCls} ${meta.ringCls}`}
              aria-label={`현재 칩 유형 ${meta.korean}`}
            >
              {meta.label} · {meta.korean}
            </span>
          </div>
          <LiveIndicator watch={[fzMmTooth, VcMmin, apMm]} color="violet" darkMode={darkMode} />
        </div>

        {/* Reason line */}
        <div className={`rounded-md px-2 py-1 text-[11px] tabular-nums ${subHeadBg} ${textMuted}`}>
          <span>
            fz={fzMmTooth.toFixed(3)} mm/t · Vc={VcMmin.toFixed(0)} m/min · 재료={material} · ap={apMm.toFixed(2)} mm
          </span>
          <span className="mx-1">→</span>
          <span className={meta.textCls}>{meta.korean} · {classified.reasonTag}</span>
        </div>

        {/* Canvas */}
        <div className={`relative overflow-hidden rounded-md border ${canvasBorder}`} style={{ height }}>
          <Canvas
            shadows
            dpr={DPR_RANGE}
            camera={{ position: CAMERA_POS, fov: CAMERA_FOV }}
            gl={{ antialias: true, powerPreference: "high-performance" }}
          >
            <Suspense fallback={null}>
              <Scene chipType={classified.type} seed={seed} color={meta.colorHex} darkMode={darkMode} />
            </Suspense>
            <OrbitControls
              enableZoom
              enablePan={false}
              autoRotate
              autoRotateSpeed={AUTO_ROTATE_SPEED}
              minDistance={3}
              maxDistance={18}
            />
          </Canvas>
        </div>

        {/* Legend */}
        <div className={`flex flex-wrap items-center gap-2 border-t pt-2 ${legendBorder}`} aria-label="칩 유형 범례">
          {(Object.keys(CHIP_META) as ChipType[]).map((k) => {
            const m = CHIP_META[k]
            const active = k === classified.type
            return (
              <div
                key={k}
                className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] ${
                  active ? `${m.bgCls} ring-1 ${m.ringCls} ${m.textCls} font-semibold` : textMuted
                }`}
              >
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: m.colorHex }} aria-hidden="true" />
                <span>{m.label}</span>
                <span className="opacity-70">· {m.korean}</span>
              </div>
            )
          })}
        </div>

        {/* Interpretation hint */}
        <div className={`text-[11px] leading-relaxed ${textMuted}`}>
          현재 칩 모양 → <span className={`font-semibold ${meta.textCls}`}>{meta.korean}</span>. {meta.description}
        </div>

        {/* Debug numeric strip */}
        <div className={`text-[10px] tabular-nums ${textMuted}`} aria-hidden="true">
          chipThicknessRatio={classified.chipThicknessRatio.toFixed(4)} · thermalFactor={classified.thermalFactor.toFixed(2)}
        </div>
      </div>
    </HolographicFrame>
  )
}

export default ChipMorphology3D
