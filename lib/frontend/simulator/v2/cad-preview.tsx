// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — CAD (STL) Preview Sidecar
//
// V3_VIZ_IDEAS #9 CAD STEP Preview 의 client-only 축소판 구현.
//   - .stl (binary / ASCII) 파싱 → BufferGeometry 생성 → R3F Canvas 렌더
//   - .step / .stp 업로드 시: OCCT.wasm 미탑재로 안내 메시지만 표시
//   - HUD: 파일명 / 삼각형수 / 체적(mm³·cm³) / 바운딩박스 / 추정 가공시간
//
// 주의:
//   - cutting-simulator-v2.tsx 는 절대 건드리지 않는다. 본 파일은 독립 사이드카.
//   - three-stdlib / occt-import-js / stl-parser 등 신규 의존성 추가 금지.
//   - 매직넘버는 본 파일 상단 SSOT 블록에 집약.
"use client"

import * as React from "react"
import { Canvas } from "@react-three/fiber"
import { OrbitControls, Center, Bounds } from "@react-three/drei"
import { BufferGeometry, Float32BufferAttribute, Box3, Vector3 } from "three"

import { HolographicFrame } from "./holographic-frame"
import { AnimatedNumber } from "./animated-number"
import { LiveIndicator } from "./live-indicator"

// ─────────────────────────────────────────────
// 로컬 SSOT
// ─────────────────────────────────────────────
const DEFAULT_HEIGHT = 420
const MAX_FILE_MB = 50
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024
/** Binary STL header size (bytes). */
const STL_HEADER_BYTES = 80
/** Per-triangle: 3 float32 normal + 9 float32 vertices + uint16 attribute = 50 B. */
const STL_TRIANGLE_BYTES = 50
/** Estimated MRR (cm³/min) used for rough machining-time hint. */
const TYPICAL_MRR_CM3_PER_MIN = 50
/** axesHelper scale in scene units (mm). */
const AXES_SCALE = 10

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export interface CadPreviewProps {
  darkMode?: boolean
  /** Canvas height (px). default 420 */
  height?: number
}

interface ParsedStl {
  geometry: BufferGeometry
  triangleCount: number
  volumeMm3: number
  bbox: { sizeX: number; sizeY: number; sizeZ: number }
}

type Status =
  | { kind: "idle" }
  | { kind: "parsing"; name: string }
  | { kind: "ready"; name: string; parsed: ParsedStl }
  | { kind: "error"; name: string; message: string }
  | { kind: "step-placeholder"; name: string }
  | { kind: "too-large"; name: string; sizeMb: number }

// ─────────────────────────────────────────────
// STL Parser (inline, client-only)
// ─────────────────────────────────────────────

/** Binary STL iff total bytes == 80 header + 4 count + count*50. */
function isBinaryStl(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < STL_HEADER_BYTES + 4) return false
  const triCount = new DataView(buffer).getUint32(STL_HEADER_BYTES, true)
  const expected = STL_HEADER_BYTES + 4 + triCount * STL_TRIANGLE_BYTES
  return expected === buffer.byteLength && triCount > 0
}

function parseBinaryStl(buffer: ArrayBuffer): ParsedStl {
  const view = new DataView(buffer)
  const triCount = view.getUint32(STL_HEADER_BYTES, true)
  const positions = new Float32Array(triCount * 9)
  let offset = STL_HEADER_BYTES + 4
  let pIdx = 0
  for (let i = 0; i < triCount; i++) {
    offset += 12 // skip normal (3 float32)
    for (let v = 0; v < 3; v++) {
      positions[pIdx++] = view.getFloat32(offset, true)
      positions[pIdx++] = view.getFloat32(offset + 4, true)
      positions[pIdx++] = view.getFloat32(offset + 8, true)
      offset += 12
    }
    offset += 2 // skip uint16 attribute
  }
  return finalizeGeometry(positions, triCount)
}

function parseAsciiStl(text: string): ParsedStl {
  const vertexRe = /vertex\s+(-?\d+\.?\d*(?:[eE][+-]?\d+)?)\s+(-?\d+\.?\d*(?:[eE][+-]?\d+)?)\s+(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g
  const coords: number[] = []
  let m: RegExpExecArray | null
  while ((m = vertexRe.exec(text)) !== null) {
    coords.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]))
  }
  if (coords.length === 0 || coords.length % 9 !== 0) {
    throw new Error("ASCII STL: vertex 수가 3의 배수가 아닙니다")
  }
  return finalizeGeometry(new Float32Array(coords), coords.length / 9)
}

function finalizeGeometry(positions: Float32Array, triCount: number): ParsedStl {
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()

  const box = new Box3().setFromBufferAttribute(
    geometry.getAttribute("position") as Float32BufferAttribute,
  )
  const size = new Vector3()
  box.getSize(size)

  // signed-tetrahedron sum: V = |Σ v1·(v2×v3)| / 6
  let vol6 = 0
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i],     ay = positions[i + 1], az = positions[i + 2]
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5]
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8]
    const crX = by * cz - bz * cy
    const crY = bz * cx - bx * cz
    const crZ = bx * cy - by * cx
    vol6 += ax * crX + ay * crY + az * crZ
  }

  return {
    geometry,
    triangleCount: triCount,
    volumeMm3: Math.abs(vol6) / 6,
    bbox: { sizeX: size.x, sizeY: size.y, sizeZ: size.z },
  }
}

// ─────────────────────────────────────────────
// File helpers
// ─────────────────────────────────────────────
function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onerror = () => reject(fr.error ?? new Error("FileReader error"))
    fr.onload = () => resolve(fr.result as ArrayBuffer)
    fr.readAsArrayBuffer(file)
  })
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onerror = () => reject(fr.error ?? new Error("FileReader error"))
    fr.onload = () => resolve(fr.result as string)
    fr.readAsText(file)
  })
}

function fileExtension(name: string): string {
  const i = name.lastIndexOf(".")
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ""
}

function truncateName(name: string, max = 42): string {
  if (name.length <= max) return name
  const ext = fileExtension(name)
  return `${name.slice(0, max - ext.length - 4)}….${ext}`
}

function formatNumber(n: number, decimals = 2): string {
  return n.toLocaleString("ko-KR", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  })
}

// ─────────────────────────────────────────────
// Palette
// ─────────────────────────────────────────────
interface Palette {
  text: string; sub: string; border: string
  dropIdle: string; dropHover: string
  hud: string; canvasBg: string; meshColor: string; btn: string
}

function buildPalette(darkMode: boolean): Palette {
  return darkMode
    ? {
        text: "text-slate-100", sub: "text-slate-400",
        border: "border-indigo-500/60",
        dropIdle: "border-slate-700 bg-slate-900/40 text-slate-300",
        dropHover: "border-indigo-400 bg-indigo-500/10 text-indigo-200",
        hud: "bg-slate-950/60 ring-1 ring-slate-800",
        canvasBg: "#0b1020", meshColor: "#93c5fd",
        btn: "bg-slate-800 hover:bg-slate-700 text-slate-100 ring-1 ring-slate-700",
      }
    : {
        text: "text-slate-900", sub: "text-slate-500",
        border: "border-indigo-300",
        dropIdle: "border-slate-300 bg-slate-50 text-slate-600",
        dropHover: "border-indigo-500 bg-indigo-50 text-indigo-700",
        hud: "bg-white/70 ring-1 ring-slate-200",
        canvasBg: "#f1f5f9", meshColor: "#4f46e5",
        btn: "bg-white hover:bg-slate-50 text-slate-800 ring-1 ring-slate-300",
      }
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

function CadPreview({
  darkMode = false,
  height = DEFAULT_HEIGHT,
}: CadPreviewProps): React.ReactElement {
  const [status, setStatus] = React.useState<Status>({ kind: "idle" })
  const [dragOver, setDragOver] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Dispose geometry when replaced or on unmount.
  const geoRef = React.useRef<BufferGeometry | null>(null)
  React.useEffect(() => {
    if (status.kind === "ready") geoRef.current = status.parsed.geometry
  }, [status])
  React.useEffect(() => {
    return () => {
      geoRef.current?.dispose()
      geoRef.current = null
    }
  }, [])

  const reset = React.useCallback(() => {
    geoRef.current?.dispose()
    geoRef.current = null
    setStatus({ kind: "idle" })
    if (inputRef.current) inputRef.current.value = ""
  }, [])

  const handleFile = React.useCallback(async (file: File) => {
    geoRef.current?.dispose()
    geoRef.current = null

    const sizeMb = file.size / (1024 * 1024)
    if (file.size > MAX_FILE_BYTES) {
      setStatus({ kind: "too-large", name: file.name, sizeMb })
      return
    }
    const ext = fileExtension(file.name)
    if (ext === "step" || ext === "stp") {
      setStatus({ kind: "step-placeholder", name: file.name })
      return
    }
    if (ext !== "stl") {
      setStatus({
        kind: "error",
        name: file.name,
        message: "지원되지 않는 확장자 (.stl / .step / .stp 만 허용)",
      })
      return
    }

    setStatus({ kind: "parsing", name: file.name })
    try {
      const buffer = await readAsArrayBuffer(file)
      const parsed = isBinaryStl(buffer)
        ? parseBinaryStl(buffer)
        : parseAsciiStl(await readAsText(file))
      setStatus({ kind: "ready", name: file.name, parsed })
    } catch (err) {
      setStatus({
        kind: "error",
        name: file.name,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [])

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) void handleFile(f)
  }
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) void handleFile(f)
  }
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (!dragOver) setDragOver(true)
  }
  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
  }

  const palette = buildPalette(darkMode)
  const liveWatch: number[] =
    status.kind === "ready"
      ? [
          status.parsed.triangleCount,
          status.parsed.volumeMm3,
          status.parsed.bbox.sizeX,
          status.parsed.bbox.sizeY,
          status.parsed.bbox.sizeZ,
        ]
      : [0]

  return (
    <HolographicFrame accent="indigo" intensity="medium" darkMode={darkMode}>
      <div className={`p-4 ${palette.text}`}>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold tracking-wider uppercase">
              CAD Preview
            </span>
            <LiveIndicator
              watch={liveWatch}
              label="CAD"
              color="violet"
              darkMode={darkMode}
            />
          </div>
          {status.kind !== "idle" && (
            <button
              type="button"
              onClick={reset}
              className={`rounded-md px-2 py-1 text-xs font-semibold ${palette.btn}`}
            >
              재설정
            </button>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".stl,.step,.stp"
          onChange={onInputChange}
          className="hidden"
        />

        {status.kind === "ready" ? (
          <ReadyLayout status={status} palette={palette} height={height} />
        ) : (
          <div
            className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
              dragOver ? palette.dropHover : palette.dropIdle
            }`}
            onClick={() => inputRef.current?.click()}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                inputRef.current?.click()
              }
            }}
            role="button"
            tabIndex={0}
            style={{ minHeight: height }}
          >
            <StateMessage status={status} darkMode={darkMode} />
          </div>
        )}
      </div>
    </HolographicFrame>
  )
}

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function StateMessage({
  status,
  darkMode,
}: {
  status: Status
  darkMode: boolean
}): React.ReactElement {
  if (status.kind === "idle") {
    return (
      <div className="flex flex-col items-center gap-2">
        <div className="text-3xl" aria-hidden>📂</div>
        <div className="text-sm font-semibold">
          STL 파일을 드래그하거나 클릭하여 업로드
        </div>
        <div className={`text-xs ${darkMode ? "text-slate-500" : "text-slate-500"}`}>
          지원: .stl (binary · ASCII) / .step · .stp (placeholder)
        </div>
        <div className={`text-[10px] ${darkMode ? "text-slate-600" : "text-slate-400"}`}>
          최대 {MAX_FILE_MB} MB
        </div>
      </div>
    )
  }
  if (status.kind === "parsing") {
    return (
      <div className="flex flex-col items-center gap-2">
        <div className="text-3xl animate-pulse" aria-hidden>⏳</div>
        <div className="text-sm font-semibold">파싱 중…</div>
        <div className="text-xs opacity-70">{truncateName(status.name)}</div>
      </div>
    )
  }
  if (status.kind === "step-placeholder") {
    return (
      <div className="flex flex-col items-center gap-2">
        <div className="text-3xl" aria-hidden>🛈</div>
        <div className="text-sm font-semibold">파일 형식 감지 — STEP</div>
        <div className="text-xs max-w-md">
          STEP 변환 시 서버 API 필요. 현재 버전은 STL만 지원합니다.
        </div>
        <div className="text-[10px] opacity-70">{truncateName(status.name)}</div>
      </div>
    )
  }
  if (status.kind === "too-large") {
    return (
      <div className="flex flex-col items-center gap-2">
        <div className="text-3xl" aria-hidden>⚠️</div>
        <div className="text-sm font-semibold text-amber-500">
          파일 크기 초과 ({formatNumber(status.sizeMb, 1)} MB)
        </div>
        <div className="text-xs">
          최대 {MAX_FILE_MB} MB까지 업로드 가능합니다.
        </div>
        <div className="text-[10px] opacity-70">{truncateName(status.name)}</div>
      </div>
    )
  }
  if (status.kind === "error") {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-rose-500/70 bg-rose-500/10 p-4">
        <div className="text-3xl" aria-hidden>❌</div>
        <div className="text-sm font-semibold text-rose-500">파싱 실패</div>
        <div className="text-xs max-w-md text-rose-400">
          파일이 손상되었거나 지원되지 않는 형식입니다
        </div>
        <div className="text-[10px] opacity-70 text-rose-300">
          {truncateName(status.name)} — {status.message}
        </div>
      </div>
    )
  }
  // ready is rendered elsewhere; defensive fallback.
  return <div className="text-xs opacity-60">(no status)</div>
}

function ReadyLayout({
  status,
  palette,
  height,
}: {
  status: Extract<Status, { kind: "ready" }>
  palette: Palette
  height: number
}): React.ReactElement {
  const { parsed, name } = status
  const volumeCm3 = parsed.volumeMm3 / 1000
  const bboxVolumeCm3 =
    (parsed.bbox.sizeX * parsed.bbox.sizeY * parsed.bbox.sizeZ) / 1000
  const estMinutes = bboxVolumeCm3 / TYPICAL_MRR_CM3_PER_MIN

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_260px]">
      <div
        className={`rounded-lg overflow-hidden ring-1 ${palette.border}`}
        style={{ height, background: palette.canvasBg }}
      >
        <Canvas
          camera={{ position: [80, 60, 100], fov: 38, near: 0.1, far: 5000 }}
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: false }}
        >
          <color attach="background" args={[palette.canvasBg]} />
          <ambientLight intensity={0.55} />
          <directionalLight position={[60, 80, 50]} intensity={0.95} />
          <directionalLight position={[-70, -20, -40]} intensity={0.35} />
          <Bounds fit clip observe margin={1.15}>
            <Center>
              <mesh geometry={parsed.geometry} castShadow receiveShadow>
                <meshStandardMaterial
                  color={palette.meshColor}
                  metalness={0.3}
                  roughness={0.55}
                />
              </mesh>
            </Center>
          </Bounds>
          <axesHelper args={[AXES_SCALE]} />
          <OrbitControls
            enableZoom
            enablePan
            autoRotate
            autoRotateSpeed={0.4}
          />
        </Canvas>
      </div>

      <div className={`rounded-lg p-3 ${palette.hud}`}>
        <div className="mb-2">
          <div className={`text-[10px] uppercase tracking-wider ${palette.sub}`}>
            파일명
          </div>
          <div className="text-xs font-mono truncate" title={name}>
            {truncateName(name)}
          </div>
        </div>

        <HudRow label="삼각형 수" palette={palette}>
          <AnimatedNumber
            value={parsed.triangleCount}
            decimals={0}
            className="text-sm font-bold"
          />
        </HudRow>

        <HudRow label="체적" palette={palette}>
          <div className="flex flex-col items-end">
            <AnimatedNumber
              value={parsed.volumeMm3}
              decimals={1}
              suffix=" mm³"
              className="text-sm font-bold"
            />
            <AnimatedNumber
              value={volumeCm3}
              decimals={3}
              suffix=" cm³"
              className={`text-[10px] ${palette.sub}`}
              flash={false}
            />
          </div>
        </HudRow>

        <HudRow label="바운딩 박스 (mm)" palette={palette}>
          <div className="text-right text-xs font-mono">
            <div>X {formatNumber(parsed.bbox.sizeX, 2)}</div>
            <div>Y {formatNumber(parsed.bbox.sizeY, 2)}</div>
            <div>Z {formatNumber(parsed.bbox.sizeZ, 2)}</div>
          </div>
        </HudRow>

        <HudRow label="bbox 체적" palette={palette}>
          <span className="text-xs font-mono">
            {formatNumber(bboxVolumeCm3, 2)} cm³
          </span>
        </HudRow>

        <HudRow label="추정 가공시간" palette={palette}>
          <div className="flex flex-col items-end">
            <AnimatedNumber
              value={estMinutes}
              decimals={1}
              suffix=" min"
              className="text-sm font-bold"
            />
            <span className={`text-[9px] ${palette.sub}`}>
              @MRR {TYPICAL_MRR_CM3_PER_MIN} cm³/min
            </span>
          </div>
        </HudRow>

        <div className={`mt-3 text-[10px] leading-tight ${palette.sub}`}>
          ※ 체적은 signed-tet 합산 기준 추정값이며,
          가공시간은 bbox 체적 기반 거친 지표입니다.
        </div>
      </div>
    </div>
  )
}

function HudRow({
  label,
  palette,
  children,
}: {
  label: string
  palette: Palette
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex items-start justify-between gap-2 py-1.5 border-t first:border-t-0 border-dashed border-slate-500/20">
      <div className={`text-[10px] uppercase tracking-wider ${palette.sub}`}>
        {label}
      </div>
      <div>{children}</div>
    </div>
  )
}

export default CadPreview
export { CadPreview }
