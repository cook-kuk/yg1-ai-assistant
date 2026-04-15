import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"
import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import { performUnifiedJudgment } from "@/lib/recommendation/domain/context/unified-haiku-judgment"

// LLM judgment 결과만으로 라우팅. 정보 조회성 질의(설명/비교/회사/인사/off-topic)는
// general_knowledge 로 묶고, 추천/필터 흐름은 null(pass-through) 로 downstream resolver 에 맡긴다.
// (기존 regex 기반 DIRECT_LOOKUP_TYPES / countExplicitFilterHints / taxonomy regex 제거됨.)

export type PreSearchRouteKind = "general_knowledge"

export interface PreSearchRouteDecision {
  kind: PreSearchRouteKind
  reason: string
}

export async function classifyPreSearchRoute(
  userMessage: string,
  sessionState: ExplorationSessionState | null,
  provider: LLMProvider
): Promise<PreSearchRouteDecision | null> {
  const judgment = await performUnifiedJudgment({
    userMessage,
    assistantText: null,
    pendingField: sessionState?.lastAskedField ?? null,
    currentMode: sessionState?.currentMode ?? null,
    displayedChips: sessionState?.displayedChips ?? [],
    filterCount: sessionState?.appliedFilters?.length ?? 0,
    candidateCount: sessionState?.candidateCount ?? 0,
    hasRecommendation: sessionState?.resolutionStatus?.startsWith("resolved") ?? false,
    previousTurnAction: sessionState?.lastAction ?? null,
  }, provider)

  const isNonProductDomain =
    judgment.domainRelevance === "company_query" ||
    judgment.domainRelevance === "greeting" ||
    judgment.domainRelevance === "off_topic"

  const isKnowledgeIntentOnProduct =
    (judgment.intentAction === "explain" ||
     judgment.intentAction === "compare" ||
     judgment.userState === "wants_explanation") &&
    judgment.domainRelevance === "product_query"

  if (isNonProductDomain || isKnowledgeIntentOnProduct) {
    return {
      kind: "general_knowledge",
      reason: `judgment:${judgment.domainRelevance}/${judgment.intentAction}`,
    }
  }

  // pass-through: 추천/필터 흐름은 downstream resolver(unified judgment + filter resolver)가 결정.
  return null
}
