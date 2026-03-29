"use client"

import { useSearchParams } from "next/navigation"
import { AlertCircle, Search } from "lucide-react"

import { useApp } from "@/lib/frontend/app-context"
import { ExplorationScreen } from "@/lib/frontend/recommendation/exploration-flow"
import { FeedbackWidget } from "@/lib/frontend/recommendation/feedback-widget"
import {
  IntakeGate,
  IntakeSummaryScreen,
  LoadingScreen,
} from "@/lib/frontend/recommendation/intake-flow"
import { useProductRecommendationPage } from "@/lib/frontend/recommendation/use-product-recommendation-page"
import { getSessionCapabilities } from "@/lib/frontend/recommendation/recommendation-view-model"

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
    candidatePagination,
    isCandidatePageLoading,
    capabilities,
    handleFieldChange,
    runRecommendation,
    handleChatSend,
    loadCandidatePage,
    handleReset,
    handleFeedback,
    handleChipFeedback,
    handleRecommendationFeedback,
    handleSuccessCapture,
  } = useProductRecommendationPage({
    language,
    country,
    resetKey,
  })

  const phaseLabel =
    phase === "intake"
      ? "Input"
      : phase === "summary"
        ? "Review"
        : "Search"

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-[linear-gradient(180deg,#ffffff_0%,#f7f7f8_100%)]">
      <FeedbackWidget
        form={form}
        messages={chatMessages}
        sessionState={sessionState}
        candidateSnapshot={candidateSnapshot}
      />

      <div className="shrink-0 border-b bg-gray-50/80 px-4 py-1 text-center">
        <span className="font-mono text-[10px] text-gray-400">
          Build updated: {process.env.NEXT_PUBLIC_BUILD_TIMESTAMP ?? new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
        </span>
      </div>

      {phase !== "explore" && (
        <div className="shrink-0 border-b bg-white/95">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-4 py-5">
            <div className="min-w-0 flex-1">
              <div className="mb-2 h-1 w-14 rounded-full bg-red-600" />
              <div className="flex items-center gap-2">
                <span className="text-xl font-semibold tracking-[-0.03em] text-gray-950">YG-1 Product Search</span>
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${
                    phase === "intake"
                      ? "bg-red-50 text-red-700"
                      : phase === "summary"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {phaseLabel}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                {language === "ko"
                  ? "공정과 소재를 선택해 추천을 시작하세요."
                  : "Choose process and material to begin the recommendation flow."}
              </p>
            </div>
            <div className="hidden items-center gap-2 rounded-full bg-[#e9e9ec] px-4 py-2 text-sm font-medium text-gray-700 md:flex">
              <span>{language === "ko" ? "제품 검색" : "Product Search"}</span>
              <Search className="h-4 w-4" />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="shrink-0 flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2">
          <AlertCircle size={13} className="text-red-500" />
          <span className="text-xs text-red-700">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-xs text-red-500">
            Close
          </button>
        </div>
      )}

      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        {phase === "intake" && (
          <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col">
            <IntakeGate form={form} onChange={handleFieldChange} onNext={() => setPhase("summary")} />
          </div>
        )}

        {phase === "summary" && (
          <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
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
            candidatePagination={candidatePagination}
            isCandidatePageLoading={isCandidatePageLoading}
            capabilities={getSessionCapabilities(sessionState, capabilities)}
            onSend={handleChatSend}
            onPageChange={loadCandidatePage}
            onReset={handleReset}
            onEdit={() => setPhase("intake")}
            onFeedback={handleFeedback}
            onChipFeedback={handleChipFeedback}
            onRecommendationFeedback={handleRecommendationFeedback}
            onSuccessCapture={handleSuccessCapture}
          />
        )}
      </div>
    </div>
  )
}
