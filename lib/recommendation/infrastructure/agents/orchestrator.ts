/**
 * Orchestrator Agent — Sonnet
 *
 * Controls the overall turn flow for the recommendation state machine.
 * Decides which agents to invoke and in what order.
 *
 * Flow per turn:
 *   1. Intent Classifier (Haiku)
 *   2. Parameter Extractor (Haiku) — if needed
 *   3. Ambiguity Resolver (Opus) — only if confidence < threshold or vague references
 *   4. Route decision based on classified intent
 *   5. Execute action (filter, undo, compare, etc.)
 *   6. Response Composer (Sonnet) — generate final response
 */

import type {
  LLMProvider,
  LLMTool,
  LLMToolResult,
} from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import { resolveModel } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type {
  AppliedFilter,
  CandidateSnapshot,
  DisplayedOption,
  EvidenceSummary,
  ExplorationSessionState,
  ProductIntakeForm,
  RecommendationInput,
  ScoredProduct,
} from "@/lib/recommendation/domain/types"
import type {
  TurnContext,
  OrchestratorResult,
  OrchestratorAction,
  NarrowingIntent,
  IntentClassification,
  ExtractedParameters,
} from "./types"

import { classifyIntent } from "./intent-classifier"
import { extractParameters } from "./parameter-extractor"
import { performUnifiedJudgment } from "@/lib/recommendation/domain/context/unified-haiku-judgment"
import { needsOpusResolution, resolveAmbiguity } from "./ambiguity-resolver"
import { resolveProductReferences } from "./comparison-agent"
import { parseAnswerToFilter } from "@/lib/recommendation/domain/question-engine"
import { ENABLE_OPUS_AMBIGUITY, ENABLE_COMPARISON_AGENT } from "@/lib/recommendation/infrastructure/config/recommendation-agent-flags"
import { LLM_FREE_INTERPRETATION } from "@/lib/feature-flags"
import { buildDomainKnowledgeSnippet, buildCandidateDistributionSnippet } from "@/lib/recommendation/shared/patterns"
import { extractFilterFieldValueMap } from "@/lib/recommendation/shared/filter-field-registry"
import { classifySessionAction, detectFilterIntent } from "@/lib/recommendation/domain/session-action-classifier"
import { buildAppliedFilterFromValue } from "@/lib/recommendation/shared/filter-field-registry"

const UNIFIED_JUDGMENT_MODEL = resolveModel("opus", "unified-judgment")
const INTENT_CLASSIFIER_MODEL = resolveModel("sonnet", "intent-classifier")
const PARAMETER_EXTRACTOR_MODEL = resolveModel("haiku", "parameter-extractor")
const AMBIGUITY_RESOLVER_MODEL = resolveModel("opus", "ambiguity-resolver")
const TOOL_USE_ROUTER_MODEL = resolveModel("sonnet", "tool-use-router")

// ════════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR
// ════════════════════════════════════════════════════════════════

export async function orchestrateTurn(
  ctx: TurnContext,
  provider: LLMProvider
): Promise<OrchestratorResult> {
  const agents: OrchestratorResult["agentsInvoked"] = []
  const startMs = Date.now()

  // ═══ Step 1: Unified Haiku Judgment → Intent (기존 classifyIntent regex 대체) ═══
  const intentStart = Date.now()
  const judgment = await performUnifiedJudgment({
    userMessage: ctx.userMessage,
    assistantText: null,
    pendingField: ctx.sessionState?.lastAskedField ?? null,
    currentMode: ctx.sessionState?.currentMode ?? null,
    displayedChips: ctx.sessionState?.displayedChips ?? [],
    filterCount: ctx.sessionState?.appliedFilters?.length ?? 0,
    candidateCount: ctx.sessionState?.candidateCount ?? 0,
    hasRecommendation: ctx.sessionState?.resolutionStatus?.startsWith("resolved") ?? false,
  }, provider)

  // 통합 판단 → NarrowingIntent 매핑
  const intentResult: IntentClassification = judgment.fromLLM
    ? mapJudgmentToIntent(judgment, ctx)
    : await classifyIntent(ctx.userMessage, ctx.sessionState, provider)
  agents.push({
    agent: judgment.fromLLM ? "unified-judgment" : "intent-classifier",
    model: judgment.fromLLM ? UNIFIED_JUDGMENT_MODEL : INTENT_CLASSIFIER_MODEL,
    durationMs: Date.now() - intentStart,
  })

  console.log(`[orchestrator] Intent: ${intentResult.intent} (${intentResult.confidence.toFixed(2)}) via=${judgment.fromLLM ? "unified" : "legacy"}${intentResult.extractedValue ? ` value="${intentResult.extractedValue}"` : ""}`)

  // ═══ Step 2: Ambiguity Check → Opus Escalation ═══
  let finalIntent = intentResult.intent
  let finalValue = intentResult.extractedValue
  let escalatedToOpus = false
  let escalationReason: string | undefined

  if (ENABLE_OPUS_AMBIGUITY && needsOpusResolution(ctx.userMessage, intentResult.confidence, ctx.sessionState) && ctx.sessionState) {
    escalatedToOpus = true
    escalationReason = intentResult.confidence < 0.5
      ? `low_confidence (${intentResult.confidence.toFixed(2)})`
      : "vague_reference_pattern"

    console.log(`[orchestrator] Escalating to Opus: ${escalationReason}`)

    const opusStart = Date.now()
    const opusResult = await resolveAmbiguity(
      ctx.userMessage,
      ctx.sessionState,
      ctx.displayedProducts,
      provider
    )
    agents.push({ agent: "ambiguity-resolver", model: AMBIGUITY_RESOLVER_MODEL, durationMs: Date.now() - opusStart })

    if (opusResult.confidence > intentResult.confidence) {
      finalIntent = opusResult.resolvedIntent
      finalValue = opusResult.resolvedValue
      console.log(`[orchestrator] Opus override: ${finalIntent} (${opusResult.confidence.toFixed(2)}) — ${opusResult.explanation}`)
    }
  }

  // ═══ Step 3: Parameter Extraction (Haiku) — for SET_PARAMETER/SELECT_OPTION ═══
  let extractedParams: ExtractedParameters | null = null
  if (finalIntent === "SET_PARAMETER" || finalIntent === "SELECT_OPTION") {
    const paramStart = Date.now()
    extractedParams = await extractParameters(ctx.userMessage, ctx.sessionState, provider)
    agents.push({ agent: "parameter-extractor", model: PARAMETER_EXTRACTOR_MODEL, durationMs: Date.now() - paramStart })

    console.log(`[orchestrator] Extracted: ${JSON.stringify(extractedParams)}`)
  }

  // ═══ Step 3.5: Session Action Classifier — stabilize filter replace/remove/in-session routing ═══
  if (ctx.sessionState && ctx.sessionState.appliedFilters?.length > 0) {
    const sessionAction = classifySessionAction(
      ctx.userMessage,
      ctx.sessionState.appliedFilters.map(f => ({ field: f.field, value: f.value, op: f.op })),
      (ctx.sessionState.displayedCandidates?.length ?? 0) > 0,
      !!ctx.sessionState.lastAskedField,
      ctx.sessionState.lastAskedField ?? null,
    )
    console.log(`[orchestrator:session-action] ${sessionAction.action} (${sessionAction.confidence.toFixed(2)}) — ${sessionAction.reasoning}`)

    // Override intent when session classifier has high-confidence filter operations
    if (sessionAction.confidence >= 0.7) {
      if (sessionAction.action === "replace_filter" && sessionAction.targetField) {
        // Detected explicit filter replacement — route to replace_existing_filter
        const filterIntent = detectFilterIntent(ctx.userMessage, ctx.sessionState.appliedFilters.map(f => ({ field: f.field, value: f.value, op: f.op })))
        if (filterIntent.field && filterIntent.value) {
          const existingFilter = ctx.sessionState.appliedFilters.find(f => f.field === filterIntent.field)
          if (existingFilter) {
            finalIntent = "SET_PARAMETER"
            finalValue = filterIntent.value
            if (!extractedParams) {
              const paramStart = Date.now()
              extractedParams = await extractParameters(ctx.userMessage, ctx.sessionState, provider)
              agents.push({ agent: "parameter-extractor", model: "haiku", durationMs: Date.now() - paramStart })
            }
            console.log(`[orchestrator:session-action] Overriding to replace_existing_filter: ${filterIntent.field} ${existingFilter.value} → ${filterIntent.value}`)
          }
        }
      } else if (sessionAction.action === "remove_filter" && sessionAction.targetField) {
        // Route to undo the specific filter
        finalIntent = "GO_BACK_TO_SPECIFIC_STAGE"
        finalValue = sessionAction.targetField
        console.log(`[orchestrator:session-action] Overriding to remove filter on: ${sessionAction.targetField}`)
      } else if (sessionAction.action === "summarize_state") {
        finalIntent = "ASK_EXPLANATION"
        finalValue = "__confirm_scope__"
        console.log(`[orchestrator:session-action] Overriding to scope summary`)
      } else if (
        (sessionAction.action === "query_current_results" || sessionAction.action === "ask_in_context") &&
        (finalIntent === "START_NEW_TOPIC" || finalIntent === "OUT_OF_SCOPE")
      ) {
        // Prevent dropping out of session for in-context follow-ups
        finalIntent = "ASK_EXPLANATION"
        console.log(`[orchestrator:session-action] Prevented session drop — keeping as in-session follow-up`)
      }
    }
  }

  // ═══ Step 4: Route to Action ═══
  const action = routeToAction(finalIntent, finalValue, extractedParams, ctx)

  const result: OrchestratorResult = {
    action,
    reasoning: `${finalIntent} → ${action.type}`,
    agentsInvoked: agents,
    escalatedToOpus,
    escalationReason,
  }

  // Debug summary
  const totalMs = Date.now() - startMs
  console.log(`[orchestrator] ═══ Turn Summary ═══`)
  console.log(`[orchestrator] Action: ${action.type}`)
  console.log(`[orchestrator] Agents: ${agents.map(a => `${a.agent}(${a.model}:${a.durationMs}ms)`).join(", ")}`)
  console.log(`[orchestrator] Opus: ${escalatedToOpus ? `YES (${escalationReason})` : "no"}`)
  console.log(`[orchestrator] Total: ${totalMs}ms`)
  console.log(`[orchestrator] ═══════════════════`)

  return result
}

// ════════════════════════════════════════════════════════════════
// UNIFIED JUDGMENT → INTENT MAPPING
// ════════════════════════════════════════════════════════════════

function mapJudgmentToIntent(
  judgment: Awaited<ReturnType<typeof performUnifiedJudgment>>,
  ctx: TurnContext
): IntentClassification {
  const actionMap: Record<string, NarrowingIntent> = {
    select_option: "SELECT_OPTION",
    ask_recommendation: "ASK_RECOMMENDATION",
    compare: "ASK_COMPARISON",
    explain: "ASK_EXPLANATION",
    reset_session: "RESET_SESSION",
    refine_condition: "REFINE_CONDITION",
    skip_field: "SELECT_OPTION", // skip은 SELECT_OPTION + skip value로 처리
    undo: "GO_BACK_ONE_STEP",
    off_topic: "OUT_OF_SCOPE",
    continue: "SELECT_OPTION",
  }

  const intent = actionMap[judgment.intentAction] ?? "START_NEW_TOPIC"

  // company_query/greeting → START_NEW_TOPIC (answer_general로 라우팅)
  if (judgment.domainRelevance === "company_query" || judgment.domainRelevance === "greeting") {
    return { intent: "START_NEW_TOPIC", confidence: judgment.confidence, extractedValue: ctx.userMessage, modelUsed: UNIFIED_JUDGMENT_MODEL }
  }

  // off_topic → OUT_OF_SCOPE
  if (judgment.domainRelevance === "off_topic") {
    return { intent: "OUT_OF_SCOPE", confidence: judgment.confidence, modelUsed: UNIFIED_JUDGMENT_MODEL }
  }

  // skip_field → extractedValue에 "skip" 세팅
  if (judgment.intentAction === "skip_field") {
    return { intent: "SELECT_OPTION", confidence: judgment.confidence, extractedValue: "skip", modelUsed: UNIFIED_JUDGMENT_MODEL }
  }

  return {
    intent,
    confidence: judgment.confidence,
    extractedValue: judgment.extractedAnswer ?? undefined,
    modelUsed: UNIFIED_JUDGMENT_MODEL,
  }
}

// ════════════════════════════════════════════════════════════════
// ACTION ROUTING
// ════════════════════════════════════════════════════════════════

function routeToAction(
  intent: NarrowingIntent,
  value: string | undefined,
  params: ExtractedParameters | null,
  ctx: TurnContext
): OrchestratorAction {
  switch (intent) {
    case "RESET_SESSION":
      return { type: "reset_session" }

    case "GO_BACK_ONE_STEP":
      return { type: "go_back_one_step" }

    case "GO_BACK_TO_SPECIFIC_STAGE":
      return {
        type: "go_back_to_filter",
        filterValue: value ?? "",
        filterField: findFilterField(value, ctx.sessionState),
      }

    case "ASK_RECOMMENDATION":
      return { type: "show_recommendation" }

    case "ASK_COMPARISON": {
      const targets = value?.split(",") ?? []
      return { type: "compare_products", targets }
    }

    case "ASK_EXPLANATION":
    case "ASK_REASON":
      return { type: "explain_product", target: value }

    case "SELECT_OPTION":
    case "SET_PARAMETER": {
      const displayedOption = resolveDisplayedOptionSelection(
        ctx,
        value,
        params?.rawValue,
        ctx.userMessage,
      )

      // "날수로 좁히기" chip → refine_condition with fluteCount
      if (displayedOption && displayedOption.label.includes("날수로 좁히기")) {
        return { type: "refine_condition", field: "fluteCount" }
      }

      const displayedFilter = displayedOption
        ? buildFilterFromDisplayedOption(displayedOption, ctx)
        : null
      if (displayedFilter) {
        if (displayedFilter.op === "skip") {
          return { type: "skip_field" }
        }
        return { type: "continue_narrowing", filter: displayedFilter }
      }

      // Try to build a filter from extracted params
      const filter = buildFilterFromParams(params, value, ctx)
      if (filter) {
        // Check if it's a skip
        if (filter.op === "skip") {
          return { type: "skip_field" }
        }
        return { type: "continue_narrowing", filter }
      }
      // Can't build filter — treat as general answer
      return { type: "answer_general", message: ctx.userMessage }
    }

    case "REFINE_CONDITION": {
      const fieldMap: Record<string, string> = {
        "날수": "fluteCount", "flute": "fluteCount", "flutecount": "fluteCount",
        "소재": "material", "재질": "material",
        "직경": "diameter", "코팅": "coating",
      }
      const rawField = (value || "material").toLowerCase()
      const resolvedField = fieldMap[rawField] ?? value ?? "material"
      return { type: "refine_condition", field: resolvedField }
    }

    case "START_NEW_TOPIC":
      return { type: "answer_general", message: ctx.userMessage }

    case "OUT_OF_SCOPE":
      return { type: "redirect_off_topic" }

    default:
      return { type: "answer_general", message: ctx.userMessage }
  }
}

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════

function findFilterField(
  value: string | undefined,
  sessionState: ExplorationSessionState | null
): string | undefined {
  if (!value || !sessionState) return undefined
  const lower = value.toLowerCase()
  for (const f of sessionState.appliedFilters) {
    if (f.value.toLowerCase().includes(lower) || f.rawValue.toString().toLowerCase().includes(lower)) {
      return f.field
    }
  }
  return undefined
}

function normalizeDisplayedOptionText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/u, "")
    .replace(/\s*[-—]\s*.+$/u, "")
    .replace(/\s+/g, " ")
    .trim()
}

function parseDisplayedOptionIndex(value: string): number | null {
  const match = value.trim().match(/^(\d+)\s*번/u)
  if (!match) return null

  const parsed = Number.parseInt(match[1], 10)
  return Number.isFinite(parsed) ? parsed : null
}

function buildFilterFromDisplayedOption(
  option: DisplayedOption,
  ctx: TurnContext
): AppliedFilter | null {
  if (option.field === "_action") return null

  const normalizedValue = normalizeDisplayedOptionText(option.value)
  const normalizedLabel = normalizeDisplayedOptionText(option.label)
  const isSkipOption = normalizedValue === "skip" || normalizedLabel === "상관없음"
  if (isSkipOption) {
    return {
      field: option.field,
      op: "skip",
      value: "상관없음",
      rawValue: "skip",
      appliedAt: ctx.sessionState?.turnCount ?? 0,
    }
  }

  const filter = parseAnswerToFilter(option.field, option.value)
  if (!filter) return null
  filter.appliedAt = ctx.sessionState?.turnCount ?? 0
  return filter
}

function resolveDisplayedOptionSelection(
  ctx: TurnContext,
  ...values: Array<string | null | undefined>
): DisplayedOption | null {
  const state = ctx.unifiedTurnContext?.sessionState ?? ctx.sessionState
  const displayedOptions = state?.displayedOptions ?? []
  if (displayedOptions.length === 0) return null

  const pendingField =
    ctx.unifiedTurnContext?.currentPendingQuestion?.field ??
    ctx.unifiedTurnContext?.latestProcessTrace?.pendingQuestionField ??
    state?.lastAskedField ??
    null

  const prioritizedOptions = pendingField
    ? [
        ...displayedOptions.filter(option => option.field === pendingField),
        ...displayedOptions.filter(option => option.field !== pendingField),
      ]
    : displayedOptions

  const seen = new Set<string>()
  const candidates = values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .filter(value => {
      const key = value.trim()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  for (const candidate of candidates) {
    const optionIndex = parseDisplayedOptionIndex(candidate)
    if (optionIndex === null) continue

    const indexedOption = prioritizedOptions.find(option => option.index === optionIndex)
    if (indexedOption) return indexedOption
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeDisplayedOptionText(candidate)
    if (!normalizedCandidate) continue

    const exactMatch = prioritizedOptions.find(option => {
      const normalizedLabel = normalizeDisplayedOptionText(option.label)
      const normalizedValue = normalizeDisplayedOptionText(option.value)
      return normalizedCandidate === normalizedLabel || normalizedCandidate === normalizedValue
    })
    if (exactMatch) return exactMatch
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeDisplayedOptionText(candidate)
    if (!normalizedCandidate) continue

    const prefixMatches = prioritizedOptions.filter(option => {
      const normalizedLabel = normalizeDisplayedOptionText(option.label)
      const normalizedValue = normalizeDisplayedOptionText(option.value)
      return normalizedLabel.startsWith(normalizedCandidate) || normalizedValue.startsWith(normalizedCandidate)
    })
    if (prefixMatches.length === 1) {
      return prefixMatches[0]
    }
  }

  return null
}

// ════════════════════════════════════════════════════════════════
// TOOL-USE ROUTING (alternative to regex intent classification)
// Claude chooses which tool to call = intent classification
// ════════════════════════════════════════════════════════════════

const NARROWING_TOOLS: LLMTool[] = [
  {
    name: "apply_filter",
    description: "사용자가 필터 조건을 선택했을 때 호출. 코팅, 날수, 공구 형상, 시리즈 등. '상관없음/모름/패스' 입력 시 value를 'skip'으로 설정.",
    input_schema: {
      type: "object",
      properties: {
        field: {
          type: "string",
          enum: [
            "fluteCount", "coating", "toolSubtype", "seriesName", "diameterMm", "diameterRefine", "cuttingType", "material",
            "toolMaterial", "toolType", "brand", "country",
            "shankDiameterMm", "lengthOfCutMm", "overallLengthMm", "helixAngleDeg", "ballRadiusMm", "taperAngleDeg",
            "coolantHole", "stockStatus", "applicationShapes", "materialTags"
          ],
          description: "필터 대상 필드. 한국어→필드명 매핑: 날수=fluteCount, 코팅=coating, 형상/서브타입=toolSubtype, 시리즈=seriesName, 직경=diameterMm, 직경세분화=diameterRefine, 가공방식=cuttingType, 소재/피삭재=material, 공구소재=toolMaterial, 공구타입=toolType, 브랜드=brand, 생산국=country, 생크직경=shankDiameterMm, 절삭길이/날길이/LOC=lengthOfCutMm, 전장/전체길이/OAL=overallLengthMm, 헬릭스각도=helixAngleDeg, 볼반경=ballRadiusMm, 테이퍼각도=taperAngleDeg, 쿨런트홀=coolantHole, 재고상태=stockStatus, 적용가공=applicationShapes, ISO소재분류=materialTags"
        },
        value: {
          type: "string",
          description: "선택한 값. 예: '4', 'Diamond', 'Square', 'skip'. 칩에서 선택한 경우 칩의 값 그대로 사용 (개수 제외)."
        },
        display_value: {
          type: "string",
          description: "UI 표시용 값. 예: '4날', 'Diamond', 'Square'. 없으면 value 사용."
        }
      },
      required: ["field", "value"]
    }
  },
  {
    name: "show_recommendation",
    description: "사용자가 추천 결과를 보고 싶어할 때 호출. '추천해줘', '결과 보여줘', '바로 보여줘' 등.",
    input_schema: {
      type: "object",
      properties: {},
    }
  },
  {
    name: "compare_products",
    description: "사용자가 제품 비교를 요청할 때 호출. '1번이랑 2번 비교', '상위 3개 비교' 등. 반드시 targets에 참조 포함.",
    input_schema: {
      type: "object",
      properties: {
        targets: {
          type: "array",
          items: { type: "string" },
          description: "비교 대상. 예: ['1번', '2번'] 또는 ['상위3']"
        }
      },
      required: ["targets"]
    }
  },
  {
    name: "undo_step",
    description: "사용자가 이전 단계로 돌아가고 싶을 때 호출. '이전으로', '되돌려', 'Square 선택 전으로' 등.",
    input_schema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "'last' = 한 단계 뒤로, 또는 특정 필터 값 (예: 'Square') = 해당 필터 적용 전으로"
        }
      },
      required: ["target"]
    }
  },
  {
    name: "explain_concept",
    description: "사용자가 기술 용어, 옵션, 가공 개념 등을 물어볼 때 호출. 'Square가 뭐야?', '황삭이 뭐야?', '코팅 차이 알려줘' 등.",
    input_schema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "설명할 주제. 예: 'Square', '황삭', 'TiAlN 코팅'"
        }
      },
      required: ["topic"]
    }
  },
  {
    name: "query_field_info",
    description: "사용자가 특정 필드 값이나 내부 기준표 정보에 대해 물어볼 때 호출 (선택이 아닌 질문/탐색). 'Ball은 몇개야?', 'Taper는 뭐야?', '3날 제품이 많아?', '코팅 종류가 뭐가 있어?', 'ISO H에서 HRC 55는 어떤 브랜드야?'. 정보 조회이지 필터 적용이 아님.",
    input_schema: {
      type: "object",
      properties: {
        field: {
          type: "string",
          description: "질문 대상 필드. 예: 'toolSubtype', 'fluteCount', 'coating'"
        },
        values: {
          type: "array",
          items: { type: "string" },
          description: "물어보는 구체적 값들. 예: ['Ball', 'Taper'] 또는 ['3날']"
        }
      },
      required: ["field"]
    }
  },
  {
    name: "filter_stock",
    description: "사용자가 재고/납기 기준으로 필터링을 요청할 때 호출. '재고 있는 거로', '재고 50개 이상', '재고 100개 넘는 것만' 등. 이미 추천 결과가 있는 상태에서 재고 기준 2차 필터링. 숫자 기준이면 threshold에 숫자를 넣는다.",
    input_schema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          enum: ["instock", "limited", "all"],
          description: "instock=재고 있는 것만, limited=제한적 포함, all=전체"
        },
        threshold: {
          type: "number",
          description: "숫자 기준 재고 필터. 예: '재고 50개 이상' → 50. 숫자 언급이 없으면 생략."
        }
      },
      required: ["filter"]
    }
  },
  {
    name: "reset_session",
    description: "사용자가 처음부터 다시 시작하고 싶을 때 호출. '처음부터 다시', '리셋' 등.",
    input_schema: {
      type: "object",
      properties: {},
    }
  },
]

function buildToolUseSystemPrompt(ctx: TurnContext): string {
  const state = ctx.unifiedTurnContext?.sessionState ?? ctx.sessionState
  const filterDesc = state?.appliedFilters
    .filter(f => f.op !== "skip")
    .map(f => `${f.field}=${f.value}`)
    .join(", ") || "없음"

  const optionsDesc = state?.displayedOptions?.length
    ? state.displayedOptions.map(o => `${o.index}. ${o.label} [field=${o.field}, value=${o.value}]`).join("\n")
    : "없음"

  const chipsDesc = state?.displayedChips?.length
    ? state.displayedChips.join(", ")
    : "없음"

  const candidatesDesc = state?.displayedCandidates?.slice(0, 5).map(c =>
    `#${c.rank} ${c.displayCode} | ${c.seriesName ?? "?"} | φ${c.diameterMm ?? "?"}mm | ${c.fluteCount ?? "?"}F | ${c.coating || "정보없음"} | ${c.matchStatus} ${c.score}점`
  ).join("\n") || "없음"

  const dynamicSessionState = `═══ 현재 세션 상태 ═══
- 적용된 필터: [${filterDesc}]
- 후보 수: ${state?.candidateCount ?? "?"}개
- 상태: ${state?.resolutionStatus ?? "초기"}
- 턴 수: ${state?.turnCount ?? 0}
- 마지막 질문 필드: ${state?.lastAskedField ?? "없음"}
- 마지막 액션: ${state?.lastAction ?? "없음"}

═══ 현재 표시된 옵션 (칩) ═══
${optionsDesc}

═══ 표시된 칩 목록 ═══
${chipsDesc}

═══ 표시된 제품 (상위 5개) ═══
${candidatesDesc}`

  if (LLM_FREE_INTERPRETATION) {
    const distFields = ["toolSubtype", "coating", "fluteCount", "seriesName", "diameterMm"]
    const distributions = ctx.currentCandidates?.length
      ? extractFilterFieldValueMap(ctx.currentCandidates, distFields)
      : new Map()
    const distSnippet = buildCandidateDistributionSnippet(distributions, state?.candidateCount ?? 0)

    return `당신은 YG-1 절삭공구 추천 시스템의 대화 라우터입니다.

사용자 메시지를 분석하여 적절한 tool을 호출하거나 직접 텍스트로 답변하세요.

${dynamicSessionState}

${buildDomainKnowledgeSnippet()}
${distSnippet}

핵심 원칙:
- 제품 데이터(코드, 스펙)를 생성하지 마세요
- 한국어로 답변
- 칩 제안 시 위 분포 데이터를 기반으로 실제 존재하는 값만 제안`
  }

  return `당신은 YG-1 절삭공구 추천 시스템의 대화 라우터입니다.

═══ 역할 ═══
사용자 메시지를 분석하여:
1. 적절한 tool을 호출하여 시스템 액션을 실행하거나
2. tool 없이 직접 텍스트로 답변 (잡담, 수학, 감정 공감, 메타 질문 등)

${dynamicSessionState}

═══ 규칙 ═══
1. 사용자가 칩/옵션을 선택하면 → apply_filter 호출 (field는 lastAskedField 또는 옵션의 field 사용)
2. "N번" 입력 → 해당 번호의 옵션 값으로 apply_filter 호출
3. "상관없음/모름/패스/스킵/무난한 걸로/아무거나/추천으로 골라줘/알아서 해줘" → apply_filter에 value="skip" 설정 (현재 질문 필드에 대한 위임/스킵)
3-1. "네/좋아/그래/응/ㅇㅇ/OK/ㅇ" 같은 긍정 응답 → 마지막 질문 필드(lastAskedField)가 있으면 apply_filter에 value="skip" 설정 (시스템 추천에 동의 = 위임)
4. 사용자가 추천 결과를 원하면 → show_recommendation
5. 비교 요청 → compare_products (targets 필수)
6. 되돌리기 → undo_step
7. 용어/개념 질문 → explain_concept
8. 초기화 → reset_session
9. 잡담, 수학, 감정 공감, 시스템 질문 → tool 호출 없이 직접 텍스트 답변
10. 제품 데이터(코드, 스펙, 재고)를 절대 생성하지 마세요
11. 한국어로 답변하세요
12. 답변 끝에 출처 표기: [Reference: YG-1 내부 DB] 또는 [Reference: AI 지식 추론] 또는 [Reference: 웹 검색]

═══ 재고/납기 필터링 ═══
- "재고 있는 거로", "재고 있는 제품만", "즉시 구매 가능한 거" → filter_stock(filter="instock")
- "재고 50개 이상", "재고 100개 넘는 것만" → filter_stock(filter="instock", threshold=50 또는 100)
- "납기 빠른 거", "재고 제한적이어도 괜찮아" → filter_stock(filter="limited")
- "전부 다 보여줘", "재고 무관" → filter_stock(filter="all")

═══ 중요: 질문/탐색 vs 선택 구분 ═══
- "Ball은 몇개야?", "Taper는 뭐야?", "3날 제품이 많아?" → query_field_info (정보 조회)
- "ISO H에서 HRC 55는 어떤 브랜드야?", "스테인레스강 300용 브랜드 뭐가 있어?" → query_field_info (내부 기준표 조회)
- "Ball로", "Ball 선택", "Ball", "1번" (짧은 값 선택) → apply_filter (필터 적용)
- 사용자가 "~은/는 뭐야?", "~이/가 몇개야?", "~종류가 뭐가 있어?" → query_field_info
- 사용자가 명확하게 값을 선택하거나 칩을 클릭한 경우만 apply_filter`
}

function mapToolUseToAction(
  toolUse: LLMToolResult,
  ctx: TurnContext
): OrchestratorAction {
  const input = toolUse.input as Record<string, unknown>

  switch (toolUse.toolName) {
    case "apply_filter": {
      const field = String(
        input.field ??
        ctx.unifiedTurnContext?.currentPendingQuestion?.field ??
        ctx.unifiedTurnContext?.latestProcessTrace?.pendingQuestionField ??
        ctx.sessionState?.lastAskedField ??
        "unknown"
      )
      const value = String(input.value ?? "")
      const displayValue = String(input.display_value ?? value)
      const displayedOption = resolveDisplayedOptionSelection(
        ctx,
        displayValue,
        value,
        ctx.userMessage,
      )
      const displayedFilter = displayedOption
        ? buildFilterFromDisplayedOption(displayedOption, ctx)
        : null
      if (displayedFilter) {
        if (displayedFilter.op === "skip") {
          return { type: "skip_field" }
        }
        return { type: "continue_narrowing", filter: displayedFilter }
      }

      // Skip/delegate detection — field-bound to the pending question
      const skipPatterns = ["skip", "상관없음", "모름", "패스", "스킵", "무난한", "아무거나", "알아서", "추천으로", "골라줘"]
      if (skipPatterns.some(p => value.toLowerCase().includes(p))) {
        return { type: "skip_field" }
      }
      // Affirmative response with pending question → skip/delegate
      const affirmativePatterns = ["네", "좋아", "그래", "응", "ㅇㅇ", "ㅇ", "ok", "yes"]
      if (
        affirmativePatterns.includes(value.toLowerCase().trim()) &&
        (
          ctx.unifiedTurnContext?.currentPendingQuestion?.field ??
          ctx.unifiedTurnContext?.latestProcessTrace?.pendingQuestionField ??
          ctx.sessionState?.lastAskedField
        )
      ) {
        return { type: "skip_field" }
      }

      // Build filter using deterministic parser
      const filter = parseAnswerToFilter(field, value)
      if (filter) {
        filter.appliedAt = ctx.sessionState?.turnCount ?? 0
        if (displayValue && displayValue !== value) {
          filter.value = displayValue
        }
        return { type: "continue_narrowing", filter }
      }

      // Fallback: construct filter directly
      const isNumeric = !isNaN(Number(value))
      return {
        type: "continue_narrowing",
        filter: {
          field,
          op: isNumeric ? "eq" : "includes",
          value: displayValue || value,
          rawValue: isNumeric ? Number(value) : value,
          appliedAt: ctx.sessionState?.turnCount ?? 0,
        }
      }
    }

    case "show_recommendation":
      return { type: "show_recommendation" }

    case "compare_products": {
      const targets = (input.targets as string[]) ?? []
      return { type: "compare_products", targets }
    }

    case "undo_step": {
      const target = String(input.target ?? "last")
      if (target === "last") {
        return { type: "go_back_one_step" }
      }
      return {
        type: "go_back_to_filter",
        filterValue: target,
        filterField: findFilterField(target, ctx.sessionState),
      }
    }

    case "explain_concept":
      return { type: "explain_product", target: String(input.topic ?? "") }

    case "query_field_info":
      // Tentative mention — NOT a filter commitment.
      // Route to explain_product so the system answers the question
      // without applying any filter.
      return {
        type: "explain_product",
        target: String(
          (input.values as string[] | undefined)?.join(", ") ??
          input.field ??
          ctx.userMessage
        ),
      }

    case "filter_stock": {
      const stockValue = String(input.filter ?? "instock")
      const validValues = ["instock", "limited", "all"] as const
      const stockFilter = validValues.includes(stockValue as any)
        ? (stockValue as "instock" | "limited" | "all")
        : "instock"
      const stockThreshold = typeof input.threshold === "number" && input.threshold > 0
        ? input.threshold
        : null
      return { type: "filter_by_stock", stockFilter, stockThreshold }
    }

    case "reset_session":
      return { type: "reset_session" }

    default:
      return { type: "answer_general", message: ctx.userMessage }
  }
}

/**
 * Tool-use based orchestration — single Sonnet call replaces
 * intent classifier (Haiku) + parameter extractor (Haiku) + ambiguity resolver (Opus).
 */
export async function orchestrateTurnWithTools(
  ctx: TurnContext,
  provider: LLMProvider
): Promise<OrchestratorResult> {
  const startMs = Date.now()

  const systemPrompt = buildToolUseSystemPrompt(ctx)
  const messages = [{ role: "user" as const, content: ctx.userMessage }]

  try {
    const { text, toolUse } = await provider.completeWithTools(
      systemPrompt, messages, NARROWING_TOOLS, 1024, TOOL_USE_ROUTER_MODEL
    )

    const durationMs = Date.now() - startMs

    if (toolUse) {
      // Claude chose a tool → map to action
      const action = mapToolUseToAction(toolUse, ctx)
      console.log(`[orchestrator:tool-use] Tool: ${toolUse.toolName} → ${action.type} (${durationMs}ms)`)
      console.log(`[orchestrator:tool-use] Input: ${JSON.stringify(toolUse.input)}`)

      return {
        action,
        reasoning: `tool_use:${toolUse.toolName} → ${action.type}`,
        agentsInvoked: [{ agent: "tool-use-router", model: TOOL_USE_ROUTER_MODEL, durationMs }],
        escalatedToOpus: false,
      }
    }

    // No tool called → Claude responded with text directly (chat, math, meta, etc.)
    const responseText = text ?? "죄송합니다, 다시 말씀해주세요."
    console.log(`[orchestrator:tool-use] No tool called — text response (${durationMs}ms): ${responseText.slice(0, 100)}...`)

    return {
      action: { type: "answer_general", message: responseText, preGenerated: true },
      reasoning: "no_tool:text_response",
      agentsInvoked: [{ agent: "tool-use-router", model: TOOL_USE_ROUTER_MODEL, durationMs }],
      escalatedToOpus: false,
    }
  } catch (error) {
    console.error(`[orchestrator:tool-use] Error:`, error)
    return {
      action: { type: "answer_general", message: ctx.userMessage },
      reasoning: "tool_use_error:fallback",
      agentsInvoked: [{ agent: "tool-use-router", model: TOOL_USE_ROUTER_MODEL, durationMs: Date.now() - startMs }],
      escalatedToOpus: false,
    }
  }
}

// ════════════════════════════════════════════════════════════════
// LEGACY HELPERS (used by both old and new paths)
// ════════════════════════════════════════════════════════════════

function buildFilterFromParams(
  params: ExtractedParameters | null,
  rawValue: string | undefined,
  ctx: TurnContext
): AppliedFilter | null {
  if (!params && !rawValue) return null

  // Check for skip signals
  const clean = (rawValue ?? params?.rawValue ?? "").toLowerCase().trim()
  const SKIP_DELEGATION_PHRASES = ["상관없음", "모름", "패스", "스킵", "상관 없음", "아무거나", "무난한", "알아서", "추천으로", "골라줘", "추천해줘", "맡길게"]
  const AFFIRMATIVE_PHRASES = ["네", "좋아", "그래", "응", "ㅇㅇ", "ㅇ", "ok", "yes"]
  if (SKIP_DELEGATION_PHRASES.some(p => clean.includes(p)) ||
      (AFFIRMATIVE_PHRASES.includes(clean) && ctx.sessionState?.lastAskedField)) {
    return {
      field: ctx.sessionState?.lastAskedField ?? "unknown",
      op: "skip",
      value: "상관없음",
      rawValue: "skip",
      appliedAt: ctx.sessionState?.turnCount ?? 0,
    }
  }

  const lastField =
    ctx.unifiedTurnContext?.currentPendingQuestion?.field ??
    ctx.unifiedTurnContext?.latestProcessTrace?.pendingQuestionField ??
    ctx.sessionState?.lastAskedField

  // Try building filter from extracted params
  if (params) {
    if (params.fluteCount != null) {
      const filter = buildAppliedFilterFromValue("fluteCount", params.fluteCount as any, ctx.sessionState?.turnCount ?? 0)
      if (filter) return filter
    }
    if (params.coating) {
      const filter = buildAppliedFilterFromValue("coating", params.coating as any, ctx.sessionState?.turnCount ?? 0)
      if (filter) return filter
    }
    if (params.toolSubtype) {
      const filter = buildAppliedFilterFromValue("toolSubtype", params.toolSubtype as any, ctx.sessionState?.turnCount ?? 0)
      if (filter) return filter
    }
    if (params.seriesName) {
      const filter = buildAppliedFilterFromValue("seriesName", params.seriesName as any, ctx.sessionState?.turnCount ?? 0)
      if (filter) return filter
    }
    if (params.diameterMm != null) {
      const filter = buildAppliedFilterFromValue("diameterMm", params.diameterMm as any, ctx.sessionState?.turnCount ?? 0)
      if (filter) return filter
    }
  }

  // Fall back to parseAnswerToFilter with the last asked field
  if (lastField && rawValue) {
    const chipClean = rawValue.replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim()
    return parseAnswerToFilter(lastField, chipClean)
  }

  return null
}

// ════════════════════════════════════════════════════════════════
// PROTECTED ROUTING — deterministic fast-path for known UI actions
// ════════════════════════════════════════════════════════════════

/**
 * Routes protected recommendation intents deterministically without LLM calls.
 * Returns null if sessionState is null or the message doesn't match any protected pattern.
 */
export function routeProtectedRecommendationIntent(
  userMessage: string,
  sessionState: ExplorationSessionState | null
): Record<string, unknown> | null {
  if (!sessionState) return null

  const trimmed = userMessage.trim()
  const lower = trimmed.toLowerCase()

  // Full view / reset filter
  if (lower === "전체 보기" || lower === "full view") {
    return { type: "filter_displayed", field: "reset", operator: "reset", value: "__all__" }
  }

  // Series menu
  if (lower === "다른 시리즈 보기" || lower === "시리즈 메뉴") {
    return { type: "show_group_menu" }
  }

  // Recommendation request
  if (lower === "추천해주세요" || lower === "추천해줘" || lower === "recommend") {
    return { type: "show_recommendation" }
  }

  // Series selection — match against displayedSeriesGroups or displayedCandidates
  const seriesGroups = sessionState.displayedSeriesGroups ?? []
  for (const group of seriesGroups) {
    if (group.seriesKey.toLowerCase() === lower || group.seriesName.toLowerCase() === lower) {
      return { type: "restore_previous_group", groupKey: group.seriesKey }
    }
  }

  const candidates = sessionState.displayedCandidates ?? []
  for (const candidate of candidates) {
    const seriesName = candidate.seriesName?.toLowerCase()
    if (seriesName && seriesName === lower) {
      return { type: "restore_previous_group", groupKey: candidate.seriesName! }
    }
  }

  return null
}

/**
 * Returns true when the message is a single-action follow-up in recommendation mode
 * that can bypass multi-intent decomposition.
 */
export function shouldBypassMultiIntentDecomposition(
  userMessage: string,
  sessionState: ExplorationSessionState | null
): boolean {
  if (!sessionState) return false

  const lower = userMessage.toLowerCase()
  const multiIntentMarkers = ["and then", "그리고", "다음에", "and also"]
  if (multiIntentMarkers.some(marker => lower.includes(marker))) {
    return false
  }

  return true
}
