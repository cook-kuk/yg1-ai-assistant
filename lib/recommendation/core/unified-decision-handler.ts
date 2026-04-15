/**
 * Unified Decision Handler — LLM 결정을 실제 파이프라인 실행으로 연결.
 *
 * 구조:
 *   unifiedLLMRouter()  → UnifiedDecision
 *   handleUnifiedPath() → intent 분기 + DB 실행 + 응답 렌더
 *
 * 재사용:
 *   - deps.mapIntakeToInput / deps.applyFilterToInput      (input 구성)
 *   - runHybridRetrieval                                   (DB 조회 + 스코어링)
 *   - deps.buildRecommendationResponse                     (카드 + xAI)
 *   - deps.buildQuestionResponse                           (텍스트 + 칩)
 *   - deps.jsonRecommendationResponse                      (short-circuit 텍스트)
 *   - filter-field-registry                                (환각 필드 검증)
 *
 * 스킵:
 *   - pre-search-route / unified-judgment / deterministic-scr 추출
 *   - complexity-router / session-action-classifier
 *   - multi-stage-query-resolver / question-engine
 */

import { getDbSchema } from "@/lib/recommendation/core/sql-agent-schema-cache"
import {
  unifiedLLMRouter,
  type UnifiedDecision,
  type UnifiedFilter,
} from "@/lib/recommendation/core/unified-llm-router"
import {
  buildAppliedFilterFromValue,
  getFilterFieldDefinition,
} from "@/lib/recommendation/shared/filter-field-registry"
import { buildSessionState, carryForwardState } from "@/lib/recommendation/domain/session-manager"
import { runHybridRetrieval } from "@/lib/recommendation/domain/hybrid-retrieval"
import { prepareRequest } from "@/lib/recommendation/domain/recommendation-domain"
import { getProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type {
  AppliedFilter,
  AppLanguage,
  ChatMessage,
  ExplorationSessionState,
  NarrowingStage,
  NarrowingTurn,
  ProductIntakeForm,
  RecommendationInput,
} from "@/lib/recommendation/domain/types"
import type { RecommendationDisplayedProductRequestDto, RecommendationPaginationDto } from "@/lib/contracts/recommendation"
import type { ServeEngineRuntimeDependencies } from "@/lib/recommendation/infrastructure/engines/serve-engine-runtime"

// ── UnifiedFilter → AppliedFilter 변환 + 검증 ─────────────────

function unifiedFilterToApplied(uf: UnifiedFilter, appliedAt: number): AppliedFilter[] {
  // 환각 필드 게이트 — registry 에 없으면 버린다
  const def = getFilterFieldDefinition(uf.field)
  if (!def) {
    try { console.warn(`[unified-handler] drop hallucinated field: ${uf.field}`) } catch { /* no-op */ }
    return []
  }

  // between 은 AppliedFilter 한 개(op=between, rawValue/rawValue2) 로 표현
  if (uf.op === "between" && uf.value2 !== undefined) {
    const lower = buildAppliedFilterFromValue(uf.field, uf.value, appliedAt, "gte")
    if (!lower) return []
    const upperNum = typeof uf.value2 === "number"
      ? uf.value2
      : (() => { const n = parseFloat(String(uf.value2)); return Number.isFinite(n) ? n : null })()
    if (upperNum === null) return [lower]
    // 단일 between 필터로 합친다
    const merged: AppliedFilter = {
      ...lower,
      op: "between",
      rawValue2: upperNum,
      value: `${lower.value} ~ ${upperNum}`,
    }
    return [merged]
  }

  const opMap: Record<string, string> = { eq: "eq", neq: "neq", gte: "gte", lte: "lte", like: "eq" }
  const opOverride = opMap[uf.op] ?? undefined
  const built = buildAppliedFilterFromValue(uf.field, uf.value as string | number | boolean, appliedAt, opOverride)
  return built ? [built] : []
}

function convertDecisionFilters(decision: UnifiedDecision, appliedAt: number): AppliedFilter[] {
  const out: AppliedFilter[] = []
  for (const uf of decision.filters) {
    out.push(...unifiedFilterToApplied(uf, appliedAt))
  }
  return out
}

// ── Reset / text-only short-circuit ──────────────────────────

function respondReset(deps: Pick<ServeEngineRuntimeDependencies, "jsonRecommendationResponse">) {
  return deps.jsonRecommendationResponse({
    text: "처음부터 다시 시작합니다. 새로 조건을 입력해주세요.",
    purpose: "greeting",
    chips: ["처음부터 다시"],
    isComplete: true,
    recommendation: null,
    sessionState: null,
    evidenceSummaries: null,
    candidateSnapshot: null,
    requestPreparation: null,
  })
}

function respondTextOnly(
  deps: Pick<ServeEngineRuntimeDependencies, "jsonRecommendationResponse">,
  prevState: ExplorationSessionState | null,
  text: string,
  chips: string[] | null,
) {
  return deps.jsonRecommendationResponse({
    text,
    purpose: "question",
    chips: chips && chips.length > 0 ? chips : ["⟵ 이전 단계", "처음부터 다시"],
    isComplete: false,
    recommendation: null,
    sessionState: prevState ?? null,
    evidenceSummaries: null,
    candidateSnapshot: prevState?.displayedCandidates ?? null,
    requestPreparation: null,
  })
}

// ── Main entry ───────────────────────────────────────────────

export async function handleUnifiedPath(
  deps: ServeEngineRuntimeDependencies,
  form: ProductIntakeForm,
  messages: ChatMessage[],
  prevState: ExplorationSessionState | null,
  _displayedProducts: RecommendationDisplayedProductRequestDto[] | null,
  language: AppLanguage,
  pagination: RecommendationPaginationDto | null,
): Promise<Response> {
  const lastUserMsg = [...messages].reverse().find(m => m.role === "user")?.text?.trim() ?? ""

  // 1) 스키마 로드 — 실패 시 null 을 반환해 기존 경로로 fallback 되도록 null 반환
  const schema = await getDbSchema().catch(err => {
    try { console.warn(`[unified-handler] schema load failed: ${err instanceof Error ? err.message : err}`) } catch { /* no-op */ }
    return null
  })
  if (!schema) {
    return respondTextOnly(deps, prevState, "일시적으로 DB 스키마를 불러올 수 없습니다. 잠시 후 다시 시도해주세요.", null)
  }

  // 2) 통합 LLM 호출
  try { deps.onThinking?.("🤔 사용자 의도를 파악하는 중…", { kind: "stage" }) } catch { /* no-op */ }
  const decision = await unifiedLLMRouter({
    message: lastUserMsg,
    appliedFilters: prevState?.appliedFilters ?? [],
    candidateCount: prevState?.candidateCount ?? null,
    conversationHistory: messages,
    schema,
  })

  if (!decision) {
    // LLM 실패 — 안전한 폴백 텍스트
    return respondTextOnly(
      deps,
      prevState,
      "요청을 이해하지 못했습니다. 더 구체적으로 알려주세요. (예: 스테인리스 10mm 4날 엔드밀)",
      null,
    )
  }

  // 3) Reset intent — 세션 초기화
  if (decision.intent === "reset") {
    return respondReset(deps)
  }

  // 4) 텍스트-only intents: explain / explore / question
  if (decision.intent === "explain" || decision.intent === "explore") {
    return respondTextOnly(deps, prevState, decision.response, decision.chips)
  }

  if (decision.intent === "question") {
    // question 은 필터가 있어도 (edp_no lookup 등) UI 에는 텍스트만 렌더
    return respondTextOnly(deps, prevState, decision.response, decision.chips)
  }

  // 5) compare — MVP: 텍스트로만 답변 (Phase 2 에서 비교 테이블 추가)
  if (decision.intent === "compare") {
    return respondTextOnly(deps, prevState, decision.response, decision.chips)
  }

  // 6) recommend / refine — DB 조회 + 카드 or 칩
  const turnCount = (prevState?.turnCount ?? 0) + 1
  const appliedFiltersNext = convertDecisionFilters(decision, turnCount)

  // recommend = fresh filters, refine = prev + new (중복 필드는 새 값으로 대체)
  const mergedFilters: AppliedFilter[] = (() => {
    if (decision.intent === "recommend" || !prevState) return appliedFiltersNext
    const byField = new Map<string, AppliedFilter>()
    for (const f of prevState.appliedFilters ?? []) byField.set(f.field, f)
    for (const f of appliedFiltersNext) byField.set(f.field, f) // 덮어쓰기
    return [...byField.values()]
  })()

  // Build RecommendationInput
  let input: RecommendationInput = deps.mapIntakeToInput(form)
  for (const f of mergedFilters) {
    try { input = deps.applyFilterToInput(input, f) } catch { /* no-op */ }
  }

  // DB 조회
  try { deps.onThinking?.("🗄️ SQL Agent가 쿼리를 생성하는 중…", { kind: "stage" }) } catch { /* no-op */ }
  const retrieval = await runHybridRetrieval(input, mergedFilters, 0, null)
  const candidates = retrieval.candidates
  const evidenceMap = retrieval.evidenceMap
  const totalCandidateCount = retrieval.totalConsidered || candidates.length

  // narrowingHistory 업데이트 (이번 턴 추가)
  const prevHistory: NarrowingTurn[] = prevState?.narrowingHistory ?? []
  const newHistoryEntry: NarrowingTurn = {
    askedField: mergedFilters.length > 0 ? mergedFilters[mergedFilters.length - 1].field : undefined,
    question: lastUserMsg,
    answer: decision.response.slice(0, 200),
    extractedFilters: appliedFiltersNext,
    candidateCountBefore: prevState?.candidateCount ?? 0,
    candidateCountAfter: candidates.length,
  }
  const narrowingHistory: NarrowingTurn[] = [...prevHistory, newHistoryEntry]

  // stageHistory 는 간단히 유지 (기존 값 + 새 filter stage 참조)
  const stageHistory: NarrowingStage[] = prevState?.stageHistory ?? []

  // pagination DTO — 요청 pagination 이 있으면 그대로, 없으면 null
  const paginationDto: RecommendationPaginationDto | null = pagination
    ? { page: pagination.page, pageSize: pagination.pageSize, totalItems: totalCandidateCount, totalPages: Math.max(1, Math.ceil(totalCandidateCount / Math.max(pagination.pageSize, 1))) }
    : null

  const provider = getProvider()

  // 7) narrowing 필요 — chips 제공, 카드 없음
  if (decision.chips && decision.chips.length > 0) {
    return deps.buildQuestionResponse(
      form,
      candidates,
      evidenceMap,
      totalCandidateCount,
      paginationDto,
      null, // no display page slice
      null,
      input,
      narrowingHistory,
      mergedFilters,
      turnCount,
      messages,
      provider,
      language,
      decision.response, // overrideText
      stageHistory,
      undefined, // excludeWorkPieceValues
      undefined, // responsePrefix
      decision.chips, // overrideChips
    )
  }

  // 8) 바로 카드 렌더 (narrowing 종료)
  if (candidates.length === 0) {
    // 0 건 — 안내 텍스트만
    const nextState = prevState
      ? carryForwardState(prevState, {
          appliedFilters: mergedFilters,
          narrowingHistory,
          resolutionStatus: "narrowing",
          resolvedInput: input,
          turnCount,
          candidateCount: 0,
          displayedCandidates: [],
          displayedChips: ["⟵ 이전 단계", "처음부터 다시"],
          currentMode: "question",
          lastAction: "show_recommendation",
        })
      : buildSessionState({
          candidateCount: 0,
          appliedFilters: mergedFilters,
          narrowingHistory,
          stageHistory,
          resolutionStatus: "narrowing",
          resolvedInput: input,
          turnCount,
          displayedCandidates: [],
          displayedChips: ["⟵ 이전 단계", "처음부터 다시"],
        })
    return deps.jsonRecommendationResponse({
      text: decision.response || "조건에 맞는 제품이 없습니다. 조건을 완화해 보세요.",
      purpose: "question",
      chips: ["⟵ 이전 단계", "처음부터 다시"],
      isComplete: false,
      recommendation: null,
      sessionState: nextState,
      evidenceSummaries: null,
      candidateSnapshot: null,
      requestPreparation: null,
    })
  }

  return deps.buildRecommendationResponse(
    form,
    candidates,
    evidenceMap,
    totalCandidateCount,
    paginationDto,
    null, // no display page slice
    null,
    input,
    narrowingHistory,
    mergedFilters,
    turnCount,
    messages,
    provider,
    language,
    null,
    undefined,
    "recommendation",
  )
}
