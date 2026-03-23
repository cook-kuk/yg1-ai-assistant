/**
 * Memory Compressor — Hierarchical compression for conversation turns.
 *
 * Layer A: Recent raw turns (last 12-20 kept verbatim)
 * Layer B: Structured working memory (always maintained)
 * Layer C: Episodic summaries for older turns
 *
 * Compression rules:
 * - Never compress the latest assistant question
 * - Never compress the latest user message
 * - Latest 6-8 turns should remain raw
 * - Preserve unresolved threads
 * - Preserve resolved facts, active filters, revision signals
 * - Preserve still-relevant product references
 *
 * Deterministic. No LLM calls.
 */

import type { ConversationMemory } from "./conversation-memory"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"

// ── Episodic Summary ─────────────────────────────────────────
export interface EpisodeSummary {
  id: string
  span: { fromTurn: number; toTurn: number }
  summary: string
  resolvedFacts: Array<{ field: string; value: string }>
  changedFacts: Array<{ field: string; oldValue?: string; newValue?: string }>
  unresolvedThreads: string[]
  referencedProducts: string[]
  uiArtifactsMentioned: string[]
  correctionSignals: string[]
}

// ── Conversation Turn (for compression) ─────────────────────
export interface ConversationTurn {
  role: "user" | "assistant"
  text: string
  turn: number
}

// ── Compression Configuration ────────────────────────────────
const RAW_TURNS_TO_KEEP = 12
const COMPRESSION_TRIGGER_COUNT = 20
const EPISODE_SPAN = 6

/**
 * Compress older turns while keeping recent ones raw.
 * Returns both the recent raw turns and episodic summaries.
 */
export function compressOlderTurns(
  allTurns: ConversationTurn[],
  memory: ConversationMemory | null,
  sessionState: ExplorationSessionState | null
): {
  recentTurns: ConversationTurn[]
  episodicSummaries: EpisodeSummary[]
} {
  // If few enough turns, keep them all raw
  if (allTurns.length <= RAW_TURNS_TO_KEEP) {
    return { recentTurns: allTurns, episodicSummaries: [] }
  }

  // Split into recent (keep raw) and older (compress)
  const recentTurns = allTurns.slice(-RAW_TURNS_TO_KEEP)
  const olderTurns = allTurns.slice(0, -RAW_TURNS_TO_KEEP)

  // Only compress if we have enough older turns
  if (olderTurns.length < EPISODE_SPAN) {
    return { recentTurns, episodicSummaries: [] }
  }

  // Build episodic summaries from older turns
  const episodicSummaries: EpisodeSummary[] = []

  for (let i = 0; i < olderTurns.length; i += EPISODE_SPAN) {
    const chunk = olderTurns.slice(i, i + EPISODE_SPAN)
    if (chunk.length === 0) continue

    const summary = buildEpisodeSummary(chunk, memory, sessionState)
    episodicSummaries.push(summary)
  }

  return { recentTurns, episodicSummaries }
}

/**
 * Build an episodic summary from a chunk of turns.
 * Extracts the key signals deterministically.
 */
function buildEpisodeSummary(
  turns: ConversationTurn[],
  memory: ConversationMemory | null,
  sessionState: ExplorationSessionState | null
): EpisodeSummary {
  const fromTurn = turns[0].turn
  const toTurn = turns[turns.length - 1].turn

  // Extract resolved facts mentioned in these turns
  const resolvedFacts: Array<{ field: string; value: string }> = []
  const changedFacts: Array<{ field: string; oldValue?: string; newValue?: string }> = []
  const unresolvedThreads: string[] = []
  const referencedProducts: string[] = []
  const uiArtifactsMentioned: string[] = []
  const correctionSignals: string[] = []

  // Patterns for extraction
  const productCodePattern = /(CE\d+[A-Z]*\d*|GNX\d+|SEM[A-Z]*\d+)/gi
  const fieldMentionPattern = /(코팅|날수|날 수|직경|소재|재질|시리즈|서브타입|엔드밀|볼|스퀘어|라디우스)/gi
  const correctionPattern = /(아니|틀렸|잘못|바꿔|다시|변경|수정)/gi
  const questionPattern = /[?？]|몰라|모르겠|뭐야/

  // Build summary from turn content
  const summaryParts: string[] = []

  for (const turn of turns) {
    const text = turn.text

    // Product references
    const productMatches = text.match(productCodePattern)
    if (productMatches) {
      for (const m of productMatches) {
        if (!referencedProducts.includes(m.toUpperCase())) {
          referencedProducts.push(m.toUpperCase())
        }
      }
    }

    // Correction signals
    if (turn.role === "user" && correctionPattern.test(text)) {
      correctionSignals.push(text.slice(0, 50))
    }

    // Unresolved questions
    if (turn.role === "user" && questionPattern.test(text)) {
      unresolvedThreads.push(text.slice(0, 80))
    }

    // Summarize user turns
    if (turn.role === "user") {
      summaryParts.push(`사용자: ${text.slice(0, 60)}`)
    }
  }

  // Extract facts from memory items within this turn range
  if (memory) {
    for (const item of memory.items) {
      if (item.turnCreated >= fromTurn && item.turnCreated <= toTurn) {
        if (item.status === "resolved") {
          resolvedFacts.push({ field: item.field, value: item.value })
        }
        if (item.replacedBy) {
          changedFacts.push({ field: item.field, oldValue: item.value })
        }
      }
    }
  }

  // Check unresolved threads against current resolution
  // If memory has pending clarifications that started in this range, keep them
  if (memory?.followUp.pendingDecisionType && memory.followUp.lastAskedField) {
    const relevantQA = memory.recentQA.filter(
      qa => qa.turn >= fromTurn && qa.turn <= toTurn
    )
    for (const qa of relevantQA) {
      if (!qa.answer || qa.answer.includes("몰라") || qa.answer.includes("뭐")) {
        unresolvedThreads.push(`${qa.field}: ${qa.question}`)
      }
    }
  }

  return {
    id: `episode_${fromTurn}_${toTurn}`,
    span: { fromTurn, toTurn },
    summary: summaryParts.join(" | ").slice(0, 200) || `턴 ${fromTurn}-${toTurn} 요약`,
    resolvedFacts,
    changedFacts,
    unresolvedThreads,
    referencedProducts,
    uiArtifactsMentioned,
    correctionSignals,
  }
}

/**
 * Format episodic summaries for LLM prompt context.
 */
export function formatEpisodicSummaries(summaries: EpisodeSummary[]): string {
  if (summaries.length === 0) return ""

  const lines: string[] = ["═══ 이전 대화 요약 ═══"]
  for (const s of summaries) {
    lines.push(`[턴 ${s.span.fromTurn}-${s.span.toTurn}] ${s.summary}`)
    if (s.resolvedFacts.length > 0) {
      lines.push(`  확정: ${s.resolvedFacts.map(f => `${f.field}=${f.value}`).join(", ")}`)
    }
    if (s.unresolvedThreads.length > 0) {
      lines.push(`  미해결: ${s.unresolvedThreads.join("; ")}`)
    }
    if (s.correctionSignals.length > 0) {
      lines.push(`  수정 신호: ${s.correctionSignals.join("; ")}`)
    }
  }
  return lines.join("\n")
}
