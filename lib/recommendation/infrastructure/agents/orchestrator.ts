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
import type {
  AppliedFilter,
  CandidateSnapshot,
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
import { needsOpusResolution, resolveAmbiguity } from "./ambiguity-resolver"
import { resolveProductReferences } from "./comparison-agent"
import { parseAnswerToFilter } from "@/lib/recommendation/domain/question-engine"
import { ENABLE_OPUS_AMBIGUITY, ENABLE_COMPARISON_AGENT } from "@/lib/recommendation/infrastructure/config/recommendation-agent-flags"

// ════════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR
// ════════════════════════════════════════════════════════════════

export async function orchestrateTurn(
  ctx: TurnContext,
  provider: LLMProvider
): Promise<OrchestratorResult> {
  const agents: OrchestratorResult["agentsInvoked"] = []
  const startMs = Date.now()

  // ═══ Step 1: Intent Classification (Haiku) ═══
  const intentStart = Date.now()
  const intentResult = await classifyIntent(ctx.userMessage, ctx.sessionState, provider)
  agents.push({ agent: "intent-classifier", model: "haiku", durationMs: Date.now() - intentStart })

  console.log(`[orchestrator] Intent: ${intentResult.intent} (${intentResult.confidence.toFixed(2)}) model=${intentResult.modelUsed}${intentResult.extractedValue ? ` value="${intentResult.extractedValue}"` : ""}`)

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
    agents.push({ agent: "ambiguity-resolver", model: "opus", durationMs: Date.now() - opusStart })

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
    agents.push({ agent: "parameter-extractor", model: "haiku", durationMs: Date.now() - paramStart })

    console.log(`[orchestrator] Extracted: ${JSON.stringify(extractedParams)}`)
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

    case "REFINE_CONDITION":
      return { type: "refine_condition", field: value || "material" }

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
          enum: ["fluteCount", "coating", "toolSubtype", "seriesName", "diameterMm", "diameterRefine", "cuttingType", "material"],
          description: "필터 대상 필드. 현재 질문(lastAskedField)에 해당하는 필드 사용."
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
    name: "reset_session",
    description: "사용자가 처음부터 다시 시작하고 싶을 때 호출. '처음부터 다시', '리셋' 등.",
    input_schema: {
      type: "object",
      properties: {},
    }
  },
]

function buildToolUseSystemPrompt(ctx: TurnContext): string {
  const state = ctx.sessionState
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
    `#${c.rank} ${c.displayCode} | ${c.seriesName ?? "?"} | φ${c.diameterMm ?? "?"}mm | ${c.fluteCount ?? "?"}F | ${c.coating ?? "?"} | ${c.matchStatus} ${c.score}점`
  ).join("\n") || "없음"

  return `당신은 YG-1 절삭공구 추천 시스템의 대화 라우터입니다.

═══ 역할 ═══
사용자 메시지를 분석하여:
1. 적절한 tool을 호출하여 시스템 액션을 실행하거나
2. tool 없이 직접 텍스트로 답변 (잡담, 수학, 감정 공감, 메타 질문 등)

═══ 현재 세션 상태 ═══
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
${candidatesDesc}

═══ 규칙 ═══
1. 사용자가 칩/옵션을 선택하면 → apply_filter 호출 (field는 lastAskedField 또는 옵션의 field 사용)
2. "N번" 입력 → 해당 번호의 옵션 값으로 apply_filter 호출
3. "상관없음/모름/패스/스킵" → apply_filter에 value="skip" 설정
4. 사용자가 추천 결과를 원하면 → show_recommendation
5. 비교 요청 → compare_products (targets 필수)
6. 되돌리기 → undo_step
7. 용어/개념 질문 → explain_concept
8. 초기화 → reset_session
9. 잡담, 수학, 감정 공감, 시스템 질문 → tool 호출 없이 직접 텍스트 답변
10. 제품 데이터(코드, 스펙, 재고)를 절대 생성하지 마세요
11. 한국어로 답변하세요
12. 답변 끝에 출처 표기: [Reference: YG-1 내부 DB] 또는 [Reference: AI 지식 추론] 또는 [Reference: 웹 검색]`
}

function mapToolUseToAction(
  toolUse: LLMToolResult,
  ctx: TurnContext
): OrchestratorAction {
  const input = toolUse.input as Record<string, unknown>

  switch (toolUse.toolName) {
    case "apply_filter": {
      const field = String(input.field ?? ctx.sessionState?.lastAskedField ?? "unknown")
      const value = String(input.value ?? "")
      const displayValue = String(input.display_value ?? value)

      // Skip detection
      if (["skip", "상관없음", "모름", "패스", "스킵"].includes(value.toLowerCase())) {
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
      systemPrompt, messages, NARROWING_TOOLS, 1024, "sonnet"
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
        agentsInvoked: [{ agent: "tool-use-router", model: "sonnet", durationMs }],
        escalatedToOpus: false,
      }
    }

    // No tool called → Claude responded with text directly (chat, math, meta, etc.)
    const responseText = text ?? "죄송합니다, 다시 말씀해주세요."
    console.log(`[orchestrator:tool-use] No tool called — text response (${durationMs}ms): ${responseText.slice(0, 100)}...`)

    return {
      action: { type: "answer_general", message: responseText, preGenerated: true },
      reasoning: "no_tool:text_response",
      agentsInvoked: [{ agent: "tool-use-router", model: "sonnet", durationMs }],
      escalatedToOpus: false,
    }
  } catch (error) {
    console.error(`[orchestrator:tool-use] Error:`, error)
    return {
      action: { type: "answer_general", message: ctx.userMessage },
      reasoning: "tool_use_error:fallback",
      agentsInvoked: [{ agent: "tool-use-router", model: "sonnet", durationMs: Date.now() - startMs }],
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
  if (["상관없음", "모름", "패스", "스킵", "상관 없음", "아무거나"].includes(clean)) {
    return {
      field: ctx.sessionState?.lastAskedField ?? "unknown",
      op: "skip",
      value: "상관없음",
      rawValue: "skip",
      appliedAt: ctx.sessionState?.turnCount ?? 0,
    }
  }

  const lastField = ctx.sessionState?.lastAskedField

  // Try building filter from extracted params
  if (params) {
    if (params.fluteCount != null) {
      return {
        field: "fluteCount", op: "eq",
        value: `${params.fluteCount}날`,
        rawValue: params.fluteCount,
        appliedAt: ctx.sessionState?.turnCount ?? 0,
      }
    }
    if (params.coating) {
      return {
        field: "coating", op: "includes",
        value: params.coating,
        rawValue: params.coating,
        appliedAt: ctx.sessionState?.turnCount ?? 0,
      }
    }
    if (params.toolSubtype) {
      return {
        field: "toolSubtype", op: "includes",
        value: params.toolSubtype,
        rawValue: params.toolSubtype,
        appliedAt: ctx.sessionState?.turnCount ?? 0,
      }
    }
    if (params.seriesName) {
      return {
        field: "seriesName", op: "includes",
        value: params.seriesName,
        rawValue: params.seriesName,
        appliedAt: ctx.sessionState?.turnCount ?? 0,
      }
    }
    if (params.diameterMm != null) {
      return {
        field: "diameterMm", op: "eq",
        value: `${params.diameterMm}mm`,
        rawValue: params.diameterMm,
        appliedAt: ctx.sessionState?.turnCount ?? 0,
      }
    }
  }

  // Fall back to parseAnswerToFilter with the last asked field
  if (lastField && rawValue) {
    const chipClean = rawValue.replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim()
    return parseAnswerToFilter(lastField, chipClean)
  }

  return null
}
