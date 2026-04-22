"use client"

import { useState } from "react"
import { HelpCircle, Sparkles } from "lucide-react"
import * as Popover from "@radix-ui/react-popover"

export interface InfoToggleContent {
  title: string
  whatIsIt: string
  whyMatters: string
  howComputed?: string
  productionReqs?: {
    dataNeeded: string
    modelType: string
    infra: string
    accuracy: string
    timeline: string
  }
  relatedFeatures?: string[]
  level?: "beginner" | "intermediate" | "expert"
}

interface InfoToggleProps {
  id: string
  content: InfoToggleContent
  onAskAI?: (context: string) => void
  size?: "sm" | "md"
}

// Global CustomEvent 규약 — cutting-copilot.tsx 가 `copilot:ask` 를 listen 한다.
// InfoToggle 은 onAskAI prop 이 안 와도 이 이벤트로 챗봇을 깨울 수 있다.
function dispatchCopilotAsk(question: string) {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent("copilot:ask", { detail: { question } }),
  )
}

export function InfoToggle({ id, content, onAskAI, size = "sm" }: InfoToggleProps) {
  const [open, setOpen] = useState(false)
  const iconSize = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4"
  const triggerSize = size === "sm" ? "w-4 h-4" : "w-5 h-5"

  function handleAsk() {
    const q = `"${content.title}"에 대해 더 자세히 설명해주세요. 제가 초보자라서 예시와 함께 쉽게 설명해주시면 좋겠어요.`
    if (onAskAI) onAskAI(q)
    else dispatchCopilotAsk(q)
    setOpen(false)
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-tour="info-toggle-example"
          className={`inline-flex items-center justify-center ${triggerSize} rounded-full border border-slate-300 dark:border-slate-600 text-slate-400 hover:border-teal-500 hover:text-teal-500 transition-colors`}
          aria-label={`${content.title} 설명`}
        >
          <HelpCircle className={iconSize} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          className="z-50 w-[380px] max-w-[90vw] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-4 text-sm"
        >
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 dark:text-slate-100">{content.title}</span>
              {content.level && <LevelBadge level={content.level} />}
            </div>
            <span className="text-[10px] font-mono text-slate-400">#{id}</span>
          </div>

          <div className="space-y-3">
            <Section emoji="📘" title="이게 무엇인가">
              {content.whatIsIt}
            </Section>

            <Section emoji="🎯" title="왜 중요한가">
              {content.whyMatters}
            </Section>

            {content.howComputed && (
              <Section emoji="🔬" title="어떻게 계산되나">
                {content.howComputed}
              </Section>
            )}

            {content.productionReqs && <ProductionReqs reqs={content.productionReqs} />}

            {content.relatedFeatures && content.relatedFeatures.length > 0 && (
              <div className="text-xs text-slate-500 dark:text-slate-400">
                <strong>관련 기능:</strong> {content.relatedFeatures.join(", ")}
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={handleAsk}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded bg-gradient-to-r from-teal-500 to-emerald-500 text-white text-xs font-medium hover:opacity-90"
            >
              <Sparkles className="w-3.5 h-3.5" />
              AI에게 더 자세히 물어보기
            </button>
          </div>

          <Popover.Arrow className="fill-slate-200 dark:fill-slate-700" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function Section({
  emoji,
  title,
  children,
}: {
  emoji: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
        <span>{emoji}</span>
        <span>{title}</span>
      </div>
      <div className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed pl-5">{children}</div>
    </div>
  )
}

function ProductionReqs({ reqs }: { reqs: NonNullable<InfoToggleContent["productionReqs"]> }) {
  return (
    <div className="rounded border border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/20 p-2.5">
      <div className="flex items-center gap-1.5 mb-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
        <span>📊</span>
        <span>실제 프로덕션 요건</span>
      </div>
      <dl className="space-y-1 text-[11px] pl-5">
        <ReqRow label="필요 데이터" value={reqs.dataNeeded} />
        <ReqRow label="모델 타입" value={reqs.modelType} />
        <ReqRow label="인프라" value={reqs.infra} />
        <ReqRow label="예상 정확도" value={reqs.accuracy} />
        <ReqRow label="개발 기간" value={reqs.timeline} />
      </dl>
    </div>
  )
}

function ReqRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-amber-700 dark:text-amber-500 font-mono shrink-0 min-w-[72px]">{label}:</dt>
      <dd className="text-amber-900 dark:text-amber-200">{value}</dd>
    </div>
  )
}

function LevelBadge({ level }: { level: "beginner" | "intermediate" | "expert" }) {
  const cfg = {
    beginner: {
      label: "초급",
      cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    },
    intermediate: {
      label: "중급",
      cls: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
    },
    expert: {
      label: "고급",
      cls: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    },
  }[level]
  return (
    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${cfg.cls}`}>{cfg.label}</span>
  )
}
