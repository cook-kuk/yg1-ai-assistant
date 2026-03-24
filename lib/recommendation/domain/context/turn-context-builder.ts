/**
 * Unified turn-context builder.
 *
 * This is the shared memory object for answer generation, chip generation,
 * option ranking, and answer/option consistency checks.
 */

import type {
  CandidateSnapshot,
  ChatMessage,
  ExplorationSessionState,
  ProductIntakeForm,
  RecommendationInput,
} from "@/lib/recommendation/domain/types"
import type { ConversationMemory, MemoryItem } from "@/lib/recommendation/domain/memory/conversation-memory"
import type { RecentInteractionFrame } from "./recent-interaction-frame"
import type { UIArtifact } from "./ui-context-extractor"
import type {
  CompressedTurnRecord,
  EpisodeSummary,
  ProcessTrace,
  RichTurnRecord,
} from "@/lib/recommendation/domain/memory/memory-compressor"
import { buildRecentInteractionFrame, type UIBlockReference, type UserRelation } from "./recent-interaction-frame"
import { extractUIArtifacts } from "./ui-context-extractor"
import { compressOlderTurns } from "@/lib/recommendation/domain/memory/memory-compressor"

export type MessageRelation =
  | "direct_answer"
  | "clarification_request"
  | "confusion"
  | "challenge"
  | "revise"
  | "followup_on_result"
  | "detail_request"
  | "meta_feedback"
  | "restart"

export type ConversationMode =
  | "intake"
  | "narrowing"
  | "recommended"
  | "compare"
  | "repair"
  | "revise"
  | "explore"

export interface PendingQuestionInfo {
  kind: "binary" | "choice" | "field_selection" | "explanation" | "revision"
  field: string | null
  options: string[]
}

export interface RevisionEvent {
  turn: number
  field: string
  oldValue: string | null
  newValue: string | null
  reason: string
}

export interface ConversationTurn {
  role: "user" | "assistant"
  text: string
  turn: number
}

export type UserState = "clear" | "uncertain" | "confused" | "frustrated"

export interface HistoricalUIArtifactMemory {
  turn: number
  summary: string
  visibleUIBlocks: string[]
  displayedProductCodes: string[]
  displayedOptions: Array<{ label: string; value: string; field: string }>
  chips: string[]
  candidateCount: number | null
  hasRecommendation: boolean
  hasComparison: boolean
}

export interface WorkingMemorySnapshot {
  resolvedFacts: MemoryItem[]
  activeFilters: MemoryItem[]
  tentativeReferences: MemoryItem[]
  pendingQuestions: PendingQuestionInfo[]
  revisionHistory: RevisionEvent[]
  referencedProducts: string[]
  currentDisplayedProducts: string[]
}

export interface UnifiedTurnContext {
  latestAssistantQuestion: string | null
  latestUserMessage: string
  relationToLatestQuestion: MessageRelation

  currentMode: ConversationMode
  currentPendingQuestion: PendingQuestionInfo | null

  workingMemory: WorkingMemorySnapshot
  resolvedFacts: MemoryItem[]
  activeFilters: MemoryItem[]
  tentativeReferences: MemoryItem[]
  pendingQuestions: PendingQuestionInfo[]
  revisionHistory: RevisionEvent[]
  referencedProducts: string[]
  currentDisplayedProducts: string[]

  recentTurns: ConversationTurn[]
  recentRichTurns: RichTurnRecord[]
  historicalTurnSummaries: CompressedTurnRecord[]
  historicalUIArtifacts: HistoricalUIArtifactMemory[]
  episodicSummaries: EpisodeSummary[]

  uiArtifacts: UIArtifact[]
  likelyReferencedUIBlock: UIBlockReference

  userState: UserState
  recentFrame: RecentInteractionFrame
  latestProcessTrace: ProcessTrace | null

  sessionState: ExplorationSessionState | null
  resolvedInput: RecommendationInput
  intakeForm: ProductIntakeForm
  currentCandidates: CandidateSnapshot[]
  conversationMemory: ConversationMemory | null
}

export interface TurnContextBuilderInput {
  latestAssistantText: string | null
  latestUserMessage: string
  messages: ChatMessage[]
  sessionState: ExplorationSessionState | null
  resolvedInput: RecommendationInput
  intakeForm: ProductIntakeForm
  candidates: CandidateSnapshot[]
}

export function buildUnifiedTurnContext(input: TurnContextBuilderInput): UnifiedTurnContext {
  const {
    latestAssistantText,
    latestUserMessage,
    messages,
    sessionState,
    resolvedInput,
    intakeForm,
    candidates,
  } = input

  const recentFrame = buildRecentInteractionFrame(
    latestAssistantText,
    latestUserMessage,
    sessionState,
  )
  const uiArtifacts = extractUIArtifacts(sessionState, candidates)
  const conversationMemory = sessionState?.conversationMemory ?? null

  const { resolvedFacts, activeFilters, tentativeReferences } =
    classifyMemoryItems(conversationMemory, sessionState)

  const relationToLatestQuestion = mapRelation(recentFrame.relation)
  const currentMode = detectMode(sessionState)

  const memoryLayers = buildConversationLayers(messages, sessionState, conversationMemory)

  const currentDisplayedProducts = (
    sessionState?.displayedCandidates?.length
      ? sessionState.displayedCandidates
      : candidates
  ).map(candidate => candidate.displayCode)

  const referencedProducts = uniqueStrings([
    ...recentFrame.referencedProducts,
    ...memoryLayers.referencedProducts,
    ...currentDisplayedProducts,
  ])

  const revisionHistory = buildRevisionHistory(conversationMemory)
  const pendingQuestions = buildPendingQuestions(recentFrame, sessionState)
  const userState = detectUserStateFromFrame(recentFrame)
  const latestProcessTrace =
    memoryLayers.recentRichTurns[memoryLayers.recentRichTurns.length - 1]?.processTrace ?? null

  const workingMemory: WorkingMemorySnapshot = {
    resolvedFacts,
    activeFilters,
    tentativeReferences,
    pendingQuestions,
    revisionHistory,
    referencedProducts,
    currentDisplayedProducts,
  }

  return {
    latestAssistantQuestion: recentFrame.latestAssistantQuestion,
    latestUserMessage,
    relationToLatestQuestion,
    currentMode,
    currentPendingQuestion: recentFrame.currentPendingQuestion,
    workingMemory,
    resolvedFacts,
    activeFilters,
    tentativeReferences,
    pendingQuestions,
    revisionHistory,
    referencedProducts,
    currentDisplayedProducts,
    recentTurns: memoryLayers.recentTurns,
    recentRichTurns: memoryLayers.recentRichTurns,
    historicalTurnSummaries: memoryLayers.historicalTurnSummaries,
    historicalUIArtifacts: memoryLayers.historicalUIArtifacts,
    episodicSummaries: memoryLayers.episodicSummaries,
    uiArtifacts,
    likelyReferencedUIBlock: recentFrame.uiBlock,
    userState,
    recentFrame,
    latestProcessTrace,
    sessionState,
    resolvedInput,
    intakeForm,
    currentCandidates: candidates,
    conversationMemory,
  }
}

function buildConversationLayers(
  messages: ChatMessage[],
  sessionState: ExplorationSessionState | null,
  conversationMemory: ConversationMemory | null,
): {
  recentTurns: ConversationTurn[]
  recentRichTurns: RichTurnRecord[]
  historicalTurnSummaries: CompressedTurnRecord[]
  historicalUIArtifacts: HistoricalUIArtifactMemory[]
  episodicSummaries: EpisodeSummary[]
  referencedProducts: string[]
} {
  const conversationLog = sessionState?.conversationLog
  const rawTurns = messagesToTurns(messages, sessionState?.turnCount ?? 0)

  if (!conversationLog || (!conversationLog.recentRichTurns.length && !conversationLog.compressedTurns.length)) {
    const { recentTurns, episodicSummaries } = compressOlderTurns(rawTurns, conversationMemory, sessionState)
    return {
      recentTurns,
      recentRichTurns: [],
      historicalTurnSummaries: [],
      historicalUIArtifacts: [],
      episodicSummaries,
      referencedProducts: episodicSummaries.flatMap(summary => summary.referencedProducts),
    }
  }

  const recentRichTurns = conversationLog.recentRichTurns.slice(-15)
  const richTurnsAsConversation = flattenRichTurns(recentRichTurns)
  const rawTail = rawTurns.slice(-4)
  const recentTurns = mergeConversationTurns(richTurnsAsConversation, rawTail).slice(-30)
  const historicalTurnSummaries = conversationLog.compressedTurns.slice(-24)
  const historicalUIArtifacts = buildHistoricalUIArtifactMemory(
    recentRichTurns,
    historicalTurnSummaries,
  )
  const episodicSummaries = compressedTurnsToEpisodes(
    historicalTurnSummaries,
    conversationMemory,
    sessionState,
  )

  return {
    recentTurns,
    recentRichTurns,
    historicalTurnSummaries,
    historicalUIArtifacts,
    episodicSummaries,
    referencedProducts: uniqueStrings([
      ...recentRichTurns.flatMap(turn => turn.uiSnapshot.displayedProductCodes),
      ...historicalTurnSummaries.flatMap(turn => turn.displayedProductCodes),
      ...episodicSummaries.flatMap(summary => summary.referencedProducts),
    ]),
  }
}

function flattenRichTurns(recentRichTurns: RichTurnRecord[]): ConversationTurn[] {
  return recentRichTurns.flatMap(turn => ([
    { role: "user" as const, text: turn.userMessage, turn: turn.turn * 2 - 1 },
    { role: "assistant" as const, text: turn.assistantText, turn: turn.turn * 2 },
  ]))
}

function mergeConversationTurns(
  primary: ConversationTurn[],
  supplemental: ConversationTurn[],
): ConversationTurn[] {
  const merged: ConversationTurn[] = []
  const seen = new Set<string>()

  for (const turn of [...primary, ...supplemental]) {
    const key = `${turn.role}:${turn.text}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(turn)
  }

  return merged
}

function buildHistoricalUIArtifactMemory(
  recentRichTurns: RichTurnRecord[],
  historicalTurnSummaries: CompressedTurnRecord[],
): HistoricalUIArtifactMemory[] {
  const richArtifacts = recentRichTurns.map(turn => ({
    turn: turn.turn,
    summary: summarizeRichTurn(turn),
    visibleUIBlocks: turn.uiSnapshot.visibleUIBlocks,
    displayedProductCodes: turn.uiSnapshot.displayedProductCodes,
    displayedOptions: turn.uiSnapshot.displayedOptions,
    chips: turn.uiSnapshot.chips,
    candidateCount: turn.uiSnapshot.candidateCount,
    hasRecommendation: turn.uiSnapshot.hasRecommendation,
    hasComparison: turn.uiSnapshot.hasComparison,
  }))

  const compressedArtifacts = historicalTurnSummaries.map(turn => ({
    turn: turn.turn,
    summary: summarizeCompressedTurn(turn),
    visibleUIBlocks: turn.visibleUIBlocks,
    displayedProductCodes: turn.displayedProductCodes,
    displayedOptions: [],
    chips: [],
    candidateCount: turn.candidateCount,
    hasRecommendation: turn.visibleUIBlocks.includes("recommendation_card"),
    hasComparison: turn.visibleUIBlocks.includes("comparison_table"),
  }))

  return [...compressedArtifacts, ...richArtifacts].slice(-24)
}

function compressedTurnsToEpisodes(
  compressedTurns: CompressedTurnRecord[],
  memory: ConversationMemory | null,
  sessionState: ExplorationSessionState | null,
): EpisodeSummary[] {
  if (compressedTurns.length === 0) return []

  const episodes: EpisodeSummary[] = []
  const chunkSize = 4

  for (let index = 0; index < compressedTurns.length; index += chunkSize) {
    const chunk = compressedTurns.slice(index, index + chunkSize)
    if (!chunk.length) continue

    const fromTurn = chunk[0].turn
    const toTurn = chunk[chunk.length - 1].turn
    const summary = chunk
      .map(turn => `T${turn.turn}:${turn.routeAction ?? turn.action ?? turn.mode ?? "turn"}:${turn.userSummary}`)
      .join(" | ")
      .slice(0, 220)

    episodes.push({
      id: `compressed_episode_${fromTurn}_${toTurn}`,
      span: { fromTurn, toTurn },
      summary,
      resolvedFacts: collectResolvedFactsForSpan(memory, sessionState, fromTurn, toTurn),
      changedFacts: collectChangedFactsForSpan(memory, fromTurn, toTurn),
      unresolvedThreads: uniqueStrings(
        chunk
          .filter(turn => turn.pendingQuestionField || turn.keySignals.includes("confusion"))
          .map(turn =>
            turn.pendingQuestionField
              ? `pending:${turn.pendingQuestionField}`
              : turn.userSummary,
          ),
      ),
      referencedProducts: uniqueStrings(chunk.flatMap(turn => turn.displayedProductCodes)),
      uiArtifactsMentioned: uniqueStrings(chunk.flatMap(turn => turn.visibleUIBlocks)),
      correctionSignals: chunk
        .filter(turn => turn.keySignals.includes("revision") || turn.keySignals.includes("confusion"))
        .map(turn => turn.userSummary),
    })
  }

  return episodes
}

function collectResolvedFactsForSpan(
  memory: ConversationMemory | null,
  sessionState: ExplorationSessionState | null,
  fromTurn: number,
  toTurn: number,
): Array<{ field: string; value: string }> {
  const resolvedFacts: Array<{ field: string; value: string }> = []

  if (memory) {
    for (const item of memory.items) {
      if (item.turnCreated < fromTurn || item.turnCreated > toTurn) continue
      if (item.status === "resolved") {
        resolvedFacts.push({ field: item.field, value: item.value })
      }
      if (item.status === "active") {
        resolvedFacts.push({ field: `filter:${item.field}`, value: item.value })
      }
    }
  }

  if (sessionState?.appliedFilters) {
    for (const filter of sessionState.appliedFilters) {
      if (filter.op === "skip") continue
      if (filter.appliedAt < fromTurn || filter.appliedAt > toTurn) continue
      if (!resolvedFacts.some(item => item.field === filter.field && item.value === filter.value)) {
        resolvedFacts.push({ field: filter.field, value: filter.value })
      }
    }
  }

  return resolvedFacts
}

function collectChangedFactsForSpan(
  memory: ConversationMemory | null,
  fromTurn: number,
  toTurn: number,
): Array<{ field: string; oldValue?: string; newValue?: string }> {
  if (!memory) return []

  return memory.items
    .filter(item => item.turnUpdated >= fromTurn && item.turnUpdated <= toTurn && !!item.replacedBy)
    .map(item => ({
      field: item.field,
      oldValue: item.value,
      newValue: item.replacedBy ?? undefined,
    }))
}

function summarizeRichTurn(turn: RichTurnRecord): string {
  const uiBlocks = turn.uiSnapshot.visibleUIBlocks.length
    ? ` ui=${turn.uiSnapshot.visibleUIBlocks.join(",")}`
    : ""
  return `T${turn.turn} ${turn.processTrace.routeAction ?? turn.uiSnapshot.lastAction ?? "turn"}${uiBlocks}`
}

function summarizeCompressedTurn(turn: CompressedTurnRecord): string {
  const uiBlocks = turn.visibleUIBlocks.length ? ` ui=${turn.visibleUIBlocks.join(",")}` : ""
  return `T${turn.turn} ${turn.routeAction ?? turn.action ?? "turn"}${uiBlocks}`
}

function buildPendingQuestions(
  recentFrame: RecentInteractionFrame,
  sessionState: ExplorationSessionState | null,
): PendingQuestionInfo[] {
  const pendingQuestions: PendingQuestionInfo[] = []

  if (recentFrame.currentPendingQuestion) {
    pendingQuestions.push(recentFrame.currentPendingQuestion)
  }

  const memoryPendingField = sessionState?.conversationMemory?.followUp.lastAskedField
  if (
    memoryPendingField &&
    !pendingQuestions.some(question => question.field === memoryPendingField)
  ) {
    pendingQuestions.push({
      kind: "field_selection",
      field: memoryPendingField,
      options: (sessionState?.displayedOptions ?? []).map(option => option.value),
    })
  }

  return pendingQuestions
}

function classifyMemoryItems(
  memory: ConversationMemory | null,
  sessionState: ExplorationSessionState | null,
): {
  resolvedFacts: MemoryItem[]
  activeFilters: MemoryItem[]
  tentativeReferences: MemoryItem[]
} {
  const resolvedFacts: MemoryItem[] = []
  const activeFilters: MemoryItem[] = []
  const tentativeReferences: MemoryItem[] = []

  if (memory && memory.items.length > 0) {
    for (const item of memory.items) {
      switch (item.status) {
        case "resolved":
          resolvedFacts.push(item)
          break
        case "active":
          activeFilters.push(item)
          break
        case "tentative":
          tentativeReferences.push(item)
          break
      }
    }
  }

  if (sessionState?.resolvedInput) {
    const resolved = sessionState.resolvedInput
    const coveredFields = new Set([...resolvedFacts, ...activeFilters].map(item => item.field))

    if (resolved.material && !coveredFields.has("material")) {
      resolvedFacts.push(makeMemoryItem("material", resolved.material, "intake", "resolved"))
    }
    if (resolved.operationType && !coveredFields.has("operationType")) {
      resolvedFacts.push(makeMemoryItem("operationType", resolved.operationType, "intake", "resolved"))
    }
    if (resolved.toolType && !coveredFields.has("toolType")) {
      resolvedFacts.push(makeMemoryItem("toolType", resolved.toolType, "intake", "resolved"))
    }
    if (resolved.diameterMm && !coveredFields.has("diameterMm")) {
      resolvedFacts.push(makeMemoryItem("diameterMm", String(resolved.diameterMm), "intake", "resolved"))
    }
  }

  if (sessionState?.appliedFilters) {
    const coveredFields = new Set([...resolvedFacts, ...activeFilters].map(item => item.field))
    for (const filter of sessionState.appliedFilters) {
      if (filter.op === "skip" || coveredFields.has(filter.field)) continue
      activeFilters.push(makeMemoryItem(filter.field, filter.value, "narrowing", "active"))
    }
  }

  return { resolvedFacts, activeFilters, tentativeReferences }
}

function makeMemoryItem(
  field: string,
  value: string,
  source: MemoryItem["source"],
  status: MemoryItem["status"],
): MemoryItem {
  return {
    key: `${source}_${field}`,
    field,
    value,
    source,
    status,
    priority: status === "resolved" ? 8 : status === "active" ? 5 : 3,
    turnCreated: 0,
    turnUpdated: 0,
  }
}

function mapRelation(frameRelation: UserRelation): MessageRelation {
  switch (frameRelation) {
    case "direct_answer":
      return "direct_answer"
    case "confusion":
      return "confusion"
    case "challenge":
      return "challenge"
    case "revise":
      return "revise"
    case "followup_on_result":
      return "followup_on_result"
    case "compare_request":
      return "followup_on_result"
    case "detail_request":
      return "detail_request"
    case "meta_feedback":
      return "meta_feedback"
    case "restart":
      return "restart"
    default:
      return "direct_answer"
  }
}

function detectMode(sessionState: ExplorationSessionState | null): ConversationMode {
  if (!sessionState) return "intake"

  const mode = sessionState.currentMode
  const status = sessionState.resolutionStatus

  if (mode === "comparison") return "compare"
  if (status?.startsWith("resolved")) return "recommended"
  if (mode === "recommendation") return "recommended"
  if (mode === "narrowing" || mode === "question") return "narrowing"
  if (mode === "general_chat") return "explore"

  return "narrowing"
}

function messagesToTurns(messages: ChatMessage[], currentTurn: number): ConversationTurn[] {
  return messages.map((message, index) => ({
    role: message.role === "user" ? "user" : "assistant",
    text: message.text,
    turn: Math.max(0, currentTurn - (messages.length - 1 - index)),
  }))
}

function detectUserStateFromFrame(frame: RecentInteractionFrame): UserState {
  switch (frame.relation) {
    case "confusion":
      return "confused"
    case "challenge":
    case "meta_feedback":
      return "uncertain"
    default:
      return "clear"
  }
}

function buildRevisionHistory(memory: ConversationMemory | null): RevisionEvent[] {
  if (!memory) return []

  return memory.highlights
    .filter(highlight => highlight.type === "rejection" || highlight.type === "intent_shift")
    .map(highlight => ({
      turn: highlight.turn,
      field: highlight.field ?? "unknown",
      oldValue: null,
      newValue: null,
      reason: highlight.summary,
    }))
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}
