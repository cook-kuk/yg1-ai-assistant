/**
 * Zero-result CoT — Diagnostic reasoning when filters narrow candidates to 0.
 *
 * The global CoT hotfix is OFF for normal turns (latency reasons), but the
 * 0-result case is exactly where users need an explanation: which filter is
 * the bottleneck, what to relax, what to try next. This module makes a
 * single Haiku call to produce that explanation in Korean. Best-effort —
 * if the LLM fails or is unavailable, returns a deterministic synthetic
 * fallback so the UI always gets *something* useful.
 */

import type { AppliedFilter } from "@/lib/recommendation/domain/types"
import { resolveModel, type LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"

const ZERO_RESULT_MODEL = resolveModel("haiku")

export interface ZeroResultCoTInput {
  userMessage: string
  filters: AppliedFilter[]
  /** Optional: candidate count BEFORE the last filter was applied (helps the LLM pinpoint the bottleneck) */
  preFilterCount?: number | null
}

export async function generateZeroResultCoT(
  input: ZeroResultCoTInput,
  provider: LLMProvider,
): Promise<string> {
  const filterLines = input.filters
    .filter(f => f.op !== "skip")
    .map(f => `  - ${f.field} ${f.op} ${f.value}`)
    .join("\n") || "  (필터 없음)"

  const fallback = buildSyntheticZeroResultCoT(input)

  if (!provider.available()) return fallback

  try {
    const systemPrompt = `당신은 YG-1 절삭공구 추천 진단 전문가입니다. 사용자가 검색했지만 매칭 결과가 0개인 상황을 분석합니다.

목표: 한국어로 짧게 (4-6문장) 다음을 설명하세요:
1. 어떤 조건 조합이 0건 원인일 가능성이 높은지 (filter들 중 가장 제약적인 것)
2. 어떤 조건을 풀면 결과가 나올지 — 구체적인 1-2개 제안
3. YG-1 카탈로그 도메인 지식 활용 (예: 특정 직경+소재 조합이 흔치 않음, 코팅 옵션이 한정적임 등)

규칙:
- 추측 금지. "~일 수 있습니다" 표현 사용
- 사용자 책임 금지 — "조건이 너무 까다롭습니다" 같은 비난조 X
- 문장 끝에 절대 "추천드립니다" 같은 광고체 금지
- 자연스러운 reasoning 톤 ("음, ~", "아무래도 ~", "~이 가장 의심됩니다")`

    const userPrompt = `사용자 입력: "${input.userMessage}"

적용된 필터:
${filterLines}

검색 결과: 0개

위 0건 결과의 원인을 분석하고, 어떤 조건을 풀면 나올 가능성이 있는지 진단해주세요.`

    const raw = await provider.complete(
      systemPrompt,
      [{ role: "user", content: userPrompt }],
      600,
      ZERO_RESULT_MODEL,
    )

    const cleaned = raw?.trim()
    if (cleaned && cleaned.length > 20) return cleaned
    return fallback
  } catch (err) {
    console.warn("[zero-result-cot] LLM failed, using synthetic fallback:", (err as Error).message)
    return fallback
  }
}

/**
 * Synthetic fallback — used when the LLM is unavailable or fails. Pure
 * string composition from the filter list, no LLM call.
 */
export function buildSyntheticZeroResultCoT(input: ZeroResultCoTInput): string {
  const active = input.filters.filter(f => f.op !== "skip")
  if (active.length === 0) {
    return "현재 적용된 조건으로는 매칭되는 제품이 없습니다. 검색 조건을 좀 더 구체적으로 입력해주시면 정확하게 찾아드릴 수 있습니다."
  }

  const fieldLabels = active
    .map(f => `${f.field}=${f.value}`)
    .join(", ")

  return `현재 조건(${fieldLabels})으로는 매칭되는 제품이 없습니다. 가장 마지막에 추가한 조건이 너무 좁은 가능성이 높아 보이고, 한두 가지 조건을 풀어보시면 결과가 나올 수 있습니다. 어떤 조건을 우선 해제할까요?`
}
