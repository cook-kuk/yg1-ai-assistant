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

// 지식질문 패턴 — 필터 힌트가 있어도 general_knowledge/direct_lookup 유지
const KNOWLEDGE_QUESTION_RE = /(뭐야|뭔데|뭐에요|뭐임|뭔가요|무엇|뜻이|의미|원리|왜\s)/
const KNOWLEDGE_COMPARE_RE = /(\bvs\.?\b|대비|차이|비교\s*(?:해|설명))/i
const KNOWLEDGE_SERIES_RE = /(시리즈|특징|장점|용도|스펙|설명)/

function looksLikeKnowledgeQuestion(text: string): boolean {
  return (
    KNOWLEDGE_QUESTION_RE.test(text) ||
    KNOWLEDGE_COMPARE_RE.test(text) ||
    KNOWLEDGE_SERIES_RE.test(text)
  )
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

  if (DIRECT_LOOKUP_TYPES.has(queryTarget.type)) {
    // Override: series/brand 계열은 entity-registry false-positive 가능성이 있고,
    // 사용자가 필터 힌트로 "추천" 문맥을 분명히 했으면 SKU 직조회가 아닌 추천 경로로
    if (
      OVERRIDABLE_DIRECT_LOOKUP_TYPES.has(queryTarget.type) &&
      !looksLikeKnowledgeQuestion(userMessage)
    ) {
      const filterHintCount = countExplicitFilterHints(userMessage)
      if (filterHintCount >= 1) {
        return {
          kind: "recommendation_action",
          reason: `filter_hints_override_direct:${queryTarget.type}/${filterHintCount}`,
        }
      }
    }
    return {
      kind: "direct_lookup",
      reason: `query_target:${queryTarget.type}`,
    }
  }

  // Lexical fast-path: pure question / troubleshooting / comparison patterns.
  // unified-judgment (Haiku LLM) often mis-labels these as recommendation, so we
  // intercept with cheap regex triggers before spending an LLM call. Turn 0 only —
  // later turns carry narrowing context and should keep going through judgment.
  if (!sessionState || (sessionState.turnCount ?? 0) === 0) {
    const msg = userMessage.trim()
    const hasQuestionMark = /[?？]/.test(msg)
    const QUESTION_RE = /(뭐야|뭔데|뭐에요|뭐임|뭔가요|무엇|뜻이|의미|알려줘|알려주|설명|왜\s|어떻게|어느게|어떤게|어떤거|어떤\s게)/
    const COMPARE_RE = /(vs\.?|대비|차이|뭐가\s*(더|나|나아|좋)|어느\s*게|어떤\s*게\s*(더|낫|좋))/i
    const TROUBLE_RE = /(수명|마모|닳|파손|깨짐|부러|떨림|진동|채터|거칠|버[가는이]?|칩[이\s]*엉)/
    const CONSULT_RE = /(어떻게\s*해야|어떻게\s*하면|어떤\s*게\s*좋|뭐가\s*좋|추천\s*해줘|대책|해결)/
    const isExplain = hasQuestionMark || QUESTION_RE.test(msg)
    const isCompare = COMPARE_RE.test(msg)
    const isTrouble = TROUBLE_RE.test(msg)
    const isConsult = CONSULT_RE.test(msg) && msg.length < 40
    // Exclude pure filter-spec messages (e.g. "스테인리스 4날 10mm" — no question words)
    // Also exclude messages with material/spec entities + recommendation-like patterns
    // e.g. "SUS316L 많이 하는데 괜찮은 거?" should route to recommendation, not Q&A
    const RECOMMEND_LIKE_RE = /(?:괜찮|좋은|추천|적합|적당|맞는|쓸만|쓸\s*만|어울리|어떤\s*거|어떤\s*게\s*있|있나|있어|있을까)/
    const hasRecommendLikeSignal = RECOMMEND_LIKE_RE.test(msg) && queryTarget.entities.length > 0
    if ((isExplain || isCompare || isTrouble || (isConsult && hasQuestionMark)) && !hasRecommendLikeSignal) {
      return {
        kind: "general_knowledge",
        reason: `lexical:${isExplain ? "explain" : isCompare ? "compare" : isTrouble ? "trouble" : "consult"}`,
      }
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
    const isTaxonomy = isCuttingToolTaxonomyKnowledgeQuestion(userMessage)
    // Override: 명시 필터 힌트가 있고 지식질문/taxonomy가 아니면 추천 파이프라인 강제
    // (자연스러운 톤 때문에 judgment가 off_topic/explain으로 오분류해도 필터 추출을 놓치지 않도록)
    if (!isTaxonomy && !looksLikeKnowledgeQuestion(userMessage)) {
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

  return {
    kind: "recommendation_action",
    reason: `default:${queryTarget.type}/${judgment.intentAction}`,
  }
}
