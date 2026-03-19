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

import type { LLMProvider } from "@/lib/llm/provider"
import type { ScoredProduct, RecommendationInput } from "@/lib/types/canonical"
import type { ExplorationSessionState, CandidateSnapshot, AppliedFilter } from "@/lib/types/exploration"
import type { ProductIntakeForm } from "@/lib/types/intake"
import type { EvidenceSummary } from "@/lib/types/evidence"
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
import { decomposeQuery, buildExecutionPlanText, orderChunksForExecution, planActions } from "./query-decomposer"
import type { DecompositionResult, IntentChunk, ExecutionPlan } from "./query-decomposer"
import { parseAnswerToFilter } from "@/lib/domain/question-engine"
import { ENABLE_OPUS_AMBIGUITY, ENABLE_COMPARISON_AGENT, ENABLE_TASK_SYSTEM } from "@/lib/feature-flags"
import type { LLMTool, LLMToolResult } from "@/lib/llm/provider"
import {
  getDisplayedSeriesGroupsFromState,
  getFullDisplayedProductsFromState,
  hasActiveRecommendationSession,
} from "@/lib/recommendation/session-kernel"

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

// ════════════════════════════════════════════════════════════════
// TOOL-USE ROUTING (alternative to regex intent classification)
// Claude chooses which tool to call = intent classification
// ════════════════════════════════════════════════════════════════

const NARROWING_TOOLS: LLMTool[] = [
  {
    name: "apply_filter",
    description: "좁히기 질문에 답하거나, 이미 적용된 필터를 변경할 때 호출. 코팅, 날수, 공구 형상, 시리즈, 직경 등. '상관없음/모름/패스' → value='skip'. 이미 적용된 필터를 바꾸려면 is_replacement=true로 설정. ⚠️ 추천 결과가 표시된 상태에서 필터링하려면 interact_displayed를 사용.",
    input_schema: {
      type: "object",
      properties: {
        field: {
          type: "string",
          enum: ["fluteCount", "coating", "toolSubtype", "seriesName", "diameterMm", "diameterRefine", "cuttingType", "material"],
          description: "필터 대상 필드."
        },
        value: { type: "string", description: "선택한 값. 예: '4', 'Diamond', 'Square', 'skip'" },
        display_value: { type: "string", description: "UI 표시용 값" },
        is_replacement: { type: "boolean", description: "기존 필터를 교체하는 경우 true (예: 직경 4mm→2mm 변경)" }
      },
      required: ["field", "value"]
    }
  },
  {
    name: "show_recommendation",
    description: "추천 결과 보기. '추천해줘', '결과 보여줘', '바로 보여줘' 등.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "compare_products",
    description: "제품 비교. '1번이랑 2번 비교', '상위 3개 비교' 등.",
    input_schema: {
      type: "object",
      properties: {
        targets: { type: "array", items: { type: "string" }, description: "비교 대상. 예: ['1번', '2번']" },
        compare_field: { type: "string", description: "비교 기준 필드 (선택)" }
      },
      required: ["targets"]
    }
  },
  {
    name: "undo_step",
    description: "이전 단계로 돌아가기. '이전으로', '되돌려' 등.",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string", description: "'last' = 한 단계 뒤로, 또는 특정 필터 값" }
      },
      required: ["target"]
    }
  },
  {
    name: "explain_concept",
    description: "기술 용어, 제품 시리즈, 가공 개념 설명. 'Square가 뭐야?', '코팅 차이', 'Alu-cut 특징', '뭔지 몰라요' 등.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "설명할 주제" }
      },
      required: ["topic"]
    }
  },
  {
    name: "ask_clarification",
    description: "사용자 의도가 모호할 때 선택지 제시.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "명확화 질문" },
        options: { type: "array", items: { type: "string" }, description: "선택지 (2-4개)" }
      },
      required: ["question", "options"]
    }
  },
  {
    name: "reset_session",
    description: "처음부터 다시 시작.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "interact_displayed",
    description: "⭐ 표시된 제품 필터링/조회/시리즈 그룹 관리. action으로 구분: 'filter'=조건 필터링, 'query'=스펙 조회, 'keep'=번호 지정, 'reset'=전체 보기, 'group_focus'=시리즈 포커스, 'group_menu'=시리즈 목록.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["filter", "query", "keep", "reset", "group_focus", "group_menu"], description: "동작 종류" },
        field: { type: "string", description: "대상 필드 (filter/query 시)" },
        operator: { type: "string", enum: ["eq","gt","gte","lt","lte","neq","contains"], description: "비교 연산자 (filter 시)" },
        value: { type: "string", description: "비교 값 (filter 시)" },
        keep_indices: { type: "array", items: { type: "number" }, description: "유지할 rank 번호 (keep 시)" },
        query_type: { type: "string", enum: ["max","min","count","list","find"], description: "질의 종류 (query 시)" },
        top_n: { type: "number", description: "상위 N개 (query 시)" },
        group_key: { type: "string", description: "시리즈 그룹 키 (group_focus 시)" },
      },
      required: ["action"]
    }
  },
  {
    name: "manage_task",
    description: "작업 관리. action으로 구분: 'new'=새 추천 시작, 'resume'=이전 작업 복원, 'scope'=현재 상태 확인, 'summary'=진행 요약.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["new", "resume", "scope", "summary"], description: "동작 종류" },
        task_id: { type: "string", description: "복원할 작업 ID (resume 시, 선택)" }
      },
      required: ["action"]
    }
  },
]

/** Normalize Korean/English field aliases to canonical field names */
export function normalizeFieldName(input: string): string | null {
  const map: Record<string, string> = {
    // 직경
    "직경": "diameterMm", "diameter": "diameterMm", "dia": "diameterMm", "지름": "diameterMm",
    "φ": "diameterMm", "ø": "diameterMm",
    // 날수
    "날수": "fluteCount", "날": "fluteCount", "flute": "fluteCount", "flutecount": "fluteCount",
    "f": "fluteCount", "플루트": "fluteCount",
    // 코팅
    "코팅": "coating", "coating": "coating", "coat": "coating", "표면처리": "coating",
    // 공구소재
    "공구소재": "toolMaterial", "toolmaterial": "toolMaterial", "소재": "toolMaterial",
    "material": "toolMaterial", "초경": "toolMaterial", "carbide": "toolMaterial", "hss": "toolMaterial",
    // 섕크
    "섕크": "shankDiameterMm", "shank": "shankDiameterMm", "생크": "shankDiameterMm",
    "shankdiameter": "shankDiameterMm", "자루": "shankDiameterMm",
    // 절삭길이
    "절삭길이": "lengthOfCutMm", "cl": "lengthOfCutMm", "loc": "lengthOfCutMm",
    "절삭장": "lengthOfCutMm", "유효장": "lengthOfCutMm", "cuttinglength": "lengthOfCutMm",
    // 전체길이
    "전체길이": "overallLengthMm", "oal": "overallLengthMm", "전장": "overallLengthMm",
    "overalllength": "overallLengthMm", "totallength": "overallLengthMm",
    // 나선각
    "나선각": "helixAngleDeg", "helix": "helixAngleDeg", "helixangle": "helixAngleDeg",
    "나선": "helixAngleDeg", "비틀림각": "helixAngleDeg",
    // 시리즈
    "시리즈": "seriesName", "series": "seriesName", "시리즈명": "seriesName", "productline": "seriesName",
    // 브랜드
    "브랜드": "brand", "brand": "brand", "브랜드명": "brand", "brandname": "brand",
    // 코너R
    "코너r": "cornerRadius", "cornerradius": "cornerRadius", "cr": "cornerRadius", "코너반경": "cornerRadius",
    // 적용소재
    "적용소재": "materialTags", "applicationmaterial": "materialTags", "isogroup": "materialTags",
    "피삭재": "materialTags", "workmaterial": "materialTags",
  }
  return map[input.toLowerCase().replace(/\s+/g, "")] ?? null
}

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

  const candidatesDesc = state?.displayedCandidates?.slice(0, 10).map(c =>
    `#${c.rank} ${c.displayCode} | ${c.brand ?? "?"} | ${c.seriesName ?? "?"} | φ${c.diameterMm ?? "?"}mm | ${c.fluteCount ?? "?"}F | ${c.coating ?? "?"} | ${c.toolMaterial ?? "?"} | shank:${c.shankDiameterMm ?? "?"}mm | CL:${c.lengthOfCutMm ?? "?"}mm | OAL:${c.overallLengthMm ?? "?"}mm | helix:${c.helixAngleDeg ?? "?"}° | ${c.materialTags?.join("/") ?? "?"} | ${c.matchStatus} ${c.score}점`
  ).join("\n") || "없음"

  return `당신은 YG-1 절삭공구 추천 시스템의 대화 라우터입니다.

═══ 역할 ═══
사용자 메시지를 분석하여:
1. 적절한 tool을 호출하여 시스템 액션을 실행하거나
2. tool 없이 직접 텍스트로 답변 (잡담, 수학, 감정 공감, 메타 질문 등)

═══ 사용자 최초 요청 (intake) ═══
- 소재: ${ctx.resolvedInput.material ?? "미지정"}
- 가공: ${ctx.resolvedInput.operationType ?? "미지정"}
- 직경: ${ctx.resolvedInput.diameterMm != null ? `${ctx.resolvedInput.diameterMm}mm` : "미지정"}
- 공구타입: ${ctx.resolvedInput.toolType ?? "미지정"}

═══ 현재 세션 상태 ═══
- 적용된 필터: [${filterDesc}]
- 후보 수: ${state?.candidateCount ?? "?"}개
- 상태: ${state?.resolutionStatus ?? "초기"}
- 턴 수: ${state?.turnCount ?? 0}
- 마지막 질문 필드: ${state?.lastAskedField ?? "없음"}
- 마지막 액션: ${state?.lastAction ?? "없음"}
- 기저 액션 (side conversation 전): ${state?.underlyingAction ?? state?.lastAction ?? "없음"}

═══ 현재 표시된 옵션 (칩) ═══
${optionsDesc}

═══ 표시된 칩 목록 ═══
${chipsDesc}

═══ 표시된 제품 (상위 10개, 전체 스펙) ═══
${candidatesDesc}

═══ 시리즈 그룹 ═══
${state?.displayedGroups?.map(g => `• ${g.seriesName} (${g.candidateCount}개, 최고 ${g.topScore}점)`).join("\n") || "없음"}
${state?.activeGroupKey ? `현재 포커스: ${state.activeGroupKey}` : ""}

═══ 마지막 비교 결과 ═══
${state?.lastComparisonArtifact ? `비교 대상: ${state.lastComparisonArtifact.comparedProductCodes.join(" vs ")}${state.lastComparisonArtifact.compareField ? ` (기준: ${state.lastComparisonArtifact.compareField})` : ""}\n${state.lastComparisonArtifact.text.slice(0, 300)}${state.lastComparisonArtifact.text.length > 300 ? "..." : ""}` : "없음"}

═══ 마지막 명확화 질문 ═══
${state?.lastClarification ? `질문: "${state.lastClarification.question}"\n옵션: ${state.lastClarification.options.join(", ")}${state.lastClarification.resolvedWith ? `\n해결: "${state.lastClarification.resolvedWith}"` : "\n(미해결)"}` : "없음"}

═══ 좁히기 대화 이력 (최근 12턴 — 전체 기억) ═══
${state?.narrowingHistory?.slice(-12).map((h, i) => {
    const filterSummary = h.extractedFilters.map(f => `${f.field}=${f.value}`).join(", ") || "없음"
    return `턴${i + 1}: Q="${h.question}" → A="${h.answer}" | 필터: ${filterSummary} | ${h.candidateCountBefore}→${h.candidateCountAfter}개`
  }).join("\n") || "없음"}

═══ 추천 결과 이력 ═══
${state?.lastRecommendationArtifact?.slice(0, 5).map(c =>
    `#${c.rank} ${c.displayCode} | ${c.brand ?? "?"} ${c.seriesName ?? "?"} | φ${c.diameterMm ?? "?"}mm ${c.fluteCount ?? "?"}F ${c.coating ?? "?"} | ${c.matchStatus} ${c.score}점`
  ).join("\n") || "추천 결과 없음"}

═══ 작업 이력 ═══
${state?.taskHistory?.map(t => `• [${t.taskId}] ${t.intakeSummary} (체크포인트 ${t.checkpointCount}개)`).join("\n") || "없음"}

═══ 필드명 정규화 ═══
직경/diameter/dia/φ → diameterMm
날수/flute/F → fluteCount
코팅/coating → coating
공구소재/tool material → toolMaterial
섕크/shank/생크 → shankDiameterMm
절삭길이/CL/LOC → lengthOfCutMm
전체길이/OAL/전장 → overallLengthMm
나선각/helix → helixAngleDeg
시리즈/series → seriesName
브랜드/brand → brand

═══ 핵심 라우팅 규칙 ═══

⚠️ Side Conversation 보정: 마지막 액션이 explain_product/answer_general이지만 기저 액션이 show_recommendation/filter_displayed 등이면, 기저 액션 기준으로 라우팅하세요. 설명/잡담은 추천 상태를 바꾸지 않습니다.

⭐⭐ 최우선: 마지막 액션(또는 기저 액션)이 show_recommendation/filter_displayed/query_displayed이면 (추천 결과가 표시된 상태):
- 스펙 기준 필터링 → filter_displayed_products (절대 apply_filter 사용 금지!)
  예: "OAL 69mm인 것만" → filter_displayed(overallLengthMm, eq, 69)
  예: "코팅 Diamond인 것만" → filter_displayed(coating, eq, Diamond)
  예: "CL 10mm 이상만" → filter_displayed(lengthOfCutMm, gte, 10)
- 특정 번호만 보기 → filter_displayed(keep_indices)
  예: "#8, #9만 보여줘" → filter_displayed(field="rank", keep_indices=[8, 9])
  예: "상위 2개만" → filter_displayed(field="rank", keep_indices=[1, 2])
  예: "그것만 보여줘" (직전 필터 결과 참조) → filter_displayed(keep_indices=[직전 결과 번호들])
- 스펙 조회/표 → query_displayed_products
  예: "OAL 목록 줘" → query_displayed(list, overallLengthMm)
  예: "상위 2개 OAL만" → query_displayed(list, overallLengthMm, top_n=2)
  예: "제일 긴 건?" → query_displayed(max, overallLengthMm)
- 문맥 추론: 직전에 OAL을 언급했고 "69인거로 가져와줘"라고 하면 → filter_displayed(overallLengthMm, eq, 69)
- "전체 보기", "필터 해제" → filter_displayed(field="reset", operator="reset")
- 비교, 설명 요청도 가능 (compare_products, explain_concept)

⭐ 마지막 액션이 replace_slot이면: continue_narrowing 흐름으로 복귀 (좁히기 질문 응답 가능)
⭐ 마지막 액션이 ask_clarification이면: 사용자가 선택지 중 하나를 선택 → apply_filter로 처리

좁히기 질문 응답 (lastAction이 continue_narrowing일 때만):
1. 사용자가 칩/옵션을 선택하면 → apply_filter 호출
2. "N번" 입력 → 해당 번호의 옵션 값으로 apply_filter 호출
3. "상관없음/모름/패스/스킵" → apply_filter에 value="skip" 설정

슬롯 교체 (이미 적용된 필터 값 변경):
4. "직경 4mm로 바꿔줘", "코팅 DLC로 변경" → replace_slot (기존 필터 제거 + 새 값 적용)
5. 이미 적용된 필드에 새 값 → replace_slot (apply_filter가 아님!)

일반:
6. 추천 결과를 원하면 → show_recommendation
7. 비교 요청 → compare_products (targets 필수, 필드 비교 시 compareField 포함)
8. 되돌리기 → undo_step
9. 용어/개념 질문 → explain_concept (표시된 제품 데이터를 참조하여 답변)
10. 초기화 → reset_session
11. 제품 데이터(코드, 스펙, 재고)를 절대 생성하지 마세요
12. 한국어로 답변하세요
13. 답변 끝에 출처 표기
14. 필드명은 정규화 표 참고 (한/영/별칭 모두 인식)

⚠️ 오분류 방지 (매우 중요):

⭐⭐⭐ 설명 요청 판별 최우선 규칙:
- "~에 대해 설명해줘", "~에 대해서 알려줘" → 무조건 explain_concept
- "A, B, C 설명해줘" (복수 옵션 나열 + 설명/알려줘) → 무조건 explain_concept
- "Bright, Diamond, DLC에 대해서 설명해줘" → explain_concept (필터 아님! 추천 아님!)
- "코팅 종류별 특징 알려줘" → explain_concept (필터 아님!)
- 메시지에 "설명", "알려줘", "에 대해" 가 포함되면 → 설명 요청일 가능성이 높음 → explain_concept 우선
- 사용자가 옵션 값(Bright, Diamond 등)을 언급하더라도, "설명/알려줘"가 함께 있으면 절대 apply_filter나 show_recommendation으로 라우팅하지 마세요

기타 오분류 방지:
- "스테인리스 가공할 때 뭐가 좋아?" → explain_concept (새 검색 아님!)
- "왜 갑자기 추천한 거야?" → tool 없이 직접 텍스트 답변 (시스템 동작 설명)
- "1+1이 뭐야?" → tool 없이 직접 텍스트 답변 (수학)
- "지금 Square 결과 맞아?" → tool 없이 직접 텍스트로 현재 상태 확인 답변
- 소재 언급이 설명인지 새 검색인지 불명확 → ask_clarification
- "직경 잘못 입력했네", "공구직경 틀렸어" → ask_clarification (질문: "올바른 직경을 알려주세요", 옵션: 자주 쓰는 직경 + "직접 입력")
- "잘못 선택했어", "다시 할래" → undo_step (target="last")
- "더 줄이고 싶어", "후보 줄여줘", "더 좁혀줘" → ask_clarification (질문: "어떤 기준으로 줄일까요?", 옵션: 표시된 제품의 주요 스펙 차이 기준)
- "두 상품 OAL 알려줘", "상위 2개 절삭조건" → query_displayed_products (compare_products가 아님! 비교가 아니라 조회임)

시리즈 그룹/작업 관리:
15. "시리즈 목록", "어떤 시리즈?" → show_group_menu
16. "XX 시리즈만 보여줘" → restore_previous_group (group_key=시리즈명)
17. "새로운 제품 추천", "다른 조건으로 새로" → start_new_recommendation_task
18. "아까 그 추천", "이전 작업 다시" → resume_previous_task

의도가 모호할 때:
19. 추측하지 말고 ask_clarification으로 선택지 제시 (2-4개 옵션 + "직접 입력" 항상 포함)`
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
      const isReplacement = input.is_replacement === true

      if (["skip", "상관없음", "모름", "패스", "스킵"].includes(value.toLowerCase())) {
        return { type: "skip_field" }
      }

      // Replacement mode — change existing filter
      if (isReplacement) {
        const normalizedField = normalizeFieldName(field) ?? field
        return { type: "replace_slot", field: normalizedField, newValue: value, displayValue: displayValue !== value ? displayValue : undefined }
      }

      const filter = parseAnswerToFilter(field, value)
      if (filter) {
        filter.appliedAt = ctx.sessionState?.turnCount ?? 0
        if (displayValue && displayValue !== value) {
          filter.value = displayValue
        }
        return { type: "continue_narrowing", filter }
      }

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
      const compareField = input.compare_field ? String(input.compare_field) : undefined
      const normalizedCompareField = compareField ? (normalizeFieldName(compareField) ?? compareField) : undefined
      return { type: "compare_products", targets, compareField: normalizedCompareField }
    }

    case "undo_step": {
      const target = String(input.target ?? "last")
      if (target === "last") return { type: "go_back_one_step" }
      return { type: "go_back_to_filter", filterValue: target, filterField: findFilterField(target, ctx.sessionState) }
    }

    case "explain_concept":
      return { type: "explain_product", target: String(input.topic ?? "") }

    case "ask_clarification": {
      const question = String(input.question ?? "어떤 것을 원하시나요?")
      const options = (input.options as string[]) ?? []
      return { type: "ask_clarification", question, options, allowDirectInput: true }
    }

    case "reset_session":
      return { type: "reset_session" }

    // ── Merged: interact_displayed (filter + query + keep + reset + group) ──
    case "interact_displayed": {
      const action = String(input.action ?? "filter")

      if (action === "reset") {
        return { type: "filter_displayed", field: "reset", operator: "reset", value: "" }
      }
      if (action === "keep") {
        const keepIndices = (input.keep_indices as number[]) ?? []
        return { type: "filter_displayed", field: "rank", operator: "eq", value: "", keepIndices }
      }
      if (action === "query") {
        const rawField = String(input.field ?? "")
        const field = normalizeFieldName(rawField) ?? rawField
        const queryType = String(input.query_type ?? "list")
        const condition = input.condition as { operator: string; value: string } | undefined
        const topN = input.top_n ? Number(input.top_n) : undefined
        return { type: "query_displayed", queryType, field, condition, topN }
      }
      if (action === "group_menu") {
        return { type: "show_group_menu" }
      }
      if (action === "group_focus") {
        const groupKey = String(input.group_key ?? "")
        return { type: "restore_previous_group", groupKey }
      }
      // Default: filter
      const rawField = String(input.field ?? "")
      const field = normalizeFieldName(rawField) ?? rawField
      const operator = String(input.operator ?? "eq")
      const value = String(input.value ?? "")
      const keepIndices = (input.keep_indices as number[]) ?? undefined
      return { type: "filter_displayed", field, operator, value, keepIndices }
    }

    // ── Merged: manage_task (new + resume + scope + summary) ──
    case "manage_task": {
      const action = String(input.action ?? "scope")
      if (action === "new") return { type: "start_new_task" }
      if (action === "resume") {
        const taskId = input.task_id ? String(input.task_id) : ""
        return { type: "resume_previous_task", taskId }
      }
      if (action === "summary") return { type: "summarize_task" }
      return { type: "confirm_scope" } // default: scope
    }

    // ── Legacy tool names (backward compat if LLM uses old names) ──
    case "replace_slot": {
      const rawField = String(input.field ?? "")
      const field = normalizeFieldName(rawField) ?? rawField
      const newValue = String(input.new_value ?? "")
      const displayValue = input.display_value ? String(input.display_value) : undefined
      return { type: "replace_slot", field, newValue, displayValue }
    }
    case "filter_displayed_products": {
      const rawField = String(input.field ?? "")
      const field = normalizeFieldName(rawField) ?? rawField
      if (field === "reset") return { type: "filter_displayed", field: "reset", operator: "reset", value: "" }
      return { type: "filter_displayed", field, operator: String(input.operator ?? "eq"), value: String(input.value ?? ""), keepIndices: (input.keep_indices as number[]) ?? undefined }
    }
    case "query_displayed_products": {
      const rawField = String(input.field ?? "")
      const field = normalizeFieldName(rawField) ?? rawField
      return { type: "query_displayed", queryType: String(input.query_type ?? "list"), field, condition: input.condition as { operator: string; value: string } | undefined, topN: input.top_n ? Number(input.top_n) : undefined }
    }
    case "start_new_recommendation_task": return { type: "start_new_task" }
    case "resume_previous_task": return { type: "resume_previous_task", taskId: input.task_id ? String(input.task_id) : "" }
    case "restore_previous_group": return { type: "restore_previous_group", groupKey: String(input.group_key ?? "") }
    case "show_group_menu": return { type: "show_group_menu" }
    case "confirm_current_scope": return { type: "confirm_scope" }
    case "summarize_current_task": return { type: "summarize_task" }

    default:
      return { type: "answer_general", message: ctx.userMessage }
  }
}

/**
 * Tool-use based orchestration with full multi-intent decomposition pipeline.
 *
 * Pipeline:
 *   1. decompose_request — split user message into semantic parts (Haiku)
 *   2. classify each part — route through Sonnet tool-use
 *   3. plan_actions — ordered execution plan with dependencies
 *   4. if ambiguity or ≥2 state changes → ask_clarification with plan
 *
 * State-changing actions are ordered (restore → task_change → filtering).
 * Explanation/side_conversation are side-effects that don't break recommendation state.
 */
export async function orchestrateTurnWithTools(
  ctx: TurnContext,
  provider: LLMProvider
): Promise<OrchestratorResult> {
  const startMs = Date.now()
  const agents: OrchestratorResult["agentsInvoked"] = []

  // ═══ Step 0: Check for pending intents from previous multi-intent confirmation ═══
  if (ctx.sessionState?.lastAction === "confirm_multi_intent" && ctx.sessionState.pendingIntents?.length) {
    const pending = ctx.sessionState.pendingIntents
    const userConfirmed = /^(네|예|ㅇ|ㅇㅇ|응|좋아|해줘|진행|ok|yes|확인|순서대로)/i.test(ctx.userMessage.trim())

    const userFirstOnly = /^(첫\s*번째만|첫번째만|first only)/i.test(ctx.userMessage.trim())
    const userCancelled = /^(취소|아니|cancel|no$)/i.test(ctx.userMessage.trim())

    if (userConfirmed) {
      // User confirmed → execute the first pending intent, queue the rest
      const nextChunk = pending[0]
      const remaining = pending.slice(1)
      console.log(`[orchestrator:multi] Confirmed — executing pending: "${nextChunk.text}" (${nextChunk.category}), ${remaining.length} remaining`)

      return routeChunkThroughTools(
        nextChunk.text, ctx, provider, agents, startMs,
        remaining.length > 0 ? remaining as IntentChunk[] : undefined,
        undefined,
        `confirmed_pending:${nextChunk.category}`
      )
    } else if (userFirstOnly) {
      // Execute first only, drop the rest
      const nextChunk = pending[0]
      console.log(`[orchestrator:multi] First-only — executing: "${nextChunk.text}" (${nextChunk.category}), dropping ${pending.length - 1} remaining`)

      return routeChunkThroughTools(
        nextChunk.text, ctx, provider, agents, startMs,
        undefined, // no remaining
        undefined,
        `first_only:${nextChunk.category}`
      )
    } else if (userCancelled) {
      // Cancel — return to normal flow
      console.log(`[orchestrator:multi] Cancelled — dropping ${pending.length} pending`)
      return {
        action: { type: "answer_general", message: "작업을 취소했습니다. 다른 질문이 있으시면 말씀해주세요.", preGenerated: true },
        reasoning: "multi_intent:cancelled",
        agentsInvoked: agents,
        escalatedToOpus: false,
      }
    } else {
      // User did NOT confirm — treat as new intent, drop pending queue
      console.log(`[orchestrator:multi] Not confirmed — treating as new intent, dropping ${pending.length} pending`)
    }
  }

  // ═══ Step 0.5: Deterministic pre-filter — bypass Sonnet for obvious intents ═══
  const protectedAction = routeProtectedRecommendationIntent(ctx.userMessage, ctx.sessionState)
  if (protectedAction) {
    console.log(`[orchestrator:protected] "${ctx.userMessage.slice(0, 40)}" -> ${protectedAction.type}`)
    return {
      action: protectedAction,
      reasoning: `protected_recommendation_router:${protectedAction.type}`,
      agentsInvoked: [{ agent: "protected-router", model: "haiku", durationMs: 0 }],
      escalatedToOpus: false,
    }
  }

  const preFilterResult = deterministicPreFilter(ctx.userMessage, ctx.sessionState)
  if (preFilterResult) {
    console.log(`[orchestrator:pre-filter] Deterministic: "${ctx.userMessage.slice(0, 40)}" → ${preFilterResult.type}`)
    return {
      action: preFilterResult,
      reasoning: `deterministic_pre_filter → ${preFilterResult.type}`,
      agentsInvoked: [{ agent: "pre-filter", model: "haiku", durationMs: 0 }],
      escalatedToOpus: false,
    }
  }

  // ═══ Step 1: Decompose Request (Haiku, ~200ms) ═══
  let decomposition: DecompositionResult | null = null
  const decomposeStart = Date.now()
  try {
    decomposition = await decomposeQuery(ctx.userMessage, ctx.sessionState, provider)
    agents.push({ agent: "query-decomposer", model: "haiku", durationMs: Date.now() - decomposeStart })

    if (decomposition.isMultiIntent) {
      console.log(`[orchestrator:decompose] Multi-intent detected: ${decomposition.chunks.map(c => `${c.category}("${c.text.slice(0, 20)}")`).join(" + ")} | ${decomposition.reasoning}`)
    }
  } catch (e) {
    console.warn("[orchestrator:decompose] Failed, proceeding as single intent:", e)
  }

  // ═══ Step 2: Plan Actions (if multi-intent) ═══
  if (decomposition?.isMultiIntent) {
    const plan = planActions(decomposition)
    console.log(`[orchestrator:plan] Steps: ${plan.steps.map((s, i) => `${i}:${s.chunk.category}${s.isSideEffect ? "(side)" : ""}`).join(" → ")} | confirm=${plan.requiresConfirmation}`)

    // ═══ Step 3: If ≥2 state changes → ask confirmation with plan ═══
    if (plan.requiresConfirmation) {
      const stateChangingSteps = plan.steps.filter(s => !s.isSideEffect)
      const pendingIntents = stateChangingSteps.map(s => s.chunk)

      console.log(`[orchestrator:multi] Requires confirmation — ${stateChangingSteps.length} state-changing actions`)

      return {
        action: {
          type: "ask_clarification",
          question: plan.planText,
          options: ["순서대로 실행", "첫 번째만 실행", "취소"],
          allowDirectInput: true,
        },
        reasoning: `multi_intent:confirm_required [${decomposition.chunks.map(c => c.category).join("+")}]`,
        agentsInvoked: agents,
        escalatedToOpus: false,
        pendingIntents,
        executionPlanText: plan.planText,
      }
    }

    // ═══ Step 4: No confirmation needed — route primary, merge side-effects ═══
    const primaryStep = plan.steps[plan.primaryIndex]
    const sideEffects = plan.sideEffectIndices.map(i => plan.steps[i].chunk)

    // Queue remaining state-changing steps (after primary)
    const remainingStateChanging = plan.steps
      .filter((s, i) => !s.isSideEffect && i !== plan.primaryIndex)
      .map(s => s.chunk)

    console.log(`[orchestrator:multi] Primary: ${primaryStep.chunk.category}("${primaryStep.chunk.text.slice(0, 30)}") | sideEffects: ${sideEffects.length} | queuedState: ${remainingStateChanging.length}`)

    return routeChunkThroughTools(
      primaryStep.chunk.text, ctx, provider, agents, startMs,
      remainingStateChanging.length > 0 ? remainingStateChanging : undefined,
      sideEffects.length > 0 ? sideEffects : undefined,
      `multi_intent:primary=${primaryStep.chunk.category} [${decomposition.chunks.map(c => c.category).join("+")}]`
    )
  }

  // ═══ Single intent — direct routing ═══
  return routeChunkThroughTools(
    ctx.userMessage, ctx, provider, agents, startMs,
    undefined, undefined, undefined
  )
}

/**
 * Route a single chunk (or full message) through Sonnet tool-use.
 * Attaches pendingIntents and sideEffectIntents to the result.
 */
async function routeChunkThroughTools(
  message: string,
  ctx: TurnContext,
  provider: LLMProvider,
  agents: OrchestratorResult["agentsInvoked"],
  startMs: number,
  pendingIntents?: IntentChunk[],
  sideEffectIntents?: IntentChunk[],
  reasoningPrefix?: string,
): Promise<OrchestratorResult> {
  const systemPrompt = buildToolUseSystemPrompt(ctx)

  // Build conversation context: include recent narrowing history as assistant/user turns
  // so Sonnet understands what has been discussed, not just the current message.
  const conversationMessages = buildConversationContext(ctx.sessionState, message)

  // ═══ Phase 1: State-aware tool scoping ═══
  // Only give Sonnet the tools that are valid in the current state.
  // Fewer tools = fewer misrouting opportunities.
  const scopedTools = scopeToolsForState(ctx.sessionState)
  console.log(`[orchestrator:scope] ${scopedTools.length}/${NARROWING_TOOLS.length} tools for state=${ctx.sessionState?.lastAction ?? "none"}`)

  try {
    const toolStart = Date.now()
    const { text, toolUse } = await provider.completeWithTools(
      systemPrompt, conversationMessages, scopedTools, 1024, "sonnet"
    )
    const durationMs = Date.now() - toolStart
    agents.push({ agent: "tool-use-router", model: "sonnet", durationMs })

    if (toolUse) {
      let action = mapToolUseToAction(toolUse, ctx)
      console.log(`[orchestrator:tool-use] Tool: ${toolUse.toolName} → ${action.type} (${durationMs}ms)`)
      console.log(`[orchestrator:tool-use] Input: ${JSON.stringify(toolUse.input)}`)

      // ═══ Phase 2: Post-tool validation gate ═══
      // Catch remaining misroutes that scoping didn't prevent.
      const repaired = validateAndRepairToolChoice(action, ctx, message)
      if (repaired) {
        console.log(`[orchestrator:repair] ${action.type} → ${repaired.type} (misroute corrected)`)
        action = repaired
      }

      const reasoning = reasoningPrefix
        ? `${reasoningPrefix} → tool_use:${toolUse.toolName} → ${action.type}`
        : `tool_use:${toolUse.toolName} → ${action.type}`

      return {
        action,
        reasoning,
        agentsInvoked: agents,
        escalatedToOpus: false,
        pendingIntents,
        sideEffectIntents,
      }
    }

    const responseText = text ?? "죄송합니다, 다시 말씀해주세요."
    console.log(`[orchestrator:tool-use] No tool called — text response (${durationMs}ms): ${responseText.slice(0, 100)}...`)

    return {
      action: { type: "answer_general", message: responseText, preGenerated: true },
      reasoning: reasoningPrefix ? `${reasoningPrefix} → no_tool:text` : "no_tool:text_response",
      agentsInvoked: agents,
      escalatedToOpus: false,
      pendingIntents,
      sideEffectIntents,
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
// CONVERSATION CONTEXT BUILDER
// Builds multi-turn messages array so Sonnet has full conversation context.
// Token-rich but accurate — prevents misrouting from lack of context.
// ════════════════════════════════════════════════════════════════

function buildConversationContext(
  sessionState: ExplorationSessionState | null,
  currentMessage: string,
): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = []

  if (sessionState?.narrowingHistory?.length) {
    // Include full narrowing history (up to 12 turns) for maximum context
    const recent = sessionState.narrowingHistory.slice(-12)
    for (const turn of recent) {
      // System question as assistant message
      const filterInfo = turn.extractedFilters.length > 0
        ? ` [필터 적용: ${turn.extractedFilters.map(f => `${f.field}=${f.value}`).join(", ")}]`
        : ""
      messages.push({
        role: "assistant",
        content: `[질문: ${turn.question}] 후보 ${turn.candidateCountBefore}개 → ${turn.candidateCountAfter}개${filterInfo}`,
      })
      // User answer
      messages.push({
        role: "user",
        content: turn.answer,
      })
    }
  }

  // If there's a recommendation artifact, summarize it as assistant context
  if (sessionState?.lastRecommendationArtifact?.length) {
    const topProducts = sessionState.lastRecommendationArtifact.slice(0, 5)
      .map(c => `#${c.rank} ${c.displayCode} (${c.brand ?? ""} ${c.seriesName ?? ""}, ${c.coating ?? ""}, ${c.score}점)`)
      .join(", ")
    messages.push({
      role: "assistant",
      content: `[추천 결과 표시됨: ${topProducts}]`,
    })
  }

  // If there's a comparison artifact, include it
  if (sessionState?.lastComparisonArtifact) {
    messages.push({
      role: "assistant",
      content: `[비교 결과: ${sessionState.lastComparisonArtifact.comparedProductCodes.join(" vs ")}]`,
    })
  }

  // Current user message
  messages.push({ role: "user", content: currentMessage })

  return messages
}

// ════════════════════════════════════════════════════════════════
// PHASE 1: STATE-AWARE TOOL SCOPING
// Only give Sonnet tools valid for the current session state.
// Fewer tools = dramatically lower misrouting rate.
// ════════════════════════════════════════════════════════════════

const TOOL_SCOPES: Record<string, string[]> = {
  // During narrowing — user answering filter questions (5 tools)
  narrowing: [
    "apply_filter", "explain_concept", "undo_step",
    "ask_clarification", "show_recommendation",
  ],
  // After recommendation — browsing results (5 tools)
  post_recommendation: [
    "interact_displayed", "compare_products", "explain_concept",
    "manage_task", "reset_session",
  ],
  // After comparison — reviewing comparison (4 tools)
  post_comparison: [
    "explain_concept", "interact_displayed", "show_recommendation",
    "compare_products",
  ],
  // After clarification — responding to options (3 tools)
  clarification: [
    "apply_filter", "explain_concept", "undo_step",
  ],
}

// States that map to post_recommendation scope
const POST_REC_STATES = new Set([
  "show_recommendation", "filter_displayed", "query_displayed",
])

function scopeToolsForState(sessionState: ExplorationSessionState | null): LLMTool[] {
  if (!sessionState) return NARROWING_TOOLS

  const effectiveAction = sessionState.underlyingAction ?? sessionState.lastAction ?? ""

  let scopeKey: string
  if (sessionState.lastAction === "ask_clarification" || sessionState.lastAction === "confirm_multi_intent") {
    scopeKey = "clarification"
  } else if (POST_REC_STATES.has(effectiveAction) || sessionState.lastAction === "compare_products") {
    scopeKey = sessionState.lastAction === "compare_products" ? "post_comparison" : "post_recommendation"
  } else {
    scopeKey = "narrowing"
  }

  const allowedNames = new Set(TOOL_SCOPES[scopeKey] ?? TOOL_SCOPES.narrowing)
  return NARROWING_TOOLS.filter(t => allowedNames.has(t.name))
}

// ════════════════════════════════════════════════════════════════
// PHASE 2: POST-TOOL VALIDATION & REPAIR
// After Sonnet picks a tool, validate it makes sense.
// If not, replace with a safer action.
// ════════════════════════════════════════════════════════════════

const EXPLAIN_SIGNAL = /설명|알려|뭔지|몰라|모르겠|에\s*대해|장단점|특징|차이.*뭐|뭐가\s*다/

function validateAndRepairToolChoice(
  action: OrchestratorAction,
  ctx: TurnContext,
  userMessage: string,
): OrchestratorAction | null {
  const clean = userMessage.trim().toLowerCase()
  const lastAction = ctx.sessionState?.underlyingAction ?? ctx.sessionState?.lastAction ?? ""

  // Rule 1: Message contains explanation signals but action is filter/recommendation → repair to explain
  if (EXPLAIN_SIGNAL.test(clean) && (
    action.type === "continue_narrowing" ||
    action.type === "show_recommendation" ||
    action.type === "filter_displayed"
  )) {
    const topicMatch = clean.match(/(.+?)\s*(에\s*대해|설명|알려|뭔지|몰라)/)
    const topic = topicMatch?.[1]?.replace(/^(나\s*이거\s*|이\s*|저\s*|그\s*|나\s*)/, "").trim() ?? clean
    return { type: "explain_product", target: topic }
  }

  // Rule 2: In narrowing state, Sonnet calls show_recommendation but user didn't ask for it
  if (action.type === "show_recommendation" &&
    lastAction === "continue_narrowing" &&
    !/추천|결과|보여|바로/.test(clean)) {
    return null // let it pass, but could add more rules
  }

  // Rule 3: User greeting/thanks routed to anything other than answer_general
  if (/^(안녕|ㅎㅇ|하이|hello|hi\b|고마워|감사|ㄳ)/i.test(clean) &&
    action.type !== "answer_general") {
    return { type: "answer_general", message: clean, preGenerated: false }
  }

  return null // no repair needed
}

// ════════════════════════════════════════════════════════════════
// DETERMINISTIC PRE-FILTER
// Catches obvious intents BEFORE Sonnet tool-use to prevent misrouting.
// Only fires when confidence is very high — ambiguous cases still go to Sonnet.
// ════════════════════════════════════════════════════════════════

function normalizeArtifactLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/\(\d+\s*[^\)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

export function routeProtectedRecommendationIntent(
  message: string,
  sessionState: ExplorationSessionState | null,
): OrchestratorAction | null {
  if (!hasActiveRecommendationSession(sessionState)) return null

  const clean = message.trim()

  if (/^(전체\s*보기|all\s*products?|show\s*all|full\s*view)$/i.test(clean)) {
    return { type: "filter_displayed", field: "reset", operator: "reset", value: "__all__" }
  }

  if (/^(다른\s*시리즈\s*보기|시리즈\s*(검색|목록)|series\s*(search|list)|show\s*series|another\s*series)$/i.test(clean)) {
    return { type: "show_group_menu" }
  }

  if (/^(추천(해줘|해주세요|해\s*줘)?|recommend(\s*again)?|show\s*recommendation|결과\s*보기)$/i.test(clean)) {
    return { type: "show_recommendation" }
  }

  if (/^(이전\s*단계|뒤로|back)$/i.test(clean)) {
    return { type: "go_back_one_step" }
  }

  const groupMap = new Map<string, string>()
  const seriesGroups = getDisplayedSeriesGroupsFromState(sessionState) ?? []
  for (const group of seriesGroups) {
    const key = group.seriesKey || group.seriesName
    const label = group.seriesName || group.seriesKey
    if (!key || !label) continue
    groupMap.set(normalizeArtifactLabel(label), key)
    groupMap.set(normalizeArtifactLabel(key), key)
  }

  const fullSnapshot = getFullDisplayedProductsFromState(sessionState) ?? []
  for (const candidate of fullSnapshot) {
    if (!candidate.seriesName) continue
    groupMap.set(normalizeArtifactLabel(candidate.seriesName), candidate.seriesName)
  }

  const matchedGroupKey = groupMap.get(normalizeArtifactLabel(clean))
  if (matchedGroupKey) {
    return { type: "restore_previous_group", groupKey: matchedGroupKey }
  }

  return null
}

const EXPLAIN_PRE_PATTERNS = [
  /에\s*대해(서)?\s*(설명|알려)/, // "~에 대해 설명해줘"
  /설명\s*(해|좀|해\s*줘|해\s*주세요)/, // "설명해줘", "설명 좀"
  /(뭔지|뭔가|뭐야|뭐에요|뭐죠)\s*(몰라|모르|잘\s*몰|모르겠)/, // "뭔지 몰라요"
  /몰라(요|서)?/, // "몰라요", "몰라서"
  /모르겠/, // "모르겠어요"
  /.+[,\s].+[,\s].+(설명|알려|뭐야)/, // "A, B, C 설명해줘"
  /각각\s*(설명|알려)/, // "각각 설명해줘"
  /종류.*알려/, /종류.*설명/, // "종류 알려줘"
  /장단점/, // "장단점 알려줘"
  /뭐가\s*좋(아|은|을)/, // "뭐가 좋아?"
  /어떤\s*게\s*좋/, // "어떤 게 좋아?"
  /차이(가|점|를)?\s*(뭐|알려|설명)/, // "차이가 뭐야", "차이점 알려줘"
]

const SIDE_CHAT_PRE_PATTERNS = [
  /^안녕/, /^ㅎㅇ/, /^하이/, /^hello/i, /^hi\b/i,
  /고마워/, /감사합니다/, /ㄳ/,
  /^ㅋㅋ/, /^ㅎㅎ/,
]

const RESET_PRE_PATTERNS = [/처음부터\s*다시/, /다시\s*시작/, /리셋/, /초기화/, /^reset$/i]
const RECOMMEND_PRE_PATTERNS = [/추천해\s*(줘|주세요)/, /결과\s*(보기|보여|줘)/, /바로\s*보여/, /추천\s*받/]
const SKIP_PRE_PATTERNS = [/^상관없음$/, /^모름$/, /^패스$/, /^스킵$/, /^아무거나$/]
const UNDO_PRE_PATTERNS = [/이전\s*(으로|단계)/, /되돌/, /돌아가/]
const SCOPE_PRE_PATTERNS = [/지금.*상태/, /현재.*상태/, /뭐.*적용/, /어디까지/, /몇\s*개.*남/]
const SUMMARY_PRE_PATTERNS = [/정리\s*(해|좀)/, /요약/, /지금까지/, /어디까지.*했/]

// Slot replacement patterns — "직경 2mm로 변경", "직경만 2mm로"
const REPLACE_SLOT_PATTERNS: Array<{ pattern: RegExp; field: string; valueGroup: number }> = [
  { pattern: /직경\s*([\d.]+)\s*mm\s*(로|으로)?\s*(변경|바꿔|교체)?/, field: "diameterMm", valueGroup: 1 },
  { pattern: /직경만\s*([\d.]+)\s*mm/, field: "diameterMm", valueGroup: 1 },
  { pattern: /([\d.]+)\s*mm\s*(로|으로)\s*(변경|바꿔|교체|검색)/, field: "diameterMm", valueGroup: 1 },
  { pattern: /날수?\s*(\d+)\s*날\s*(로|으로)?\s*(변경|바꿔)?/, field: "fluteCount", valueGroup: 1 },
  { pattern: /코팅\s*(.+?)\s*(로|으로)\s*(변경|바꿔)?/, field: "coating", valueGroup: 1 },
]

function deterministicPreFilter(
  message: string,
  sessionState: ExplorationSessionState | null,
): OrchestratorAction | null {
  const clean = message.trim().toLowerCase()

  // 1. Explanation requests — highest priority
  if (EXPLAIN_PRE_PATTERNS.some(p => p.test(clean))) {
    const topicMatch = clean.match(/(.+?)\s*(에\s*대해|설명|알려|뭔지|몰라)/)
    const topic = topicMatch?.[1]?.replace(/^(나\s*이거\s*|이\s*|저\s*|그\s*|나\s*)/, "").trim() ?? clean
    return { type: "explain_product", target: topic }
  }

  // 2. Reset
  if (RESET_PRE_PATTERNS.some(p => p.test(clean))) {
    return { type: "reset_session" }
  }

  // 3. Undo
  if (UNDO_PRE_PATTERNS.some(p => p.test(clean))) {
    return { type: "go_back_one_step" }
  }

  // 3.5. Slot replacement ("직경 2mm로 변경", "코팅 DLC로 바꿔")
  for (const { pattern, field, valueGroup } of REPLACE_SLOT_PATTERNS) {
    const match = clean.match(pattern)
    if (match && match[valueGroup]) {
      const newValue = match[valueGroup].trim()
      return { type: "replace_slot", field, newValue, displayValue: field === "diameterMm" ? `${newValue}mm` : newValue }
    }
  }

  // 4. Skip / don't care (only during narrowing)
  if (sessionState?.lastAction === "continue_narrowing" && SKIP_PRE_PATTERNS.some(p => p.test(clean))) {
    return { type: "skip_field" }
  }

  // 5. Scope confirmation
  if (SCOPE_PRE_PATTERNS.some(p => p.test(clean))) {
    return { type: "confirm_scope" }
  }

  // 6. Task summary
  if (SUMMARY_PRE_PATTERNS.some(p => p.test(clean))) {
    return { type: "summarize_task" }
  }

  // 7. Recommendation request
  if (RECOMMEND_PRE_PATTERNS.some(p => p.test(clean))) {
    return { type: "show_recommendation" }
  }

  // 8. Side conversation — greetings, thanks (don't break rec state)
  if (SIDE_CHAT_PRE_PATTERNS.some(p => p.test(clean))) {
    return { type: "answer_general", message: clean, preGenerated: false }
  }

  // 9. Chip/option exact match (during narrowing)
  if (sessionState?.lastAction === "continue_narrowing" && sessionState.displayedOptions?.length) {
    const chipClean = clean.replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim()
    for (const opt of sessionState.displayedOptions) {
      const optLabel = opt.label.toLowerCase().replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim()
      if (chipClean === opt.value.toLowerCase() || chipClean === optLabel) {
        return {
          type: "continue_narrowing",
          filter: { field: opt.field, op: "includes", value: opt.value, rawValue: opt.value, appliedAt: sessionState.turnCount ?? 0 }
        }
      }
    }
  }

  return null // → Sonnet handles it (with scoped tools + post-validation)
}
