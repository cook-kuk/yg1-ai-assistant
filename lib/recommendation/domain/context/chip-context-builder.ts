/**
 * Chip Context Builder — Builds structured context for chip generation and LLM reranking.
 *
 * Assembles all signals needed for chip priority decisions:
 * - pending question
 * - user cognitive state
 * - recent conversation summary
 * - session state
 * - displayed products
 */

import type { PendingQuestion } from "./pending-question-detector"
import type { UserCognitiveState } from "./user-understanding-detector"
import type { ExplorationSessionState, CandidateSnapshot, AppliedFilter, RecommendationInput } from "@/lib/recommendation/domain/types"

export interface ChipContext {
  /** Latest assistant question text, if any */
  latestAssistantQuestion: string | null
  /** Structured pending question analysis */
  pendingQuestion: PendingQuestion | null
  /** Latest user message */
  latestUserMessage: string | null
  /** User's cognitive state */
  userState: UserCognitiveState
  /** What the user is confused about specifically */
  confusedAbout: string | null
  /** Current mode */
  mode: string
  /** Resolved intake facts */
  resolvedFacts: Array<{ field: string; value: string }>
  /** Active narrowing filters */
  activeFilters: Array<{ field: string; value: string }>
  /** Top displayed/recommended products */
  displayedProducts: Array<{ code: string; series: string | null; coating: string | null; fluteCount: number | null }>
  /** Last asked field */
  lastAskedField: string | null
  /** Recent conversation summary (last 3-5 turns) */
  recentTurnsSummary: string[]
  /** Fields already answered */
  answeredFields: string[]
}

/**
 * Build chip context from session state and latest messages.
 */
export function buildChipContext(
  sessionState: ExplorationSessionState | null,
  resolvedInput: RecommendationInput,
  latestUserMessage: string | null,
  latestAssistantText: string | null,
  pendingQuestion: PendingQuestion | null,
  userState: UserCognitiveState,
  confusedAbout: string | null,
  recentMessages: Array<{ role: string; text: string }>
): ChipContext {
  const resolvedFacts: Array<{ field: string; value: string }> = []
  if (resolvedInput.material) resolvedFacts.push({ field: "material", value: resolvedInput.material })
  if (resolvedInput.operationType) resolvedFacts.push({ field: "operationType", value: resolvedInput.operationType })
  if (resolvedInput.diameterMm) resolvedFacts.push({ field: "diameterMm", value: String(resolvedInput.diameterMm) })
  if (resolvedInput.flutePreference) resolvedFacts.push({ field: "fluteCount", value: String(resolvedInput.flutePreference) })
  if (resolvedInput.coatingPreference) resolvedFacts.push({ field: "coating", value: resolvedInput.coatingPreference })

  const activeFilters = (sessionState?.appliedFilters ?? [])
    .filter(f => f.op !== "skip")
    .map(f => ({ field: f.field, value: f.value }))

  const displayedProducts = (sessionState?.displayedCandidates ?? [])
    .slice(0, 5)
    .map(c => ({
      code: c.displayCode,
      series: c.seriesName,
      coating: c.coating,
      fluteCount: c.fluteCount,
    }))

  const answeredFields = [
    ...new Set([
      ...(sessionState?.appliedFilters ?? []).map(f => f.field),
      ...(sessionState?.narrowingHistory ?? []).flatMap(t => t.extractedFilters.map(f => f.field)),
    ]),
  ]

  // Build recent turns summary (last 5 messages)
  const recentTurnsSummary = recentMessages
    .slice(-6)
    .map(m => `${m.role === "user" ? "사용자" : "시스템"}: ${m.text.slice(0, 100)}${m.text.length > 100 ? "..." : ""}`)

  return {
    latestAssistantQuestion: pendingQuestion?.questionText ?? (latestAssistantText ? extractLastQuestion(latestAssistantText) : null),
    pendingQuestion,
    latestUserMessage: latestUserMessage,
    userState,
    confusedAbout,
    mode: sessionState?.currentMode ?? "narrowing",
    resolvedFacts,
    activeFilters,
    displayedProducts,
    lastAskedField: sessionState?.lastAskedField ?? null,
    recentTurnsSummary,
    answeredFields,
  }
}

function extractLastQuestion(text: string): string | null {
  const sentences = text.split(/[.。!\n]/).filter(s => s.trim().length > 3)
  const lastWithQ = sentences.filter(s => /[?？]/.test(s) || /시겠|할까|원하시|보시겠/.test(s))
  return lastWithQ.length > 0 ? lastWithQ[lastWithQ.length - 1].trim() : null
}

/**
 * Format chip context as a structured prompt string for LLM reranking.
 */
export function formatChipContextForLLM(ctx: ChipContext): string {
  const lines: string[] = []

  lines.push(`═══ 칩 리랭킹 컨텍스트 ═══`)

  if (ctx.latestAssistantQuestion) {
    lines.push(`\n▶ 최근 시스템 질문: "${ctx.latestAssistantQuestion}"`)
  }
  if (ctx.latestUserMessage) {
    lines.push(`▶ 최근 사용자 메시지: "${ctx.latestUserMessage}"`)
  }
  lines.push(`▶ 사용자 상태: ${ctx.userState}${ctx.confusedAbout ? ` (${ctx.confusedAbout}에 대해)` : ""}`)
  lines.push(`▶ 현재 모드: ${ctx.mode}`)

  if (ctx.resolvedFacts.length > 0) {
    lines.push(`\n▶ 확정된 조건: ${ctx.resolvedFacts.map(f => `${f.field}=${f.value}`).join(", ")}`)
  }
  if (ctx.activeFilters.length > 0) {
    lines.push(`▶ 적용된 필터: ${ctx.activeFilters.map(f => `${f.field}=${f.value}`).join(", ")}`)
  }
  if (ctx.displayedProducts.length > 0) {
    lines.push(`▶ 표시된 제품: ${ctx.displayedProducts.map(p => p.code).join(", ")}`)
  }
  if (ctx.answeredFields.length > 0) {
    lines.push(`▶ 이미 답변한 필드: ${ctx.answeredFields.join(", ")}`)
  }

  if (ctx.recentTurnsSummary.length > 0) {
    lines.push(`\n▶ 최근 대화:`)
    for (const turn of ctx.recentTurnsSummary) {
      lines.push(`  ${turn}`)
    }
  }

  return lines.join("\n")
}
