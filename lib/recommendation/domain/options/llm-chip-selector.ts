/**
 * LLM Chip Selector — Haiku가 전체 맥락을 보고 최적 칩을 선택/정렬.
 *
 * 후보 옵션에서만 선택 (새로 발명 금지)
 * Haiku 실패 시 → deterministic fallback (priority score 순)
 */

import { resolveModel, type LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { SmartOption } from "./types"
import type { DisplayedOption } from "@/lib/recommendation/domain/types"
import { smartOptionsToChips, smartOptionsToDisplayedOptions } from "./option-bridge"

const LLM_CHIP_SELECTOR_MODEL = resolveModel("haiku")

export interface ConversationTurnSlim {
  role: "user" | "assistant"
  text: string
}

export interface ChipSelectionContext {
  userMessage: string
  assistantText: string
  mode: string | null
  pendingField: string | null
  candidateCount: number
  appliedFilters: Array<{ field: string; value: string }>
  resolutionStatus: string | null
  displayedProducts: string[]
  /** User cognitive state */
  userState: string | null
  confusedAbout: string | null
  /** Intent shift detected */
  intentShift: string | null
  /** What UI block user is looking at */
  referencedUIBlock: string | null
  /** Frame relation — how user responded */
  frameRelation: string | null
  /** Fields already answered in conversation */
  answeredFields: string[]
  /** Conversation depth (turns in current flow) */
  conversationDepth: number
  /** Suggested next action from context interpreter */
  suggestedNextAction: string | null
  /** Whether conflicts were detected */
  hasConflict: boolean
  /** Recent conversation turns (newest last) */
  recentTurns: ConversationTurnSlim[]
}

export interface ChipSelectionResult {
  chips: string[]
  displayedOptions: DisplayedOption[]
  selectedByLLM: boolean
}

/**
 * Use Haiku to select and order the best chips from candidate options.
 * Always attempts LLM selection (even for few options) because ordering matters.
 * Falls back to deterministic priority score ordering if LLM fails.
 */
export async function selectChipsWithLLM(
  candidateOptions: SmartOption[],
  context: ChipSelectionContext,
  provider: LLMProvider
): Promise<ChipSelectionResult> {
  if (candidateOptions.length === 0) {
    return { chips: [], displayedOptions: [], selectedByLLM: false }
  }

  // Single option — no selection needed
  if (candidateOptions.length === 1) {
    return {
      chips: smartOptionsToChips(candidateOptions),
      displayedOptions: smartOptionsToDisplayedOptions(candidateOptions),
      selectedByLLM: false,
    }
  }

  if (!provider.available()) {
    return fallback(candidateOptions)
  }

  try {
    // Build rich option descriptions for LLM
    const optionList = candidateOptions.map((o, i) => {
      const entry: Record<string, unknown> = {
        i,
        label: o.label,
        family: o.family,
      }
      if (o.field) entry.field = o.field
      if (o.value) entry.value = o.value
      if (o.reason) entry.reason = o.reason
      if (o.subtitle) entry.sub = o.subtitle
      if (o.projectedCount != null) entry.projected = o.projectedCount
      if (o.projectedDelta != null) entry.delta = o.projectedDelta
      if (o.destructive) entry.destructive = true
      if (o.recommended) entry.recommended = true
      return entry
    })

    // Build situation summary — compact but information-dense
    const situation = [
      `사용자: "${context.userMessage}"`,
      `응답: "${context.assistantText.slice(0, 150)}"`,
      `모드: ${context.mode ?? "unknown"}`,
      context.pendingField ? `질문 중인 필드: ${context.pendingField}` : null,
      `후보 제품: ${context.candidateCount}개`,
      context.appliedFilters.length > 0
        ? `필터: ${context.appliedFilters.map(f => `${f.field}=${f.value}`).join(", ")}`
        : "필터: 없음",
      context.userState && context.userState !== "clear"
        ? `유저 상태: ${context.userState}${context.confusedAbout ? ` (${context.confusedAbout})` : ""}`
        : null,
      context.intentShift && context.intentShift !== "none"
        ? `의도 변화: ${context.intentShift}`
        : null,
      context.frameRelation
        ? `응답 유형: ${context.frameRelation}`
        : null,
      context.hasConflict ? "⚠ 필터 충돌 감지됨" : null,
      context.answeredFields.length > 0
        ? `이미 답한 필드: ${context.answeredFields.join(", ")}`
        : null,
      context.conversationDepth > 0
        ? `대화 깊이: ${context.conversationDepth}턴`
        : null,
      context.displayedProducts.length > 0
        ? `표시 제품: ${context.displayedProducts.slice(0, 3).join(", ")}`
        : null,
      context.referencedUIBlock
        ? `유저가 보는 UI: ${context.referencedUIBlock}`
        : null,
      context.suggestedNextAction
        ? `시스템 추천 액션: ${context.suggestedNextAction}`
        : null,
    ].filter(Boolean).join("\n")

    // Build conversation history — recent turns detailed, older turns summarized
    const conversationSection = buildConversationSection(context.recentTurns)

    const prompt = `YG-1 절삭공구 추천 챗봇의 칩(버튼) 선택기.
대화 흐름을 파악하고, 지금 사용자가 클릭할 가능성이 높은 칩을 골라 순서대로 배치하세요.
${conversationSection}
## 현재 상황 (★ 최신 — 이 턴에 집중)
${situation}

## 후보 칩
${JSON.stringify(optionList)}

## 판단 기준
- ★ 마지막 대화의 맥락이 가장 중요 — 사용자가 방금 무엇을 원했는지에 집중
- 질문에 대한 직접 답변 칩을 최우선 (pendingField의 값들)
- "상관없음"/"건너뛰기" 칩이 있으면 반드시 포함 (마지막 배치)
- 유저가 confused/uncertain이면 설명·위임 칩 우선
- 충돌이 있으면 repair 칩 우선
- 이미 답한 필드(${context.answeredFields.join(",") || "없음"})의 narrowing 칩은 낮은 우선순위
- destructive(리셋) 칩은 맨 끝에만
- 2~6개 선택, 가장 유용한 것부터

JSON만: {"selected":[0,3,1]}`

    const raw = await provider.complete(
      "칩 선택기. JSON만.",
      [{ role: "user", content: prompt }],
      1500,
      LLM_CHIP_SELECTOR_MODEL
    )

    const parsed = safeParseJSON(raw)
    if (parsed?.selected && Array.isArray(parsed.selected)) {
      const indices = (parsed.selected as number[]).filter(i =>
        typeof i === "number" && i >= 0 && i < candidateOptions.length
      )

      if (indices.length >= 1) {
        const selected = indices.map(i => candidateOptions[i])
        console.log(`[llm-chip-selector] Selected ${selected.length}/${candidateOptions.length}: ${selected.map(o => o.label).join(", ")}`)
        return {
          chips: smartOptionsToChips(selected),
          displayedOptions: smartOptionsToDisplayedOptions(selected),
          selectedByLLM: true,
        }
      }
    }
  } catch (error) {
    console.warn("[llm-chip-selector] LLM failed:", error)
  }

  return fallback(candidateOptions)
}

/**
 * 대화 히스토리를 Haiku용으로 압축:
 * - 최근 4턴: 원문 (100자 제한)
 * - 그 이전: 1줄 요약 (50자 제한)
 * 최신 대화에 집중하되 전체 흐름도 파악 가능
 */
function buildConversationSection(turns: ConversationTurnSlim[]): string {
  if (turns.length === 0) return ""

  const lines: string[] = []
  const recentCount = 4 // 최근 4턴은 상세
  const total = turns.length

  // 오래된 턴: 요약 (50자)
  if (total > recentCount) {
    lines.push("## 이전 대화 (요약)")
    const olderTurns = turns.slice(0, total - recentCount)
    // 너무 많으면 마지막 10개만
    const shown = olderTurns.slice(-10)
    for (const t of shown) {
      const tag = t.role === "user" ? "U" : "A"
      lines.push(`${tag}: ${t.text.slice(0, 50).replace(/\n/g, " ")}${t.text.length > 50 ? "…" : ""}`)
    }
    if (olderTurns.length > 10) {
      lines.push(`(... 이전 ${olderTurns.length - 10}턴 생략)`)
    }
  }

  // 최근 턴: 상세 (100자)
  lines.push("## 최근 대화 (★ 핵심)")
  const recent = turns.slice(-recentCount)
  for (const t of recent) {
    const tag = t.role === "user" ? "사용자" : "시스템"
    lines.push(`${tag}: ${t.text.slice(0, 100).replace(/\n/g, " ")}${t.text.length > 100 ? "…" : ""}`)
  }

  return lines.join("\n") + "\n"
}

function fallback(options: SmartOption[]): ChipSelectionResult {
  const sorted = [...options].sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))
  const selected = sorted.slice(0, 6)
  return {
    chips: smartOptionsToChips(selected),
    displayedOptions: smartOptionsToDisplayedOptions(selected),
    selectedByLLM: false,
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
