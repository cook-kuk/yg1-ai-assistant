import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"
import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import { classifyQueryTarget, type QueryTargetType } from "@/lib/recommendation/domain/context/query-target-classifier"
import { performUnifiedJudgment } from "@/lib/recommendation/domain/context/unified-haiku-judgment"
import { isCuttingToolTaxonomyKnowledgeQuestion } from "@/lib/shared/domain/cutting-tool-routing-knowledge"

export type PreSearchRouteKind =
  | "general_knowledge"
  | "direct_lookup"
  | "recommendation_action"

export interface PreSearchRouteDecision {
  kind: PreSearchRouteKind
  reason: string
}

const DIRECT_LOOKUP_TYPES = new Set<QueryTargetType>([
  "product_info",
  "product_comparison",
  "series_info",
  "brand_info",
  "series_comparison",
  "brand_comparison",
])

function activeFilterField(sessionState: ExplorationSessionState | null): string | null {
  return sessionState?.appliedFilters?.find(filter => filter.op !== "skip")?.field ?? null
}

export async function classifyPreSearchRoute(
  userMessage: string,
  sessionState: ExplorationSessionState | null,
  provider: LLMProvider
): Promise<PreSearchRouteDecision> {
  const queryTarget = classifyQueryTarget(
    userMessage,
    activeFilterField(sessionState),
    sessionState?.lastAskedField ?? null,
  )

  if (DIRECT_LOOKUP_TYPES.has(queryTarget.type)) {
    return {
      kind: "direct_lookup",
      reason: `query_target:${queryTarget.type}`,
    }
  }

  const judgment = await performUnifiedJudgment({
    userMessage,
    assistantText: null,
    pendingField: sessionState?.lastAskedField ?? null,
    currentMode: sessionState?.currentMode ?? null,
    displayedChips: sessionState?.displayedChips ?? [],
    filterCount: sessionState?.appliedFilters?.length ?? 0,
    candidateCount: sessionState?.candidateCount ?? 0,
    hasRecommendation: sessionState?.resolutionStatus?.startsWith("resolved") ?? false,
  }, provider)

  const isExplanationLike =
    judgment.intentAction === "explain" ||
    judgment.userState === "wants_explanation" ||
    queryTarget.type === "active_field_query" ||
    queryTarget.type === "general_question"

  // RC2: compare/explain intents on domain terms should go to knowledge path
  // even when entities are present (e.g. "AlCrN vs TiAlN", "알루파워가 뭐야")
  // because the filter pipeline can't answer "what is X" or "A vs B".
  const isCompareOrExplainIntent =
    (judgment.intentAction === "explain" || judgment.intentAction === "compare") &&
    judgment.domainRelevance === "product_query" &&
    queryTarget.type !== "field_count"

  const isGeneralKnowledge =
    isCuttingToolTaxonomyKnowledgeQuestion(userMessage) ||
    judgment.domainRelevance === "company_query" ||
    judgment.domainRelevance === "greeting" ||
    judgment.domainRelevance === "off_topic" ||
    isCompareOrExplainIntent ||
    (
      isExplanationLike &&
      judgment.domainRelevance === "product_query" &&
      queryTarget.entities.length === 0 &&
      queryTarget.type !== "field_count"
    )

  if (isGeneralKnowledge) {
    return {
      kind: "general_knowledge",
      reason: isCuttingToolTaxonomyKnowledgeQuestion(userMessage)
        ? "taxonomy_knowledge"
        : `judgment:${judgment.domainRelevance}/${judgment.intentAction}`,
    }
  }

  return {
    kind: "recommendation_action",
    reason: `default:${queryTarget.type}/${judgment.intentAction}`,
  }
}
