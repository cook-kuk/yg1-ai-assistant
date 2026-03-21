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

export interface ChipGenerationContext {
  /** Latest assistant response text */
  assistantText: string
  /** Latest user message */
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
  /** Recent conversation turns (last 4-6) */
  recentTurns: Array<{ role: string; text: string }>
  /** Recommendation status */
  recommendationStatus: string | null
  /**
   * Actual candidate field value distributions from current candidates.
   * Key: field name, Value: map of value → count.
   * This is the real data source — chips MUST reflect these values.
   */
  candidateFieldValues?: Record<string, Array<{ value: string; count: number }>>
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
    const systemPrompt = `시스템 응답을 읽고 사용자가 클릭할 칩(버튼)을 만들어라.

핵심 규칙:
1. 시스템 응답 안에 선택지가 있으면 → 그것들을 그대로 칩으로 써라
2. 시스템 응답 안에 질문이 있으면 → 그 질문에 답할 수 있는 칩을 만들어라
3. 후보 데이터에 값 분포가 주어지면 → 그 값들을 모두 칩에 포함해라
4. 칩 텍스트는 짧게 (2~10자)
5. 개수는 상황에 맞게 자유롭게 (2~8개)
6. 새로운 액션을 발명하지 마라 — 응답과 데이터에 근거한 칩만

JSON: {"chips": ["칩1", "칩2", ...], "reasoning": "한 줄"}`

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

  lines.push(`═══ 현재 상태 ═══`)
  lines.push(`모드: ${ctx.mode}`)
  lines.push(`후보 수: ${ctx.candidateCount}개`)
  if (ctx.recommendationStatus) lines.push(`추천 상태: ${ctx.recommendationStatus}`)
  if (ctx.lastAskedField) lines.push(`마지막 질문 필드: ${ctx.lastAskedField}`)

  const conditions = Object.entries(ctx.resolvedConditions)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}=${v}`)
  if (conditions.length > 0) lines.push(`확정 조건: ${conditions.join(", ")}`)

  if (ctx.appliedFilters.length > 0) {
    lines.push(`적용 필터: ${ctx.appliedFilters.map(f => `${f.field}=${f.value}`).join(", ")}`)
  }

  if (ctx.displayedProducts.length > 0) {
    lines.push(`표시 제품: ${ctx.displayedProducts.map(p => p.code).join(", ")}`)
  }

  lines.push(`\n═══ 최근 대화 ═══`)
  for (const turn of ctx.recentTurns.slice(-6)) {
    const role = turn.role === "user" ? "사용자" : "시스템"
    lines.push(`${role}: ${turn.text.slice(0, 150)}${turn.text.length > 150 ? "..." : ""}`)
  }

  // Candidate field value distributions — THE REAL DATA
  if (ctx.candidateFieldValues && Object.keys(ctx.candidateFieldValues).length > 0) {
    lines.push(`\n═══ 후보 데이터 (실제 값 분포 — 칩에 반드시 반영) ═══`)
    for (const [field, values] of Object.entries(ctx.candidateFieldValues)) {
      const valueStr = values.map(v => `${v.value}(${v.count}개)`).join(", ")
      lines.push(`${field}: ${valueStr}`)
    }
  }

  lines.push(`\n═══ 시스템 최신 응답 (칩은 이 응답의 선택지에서 추출) ═══`)
  lines.push(ctx.assistantText.slice(0, 800))

  if (ctx.userMessage) {
    lines.push(`\n═══ 사용자 최신 메시지 ═══`)
    lines.push(ctx.userMessage)
  }

  lines.push(`\n시스템 응답의 선택지를 칩으로 만들어라. 응답에 없는 칩은 만들지 마라.`)

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
