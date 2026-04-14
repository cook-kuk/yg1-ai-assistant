/**
 * Session Consistency Guard — LLM 호출 전에 세션 상태 모순을 deterministic 하게
 * 잡아낸다. complexity-router.getRoutingDecision() 의 shortCircuitType 힌트를
 * 기반으로 하되, 실제 세션 상태(appliedFilters / displayedProducts / selection
 * context) 와 교차검증하여 확실할 때만 차단한다.
 *
 * 이 guard 가 차단하면 LLM(mini/full) 호출 없이 즉시 clarification 을 돌려준다.
 */

export type SessionGuardType =
  | "clarify_no_filters"
  | "clarify_missing_compare_targets"
  | "clarify_missing_selection_context"
  | "clarify_cutting_condition_ambiguous"

export interface SessionGuardInput {
  message: string
  appliedFilterCount: number
  displayedProductsCount: number
  hasSelectionContext?: boolean
  hasComparisonTargets?: boolean
  hasPendingQuestion?: boolean
}

export interface SessionGuardResult {
  blocked: boolean
  type?: SessionGuardType
  reply?: string
  reason?: string
}

// 개별 detector — 같은 regex 가 routing 과 guard 에서 중복될 수밖에 없어서
// 의도적으로 작게 유지한다. complexity-router 쪽 regex 를 공유하지 않는 이유는
// guard 가 "확실한 케이스"만 잡아야 해서 좁게 쓰는 쪽이 안전하기 때문이다.
const REFINE_REQUEST_RE  = /(기존\s*조건|조건\s*(수정|변경|바꿔)|필터\s*(수정|변경|바꿔)|조건\s*추가|조건\s*빼|아까\s*조건)/iu
const COMPARE_REQUEST_RE = /(둘\s*중|둘\s*다\s*(보여|비교)|이\s*둘\s*비교|뭐가\s*(더\s*)?(나아|좋아|좋을까)|vs\b|비교해)/iu
const SELECTION_REQUEST_RE = /^(\s*[1-9]\s*(번|번째|째)?(으?로|만)?\s*(할게|해줘|할래|선택)?\s*[.!?]?\s*$)|^(\s*(그|저)\s*(걸|것)\s*(으?로|만)?\s*(할게|해줘)?\s*[.!?]?\s*$)/iu

// 절삭조건 필터 의도 — 구체 수치 없이 "절삭조건으로 필터 더 걸고 싶어요" 류.
// cutting_condition_table 은 SQL Agent 가 직접 필터링 못 하므로, 값을 확인받아
// tool-forge 경로로 넘기기 전에 clarification 으로 먼저 받는다.
const CUTTING_CONDITION_RE = /(절삭\s*조건|cutting\s*condition|커팅\s*컨디션)/iu
const FILTER_INTENT_RE     = /(필터|조건\s*(걸|추가|더|적용|좁혀|줄여)|좁혀|줄여|추가로)/iu
// 구체 수치/단위 — 있으면 명시적 값이므로 clarification 불필요.
const CUTTING_NUMERIC_RE   = /(\b(Vc|fz|fn|ap|ae|RPM|rpm)\b|\d+\s*(m\/min|mm\/rev|mm\/min|mm\/tooth|mm\/z|rpm|RPM))/iu

const REPLY_NO_FILTERS =
  "현재 수정할 기존 조건이 없습니다. 새 조건을 말씀해 주시거나, 원하시는 제품 유형을 먼저 알려주세요."
const REPLY_MISSING_COMPARE_TARGETS =
  "아직 비교할 대상이 정해지지 않았습니다. 비교할 두 제품이나 조건을 먼저 알려주세요."
const REPLY_MISSING_SELECTION_CONTEXT =
  "지금은 선택할 이전 후보가 없습니다. 먼저 원하시는 조건으로 추천을 받아보세요."
const REPLY_CUTTING_CONDITION_AMBIGUOUS =
  "어떤 절삭조건을 추가하고 싶으신가요? (절삭속도 Vc, 이송속도 fz, 절입깊이 ap/ae)"

export function checkSessionConsistency(input: SessionGuardInput): SessionGuardResult {
  const text = input.message?.trim() ?? ""
  if (!text) return { blocked: false }

  // 1) 조건 수정 요청 + 적용 필터 0
  if (REFINE_REQUEST_RE.test(text) && input.appliedFilterCount === 0) {
    return {
      blocked: true,
      type: "clarify_no_filters",
      reply: REPLY_NO_FILTERS,
      reason: "refine-request without any appliedFilter",
    }
  }

  // 2) 비교 요청 + 비교 대상 없음
  //    displayedProducts 가 2개 이상이면 대상이 있다고 본다
  //    명시적 hasComparisonTargets 우선
  const hasCompareTargets = input.hasComparisonTargets
    ?? input.displayedProductsCount >= 2
  if (COMPARE_REQUEST_RE.test(text) && !hasCompareTargets) {
    return {
      blocked: true,
      type: "clarify_missing_compare_targets",
      reply: REPLY_MISSING_COMPARE_TARGETS,
      reason: "compare-request without ≥2 display targets",
    }
  }

  // 3) 선택 요청 + 선택 컨텍스트 없음
  const hasSelection = input.hasSelectionContext ?? input.displayedProductsCount >= 1
  if (SELECTION_REQUEST_RE.test(text) && !hasSelection) {
    return {
      blocked: true,
      type: "clarify_missing_selection_context",
      reply: REPLY_MISSING_SELECTION_CONTEXT,
      reason: "selection-request without any prior candidate",
    }
  }

  // 4) 절삭조건 필터 의도 + 구체 수치 없음
  //    SQL Agent 가 cutting_condition_table 로 JOIN 시도하기 전에 clarification.
  //    기존 appliedFilters 는 유지 — 값을 확인받은 다음 tool-forge 로 넘긴다.
  if (
    CUTTING_CONDITION_RE.test(text)
    && FILTER_INTENT_RE.test(text)
    && !CUTTING_NUMERIC_RE.test(text)
  ) {
    return {
      blocked: true,
      type: "clarify_cutting_condition_ambiguous",
      reply: REPLY_CUTTING_CONDITION_AMBIGUOUS,
      reason: "cutting-condition filter intent without specific Vc/fz/ap value",
    }
  }

  return { blocked: false }
}
