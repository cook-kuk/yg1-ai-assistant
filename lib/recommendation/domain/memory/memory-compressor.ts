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

export interface ProcessTraceTransition {
  field: string
  from: string
  to: string
}

export interface ProcessTrace {
  routeAction: string | null
  pendingQuestionField: string | null
  recentFrameRelation: string | null
  optionFamiliesGenerated: string[]
  selectedOptionIds: string[]
  validatorRewrites: string[]
  memoryTransitions: ProcessTraceTransition[]
}

// ── Conversation Turn (for compression) ─────────────────────
export interface ConversationTurn {
  role: "user" | "assistant"
  text: string
  turn: number
}

// ── Rich Turn Record (stores full prompt + UI output) ────────
export interface RichTurnRecord {
  turn: number
  timestamp: number
  // User input
  userMessage: string
  // Assistant output
  assistantText: string
  // UI artifacts at this turn
  uiSnapshot: {
    chips: string[]
    displayedOptions: Array<{ label: string; value: string; field: string }>
    mode: string | null
    lastAskedField: string | null
    lastAction: string | null
    candidateCount: number | null
    displayedProductCodes: string[]
    hasRecommendation: boolean
    hasComparison: boolean
    appliedFilters: Array<{ field: string; value: string; op: string }>
    visibleUIBlocks: string[]
  }
  processTrace: ProcessTrace
}

// ── Compressed Turn (reduced size) ──────────────────────────
export interface CompressedTurnRecord {
  turn: number
  userSummary: string    // truncated user message
  assistantSummary: string  // truncated assistant response
  mode: string | null
  action: string | null
  chipsShown: number     // just count
  candidateCount: number | null
  filtersApplied: string[] // "field=value" format
  keySignals: string[]   // extracted signals (confusion, selection, skip, etc.)
  displayedProductCodes: string[]
  visibleUIBlocks: string[]
  routeAction: string | null
  pendingQuestionField: string | null
  selectedOptionIds: string[]
}

// ── Compression Configuration ────────────────────────────────
const RAW_TURNS_TO_KEEP = 16      // generous: keep last 16 raw turns
const COMPRESSION_TRIGGER_COUNT = 24
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

  // Patterns for extraction (broadened to cover YG-1 product codes)
  const productCodePattern = /([A-Z]{2,5}\d{3,}[A-Z]*\d*|GAA\d+|GEE\d+|JAH\d+|E\d[A-Z]\d+|ALM\d+)/gi
  const fieldMentionPattern = /(코팅|날수|날 수|직경|소재|재질|시리즈|서브타입|엔드밀|볼|스퀘어|라디우스|생크|전장|절삭길이|헬릭스)/gi
  const correctionPattern = /(아니|틀렸|잘못|바꿔|다시|변경|수정)/gi
  const frustrationPattern = /(짜증|답답|왜.*안|이상해|이상한|느려|잘.*안.*돼|문제|오류)/gi
  const questionPattern = /[?？]|몰라|모르겠|뭐야/
  const uiArtifactPattern = /(추천.*결과|비교표|절삭조건|후보.*목록|선택지|칩|카드)/gi

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

    // Frustration signals (preserved for behavioral tracking)
    if (turn.role === "user" && frustrationPattern.test(text)) {
      correctionSignals.push(`[불만] ${text.slice(0, 50)}`)
    }

    // Unresolved questions
    if (turn.role === "user" && questionPattern.test(text)) {
      unresolvedThreads.push(text.slice(0, 80))
    }

    // UI artifact references (preserved for context continuity)
    const uiMatches = text.match(uiArtifactPattern)
    if (uiMatches) {
      for (const m of uiMatches) {
        if (!uiArtifactsMentioned.includes(m)) uiArtifactsMentioned.push(m)
      }
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
        if (item.status === "active") {
          // Active filters also preserved
          resolvedFacts.push({ field: `filter:${item.field}`, value: item.value })
        }
        if (item.replacedBy) {
          changedFacts.push({ field: item.field, oldValue: item.value })
        }
      }
    }
  }

  // Preserve active session filters from this turn range
  if (sessionState?.appliedFilters) {
    for (const f of sessionState.appliedFilters) {
      if (f.appliedAt >= fromTurn && f.appliedAt <= toTurn && f.op !== "skip") {
        if (!resolvedFacts.some(rf => rf.field === f.field && rf.value === f.value)) {
          resolvedFacts.push({ field: f.field, value: f.value })
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

// ════════════════════════════════════════════════════════════════
// FULL CONVERSATION LOG — stores all prompts + UI outputs
// with auto-compression when it gets too large
// ════════════════════════════════════════════════════════════════

/** Configuration */
const RAW_RICH_TURNS_TO_KEEP = 12  // Keep last 12 turns with full UI snapshots
const COMPRESSED_TURNS_LIMIT = 50  // Max compressed turns to keep
const MAX_TEXT_LENGTH_RAW = 2000   // Truncate raw text beyond this
const MAX_TEXT_LENGTH_COMPRESSED = 100 // Truncate compressed summaries

/**
 * Full conversation log — persisted in session state.
 * Holds both raw recent turns and compressed older turns.
 */
export interface ConversationLog {
  /** Recent turns with full prompts + UI snapshots (kept verbatim) */
  recentRichTurns: RichTurnRecord[]
  /** Compressed older turns (summarized, smaller) */
  compressedTurns: CompressedTurnRecord[]
  /** Stats */
  totalTurnsRecorded: number
  lastCompressedAt: number | null
}

export function createEmptyConversationLog(): ConversationLog {
  return {
    recentRichTurns: [],
    compressedTurns: [],
    totalTurnsRecorded: 0,
    lastCompressedAt: null,
  }
}

/**
 * Record a new turn into the conversation log.
 * Automatically compresses older turns when the raw list exceeds the limit.
 */
export function recordTurn(
  log: ConversationLog,
  userMessage: string,
  assistantText: string,
  uiSnapshot: RichTurnRecord["uiSnapshot"],
  processTrace: ProcessTrace = {
    routeAction: null,
    pendingQuestionField: null,
    recentFrameRelation: null,
    optionFamiliesGenerated: [],
    selectedOptionIds: [],
    validatorRewrites: [],
    memoryTransitions: [],
  }
): ConversationLog {
  const updated = { ...log }
  const turnNumber = updated.totalTurnsRecorded + 1

  // Create rich turn record
  const richTurn: RichTurnRecord = {
    turn: turnNumber,
    timestamp: Date.now(),
    userMessage: userMessage.slice(0, MAX_TEXT_LENGTH_RAW),
    assistantText: assistantText.slice(0, MAX_TEXT_LENGTH_RAW),
    uiSnapshot,
    processTrace,
  }

  updated.recentRichTurns = [...updated.recentRichTurns, richTurn]
  updated.totalTurnsRecorded = turnNumber

  // Auto-compress: when raw turns exceed limit, compress oldest ones
  if (updated.recentRichTurns.length > RAW_RICH_TURNS_TO_KEEP) {
    const toCompress = updated.recentRichTurns.slice(0, updated.recentRichTurns.length - RAW_RICH_TURNS_TO_KEEP)
    const toKeep = updated.recentRichTurns.slice(-RAW_RICH_TURNS_TO_KEEP)

    // Compress the overflow turns
    const newCompressed = toCompress.map(compressRichTurn)
    updated.compressedTurns = [...updated.compressedTurns, ...newCompressed]
    updated.recentRichTurns = toKeep
    updated.lastCompressedAt = Date.now()

    // Trim compressed turns if too many
    if (updated.compressedTurns.length > COMPRESSED_TURNS_LIMIT) {
      updated.compressedTurns = updated.compressedTurns.slice(-COMPRESSED_TURNS_LIMIT)
    }

    console.log(`[conversation-log] Compressed ${toCompress.length} turns (total: ${updated.totalTurnsRecorded}, raw: ${updated.recentRichTurns.length}, compressed: ${updated.compressedTurns.length})`)
  }

  return updated
}

/**
 * Compress a rich turn record into a smaller summary.
 */
function compressRichTurn(rich: RichTurnRecord): CompressedTurnRecord {
  const keySignals: string[] = []

  // Extract key signals from user message
  const userLower = rich.userMessage.toLowerCase()
  if (/상관없|패스|스킵|모름/.test(userLower)) keySignals.push("skip")
  if (/추천|골라줘|알아서/.test(userLower)) keySignals.push("delegate")
  if (/몰라|모르겠|뭐야|뭐지/.test(userLower)) keySignals.push("confusion")
  if (/이전|되돌|바꿔|다시/.test(userLower)) keySignals.push("revision")
  if (/비교|차이/.test(userLower)) keySignals.push("compare")
  if (/재고|납기|가격/.test(userLower)) keySignals.push("inventory")
  if (/절삭조건|가공조건/.test(userLower)) keySignals.push("cutting_conditions")
  if (/네|좋아|응|ㅇㅇ/.test(userLower)) keySignals.push("affirmative")

  return {
    turn: rich.turn,
    userSummary: rich.userMessage.slice(0, MAX_TEXT_LENGTH_COMPRESSED),
    assistantSummary: rich.assistantText.slice(0, MAX_TEXT_LENGTH_COMPRESSED),
    mode: rich.uiSnapshot.mode,
    action: rich.uiSnapshot.lastAction,
    chipsShown: rich.uiSnapshot.chips.length,
    candidateCount: rich.uiSnapshot.candidateCount,
    filtersApplied: rich.uiSnapshot.appliedFilters.map(f => `${f.field}=${f.value}`),
    keySignals,
    displayedProductCodes: rich.uiSnapshot.displayedProductCodes.slice(0, 10),
    visibleUIBlocks: rich.uiSnapshot.visibleUIBlocks,
    routeAction: rich.processTrace.routeAction ?? rich.uiSnapshot.lastAction,
    pendingQuestionField: rich.processTrace.pendingQuestionField ?? rich.uiSnapshot.lastAskedField,
    selectedOptionIds: rich.processTrace.selectedOptionIds,
  }
}

/**
 * Format conversation log for LLM prompt context.
 * Recent turns are shown in full, compressed turns as summaries.
 */
export function formatConversationLogForPrompt(log: ConversationLog): string {
  const lines: string[] = []

  // Compressed history (brief)
  if (log.compressedTurns.length > 0) {
    lines.push(`═══ 이전 대화 이력 (요약, ${log.compressedTurns.length}턴) ═══`)
    for (const ct of log.compressedTurns.slice(-10)) { // show last 10 compressed
      const signals = ct.keySignals.length > 0 ? ` [${ct.keySignals.join(",")}]` : ""
      const filters = ct.filtersApplied.length > 0 ? ` 필터:${ct.filtersApplied.join(",")}` : ""
      lines.push(`T${ct.turn}: 사용자="${ct.userSummary}" → ${ct.mode ?? "?"}${ct.action ? `/${ct.action}` : ""} 칩${ct.chipsShown}개 후보${ct.candidateCount ?? "?"}개${filters}${signals}`)
    }
  }

  // Recent turns (full)
  if (log.recentRichTurns.length > 0) {
    lines.push(`\n═══ 최근 대화 (전문, ${log.recentRichTurns.length}턴) ═══`)
    for (const rt of log.recentRichTurns) {
      lines.push(`\n── T${rt.turn} ──`)
      lines.push(`사용자: ${rt.userMessage}`)
      lines.push(`시스템: ${rt.assistantText.slice(0, 300)}${rt.assistantText.length > 300 ? "..." : ""}`)
      lines.push(`칩: [${rt.uiSnapshot.chips.join(", ")}]`)
      lines.push(`모드: ${rt.uiSnapshot.mode ?? "?"} | 액션: ${rt.uiSnapshot.lastAction ?? "?"} | 필드: ${rt.uiSnapshot.lastAskedField ?? "없음"} | 후보: ${rt.uiSnapshot.candidateCount ?? "?"}개`)
      if (rt.uiSnapshot.displayedProductCodes.length > 0) {
        lines.push(`표시 제품: ${rt.uiSnapshot.displayedProductCodes.slice(0, 5).join(", ")}`)
      }
      if (rt.uiSnapshot.appliedFilters.length > 0) {
        lines.push(`필터: ${rt.uiSnapshot.appliedFilters.map(f => `${f.field}=${f.value}`).join(", ")}`)
      }
    }
  }

  return lines.join("\n")
}

/**
 * Get estimated size of conversation log in characters.
 */
export function estimateLogSize(log: ConversationLog): number {
  let size = 0
  for (const rt of log.recentRichTurns) {
    size += rt.userMessage.length + rt.assistantText.length + JSON.stringify(rt.uiSnapshot).length
  }
  for (const ct of log.compressedTurns) {
    size += ct.userSummary.length + ct.assistantSummary.length + 200 // approximate metadata
  }
  return size
}
