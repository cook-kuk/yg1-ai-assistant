"use client"

import { useSearchParams } from "next/navigation"
import { AlertCircle } from "lucide-react"

import { ExplorationScreen } from "@/lib/frontend/recommendation/exploration-flow"
import { FeedbackWidget } from "@/lib/frontend/recommendation/feedback-widget"
import {
  IntakeGate,
  IntakeSummaryScreen,
  LoadingScreen,
} from "@/lib/frontend/recommendation/intake-flow"
import { localizeIntakeText } from "@/lib/frontend/recommendation/intake-localization"
import { useProductRecommendationPage } from "@/lib/frontend/recommendation/use-product-recommendation-page"
import { getSessionCapabilities } from "@/lib/frontend/recommendation/recommendation-view-model"
import { useApp } from "@/lib/frontend/app-context"

export default function ProductRecommendPage() {
  const searchParams = useSearchParams()
  const { language, country } = useApp()
  const resetKey = searchParams.get("reset")

  const {
    phase,
    setPhase,
    form,
    chatMessages,
    isChatSending,
    error,
    setError,
    sessionState,
    candidateSnapshot,
    capabilities,
    handleFieldChange,
    runRecommendation,
    handleChatSend,
    handleReset,
    handleFeedback,
    handleChipFeedback,
    handleSuccessCapture,
  } = useProductRecommendationPage({
    language,
    country,
    resetKey,
  })

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <FeedbackWidget
        form={form}
        messages={chatMessages}
        sessionState={sessionState}
        candidateSnapshot={candidateSnapshot}
      />

      {phase !== "explore" && (
        <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b bg-white max-w-2xl mx-auto w-full">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-900">
                {localizeIntakeText("YG-1 제품 탐색", language)}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  phase === "intake"
                    ? "bg-blue-100 text-blue-700"
                    : phase === "summary"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-gray-100 text-gray-600"
                }`}
              >
                {phase === "intake"
                  ? localizeIntakeText("조건 입력", language)
                  : phase === "summary"
                    ? localizeIntakeText("조건 확인", language)
                    : localizeIntakeText("검색 중", language)}
              </span>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-red-50 border-b border-red-200">
          <AlertCircle size={13} className="text-red-500" />
          <span className="text-xs text-red-700">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-xs text-red-500">
            닫기
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {phase === "intake" && (
          <div className="max-w-2xl mx-auto w-full flex-1 flex flex-col min-h-0">
            <IntakeGate form={form} onChange={handleFieldChange} onNext={() => setPhase("summary")} />
          </div>
        )}

        {phase === "summary" && (
          <div className="max-w-2xl mx-auto w-full flex-1 flex flex-col min-h-0">
            <IntakeSummaryScreen
              form={form}
              onEdit={() => setPhase("intake")}
              onStart={runRecommendation}
            />
          </div>
        )}

        {phase === "loading" && <LoadingScreen />}

        {phase === "explore" && (
          <ExplorationScreen
            form={form}
            messages={chatMessages}
            isSending={isChatSending}
            sessionState={sessionState}
            candidateSnapshot={candidateSnapshot}
            capabilities={getSessionCapabilities(sessionState, capabilities)}
            onSend={handleChatSend}
            onReset={handleReset}
            onEdit={() => setPhase("intake")}
            onFeedback={handleFeedback}
            onChipFeedback={handleChipFeedback}
            onSuccessCapture={handleSuccessCapture}
          />
        )}
      </div>
    </div>
  )
}
