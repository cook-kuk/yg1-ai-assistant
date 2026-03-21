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
    return { chips: buildMinimalFallbackChips(ctx), reasoning: null, generatedByLLM: false }
  }

  try {
    const systemPrompt = `당신은 YG-1 절삭공구 추천 시스템의 칩(선택 버튼) 생성기입니다.

═══ 역할 ═══
대화 맥락을 읽고, 사용자에게 보여줄 칩(클릭 가능한 버튼 텍스트)을 4~6개 생성합니다.

═══ 절대 규칙 ═══
1. 칩은 사용자가 다음에 할 수 있는 구체적 행동이어야 합니다
2. 현재 대화 맥락에 맞아야 합니다 — 맥락과 무관한 제네릭 칩 금지
3. 시스템이 방금 질문을 했으면, 그 질문에 대한 답변 선택지를 최우선으로 포함
4. 사용자가 혼란해하면 설명/위임/건너뛰기 칩을 우선
5. 추천 후에는 비교/절삭조건/대안/조건변경 등 다음 행동 칩
6. "처음부터 다시"는 정말 필요한 경우만 (마지막에)
7. 제품 데이터를 만들지 마세요
8. 칩 텍스트는 짧고 명확하게 (2~8자 권장, 최대 15자)

═══ 칩 종류 예시 ═══
- 질문 답변: "Diamond", "4날", "예", "아니요"
- 설명 요청: "쉽게 설명해줘", "Diamond가 뭐야?"
- 위임: "추천으로 골라줘", "알아서 해줘"
- 건너뛰기: "상관없음", "다음"
- 후속 행동: "절삭조건 알려줘", "대체 후보 보기", "코팅 비교"
- 조건 변경: "소재 바꾸기", "코팅 변경", "직경 변경"
- 되돌리기: "이전으로", "코팅 다시 고르기"
- 리셋: "처음부터 다시"

JSON으로만 응답: {"chips": ["칩1", "칩2", ...], "reasoning": "선택 이유 한 줄"}`

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
        .slice(0, 6)

      if (chips.length >= 2) {
        console.log(`[contextual-chips] LLM generated ${chips.length} chips: ${chips.join(", ")}`)
        return {
          chips,
          reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : null,
          generatedByLLM: true,
        }
      }
    }

    return { chips: buildMinimalFallbackChips(ctx), reasoning: null, generatedByLLM: false }
  } catch (error) {
    console.warn("[contextual-chips] LLM chip generation failed:", error)
    return { chips: buildMinimalFallbackChips(ctx), reasoning: null, generatedByLLM: false }
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

  lines.push(`\n═══ 시스템 최신 응답 ═══`)
  lines.push(ctx.assistantText.slice(0, 300))

  if (ctx.userMessage) {
    lines.push(`\n═══ 사용자 최신 메시지 ═══`)
    lines.push(ctx.userMessage)
  }

  lines.push(`\n위 맥락에 맞는 칩을 4~6개 생성하세요.`)

  return lines.join("\n")
}

/**
 * Minimal deterministic fallback when LLM is unavailable.
 * Still context-aware, just not as nuanced.
 */
function buildMinimalFallbackChips(ctx: ChipGenerationContext): string[] {
  // Post-recommendation
  if (ctx.mode === "recommendation" || ctx.recommendationStatus?.startsWith("resolved")) {
    const chips: string[] = []
    if (ctx.displayedProducts.length >= 2) chips.push("대체 후보 비교")
    chips.push("절삭조건 알려줘")
    if (ctx.appliedFilters.length > 0) chips.push("⟵ 이전 단계")
    chips.push("다른 조건으로")
    return chips
  }

  // Refinement
  if (ctx.mode === "refinement") {
    return ["현재 조건 유지", "다른 조건 보기", "⟵ 이전 단계"]
  }

  // General chat
  if (ctx.mode === "general_chat" || ctx.mode === "comparison") {
    if (ctx.candidateCount > 0) {
      return ["추천 결과 보기", "다른 조건으로", "⟵ 이전 단계"]
    }
    return ["조건 입력하기", "도움말"]
  }

  // Narrowing / question — use whatever the question-engine already provides
  return []
}

function safeParseJSON(raw: string): Record<string, unknown> | null {
  try {
    const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim()
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}
