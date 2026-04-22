"use client"

import { CheckCircle2, Clock, Sparkles, Rocket } from "lucide-react"
import { SectionShell } from "../section-shell"

interface AiRoadmapProps {
  onAskAI?: (q: string) => void
}

type PhaseStatus = "in-progress" | "planned" | "vision"

interface RoadmapPhase {
  id: string
  period: string
  title: string
  status: PhaseStatus
  features: string[]
}

const ROADMAP: RoadmapPhase[] = [
  {
    id: "phase-0",
    period: "2026 Q1 (현재)",
    title: "Phase 0 — Foundation",
    status: "in-progress",
    features: ["AI Research Lab UI", "LLM 챗봇", "투어 모드", "Machine Impact Lab"],
  },
  {
    id: "phase-1",
    period: "2026 Q2-Q3",
    title: "Phase 1 — ML 예측 엔진",
    status: "planned",
    features: [
      "SpeedLab 데이터 수집",
      "XGBoost 공구 수명 예측",
      "DOE 통합",
      "SHAP xAI",
    ],
  },
  {
    id: "phase-2",
    period: "2027",
    title: "Phase 2 — 불확실성 & 개인화",
    status: "planned",
    features: [
      "베이지안 불확실성",
      "Contextual Bandit 개인화",
      "생존분석",
      "인과추론 DAG",
    ],
  },
  {
    id: "phase-3",
    period: "2028",
    title: "Phase 3 — 실시간 & 엣지",
    status: "planned",
    features: [
      "실시간 센서 이상탐지",
      "Jetson edge inference",
      "Fanuc FOCAS 연동",
      "RUL 예측",
    ],
  },
  {
    id: "phase-4",
    period: "2029-2030",
    title: "Phase 4 — 플랫폼화",
    status: "vision",
    features: [
      "다국어",
      "CAM 통합 (NX, PowerMill)",
      "자체 파인튜닝 모델",
      "Palantir 레벨 플랫폼",
    ],
  },
]

const STATUS_STYLES: Record<
  PhaseStatus,
  {
    badge: string
    badgeLabel: string
    dot: string
    dotRing: string
    line: string
    cardBorder: string
  }
> = {
  "in-progress": {
    badge: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700/50",
    badgeLabel: "진행중",
    dot: "bg-amber-500",
    dotRing: "ring-amber-200 dark:ring-amber-900/50",
    line: "bg-amber-300 dark:bg-amber-700/50",
    cardBorder: "border-amber-200 dark:border-amber-800/50",
  },
  planned: {
    badge: "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600",
    badgeLabel: "예정",
    dot: "bg-slate-400 dark:bg-slate-500",
    dotRing: "ring-slate-200 dark:ring-slate-700",
    line: "bg-slate-200 dark:bg-slate-700",
    cardBorder: "border-slate-200 dark:border-slate-700",
  },
  vision: {
    badge: "bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-700/50",
    badgeLabel: "비전",
    dot: "bg-violet-500",
    dotRing: "ring-violet-200 dark:ring-violet-900/50",
    line: "bg-violet-300 dark:bg-violet-700/50",
    cardBorder: "border-violet-200 dark:border-violet-800/50",
  },
}

function StatusIcon({ status }: { status: PhaseStatus }) {
  if (status === "in-progress") return <Clock className="w-3 h-3" />
  if (status === "vision") return <Sparkles className="w-3 h-3" />
  return <CheckCircle2 className="w-3 h-3" />
}

export function AiRoadmap(props: AiRoadmapProps) {
  return (
    <SectionShell
      id="ai-roadmap"
      title="🗺 ARIA 5년 AI 로드맵"
      subtitle="현재 → 2030. 단계별 기능 확장 계획"
      phase="2026 → 2030"
      onAskAI={props.onAskAI}
      noInfoToggle
      noDemoBadge
    >
      <div className="relative">
        {ROADMAP.map((phase, i) => {
          const s = STATUS_STYLES[phase.status]
          const isLast = i === ROADMAP.length - 1
          return (
            <div key={phase.id} className="relative flex gap-4 pb-6 last:pb-0">
              {/* Timeline rail */}
              <div className="relative w-8 shrink-0 flex justify-center">
                <div
                  className={`relative z-10 w-4 h-4 rounded-full ${s.dot} ring-4 ${s.dotRing} mt-1`}
                  aria-hidden
                />
                {!isLast && (
                  <div
                    className={`absolute top-5 bottom-0 left-1/2 -translate-x-1/2 w-0.5 ${s.line}`}
                    aria-hidden
                  />
                )}
              </div>

              {/* Card */}
              <div
                className={`flex-1 rounded-lg border ${s.cardBorder} bg-white dark:bg-slate-900/50 p-4`}
              >
                <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                  <div>
                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mb-0.5">
                      {phase.period}
                    </div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      {phase.title}
                    </h4>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-mono font-bold tracking-wider px-2 py-0.5 rounded border ${s.badge}`}
                  >
                    <StatusIcon status={phase.status} />
                    {s.badgeLabel}
                  </span>
                </div>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-2">
                  {phase.features.map(f => (
                    <li
                      key={f}
                      className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400"
                    >
                      <span
                        className={`mt-1.5 shrink-0 w-1 h-1 rounded-full ${s.dot}`}
                        aria-hidden
                      />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-6 rounded-lg border border-teal-300 dark:border-teal-700/50 bg-gradient-to-br from-teal-50 to-emerald-50 dark:from-teal-950/30 dark:to-emerald-950/30 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Rocket className="w-5 h-5 text-teal-600 dark:text-teal-400" />
          <h4 className="text-sm font-bold text-teal-900 dark:text-teal-200 tracking-wide">
            최종 비전
          </h4>
        </div>
        <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
          절삭공구계의 <span className="font-bold">MIDAS IT</span> — 한국발 글로벌 AI 네이티브
          가공 플랫폼
        </p>
        <p className="mt-2 text-[11px] text-teal-800/80 dark:text-teal-300/80">
          MIDAS IT가 구조해석 시장을 장악했듯, ARIA는 절삭가공 AI의 글로벌 표준을 목표합니다.
        </p>
      </div>
    </SectionShell>
  )
}
