/**
 * Contextual Chip Generator — LLM-based chip generation from conversation context.
 *
 * Replaces all hardcoded chip functions:
 * - generateFollowUpChips (keyword-based)
 * - buildRefinementChips (field-based)
 * - getDefaultChips (missing-field-based)
 * - getFollowUpChips (post-recommendation)
 *
 * The LLM receives full conversation context and generates contextually appropriate chips.
 * Falls back to deterministic generation if LLM is unavailable.
 */

import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { ConversationMemory } from "../memory/conversation-memory"
import type { RecentInteractionFrame, UserRelation, UIBlockReference } from "../context/recent-interaction-frame"

export interface ChipGenerationContext {
  /** Latest assistant response text — FULL, not truncated */
  assistantText: string
  /** Latest user message — FULL */
  userMessage: string | null
  /** Current mode */
  mode: "question" | "narrowing" | "recommendation" | "general_chat" | "comparison" | "refinement"
  /** Resolved input conditions */
  resolvedConditions: Record<string, string | number | null>
  /** Applied filters */
  appliedFilters: Array<{ field: string; value: string }>
  /** Candidate count */
  candidateCount: number
  /** Top displayed products (brief) */
  displayedProducts: Array<{ code: string; series: string | null; coating: string | null }>
  /** Last asked field */
  lastAskedField: string | null
  /** Recent conversation turns (last 4-6) — FULL text, not truncated */
  recentTurns: Array<{ role: string; text: string }>
  /** Recommendation status */
  recommendationStatus: string | null
  /**
   * Actual candidate field value distributions from current candidates.
   * Key: field name, Value: map of value → count.
   * This is the real data source — chips MUST reflect these values.
   */
  candidateFieldValues?: Record<string, Array<{ value: string; count: number }>>
  /** Persistent conversation memory — accumulated across turns */
  conversationMemory?: ConversationMemory | null
  /** Recent interaction frame — PRIMARY signal for chip generation */
  recentFrame?: RecentInteractionFrame | null
}

export interface GeneratedChips {
  chips: string[]
  reasoning: string | null
  generatedByLLM: boolean
}

/**
 * Generate chips from conversation context using LLM.
 * Falls back to minimal deterministic chips if LLM fails.
 */
export async function generateContextualChips(
  ctx: ChipGenerationContext,
  provider: LLMProvider
): Promise<GeneratedChips> {
  if (!provider.available()) {
    return { chips: buildDataDrivenFallbackChips(ctx), reasoning: "LLM unavailable, data-driven fallback", generatedByLLM: false }
  }

  try {
    const systemPrompt = `대화를 읽고 사용자가 다음에 클릭할 칩(버튼)을 만들어라.

우선순위:
1. "지금 상황"을 가장 먼저 봐라 — 시스템이 뭘 물었고, 사용자가 어떻게 반응했는지
2. 시스템 응답에 선택지/질문이 있으면 → 그것을 칩으로
3. 사용자가 혼란하면 → 설명/위임/건너뛰기 칩 우선
4. 사용자가 결과를 보고 반응하면 → 비교/절삭조건/대안 칩
5. 사용자가 수정/되돌리기 원하면 → revision 칩
6. 후보 데이터에 값 분포가 있으면 → 모든 값을 칩에 포함
7. 칩은 짧게 (2~10자), 개수는 자유 (2~8개)
8. 응답과 데이터에 근거한 칩만 — 발명 금지
9. "지금 상황"에서 제네릭 칩 사용 금지라고 하면 → generic chip 절대 쓰지 마

JSON: {"chips": ["칩1", ...], "reasoning": "한 줄"}`

    const contextStr = formatContextForChipGen(ctx)

    const raw = await provider.complete(
      systemPrompt,
      [{ role: "user", content: contextStr }],
      1500,
      "haiku"
    )

    const parsed = safeParseJSON(raw)
    if (parsed?.chips && Array.isArray(parsed.chips) && parsed.chips.length >= 2) {
      const chips = (parsed.chips as string[])
        .filter(c => typeof c === "string" && c.length > 0 && c.length < 30)
        .slice(0, 8)

      if (chips.length >= 2) {
        console.log(`[contextual-chips] LLM generated ${chips.length} chips: ${chips.join(", ")}`)
        return {
          chips,
          reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : null,
          generatedByLLM: true,
        }
      }
    }

    return { chips: buildDataDrivenFallbackChips(ctx), reasoning: "LLM parse failed, data-driven fallback", generatedByLLM: false }
  } catch (error) {
    console.warn("[contextual-chips] LLM chip generation failed:", error)
    return { chips: buildDataDrivenFallbackChips(ctx), reasoning: "LLM parse failed, data-driven fallback", generatedByLLM: false }
  }
}

function formatContextForChipGen(ctx: ChipGenerationContext): string {
  const lines: string[] = []
  const mem = ctx.conversationMemory
  const frame = ctx.recentFrame

  // ═══ PRIORITY 1: 최근 상호작용 프레임 (칩 생성의 핵심 근거) ═══
  if (frame) {
    lines.push(`═══ 지금 상황 (가장 중요 — 칩은 이걸 기반으로 만들어라) ═══`)
    if (frame.latestAssistantQuestion) {
      lines.push(`▶ 시스템이 방금 물어본 것: "${frame.latestAssistantQuestion}"`)
    }
    lines.push(`▶ 사용자가 방금 한 말: "${frame.latestUserMessage}"`)

    // Translate relation to natural language for better LLM understanding
    const relationDesc: Record<string, string> = {
      direct_answer: "사용자가 질문에 직접 답변했다",
      confusion: "사용자가 혼란스러워한다 — 설명/위임/건너뛰기 칩 우선",
      challenge: "사용자가 선택지에 이의를 제기했다 (예: '없어?', '0개야?')",
      revise: "사용자가 이전 선택을 수정하고 싶어한다",
      followup_on_result: "사용자가 추천/비교 결과에 대해 반응하고 있다",
      compare_request: "사용자가 비교를 원한다",
      detail_request: "사용자가 상세 정보(절삭조건 등)를 원한다",
      meta_feedback: "사용자가 시스템 동작에 대한 피드백을 주고 있다",
      restart: "사용자가 처음부터 다시 시작하고 싶어한다",
    }
    lines.push(`▶ 사용자 의도: ${relationDesc[frame.relation] ?? frame.relation}`)

    const uiBlockDesc: Record<string, string> = {
      question_prompt: "질문 선택 화면",
      recommendation_card: "추천 결과 카드",
      comparison_table: "비교표",
      candidate_list: "후보 목록",
      cutting_conditions: "절삭조건 표시",
      explanation_text: "설명 텍스트",
      chips_bar: "칩/선택지 바",
      unknown: "알 수 없음",
    }
    lines.push(`▶ 사용자가 보는 화면: ${uiBlockDesc[frame.uiBlock] ?? frame.uiBlock}`)

    if (frame.referencedProducts.length > 0) {
      lines.push(`▶ 참조 제품: ${frame.referencedProducts.join(", ")}`)
    }
    if (frame.currentPendingQuestion) {
      const pq = frame.currentPendingQuestion
      lines.push(`▶ 미해결 질문: ${pq.kind} (필드: ${pq.field ?? "없음"})`)
      if (pq.options.length > 0) lines.push(`▶ 기존 선택지: ${pq.options.join(", ")}`)
    }
    if (frame.suppressGenericChips) {
      lines.push(`⚠️ 중요: 제네릭 칩 사용 금지 — 위 상황에 직접 맞는 칩만 생성해라`)
    }
  }

  // ═══ PRIORITY 2: 시스템 최신 응답 (전문) ═══
  lines.push(`\n═══ 시스템 최신 응답 ═══`)
  lines.push(ctx.assistantText)

  // ═══ PRIORITY 2: 사용자 최신 메시지 (전문) ═══
  if (ctx.userMessage) {
    lines.push(`\n═══ 사용자 최신 메시지 ═══`)
    lines.push(ctx.userMessage)
  }

  // ═══ PRIORITY 2: 후보 데이터 분포 ═══
  if (ctx.candidateFieldValues && Object.keys(ctx.candidateFieldValues).length > 0) {
    lines.push(`\n═══ 후보 데이터 (실제 값 분포) ═══`)
    for (const [field, values] of Object.entries(ctx.candidateFieldValues)) {
      const valueStr = values.map(v => `${v.value}(${v.count}개)`).join(", ")
      lines.push(`${field}: ${valueStr}`)
    }
  }

  // ═══ PRIORITY 3: 세션 상태 ═══
  lines.push(`\n═══ 세션 상태 ═══`)
  lines.push(`모드: ${ctx.mode}, 후보: ${ctx.candidateCount}개`)
  const conditions = Object.entries(ctx.resolvedConditions).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`)
  if (conditions.length > 0) lines.push(`확정 조건: ${conditions.join(", ")}`)
  if (ctx.appliedFilters.length > 0) lines.push(`적용 필터: ${ctx.appliedFilters.map(f => `${f.field}=${f.value}`).join(", ")}`)
  if (ctx.displayedProducts.length > 0) {
    lines.push(`표시 제품: ${ctx.displayedProducts.map(p => `${p.code}(${p.coating ?? "?"})`).join(", ")}`)
  }

  // ═══ PRIORITY 4: 이전 대화 이력 ═══
  if (mem?.recentQA && mem.recentQA.length > 0) {
    lines.push(`\n═══ 이전 질문과 답변 ═══`)
    for (const qa of mem.recentQA.slice(-5)) {
      lines.push(`질문(${qa.field ?? "일반"}): ${qa.question} → 답변: ${qa.answer}`)
    }
  }

  if (ctx.recentTurns.length > 0) {
    lines.push(`\n═══ 최근 대화 ═══`)
    for (const turn of ctx.recentTurns.slice(-6)) {
      const role = turn.role === "user" ? "사용자" : "시스템"
      lines.push(`${role}: ${turn.text}`)
    }
  }

  // ═══ 사용자 행동 패턴 ═══
  if (mem) {
    const signals: string[] = []
    if (mem.userSignals.confusedFields.length > 0) signals.push(`혼란 필드: ${mem.userSignals.confusedFields.join(", ")}`)
    if (mem.userSignals.skippedFields.length > 0) signals.push(`스킵 필드: ${mem.userSignals.skippedFields.join(", ")}`)
    if (mem.userSignals.prefersDelegate) signals.push("위임 선호")
    if (mem.userSignals.prefersExplanation) signals.push("설명 선호")
    if (signals.length > 0) lines.push(`사용자 패턴: ${signals.join(", ")}`)
  }

  lines.push(`\n위 "지금 상황"을 가장 우선으로 이해하고 칩을 만들어라.`)

  return lines.join("\n")
}

/**
 * Data-driven fallback when LLM is unavailable.
 * Generates chips purely from session data — zero hardcoded strings.
 */
function buildDataDrivenFallbackChips(ctx: ChipGenerationContext): string[] {
  const chips: string[] = []

  // 1. If there are candidate field values for the current question → use ALL of them as chips
  if (ctx.candidateFieldValues && ctx.lastAskedField) {
    const fieldValues = ctx.candidateFieldValues[ctx.lastAskedField]
    if (fieldValues && fieldValues.length > 0) {
      for (const fv of fieldValues) {
        chips.push(`${fv.value} (${fv.count}개)`)
      }
      chips.push("상관없음")
      return chips
    }
  }

  // 2. If there are candidate field values for any field → show the most discriminating
  if (ctx.candidateFieldValues) {
    const fields = Object.entries(ctx.candidateFieldValues)
    if (fields.length > 0) {
      // Pick the field with the most values (most information)
      const [bestField, bestValues] = fields.reduce((a, b) => a[1].length > b[1].length ? a : b)
      for (const fv of bestValues.slice(0, 6)) {
        chips.push(`${fv.value} (${fv.count}개)`)
      }
      chips.push("상관없음")
      return chips
    }
  }

  // 3. If there are displayed products → derive chips from their data
  if (ctx.displayedProducts.length >= 1) {
    const topProduct = ctx.displayedProducts[0]
    if (topProduct.coating) chips.push(`${topProduct.coating} 코팅 상세`)
    if (ctx.displayedProducts.length > 1) {
      chips.push(`${ctx.displayedProducts.slice(0, 2).map(p => p.code).join(" vs ")}`)
    }
  }

  // 4. Applied filters → offer to change each one
  for (const filter of ctx.appliedFilters.slice(-2)) {
    chips.push(`${filter.value} 변경`)
  }

  // 5. If filters exist, allow undo
  if (ctx.appliedFilters.length > 0) {
    const lastFilter = ctx.appliedFilters[ctx.appliedFilters.length - 1]
    chips.push(`${lastFilter.value} 이전으로`)
  }

  // 6. Missing conditions from data
  const missing: string[] = []
  if (!ctx.resolvedConditions.material) missing.push("소재 선택")
  if (!ctx.resolvedConditions.diameterMm) missing.push("직경 선택")
  if (!ctx.resolvedConditions.coating) missing.push("코팅 선택")
  if (!ctx.resolvedConditions.fluteCount) missing.push("날 수 선택")
  for (const field of missing.slice(0, 2)) {
    chips.push(field)
  }

  if (chips.length < 2 && ctx.candidateCount > 0) {
    chips.push(`${ctx.candidateCount}개 후보 보기`)
  }

  return chips
}

function safeParseJSON(raw: string): Record<string, unknown> | null {
  try {
    const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim()
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}
