"use client"

/**
 * AI Research Lab — main container.
 *
 * Composes: sticky demo banner, locked-context banner, sidebar nav,
 * 8 demo sections, and floating CuttingCopilot. The lab consumes a
 * small fixed context (tool + material + factory id) so every section
 * has consistent inputs for their mock ML engines.
 *
 * DEMO SCOPE: 모든 섹션의 수치는 data/mock-data-engine.ts 로 생성되는
 * seedable 가짜 값. CuttingCopilot 과 causal-xai 의 LLM 호출만 실제.
 */

import { useState } from "react"
import { StickyDemoBanner } from "./sticky-demo-banner"
import { LockedContextBanner } from "./locked-context-banner"
import { SectionNav, AI_LAB_SECTIONS } from "./section-nav"
import { MlPredictionGauge } from "./sections/ml-prediction-gauge"
import { UncertaintyAnalysis } from "./sections/uncertainty-analysis"
import { SensorAnomalyPanel } from "./sections/sensor-anomaly-panel"
import { PersonalizationPanel } from "./sections/personalization-panel"
import { CausalXaiPanel } from "./sections/causal-xai-panel"
import { DoeDesigner as DoEDesigner } from "./sections/doe-designer"
import { SurvivalCurvePanel } from "./sections/survival-curve-panel"
import { AiRoadmap } from "./sections/ai-roadmap"
import { CuttingCopilot } from "../copilot/cutting-copilot"
import { FEATURE_EXPLANATIONS } from "./data/feature-explanations"
import { InfoToggle } from "../shared/info-toggle"

interface AiResearchLabProps {
  /** Fixed demo context — keeps every section's mock inputs consistent. */
  toolCode?: string
  toolLabel?: string
  materialKey?: string
  materialLabel?: string
  factoryId?: string
  /** Sandvik 공식 baseline that ML sections will "correct". */
  sandvikToolLife?: number
  /** Baseline cutting conditions for the personalization comparison. */
  baselineConditions?: { sfm: number; ipt: number; adoc: number; rdoc: number }
}

const DEFAULTS = {
  toolCode: "942332",
  toolLabel: 'Harvey 942332 (1/2" 3F VariHelix Al)',
  materialKey: "al-6061",
  materialLabel: "AL 6061-T6",
  factoryId: "FACTORY-A",
  sandvikToolLife: 60,
  baselineConditions: { sfm: 1500, ipt: 0.00866, adoc: 0.05, rdoc: 0.25 },
} as const

export function AiResearchLab(props: AiResearchLabProps = {}) {
  const ctx = { ...DEFAULTS, ...props }
  const [activeSection, setActiveSection] = useState<string | null>(null)

  function triggerCopilot(question: string) {
    // Global event — CuttingCopilot listens on mount and auto-opens.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("copilot:ask", { detail: { question } }))
    }
  }

  return (
    <div className="space-y-6 relative">
      <StickyDemoBanner />

      {/* Overview banner with a master InfoToggle */}
      <div data-tour="lab-header" className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            🧪 AI Research Laboratory
            <InfoToggle
              id="ai-research-lab-overview"
              content={FEATURE_EXPLANATIONS["ai-research-lab-overview"]}
              onAskAI={triggerCopilot}
              size="md"
            />
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            ARIA 5년 로드맵의 AI 기능을 미리 체험하는 데모 탭 · 모든 수치는 시뮬레이션입니다
          </p>
        </div>
      </div>

      <LockedContextBanner
        toolCode={ctx.toolCode}
        toolLabel={ctx.toolLabel}
        materialKey={ctx.materialKey}
        materialLabel={ctx.materialLabel}
        factoryId={ctx.factoryId}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
        <aside className="hidden lg:block">
          <SectionNav activeId={activeSection} onNavigate={setActiveSection} />
        </aside>

        <div className="min-w-0 space-y-6">
          <MlPredictionGauge
            sandvikPrediction={ctx.sandvikToolLife}
            toolCode={ctx.toolCode}
            materialKey={ctx.materialKey}
            factoryId={ctx.factoryId}
            onAskAI={triggerCopilot}
          />

          <UncertaintyAnalysis
            toolLifeMean={ctx.sandvikToolLife}
            onAskAI={triggerCopilot}
          />

          <SensorAnomalyPanel onAskAI={triggerCopilot} />

          <PersonalizationPanel
            factoryId={ctx.factoryId}
            toolCode={ctx.toolCode}
            materialKey={ctx.materialKey}
            baselineConditions={ctx.baselineConditions}
            onAskAI={triggerCopilot}
          />

          <CausalXaiPanel
            prediction={ctx.sandvikToolLife * 0.95}
            sandvikPrediction={ctx.sandvikToolLife}
            toolCode={ctx.toolCode}
            materialKey={ctx.materialKey}
            onAskAI={triggerCopilot}
          />

          <DoEDesigner onAskAI={triggerCopilot} />

          <SurvivalCurvePanel
            expectedLife={ctx.sandvikToolLife}
            onAskAI={triggerCopilot}
          />

          <AiRoadmap onAskAI={triggerCopilot} />
        </div>
      </div>

      <CuttingCopilot currentSection={activeSection ?? undefined} currentState={ctx} />

      {/* Sentinel for tour-step targeting (last footer note). */}
      <div className="text-center text-[11px] text-slate-400 dark:text-slate-600 font-mono py-4">
        AI Research Laboratory · Demo Shell v0.1 · {AI_LAB_SECTIONS.length} sections · 모든 수치는 예시입니다
      </div>
    </div>
  )
}
