// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Command Palette (cmdk 기반)
// 신규 컴포넌트. cutting-simulator-v2.tsx 수정 없음.
"use client"

import { Command } from "cmdk"
import { useEffect } from "react"
import {
  Search,
  Sparkles,
  BookOpen,
  Wrench,
  Box,
  Zap,
  Target,
  Activity,
  Film,
  GitCompare,
  TrendingUp,
  Keyboard,
  GraduationCap,
  Library,
} from "lucide-react"

// ── 타입 ──────────────────────────────────────────────────────────────
export type JumpSection =
  | "results"
  | "ai-coach"
  | "heatmap"
  | "animation"
  | "multi-tool"
  | "break-even"

export type ExampleId = "al6061-rough" | "sus304-finish" | "inconel-slot"

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  darkMode?: boolean
  onApplyExample?: (exampleId: ExampleId) => void
  onJumpToSection?: (section: JumpSection) => void
  onOpenHelp?: () => void
}

// ── 예시 프리셋 메타 (서브텍스트용) ────────────────────────────────────
// 프리셋 값 자체는 parent의 onApplyExample 콜백이 exampleId를 보고 반영.
// 참고(계약):
//   al6061-rough   : isoGroup=N, subgroup=aluminum-wrought, operation=roughing,
//                    coating=uncoated, Vc=450, fz=0.08, ap=10, ae=3
//   sus304-finish  : isoGroup=M, subgroup=austenitic-ss,  operation=finishing,
//                    coating=altin,    Vc=110, fz=0.04, ap=0.3, ae=2
//   inconel-slot   : isoGroup=S, subgroup=inconel,        operation=slotting,
//                    coating=aicrn,    Vc=35,  fz=0.025, ap=0.5, ae=6
interface ExampleMeta {
  id: ExampleId
  label: string
  sub: string
  keywords: string
}

const EXAMPLES: ExampleMeta[] = [
  {
    id: "al6061-rough",
    label: "알루미늄 황삭 (Al6061)",
    sub: "Vc 450 · fz 0.08 · ap 10 · ae 3",
    keywords:
      "알루미늄 황삭 aluminum rough roughing 6061 al6061 n uncoated wrought 비철",
  },
  {
    id: "sus304-finish",
    label: "SUS304 정삭",
    sub: "Vc 110 · fz 0.04 · ap 0.3 · ae 2",
    keywords:
      "sus304 정삭 finishing 스테인리스 stainless austenitic altin m 304",
  },
  {
    id: "inconel-slot",
    label: "인코넬 슬롯",
    sub: "Vc 35 · fz 0.025 · ap 0.5 · ae 6",
    keywords:
      "인코넬 inconel 슬롯 slot slotting 내열 heat resistant s aicrn 718",
  },
]

// ── 섹션 이동 메타 ────────────────────────────────────────────────────
interface SectionMeta {
  id: JumpSection
  label: string
  sub: string
  keywords: string
  Icon: React.ComponentType<{ className?: string }>
}

const SECTIONS: SectionMeta[] = [
  {
    id: "results",
    label: "결과로 가기",
    sub: "Results · Speeds & Feeds",
    keywords: "결과 results speeds feeds 절삭조건 요약",
    Icon: Target,
  },
  {
    id: "ai-coach",
    label: "AI 코치",
    sub: "AI Coach Panel",
    keywords: "ai 코치 coach 진단 조언 추천",
    Icon: Sparkles,
  },
  {
    id: "heatmap",
    label: "히트맵",
    sub: "Cutting Heatmap",
    keywords: "히트맵 heatmap 열지도 분포",
    Icon: Activity,
  },
  {
    id: "animation",
    label: "머시닝 애니메이션",
    sub: "Machining Animation",
    keywords: "애니메이션 animation 머시닝 machining 시뮬레이션",
    Icon: Film,
  },
  {
    id: "multi-tool",
    label: "멀티툴 비교",
    sub: "Multi-Tool Compare",
    keywords: "멀티툴 multi tool 비교 compare 경쟁",
    Icon: GitCompare,
  },
  {
    id: "break-even",
    label: "Break-Even",
    sub: "Break-Even Chart",
    keywords: "break even 손익분기 brake 차트",
    Icon: TrendingUp,
  },
]

// ── 컴포넌트 ──────────────────────────────────────────────────────────
function CommandPalette({
  open,
  onOpenChange,
  darkMode = false,
  onApplyExample,
  onJumpToSection,
  onOpenHelp,
}: CommandPaletteProps) {
  // Esc 로 닫기 (window 레벨, open 일 때만)
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onOpenChange(false)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onOpenChange])

  if (!open) return null

  // 공통 close + 콜백 헬퍼
  const runAndClose = (fn?: () => void) => {
    fn?.()
    onOpenChange(false)
  }

  // 다크모드 테마 클래스
  const cardBg = darkMode
    ? "bg-slate-900 border-slate-700 text-slate-100"
    : "bg-white border-slate-200 text-slate-900"
  const inputBg = darkMode
    ? "bg-slate-900/60 text-slate-100 placeholder:text-slate-400"
    : "bg-white/80 text-slate-900 placeholder:text-slate-500"
  const groupHeadCls = darkMode
    ? "text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-3 pt-3 pb-1"
    : "text-[11px] font-semibold uppercase tracking-wider text-slate-500 px-3 pt-3 pb-1"
  const itemBase = darkMode
    ? "group flex items-center gap-3 rounded-xl px-3 py-2.5 mx-2 cursor-pointer text-sm text-slate-200 data-[selected=true]:bg-slate-800 data-[selected=true]:text-white aria-selected:bg-slate-800 aria-selected:text-white transition-colors"
    : "group flex items-center gap-3 rounded-xl px-3 py-2.5 mx-2 cursor-pointer text-sm text-slate-700 data-[selected=true]:bg-slate-100 data-[selected=true]:text-slate-900 aria-selected:bg-slate-100 aria-selected:text-slate-900 transition-colors"
  const subText = darkMode ? "text-xs text-slate-400" : "text-xs text-slate-600"
  const dividerCls = darkMode ? "border-slate-800" : "border-slate-200"
  const footerCls = darkMode
    ? "px-3 py-2 text-[11px] text-slate-400 border-t border-slate-800 flex items-center justify-between"
    : "px-3 py-2 text-[11px] text-slate-500 border-t border-slate-200 flex items-center justify-between"

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-950/60 backdrop-blur-md flex items-start justify-center pt-[12vh] animate-in fade-in duration-150"
      onClick={() => onOpenChange(false)}
      role="presentation"
    >
      <div
        className={`w-full max-w-[600px] mx-4 rounded-2xl border shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 ${cardBg}`}
        onClick={(e) => e.stopPropagation()}
      >
        <Command
          label="Command Palette"
          loop
          className="flex flex-col max-h-[70vh]"
        >
          {/* 그라디언트 헤더 + 입력 */}
          <div className="relative bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 p-[1px]">
            <div
              className={`flex items-center gap-2 px-3 py-3 ${
                darkMode ? "bg-slate-900" : "bg-white"
              }`}
            >
              <Search
                className={`h-4 w-4 ${
                  darkMode ? "text-slate-400" : "text-slate-500"
                }`}
              />
              <Command.Input
                autoFocus
                placeholder="공구·재질·섹션 검색..."
                className={`flex-1 bg-transparent outline-none border-0 text-sm ${inputBg}`}
              />
              <kbd
                className={`hidden sm:inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-mono ${
                  darkMode
                    ? "border-slate-700 text-slate-400"
                    : "border-slate-300 text-slate-500"
                }`}
              >
                Esc
              </kbd>
            </div>
          </div>

          {/* 리스트 */}
          <Command.List className="flex-1 overflow-y-auto py-1">
            <Command.Empty
              className={`px-4 py-8 text-center text-sm ${
                darkMode ? "text-slate-400" : "text-slate-500"
              }`}
            >
              검색 결과 없음
            </Command.Empty>

            {/* ── 그룹 1: 빠른 시작 ─────────────────────────────── */}
            <Command.Group
              heading={
                <span className="flex items-center gap-1.5">
                  <Zap className="h-3 w-3 text-amber-500" />
                  빠른 시작
                </span>
              }
              className={groupHeadCls}
            >
              {EXAMPLES.map((ex) => (
                <Command.Item
                  key={ex.id}
                  value={`example-${ex.id}`}
                  keywords={[ex.keywords, ex.label, ex.sub]}
                  onSelect={() =>
                    runAndClose(() => onApplyExample?.(ex.id))
                  }
                  className={itemBase}
                >
                  <Box
                    className={`h-4 w-4 shrink-0 ${
                      darkMode ? "text-indigo-400" : "text-indigo-600"
                    }`}
                  />
                  <span className="flex-1 truncate">{ex.label}</span>
                  <span className={`${subText} shrink-0 font-mono`}>
                    {ex.sub}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>

            <div className={`my-1 border-t ${dividerCls}`} />

            {/* ── 그룹 2: 섹션 이동 ─────────────────────────────── */}
            <Command.Group
              heading={
                <span className="flex items-center gap-1.5">
                  <Wrench className="h-3 w-3 text-sky-500" />
                  섹션 이동
                </span>
              }
              className={groupHeadCls}
            >
              {SECTIONS.map(({ id, label, sub, keywords, Icon }) => (
                <Command.Item
                  key={id}
                  value={`section-${id}`}
                  keywords={[keywords, label, sub]}
                  onSelect={() =>
                    runAndClose(() => onJumpToSection?.(id))
                  }
                  className={itemBase}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      darkMode ? "text-sky-400" : "text-sky-600"
                    }`}
                  />
                  <span className="flex-1 truncate">{label}</span>
                  <span className={`${subText} shrink-0`}>{sub}</span>
                </Command.Item>
              ))}
            </Command.Group>

            <div className={`my-1 border-t ${dividerCls}`} />

            {/* ── 그룹 3: 교육/도움말 ───────────────────────────── */}
            <Command.Group
              heading={
                <span className="flex items-center gap-1.5">
                  <BookOpen className="h-3 w-3 text-emerald-500" />
                  교육 · 도움말
                </span>
              }
              className={groupHeadCls}
            >
              <Command.Item
                value="help-shortcuts"
                keywords={[
                  "단축키 shortcuts keyboard 키보드 도움말 help",
                ]}
                onSelect={() => runAndClose(() => onOpenHelp?.())}
                className={itemBase}
              >
                <Keyboard
                  className={`h-4 w-4 shrink-0 ${
                    darkMode ? "text-emerald-400" : "text-emerald-600"
                  }`}
                />
                <span className="flex-1 truncate">단축키</span>
                <span className={`${subText} shrink-0`}>Keyboard Shortcuts</span>
              </Command.Item>

              <Command.Item
                value="help-edu-tour"
                keywords={[
                  "교육모드 투어 edu tour 가이드 학습 learning",
                ]}
                onSelect={() => runAndClose(() => onOpenHelp?.())}
                className={itemBase}
              >
                <GraduationCap
                  className={`h-4 w-4 shrink-0 ${
                    darkMode ? "text-emerald-400" : "text-emerald-600"
                  }`}
                />
                <span className="flex-1 truncate">교육모드 투어 시작</span>
                <span className={`${subText} shrink-0`}>Guided Tour</span>
              </Command.Item>

              <Command.Item
                value="help-glossary"
                keywords={[
                  "개념사전 glossary 용어 dictionary 사전 concept",
                ]}
                onSelect={() => runAndClose(() => onOpenHelp?.())}
                className={itemBase}
              >
                <Library
                  className={`h-4 w-4 shrink-0 ${
                    darkMode ? "text-emerald-400" : "text-emerald-600"
                  }`}
                />
                <span className="flex-1 truncate">개념사전</span>
                <span className={`${subText} shrink-0`}>Glossary</span>
              </Command.Item>
            </Command.Group>
          </Command.List>

          {/* 푸터 팁 */}
          <div className={footerCls}>
            <span>↑↓ 이동 · Enter 선택 · Esc 닫기</span>
            <span className="flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              Command Palette
            </span>
          </div>
        </Command>
      </div>
    </div>
  )
}

export default CommandPalette
