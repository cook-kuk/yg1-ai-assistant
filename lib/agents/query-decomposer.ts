/**
 * Query Decomposer — Detects and splits multi-intent user messages.
 *
 * Not every multi-concept sentence is multi-intent.
 * Only split when the message mixes materially different action categories:
 *   - task_change: new search, reset, start new task
 *   - filtering: apply filter, replace slot, skip
 *   - comparison: compare products
 *   - restore: undo, go back, resume task, restore group
 *   - explanation: what is X, why Y, how does Z work
 *   - side_conversation: greetings, math, off-topic
 *
 * When multiple actions would change state, the orchestrator should
 * ask for confirmation before executing all of them.
 */

import type { LLMProvider } from "@/lib/llm/provider"
import type { ExplorationSessionState } from "@/lib/types/exploration"

// ── Types ────────────────────────────────────────────────────────

export type IntentCategory =
  | "task_change"
  | "filtering"
  | "comparison"
  | "restore"
  | "explanation"
  | "side_conversation"

export interface IntentChunk {
  text: string
  category: IntentCategory
}

export interface DecompositionResult {
  isMultiIntent: boolean
  chunks: IntentChunk[]
  requiresConfirmation: boolean
  reasoning: string
}

// ── Execution Plan Types ────────────────────────────────────

export interface ExecutionStep {
  chunk: IntentChunk
  order: number
  dependsOn: number[]       // indices of steps this depends on
  isSideEffect: boolean     // explanation/side_conversation — does not mutate state
}

export interface ExecutionPlan {
  steps: ExecutionStep[]
  primaryIndex: number       // the main state-changing step (or first step)
  sideEffectIndices: number[] // explanation/side_conversation steps to merge
  requiresConfirmation: boolean
  planText: string
}

// Categories that mutate session state
const STATE_CHANGING: Set<IntentCategory> = new Set([
  "task_change",
  "filtering",
  "restore",
])

/**
 * Decompose a user message into intent chunks.
 * Uses Haiku for speed (~200ms).
 *
 * Returns single-intent result for most messages.
 * Only splits when genuinely mixed action types are detected.
 */
export async function decomposeQuery(
  userMessage: string,
  sessionState: ExplorationSessionState | null,
  provider: LLMProvider
): Promise<DecompositionResult> {
  // Fast path: short messages are almost always single-intent
  if (userMessage.length < 15) {
    return {
      isMultiIntent: false,
      chunks: [{ text: userMessage, category: inferSingleCategory(userMessage) }],
      requiresConfirmation: false,
      reasoning: "short_message",
    }
  }

  // Fast path: if last action was ask_clarification or confirm_multi_intent, user is responding to options — don't decompose
  if (sessionState?.lastAction === "ask_clarification" || sessionState?.lastAction === "confirm_multi_intent") {
    return {
      isMultiIntent: false,
      chunks: [{ text: userMessage, category: "filtering" }],
      requiresConfirmation: false,
      reasoning: "responding_to_clarification",
    }
  }

  const systemPrompt = `당신은 사용자 메시지를 분석하여 여러 의도가 섞여 있는지 판단하는 분류기입니다.

═══ 의도 카테고리 ═══
- task_change: 새 검색, 리셋, 새 작업 시작, 조건 완전 변경
- filtering: 필터 적용, 슬롯 교체, 스킵, 좁히기 답변
- comparison: 제품 비교 요청
- restore: 되돌리기, 이전 단계, 이전 작업 복원, 그룹 복원
- explanation: 용어 설명, 이유 질문, 개념 질문
- side_conversation: 인사, 잡담, 수학, 오프토픽

═══ 규칙 ═══
1. 대부분의 메시지는 단일 의도 — 억지로 쪼개지 마세요
2. "코팅이 뭐야? Diamond로 해줘" → 2개: explanation + filtering
3. "4날로 바꾸고 코팅은 DLC" → 1개: filtering (같은 카테고리 2개 = 단일)
4. "이전으로 돌아가서 Square로 다시 해줘" → 2개: restore + filtering
5. "이 두 개 비교해주고 나서 추천해줘" → 2개: comparison + task_change
6. "DLC가 뭐야?" → 1개: explanation (단일 설명 질문)
7. "스테인리스 가공할 때 뭐가 좋아?" → 1개: explanation
8. "처음부터 다시 하고 알루미늄 10mm로" → 2개: task_change + filtering

같은 카테고리 내 복수 동작은 쪼개지 않음 (예: 필터 2개 = 단일 filtering)

═══ 현재 상태 ═══
- 마지막 액션: ${sessionState?.lastAction ?? "없음"}
- 후보 수: ${sessionState?.candidateCount ?? "?"}
- 적용 필터: ${sessionState?.appliedFilters?.filter(f => f.op !== "skip").map(f => `${f.field}=${f.value}`).join(", ") || "없음"}

═══ 응답 형식 (JSON만) ═══
{
  "is_multi": boolean,
  "chunks": [{ "text": "원문 부분", "category": "카테고리" }],
  "reasoning": "판단 근거 1문장"
}`

  try {
    const raw = await provider.complete(
      systemPrompt,
      [{ role: "user", content: userMessage }],
      300,
      "haiku"
    )

    const parsed = safeParseJSON(raw)
    if (!parsed || typeof parsed.is_multi !== "boolean" || !Array.isArray(parsed.chunks)) {
      return singleIntentFallback(userMessage)
    }

    const chunks: IntentChunk[] = parsed.chunks
      .filter((c: Record<string, unknown>) => c.text && c.category)
      .map((c: Record<string, unknown>) => ({
        text: String(c.text),
        category: validateCategory(String(c.category)),
      }))

    if (chunks.length <= 1) {
      return {
        isMultiIntent: false,
        chunks: chunks.length === 1 ? chunks : [{ text: userMessage, category: "filtering" }],
        requiresConfirmation: false,
        reasoning: String(parsed.reasoning ?? "single_intent"),
      }
    }

    // Count how many state-changing categories are present
    const stateChangingCategories = new Set(
      chunks.filter(c => STATE_CHANGING.has(c.category)).map(c => c.category)
    )
    const requiresConfirmation = stateChangingCategories.size >= 2

    return {
      isMultiIntent: true,
      chunks,
      requiresConfirmation,
      reasoning: String(parsed.reasoning ?? "multi_intent"),
    }
  } catch (e) {
    console.warn("[query-decomposer] Failed:", e)
    return singleIntentFallback(userMessage)
  }
}

/**
 * Build an execution plan description for confirmation.
 * Used when requiresConfirmation is true.
 */
export function buildExecutionPlanText(chunks: IntentChunk[]): string {
  const CATEGORY_LABELS: Record<IntentCategory, string> = {
    task_change: "작업 변경",
    filtering: "필터 적용",
    comparison: "제품 비교",
    restore: "상태 복원",
    explanation: "설명/질문",
    side_conversation: "일반 대화",
  }

  const steps = chunks.map((c, i) =>
    `${i + 1}. [${CATEGORY_LABELS[c.category]}] ${c.text}`
  )

  return `여러 작업이 감지되었습니다:\n\n${steps.join("\n")}\n\n순서대로 실행할까요?`
}

/**
 * Order chunks for safe execution.
 * restore/task_change first, then filtering, then read-only actions.
 */
export function orderChunksForExecution(chunks: IntentChunk[]): IntentChunk[] {
  const priority: Record<IntentCategory, number> = {
    restore: 0,
    task_change: 1,
    filtering: 2,
    comparison: 3,
    explanation: 4,
    side_conversation: 5,
  }
  return [...chunks].sort((a, b) => priority[a.category] - priority[b.category])
}

// ── Execution Planning ──────────────────────────────────────────

/**
 * Build an ordered execution plan from decomposed chunks.
 *
 * Rules:
 * - restore must happen before filtering/task_change (dependency)
 * - task_change must happen before filtering (dependency)
 * - explanation/side_conversation are side-effects — they don't mutate state
 *   and can be merged into the response of the primary action
 * - If ≥2 state-changing categories → requiresConfirmation
 */
export function planActions(decomposition: DecompositionResult): ExecutionPlan {
  if (!decomposition.isMultiIntent || decomposition.chunks.length <= 1) {
    const chunk = decomposition.chunks[0] ?? { text: "", category: "filtering" as IntentCategory }
    return {
      steps: [{ chunk, order: 0, dependsOn: [], isSideEffect: false }],
      primaryIndex: 0,
      sideEffectIndices: [],
      requiresConfirmation: false,
      planText: "",
    }
  }

  const ordered = orderChunksForExecution(decomposition.chunks)

  const steps: ExecutionStep[] = ordered.map((chunk, i) => {
    const isSideEffect = !STATE_CHANGING.has(chunk.category)
    const dependsOn: number[] = []

    // Build dependencies: state-changing steps depend on prior state-changing steps
    if (!isSideEffect) {
      for (let j = 0; j < i; j++) {
        if (STATE_CHANGING.has(ordered[j].category)) {
          dependsOn.push(j)
        }
      }
    }

    return { chunk, order: i, dependsOn, isSideEffect }
  })

  // Find primary = first state-changing step; if none, first step
  const primaryIndex = steps.findIndex(s => !s.isSideEffect)
  const sideEffectIndices = steps
    .map((s, i) => s.isSideEffect ? i : -1)
    .filter(i => i >= 0)

  const planText = buildExecutionPlanText(ordered)

  return {
    steps,
    primaryIndex: primaryIndex >= 0 ? primaryIndex : 0,
    sideEffectIndices,
    requiresConfirmation: decomposition.requiresConfirmation,
    planText,
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function singleIntentFallback(text: string): DecompositionResult {
  return {
    isMultiIntent: false,
    chunks: [{ text, category: inferSingleCategory(text) }],
    requiresConfirmation: false,
    reasoning: "fallback",
  }
}

function inferSingleCategory(text: string): IntentCategory {
  const lower = text.toLowerCase()
  if (/처음|리셋|새로|다시\s*시작/.test(lower)) return "task_change"
  if (/비교|차이/.test(lower)) return "comparison"
  if (/이전|되돌|돌아가|undo/.test(lower)) return "restore"
  if (/뭐야|뭔가요|설명|알려|왜|어떻게/.test(lower)) return "explanation"
  return "filtering"
}

function validateCategory(raw: string): IntentCategory {
  const valid: IntentCategory[] = [
    "task_change", "filtering", "comparison",
    "restore", "explanation", "side_conversation",
  ]
  return valid.includes(raw as IntentCategory) ? (raw as IntentCategory) : "filtering"
}

function safeParseJSON(raw: string): Record<string, unknown> | null {
  try {
    const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim()
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}
