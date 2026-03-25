/**
 * Response Composer Agent — Sonnet
 *
 * Generates the final natural-language response.
 * Takes the orchestrator's decision + session context → polished Korean response.
 */

import type { LLMProvider } from "@/lib/llm/provider"
import type { ExplorationSessionState } from "@/lib/types/exploration"
import type { OrchestratorAction, ComposedResponse } from "./types"

/**
 * Compose a natural-language response for undo/back navigation.
 */
export function composeUndoResponse(
  action: OrchestratorAction & { type: "go_back_one_step" | "go_back_to_filter" },
  restoredState: {
    candidateCount: number
    removedFilterDesc: string
    restoredFilters: string[]
    nextQuestionField: string | null
  }
): ComposedResponse {
  const { candidateCount, removedFilterDesc, restoredFilters, nextQuestionField } = restoredState

  let text: string
  if (action.type === "go_back_to_filter") {
    text = `${action.filterValue} 선택 전 단계로 돌아갔습니다. 현재 후보는 ${candidateCount}개입니다.`
  } else {
    text = `이전 단계로 돌아갔습니다. "${removedFilterDesc}" 필터를 제거하여 후보가 ${candidateCount}개로 복원되었습니다.`
  }

  if (restoredFilters.length > 0) {
    text += `\n현재 적용 조건: ${restoredFilters.join(", ")}`
  }

  return {
    text,
    chips: [],  // chips will be added by the question engine
    purpose: "question",
    modelUsed: "sonnet",
  }
}

/**
 * Compose a natural-language response for narrowing questions.
 * Uses Sonnet to polish deterministic question text.
 */
export async function composeNarrowingResponse(
  questionText: string,
  sessionState: ExplorationSessionState,
  provider: LLMProvider
): Promise<ComposedResponse> {
  if (!provider.available()) {
    return { text: questionText, chips: [], purpose: "question", modelUsed: "sonnet" }
  }

  const filterPath = sessionState.appliedFilters
    .filter(f => f.op !== "skip")
    .map(f => `${f.field}=${f.value}`)
    .join(" → ")

  const systemPrompt = `당신은 YG-1 절삭공구 추천 AI입니다. 간결하게 대화하세요.
현재 축소 경로: ${filterPath || "(초기)"}
현재 후보: ${sessionState.candidateCount}개
다음 질문을 자연스러운 한국어 1-2문장으로 다듬어주세요. 불필요한 인사/서론 없이 바로 질문.
JSON 응답: {"responseText": "..."}`

  try {
    const raw = await provider.complete(
      systemPrompt,
      [{ role: "user", content: questionText }],
      1500,
      "sonnet",
      "response-composer"
    )
    const parsed = JSON.parse(raw.trim().replace(/```json\n?|\n?```/g, ""))
    return {
      text: parsed.responseText ?? questionText,
      chips: [],
      purpose: "question",
      modelUsed: "sonnet",
    }
  } catch {
    return { text: questionText, chips: [], purpose: "question", modelUsed: "sonnet" }
  }
}

/**
 * Compose a response for general/off-topic messages during narrowing.
 */
export function composeRedirectResponse(
  sessionState: ExplorationSessionState | null
): ComposedResponse {
  const count = sessionState?.candidateCount ?? 0
  const hasSession = sessionState && count > 0

  const text = hasSession
    ? `현재 ${count}개 후보에서 조건을 좁히고 있습니다. 추가 조건을 알려주시거나 아래 옵션을 선택해주세요.`
    : "절삭공구 추천을 도와드릴 수 있어요. 가공 조건을 알려주세요."

  const chips = hasSession
    ? ["추천해주세요", "⟵ 이전 단계", "처음부터 다시"]
    : ["소재 입력", "직경 입력"]

  return { text, chips, purpose: "question", modelUsed: "sonnet" }
}
