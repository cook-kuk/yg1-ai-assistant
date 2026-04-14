/**
 * Turn-level complexity routing.
 *
 * The goal is not "always reason deeply", but "spend only the reasoning budget
 * the utterance actually needs".
 */

import {
  MATERIAL_KEYWORD_FLAT,
  TOOL_KEYWORD_FLAT,
  COATING_KEYWORD_FLAT,
  OPERATION_KEYWORD_FLAT,
} from "@/lib/recommendation/shared/patterns"
import {
  DEFAULT_MODEL_TIER_LIGHT,
  DEFAULT_MODEL_TIER_NORMAL,
  DEFAULT_MODEL_TIER_DEEP,
  type ModelTier,
  type ReasoningTier,
} from "@/lib/recommendation/infrastructure/config/llm-config"

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

const FAST_ACK_RE = /^(?:ok|okay|yes|yeah|네|넵|응|예|좋아|맞아|그래|고마워)$/iu
const FAST_SKIP_RE = /^(?:상관없음|아무거나|패스|skip|모름|무관)$/iu
const FAST_COUNTRY_RE = /^(?:국내|미국|일본|유럽)$/iu
const FAST_SINGLE_VALUE_RE = /^(?:square|ball|radius|taper|chamfer|spiral(?:\s+flute)?|스퀘어|볼|래디우스|테이퍼|챔퍼|나선)$/iu
const FAST_ALNUM_RE = /^[A-Za-z][\w-]*$/u
const FAST_NUMERIC_RE = /^(?:\d+(?:\.\d+)?\s*(?:mm|inch|in(?:ch)?|인치|도)(?:\s*(?:이상|이하|초과|미만))?|\d+\s*날|\d+\s*(?:개|건|ea|pcs))$/iu
const CHIP_CLICK_PATTERN = /\(\s*\d+\s*(?:개|건)\s*\)\s*$/u
const STRUCTURED_INTAKE_PATTERN = /(?:문의\s*목적|가공\s*소재|조건에\s*맞는\s*yg-1)/iu

const DEEP_NEGATION_RE = /(?:말고|빼고|제외|아니고|not\b|except|without)/iu
const DEEP_COMPARISON_RE = /(?:비교|차이|vs\b|대체품|대체|비슷한|similar|alternative|compare|difference)/iu
const DEEP_CONTEXT_RE = /(?:그거|그게|이거|이게|저거|저게|아까|방금|previous|last)/iu
const DEEP_GENERIC_RE = /(?:뭐가\s*좋|어떤\s*게|multiple\s+helix|generic|concept|개념|계열|추천해줄수\s*있)/iu
const DEEP_TROUBLE_RE = /(?:이유|원인|떨림|진동|채터|깨짐|수명|문제|에러|trouble|chatter)/iu
const DEEP_COMPETITOR_RE = /(?:sandvik|kennametal|mitsubishi|osg|walter|iscar|seco)/iu
const DEEP_SPEC_RE = /(?:pvd|cvd|iso\s*\d|규격)/iu
const DEEP_ALIAS_RE = /(?:[가-힣]{3,}\s*브랜드|[가-힣]{5,}(?:으로만|로만|만)\s*(?:보여줘|추천))/u
// Uncertainty / low-info messages — user admits they don't know key conditions
// and/or describes only a domain (aerospace/automotive/mold). These need CoT
// to drive a clarification dialog back rather than a phantom-filtered guess.
const DEEP_UNCERTAINTY_RE = /(몰라|모르|잘\s*몰|아무\s*것도|don'?t\s*know|no\s*idea|not\s*sure|처음|초보)/iu
const DEEP_DOMAIN_RE = /(에어로스페이스|항공우주|aerospace|automotive|자동차\s*산업|die\s*mold|금형\s*산업|medical\s*device|의료기기)/iu

// 절삭공구 도메인 신호. uncertainty/domain/length 기반 deep 승격의 교차 검증.
// 도메인 신호가 전혀 없으면 잡담/off-topic으로 간주해 heavy pipeline을 돌리지 않는다.
// patterns.ts 의 flat Set 을 SSOT 로 사용 + 보조 힌트 (mm/가공/절삭…)
let _domainSignalSet: Set<string> | null = null
function getDomainSignalSet(): Set<string> {
  if (_domainSignalSet) return _domainSignalSet
  const set = new Set<string>()
  for (const s of MATERIAL_KEYWORD_FLAT) set.add(s)
  for (const s of TOOL_KEYWORD_FLAT) set.add(s)
  for (const s of COATING_KEYWORD_FLAT) set.add(s)
  for (const s of OPERATION_KEYWORD_FLAT) set.add(s)
  for (const s of ["mm", "밀리", "직경", "지름", "날", "flute", "hrc", "iso", "카바이드", "초경", "가공", "절삭", "공구", "추천", "비교", "시리즈"]) {
    set.add(s)
  }
  _domainSignalSet = set
  return set
}

function hasDomainSignal(text: string): boolean {
  const lower = text.toLowerCase()
  for (const keyword of getDomainSignalSet()) {
    if (lower.includes(keyword)) return true
  }
  return false
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

function isFastValueOnlyMessage(message: string, appliedFilterCount: number): boolean {
  const text = message.trim()
  if (!text) return false
  if (CHIP_CLICK_PATTERN.test(text)) return true
  if (STRUCTURED_INTAKE_PATTERN.test(text)) return true
  if (FAST_ACK_RE.test(text)) return true
  if (FAST_SKIP_RE.test(text)) return true
  if (FAST_COUNTRY_RE.test(text)) return true
  if (FAST_SINGLE_VALUE_RE.test(text)) return true
  if (FAST_NUMERIC_RE.test(text)) return true
  if (FAST_ALNUM_RE.test(text)) return true
  if (text.length <= 8 && appliedFilterCount > 0) return true
  return false
}

function isDeepNaturalLanguage(message: string): boolean {
  const text = message.trim()
  if (!text) return false
  if (DEEP_NEGATION_RE.test(text)) return true
  if (DEEP_COMPARISON_RE.test(text)) return true
  if (DEEP_CONTEXT_RE.test(text)) return true
  if (DEEP_GENERIC_RE.test(text)) return true
  if (DEEP_TROUBLE_RE.test(text)) return true
  if (DEEP_COMPETITOR_RE.test(text)) return true
  if (DEEP_SPEC_RE.test(text)) return true
  if (DEEP_ALIAS_RE.test(text)) return true
  // 불확실성/산업 표현 + 길이 기반 승격은 절삭공구 도메인 신호를 동반할 때만.
  // "가공은 잘 모르겠는데" → 도메인("가공") 있음 → deep
  // "난 아무것도 모르는 신입사원이야" → 도메인 신호 없음 → normal
  if (DEEP_UNCERTAINTY_RE.test(text) && hasDomainSignal(text)) return true
  if (DEEP_DOMAIN_RE.test(text) && hasDomainSignal(text)) return true
  if (text.length >= 30 && hasDomainSignal(text)) return true
  return false
}

export function assessComplexity(
  message: string,
  appliedFilterCount: number = 0,
): ComplexityDecision {
  const text = message.trim()

  if (isFastValueOnlyMessage(text, appliedFilterCount)) {
    if (CHIP_CLICK_PATTERN.test(text)) return buildDecision("light", "chip_click")
    if (STRUCTURED_INTAKE_PATTERN.test(text)) return buildDecision("light", "structured_intake")
    if (FAST_NUMERIC_RE.test(text)) return buildDecision("light", "deterministic_numeric")
    return buildDecision("light", "simple_value")
  }

  if (isDeepNaturalLanguage(text)) {
    if (DEEP_NEGATION_RE.test(text)) return buildDecision("deep", "negation")
    if (DEEP_COMPARISON_RE.test(text)) return buildDecision("deep", "comparison")
    if (DEEP_CONTEXT_RE.test(text)) return buildDecision("deep", "context_dependent")
    if (DEEP_GENERIC_RE.test(text)) return buildDecision("deep", "generic_concept")
    if (DEEP_TROUBLE_RE.test(text)) return buildDecision("deep", "troubleshooting")
    if (DEEP_UNCERTAINTY_RE.test(text)) return buildDecision("deep", "low_info_clarification")
    if (DEEP_DOMAIN_RE.test(text)) return buildDecision("deep", "domain_only")
    if (DEEP_ALIAS_RE.test(text)) return buildDecision("deep", "alias_ambiguity")
    return buildDecision("deep", "complex_natural_language")
  }

  // 절삭공구 도메인 신호가 전혀 없으면 잡담/off-topic으로 본다.
  // heartbeat cascade 억제: stream route가 uiThinkingMode="hidden"을 보고
  // heartbeat 자체를 시작하지 않음.
  if (!hasDomainSignal(text)) return buildDecision("light", "off_topic_chatter")
  return buildDecision("normal", "compound_recommendation")
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
  const complexity = assessComplexity(input.message, input.appliedFilterCount ?? 0)
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
  //    - 필터만 재포맷
  const demote = (reason: string) => {
    modelTier = "mini"
    reasoningTier = "light"
    reasons.push(`demote:${reason}`)
  }
  const isYesNo = /^\s*(응|네|넵|예|좋아|ok|okay|no|아니요|아니)\s*[.!?]?\s*$/iu.test(input.message)
  if (isYesNo && input.hasPendingQuestion) demote("yesno-pending")
  if (signals.looksLikeSelection && (input.hasSelectionContext ?? input.displayedProductsCount)) demote("selection-resolve")
  if (complexity.reason === "off_topic_chatter") demote("off-topic")

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
