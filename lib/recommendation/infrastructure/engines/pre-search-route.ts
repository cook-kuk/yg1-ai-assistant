import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"
import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import { classifyQueryTarget, type QueryTargetType } from "@/lib/recommendation/domain/context/query-target-classifier"
import { performUnifiedJudgment } from "@/lib/recommendation/domain/context/unified-haiku-judgment"
import { isCuttingToolTaxonomyKnowledgeQuestion } from "@/lib/shared/domain/cutting-tool-routing-knowledge"
import {
  extractDiameter,
  extractCoating,
  extractMaterial,
  extractOperation,
} from "@/lib/recommendation/domain/input-normalizer"
import { canonicalizeToolSubtype, extractFluteCount } from "@/lib/recommendation/shared/patterns"

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

// 명시 필터 힌트 개수 (material/diameter/subtype/flute/coating/operation)
function countExplicitFilterHints(text: string): number {
  let count = 0
  if (extractMaterial(text)) count++
  if (extractDiameter(text) != null) count++
  if (canonicalizeToolSubtype(text)) count++
  if (extractFluteCount(text) != null) count++
  if (extractCoating(text)) count++
  if (extractOperation(text)) count++
  return count
}

// product_info/product_comparison은 실제 SKU 코드 매칭이므로 override 대상에서 제외
const OVERRIDABLE_DIRECT_LOOKUP_TYPES = new Set<QueryTargetType>([
  "series_info",
  "brand_info",
  "series_comparison",
  "brand_comparison",
])

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

  const isDirectLookup = DIRECT_LOOKUP_TYPES.has(queryTarget.type)
  const isOverridableDirectLookup = isDirectLookup && OVERRIDABLE_DIRECT_LOOKUP_TYPES.has(queryTarget.type)

  // product_info/product_comparison (실제 SKU 코드 매칭) 은 override 여지 없이 direct_lookup 확정.
  // series/brand 계열은 아래 judgment 이후 override 검토.
  if (isDirectLookup && !isOverridableDirectLookup) {
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
    previousTurnAction: sessionState?.lastAction ?? null,
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
    const isTaxonomy = isCuttingToolTaxonomyKnowledgeQuestion(userMessage)
    // LLM 판단 존중: general_knowledge 로 분류되면 regex filter-hint 개수와 상관없이 LLM 결정을 따른다.
    // filterHintCount 는 로깅/tiebreaker 용으로만 남긴다 — override 금지 (수찬 모델 스타일 필터편향 방지).
    // 사용자가 진짜 추천을 원하면 intentAction="ask_recommendation" 으로 들어오고 isGeneralKnowledge=false 가 된다.
    const filterHintCount = countExplicitFilterHints(userMessage)
    return {
      kind: "general_knowledge",
      reason: isTaxonomy
        ? `taxonomy_knowledge/hints=${filterHintCount}`
        : `judgment:${judgment.domainRelevance}/${judgment.intentAction}/hints=${filterHintCount}`,
    }
  }

  // Overridable direct_lookup (series/brand): LLM 판단 존중 — filter-hint 로 override 하지 않는다.
  // 사용자가 "4GMILL 10mm 4날" 처럼 브랜드+필터를 섞어도, LLM 이 direct_lookup 으로 분류했다면
  // 그 의도대로 브랜드 카드/정보를 먼저 보여주고 후속 턴에서 필터링으로 좁힌다.
  if (isOverridableDirectLookup) {
    const filterHintCount = countExplicitFilterHints(userMessage)
    return {
      kind: "direct_lookup",
      reason: `query_target:${queryTarget.type}/hints=${filterHintCount}`,
    }
  }

  return {
    kind: "recommendation_action",
    reason: `default:${queryTarget.type}/${judgment.intentAction}`,
  }
}
