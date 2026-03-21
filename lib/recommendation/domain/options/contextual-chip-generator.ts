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
    const systemPrompt = `대화 전체를 읽고 사용자가 다음에 클릭할 칩(버튼)을 만들어라.

규칙:
1. 대화 흐름을 완전히 이해해라 — 무엇을 물었고, 무엇을 답했고, 지금 무엇을 해야 하는지
2. 시스템 최신 응답에 선택지/질문이 있으면 → 그것을 칩으로
3. 후보 데이터에 값 분포가 있으면 → 모든 값을 칩에 포함
4. 사용자가 혼란하면 → 설명/위임/건너뛰기 칩 우선
5. 칩 텍스트는 짧게 (2~10자), 개수는 자유 (2~8개)
6. 응답과 데이터에 근거한 칩만 — 발명 금지

JSON: {"chips": ["칩1", ...], "reasoning": "한 줄"}`

    const contextStr = formatContextForChipGen(ctx)

    const raw = await provider.complete(
      systemPrompt,
      [{ role: "user", content: contextStr }],
      200,
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

  // ── 1. 대화 이력 (Q&A 쌍 — 잘리지 않은 전문) ──
  if (mem?.recentQA && mem.recentQA.length > 0) {
    lines.push(`═══ 이전 질문과 답변 ═══`)
    for (const qa of mem.recentQA) {
      lines.push(`시스템 질문 (${qa.field ?? "일반"}): ${qa.question}`)
      lines.push(`사용자 답변: ${qa.answer}`)
    }
  }

  // ── 2. 최근 대화 (전문) ──
  if (ctx.recentTurns.length > 0) {
    lines.push(`\n═══ 최근 대화 ═══`)
    for (const turn of ctx.recentTurns.slice(-8)) {
      const role = turn.role === "user" ? "사용자" : "시스템"
      lines.push(`${role}: ${turn.text}`)
    }
  }

  // ── 3. 시스템 최신 응답 (전문 — 칩의 근거) ──
  lines.push(`\n═══ 시스템 최신 응답 ═══`)
  lines.push(ctx.assistantText)

  // ── 4. 사용자 최신 메시지 (전문) ──
  if (ctx.userMessage) {
    lines.push(`\n═══ 사용자 최신 메시지 ═══`)
    lines.push(ctx.userMessage)
  }

  // ── 5. 후보 데이터 분포 ──
  if (ctx.candidateFieldValues && Object.keys(ctx.candidateFieldValues).length > 0) {
    lines.push(`\n═══ 후보 데이터 (실제 값 분포) ═══`)
    for (const [field, values] of Object.entries(ctx.candidateFieldValues)) {
      const valueStr = values.map(v => `${v.value}(${v.count}개)`).join(", ")
      lines.push(`${field}: ${valueStr}`)
    }
  }

  // ── 6. 현재 세션 상태 ──
  lines.push(`\n═══ 세션 상태 ═══`)
  lines.push(`모드: ${ctx.mode}, 후보: ${ctx.candidateCount}개`)
  const conditions = Object.entries(ctx.resolvedConditions).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`)
  if (conditions.length > 0) lines.push(`확정 조건: ${conditions.join(", ")}`)
  if (ctx.appliedFilters.length > 0) lines.push(`적용 필터: ${ctx.appliedFilters.map(f => `${f.field}=${f.value}`).join(", ")}`)

  // ── 7. 사용자 행동 패턴 (누적 시그널) ──
  if (mem) {
    const signals: string[] = []
    if (mem.userSignals.confusedFields.length > 0) signals.push(`혼란 필드: ${mem.userSignals.confusedFields.join(", ")}`)
    if (mem.userSignals.skippedFields.length > 0) signals.push(`스킵 필드: ${mem.userSignals.skippedFields.join(", ")}`)
    if (mem.userSignals.prefersDelegate) signals.push("위임 선호")
    if (mem.userSignals.prefersExplanation) signals.push("설명 선호")
    if (mem.userSignals.frustrationCount > 0) signals.push(`좌절 ${mem.userSignals.frustrationCount}회`)
    if (signals.length > 0) lines.push(`사용자 패턴: ${signals.join(", ")}`)
  }

  lines.push(`\n위 대화 전체를 이해하고, 시스템 응답의 맥락에 맞는 칩을 만들어라.`)

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
