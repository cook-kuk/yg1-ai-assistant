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
    if (isExplain || isCompare || isTrouble || (isConsult && hasQuestionMark)) {
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
