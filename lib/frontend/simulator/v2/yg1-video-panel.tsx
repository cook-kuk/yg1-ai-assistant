"use client"

import { useMemo } from "react"

export interface Yg1VideoPanelProps {
  isoGroup: string
  operation: string
  darkMode?: boolean
}

interface Yg1ReferenceClip {
  title: string
  material: string
  operation: string
  summary: string
  focus: string[]
}

const REFERENCE_MAP: Record<string, readonly Yg1ReferenceClip[]> = {
  P: [
    {
      title: "탄소강 측면 가공 레퍼런스",
      material: "S45C / 4140 계열",
      operation: "side-milling",
      summary: "중간 절입에서 칩 배출과 벽면 품질을 우선하는 조건",
      focus: ["helix 38°", "4 flute", "stable wall finish"],
    },
    {
      title: "합금강 슬롯 가공 레퍼런스",
      material: "SCM / prehardened",
      operation: "slotting",
      summary: "ap를 유지하면서 ae 100% 접근 시 진동 관리가 핵심인 케이스",
      focus: ["slot load", "rpm cap", "deflection watch"],
    },
  ],
  M: [
    {
      title: "스테인리스 정삭 레퍼런스",
      material: "SUS304 / 316",
      operation: "finishing",
      summary: "용착 억제와 날끝 온도 관리 중심의 마감 조건",
      focus: ["BUE control", "coolant", "surface finish"],
    },
  ],
  K: [
    {
      title: "주철 고이송 레퍼런스",
      material: "GC / FCD",
      operation: "roughing",
      summary: "건식 또는 약식 쿨런트 환경에서 칩 분쇄가 빠른 조건",
      focus: ["dry cut", "segmented chip", "tool life"],
    },
  ],
  N: [
    {
      title: "알루미늄 고속 가공 레퍼런스",
      material: "Al6061 / 7075",
      operation: "profiling",
      summary: "고속 회전과 넓은 ae에서 빠른 배출을 보는 조건",
      focus: ["high speed", "bright chip", "wide ae"],
    },
    {
      title: "구리 저버 가공 레퍼런스",
      material: "C1100",
      operation: "finishing",
      summary: "날당 이송을 낮게 유지하며 용착 흔적을 억제하는 조건",
      focus: ["low burr", "2 flute", "light engagement"],
    },
  ],
  S: [
    {
      title: "티타늄 안정 절삭 레퍼런스",
      material: "Ti-6Al-4V",
      operation: "side-milling",
      summary: "높은 stickout에서도 편향과 발열을 함께 관리하는 조건",
      focus: ["stickout", "heat", "radial control"],
    },
    {
      title: "인코넬 보수 조건 레퍼런스",
      material: "Inconel 718",
      operation: "slotting",
      summary: "과부하를 막기 위해 Vc와 ae를 제한하는 사례",
      focus: ["low Vc", "spark watch", "tool life"],
    },
  ],
  H: [
    {
      title: "고경도강 하드밀 레퍼런스",
      material: "45-65 HRC",
      operation: "finishing",
      summary: "짧은 stickout과 얕은 ae에서 정밀도를 우선하는 조건",
      focus: ["short stickout", "small ae", "precision"],
    },
  ],
}

function normalizeIso(iso: string): string {
  return (iso || "").trim().toUpperCase().charAt(0)
}

export default function Yg1VideoPanel({
  isoGroup,
  operation,
  darkMode = false,
}: Yg1VideoPanelProps) {
  const normIso = useMemo(() => normalizeIso(isoGroup), [isoGroup])
  const clips = useMemo(() => REFERENCE_MAP[normIso] ?? [], [normIso])

  const cardCls = darkMode
    ? "rounded-xl border border-slate-700 bg-gradient-to-br from-slate-900 to-slate-950 p-4"
    : "rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4"
  const softText = darkMode ? "text-slate-400" : "text-slate-500"
  const titleText = darkMode ? "text-slate-100" : "text-slate-900"
  const subCard = darkMode
    ? "rounded-xl border border-slate-700 bg-slate-900/70"
    : "rounded-xl border border-slate-200 bg-white/90"
  const chip = darkMode
    ? "rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-200"
    : "rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-700"

  return (
    <section className={cardCls} aria-label="YG-1 실 가공 영상" data-testid="yg1-video-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xl leading-none" aria-hidden>🎥</span>
        <h3 className={`text-base font-semibold ${titleText}`}>YG-1 실 가공 영상</h3>
        <span className={chip}>ISO {normIso || "?"}</span>
        <span className={chip}>{operation || "milling"}</span>
        <span className={`ml-auto text-[11px] ${softText}`}>공식 영상 연동 준비중</span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className={`${subCard} overflow-hidden`}>
          <div className="relative aspect-video bg-[radial-gradient(circle_at_top,#1d4ed8_0%,#0f172a_58%,#020617_100%)]">
            <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent_0%,rgba(255,255,255,0.12)_45%,transparent_70%)]" />
            <div className="absolute inset-0 flex flex-col justify-between p-5 text-white">
              <div className="flex items-center justify-between">
                <span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] font-semibold tracking-[0.18em]">
                  YG-1 OFFICIAL
                </span>
                <span className="rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-100">
                  준비중
                </span>
              </div>
              <div>
                <div className="text-lg font-semibold">실제 영상 대신 조건 기반 레퍼런스를 먼저 표시합니다.</div>
                <div className="mt-2 max-w-xl text-sm text-slate-200/85">
                  가짜 링크나 외부 밈 영상은 제거했습니다. 공식 가공 영상 자산이 준비되면 여기서 바로 연결되도록 유지합니다.
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-[11px] text-slate-100/90">
                <span className="rounded-full border border-white/15 bg-white/10 px-2 py-1">실제 링크 미연동</span>
                <span className="rounded-full border border-white/15 bg-white/10 px-2 py-1">현재 조건과 같은 재질군 우선</span>
                <span className="rounded-full border border-white/15 bg-white/10 px-2 py-1">가공 포인트만 선반영</span>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${softText}`}>조건 기반 레퍼런스</div>
          {clips.length > 0 ? clips.map((clip) => (
            <div key={`${normIso}-${clip.title}`} className={`${subCard} p-3`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className={`text-sm font-semibold ${titleText}`}>{clip.title}</div>
                  <div className={`mt-1 text-[11px] ${softText}`}>{clip.material} · {clip.operation}</div>
                </div>
                <span className={chip}>ISO {normIso}</span>
              </div>
              <div className={`mt-2 text-[12px] leading-5 ${darkMode ? "text-slate-300" : "text-slate-700"}`}>{clip.summary}</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {clip.focus.map((item) => (
                  <span key={item} className={chip}>{item}</span>
                ))}
              </div>
            </div>
          )) : (
            <div className={`${subCard} p-4 text-sm ${softText}`}>
              이 재질 그룹에 대한 공식 영상 자산이 아직 연결되지 않았습니다.
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
