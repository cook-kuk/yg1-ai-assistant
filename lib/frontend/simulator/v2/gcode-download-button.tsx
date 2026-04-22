// SPDX-License-Identifier: MIT
// YG-1 Simulator v3 · G-code 실제 파일 다운로드 (Fanuc / Heidenhain / Siemens)
"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, Download, FileCode, Info } from "lucide-react"
import { toast } from "sonner"

type Dialect = "fanuc" | "heidenhain" | "siemens"

interface DialectMeta {
  id: Dialect
  name: string
  ext: "nc" | "h" | "mpf"
  hint: string
  note: string
}

const DIALECTS: DialectMeta[] = [
  {
    id: "fanuc",
    name: "Fanuc",
    ext: "nc",
    hint: "일반 가공",
    note: "Fanuc 0i/31i · HAAS 호환. G21/G17/G40/G49/G80/G90 기준, WCS=G54.",
  },
  {
    id: "heidenhain",
    name: "Heidenhain",
    ext: "h",
    hint: "고정밀 밀링",
    note: "iTNC 530 / TNC 640 · Conversational(Klartext) 구문. L/TOOL CALL 기반.",
  },
  {
    id: "siemens",
    name: "Siemens",
    ext: "mpf",
    hint: "범용",
    note: "SINUMERIK 840D · ShopMill 범용. T_/D1/G0/G1 기반.",
  },
]

export interface GCodeDownloadButtonProps {
  state: {
    productCode: string
    diameter: number
    fluteCount: number
    Vc: number
    fz: number
    ap: number
    ae: number
    isoGroup: string
    operation: string
    coating: string
    stockL: number
    stockW: number
    stockH: number
  }
  results: { n: number; Vf: number }
  darkMode?: boolean
}

// ---------- Helpers ----------

function pad2(n: number): string {
  return n.toString().padStart(2, "0")
}

function isoTimestamp(d: Date): string {
  return (
    d.getFullYear() +
    "-" +
    pad2(d.getMonth() + 1) +
    "-" +
    pad2(d.getDate()) +
    " " +
    pad2(d.getHours()) +
    ":" +
    pad2(d.getMinutes()) +
    ":" +
    pad2(d.getSeconds())
  )
}

function fileStamp(d: Date): string {
  return (
    d.getFullYear() +
    pad2(d.getMonth() + 1) +
    pad2(d.getDate()) +
    "-" +
    pad2(d.getHours()) +
    pad2(d.getMinutes()) +
    pad2(d.getSeconds())
  )
}

function safeCode(s: string): string {
  return (s || "tool").replace(/[^A-Za-z0-9._-]+/g, "_")
}

// stock 크기 기반 단순 zigzag 경로를 dialect별로 렌더
interface GenCtx {
  n: number
  Vf: number
  D: number
  ap: number
  ae: number
  stockL: number
  stockW: number
  stockH: number
}

function zigzagPasses(ctx: GenCtx): Array<{ x1: number; x2: number; y: number }> {
  const { stockL, stockW, D, ae } = ctx
  // ae 간격으로 Y 스텝 (공구 중심선 기준 반경 보정 간단화)
  const step = Math.max(0.5, ae || D * 0.5)
  const xMin = 0
  const xMax = Math.max(step, stockL)
  const yMax = Math.max(step, stockW)
  const passes: Array<{ x1: number; x2: number; y: number }> = []
  let y = 0
  let forward = true
  let guard = 0
  while (y <= yMax + 1e-6 && guard < 200) {
    passes.push(
      forward
        ? { x1: xMin, x2: xMax, y }
        : { x1: xMax, x2: xMin, y },
    )
    y += step
    forward = !forward
    guard += 1
  }
  return passes
}

function headerLinesComment(prefix: string, lines: string[]): string[] {
  return lines.map((l) => `${prefix} ${l}`)
}

function commonHeader(state: GCodeDownloadButtonProps["state"], results: { n: number; Vf: number }, ts: string): string[] {
  return [
    `═════════════════════════════════════`,
    `YG-1 ARIA Simulator v3 자동 생성`,
    `생성: ${ts}`,
    `공구: ${state.productCode} ⌀${state.diameter}mm Z${state.fluteCount}`,
    `재질: ${state.isoGroup} · 코팅: ${state.coating} · 작업: ${state.operation}`,
    `조건: Vc=${state.Vc}m/min · fz=${state.fz}mm/t · ap=${state.ap}mm · ae=${state.ae}mm`,
    `계산: n=${Math.round(results.n)}rpm · Vf=${Math.round(results.Vf)}mm/min`,
    `공작물: ${state.stockL}×${state.stockW}×${state.stockH}mm (L×W×H)`,
    `═════════════════════════════════════`,
  ]
}

function genFanuc(state: GCodeDownloadButtonProps["state"], results: { n: number; Vf: number }, ts: string): string {
  const n = Math.round(results.n)
  const F = Math.round(results.Vf)
  const T = 1
  const ctx: GenCtx = {
    n,
    Vf: F,
    D: state.diameter,
    ap: state.ap,
    ae: state.ae,
    stockL: state.stockL,
    stockW: state.stockW,
    stockH: state.stockH,
  }
  const header = headerLinesComment("(", commonHeader(state, results, ts)).map((s) => `${s} )`)

  // Setup
  const setup = [
    `( --- SETUP --- )`,
    `O0001`,
    `G21 G17 G40 G49 G80 G90`,
    `T${pad2(T)} M06`,
    `G54 G00 X0. Y0. S${n} M03`,
    `G43 Z50. H${pad2(T)} M08`,
  ]

  // Main (zigzag)
  const passes = zigzagPasses(ctx)
  const main: string[] = [`( --- MAIN --- )`]
  main.push(`G00 X${passes[0].x1.toFixed(3)} Y${passes[0].y.toFixed(3)}`)
  main.push(`G01 Z-${state.ap.toFixed(3)} F${Math.max(50, Math.round(F * 0.3))}.`)
  for (const p of passes) {
    main.push(`G01 X${p.x2.toFixed(3)} Y${p.y.toFixed(3)} F${F}.`)
  }

  // Finish
  const finish = [
    `( --- FINISH --- )`,
    `G00 Z100. M09`,
    `M05`,
    `G91 G28 Z0.`,
    `G91 G28 X0. Y0.`,
    `G90`,
    `M30`,
    `%`,
  ]

  return [...header, "", ...setup, "", ...main, "", ...finish].join("\n")
}

function genHeidenhain(state: GCodeDownloadButtonProps["state"], results: { n: number; Vf: number }, ts: string): string {
  const n = Math.round(results.n)
  const F = Math.round(results.Vf)
  const T = 1
  const ctx: GenCtx = {
    n,
    Vf: F,
    D: state.diameter,
    ap: state.ap,
    ae: state.ae,
    stockL: state.stockL,
    stockW: state.stockW,
    stockH: state.stockH,
  }
  const header = headerLinesComment(";", commonHeader(state, results, ts))

  const setup = [
    `; --- SETUP ---`,
    `BEGIN PGM YG1 MM`,
    `BLK FORM 0.1 Z X+0 Y+0 Z-${state.stockH.toFixed(3)}`,
    `BLK FORM 0.2 X+${state.stockL.toFixed(3)} Y+${state.stockW.toFixed(3)} Z+0`,
    `TOOL CALL ${T} Z S${n}`,
    `L Z+50 R0 FMAX M3`,
    `L X+0 Y+0 FMAX M8`,
  ]

  const passes = zigzagPasses(ctx)
  const main: string[] = [`; --- MAIN ---`]
  main.push(`L X+${passes[0].x1.toFixed(3)} Y+${passes[0].y.toFixed(3)} FMAX`)
  main.push(`L Z-${state.ap.toFixed(3)} F${Math.max(50, Math.round(F * 0.3))}`)
  for (const p of passes) {
    const sx = p.x2 >= 0 ? `+${p.x2.toFixed(3)}` : p.x2.toFixed(3)
    const sy = p.y >= 0 ? `+${p.y.toFixed(3)}` : p.y.toFixed(3)
    main.push(`L X${sx} Y${sy} F${F}`)
  }

  const finish = [
    `; --- FINISH ---`,
    `L Z+50 FMAX M9`,
    `L Z+200 FMAX M5`,
    `M30`,
    `END PGM YG1 MM`,
  ]

  return [...header, "", ...setup, "", ...main, "", ...finish].join("\n")
}

function genSiemens(state: GCodeDownloadButtonProps["state"], results: { n: number; Vf: number }, ts: string): string {
  const n = Math.round(results.n)
  const F = Math.round(results.Vf)
  const T = 1
  const ctx: GenCtx = {
    n,
    Vf: F,
    D: state.diameter,
    ap: state.ap,
    ae: state.ae,
    stockL: state.stockL,
    stockW: state.stockW,
    stockH: state.stockH,
  }
  const header = headerLinesComment(";", commonHeader(state, results, ts))

  const setup = [
    `; --- SETUP ---`,
    `G17 G40 G54 G90 G71`,
    `T${T} D1`,
    `M6`,
    `S${n} M3`,
    `M8`,
    `G0 X0 Y0 Z50`,
  ]

  const passes = zigzagPasses(ctx)
  const main: string[] = [`; --- MAIN ---`]
  main.push(`G0 X${passes[0].x1.toFixed(3)} Y${passes[0].y.toFixed(3)}`)
  main.push(`G1 Z-${state.ap.toFixed(3)} F${Math.max(50, Math.round(F * 0.3))}`)
  for (const p of passes) {
    main.push(`G1 X${p.x2.toFixed(3)} Y${p.y.toFixed(3)} F${F}`)
  }

  const finish = [
    `; --- FINISH ---`,
    `G0 Z100 M9`,
    `M5`,
    `G0 X0 Y0`,
    `M30`,
  ]

  return [...header, "", ...setup, "", ...main, "", ...finish].join("\n")
}

function buildGCode(
  dialect: Dialect,
  state: GCodeDownloadButtonProps["state"],
  results: { n: number; Vf: number },
): { content: string; ext: string } {
  const ts = isoTimestamp(new Date())
  const meta = DIALECTS.find((d) => d.id === dialect)!
  let content = ""
  if (dialect === "fanuc") content = genFanuc(state, results, ts)
  else if (dialect === "heidenhain") content = genHeidenhain(state, results, ts)
  else content = genSiemens(state, results, ts)
  return { content, ext: meta.ext }
}

function triggerDownload(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // release URL on next tick
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---------- Component ----------

export default function GCodeDownloadButton({
  state,
  results,
  darkMode = false,
}: GCodeDownloadButtonProps) {
  const [open, setOpen] = useState(false)
  const [hintId, setHintId] = useState<Dialect | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setHintId(null)
      }
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  const disabled = useMemo(() => {
    return !state?.productCode || !Number.isFinite(results?.n) || results.n <= 0
  }, [state, results])

  const handleSelect = (d: DialectMeta) => {
    try {
      const { content, ext } = buildGCode(d.id, state, results)
      const stamp = fileStamp(new Date())
      const fname = `yg1-${safeCode(state.productCode)}-${d.id}-${stamp}.${ext}`
      triggerDownload(fname, content)
      toast.success(`${d.name} G-code 다운로드`)
      setOpen(false)
      setHintId(null)
    } catch (err) {
      console.error("[gcode-download] failed:", err)
      toast.error("G-code 생성 실패")
    }
  }

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          darkMode
            ? "border-emerald-700 bg-emerald-900/40 text-emerald-200 hover:bg-emerald-900/70"
            : "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
        }`}
      >
        <Download className="h-3.5 w-3.5" />
        <span>💾 G-code 다운로드</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute right-0 top-full mt-1 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-lg border shadow-xl p-1 ${
            darkMode
              ? "border-slate-700 bg-slate-900 text-slate-100"
              : "border-emerald-200 bg-white text-slate-800"
          }`}
        >
          <div
            className={`px-3 py-2 text-[10px] border-b ${
              darkMode ? "text-slate-400 border-slate-800" : "text-slate-500 border-gray-100"
            }`}
          >
            현재 시뮬 조건을 {DIALECTS.length}개 CNC 컨트롤러 G-code로 내보냅니다
          </div>

          {DIALECTS.map((d) => {
            const showHint = hintId === d.id
            return (
              <div key={d.id} className="relative">
                <div
                  className={`flex items-center gap-2 rounded px-2 py-2 ${
                    darkMode ? "hover:bg-slate-800" : "hover:bg-emerald-50"
                  }`}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleSelect(d)}
                    className="flex flex-1 items-center gap-2 text-left"
                  >
                    <FileCode
                      className={`h-4 w-4 flex-shrink-0 ${
                        darkMode ? "text-emerald-400" : "text-emerald-600"
                      }`}
                    />
                    <span className="flex-1">
                      <span className="text-xs font-semibold">{d.name}</span>
                      <span
                        className={`ml-1 font-mono text-[10px] ${
                          darkMode ? "text-slate-400" : "text-slate-500"
                        }`}
                      >
                        (.{d.ext})
                      </span>
                      <span
                        className={`ml-2 text-[10px] ${
                          darkMode ? "text-slate-400" : "text-slate-500"
                        }`}
                      >
                        · {d.hint}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`${d.name} 포맷 안내`}
                    onMouseEnter={() => setHintId(d.id)}
                    onMouseLeave={() => setHintId(null)}
                    onFocus={() => setHintId(d.id)}
                    onBlur={() => setHintId(null)}
                    className={`rounded p-1 ${
                      darkMode
                        ? "text-slate-400 hover:text-emerald-300 hover:bg-slate-800"
                        : "text-slate-400 hover:text-emerald-700 hover:bg-emerald-50"
                    }`}
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </div>
                {showHint && (
                  <div
                    role="tooltip"
                    className={`pointer-events-none absolute right-2 top-full z-10 mt-1 w-64 rounded border px-2 py-1.5 text-[10px] leading-snug shadow-lg ${
                      darkMode
                        ? "border-slate-700 bg-slate-950 text-slate-200"
                        : "border-emerald-200 bg-white text-slate-700"
                    }`}
                  >
                    {d.note}
                  </div>
                )}
              </div>
            )
          })}

          <div
            className={`px-3 py-1.5 text-[10px] border-t ${
              darkMode ? "text-slate-500 border-slate-800" : "text-slate-400 border-gray-100"
            }`}
          >
            ⚠ 생성된 G-code는 참고용입니다. 실제 가공 전 포스트프로세서 검증 필요
          </div>
        </div>
      )}
    </div>
  )
}
