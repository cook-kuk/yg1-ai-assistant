/**
 * Chip-context builder.
 *
 * Keeps a compact prompt-oriented view over the unified turn context.
 */

import type { PendingQuestion } from "./pending-question-detector"
import type { UserCognitiveState } from "./user-understanding-detector"
import type { ExplorationSessionState, RecommendationInput } from "@/lib/recommendation/domain/types"
import type { UnifiedTurnContext } from "./turn-context-builder"

export interface ChipContext {
  latestAssistantQuestion: string | null
  pendingQuestion: PendingQuestion | null
  latestUserMessage: string | null
  userState: UserCognitiveState
  confusedAbout: string | null
  mode: string
  resolvedFacts: Array<{ field: string; value: string }>
  activeFilters: Array<{ field: string; value: string }>
  displayedProducts: Array<{ code: string; series: string | null; coating: string | null; fluteCount: number | null }>
  lastAskedField: string | null
  recentTurnsSummary: string[]
  answeredFields: string[]
  visibleUIBlocks: string[]
  historicalUIArtifacts: string[]
  episodicSummary: string[]
}

export function buildChipContext(
  sessionState: ExplorationSessionState | null,
  resolvedInput: RecommendationInput,
  latestUserMessage: string | null,
  latestAssistantText: string | null,
  pendingQuestion: PendingQuestion | null,
  userState: UserCognitiveState,
  confusedAbout: string | null,
  recentMessages: Array<{ role: string; text: string }>,
): ChipContext {
  const resolvedFacts: Array<{ field: string; value: string }> = []
  if (resolvedInput.material) resolvedFacts.push({ field: "material", value: resolvedInput.material })
  if (resolvedInput.operationType) resolvedFacts.push({ field: "operationType", value: resolvedInput.operationType })
  if (resolvedInput.diameterMm) resolvedFacts.push({ field: "diameterMm", value: String(resolvedInput.diameterMm) })
  if (resolvedInput.flutePreference) resolvedFacts.push({ field: "fluteCount", value: String(resolvedInput.flutePreference) })
  if (resolvedInput.coatingPreference) resolvedFacts.push({ field: "coating", value: resolvedInput.coatingPreference })

  const activeFilters = (sessionState?.appliedFilters ?? [])
    .filter(filter => filter.op !== "skip")
    .map(filter => ({ field: filter.field, value: filter.value }))

  const displayedProducts = (sessionState?.displayedCandidates ?? [])
    .slice(0, 5)
    .map(candidate => ({
      code: candidate.displayCode,
      series: candidate.seriesName,
      coating: candidate.coating,
      fluteCount: candidate.fluteCount,
    }))

  const answeredFields = [
    ...new Set([
      ...(sessionState?.appliedFilters ?? []).map(filter => filter.field),
      ...(sessionState?.narrowingHistory ?? []).flatMap(turn => turn.extractedFilters.map(filter => filter.field)),
    ]),
  ]

  const recentTurnsSummary = recentMessages
    .slice(-6)
    .map(message => `${message.role === "user" ? "user" : "assistant"}: ${summarizeText(message.text)}`)

  return {
    latestAssistantQuestion: pendingQuestion?.questionText ?? (latestAssistantText ? extractLastQuestion(latestAssistantText) : null),
    pendingQuestion,
    latestUserMessage,
    userState,
    confusedAbout,
    mode: sessionState?.currentMode ?? "narrowing",
    resolvedFacts,
    activeFilters,
    displayedProducts,
    lastAskedField: sessionState?.lastAskedField ?? null,
    recentTurnsSummary,
    answeredFields,
    visibleUIBlocks: inferVisibleUiBlocks(sessionState),
    historicalUIArtifacts: [],
    episodicSummary: [],
  }
}

export function buildChipContextFromUnifiedTurnContext(
  turnContext: UnifiedTurnContext,
  pendingQuestion: PendingQuestion | null,
  userState: UserCognitiveState,
  confusedAbout: string | null,
): ChipContext {
  return {
    latestAssistantQuestion: pendingQuestion?.questionText ?? turnContext.latestAssistantQuestion,
    pendingQuestion,
    latestUserMessage: turnContext.latestUserMessage,
    userState,
    confusedAbout,
    mode: turnContext.currentMode,
    resolvedFacts: turnContext.resolvedFacts.map(item => ({ field: item.field, value: item.value })),
    activeFilters: turnContext.activeFilters.map(item => ({ field: item.field, value: item.value })),
    displayedProducts: turnContext.currentCandidates.slice(0, 5).map(candidate => ({
      code: candidate.displayCode,
      series: candidate.seriesName,
      coating: candidate.coating,
      fluteCount: candidate.fluteCount,
    })),
    lastAskedField: turnContext.sessionState?.lastAskedField ?? null,
    recentTurnsSummary: turnContext.recentTurns.slice(-8).map(turn => `${turn.role}: ${summarizeText(turn.text)}`),
    answeredFields: [...new Set([
      ...turnContext.resolvedFacts.map(item => item.field),
      ...turnContext.activeFilters.map(item => item.field),
    ])],
    visibleUIBlocks: turnContext.uiArtifacts.map(artifact => artifact.kind),
    historicalUIArtifacts: turnContext.historicalUIArtifacts
      .slice(-8)
      .map(artifact => `${artifact.turn}:${artifact.visibleUIBlocks.join(",") || "none"}`),
    episodicSummary: turnContext.episodicSummaries
      .slice(-4)
      .map(summary => `[${summary.span.fromTurn}-${summary.span.toTurn}] ${summary.summary}`),
  }
}

function extractLastQuestion(text: string): string | null {
  const sentences = text.split(/[.?\n]/).filter(sentence => sentence.trim().length > 3)
  const lastWithQuestion = sentences.filter(sentence => /[?]/.test(sentence))
  return lastWithQuestion.length > 0 ? lastWithQuestion[lastWithQuestion.length - 1].trim() : null
}

function summarizeText(text: string): string {
  return `${text.slice(0, 100)}${text.length > 100 ? "..." : ""}`
}

function inferVisibleUiBlocks(sessionState: ExplorationSessionState | null): string[] {
  const blocks: string[] = []
  if (sessionState?.displayedOptions?.length) blocks.push("question_prompt")
  if (sessionState?.displayedChips?.length) blocks.push("chips_bar")
  if (sessionState?.lastRecommendationArtifact?.length) blocks.push("recommendation_card")
  if (sessionState?.lastComparisonArtifact) blocks.push("comparison_table")
  return blocks
}

export function formatChipContextForLLM(ctx: ChipContext): string {
  const lines: string[] = ["[Chip Context]"]

  if (ctx.latestAssistantQuestion) lines.push(`assistant_question=${ctx.latestAssistantQuestion}`)
  if (ctx.latestUserMessage) lines.push(`user_message=${ctx.latestUserMessage}`)
  lines.push(`user_state=${ctx.userState}${ctx.confusedAbout ? ` (${ctx.confusedAbout})` : ""}`)
  lines.push(`mode=${ctx.mode}`)

  if (ctx.resolvedFacts.length > 0) {
    lines.push(`resolved_facts=${ctx.resolvedFacts.map(fact => `${fact.field}=${fact.value}`).join(", ")}`)
  }
  if (ctx.activeFilters.length > 0) {
    lines.push(`active_filters=${ctx.activeFilters.map(filter => `${filter.field}=${filter.value}`).join(", ")}`)
  }
  if (ctx.displayedProducts.length > 0) {
    lines.push(`displayed_products=${ctx.displayedProducts.map(product => product.code).join(", ")}`)
  }
  if (ctx.answeredFields.length > 0) {
    lines.push(`answered_fields=${ctx.answeredFields.join(", ")}`)
  }
  if (ctx.visibleUIBlocks.length > 0) {
    lines.push(`visible_ui_blocks=${ctx.visibleUIBlocks.join(", ")}`)
  }
  if (ctx.historicalUIArtifacts.length > 0) {
    lines.push(`historical_ui=${ctx.historicalUIArtifacts.join(" | ")}`)
  }
  if (ctx.episodicSummary.length > 0) {
    lines.push(`episodic_memory=${ctx.episodicSummary.join(" | ")}`)
  }
  if (ctx.recentTurnsSummary.length > 0) {
    lines.push("recent_turns=")
    for (const turn of ctx.recentTurnsSummary) {
      lines.push(`  ${turn}`)
    }
  }

  return lines.join("\n")
}
