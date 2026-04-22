// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Blueprint Gallery
// - 6종 대표 YG-1 엔드밀의 기술 도면을 갤러리로 표시
// - 카드 클릭 → 풀사이즈 상세 모달 (큰 도면 + 스펙 + 추천 가공조건)
// - "적용하고 시뮬 시작" 버튼 → onApplyTool(tool) 콜백으로 상위 시뮬레이터 세팅
// - cutting-simulator-v2.tsx 를 변경하지 않고 래핑 방식으로 통합
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { X, ArrowRight, Cog, Wrench, Gauge, Ruler, Sparkles, Play } from "lucide-react"
import { toast } from "sonner"

import { ToolBlueprint, type ToolBlueprintShape } from "./tool-blueprint"

// ─── Types ─────────────────────────────────────────────────────────────

export interface BlueprintGalleryTool {
  seriesCode: string
  edpCode: string
  shape: ToolBlueprintShape
  diameter: number
  shankDia: number
  LOC: number
  OAL: number
  flutes: number
  helixAngle: number
  cornerR?: number
  coating: string
  recommendedMaterial: string // ISO group: P/M/K/N/S/H
  recommendedOperation: string
  recommendedVc: number
  recommendedFz: number
  recommendedAp: number
  recommendedAe: number
}

export interface BlueprintGalleryProps {
  onApplyTool: (tool: BlueprintGalleryTool) => void
  darkMode?: boolean
}

// 내부 표시용 확장 데이터
interface GalleryToolDisplay extends BlueprintGalleryTool {
  title: string
  description: string
  bestFor: string
  pricePoint: string
  hoverTip: string
}

// ─── 6개 도면 데이터 (SSOT) ────────────────────────────────────────────
const GALLERY_TOOLS: GalleryToolDisplay[] = [
  {
    seriesCode: "GNX98",
    edpCode: "GNX98030",
    shape: "square",
    diameter: 3,
    shankDia: 6,
    LOC: 8,
    OAL: 50,
    flutes: 4,
    helixAngle: 38,
    coating: "altin",
    recommendedMaterial: "H",
    recommendedOperation: "finishing",
    recommendedVc: 80,
    recommendedFz: 0.025,
    recommendedAp: 2,
    recommendedAe: 0.8,
    title: "🔹 GNX98 · 고경도 4날 소형",
    description: "50~60 HRC 경화강용 · 금형 피니싱",
    bestFor: "정밀 금형, 하드밀링",
    pricePoint: "₩32,000",
    hoverTip: "GNX98 시리즈는 고경도 경화강 (50~60 HRC) 전용. 소형 D3mm · 정밀 피니싱. Vc 80m/min 저속 권장.",
  },
  {
    seriesCode: "SEM813",
    edpCode: "SEM813080",
    shape: "square",
    diameter: 8,
    shankDia: 8,
    LOC: 20,
    OAL: 63,
    flutes: 4,
    helixAngle: 38,
    coating: "altin",
    recommendedMaterial: "P",
    recommendedOperation: "side-milling",
    recommendedVc: 180,
    recommendedFz: 0.06,
    recommendedAp: 7,
    recommendedAe: 2,
    title: "⚙️ SEM813 · 탄소강 고효율",
    description: "S45C 측면 가공 · 고속",
    bestFor: "일반 기계 부품",
    pricePoint: "₩48,000",
    hoverTip: "SEM813은 일반 탄소강 (S45C 등) 측면 가공 범용. 4날 D8 · Vc 180 고속. ap 0.5D 표준.",
  },
  {
    seriesCode: "EHD84",
    edpCode: "EHD84100",
    shape: "square",
    diameter: 10,
    shankDia: 10,
    LOC: 25,
    OAL: 72,
    flutes: 4,
    helixAngle: 45,
    coating: "altin",
    recommendedMaterial: "M",
    recommendedOperation: "side-milling",
    recommendedVc: 120,
    recommendedFz: 0.05,
    recommendedAp: 10,
    recommendedAe: 2,
    title: "✨ EHD84 · SUS304 측면",
    description: "스테인리스 범용 · 고나선",
    bestFor: "SUS304/316",
    pricePoint: "₩68,000",
    hoverTip: "EHD84는 스테인리스 범용. 고나선 45°로 가공경화 최소. Vc 120 안전 범위. ae/D ≥ 30% 유지 필수.",
  },
  {
    seriesCode: "SEM846",
    edpCode: "SEM846060",
    shape: "ball",
    diameter: 6,
    shankDia: 6,
    LOC: 13,
    OAL: 70,
    flutes: 2,
    helixAngle: 30,
    cornerR: 3,
    coating: "aicrn",
    recommendedMaterial: "H",
    recommendedOperation: "finishing",
    recommendedVc: 60,
    recommendedFz: 0.02,
    recommendedAp: 0.3,
    recommendedAe: 0.15,
    title: "💎 SEM846 · 고경도 볼 2날",
    description: "55~65 HRC · 롱넥 볼",
    bestFor: "복잡 3D 금형",
    pricePoint: "₩55,000",
    hoverTip: "SEM846 4G MILLS · 55~65 HRC 극경도 하드밀링 전용. 2날 볼 R3 롱넥. AlCrN 코팅. Vc 60 극저속.",
  },
  {
    seriesCode: "GMH61",
    edpCode: "GMH61080",
    shape: "radius",
    diameter: 8,
    shankDia: 8,
    LOC: 19,
    OAL: 63,
    flutes: 4,
    helixAngle: 38,
    cornerR: 1,
    coating: "aicrn",
    recommendedMaterial: "S",
    recommendedOperation: "finishing",
    recommendedVc: 45,
    recommendedFz: 0.025,
    recommendedAp: 0.4,
    recommendedAe: 0.2,
    title: "🚀 GMH61 · 인코넬 R1 4날",
    description: "Inconel 718 마감 · AlCrN",
    bestFor: "항공 초내열합금",
    pricePoint: "₩92,000",
    hoverTip: "GMH61 초내열합금 전용. Inconel/Ti 마감. R1 코너라디우스 4날 · AlCrN 내열 코팅. Vc 45 필수 저속.",
  },
  {
    seriesCode: "EQ480",
    edpCode: "EQ480100",
    shape: "ball",
    diameter: 10,
    shankDia: 10,
    LOC: 22,
    OAL: 72,
    flutes: 2,
    helixAngle: 30,
    cornerR: 5,
    coating: "uncoated",
    recommendedMaterial: "N",
    recommendedOperation: "roughing",
    recommendedVc: 500,
    recommendedFz: 0.06,
    recommendedAp: 2,
    recommendedAe: 1,
    title: "🪙 EQ480 · 알루미늄 볼 2날",
    description: "Al6061/7075 고속 볼 · 무코팅",
    bestFor: "알루미늄 부품",
    pricePoint: "₩38,000",
    hoverTip: "EQ480 알루미늄 전용. 2날 볼 R5 · 무코팅 (Al에 AlTiN 안 됨). Vc 500+ 초고속. 칩 배출 우수.",
  },
]

// ISO Material group 한글 라벨
const ISO_GROUP_LABEL: Record<string, string> = {
  P: "강 (Steel)",
  M: "스테인리스 (Stainless)",
  K: "주철 (Cast Iron)",
  N: "비철 (Aluminum 등)",
  S: "초내열합금 (Super Alloy)",
  H: "경화강 (Hardened Steel)",
}

const OPERATION_LABEL: Record<string, string> = {
  "side-milling": "측면 가공",
  "finishing": "마감 가공",
  "roughing": "황삭 가공",
  "slotting": "슬롯 가공",
  "drilling": "드릴링",
  "ramping": "램핑",
}

// ─── 추천 이유 요약 빌더 ────────────────────────────────────────────
function buildRecommendationReason(t: GalleryToolDisplay): string {
  const mat = ISO_GROUP_LABEL[t.recommendedMaterial] ?? t.recommendedMaterial
  const op = OPERATION_LABEL[t.recommendedOperation] ?? t.recommendedOperation
  return `${mat} 영역에서 ${op} 용도로 설계된 공구입니다. 코팅(${t.coating.toUpperCase()})과 날수 Z=${t.flutes}, 헬릭스 ${t.helixAngle}° 조합이 이 구간에서 안정적인 칩 배출과 공구 수명을 제공합니다.`
}

// ─── Card 컴포넌트 ────────────────────────────────────────────────
interface GalleryCardProps {
  tool: GalleryToolDisplay
  onOpen: () => void
  onApply: () => void
  darkMode: boolean
}

function GalleryCard({ tool, onOpen, onApply, darkMode }: GalleryCardProps) {
  const cardBg = darkMode
    ? "bg-slate-900/60 border-slate-800/60 hover:border-cyan-400"
    : "bg-white border-slate-200/70 hover:border-cyan-500"
  const textColor = darkMode ? "text-slate-100" : "text-slate-900"
  const subText = darkMode ? "text-slate-400" : "text-slate-600"
  const badgeBg = darkMode
    ? "bg-cyan-500/10 text-cyan-300 border border-cyan-400/30"
    : "bg-cyan-50 text-cyan-700 border border-cyan-200"

  const handleApply = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onApply()
    },
    [onApply],
  )

  return (
    <button
      type="button"
      onClick={onOpen}
      className={[
        "group relative flex flex-col overflow-hidden rounded-2xl border text-left transition-all duration-200",
        "hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-200/40 dark:hover:shadow-slate-950/60 hover:ring-2 hover:ring-cyan-400/40",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500",
        cardBg,
      ].join(" ")}
      aria-label={`${tool.title} 도면 상세보기`}
    >
      {/* 미니 도면 */}
      <div
        className={[
          "flex items-center justify-center px-3 pt-3",
          darkMode ? "bg-slate-950/40" : "bg-slate-50",
        ].join(" ")}
        style={{ minHeight: 140 }}
      >
        <div style={{ transform: "scale(0.9)", transformOrigin: "center" }}>
          <ToolBlueprint
            shape={tool.shape}
            diameter={tool.diameter}
            shankDia={tool.shankDia}
            LOC={tool.LOC}
            OAL={tool.OAL}
            flutes={tool.flutes}
            helixAngle={tool.helixAngle}
            cornerR={tool.cornerR}
            coating={tool.coating}
            seriesCode={tool.seriesCode}
            edpCode={tool.edpCode}
            darkMode={darkMode}
            showDimensions={false}
            className="w-full"
          />
        </div>
      </div>

      {/* 본문 */}
      <div className="flex flex-1 flex-col gap-2 p-4 min-w-0">
        <div className={`truncate text-sm font-semibold ${textColor}`} title={tool.title}>{tool.title}</div>
        <div className={`text-xs leading-relaxed break-words ${subText}`}>{tool.description}</div>
        <div className={`text-[11px] ${subText} flex items-center gap-1 min-w-0`}>
          <Wrench className="h-3 w-3 flex-shrink-0" aria-hidden />
          <span className="truncate">{tool.bestFor}</span>
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 pt-2 min-w-0">
          <span
            className={[
              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
              badgeBg,
            ].join(" ")}
          >
            {tool.pricePoint}
          </span>
          <span
            role="button"
            tabIndex={-1}
            onClick={handleApply}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                e.stopPropagation()
                onApply()
              }
            }}
            className={[
              "inline-flex cursor-pointer items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition",
              darkMode
                ? "bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30"
                : "bg-cyan-600 text-white hover:bg-cyan-700",
            ].join(" ")}
            aria-label={`${tool.title} 로 시뮬레이션 시작`}
          >
            시뮬 시작 <ArrowRight className="h-3 w-3" aria-hidden />
          </span>
        </div>
      </div>
    </button>
  )
}

// ─── 상세 모달 ─────────────────────────────────────────────────────
interface DetailModalProps {
  tool: GalleryToolDisplay
  onClose: () => void
  onApply: () => void
  darkMode: boolean
}

function DetailModal({ tool, onClose, onApply, darkMode }: DetailModalProps) {
  const [autoReplay, setAutoReplay] = useState(false)

  // 🎬 마운트 1초 후 미니 시뮬 자동 재생 상태로 전환
  useEffect(() => {
    const id = window.setTimeout(() => setAutoReplay(true), 1000)
    return () => window.clearTimeout(id)
  }, [])

  // Esc 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose])

  const panelBg = darkMode ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"
  const textColor = darkMode ? "text-slate-100" : "text-slate-900"
  const subText = darkMode ? "text-slate-400" : "text-slate-600"
  const rowBg = darkMode ? "bg-slate-950/40" : "bg-slate-50"
  const reason = useMemo(() => buildRecommendationReason(tool), [tool])

  const specRows: Array<{ k: string; v: string }> = [
    { k: "시리즈", v: tool.seriesCode },
    { k: "EDP 코드", v: tool.edpCode },
    { k: "형상", v: tool.shape.toUpperCase() },
    { k: "직경 (D)", v: `⌀${tool.diameter} mm` },
    { k: "샹크 (Ds)", v: `⌀${tool.shankDia} mm` },
    { k: "절삭장 (LOC)", v: `${tool.LOC} mm` },
    { k: "전장 (OAL)", v: `${tool.OAL} mm` },
    { k: "날수 (Z)", v: `${tool.flutes}` },
    { k: "헬릭스", v: `${tool.helixAngle}°` },
    ...(tool.cornerR != null ? [{ k: "코너 R", v: `R${tool.cornerR}` }] : []),
    { k: "코팅", v: tool.coating.toUpperCase() },
  ]

  const condRows: Array<{ k: string; v: string; hint: string }> = [
    {
      k: "Vc",
      v: `${tool.recommendedVc} m/min`,
      hint: "절삭속도",
    },
    {
      k: "fz",
      v: `${tool.recommendedFz} mm/tooth`,
      hint: "날당이송",
    },
    {
      k: "ap",
      v: `${tool.recommendedAp} mm`,
      hint: "축방향 절입",
    },
    {
      k: "ae",
      v: `${tool.recommendedAe} mm`,
      hint: "반경방향 절입",
    },
  ]

  return (
    <div
      className="fixed inset-0 z-[75] bg-slate-950/70 backdrop-blur p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={`${tool.title} 상세 도면`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={[
          "relative mx-auto my-6 max-w-6xl rounded-2xl border shadow-2xl",
          panelBg,
        ].join(" ")}
      >
        {/* 닫기 버튼 */}
        <button
          type="button"
          onClick={onClose}
          className={[
            "absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full transition",
            darkMode
              ? "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200",
          ].join(" ")}
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>

        {/* 헤더 */}
        <div className="px-6 pt-6 pb-3">
          <div className={`text-lg font-bold ${textColor}`}>{tool.title}</div>
          <div className={`mt-1 text-sm ${subText}`}>{tool.description}</div>
        </div>

        {/* 본문 2-column */}
        <div className="grid grid-cols-1 gap-6 px-6 pb-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          {/* 좌: 큰 도면 */}
          <div
            className={[
              "flex items-center justify-center rounded-2xl p-3",
              rowBg,
              autoReplay ? "ring-1 ring-cyan-400/30" : "",
            ].join(" ")}
          >
            <ToolBlueprint
              shape={tool.shape}
              diameter={tool.diameter}
              shankDia={tool.shankDia}
              LOC={tool.LOC}
              OAL={tool.OAL}
              flutes={tool.flutes}
              helixAngle={tool.helixAngle}
              cornerR={tool.cornerR}
              coating={tool.coating}
              seriesCode={tool.seriesCode}
              edpCode={tool.edpCode}
              darkMode={darkMode}
              showDimensions
              className="w-full"
            />
          </div>

          {/* 우: 스펙 + 가공조건 */}
          <div className="flex flex-col gap-4">
            {/* 스펙 테이블 */}
            <div>
              <div
                className={`mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${subText}`}
              >
                <Ruler className="h-3.5 w-3.5" aria-hidden /> 제원
              </div>
              <div
                className={[
                  "grid grid-cols-2 gap-px overflow-hidden rounded-lg border text-xs",
                  darkMode ? "border-slate-700 bg-slate-700/50" : "border-slate-200 bg-slate-200",
                ].join(" ")}
              >
                {specRows.map((row) => (
                  <div
                    key={row.k}
                    className={[
                      "flex items-center justify-between gap-2 px-3 py-1.5",
                      darkMode ? "bg-slate-900" : "bg-white",
                    ].join(" ")}
                  >
                    <span className={subText}>{row.k}</span>
                    <span className={`font-medium ${textColor}`}>{row.v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 추천 가공조건 */}
            <div>
              <div
                className={`mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${subText}`}
              >
                <Gauge className="h-3.5 w-3.5" aria-hidden /> 추천 가공조건
              </div>
              <div className="grid grid-cols-2 gap-2">
                {condRows.map((row) => (
                  <div
                    key={row.k}
                    className={[
                      "rounded-xl border p-2.5 transition-all duration-200",
                      darkMode
                        ? "border-cyan-400/20 bg-cyan-500/5"
                        : "border-cyan-200 bg-cyan-50",
                    ].join(" ")}
                  >
                    <div
                      className={`text-[10px] uppercase tracking-wider ${
                        darkMode ? "text-cyan-300/70" : "text-cyan-700/80"
                      }`}
                    >
                      {row.k} · {row.hint}
                    </div>
                    <div className={`text-sm font-bold ${textColor}`}>{row.v}</div>
                  </div>
                ))}
              </div>
              <div className={`mt-2 flex items-center gap-1.5 text-[11px] ${subText}`}>
                <Cog className="h-3 w-3" aria-hidden />
                <span>
                  대상 소재: {ISO_GROUP_LABEL[tool.recommendedMaterial] ?? tool.recommendedMaterial}{" "}
                  · 작업: {OPERATION_LABEL[tool.recommendedOperation] ?? tool.recommendedOperation}
                </span>
              </div>
            </div>

            {/* 적용 버튼 */}
            <button
              type="button"
              onClick={onApply}
              className={[
                "mt-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all duration-200",
                "hover:shadow-lg active:scale-[0.99]",
                darkMode
                  ? "bg-cyan-500 text-slate-950 hover:bg-cyan-400"
                  : "bg-cyan-600 text-white hover:bg-cyan-700",
              ].join(" ")}
              aria-label="이 공구 적용하고 시뮬레이션 시작"
            >
              <Play className="h-4 w-4" aria-hidden /> 적용하고 시뮬 시작
            </button>
          </div>
        </div>

        {/* 하단: 추천 이유 + 미니 시뮬 */}
        <div
          className={[
            "mx-6 mb-6 rounded-2xl border p-4 text-xs leading-relaxed",
            darkMode
              ? "border-slate-700 bg-slate-950/40 text-slate-300"
              : "border-slate-200 bg-slate-50 text-slate-700",
          ].join(" ")}
        >
          <div className={`mb-1 flex items-center gap-1.5 font-semibold ${textColor}`}>
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> 추천 이유
          </div>
          <p>{reason}</p>
          {autoReplay && (
            <div
              className={`mt-2 flex items-center gap-1.5 text-[11px] ${
                darkMode ? "text-cyan-300" : "text-cyan-700"
              }`}
            >
              <span className="relative inline-flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-500" />
              </span>
              🎬 실시간 미니 시뮬 프리뷰 (권장 조건 기준)
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Root 컴포넌트 ────────────────────────────────────────────────
export function BlueprintGallery({ onApplyTool, darkMode = false }: BlueprintGalleryProps) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const selectedTool = selectedIdx != null ? GALLERY_TOOLS[selectedIdx] ?? null : null

  const handleApply = useCallback(
    (tool: GalleryToolDisplay) => {
      // BlueprintGalleryTool 로만 외부에 노출 (display 필드는 제외)
      const payload: BlueprintGalleryTool = {
        seriesCode: tool.seriesCode,
        edpCode: tool.edpCode,
        shape: tool.shape,
        diameter: tool.diameter,
        shankDia: tool.shankDia,
        LOC: tool.LOC,
        OAL: tool.OAL,
        flutes: tool.flutes,
        helixAngle: tool.helixAngle,
        cornerR: tool.cornerR,
        coating: tool.coating,
        recommendedMaterial: tool.recommendedMaterial,
        recommendedOperation: tool.recommendedOperation,
        recommendedVc: tool.recommendedVc,
        recommendedFz: tool.recommendedFz,
        recommendedAp: tool.recommendedAp,
        recommendedAe: tool.recommendedAe,
      }
      onApplyTool(payload)
      setSelectedIdx(null)
      toast.success(`✓ ${tool.title} 적용됨`, {
        description: `${tool.seriesCode} · ⌀${tool.diameter}mm · Vc ${tool.recommendedVc} · fz ${tool.recommendedFz}`,
      })
    },
    [onApplyTool],
  )

  const headerTextColor = darkMode ? "text-slate-100" : "text-slate-900"
  const headerSubColor = darkMode ? "text-slate-400" : "text-slate-600"

  return (
    <div className="w-full">
      {/* 상단 헤더 */}
      <div className="mb-4 flex flex-col gap-1">
        <h2 className={`flex items-center gap-2 text-lg font-bold ${headerTextColor}`}>
          <span role="img" aria-label="도면">
            📐
          </span>
          YG-1 엔드밀 도면 갤러리
        </h2>
        <p className={`text-xs ${headerSubColor}`}>
          YG-1 대표 공구 6종의 기술 도면과 시뮬레이션 예시 · 카드 클릭 시 상세 도면 + 추천 가공조건
        </p>
      </div>

      {/* 6개 카드 그리드 */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {GALLERY_TOOLS.map((tool, idx) => (
          <GalleryCard
            key={tool.edpCode}
            tool={tool}
            onOpen={() => setSelectedIdx(idx)}
            onApply={() => handleApply(tool)}
            darkMode={darkMode}
          />
        ))}
      </div>

      {/* 상세 모달 */}
      {selectedTool && (
        <DetailModal
          tool={selectedTool}
          darkMode={darkMode}
          onClose={() => setSelectedIdx(null)}
          onApply={() => handleApply(selectedTool)}
        />
      )}
    </div>
  )
}

export default BlueprintGallery
