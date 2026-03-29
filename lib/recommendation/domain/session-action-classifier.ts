/**
 * Session Action Classifier — Classifies user utterances within an active
 * recommendation session into explicit semantic actions.
 *
 * Sits BETWEEN raw intent classification and orchestrator routing.
 * Determines whether the user is filtering, querying, selecting, resetting,
 * or asking a follow-up question — and if filtering, whether it's an add,
 * replace, or remove operation.
 *
 * Deterministic. No LLM calls. No DB access. No side effects.
 */

// ── Session Action ──────────────────────────────────────────

export type SessionAction =
  | "add_filter"
  | "replace_filter"
  | "remove_filter"
  | "query_current_results"
  | "ask_in_context"
  | "ask_broader_pool"
  | "summarize_state"
  | "continue_narrowing"
  | "select_option"
  | "reset_filters"
  | "out_of_session"

export interface SessionActionResult {
  action: SessionAction
  targetField?: string
  targetValue?: string
  confidence: number
  reasoning: string
}

export interface FilterIntent {
  mode: "add" | "replace" | "remove" | "none"
  field?: string
  value?: string
}

export interface AppliedFilter {
  field: string
  value: string
  op: string
}

export type TargetScope = "displayed" | "broader_pool" | "session"

// ── Field Detection Patterns ────────────────────────────────

interface FieldPattern {
  field: string
  pattern: RegExp
  valueExtractor?: RegExp
}

const FIELD_PATTERNS: FieldPattern[] = [
  {
    field: "fluteCount",
    pattern: /날\s*수?|플루트|flute|날짜리|\d\s*날/i,
    valueExtractor: /(\d+)\s*날/,
  },
  {
    field: "diameterMm",
    pattern: /직경|지름|파이|ø|diameter/i,
    valueExtractor: /(\d+(?:\.\d+)?)\s*(?:mm|밀리|파이|ø)?/i,
  },
  {
    field: "coating",
    pattern: /코팅|coating|DLC|TiAlN|AlCrN|AlTiN|무코팅|Bright/i,
    valueExtractor: /(?:코팅|coating)\s*(?:을|를)?\s*(\S+)|(\bDLC\b|\bTiAlN\b|\bAlCrN\b|\bAlTiN\b|무코팅|Bright\s*Finish)/i,
  },
  {
    field: "material",
    pattern: /소재|재질|피삭재|workpiece|material/i,
    valueExtractor: /(?:소재|재질|피삭재)\s*(?:을|를)?\s*(\S+)/i,
  },
  {
    field: "toolSubtype",
    pattern: /볼\s*(?:엔드밀|노즈)?|스퀘어|라디우스|테이퍼|형상|ball|square|radius|taper/i,
    valueExtractor: /(볼|스퀘어|라디우스|테이퍼|ball|square|radius|taper)/i,
  },
]

// ── Replacement / Removal Patterns ──────────────────────────

const REPLACE_PATTERNS = [
  /바꿔/,
  /변경/,
  /대신/,
  /(?:볼|스퀘어|라디우스|테이퍼|코팅|소재|재질|날)\s*말고/,  // "X 말고 Y" — field-scoped replacement only
  /로\s*변경/,
  /로\s*바꿔/,
  /대체/,
  /교체/,
  /으로\s*해/,
  /으로\s*변경/,
  /replace/i,
  /change\s+to/i,
  /instead\s+of/i,
  /switch\s+to/i,
]

const REMOVE_PATTERNS = [
  /빼/,
  /제거/,
  /취소/,
  /없애/,
  /해제/,
  /지워/,
  /삭제/,
  /필터\s*(?:를?\s*)?(?:빼|제거|취소|없애|해제|지워|삭제)/,
  /remove/i,
  /clear/i,
  /drop/i,
]

// ── Reset Patterns ──────────────────────────────────────────

const RESET_PATTERNS = [
  /처음부터/,
  /초기화/,
  /리셋/,
  /다시\s*시작/,
  /전부\s*(?:취소|제거|빼)/,
  /모든?\s*(?:필터|조건)\s*(?:를?\s*)?(?:취소|제거|빼|초기화|해제)/,
  /reset/i,
  /start\s*over/i,
  /clear\s*all/i,
]

// ── Selection Patterns ──────────────────────────────────────

const SELECTION_PATTERNS = [
  /^[1-9]$/,
  /^[1-9]\s*번/,
  /^[①②③④⑤⑥⑦⑧⑨]/,
  /(?:^|\s)(?:첫|두|세|네|다섯)\s*번째/,
  /(?:^|\s)(?:first|second|third|fourth|fifth)\b/i,
  /^option\s*[1-9]/i,
]

// ── Displayed-scope Patterns ────────────────────────────────

const DISPLAYED_SCOPE_PATTERNS = [
  /이\s*중에/,
  /이것?\s*들?\s*중/,
  /지금\s*보이는/,
  /여기서/,
  /이\s*결과/,
  /보이는\s*것/,
  /표시된/,
  /나온\s*것/,
  /among\s+these/i,
  /from\s+(?:these|the)\s+results/i,
  /shown\s+here/i,
]

// ── Broader-pool Patterns ───────────────────────────────────

const BROADER_POOL_PATTERNS = [
  /전체에서/,
  /다른\s*것\s*도/,
  /말고\s*다른/,
  /이것?\s*말고/,
  /더\s*없어/,
  /다른\s*(?:제품|옵션|후보)/,
  /밖에\s*없/,
  /other\s+(?:options|products)/i,
  /anything\s+else/i,
  /beyond\s+these/i,
]

// ── In-session Follow-up Patterns ───────────────────────────

const IN_SESSION_REFERENCE_PATTERNS = [
  /이\s*중에/,
  /이거/,
  /이\s*제품/,
  /왜\s*이걸/,
  /지금/,
  /현재/,
  /아까/,
  /방금/,
  /이\s*결과/,
  /this\s+one/i,
  /these/i,
  /current/i,
  /right\s+now/i,
]

const IN_SESSION_TOPIC_PATTERNS = [
  /재고/,
  /절삭\s*조건/,
  /가격/,
  /납기/,
  /배송/,
  /리드\s*타임/,
  /lead\s*time/i,
  /inventory/i,
  /stock/i,
  /price/i,
  /cutting\s*condition/i,
]

const IN_SESSION_STATE_PATTERNS = [
  /필터\s*뭐/,
  /조건\s*뭐/,
  /어디까지/,
  /뭐\s*골랐/,
  /뭐\s*선택/,
  /몇\s*개\s*남/,
  /what\s+filter/i,
  /which\s+condition/i,
  /how\s+many\s+left/i,
]

// ── Summarize-state Patterns ────────────────────────────────

const SUMMARIZE_STATE_PATTERNS = [
  /필터\s*(?:뭐|무엇|어떤)\s*(?:야|있|인가|입니까)/,
  /조건\s*(?:뭐|무엇|어떤)\s*(?:야|있|인가|입니까)/,
  /어디까지\s*(?:왔|진행|좁)/,
  /몇\s*개\s*(?:남|있|인가)/,
  /후보\s*(?:몇|수)/,
  /현재\s*(?:상태|상황|필터|조건)/,
  /지금\s*(?:상태|상황|필터|조건)/,
  /what.*(?:filter|condition).*active/i,
  /how\s+many\s+(?:candidate|result|left)/i,
  /current\s+(?:state|status|filter)/i,
]

// ── Out-of-session Patterns ─────────────────────────────────

const OUT_OF_SESSION_PATTERNS = [
  /날씨/,
  /뉴스/,
  /오늘\s*몇\s*일/,
  /점심/,
  /저녁/,
  /커피/,
  /고마워/,
  /감사/,
  /안녕/,
  /weather/i,
  /news/i,
  /hello/i,
  /thank/i,
  /goodbye/i,
]

// ── Helpers ─────────────────────────────────────────────────

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text))
}

function detectField(text: string): { field: string; value?: string } | null {
  for (const fp of FIELD_PATTERNS) {
    if (fp.pattern.test(text)) {
      let value: string | undefined
      if (fp.valueExtractor) {
        const match = text.match(fp.valueExtractor)
        if (match) {
          // Take first non-undefined capture group
          value = match.slice(1).find((g) => g !== undefined)
        }
      }
      return { field: fp.field, value }
    }
  }
  return null
}

function hasExistingFilter(
  field: string,
  appliedFilters: AppliedFilter[]
): boolean {
  return appliedFilters.some((f) => f.field === field)
}

// ── Exported Functions ──────────────────────────────────────

/**
 * Determines whether the user intends to add, replace, or remove a filter.
 *
 * Detects the target field from Korean/English keywords and checks against
 * existing filters to distinguish add vs. replace operations.
 *
 * @param userMessage  - The raw user utterance
 * @param appliedFilters - Currently active filters in the session
 * @returns FilterIntent with mode, field, and optional value
 */
export function detectFilterIntent(
  userMessage: string,
  appliedFilters: AppliedFilter[]
): FilterIntent {
  const text = userMessage.trim()

  // Check removal first — most explicit
  if (matchesAny(text, REMOVE_PATTERNS)) {
    const fieldInfo = detectField(text)
    if (fieldInfo) {
      return { mode: "remove", field: fieldInfo.field, value: fieldInfo.value }
    }
    // Generic removal without field — could be a "remove last filter" intent
    return { mode: "remove" }
  }

  // Check for field mention
  const fieldInfo = detectField(text)
  if (!fieldInfo) {
    return { mode: "none" }
  }

  // Explicit replace keywords — prefer value AFTER "말고" if present
  if (matchesAny(text, REPLACE_PATTERNS)) {
    let replaceValue = fieldInfo.value
    const malgoMatch = text.match(/말고\s*(\S+)/)
    if (malgoMatch) {
      // Re-detect field from the value after "말고"
      const afterMalgo = malgoMatch[1]
      const afterField = detectField(afterMalgo)
      if (afterField?.value) replaceValue = afterField.value
      else replaceValue = afterMalgo
    }
    return {
      mode: "replace",
      field: fieldInfo.field,
      value: replaceValue,
    }
  }

  // Implicit replace: same field already constrained + new value provided
  if (hasExistingFilter(fieldInfo.field, appliedFilters) && fieldInfo.value) {
    return {
      mode: "replace",
      field: fieldInfo.field,
      value: fieldInfo.value,
    }
  }

  // New filter on unconstrained field
  if (fieldInfo.value) {
    return {
      mode: hasExistingFilter(fieldInfo.field, appliedFilters)
        ? "replace"
        : "add",
      field: fieldInfo.field,
      value: fieldInfo.value,
    }
  }

  // Field mentioned but no value — likely a question, not a filter action
  return { mode: "none" }
}

/**
 * Returns true when the message is likely a follow-up question within
 * the current recommendation session (references displayed products,
 * asks about session state, or mentions session-relevant topics).
 *
 * @param userMessage - The raw user utterance
 * @returns boolean — true if the message is an in-session follow-up
 */
export function isInSessionFollowUp(userMessage: string): boolean {
  const text = userMessage.trim()

  if (matchesAny(text, IN_SESSION_REFERENCE_PATTERNS)) return true
  if (matchesAny(text, IN_SESSION_TOPIC_PATTERNS)) return true
  if (matchesAny(text, IN_SESSION_STATE_PATTERNS)) return true

  // Short messages during a session are likely in-context
  // but we can't know session state here, so only use pattern-based detection
  return false
}

/**
 * Determines the scope the user is targeting — the currently displayed set,
 * the broader candidate pool, or the session in general.
 *
 * @param userMessage - The raw user utterance
 * @returns TargetScope — "displayed", "broader_pool", or "session"
 */
export function detectTargetScope(userMessage: string): TargetScope {
  const text = userMessage.trim()

  if (matchesAny(text, DISPLAYED_SCOPE_PATTERNS)) return "displayed"
  if (matchesAny(text, BROADER_POOL_PATTERNS)) return "broader_pool"
  return "session"
}

/**
 * Classifies a user utterance into a semantic session action.
 *
 * This is the main entry point for the module. It combines filter intent
 * detection, scope detection, and pattern matching to produce a single
 * classified action with confidence score and reasoning.
 *
 * @param userMessage        - The raw user utterance
 * @param appliedFilters     - Currently active filters
 * @param hasDisplayedProducts - Whether products are currently shown to the user
 * @param hasPendingQuestion - Whether the system asked a question awaiting answer
 * @param pendingField       - The field the pending question is about, if any
 * @returns SessionActionResult with action type, optional target, confidence, and reasoning
 */
export function classifySessionAction(
  userMessage: string,
  appliedFilters: AppliedFilter[],
  hasDisplayedProducts: boolean,
  hasPendingQuestion: boolean,
  pendingField: string | null
): SessionActionResult {
  const text = userMessage.trim()

  // 1. Reset — highest priority explicit action
  if (matchesAny(text, RESET_PATTERNS)) {
    return {
      action: "reset_filters",
      confidence: 0.95,
      reasoning: "Explicit reset/restart pattern detected",
    }
  }

  // 2. Selection — numbered/chip pick
  if (matchesAny(text, SELECTION_PATTERNS)) {
    return {
      action: "select_option",
      confidence: 0.9,
      reasoning: "Numbered or ordinal selection pattern detected",
    }
  }

  // 3. Pending question answer — if system asked a question, short answers are likely answers
  if (hasPendingQuestion && pendingField && text.length < 30) {
    // Only override if the message doesn't have explicit filter-change keywords
    const hasExplicitFilterKeyword = matchesAny(text, REPLACE_PATTERNS) || matchesAny(text, REMOVE_PATTERNS)
    if (!hasExplicitFilterKeyword) {
      return {
        action: "continue_narrowing",
        targetField: pendingField,
        confidence: 0.75,
        reasoning: `Short answer to pending question on field=${pendingField}`,
      }
    }
  }

  // 4. Filter operations (add / replace / remove)
  const filterIntent = detectFilterIntent(text, appliedFilters)
  if (filterIntent.mode !== "none") {
    const actionMap: Record<"add" | "replace" | "remove", SessionAction> = {
      add: "add_filter",
      replace: "replace_filter",
      remove: "remove_filter",
    }
    return {
      action: actionMap[filterIntent.mode],
      targetField: filterIntent.field,
      targetValue: filterIntent.value,
      confidence: filterIntent.field ? 0.85 : 0.6,
      reasoning: `Filter ${filterIntent.mode} detected on field=${filterIntent.field ?? "unknown"}, value=${filterIntent.value ?? "unspecified"}`,
    }
  }

  // 5. Summarize state — "필터 뭐야", "몇 개 남았어"
  if (matchesAny(text, SUMMARIZE_STATE_PATTERNS)) {
    return {
      action: "summarize_state",
      confidence: 0.85,
      reasoning: "User asking about current filter/state/count",
    }
  }

  // 6. Scope-based query classification
  const scope = detectTargetScope(text)

  if (scope === "broader_pool") {
    return {
      action: "ask_broader_pool",
      confidence: 0.8,
      reasoning: "User requesting candidates beyond displayed set",
    }
  }

  if (scope === "displayed" && hasDisplayedProducts) {
    return {
      action: "query_current_results",
      confidence: 0.8,
      reasoning: "User querying the currently displayed result set",
    }
  }

  // 7. In-session follow-up detection
  if (isInSessionFollowUp(text)) {
    if (hasDisplayedProducts) {
      return {
        action: "query_current_results",
        confidence: 0.7,
        reasoning:
          "In-session reference detected with displayed products present",
      }
    }
    return {
      action: "ask_in_context",
      confidence: 0.7,
      reasoning: "In-session follow-up detected (no products displayed yet)",
    }
  }

  // 8. Out-of-session check
  if (matchesAny(text, OUT_OF_SESSION_PATTERNS)) {
    return {
      action: "out_of_session",
      confidence: 0.75,
      reasoning: "Message matches off-topic patterns",
    }
  }

  // 9. Default — if we have products, treat as in-context query; otherwise narrowing
  if (hasDisplayedProducts) {
    return {
      action: "ask_in_context",
      confidence: 0.4,
      reasoning: "Default: products displayed, treating as in-context question",
    }
  }

  return {
    action: "continue_narrowing",
    confidence: 0.4,
    reasoning: "Default: no specific pattern matched, continuing narrowing flow",
  }
}
