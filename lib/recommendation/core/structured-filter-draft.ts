import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { AppliedFilter, ExplorationSessionState } from "@/lib/recommendation/domain/types"
import type { QuerySpec, QuerySort } from "./query-spec"
import { naturalLanguageToQuerySpec } from "./query-planner"
import { appliedFiltersToConstraints, querySpecToAppliedFilters } from "./query-spec-to-filters"
import { hasEditSignal } from "./edit-intent"
import { shouldDeferHardcodedSemanticExecution } from "./semantic-execution-policy"
import { needsRepair } from "./turn-repair"
import { getFilterFieldDefinition, getFilterFieldLabel } from "@/lib/recommendation/shared/filter-field-registry"

export type StructuredFilterDraftMode = "new" | "refine" | "repair"

export interface StructuredFilterDraftFilter {
  field: string
  op: string
  value: string
  rawValue: AppliedFilter["rawValue"]
  rawValue2?: AppliedFilter["rawValue2"]
}

export interface StructuredFilterDraft {
  mode: StructuredFilterDraftMode
  intent: QuerySpec["intent"]
  filters: StructuredFilterDraftFilter[]
  sort: QuerySort | null
  confidence: number
  needsClarification: boolean
  clarificationQuestion: string | null
}

export interface StructuredFilterDraftValidation {
  isValid: boolean
  errors: string[]
}

interface BuildStructuredFilterDraftArgs {
  userMessage: string
  sessionState: ExplorationSessionState | null
  spec: QuerySpec
}

interface InterpretStructuredFilterDraftArgs {
  userMessage: string
  sessionState: ExplorationSessionState | null
  provider: LLMProvider
}

const EXPLICIT_NEW_REQUEST_RE = /(?:처음부터|초기화|리셋|새(?:로|로운)?\s*(?:작업|추천|검색|조건)|다른\s*작업|start\s*over|reset)/iu
const NEGATION_RE = /(?:말고|빼고|제외|아니(?:고|ㄴ)?|아닌\s*걸로|없는\s*걸로)/iu
const REPAIR_ONLY_RE = /(?:그거|그건|방금|아니(?:야|고)?|다시|잘못|틀렸|오해)/iu

function hasDurableSessionTruth(state: ExplorationSessionState | null): boolean {
  if (!state) return false
  return Boolean(
    (state.appliedFilters?.length ?? 0) > 0
    || (state.displayedProducts?.length ?? 0) > 0
    || (state.displayedSeriesGroups?.length ?? 0) > 0
    || (state.displayedOptions?.length ?? 0) > 0
    || (state.displayedCandidates?.length ?? 0) > 0
    || (state.lastRecommendationArtifact?.length ?? 0) > 0
    || state.lastComparisonArtifact
    || (state.uiNarrowingPath?.length ?? 0) > 0
    || (state.turnCount ?? 0) > 0
  )
}

function inferMode(userMessage: string, sessionState: ExplorationSessionState | null, spec: QuerySpec): StructuredFilterDraftMode {
  if (spec.navigation === "reset" || EXPLICIT_NEW_REQUEST_RE.test(userMessage)) {
    return "new"
  }

  const hasConcreteConstraints = spec.constraints.length > 0
  if ((needsRepair(userMessage) || hasEditSignal(userMessage)) && (!hasConcreteConstraints || REPAIR_ONLY_RE.test(userMessage))) {
    return "repair"
  }

  return hasDurableSessionTruth(sessionState) ? "refine" : "new"
}

function toDraftFilters(filters: AppliedFilter[]): StructuredFilterDraftFilter[] {
  return filters.map(filter => ({
    field: filter.field,
    op: filter.op,
    value: filter.value,
    rawValue: filter.rawValue,
    rawValue2: filter.rawValue2,
  }))
}

function formatDraftValue(rawValue: AppliedFilter["rawValue"], rawValue2?: AppliedFilter["rawValue2"]): string {
  if (Array.isArray(rawValue)) {
    return rawValue.map(item => String(item)).join("/")
  }
  if (rawValue2 != null) {
    return `${String(rawValue)}~${String(rawValue2)}`
  }
  if (typeof rawValue === "boolean") {
    return rawValue ? "yes" : "no"
  }
  return String(rawValue ?? "").trim()
}

function summarizeActiveFilters(filters: AppliedFilter[]): string {
  return [...filters]
    .sort((left, right) => (right.appliedAt ?? 0) - (left.appliedAt ?? 0))
    .slice(0, 3)
    .map(filter => `${getFilterFieldLabel(filter.field)}=${formatDraftValue(filter.rawValue, filter.rawValue2)}`)
    .filter(Boolean)
    .join(", ")
}

function firstComparableValue(rawValue: AppliedFilter["rawValue"] | string | undefined): string | null {
  if (Array.isArray(rawValue)) return rawValue.length > 0 ? String(rawValue[0]).trim().toLowerCase() : null
  if (rawValue == null) return null
  return String(rawValue).trim().toLowerCase()
}

function extractActiveToolFamily(sessionState: ExplorationSessionState | null): string | null {
  if (!sessionState) return null

  const activeFilter = sessionState.appliedFilters.find(filter =>
    filter.field === "machiningCategory" || filter.field === "toolType"
  )
  if (activeFilter) {
    return firstComparableValue(activeFilter.rawValue)
  }

  return firstComparableValue(
    sessionState.resolvedInput?.machiningCategory
    ?? sessionState.resolvedInput?.toolType
    ?? undefined
  )
}

function extractRequestedToolFamily(filters: AppliedFilter[]): string | null {
  const requested = filters.find(filter =>
    filter.field === "machiningCategory" || filter.field === "toolType"
  )
  return requested ? firstComparableValue(requested.rawValue) : null
}

export function validateStructuredFilterDraft(
  draft: Pick<StructuredFilterDraft, "mode" | "intent" | "filters">,
  args: { userMessage: string; sessionState: ExplorationSessionState | null },
): StructuredFilterDraftValidation {
  const errors: string[] = []

  for (const filter of draft.filters) {
    const definition = getFilterFieldDefinition(filter.field)
    if (!definition) {
      errors.push(`unknown_field:${filter.field}`)
      continue
    }

    const isRangeOp = filter.op === "gte" || filter.op === "lte" || filter.op === "between"
    if (isRangeOp && definition.kind !== "number") {
      errors.push(`range_op_requires_number:${filter.field}`)
      continue
    }

    if ((filter.op === "gte" || filter.op === "lte") && typeof filter.rawValue !== "number") {
      errors.push(`range_bound_requires_number:${filter.field}`)
    }

    if (filter.op === "between") {
      if (typeof filter.rawValue !== "number" || typeof filter.rawValue2 !== "number") {
        errors.push(`between_requires_numeric_bounds:${filter.field}`)
      }
    }
  }

  const existingToolFamily = extractActiveToolFamily(args.sessionState)
  const requestedToolFamily = extractRequestedToolFamily(
    draft.filters.map(filter => ({
      field: filter.field,
      op: filter.op,
      value: filter.value,
      rawValue: filter.rawValue,
      rawValue2: filter.rawValue2,
      appliedAt: 0,
    }))
  )

  if (
    existingToolFamily
    && requestedToolFamily
    && existingToolFamily !== requestedToolFamily
    && draft.mode !== "new"
  ) {
    errors.push(`domain_lock:${existingToolFamily}->${requestedToolFamily}`)
  }

  if (draft.mode === "repair" && draft.intent === "narrow" && draft.filters.length === 0) {
    errors.push("repair_target_ambiguous")
  }

  if (NEGATION_RE.test(args.userMessage) && draft.intent === "narrow" && draft.filters.length === 0) {
    errors.push("negation_target_ambiguous")
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}

function buildClarificationQuestion(
  validation: StructuredFilterDraftValidation,
  userMessage: string,
  sessionState: ExplorationSessionState | null,
): string {
  const activeSummary = summarizeActiveFilters(sessionState?.appliedFilters ?? [])

  if (validation.errors.some(error => error.startsWith("domain_lock:"))) {
    return "현재 세션은 기존 후보군 기준으로 이어지고 있습니다. 이번 요청을 새 작업으로 볼지, 기존 조건을 수정할지 알려주세요. 예: \"새 작업으로\", \"기존 조건 수정\", \"직접 입력\"."
  }

  if (validation.errors.includes("repair_target_ambiguous")) {
    return activeSummary
      ? `지금은 ${activeSummary} 로 이해돼 있습니다. 어떤 조건이 잘못 반영됐는지 한 번만 더 지정해 주세요. 예: "코팅은 TiAlN 제외", "직경 10mm로 변경", "직접 입력".`
      : "방금 해석 중 잘못된 부분을 고치려는 요청으로 이해했습니다. 바꾸려는 필드와 값을 한 번만 더 알려주세요. 예: \"형상 Ball 말고\", \"직경 10mm로 변경\", \"직접 입력\"."
  }

  if (validation.errors.includes("negation_target_ambiguous")) {
    return "무엇을 제외하려는지 필드와 값을 같이 알려주세요. 예: \"코팅은 TiAlN 제외\", \"형상은 Ball 말고\", \"직접 입력\"."
  }

  const rangeError = validation.errors.find(error =>
    error.startsWith("range_op_requires_number:")
    || error.startsWith("range_bound_requires_number:")
    || error.startsWith("between_requires_numeric_bounds:")
  )
  if (rangeError) {
    const field = rangeError.split(":")[1] ?? ""
    const label = getFilterFieldLabel(field)
    return `${label} 조건은 숫자 범위로만 해석할 수 있습니다. 값을 숫자로 다시 알려주세요. 예: "${label} 10 이상", "${label} 5~8", "직접 입력".`
  }

  const unknownField = validation.errors.find(error => error.startsWith("unknown_field:"))
  if (unknownField) {
    return `현재 문장에서 안전하게 매핑되지 않는 조건이 있습니다. 지금 이해한 요청은 "${userMessage.trim()}" 입니다. 바꾸려는 필드와 값을 조금만 더 구체적으로 말씀해 주세요. 예: "브랜드는 YG-1", "코팅은 AlTiN", "직접 입력".`
  }

  return activeSummary
    ? `현재는 ${activeSummary} 상태를 유지한 채 요청을 해석하고 있습니다. 맞다면 계속 진행하고, 아니라면 바꿀 필드와 값을 직접 알려주세요. 예: "코팅만 변경", "직접 입력".`
    : "현재 해석이 불충분합니다. 원하는 필드와 값을 한 번만 더 구체적으로 알려주세요. 예: \"형상 Square\", \"직경 10mm\", \"직접 입력\"."
}

export function buildStructuredDraftClarificationOptions(
  draft: Pick<StructuredFilterDraft, "mode" | "needsClarification" | "clarificationQuestion">,
  sessionState: ExplorationSessionState | null,
): string[] {
  if (!draft.needsClarification) return []

  const question = draft.clarificationQuestion ?? ""

  if (question.includes("새 작업")) {
    return ["새 작업으로", "기존 조건 수정", "직접 입력"]
  }

  if (draft.mode === "repair") {
    const recentRepairOptions = [...(sessionState?.appliedFilters ?? [])]
      .sort((left, right) => (right.appliedAt ?? 0) - (left.appliedAt ?? 0))
      .slice(0, 2)
      .map(filter => `${formatDraftValue(filter.rawValue, filter.rawValue2)} 말고`)
      .filter(Boolean)
    return Array.from(new Set([...recentRepairOptions, "직접 입력"])).slice(0, 4)
  }

  if (question.includes("숫자")) {
    return ["범위로 다시 입력", "기존 조건 수정", "직접 입력"]
  }

  return ["기존 조건 수정", "조건 다시 설명", "직접 입력"]
}

function computeConfidence(
  mode: StructuredFilterDraftMode,
  spec: QuerySpec,
  filters: StructuredFilterDraftFilter[],
  needsClarification: boolean,
): number {
  let confidence = 0.6

  if (filters.length > 0) {
    confidence = 0.9
  } else if (spec.intent === "question" || spec.intent === "comparison" || spec.intent === "general_chat") {
    confidence = 0.8
  }

  if (mode === "repair") confidence -= 0.1
  if (shouldDeferHardcodedSemanticExecution(spec.reasoning ?? "")) confidence -= 0.05
  if (needsClarification) confidence = Math.min(confidence, 0.45)

  return Math.max(0, Math.min(0.99, Number(confidence.toFixed(2))))
}

export function buildStructuredFilterDraft(args: BuildStructuredFilterDraftArgs): StructuredFilterDraft {
  const mode = inferMode(args.userMessage, args.sessionState, args.spec)
  const nextTurn = (args.sessionState?.turnCount ?? 0) + 1
  const normalizedFilters = toDraftFilters(querySpecToAppliedFilters(args.spec, nextTurn))
  const validation = validateStructuredFilterDraft(
    {
      mode,
      intent: args.spec.intent,
      filters: normalizedFilters,
    },
    {
      userMessage: args.userMessage,
      sessionState: args.sessionState,
    },
  )

  const needsClarification = !validation.isValid
  const clarificationQuestion = needsClarification
    ? buildClarificationQuestion(validation, args.userMessage, args.sessionState)
    : null

  return {
    mode,
    intent: args.spec.intent,
    filters: normalizedFilters,
    sort: args.spec.sort ?? null,
    confidence: computeConfidence(mode, args.spec, normalizedFilters, needsClarification),
    needsClarification,
    clarificationQuestion,
  }
}

export async function interpretStructuredFilterDraft(
  args: InterpretStructuredFilterDraftArgs,
): Promise<StructuredFilterDraft> {
  const currentConstraints = appliedFiltersToConstraints(args.sessionState?.appliedFilters ?? [])
  const plannerResult = await naturalLanguageToQuerySpec(
    args.userMessage,
    currentConstraints,
    args.provider,
  )

  return buildStructuredFilterDraft({
    userMessage: args.userMessage,
    sessionState: args.sessionState,
    spec: plannerResult.spec,
  })
}
