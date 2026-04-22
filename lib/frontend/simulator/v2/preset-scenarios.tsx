"use client"

// ─────────────────────────────────────────────────────────────────────────────
// PresetScenarios — 시뮬레이터 v2 상단에 배치되는 시나리오 프리셋 카드 그리드.
//   각 카드는 클릭 시 onApply(scenario) 를 호출해 stock 치수 / material / 공구
//   시퀀스 / 자동 스윕 패턴을 상위 시뮬레이터에 일괄 주입한다.
//   자동 재생은 하지 않으며, 사용자가 ▶ 버튼을 직접 눌러야 시퀀스가 시작된다.
// ─────────────────────────────────────────────────────────────────────────────

import { memo } from "react"

export type Scenario = {
  id: string
  label: string
  icon: string       // emoji
  description: string
  stockDimensions: [number, number, number]  // L,W,H in mm
  material: "steel" | "aluminum" | "copper" | "titanium"
  toolSequence: Array<{
    id: string
    label: string
    diameter: number
    flutes: number
    ap: number
    fz: number
    pattern: "zigzag" | "spiral"
    durationSec: number
  }>
  autoSweepPattern: "zigzag" | "spiral"
}

export const SCENARIOS: Scenario[] = [
  {
    id: "phone-case",
    label: "스마트폰 케이스 (알루미늄)",
    icon: "📱",
    description: "얇은 알루미늄 플레이트의 포켓 + 모서리 라운드",
    stockDimensions: [150, 75, 8],
    material: "aluminum",
    toolSequence: [
      { id: "rough", label: "Roughing", diameter: 8, flutes: 3, ap: 2, fz: 0.10, pattern: "zigzag", durationSec: 12 },
      { id: "finish", label: "Finish", diameter: 4, flutes: 4, ap: 0.5, fz: 0.03, pattern: "spiral", durationSec: 18 },
    ],
    autoSweepPattern: "zigzag",
  },
  {
    id: "implant",
    label: "치과 임플란트 (티타늄)",
    icon: "🦷",
    description: "고정밀 티타늄 볼엔드 가공",
    stockDimensions: [20, 20, 15],
    material: "titanium",
    toolSequence: [
      { id: "rough", label: "Roughing", diameter: 3, flutes: 4, ap: 0.5, fz: 0.02, pattern: "spiral", durationSec: 10 },
      { id: "finish", label: "Finish", diameter: 1, flutes: 4, ap: 0.2, fz: 0.01, pattern: "spiral", durationSec: 15 },
    ],
    autoSweepPattern: "spiral",
  },
  {
    id: "aero-bracket",
    label: "항공 브라켓 (티타늄)",
    icon: "✈️",
    description: "고강도 티타늄 구조 부재, 깊은 포켓",
    stockDimensions: [120, 80, 25],
    material: "titanium",
    toolSequence: [
      { id: "rough", label: "Roughing", diameter: 12, flutes: 4, ap: 2.5, fz: 0.08, pattern: "zigzag", durationSec: 15 },
      { id: "semi", label: "Semi", diameter: 8, flutes: 4, ap: 1.0, fz: 0.05, pattern: "zigzag", durationSec: 12 },
      { id: "finish", label: "Finish", diameter: 6, flutes: 6, ap: 0.4, fz: 0.03, pattern: "spiral", durationSec: 18 },
    ],
    autoSweepPattern: "zigzag",
  },
  {
    id: "copper-heatsink",
    label: "구리 방열판",
    icon: "🔥",
    description: "구리 핀 구조, DLC 코팅 공구 권장",
    stockDimensions: [80, 60, 10],
    material: "copper",
    toolSequence: [
      { id: "rough", label: "Roughing", diameter: 6, flutes: 2, ap: 1.5, fz: 0.06, pattern: "zigzag", durationSec: 12 },
      { id: "finish", label: "Finish", diameter: 3, flutes: 2, ap: 0.3, fz: 0.02, pattern: "zigzag", durationSec: 16 },
    ],
    autoSweepPattern: "zigzag",
  },
  {
    id: "steel-block",
    label: "금형강 블록 (기본)",
    icon: "🟦",
    description: "범용 P 소재 밀링 데모",
    stockDimensions: [100, 70, 30],
    material: "steel",
    toolSequence: [
      { id: "rough", label: "Roughing", diameter: 10, flutes: 4, ap: 2, fz: 0.08, pattern: "zigzag", durationSec: 15 },
      { id: "finish", label: "Finish", diameter: 5, flutes: 4, ap: 0.5, fz: 0.04, pattern: "spiral", durationSec: 18 },
    ],
    autoSweepPattern: "zigzag",
  },
]

// material → 카드 accent 색상 매핑 (tailwind literal 로 안전하게 유지).
const MATERIAL_ACCENT: Record<Scenario["material"], { border: string; bg: string; text: string; hover: string }> = {
  aluminum: { border: "border-sky-200", bg: "from-sky-50 via-white to-white", text: "text-sky-700", hover: "hover:border-sky-400 hover:shadow-sky-200/60" },
  titanium: { border: "border-violet-200", bg: "from-violet-50 via-white to-white", text: "text-violet-700", hover: "hover:border-violet-400 hover:shadow-violet-200/60" },
  copper: { border: "border-amber-200", bg: "from-amber-50 via-white to-white", text: "text-amber-700", hover: "hover:border-amber-400 hover:shadow-amber-200/60" },
  steel: { border: "border-slate-200", bg: "from-slate-50 via-white to-white", text: "text-slate-700", hover: "hover:border-slate-400 hover:shadow-slate-200/60" },
}

export type PresetScenariosProps = {
  onApply: (scenario: Scenario) => void
  className?: string
}

export const PresetScenarios = memo(function PresetScenarios({ onApply, className }: PresetScenariosProps) {
  return (
    <div
      data-testid="preset-scenarios-grid"
      className={[
        "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2",
        className ?? "",
      ].join(" ").trim()}
    >
      {SCENARIOS.map(scenario => {
        const accent = MATERIAL_ACCENT[scenario.material]
        const [L, W, H] = scenario.stockDimensions
        return (
          <button
            key={scenario.id}
            type="button"
            onClick={() => onApply(scenario)}
            className={[
              "group flex flex-col items-start gap-1 rounded-lg border bg-gradient-to-br p-3 text-left shadow-sm transition-all",
              "min-h-[92px] focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-300",
              accent.border,
              accent.bg,
              accent.hover,
              "hover:shadow-md active:scale-[0.98]",
            ].join(" ")}
            aria-label={`${scenario.icon} ${scenario.label} — ${scenario.description}`}
          >
            <div className="flex w-full items-center gap-2">
              <span className="text-2xl leading-none" aria-hidden="true">{scenario.icon}</span>
              <span className={`flex-1 text-[12px] font-semibold ${accent.text}`}>
                {scenario.label}
              </span>
            </div>
            <p className="text-[10px] leading-snug text-slate-600 line-clamp-2">
              {scenario.description}
            </p>
            <div className="mt-auto flex w-full items-center justify-between gap-2 pt-1">
              <span className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[9px] text-slate-600">
                {L}×{W}×{H}mm
              </span>
              <span className={`rounded bg-white/70 px-1.5 py-0.5 font-mono text-[9px] ${accent.text}`}>
                {scenario.toolSequence.length}-tool · {scenario.autoSweepPattern}
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
})

export default PresetScenarios
