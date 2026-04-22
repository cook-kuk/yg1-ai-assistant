// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Real-time CAM path (G-code → 3D)
//
// 사이드카 전용 컴포넌트 (V3_VIZ_IDEAS.md §6 — Real-time CAM path).
// 사용자가 G-code 텍스트를 붙여넣거나 .nc/.gcode/.tap/.cnc 파일을 업로드하면
// 라인별 파싱 후 3D 공간에 공구 경로를 폴리라인으로 표시하고 커터(small sphere)가
// 경로를 순차 탐색하는 애니메이션을 재생한다.
//
// 지원 subset: G0(rapid) / G1(linear cut) / G2(CW arc) / G3(CCW arc).
// 모달 상태: X Y Z I J K F, 절대좌표(G90) 가정.
// 주의:
//   - cutting-simulator-v2.tsx 는 건드리지 않는다.
//   - 외부 G-code parser 패키지를 추가하지 않는다 (in-file 구현).
//   - DoS 방지: 최대 10,000 라인까지만 파싱.
"use client"

import * as React from "react"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { OrbitControls, Line } from "@react-three/drei"
import * as THREE from "three"

import { HolographicFrame } from "./holographic-frame"
import { LiveIndicator } from "./live-indicator"
import { AnimatedNumber } from "./animated-number"

// ── SSOT — 튜닝 상수 ─────────────────────────────────────────────────
const DEFAULT_CANVAS_HEIGHT = 420
const TEXTAREA_HEIGHT_PX = 180
const MAX_PARSE_LINES = 10_000
const ARC_SAMPLES = 16 // arc 당 polyline 샘플링 point 수
const CAMERA_POS: [number, number, number] = [80, 70, 110]
const CAMERA_FOV = 45
const CAMERA_NEAR = 0.1
const CAMERA_FAR = 5000
const GRID_SIZE = 200
const GRID_DIVISIONS = 20
const AXES_SIZE = 30
const CUTTER_RADIUS = 1.4
const LINE_WIDTH_RAPID = 1.4
const LINE_WIDTH_CUT = 2.2
const LINE_WIDTH_ARC = 2.0
const COLOR_G0 = "#f87171" // red-400 (rapid, dashed)
const COLOR_G1 = "#34d399" // emerald-400 (cut)
const COLOR_ARC = "#22d3ee" // cyan-400 (G2/G3)
const COLOR_CUTTER = "#fbbf24" // amber-400
const DASH_SIZE = 2.5
const GAP_SIZE = 1.5
const SPEED_OPTIONS = [0.25, 1, 4] as const
const DEFAULT_SPEED: number = 1
const DEFAULT_FEED_FALLBACK_MM_MIN = 1500 // F 미지정 시 안전한 cut feed 기본값

// ── Types ────────────────────────────────────────────────────────────
export interface CamGcode3DPathProps {
  /** 미리 로드할 샘플 G-code (선택). */
  initialGcode?: string
  darkMode?: boolean
  /** 3D 캔버스 높이(px). default 420. */
  height?: number
}

type SegmentType = "G0" | "G1" | "arc"

interface Segment {
  type: SegmentType
  from: [number, number, number]
  to: [number, number, number]
  /** feed rate (mm/min). G0 에는 보통 없다. */
  feed?: number
  /** arc 전용 — 상대 offset [I, J, K]. */
  centerOffset?: [number, number, number]
  /** arc 전용 — G2=true (CW). G3=false (CCW). */
  clockwise?: boolean
  /** arc 전용 — polyline 샘플 points (ARC_SAMPLES+1개). 렌더 편의상 pre-compute. */
  arcPoints?: Array<[number, number, number]>
  /** 원본 G-code 라인 번호 (1-based, UI 표시용). */
  sourceLine: number
  /** 경로 길이 (mm). arc 는 샘플링된 polyline 길이로 근사. */
  length: number
}

interface ParseResult {
  segments: Segment[]
  totalLines: number
  /** null = 성공. 숫자 = 파싱 실패 라인 번호(1-based). */
  errorLine: number | null
}

// ── 기본 샘플 G-code (약 30라인, 2D pocket 경로) ─────────────────────
const DEFAULT_SAMPLE_GCODE = `; YG-1 ARIA sample: 2D pocket
; approach → contour → bottom pass → retract
G90 G17 G21
G0 X0 Y0 Z10
M03 S9000
G0 X-20 Y-20
G0 Z2
G1 Z-2 F300
G1 X20 Y-20 F1200
G1 X20 Y20
G1 X-20 Y20
G1 X-20 Y-20
G1 Z-4 F300
G1 X20 Y-20 F1200
G1 X20 Y20
G1 X-20 Y20
G1 X-20 Y-20
G2 X20 Y-20 I20 J0 F900
G3 X-20 Y-20 I-20 J0
G1 Z-6 F200
G1 X0 Y0 F800
G0 Z10
G0 X0 Y0
M05
M30
`

// ── 파서 ─────────────────────────────────────────────────────────────
/**
 * 간이 G-code 파서. 절대좌표 G90 가정.
 * 주석 `;...` 및 괄호 주석 `( ... )` 는 제거.
 * 한 라인에 여러 토큰이 있을 수 있고, G0/G1/G2/G3 modal 상태를 유지한다.
 */
function parseGcode(source: string): ParseResult {
  const rawLines = source.split(/\r?\n/)
  const lines = rawLines.slice(0, MAX_PARSE_LINES)
  const segments: Segment[] = []

  let pos: [number, number, number] = [0, 0, 0]
  let feed = 0
  let modal: SegmentType | null = null

  const TOKEN_RE = /([A-Z])(-?\d+(?:\.\d+)?)/g

  for (let li = 0; li < lines.length; li++) {
    const rawLine = lines[li]
    // 괄호 주석 제거
    let clean = rawLine.replace(/\([^)]*\)/g, "")
    // 세미콜론 주석 제거
    const semi = clean.indexOf(";")
    if (semi >= 0) clean = clean.slice(0, semi)
    clean = clean.trim()
    if (!clean) continue

    // 토큰 수집
    const tokens: Record<string, number> = {}
    const gCodes: number[] = []
    try {
      let m: RegExpExecArray | null
      TOKEN_RE.lastIndex = 0
      while ((m = TOKEN_RE.exec(clean)) !== null) {
        const letter = m[1]
        const num = Number(m[2])
        if (!Number.isFinite(num)) {
          return { segments, totalLines: lines.length, errorLine: li + 1 }
        }
        if (letter === "G") {
          gCodes.push(num)
        } else {
          // 마지막 토큰 값을 유지 (동일 letter 중복 시)
          tokens[letter] = num
        }
      }
    } catch {
      return { segments, totalLines: lines.length, errorLine: li + 1 }
    }

    // G-code motion 타입 결정 (line 내 G0/1/2/3 우선 → 없으면 modal)
    let nextModal: SegmentType | null = modal
    for (const g of gCodes) {
      if (g === 0) nextModal = "G0"
      else if (g === 1) nextModal = "G1"
      else if (g === 2 || g === 3) nextModal = "arc"
      // G90/G17/G21 등 기타는 modal 타입에 영향 없음 (여기선 무시)
    }

    // feed 업데이트 (F 토큰)
    if (tokens.F !== undefined) feed = tokens.F

    // 좌표 토큰이 하나라도 있는지
    const hasCoord =
      tokens.X !== undefined ||
      tokens.Y !== undefined ||
      tokens.Z !== undefined
    const hasArcOffset =
      tokens.I !== undefined ||
      tokens.J !== undefined ||
      tokens.K !== undefined

    if (!hasCoord && !hasArcOffset) {
      // motion 없음 → modal만 업데이트하고 다음 라인
      modal = nextModal
      continue
    }

    const to: [number, number, number] = [
      tokens.X !== undefined ? tokens.X : pos[0],
      tokens.Y !== undefined ? tokens.Y : pos[1],
      tokens.Z !== undefined ? tokens.Z : pos[2],
    ]

    // motion 타입이 결정되지 않았다면 (첫 G 토큰이 없는 헤더 라인 등) 스킵
    if (nextModal === null) {
      pos = to
      continue
    }

    if (nextModal === "arc") {
      // G2 = CW, G3 = CCW. 마지막으로 본 G 번호를 찾아야 하므로 gCodes 에서 식별.
      let clockwise = true
      for (let gi = gCodes.length - 1; gi >= 0; gi--) {
        if (gCodes[gi] === 2) { clockwise = true; break }
        if (gCodes[gi] === 3) { clockwise = false; break }
      }
      const i = tokens.I ?? 0
      const j = tokens.J ?? 0
      const k = tokens.K ?? 0
      const arcPoints = sampleArc(pos, to, [i, j, k], clockwise)
      const length = polylineLength(arcPoints)
      segments.push({
        type: "arc",
        from: pos,
        to,
        feed,
        centerOffset: [i, j, k],
        clockwise,
        arcPoints,
        sourceLine: li + 1,
        length,
      })
    } else {
      // G0 / G1
      const length = distance3(pos, to)
      segments.push({
        type: nextModal,
        from: pos,
        to,
        feed: nextModal === "G0" ? undefined : feed || DEFAULT_FEED_FALLBACK_MM_MIN,
        sourceLine: li + 1,
        length,
      })
    }

    pos = to
    modal = nextModal
  }

  return { segments, totalLines: lines.length, errorLine: null }
}

function distance3(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const dz = b[2] - a[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function polylineLength(pts: Array<[number, number, number]>): number {
  let sum = 0
  for (let i = 1; i < pts.length; i++) sum += distance3(pts[i - 1], pts[i])
  return sum
}

/**
 * XY 평면 원호(G17) 샘플링. I/J 는 from 기준 center 상대 offset.
 * K(Z offset) 는 무시 — 단순화. 필요 시 from→to 사이 Z 를 선형 보간한다.
 */
function sampleArc(
  from: [number, number, number],
  to: [number, number, number],
  offset: [number, number, number],
  clockwise: boolean,
): Array<[number, number, number]> {
  const cx = from[0] + offset[0]
  const cy = from[1] + offset[1]
  const r = Math.sqrt(
    (from[0] - cx) * (from[0] - cx) + (from[1] - cy) * (from[1] - cy),
  )
  const a0 = Math.atan2(from[1] - cy, from[0] - cx)
  const a1 = Math.atan2(to[1] - cy, to[0] - cx)
  let sweep = a1 - a0
  // G2 = CW → sweep negative; G3 = CCW → sweep positive
  if (clockwise) {
    if (sweep >= 0) sweep -= Math.PI * 2
  } else {
    if (sweep <= 0) sweep += Math.PI * 2
  }
  const pts: Array<[number, number, number]> = []
  for (let i = 0; i <= ARC_SAMPLES; i++) {
    const t = i / ARC_SAMPLES
    const a = a0 + sweep * t
    const x = cx + r * Math.cos(a)
    const y = cy + r * Math.sin(a)
    const z = from[2] + (to[2] - from[2]) * t
    pts.push([x, y, z])
  }
  return pts
}

// ── 경로 진행 계산 (cutter position 애니메이션) ──────────────────────
interface ProgressResult {
  position: [number, number, number]
  segmentIndex: number
}

function computeProgress(
  segments: Segment[],
  totalLength: number,
  progressMm: number,
): ProgressResult {
  if (segments.length === 0) {
    return { position: [0, 0, 0], segmentIndex: -1 }
  }
  const p = Math.max(0, Math.min(progressMm, totalLength))
  let acc = 0
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (acc + seg.length >= p || i === segments.length - 1) {
      const local = seg.length > 0 ? (p - acc) / seg.length : 1
      if (seg.type === "arc" && seg.arcPoints && seg.arcPoints.length > 1) {
        // arc 진행: polyline 누적 거리 기반 보간
        const pts = seg.arcPoints
        let segAcc = 0
        const targetLocal = local * seg.length
        for (let k = 1; k < pts.length; k++) {
          const d = distance3(pts[k - 1], pts[k])
          if (segAcc + d >= targetLocal || k === pts.length - 1) {
            const t = d > 0 ? (targetLocal - segAcc) / d : 1
            const pa = pts[k - 1]
            const pb = pts[k]
            return {
              position: [
                pa[0] + (pb[0] - pa[0]) * t,
                pa[1] + (pb[1] - pa[1]) * t,
                pa[2] + (pb[2] - pa[2]) * t,
              ],
              segmentIndex: i,
            }
          }
          segAcc += d
        }
      }
      const pa = seg.from
      const pb = seg.to
      return {
        position: [
          pa[0] + (pb[0] - pa[0]) * local,
          pa[1] + (pb[1] - pa[1]) * local,
          pa[2] + (pb[2] - pa[2]) * local,
        ],
        segmentIndex: i,
      }
    }
    acc += seg.length
  }
  const last = segments[segments.length - 1]
  return { position: last.to, segmentIndex: segments.length - 1 }
}

// ── Scene (R3F) ──────────────────────────────────────────────────────
interface SceneProps {
  segments: Segment[]
  cutterPos: [number, number, number]
  darkMode: boolean
}

function Scene({ segments, cutterPos, darkMode }: SceneProps): React.ReactElement {
  return (
    <>
      <color attach="background" args={[darkMode ? "#0b1120" : "#f1f5f9"]} />
      <ambientLight intensity={darkMode ? 0.45 : 0.75} />
      <directionalLight position={[60, 80, 60]} intensity={darkMode ? 0.9 : 0.7} />
      <axesHelper args={[AXES_SIZE]} />
      <gridHelper
        args={[
          GRID_SIZE,
          GRID_DIVISIONS,
          darkMode ? "#1e293b" : "#cbd5e1",
          darkMode ? "#0f172a" : "#e2e8f0",
        ]}
      />
      <PathLines segments={segments} />
      <mesh position={cutterPos}>
        <sphereGeometry args={[CUTTER_RADIUS, 18, 18]} />
        <meshStandardMaterial
          color={COLOR_CUTTER}
          emissive={COLOR_CUTTER}
          emissiveIntensity={0.55}
          metalness={0.4}
          roughness={0.3}
        />
      </mesh>
    </>
  )
}

interface PathLinesProps {
  segments: Segment[]
}

function PathLines({ segments }: PathLinesProps): React.ReactElement {
  // 타입별 점 배열로 구분
  const rapidLines = useMemo(() => {
    return segments
      .filter((s) => s.type === "G0")
      .map((s, idx): { key: string; points: Array<[number, number, number]> } => ({
        key: `g0-${idx}-${s.sourceLine}`,
        points: [s.from, s.to],
      }))
  }, [segments])

  const cutLines = useMemo(() => {
    return segments
      .filter((s) => s.type === "G1")
      .map((s, idx): { key: string; points: Array<[number, number, number]> } => ({
        key: `g1-${idx}-${s.sourceLine}`,
        points: [s.from, s.to],
      }))
  }, [segments])

  const arcLines = useMemo(() => {
    return segments
      .filter((s) => s.type === "arc" && s.arcPoints && s.arcPoints.length >= 2)
      .map((s, idx): { key: string; points: Array<[number, number, number]> } => ({
        key: `arc-${idx}-${s.sourceLine}`,
        points: s.arcPoints!,
      }))
  }, [segments])

  return (
    <group>
      {rapidLines.map((l) => (
        <Line
          key={l.key}
          points={l.points}
          color={COLOR_G0}
          lineWidth={LINE_WIDTH_RAPID}
          dashed
          dashSize={DASH_SIZE}
          gapSize={GAP_SIZE}
          transparent
          opacity={0.85}
        />
      ))}
      {cutLines.map((l) => (
        <Line
          key={l.key}
          points={l.points}
          color={COLOR_G1}
          lineWidth={LINE_WIDTH_CUT}
        />
      ))}
      {arcLines.map((l) => (
        <Line
          key={l.key}
          points={l.points}
          color={COLOR_ARC}
          lineWidth={LINE_WIDTH_ARC}
        />
      ))}
    </group>
  )
}

// ── Progress driver (useFrame) ───────────────────────────────────────
interface ProgressDriverProps {
  playing: boolean
  speed: number
  totalLength: number
  /** mm 단위 현재 진행거리. setProgress 로 외부에 반영. */
  progress: number
  setProgress: (mm: number) => void
}

/**
 * R3F useFrame 드라이버. playing=true 이면 delta 시간에 speed*approxFeed 를 곱해
 * progressMm 를 증가시킨다. 간단 근사: 평균 feed 1500 mm/min = 25 mm/s.
 */
function ProgressDriver({
  playing,
  speed,
  totalLength,
  progress,
  setProgress,
}: ProgressDriverProps): null {
  const progressRef = useRef(progress)
  progressRef.current = progress

  useFrame((_s, delta) => {
    if (!playing || totalLength <= 0) return
    const baseMmPerSec = 25 // 1500 mm/min
    const next = progressRef.current + baseMmPerSec * speed * delta
    if (next >= totalLength) {
      setProgress(totalLength)
    } else {
      setProgress(next)
    }
  })
  return null
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────
export function CamGcode3DPath({
  initialGcode,
  darkMode = false,
  height = DEFAULT_CANVAS_HEIGHT,
}: CamGcode3DPathProps): React.ReactElement {
  const [gcodeText, setGcodeText] = useState<string>(
    initialGcode ?? DEFAULT_SAMPLE_GCODE,
  )
  const [playing, setPlaying] = useState<boolean>(false)
  const [speed, setSpeed] = useState<number>(DEFAULT_SPEED)
  const [progress, setProgress] = useState<number>(0)
  const [fileError, setFileError] = useState<string | null>(null)

  // useMemo: gcodeText 변화 시에만 parse
  const parsed = useMemo<ParseResult>(() => parseGcode(gcodeText), [gcodeText])

  const totalLength = useMemo(() => {
    let sum = 0
    for (const s of parsed.segments) sum += s.length
    return sum
  }, [parsed.segments])

  const rapidLength = useMemo(() => {
    let sum = 0
    for (const s of parsed.segments) if (s.type === "G0") sum += s.length
    return sum
  }, [parsed.segments])

  const cutLength = useMemo(() => totalLength - rapidLength, [totalLength, rapidLength])

  // 추정 시간 (분): G0 rapid 는 10000 mm/min 가정, 그 외는 각 segment feed 또는 fallback
  const estimatedMinutes = useMemo(() => {
    let t = 0
    for (const s of parsed.segments) {
      if (s.length <= 0) continue
      if (s.type === "G0") {
        t += s.length / 10000
      } else {
        const f = s.feed && s.feed > 0 ? s.feed : DEFAULT_FEED_FALLBACK_MM_MIN
        t += s.length / f
      }
    }
    return t
  }, [parsed.segments])

  const progressState = useMemo<ProgressResult>(
    () => computeProgress(parsed.segments, totalLength, progress),
    [parsed.segments, totalLength, progress],
  )

  // gcodeText 변경 시 progress 리셋
  useEffect(() => {
    setProgress(0)
    setPlaying(false)
  }, [gcodeText])

  // file upload handler
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 5 * 1024 * 1024) {
      setFileError(`파일이 너무 큽니다 (${(f.size / 1024 / 1024).toFixed(1)} MB > 5 MB)`)
      return
    }
    setFileError(null)
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : ""
      setGcodeText(text)
    }
    reader.onerror = () => setFileError("파일 읽기 실패")
    reader.readAsText(f)
    // 동일 파일 재선택 허용
    e.target.value = ""
  }

  const dark = darkMode
  const panelBg = dark ? "bg-slate-950/70" : "bg-white/80"
  const textMuted = dark ? "text-slate-400" : "text-slate-600"
  const textStrong = dark ? "text-slate-100" : "text-slate-900"
  const chipBg = dark ? "bg-slate-900 ring-slate-700" : "bg-slate-100 ring-slate-300"

  return (
    <HolographicFrame accent="emerald" intensity="medium" darkMode={dark}>
      <div className={`p-4 space-y-3 ${panelBg}`}>
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <LiveIndicator
              watch={[parsed.segments.length, progressState.segmentIndex]}
              label="CAM PATH"
              color="emerald"
              darkMode={dark}
            />
            <span className={`text-xs ${textMuted}`}>
              G-code → 3D tool path
            </span>
          </div>
          <div className={`text-[10px] ${textMuted}`}>
            lines: <span className={`${textStrong} tabular-nums`}>{parsed.totalLines}</span>
            {" · "}segs: <span className={`${textStrong} tabular-nums`}>{parsed.segments.length}</span>
          </div>
        </div>

        {/* Textarea */}
        <textarea
          value={gcodeText}
          onChange={(e) => setGcodeText(e.target.value)}
          spellCheck={false}
          className={`w-full font-mono text-[11px] leading-relaxed rounded-md border px-2 py-1.5 outline-none ${
            dark
              ? "bg-slate-950 border-slate-700 text-emerald-300 focus:border-emerald-500"
              : "bg-slate-50 border-slate-300 text-slate-800 focus:border-emerald-500"
          }`}
          style={{ height: TEXTAREA_HEIGHT_PX, resize: "vertical" }}
          aria-label="G-code input"
        />

        {/* Parse error */}
        {parsed.errorLine !== null && (
          <div
            role="alert"
            className="rounded-md border border-rose-500 bg-rose-500/10 px-2 py-1 text-[11px] font-medium text-rose-400"
          >
            파싱 실패: line {parsed.errorLine}
          </div>
        )}
        {fileError && (
          <div
            role="alert"
            className="rounded-md border border-rose-500 bg-rose-500/10 px-2 py-1 text-[11px] font-medium text-rose-400"
          >
            {fileError}
          </div>
        )}

        {/* Controls row */}
        <div className="flex flex-wrap items-center gap-2">
          <label
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ring-1 ${chipBg} ${textStrong} hover:ring-emerald-500`}
          >
            <span>파일 업로드</span>
            <input
              type="file"
              accept=".nc,.gcode,.tap,.cnc"
              onChange={onFile}
              className="hidden"
            />
          </label>
          <button
            type="button"
            onClick={() => setGcodeText(DEFAULT_SAMPLE_GCODE)}
            className={`rounded-md px-2 py-1 text-[11px] font-medium ring-1 ${chipBg} ${textStrong} hover:ring-emerald-500`}
          >
            샘플 로드
          </button>
          <div className="h-5 w-px bg-slate-500/40" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            disabled={parsed.segments.length === 0 || totalLength <= 0}
            className={`rounded-md px-3 py-1 text-[11px] font-semibold ring-1 ${
              playing
                ? "bg-amber-500 text-slate-900 ring-amber-600"
                : "bg-emerald-500 text-slate-900 ring-emerald-600"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {playing ? "일시정지" : "재생"}
          </button>
          <button
            type="button"
            onClick={() => {
              setProgress(0)
              setPlaying(false)
            }}
            className={`rounded-md px-2 py-1 text-[11px] font-medium ring-1 ${chipBg} ${textStrong} hover:ring-emerald-500`}
          >
            리셋
          </button>
          <div className={`flex items-center gap-1 text-[10px] ${textMuted}`}>
            <span>속도</span>
            {SPEED_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setSpeed(opt)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${
                  speed === opt
                    ? "bg-emerald-500 text-slate-900 ring-emerald-600"
                    : `${chipBg} ${textStrong} hover:ring-emerald-500`
                }`}
              >
                {opt}×
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2 text-[10px]">
            <LegendDot color={COLOR_G0} label="G0 rapid" dashed />
            <LegendDot color={COLOR_G1} label="G1 cut" />
            <LegendDot color={COLOR_ARC} label="G2/3 arc" />
          </div>
        </div>

        {/* Canvas */}
        <div
          className="relative w-full overflow-hidden rounded-md border border-emerald-500/30"
          style={{ height }}
        >
          <Canvas
            camera={{
              position: CAMERA_POS,
              fov: CAMERA_FOV,
              near: CAMERA_NEAR,
              far: CAMERA_FAR,
            }}
            dpr={[1, 2]}
          >
            <Suspense fallback={null}>
              <Scene
                segments={parsed.segments}
                cutterPos={progressState.position}
                darkMode={dark}
              />
              <ProgressDriver
                playing={playing}
                speed={speed}
                totalLength={totalLength}
                progress={progress}
                setProgress={setProgress}
              />
              <OrbitControls enableZoom autoRotate={false} makeDefault />
            </Suspense>
          </Canvas>

          {/* HUD — 현재 위치 / 세그먼트 */}
          <div
            className={`pointer-events-none absolute left-2 top-2 rounded-md px-2 py-1 text-[10px] font-mono ring-1 ${
              dark
                ? "bg-slate-950/80 ring-emerald-500/40 text-emerald-300"
                : "bg-white/80 ring-emerald-500/40 text-emerald-700"
            }`}
          >
            <div>
              seg{" "}
              <span className="tabular-nums">
                {progressState.segmentIndex + 1}
              </span>
              /{parsed.segments.length}
            </div>
            <div>
              X{progressState.position[0].toFixed(2)}
              {" "}Y{progressState.position[1].toFixed(2)}
              {" "}Z{progressState.position[2].toFixed(2)}
            </div>
          </div>
        </div>

        {/* Summary strip */}
        <div
          className={`grid grid-cols-2 gap-2 rounded-md border px-3 py-2 text-[11px] md:grid-cols-5 ${
            dark ? "border-slate-700 bg-slate-900/70" : "border-slate-300 bg-slate-50"
          }`}
        >
          <SummaryStat label="파싱 라인" value={parsed.totalLines} decimals={0} suffix="" dark={dark} />
          <SummaryStat label="G0 rapid" value={rapidLength} decimals={1} suffix=" mm" dark={dark} />
          <SummaryStat label="G1/2/3 cut" value={cutLength} decimals={1} suffix=" mm" dark={dark} />
          <SummaryStat label="total path" value={totalLength} decimals={1} suffix=" mm" dark={dark} />
          <SummaryStat label="예상 시간" value={estimatedMinutes} decimals={2} suffix=" min" dark={dark} />
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className={`flex justify-between text-[10px] ${textMuted}`}>
            <span>progress</span>
            <span className="tabular-nums">
              {progress.toFixed(1)} / {totalLength.toFixed(1)} mm
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(totalLength, 0.001)}
            step={Math.max(totalLength / 400, 0.01)}
            value={Math.min(progress, Math.max(totalLength, 0))}
            onChange={(e) => {
              setProgress(Number(e.target.value))
              setPlaying(false)
            }}
            className="w-full accent-emerald-500"
            aria-label="Progress scrubber"
          />
        </div>
      </div>
    </HolographicFrame>
  )
}

// ── 작은 유틸 컴포넌트 ───────────────────────────────────────────────
interface SummaryStatProps {
  label: string
  value: number
  decimals: number
  suffix: string
  dark: boolean
}

function SummaryStat({ label, value, decimals, suffix, dark }: SummaryStatProps): React.ReactElement {
  return (
    <div className="flex flex-col">
      <span className={`text-[9px] uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-500"}`}>
        {label}
      </span>
      <AnimatedNumber
        value={value}
        decimals={decimals}
        suffix={suffix}
        className={`text-[12px] font-semibold ${dark ? "text-emerald-300" : "text-emerald-700"}`}
      />
    </div>
  )
}

interface LegendDotProps {
  color: string
  label: string
  dashed?: boolean
}

function LegendDot({ color, label, dashed = false }: LegendDotProps): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden="true"
        className="inline-block h-[2px] w-4"
        style={{
          background: dashed
            ? `repeating-linear-gradient(90deg, ${color} 0 3px, transparent 3px 6px)`
            : color,
        }}
      />
      <span className="text-[10px] text-slate-500">{label}</span>
    </span>
  )
}

export default CamGcode3DPath

// ── 내부 export (테스트 편의용, 타입 캐스팅 피함) ────────────────────
export { parseGcode as _parseGcode_forTests }
export type { Segment as _Segment, ParseResult as _ParseResult }
