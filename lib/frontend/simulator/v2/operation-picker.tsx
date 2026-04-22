// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Operation Picker (공정 선택기 + 피삭제 미니 시각화)
// - 8개 공정 카드(2x4 grid, 반응형 4x2)로 사용자가 공정 타입을 선택.
// - 각 카드는 이모지 아이콘 + 설명 + SVG 미니 일러스트(피삭제+공구+절삭 방향+chip) + 재질 태그 표시.
// - Harvey MAP "대충"보다 상세한 시각화 의도.
// - darkMode 완전 지원, 선택 카드는 ring-2 blue + scale + bg-blue-50 + 체크 아이콘.
"use client"

import { useMemo, type ReactElement } from "react"
import { Check } from "lucide-react"

// ── Types ─────────────────────────────────────────────────────────────
export type OperationType =
  | "endmill-general"
  | "roughing"
  | "finishing"
  | "slotting"
  | "drilling"
  | "turning"
  | "profiling"
  | "pocketing"

export interface OperationPickerProps {
  value: OperationType
  onChange: (op: OperationType) => void
  darkMode?: boolean
}

interface OperationDef {
  key: OperationType
  icon: string
  title: string
  desc: string
  materials: string
  recommend?: string
  illustration: (darkMode: boolean) => ReactElement
}

// ── Color tokens (darkMode-aware) ─────────────────────────────────────
const COLOR = {
  stockLight: "#cbd5e1", // slate-300
  stockDark: "#475569",  // slate-600
  stockStrokeLight: "#94a3b8", // slate-400
  stockStrokeDark: "#334155",  // slate-700
  tool: "#2563eb", // blue-600
  toolEdge: "#1e3a8a", // blue-900
  arrow: "#f59e0b", // amber-500
  chip: "#fde047", // yellow-300
  chipStroke: "#ca8a04", // yellow-600
  bgGridLight: "#f1f5f9", // slate-100
  bgGridDark: "#0f172a",  // slate-900
}

const stockFill = (dark: boolean) => (dark ? COLOR.stockDark : COLOR.stockLight)
const stockStroke = (dark: boolean) => (dark ? COLOR.stockStrokeDark : COLOR.stockStrokeLight)

// ── SVG Illustrations (viewBox 0 0 120 80) ────────────────────────────
function IlEndmillGeneral(dark: boolean) {
  return (
    <svg viewBox="0 0 120 80" className="w-full h-16">
      {/* stock */}
      <rect x="20" y="35" width="80" height="35" fill={stockFill(dark)} stroke={stockStroke(dark)} strokeWidth="1" rx="1" />
      {/* side-cut notch on left */}
      <rect x="20" y="35" width="12" height="18" fill={dark ? "#1e293b" : "#ffffff"} stroke={stockStroke(dark)} strokeWidth="0.5" />
      {/* tool (vertical) */}
      <rect x="24" y="8" width="8" height="32" fill={COLOR.tool} stroke={COLOR.toolEdge} strokeWidth="0.5" rx="1" />
      <rect x="24" y="34" width="8" height="6" fill={COLOR.toolEdge} />
      {/* spin arrow */}
      <path d="M 28 5 A 4 4 0 1 1 23 10" fill="none" stroke={COLOR.arrow} strokeWidth="1.4" />
      <polygon points="23,10 21,8 25,7" fill={COLOR.arrow} />
      {/* feed arrow (stock moves right / tool engages left) */}
      <path d="M 40 55 L 55 55" stroke={COLOR.arrow} strokeWidth="1.5" />
      <polygon points="55,55 51,52 51,58" fill={COLOR.arrow} />
      {/* chip */}
      <circle cx="18" cy="40" r="1.5" fill={COLOR.chip} stroke={COLOR.chipStroke} strokeWidth="0.4" />
      <circle cx="15" cy="44" r="1.2" fill={COLOR.chip} stroke={COLOR.chipStroke} strokeWidth="0.4" />
      <circle cx="14" cy="38" r="1" fill={COLOR.chip} />
    </svg>
  )
}

function IlRoughing(dark: boolean) {
  return (
    <svg viewBox="0 0 120 80" className="w-full h-16">
      {/* big stock */}
      <rect x="15" y="25" width="90" height="45" fill={stockFill(dark)} stroke={stockStroke(dark)} strokeWidth="1" rx="1" />
      {/* deep engagement pocket */}
      <path d="M 30 25 L 30 58 L 45 58 L 45 25 Z" fill={dark ? "#1e293b" : "#ffffff"} stroke={stockStroke(dark)} strokeWidth="0.5" />
      {/* tool plunged deep */}
      <rect x="33" y="5" width="10" height="52" fill={COLOR.tool} stroke={COLOR.toolEdge} strokeWidth="0.5" rx="1" />
      <path d="M 33 55 L 38 60 L 43 55 Z" fill={COLOR.toolEdge} />
      {/* big chips */}
      <path d="M 50 30 Q 58 26 62 32 Q 56 34 50 32 Z" fill={COLOR.chip} stroke={COLOR.chipStroke} strokeWidth="0.5" />
      <path d="M 55 40 Q 64 38 68 44 Q 60 46 55 42 Z" fill={COLOR.chip} stroke={COLOR.chipStroke} strokeWidth="0.5" />
      <circle cx="72" cy="35" r="1.6" fill={COLOR.chip} stroke={COLOR.chipStroke} strokeWidth="0.4" />
      {/* trochoidal arrow */}
      <path d="M 50 65 Q 60 60 70 65 Q 80 70 90 65" fill="none" stroke={COLOR.arrow} strokeWidth="1.4" />
      <polygon points="90,65 86,62 86,68" fill={COLOR.arrow} />
      {/* HEM label */}
      <text x="95" y="20" fontSize="8" fill={COLOR.arrow} fontWeight="bold">HEM</text>
    </svg>
  )
}

function IlFinishing(dark: boolean) {
  return (
    <svg viewBox="0 0 120 80" className="w-full h-16">
      {/* smooth stock */}
      <rect x="15" y="38" width="90" height="32" fill={stockFill(dark)} stroke={stockStroke(dark)} strokeWidth="1" rx="1" />
      {/* extra smooth line */}
      <line x1="15" y1="38" x2="105" y2="38" stroke={dark ? "#cbd5e1" : "#64748b"} strokeWidth="0.4" strokeDasharray="2 2" />
      {/* slim tool */}
      <rect x="55" y="8" width="6" height="33" fill={COLOR.tool} stroke={COLOR.toolEdge} strokeWidth="0.5" rx="1" />
      {/* thin shaving */}
      <path d="M 50 38 Q 55 34 62 36 Q 66 37 70 35" fill="none" stroke={COLOR.chip} strokeWidth="1.5" />
      <path d="M 48 38 Q 52 35 58 37" fill="none" stroke={COLOR.chipStroke} strokeWidth="0.5" />
      {/* feed arrow */}
      <path d="M 65 50 L 95 50" stroke={COLOR.arrow} strokeWidth="1.3" />
      <polygon points="95,50 91,47 91,53" fill={COLOR.arrow} />
      {/* sparkle for quality */}
      <text x="78" y="22" fontSize="10" fill={COLOR.arrow}>✦</text>
    </svg>
  )
}

function IlSlotting(dark: boolean) {
  return (
    <svg viewBox="0 0 120 80" className="w-full h-16">
      {/* stock with slot */}
      <rect x="15" y="30" width="90" height="40" fill={stockFill(dark)} stroke={stockStroke(dark)} strokeWidth="1" rx="1" />
      {/* central slot */}
      <rect x="52" y="30" width="16" height="26" fill={dark ? "#1e293b" : "#ffffff"} stroke={stockStroke(dark)} strokeWidth="0.5" />
      {/* tool centered in slot */}
      <rect x="54" y="6" width="12" height="48" fill={COLOR.tool} stroke={COLOR.toolEdge} strokeWidth="0.5" rx="1" />
      <path d="M 54 52 L 60 58 L 66 52 Z" fill={COLOR.toolEdge} />
      {/* descent arrow */}
      <path d="M 45 15 L 45 45" stroke={COLOR.arrow} strokeWidth="1.4" />
      <polygon points="45,45 42,41 48,41" fill={COLOR.arrow} />
      {/* chips both sides */}
      <circle cx="46" cy="28" r="1.3" fill={COLOR.chip} stroke={COLOR.chipStroke} strokeWidth="0.4" />
      <circle cx="74" cy="28" r="1.3" fill={COLOR.chip} stroke={COLOR.chipStroke} strokeWidth="0.4" />
      <circle cx="78" cy="32" r="1" fill={COLOR.chip} />
      {/* ae=D label */}
      <text x="82" y="20" fontSize="7" fill={COLOR.arrow} fontWeight="bold">ae=D</text>
    </svg>
  )
}

function IlDrilling(dark: boolean) {
  return (
    <svg viewBox="0 0 120 80" className="w-full h-16">
      {/* stock */}
      <rect x="20" y="30" width="80" height="40" fill={stockFill(dark)} stroke={stockStroke(dark)} strokeWidth="1" rx="1" />
      {/* hole */}
      <rect x="54" y="30" width="12" height="28" fill={dark ? "#1e293b" : "#ffffff"} stroke={stockStroke(dark)} strokeWidth="0.5" />
      {/* drill with pointy tip */}
      <rect x="55" y="4" width="10" height="40" fill={COLOR.tool} stroke={COLOR.toolEdge} strokeWidth="0.5" rx="1" />
      <path d="M 55 42 L 60 52 L 65 42 Z" fill={COLOR.toolEdge} />
      {/* flutes */}
      <line x1="57" y1="10" x2="63" y2="42" stroke={COLOR.toolEdge} strokeWidth="0.4" />
      <line x1="63" y1="10" x2="57" y2="42" stroke={COLOR.toolEdge} strokeWidth="0.4" />
      {/* descent arrow */}
      <path d="M 40 12 L 40 50" stroke={COLOR.arrow} strokeWidth="1.5" />
      <polygon points="40,50 37,46 43,46" fill={COLOR.arrow} />
      {/* chips swirling out */}
      <path d="M 70 20 Q 78 16 82 22" fill="none" stroke={COLOR.chip} strokeWidth="1.2" />
      <path d="M 72 28 Q 80 24 84 30" fill="none" stroke={COLOR.chipStroke} strokeWidth="0.5" />
      <text x="85" y="15" fontSize="7" fill={COLOR.arrow} fontWeight="bold">peck</text>
    </svg>
  )
}

function IlTurning(dark: boolean) {
  return (
    <svg viewBox="0 0 120 80" className="w-full h-16">
      {/* rotating cylinder (ellipse + rect body) */}
      <rect x="15" y="30" width="70" height="28" fill={stockFill(dark)} stroke={stockStroke(dark)} strokeWidth="1" />
      <ellipse cx="15" cy="44" rx="3" ry="14" fill={stockFill(dark)} stroke={stockStroke(dark)} strokeWidth="1" />
      <ellipse cx="85" cy="44" rx="3" ry="14" fill={dark ? "#64748b" : "#94a3b8"} stroke={stockStroke(dark)} strokeWidth="0.8" />
      {/* rotation arrow */}
      <path d="M 50 38 A 6 5 0 1 1 42 42" fill="none" stroke={COLOR.arrow} strokeWidth="1.3" />
      <polygon points="42,42 40,39 44,39" fill={COLOR.arrow} />
      {/* tool bit below */}
      <polygon points="55,58 75,58 78,70 58,70" fill={COLOR.tool} stroke={COLOR.toolEdge} strokeWidth="0.5" />
      <polygon points="55,58 58,62 62,58" fill={COLOR.toolEdge} />
      {/* feed arrow along axis */}
      <path d="M 90 65 L 100 65" stroke={COLOR.arrow} strokeWidth="1.3" />
      <polygon points="100,65 96,62 96,68" fill={COLOR.arrow} />
      {/* chip curl */}
      <path d="M 58 55 Q 66 48 62 42" fill="none" stroke={COLOR.chip} strokeWidth="1.4" />
      <text x="92" y="20" fontSize="7" fill={COLOR.arrow} fontWeight="bold">mm/rev</text>
    </svg>
  )
}

function IlProfiling(dark: boolean) {
  return (
    <svg viewBox="0 0 120 80" className="w-full h-16">
      {/* curved outer profile */}
      <path
        d="M 15 60 Q 20 30 40 28 Q 60 26 75 38 Q 95 50 100 65 L 100 72 L 15 72 Z"
        fill={stockFill(dark)}
        stroke={stockStroke(dark)}
        strokeWidth="1"
      />
      {/* tool path (dashed above profile, offset) */}
      <path
        d="M 12 62 Q 18 25 40 22 Q 62 20 78 34 Q 100 48 105 66"
        fill="none"
        stroke={COLOR.arrow}
        strokeWidth="1.2"
        strokeDasharray="3 2"
      />
      {/* tool at one point on path */}
      <circle cx="50" cy="21" r="5" fill={COLOR.tool} stroke={COLOR.toolEdge} strokeWidth="0.6" />
      <circle cx="50" cy="21" r="2" fill={COLOR.toolEdge} />
      {/* direction arrow on path */}
      <polygon points="78,34 72,32 76,38" fill={COLOR.arrow} />
      {/* tiny chip */}
      <circle cx="58" cy="27" r="1" fill={COLOR.chip} stroke={COLOR.chipStroke} strokeWidth="0.3" />
    </svg>
  )
}

function IlPocketing(dark: boolean) {
  return (
    <svg viewBox="0 0 120 80" className="w-full h-16">
      {/* stock block */}
      <rect x="12" y="20" width="96" height="52" fill={stockFill(dark)} stroke={stockStroke(dark)} strokeWidth="1" rx="1" />
      {/* rectangular pocket carved out */}
      <rect x="28" y="32" width="64" height="32" fill={dark ? "#1e293b" : "#ffffff"} stroke={stockStroke(dark)} strokeWidth="0.6" rx="1" />
      {/* spiral entry path */}
      <path
        d="M 60 48 m 0 -10 a 10 10 0 1 1 -0.1 0 m 3 -4 a 14 14 0 1 0 3 2"
        fill="none"
        stroke={COLOR.arrow}
        strokeWidth="1"
        strokeDasharray="2 1.5"
      />
      {/* tool inside pocket */}
      <circle cx="60" cy="48" r="5" fill={COLOR.tool} stroke={COLOR.toolEdge} strokeWidth="0.6" />
      <circle cx="60" cy="48" r="2" fill={COLOR.toolEdge} />
      {/* chips in corners */}
      <circle cx="32" cy="36" r="1" fill={COLOR.chip} />
      <circle cx="88" cy="36" r="1" fill={COLOR.chip} />
      <circle cx="32" cy="60" r="1" fill={COLOR.chip} />
      <circle cx="88" cy="60" r="1" fill={COLOR.chip} />
      <text x="75" y="28" fontSize="7" fill={COLOR.arrow} fontWeight="bold">spiral</text>
    </svg>
  )
}

// ── Definitions ───────────────────────────────────────────────────────
const OPERATIONS: OperationDef[] = [
  {
    key: "endmill-general",
    icon: "🔨",
    title: "일반 엔드밀",
    desc: "측면 가공 · 가장 흔한 밀링",
    materials: "P/M/K/N/H",
    recommend: "ap 0.5D · ae 0.3D",
    illustration: IlEndmillGeneral,
  },
  {
    key: "roughing",
    icon: "⚡",
    title: "러핑 (HEM)",
    desc: "고효율 밀링 · 많이 깎기",
    materials: "P/M/K",
    recommend: "ap 1.5D · ae 0.1D (트로코이달)",
    illustration: IlRoughing,
  },
  {
    key: "finishing",
    icon: "💎",
    title: "마감",
    desc: "표면 품질 우선 · 얕게",
    materials: "전체",
    recommend: "ap 0.2mm · ae 0.1D",
    illustration: IlFinishing,
  },
  {
    key: "slotting",
    icon: "📏",
    title: "슬로팅",
    desc: "홈 파기 · ae = D",
    materials: "P/K",
    recommend: "ap 0.5D · ae 1.0D",
    illustration: IlSlotting,
  },
  {
    key: "drilling",
    icon: "🔽",
    title: "드릴",
    desc: "구멍 가공 · 수직 descent",
    materials: "전체",
    recommend: "peck cycle",
    illustration: IlDrilling,
  },
  {
    key: "turning",
    icon: "🔁",
    title: "터닝 / 선반",
    desc: "회전 공작물 + 고정 공구",
    materials: "전체",
    recommend: "feed mm/rev",
    illustration: IlTurning,
  },
  {
    key: "profiling",
    icon: "✏",
    title: "프로파일링",
    desc: "외곽 윤곽선 따라가기",
    materials: "P/M/K/N",
    illustration: IlProfiling,
  },
  {
    key: "pocketing",
    icon: "🕳",
    title: "포켓",
    desc: "내부 공간 파내기",
    materials: "전체",
    recommend: "스파이럴 엔트리",
    illustration: IlPocketing,
  },
]

// ── Component ─────────────────────────────────────────────────────────
export function OperationPicker({ value, onChange, darkMode = false }: OperationPickerProps) {
  const ops = useMemo(() => OPERATIONS, [])

  return (
    <div
      className={`rounded-2xl border p-4 ${
        darkMode ? "border-slate-700 bg-slate-900/60" : "border-slate-200 bg-white"
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className={`text-sm font-bold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>
            공정 선택
          </h3>
          <p className={`text-[11px] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
            어떤 가공을 할 건가요? 피삭제 + 공구 조합을 확인하세요
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"
          }`}
        >
          {ops.length}가지
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-2 md:grid-cols-4">
        {ops.map((op) => {
          const active = value === op.key
          const baseBg = darkMode ? "bg-slate-800/60" : "bg-white"
          const activeBg = darkMode
            ? "bg-blue-900/30 ring-2 ring-blue-500 scale-[1.02]"
            : "bg-blue-50 ring-2 ring-blue-500 scale-[1.02]"
          const hoverBg = darkMode
            ? "hover:bg-slate-800 hover:ring-1 hover:ring-slate-600 hover:scale-[1.01]"
            : "hover:bg-slate-50 hover:ring-1 hover:ring-slate-300 hover:scale-[1.01]"
          const border = darkMode ? "border-slate-700" : "border-slate-200"
          const titleClass = darkMode ? "text-slate-100" : "text-slate-900"
          const descClass = darkMode ? "text-slate-400" : "text-slate-500"
          const tagActive = darkMode
            ? "bg-blue-900/60 text-blue-200 ring-1 ring-blue-700"
            : "bg-blue-100 text-blue-700 ring-1 ring-blue-300"
          const tagIdle = darkMode
            ? "bg-slate-800 text-slate-300 ring-1 ring-slate-700"
            : "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
          const recommendClass = darkMode ? "text-amber-300" : "text-amber-700"

          return (
            <button
              key={op.key}
              type="button"
              onClick={() => onChange(op.key)}
              aria-pressed={active}
              aria-label={`${op.title} — ${op.desc}`}
              className={`relative flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-all duration-150 ${border} ${
                active ? activeBg : `${baseBg} ${hoverBg}`
              }`}
            >
              {active && (
                <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-white shadow">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              )}
              <div className="flex items-center gap-2">
                <span className="text-2xl leading-none" aria-hidden>
                  {op.icon}
                </span>
                <span className={`text-sm font-bold ${titleClass}`}>{op.title}</span>
              </div>
              <p className={`text-[11px] leading-snug ${descClass}`}>{op.desc}</p>

              <div
                className={`w-full overflow-hidden rounded-md border ${
                  darkMode ? "border-slate-700 bg-slate-900/70" : "border-slate-200 bg-slate-50"
                }`}
              >
                {op.illustration(darkMode)}
              </div>

              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                    active ? tagActive : tagIdle
                  }`}
                  title="권장 재질 (ISO 분류)"
                >
                  {op.materials}
                </span>
                {op.recommend && (
                  <span className={`text-[9px] font-medium ${recommendClass}`}>
                    {op.recommend}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default OperationPicker
