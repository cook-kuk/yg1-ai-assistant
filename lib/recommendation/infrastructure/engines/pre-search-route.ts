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
    // judgment가 explain/compare를 명시적으로 판단했으면 LLM 존중 — 필터힌트 override 금지.
    // 그 외(off_topic/greeting 등 애매한 분류) + taxonomy 아님 + 필터 힌트 있으면 추천 경로 강제.
    // 값 추출(material/diameter/subtype 등)은 regex 몫이라 이 override는 intent가 아닌 값 기반.
    const judgmentSaysExplain = judgment.intentAction === "explain" || judgment.intentAction === "compare"
    if (!isTaxonomy && !judgmentSaysExplain) {
      const filterHintCount = countExplicitFilterHints(userMessage)
      if (filterHintCount >= 1) {
        return {
          kind: "recommendation_action",
          reason: `filter_hints_override:${filterHintCount}`,
        }
      }
    }
    return {
      kind: "general_knowledge",
      reason: isTaxonomy
        ? "taxonomy_knowledge"
        : `judgment:${judgment.domainRelevance}/${judgment.intentAction}`,
    }
  }

  // Overridable direct_lookup (series/brand): judgment가 explain/compare 아니고
  // 필터 힌트가 있으면 추천 경로. 아니면 direct_lookup 유지.
  if (isOverridableDirectLookup) {
    const filterHintCount = countExplicitFilterHints(userMessage)
    if (filterHintCount >= 1) {
      return {
        kind: "recommendation_action",
        reason: `filter_hints_override_direct:${queryTarget.type}/${filterHintCount}`,
      }
    }
    return {
      kind: "direct_lookup",
      reason: `query_target:${queryTarget.type}`,
    }
  }

  return {
    kind: "recommendation_action",
    reason: `default:${queryTarget.type}/${judgment.intentAction}`,
  }
}
