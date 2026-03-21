/**
 * LLM Chip Reranker — Uses Haiku to rerank/select/refine chip candidates.
 *
 * The LLM must NOT invent new actions. It only:
 * - selects the best 4-6 from deterministic candidates
 * - reorders them by relevance
 * - may slightly improve labels
 * - suppresses generic/stale chips when better ones exist
 *
 * Falls back to deterministic ranking if LLM is unavailable or fails.
 */

import type { SmartOption } from "./types"
import type { ChipContext } from "../context/chip-context-builder"
import { formatChipContextForLLM } from "../context/chip-context-builder"
import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"

export interface RerankedResult {
  options: SmartOption[]
  rerankedByLLM: boolean
}

/**
 * Rerank chip candidates using LLM.
 * Falls back to deterministic order if LLM is unavailable or fails.
 */
export async function rerankChipsWithLLM(
  candidates: SmartOption[],
  chipContext: ChipContext,
  provider: LLMProvider
): Promise<RerankedResult> {
  if (!provider.available() || candidates.length <= 4) {
    return { options: candidates, rerankedByLLM: false }
  }

  try {
    const contextStr = formatChipContextForLLM(chipContext)

    const candidateList = candidates.map((c, i) => ({
      index: i,
      id: c.id,
      label: c.label,
      family: c.family,
      field: c.field ?? null,
      subtitle: c.subtitle ?? null,
      preservesContext: c.preservesContext,
      destructive: c.destructive,
    }))

    const systemPrompt = `당신은 YG-1 절삭공구 추천 시스템의 칩(선택지) 리랭커입니다.

═══ 역할 ═══
사용자에게 보여줄 칩/버튼 후보 목록을 받고, 가장 적합한 4~6개를 선택하여 순서대로 출력합니다.

═══ 절대 규칙 ═══
1. 후보 목록에 없는 새 액션을 만들지 마세요
2. 후보의 id를 반드시 보존하세요
3. 라벨은 약간 개선 가능하지만 의미를 바꾸지 마세요

═══ 우선순위 ═══
1. 시스템이 방금 물어본 질문에 직접 대답하는 칩
2. 사용자의 현재 상태(혼란/위임/명확)에 맞는 칩
3. 최근 대화 흐름에 이어지는 칩
4. 현재 세션 상태에 유용한 칩
5. 제네릭 폴백 칩 (마지막)

═══ 특수 규칙 ═══
- 사용자가 혼란/모름 상태면: 설명/위임/상관없음 칩을 상위에
- 미해결 질문이 있으면: 해당 질문의 선택지를 최상위에
- "처음부터 다시"는 사용자가 명시적으로 원하지 않는 한 하위에
- 이미 답변한 필드의 축소 옵션은 하위에

JSON으로만 응답: {"selected": [{"index": 0, "label": "개선된 라벨 또는 원본"}]}`

    const userPrompt = `${contextStr}

═══ 칩 후보 목록 ═══
${JSON.stringify(candidateList, null, 2)}

위 후보에서 가장 적합한 4~6개를 선택하고 우선순위대로 정렬하세요.
JSON으로만 응답: {"selected": [{"index": 번호, "label": "라벨"}]}`

    const raw = await provider.complete(
      systemPrompt,
      [{ role: "user", content: userPrompt }],
      300,
      "haiku"
    )

    const parsed = safeParseJSON(raw)
    if (!parsed?.selected || !Array.isArray(parsed.selected)) {
      return { options: candidates, rerankedByLLM: false }
    }

    const selected = parsed.selected as Array<{ index: number; label?: string }>
    const reranked: SmartOption[] = []

    for (const item of selected) {
      if (typeof item.index !== "number" || item.index < 0 || item.index >= candidates.length) continue
      const original = candidates[item.index]
      reranked.push({
        ...original,
        label: (item.label && item.label.length > 0 && item.label.length < 50) ? item.label : original.label,
      })
    }

    if (reranked.length < 2) {
      return { options: candidates, rerankedByLLM: false }
    }

    console.log(`[chip-reranker] LLM selected ${reranked.length}/${candidates.length} chips: ${reranked.map(o => o.label).join(", ")}`)
    return { options: reranked, rerankedByLLM: true }
  } catch (error) {
    console.warn("[chip-reranker] LLM reranking failed, using deterministic order:", error)
    return { options: candidates, rerankedByLLM: false }
  }
}

function safeParseJSON(raw: string): Record<string, unknown> | null {
  try {
    const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim()
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}
