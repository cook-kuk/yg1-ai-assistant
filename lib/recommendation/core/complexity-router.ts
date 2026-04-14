/**
 * Turn-level complexity routing.
 *
 * Intent classification is delegated to the LLM (with semantic cache).
 * This module is no longer a regex gatekeeper — it only short-circuits
 * empty input and otherwise lets downstream LLM stages decide.
 */

import {
  DEFAULT_MODEL_TIER_LIGHT,
  DEFAULT_MODEL_TIER_NORMAL,
  DEFAULT_MODEL_TIER_DEEP,
  type ModelTier,
  type ReasoningTier,
} from "@/lib/recommendation/infrastructure/config/llm-config"
import type { DeepIntentHint } from "./deep-intent-classifier"

export type { DeepIntentHint }

export type ComplexityLevel = "light" | "normal" | "deep"
export type ResolverStageBudget = "stage1" | "stage2" | "stage3"
export type UiThinkingMode = "hidden" | "simple" | "full"

/** 신규 외부 routing 개념. ComplexityDecision 을 래핑한다. */
export interface RoutingDecision {
  reasoningTier: ReasoningTier
  modelTier: ModelTier
  reasons: string[]
  canShortCircuit: boolean
  shortCircuitType?: string
  requiresSql?: boolean
  requiresKg?: boolean
  requiresNewCandidates?: boolean
  needsSessionRecovery?: boolean
  hasConflict?: boolean
  /** 원래의 ComplexityDecision 도 그대로 보존 — stream route / resolver 가 쓴다. */
  complexity: ComplexityDecision
}

export interface ComplexityDecision {
  level: ComplexityLevel
  reason: string
  runSelfCorrection: boolean
  searchKB: boolean
  generateCoT: boolean
  allowWebSearch: boolean
  maxSentences: number
  resolverStageBudget: ResolverStageBudget
  allowLegacyLlmFallback: boolean
  allowToolForge: boolean
  uiThinkingMode: UiThinkingMode
}

function buildDecision(
  level: ComplexityLevel,
  reason: string,
): ComplexityDecision {
  switch (level) {
    case "light":
      return {
        level,
        reason,
        runSelfCorrection: false,
        searchKB: false,
        generateCoT: false,
        allowWebSearch: false,
        maxSentences: 2,
        resolverStageBudget: "stage1",
        allowLegacyLlmFallback: false,
        allowToolForge: false,
        uiThinkingMode: "hidden",
      }
    case "deep":
      return {
        level,
        reason,
        runSelfCorrection: true,
        searchKB: true,
        generateCoT: true,
        allowWebSearch: true,
        maxSentences: 6,
        resolverStageBudget: "stage3",
        allowLegacyLlmFallback: true,
        allowToolForge: true,
        uiThinkingMode: "full",
      }
    default:
      return {
        level: "normal",
        reason,
        runSelfCorrection: false,
        searchKB: false,
        generateCoT: false,
        allowWebSearch: false,
        maxSentences: 4,
        resolverStageBudget: "stage2",
        allowLegacyLlmFallback: false,
        allowToolForge: false,
        uiThinkingMode: "simple",
      }
  }
}

/**
 * Intent classification by regex has been removed. The LLM classifier
 * (deep-intent-classifier.ts, gated by the semantic cache) decides reasoning
 * depth upstream and passes the result in as `llmHint`. Without a hint this
 * defaults to "normal" for any non-empty input.
 */
export function assessComplexity(
  message: string,
  _appliedFilterCount: number = 0,
  llmHint?: DeepIntentHint | null,
): ComplexityDecision {
  const text = message.trim()
  if (!text) return buildDecision("light", "empty_input")
  if (llmHint?.isDeep) return buildDecision("deep", llmHint.reason || "llm_deep")
  return buildDecision("normal", "llm_decides")
}

export function canUseResolverStage(
  decision: ComplexityDecision | null | undefined,
  stage: ResolverStageBudget,
): boolean {
  const budget = decision?.resolverStageBudget ?? "stage3"
  if (budget === "stage3") return true
  if (budget === "stage2") return stage !== "stage3"
  return stage === "stage1"
}

// ── Signals for routing (mini/full, effort tier) ────────────────────
// complexity-router 의 level(light/normal/deep) 은 CoT/stage-budget 을 위해
// 이미 계산되지만, 모델 선택은 "SQL 필요? / 새 후보 생성? / 비교·부정·범위?" 같은
// 추가 신호로 결정해야 한다. 길이만으로 deep 으로 올리지 않는다.

const SQL_SIGNAL_RE    = /(조회|몇\s*개|개수|카운트|리스트\s*뽑|테이블|컬럼|sql)/iu
const KG_SIGNAL_RE     = /(관계|호환|대체|계열|매칭|kg\b)/iu
const RANGE_SIGNAL_RE  = /(\d+\s*mm\s*(이상|이하|초과|미만)|\d+\s*~\s*\d+|사이|이내)/iu
const NEGATION_SIGNAL_RE = /(말고|빼고|제외|아니고|not\b|except|without)/iu
const COMPARE_SIGNAL_RE  = /(비교|차이|vs\b|대체|호환|similar|compare|difference)/iu
const SESSION_REF_RE     = /(그거|그게|이거|이게|저거|저게|아까|방금|이전|previous|last|그걸로)/iu
const REFINE_REQUEST_RE  = /(기존\s*조건|조건\s*(수정|변경|바꿔)|필터\s*(수정|변경|바꿔)|조건\s*추가|조건\s*빼)/iu
const SELECTION_REF_RE   = /^(\s*[1-9]\s*(번|번째|째)?(으?로|만)?\s*(할게|해줘|할래|선택)?\s*$)|그\s*(걸|것)\s*(으?로|만)?\s*(할게|해줘)?/iu
const NEW_CANDIDATE_RE   = /(추천|찾아|보여|리스트|후보|있어)/iu

export interface RoutingSignalsInput {
  message: string
  appliedFilterCount?: number
  displayedProductsCount?: number
  hasPendingQuestion?: boolean
  hasComparisonTargets?: boolean
  hasSelectionContext?: boolean
  /** Pre-computed LLM intent hint (optional). When provided, drives deep
   *  promotion without needing a synchronous regex pre-check. */
  llmHint?: DeepIntentHint | null
}

function detectSignals(input: RoutingSignalsInput): {
  requiresSql: boolean
  requiresKg: boolean
  requiresNewCandidates: boolean
  hasConflict: boolean
  needsSessionRecovery: boolean
  hasNegation: boolean
  hasComparison: boolean
  hasRange: boolean
  refinesExisting: boolean
  looksLikeSelection: boolean
} {
  const text = input.message
  const refinesExisting = REFINE_REQUEST_RE.test(text)
  const looksLikeSelection = SELECTION_REF_RE.test(text)
  return {
    requiresSql: SQL_SIGNAL_RE.test(text),
    requiresKg: KG_SIGNAL_RE.test(text),
    requiresNewCandidates: NEW_CANDIDATE_RE.test(text) && !refinesExisting && !looksLikeSelection,
    hasConflict: (NEGATION_SIGNAL_RE.test(text) ? 1 : 0) + (RANGE_SIGNAL_RE.test(text) ? 1 : 0) >= 2,
    needsSessionRecovery: SESSION_REF_RE.test(text),
    hasNegation: NEGATION_SIGNAL_RE.test(text),
    hasComparison: COMPARE_SIGNAL_RE.test(text),
    hasRange: RANGE_SIGNAL_RE.test(text),
    refinesExisting,
    looksLikeSelection,
  }
}

/** 기본 RoutingDecision. complexity-router level 을 그대로 tier 로 쓰되
 *  강제 승격/강등 규칙을 한 번 더 적용한다. */
export function getRoutingDecision(input: RoutingSignalsInput): RoutingDecision {
  const complexity = assessComplexity(input.message, input.appliedFilterCount ?? 0, input.llmHint ?? null)
  const signals = detectSignals(input)
  const reasons: string[] = [`complexity:${complexity.level}:${complexity.reason}`]

  // 1) complexity.level → reasoningTier + modelTier 디폴트
  let reasoningTier: ReasoningTier = complexity.level
  let modelTier: ModelTier =
    complexity.level === "light"  ? DEFAULT_MODEL_TIER_LIGHT
    : complexity.level === "deep" ? DEFAULT_MODEL_TIER_DEEP
    :                               DEFAULT_MODEL_TIER_NORMAL

  // 2) mini → full 강제 승격
  const promote = (reason: string) => {
    if (modelTier !== "full") {
      modelTier = "full"
      reasons.push(`promote:${reason}`)
    }
    if (reasoningTier === "light") reasoningTier = "normal"
  }
  if (signals.requiresSql)            promote("sql")
  if (signals.requiresKg && signals.hasComparison) promote("kg+compare")
  if (signals.requiresNewCandidates && complexity.level !== "light") promote("new-candidates")
  if (signals.hasConflict)            { promote("multi-constraint-conflict"); reasoningTier = "deep" }
  if (signals.needsSessionRecovery && (signals.hasComparison || signals.hasNegation)) promote("session-recovery")
  if (signals.hasNegation || signals.hasComparison) {
    if (modelTier !== "full") promote("negation-or-compare")
    if (reasoningTier === "normal" || reasoningTier === "light") reasoningTier = "deep"
  }

  // 3) full → mini 강제 강등
  //    - pending question context 있는 단순 yes/no
  //    - selection-only 발화
  const demote = (reason: string) => {
    modelTier = "mini"
    reasoningTier = "light"
    reasons.push(`demote:${reason}`)
  }
  const isYesNo = /^\s*(응|네|넵|예|좋아|ok|okay|no|아니요|아니)\s*[.!?]?\s*$/iu.test(input.message)
  if (isYesNo && input.hasPendingQuestion) demote("yesno-pending")
  if (signals.looksLikeSelection && (input.hasSelectionContext ?? input.displayedProductsCount)) demote("selection-resolve")

  // 4) canShortCircuit hint — 실제 차단은 session-consistency-guard 가 한다
  let canShortCircuit = false
  let shortCircuitType: string | undefined
  if (signals.refinesExisting && (input.appliedFilterCount ?? 0) === 0) {
    canShortCircuit = true; shortCircuitType = "clarify_no_filters"
  } else if (signals.hasComparison && !input.hasComparisonTargets) {
    canShortCircuit = true; shortCircuitType = "clarify_missing_compare_targets"
  } else if (signals.looksLikeSelection && !input.hasSelectionContext && !(input.displayedProductsCount && input.displayedProductsCount > 0)) {
    canShortCircuit = true; shortCircuitType = "clarify_missing_selection_context"
  }

  return {
    reasoningTier,
    modelTier,
    reasons,
    canShortCircuit,
    shortCircuitType,
    requiresSql: signals.requiresSql,
    requiresKg: signals.requiresKg,
    requiresNewCandidates: signals.requiresNewCandidates,
    needsSessionRecovery: signals.needsSessionRecovery,
    hasConflict: signals.hasConflict,
    complexity,
  }
}
