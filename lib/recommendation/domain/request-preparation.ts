/**
 * Request Preparation Engine
 *
 * 5 sub-modules:
 *   1. Intent Classifier — deterministic pattern matching (no LLM)
 *   2. Slot Extractor — extract structured params from intake + message
 *   3. Completeness Checker — what's known, unknown, missing
 *   4. Route Planner — decide what to do next
 *   5. Session Context Builder — assemble full context
 *
 * All deterministic. No LLM calls.
 */

import type {
  AnswerState,
  AppliedFilter,
  ChatMessage,
  CompletenessCheck,
  ExplorationSessionState,
  ExtractedSlot,
  MachiningIntent,
  NarrowingTurn,
  ProductIntakeForm,
  RecommendationInput,
  RouteAction,
  RequestPreparationResult,
  RoutePlan,
  SessionContext,
  UndoTarget,
  UserIntent,
} from "@/lib/recommendation/domain/types"
import { checkResolution } from "@/lib/recommendation/domain/question-engine"
import { runHybridRetrieval } from "@/lib/recommendation/domain/hybrid-retrieval"

// ════════════════════════════════════════════════════════════════
// 1. INTENT CLASSIFIER
// ════════════════════════════════════════════════════════════════

export function classifyIntent(
  message: string | null,
  form: ProductIntakeForm,
  sessionState: ExplorationSessionState | null
): { intent: UserIntent; confidence: "high" | "medium" | "low" } {
  // No message = initial call from intake form
  if (!message) {
    return classifyIntakeIntent(form)
  }

  const clean = message.trim().toLowerCase()

  // ── Navigation commands (undo/back) — MUST be checked first ──
  // These are state-machine commands, not chat. Never let them fall to noise/general.
  const undoClassification = classifyUndoIntent(clean, sessionState)
  if (undoClassification) {
    return undoClassification
  }

  // Reset signals — only explicit short commands, not quotes or meta-questions
  if (isExplicitResetCommand(clean)) {
    return { intent: "general_question", confidence: "high" }
  }

  // Completion signals → want recommendation now
  if (["추천해주세요", "바로 보여주세요", "결과 보기", "추천 받기", "추가 조건 없음"].some(s => clean.includes(s))) {
    return { intent: "product_recommendation", confidence: "high" }
  }

  // Refinement signals (post-recommendation)
  if (sessionState?.resolutionStatus?.startsWith("resolved")) {
    if (["다른 직경", "다른 소재", "다른 코팅", "대체", "변경"].some(s => clean.includes(s))) {
      return { intent: "refinement", confidence: "high" }
    }
    if (["대체 후보", "대안", "다른 제품"].some(s => clean.includes(s))) {
      return { intent: "refinement", confidence: "medium" }
    }
  }

  // Cutting condition query
  if (["절삭조건", "가공조건", "vc", "fz", "이송", "속도", "회전수"].some(s => clean.includes(s))) {
    return { intent: "cutting_condition_query", confidence: "high" }
  }

  // Product lookup (specific code)
  const codePattern = /^(ce\d+[a-z]*\d*|gnx\d+|sem[a-z]*\d+|e\d+[a-z]\d+)/i
  if (codePattern.test(clean) && !sessionState?.narrowingHistory?.length) {
    return { intent: "product_lookup", confidence: "medium" }
  }

  // During narrowing: any answer is likely a narrowing response
  if (sessionState && !sessionState.resolutionStatus?.startsWith("resolved")) {
    return { intent: "narrowing_answer", confidence: "high" }
  }

  // Substitute search
  if (["대체품", "대체", "교체", "대안"].some(s => clean.includes(s))) {
    return { intent: "substitute_search", confidence: "medium" }
  }

  // Default: narrowing answer if in session, otherwise general
  if (sessionState) {
    return { intent: "narrowing_answer", confidence: "medium" }
  }

  return { intent: "general_question", confidence: "low" }
}

const RESET_KEYWORDS = ["처음부터 다시", "처음부터", "다시 시작", "리셋"]

function isExplicitResetCommand(clean: string): boolean {
  if (!RESET_KEYWORDS.some(s => clean.includes(s))) return false
  if (RESET_KEYWORDS.includes(clean)) return true
  if (clean.length > 25) return false
  if (/\?|아니야|아닌가|잖아|않아|맞아|맞지|해야|나와야|보기로|어떻게|왜/.test(clean)) return false
  // Frustration emoticons → clarification, not reset
  if (/ㅠ|ㅜ/.test(clean)) return false
  // Meta-commentary → not a reset
  if (/기반으로|만들어|보여|줘야|내놔|라고|라는|이걸|이거|이것|위에|아까/.test(clean)) return false
  return true
}

function classifyIntakeIntent(form: ProductIntakeForm): { intent: UserIntent; confidence: "high" | "medium" | "low" } {
  if (form.inquiryPurpose.status === "known") {
    const purpose = (form.inquiryPurpose as { status: "known"; value: string }).value
    switch (purpose) {
      case "new": return { intent: "product_recommendation", confidence: "high" }
      case "substitute":
      case "inventory_substitute": return { intent: "substitute_search", confidence: "high" }
      case "cutting_condition": return { intent: "cutting_condition_query", confidence: "high" }
      case "product_lookup": return { intent: "product_lookup", confidence: "high" }
    }
  }
  return { intent: "product_recommendation", confidence: "medium" }
}

// ── Undo Intent Classifier ────────────────────────────────────

/** Simple undo patterns — "이전으로", "뒤로", "되돌리기" */
const SIMPLE_UNDO_PATTERNS = [
  "이전으로", "되돌리기", "이전 단계", "뒤로", "한 단계 전", "되돌려",
  "방금 단계로", "그 전으로", "전 단계", "이전 후보", "그 전 후보로",
  "⟵ 이전 단계",
]

/** Filter-specific undo patterns — "{value} 선택전으로", "{value} 전으로" */
const FILTER_UNDO_PATTERNS = [
  /(.+?)\s*선택\s*전으로/,        // "Square 선택전으로", "Square 선택 전으로"
  /(.+?)\s*선택\s*전/,            // "Square 선택 전"
  /(.+?)\s*전으로/,               // "Square 전으로"
  /(.+?)\s*적용\s*전으로/,        // "Square 적용전으로"
  /(.+?)\s*고르기\s*전으로/,      // "Square 고르기 전으로"
  /(.+?)\s*고르기\s*전/,
]

function classifyUndoIntent(
  clean: string,
  sessionState: ExplorationSessionState | null
): { intent: UserIntent; confidence: "high" | "medium" | "low" } | null {
  // Must be in an active session with filters to undo
  if (!sessionState?.appliedFilters || sessionState.appliedFilters.length === 0) {
    return null
  }

  // Don't capture reset signals
  if (["처음부터"].some(s => clean.includes(s))) {
    return null
  }

  // Check filter-specific undo first (more specific pattern)
  for (const pattern of FILTER_UNDO_PATTERNS) {
    const match = clean.match(pattern)
    if (match) {
      return { intent: "narrowing_answer", confidence: "high" }
    }
  }

  // Check simple undo
  if (SIMPLE_UNDO_PATTERNS.some(s => clean.includes(s))) {
    return { intent: "narrowing_answer", confidence: "high" }
  }

  return null
}

/**
 * Resolve undo target from user message against session state.
 * Returns UndoTarget with the specific filter/stage to revert to.
 */
export function resolveUndoTarget(
  message: string,
  sessionState: ExplorationSessionState
): { type: "one_step" | "to_filter"; target: UndoTarget } | null {
  const clean = message.trim().toLowerCase()

  // Don't process reset signals
  if (["처음부터"].some(s => clean.includes(s))) return null
  if (!sessionState.appliedFilters || sessionState.appliedFilters.length === 0) return null

  // Check filter-specific undo first
  for (const pattern of FILTER_UNDO_PATTERNS) {
    const match = clean.match(pattern)
    if (match) {
      const targetValue = match[1].trim()
      // Search applied filters for this value
      const found = findFilterByValue(targetValue, sessionState)
      if (found) {
        return {
          type: "to_filter",
          target: {
            filterField: found.field,
            filterValue: found.value,
            targetStepIndex: found.appliedAt,
          },
        }
      }
      // Also search stage history
      if (sessionState.stageHistory) {
        const stage = sessionState.stageHistory.find(s =>
          s.filterApplied?.value.toLowerCase().includes(targetValue) ||
          s.filterApplied?.rawValue?.toString().toLowerCase().includes(targetValue) ||
          s.stageName.toLowerCase().includes(targetValue)
        )
        if (stage) {
          return {
            type: "to_filter",
            target: {
              filterField: stage.filterApplied?.field,
              filterValue: stage.filterApplied?.value,
              targetStepIndex: stage.stepIndex,
            },
          }
        }
      }
    }
  }

  // Check simple undo
  if (SIMPLE_UNDO_PATTERNS.some(s => clean.includes(s))) {
    return { type: "one_step", target: {} }
  }

  return null
}

function findFilterByValue(
  targetValue: string,
  sessionState: ExplorationSessionState
): AppliedFilter | null {
  const lower = targetValue.toLowerCase()
  // Exact match first
  for (const f of sessionState.appliedFilters) {
    if (f.value.toLowerCase() === lower || f.rawValue.toString().toLowerCase() === lower) {
      return f
    }
  }
  // Partial match
  for (const f of sessionState.appliedFilters) {
    if (f.value.toLowerCase().includes(lower) || f.rawValue.toString().toLowerCase().includes(lower)) {
      return f
    }
  }
  return null
}

// ════════════════════════════════════════════════════════════════
// 2. SLOT EXTRACTOR
// ════════════════════════════════════════════════════════════════

export function extractSlots(
  form: ProductIntakeForm,
  message: string | null,
  sessionState: ExplorationSessionState | null
): ExtractedSlot[] {
  const slots: ExtractedSlot[] = []

  // Extract from intake form
  extractFormSlot(form.material, "material", slots)
  extractFormSlot(form.operationType, "operationType", slots)
  extractFormSlot(form.diameterInfo, "diameterMm", slots)
  extractFormSlot(form.toolTypeOrCurrentProduct, "toolType", slots)

  if (form.machiningIntent.status === "known") {
    const intentMap: Record<MachiningIntent, string> = { roughing: "황삭", semi: "중삭", finishing: "정삭" }
    const v = (form.machiningIntent as { status: "known"; value: MachiningIntent }).value
    slots.push({ field: "machiningIntent", value: intentMap[v], confidence: "high", source: "intake" })
  }

  // Extract from session filters
  if (sessionState?.appliedFilters) {
    for (const f of sessionState.appliedFilters) {
      if (f.op === "skip") continue
      slots.push({ field: f.field, value: f.rawValue, confidence: "high", source: "chat" })
    }
  }

  // Extract from current message (deterministic patterns)
  if (message) {
    const msgSlots = extractMessageSlots(message)
    for (const s of msgSlots) {
      // Don't duplicate already-known slots
      if (!slots.find(existing => existing.field === s.field)) {
        slots.push(s)
      }
    }
  }

  return slots
}

function extractFormSlot(state: AnswerState<unknown>, field: string, slots: ExtractedSlot[]): void {
  if (state.status === "known") {
    slots.push({
      field,
      value: (state as { status: "known"; value: string | number }).value,
      confidence: "high",
      source: "intake",
    })
  }
}

function extractMessageSlots(message: string): ExtractedSlot[] {
  const slots: ExtractedSlot[] = []
  const clean = message.trim().toLowerCase()

  // Flute count
  const fluteMatch = clean.match(/(\d+)\s*날/)
  if (fluteMatch) {
    slots.push({ field: "fluteCount", value: parseInt(fluteMatch[1]), confidence: "high", source: "chat" })
  }

  // Diameter
  const diamMatch = clean.match(/([\d.]+)\s*mm/)
  if (diamMatch) {
    slots.push({ field: "diameterMm", value: parseFloat(diamMatch[1]), confidence: "high", source: "chat" })
  }

  // Coating
  const coatingKeywords: Record<string, string> = {
    "altin": "AlTiN", "tialn": "TiAlN", "dlc": "DLC",
    "무코팅": "Uncoated", "y-코팅": "Y-Coating", "y코팅": "Y-Coating", "ticn": "TiCN",
  }
  for (const [key, val] of Object.entries(coatingKeywords)) {
    if (clean.includes(key)) {
      slots.push({ field: "coating", value: val, confidence: "high", source: "chat" })
      break
    }
  }

  // Series name
  const seriesPatterns = [/^(ce\d+[a-z]*\d*)/i, /^(gnx\d+)/i, /^(sem[a-z]*\d+)/i, /^(e\d+[a-z]\d+)/i]
  for (const p of seriesPatterns) {
    const m = clean.match(p)
    if (m) {
      slots.push({ field: "seriesName", value: m[1].toUpperCase(), confidence: "medium", source: "chat" })
      break
    }
  }

  return slots
}

// ════════════════════════════════════════════════════════════════
// 3. COMPLETENESS CHECKER
// ════════════════════════════════════════════════════════════════

const REQUIRED_SLOTS = ["material", "operationType", "diameterMm", "toolType"]
const OPTIONAL_SLOTS = ["fluteCount", "coating", "machiningIntent", "seriesName", "toolSubtype"]

export function checkCompleteness(slots: ExtractedSlot[], form: ProductIntakeForm): CompletenessCheck {
  const answeredSlots: string[] = []
  const missingSlots: string[] = []
  const unknownSlots: string[] = []

  const slotFields = new Set(slots.map(s => s.field))

  for (const field of REQUIRED_SLOTS) {
    if (slotFields.has(field)) {
      answeredSlots.push(field)
    } else {
      // Check if user explicitly said "모름" in intake
      const formField = getFormFieldBySlotName(form, field)
      if (formField?.status === "unknown") {
        unknownSlots.push(field)
      } else {
        missingSlots.push(field)
      }
    }
  }

  for (const field of OPTIONAL_SLOTS) {
    if (slotFields.has(field)) {
      answeredSlots.push(field)
    }
  }

  const totalFields = REQUIRED_SLOTS.length + OPTIONAL_SLOTS.length
  const completionPct = Math.round(((answeredSlots.length + unknownSlots.length) / totalFields) * 100)

  return {
    isComplete: missingSlots.length === 0,
    answeredSlots,
    missingSlots,
    unknownSlots,
    completionPct,
  }
}

function getFormFieldBySlotName(form: ProductIntakeForm, slot: string): AnswerState<unknown> | null {
  switch (slot) {
    case "material": return form.material
    case "operationType": return form.operationType
    case "diameterMm": return form.diameterInfo
    case "toolType": return form.toolTypeOrCurrentProduct
    default: return null
  }
}

// ════════════════════════════════════════════════════════════════
// 4. ROUTE PLANNER
// ════════════════════════════════════════════════════════════════

export function planRoute(
  intent: UserIntent,
  intentConfidence: "high" | "medium" | "low",
  completeness: CompletenessCheck,
  sessionState: ExplorationSessionState | null,
  message: string | null,
  candidateCount: number
): RoutePlan {
  const riskFlags: string[] = []

  // Risk assessment
  if (candidateCount === 0) riskFlags.push("no_candidates")
  if (candidateCount <= 2) riskFlags.push("low_candidates")
  if (!completeness.isComplete) riskFlags.push("incomplete_input")
  if (completeness.unknownSlots.length >= 3) riskFlags.push("many_unknowns")

  // Navigation commands — resolve BEFORE any other classification
  if (message && sessionState) {
    const clean = message.trim().toLowerCase()

    // Reset signal
    if (["처음부터 다시", "다시 시작", "리셋"].some(s => clean.includes(s))) {
      return { action: "reset_session", reason: "사용자가 초기화를 요청했습니다", needsLLM: false, riskFlags }
    }

    // Undo signals — resolve target from message + session state
    const undoResolution = resolveUndoTarget(message, sessionState)
    if (undoResolution) {
      if (undoResolution.type === "to_filter") {
        const val = undoResolution.target.filterValue ?? "?"
        return {
          action: "undo_to_filter",
          reason: `"${val}" 선택 전 단계로 되돌리기 요청`,
          needsLLM: false,
          riskFlags,
          undoTarget: undoResolution.target,
        }
      }
      return { action: "undo_narrowing", reason: "사용자가 이전 단계로 되돌리기를 요청했습니다", needsLLM: false, riskFlags }
    }
  } else if (message) {
    const clean = message.trim().toLowerCase()
    if (["처음부터 다시", "다시 시작", "리셋"].some(s => clean.includes(s))) {
      return { action: "reset_session", reason: "사용자가 초기화를 요청했습니다", needsLLM: false, riskFlags }
    }
  }

  // Explicit completion request
  if (intent === "product_recommendation" && message &&
    ["추천해주세요", "바로 보여주세요", "결과 보기"].some(s => message.toLowerCase().includes(s))) {
    return { action: "skip_to_result", reason: "사용자가 즉시 추천을 요청했습니다", needsLLM: true, riskFlags }
  }

  // First call (no message, no session state)
  if (!message && !sessionState) {
    return {
      action: "start_exploration",
      reason: "초기 조건 입력 완료, 탐색 시작",
      needsLLM: true,
      riskFlags,
    }
  }

  // Post-recommendation refinement
  if (intent === "refinement" && sessionState?.resolutionStatus?.startsWith("resolved")) {
    return {
      action: "handle_refinement",
      reason: "추천 후 추가 조건 변경 요청",
      needsLLM: true,
      riskFlags,
    }
  }

  // Check if resolved
  if (sessionState) {
    const status = sessionState.resolutionStatus
    if (status?.startsWith("resolved") && sessionState.turnCount > 0) {
      return {
        action: "show_recommendation",
        reason: `후보 축소 완료 (${status})`,
        needsLLM: true,
        riskFlags,
      }
    }
  }

  // Narrowing answer
  if (intent === "narrowing_answer" || intent === "product_recommendation") {
    return {
      action: "continue_narrowing",
      reason: "사용자 응답 처리 후 다음 질문 또는 추천 진행",
      needsLLM: true,
      riskFlags,
    }
  }

  // Default: continue narrowing
  return {
    action: "continue_narrowing",
    reason: "기본 흐름: 축소 대화 계속",
    needsLLM: true,
    riskFlags,
  }
}

// ════════════════════════════════════════════════════════════════
// 5. SESSION CONTEXT BUILDER
// ════════════════════════════════════════════════════════════════

export function buildSessionContext(
  form: ProductIntakeForm,
  resolvedInput: RecommendationInput,
  sessionState: ExplorationSessionState | null,
  lastUserMessage: string | null
): SessionContext {
  return {
    intakeForm: form,
    resolvedInput,
    sessionState,
    lastUserMessage,
    turnCount: sessionState?.turnCount ?? 0,
  }
}

// ════════════════════════════════════════════════════════════════
// MAIN ENTRY: Prepare Request
// ════════════════════════════════════════════════════════════════

export function prepareRequest(
  form: ProductIntakeForm,
  messages: ChatMessage[],
  sessionState: ExplorationSessionState | null,
  resolvedInput: RecommendationInput,
  candidateCount: number
): RequestPreparationResult {
  const lastUserMsg = messages.length > 0
    ? [...messages].reverse().find(m => m.role === "user")?.text ?? null
    : null

  // 1. Classify intent
  const { intent, confidence: intentConfidence } = classifyIntent(lastUserMsg, form, sessionState)

  // 2. Extract slots
  const slots = extractSlots(form, lastUserMsg, sessionState)

  // 3. Check completeness
  const completeness = checkCompleteness(slots, form)

  // 4. Plan route
  const route = planRoute(intent, intentConfidence, completeness, sessionState, lastUserMsg, candidateCount)

  // 5. Build session context
  const sessionContext = buildSessionContext(form, resolvedInput, sessionState, lastUserMsg)

  return {
    intent,
    intentConfidence,
    slots,
    completeness,
    route,
    sessionContext,
  }
}
