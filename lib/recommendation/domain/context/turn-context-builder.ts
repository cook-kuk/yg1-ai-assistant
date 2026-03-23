/**
 * Unified TurnContext Builder — Single source of truth for both
 * answer generation and chip generation.
 *
 * Built once per turn, shared by:
 * - answer generation (LLM response composer)
 * - chip candidate generation
 * - chip ranking / LLM reranking
 * - divergence guard
 *
 * Deterministic. No LLM calls.
 */

import type {
  AppliedFilter,
  ChatMessage,
  ExplorationSessionState,
  ProductIntakeForm,
  RecommendationInput,
  CandidateSnapshot,
} from "@/lib/recommendation/domain/types"
import type { ConversationMemory, MemoryItem } from "@/lib/recommendation/domain/memory/conversation-memory"
import type { RecentInteractionFrame } from "./recent-interaction-frame"
import type { UIArtifact } from "./ui-context-extractor"
import type { EpisodeSummary } from "@/lib/recommendation/domain/memory/memory-compressor"
import { buildRecentInteractionFrame, type UserRelation, type UIBlockReference } from "./recent-interaction-frame"
import { extractUIArtifacts } from "./ui-context-extractor"
import { compressOlderTurns } from "@/lib/recommendation/domain/memory/memory-compressor"

// ── Relation between latest user message and latest assistant question ──
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

// ── Current conversation mode ──
export type ConversationMode =
  | "intake"
  | "narrowing"
  | "recommended"
  | "compare"
  | "repair"
  | "revise"
  | "explore"

// ── Pending question descriptor ──
export interface PendingQuestionInfo {
  kind: "binary" | "choice" | "field_selection" | "explanation" | "revision"
  field: string | null
  options: string[]
}

// ── Revision event ──
export interface RevisionEvent {
  turn: number
  field: string
  oldValue: string | null
  newValue: string | null
  reason: string
}

// ── Conversation turn (raw) ──
export interface ConversationTurn {
  role: "user" | "assistant"
  text: string
  turn: number
}

// ── User state ──
export type UserState = "clear" | "uncertain" | "confused" | "frustrated"

// ════════════════════════════════════════════════════════════════
// THE UNIFIED TURN CONTEXT
// ════════════════════════════════════════════════════════════════

export interface UnifiedTurnContext {
  /** The latest question the assistant asked (extracted from response text) */
  latestAssistantQuestion: string | null
  /** The user's latest message */
  latestUserMessage: string
  /** How the user message relates to the latest question */
  relationToLatestQuestion: MessageRelation

  /** Current conversation mode */
  currentMode: ConversationMode
  /** Pending question (if the assistant just asked something) */
  currentPendingQuestion: PendingQuestionInfo | null

  // ── Structured Memory (Priority 3) ──
  /** Facts confirmed by user — material, operation, toolType, diameter */
  resolvedFacts: MemoryItem[]
  /** Active narrowing filters — coating, flute, etc. */
  activeFilters: MemoryItem[]
  /** Mentioned but NOT committed — e.g. "Ball, Taper는 몇개야?" */
  tentativeReferences: MemoryItem[]
  /** Pending clarification threads */
  pendingQuestions: PendingQuestionInfo[]
  /** History of user revisions */
  revisionHistory: RevisionEvent[]
  /** Product codes referenced in conversation */
  referencedProducts: string[]
  /** Products currently displayed in UI */
  currentDisplayedProducts: string[]

  // ── Conversation turns (Priority 4-5) ──
  /** Recent raw turns (last 12-20) */
  recentTurns: ConversationTurn[]
  /** Compressed summaries for older turns (Priority 5) */
  episodicSummaries: EpisodeSummary[]

  // ── UI Artifacts (Priority 2) ──
  /** What's currently visible in the UI */
  uiArtifacts: UIArtifact[]
  /** Which UI block the user is likely reacting to */
  likelyReferencedUIBlock: UIBlockReference

  // ── User cognitive state ──
  userState: UserState

  // ── Recent interaction frame (shortcut) ──
  recentFrame: RecentInteractionFrame

  // ── Raw references for downstream consumers ──
  sessionState: ExplorationSessionState | null
  resolvedInput: RecommendationInput
  intakeForm: ProductIntakeForm
  conversationMemory: ConversationMemory | null
}

// ════════════════════════════════════════════════════════════════
// BUILDER
// ════════════════════════════════════════════════════════════════

export interface TurnContextBuilderInput {
  latestAssistantText: string | null
  latestUserMessage: string
  messages: ChatMessage[]
  sessionState: ExplorationSessionState | null
  resolvedInput: RecommendationInput
  intakeForm: ProductIntakeForm
  candidates: CandidateSnapshot[]
}

/**
 * Build the unified TurnContext — called once per turn.
 * Both answer generation and chip generation MUST use this same object.
 */
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

  // 1. Build recent interaction frame
  const recentFrame = buildRecentInteractionFrame(
    latestAssistantText,
    latestUserMessage,
    sessionState
  )

  // 2. Extract UI artifacts
  const uiArtifacts = extractUIArtifacts(sessionState, candidates)

  // 3. Get conversation memory
  const conversationMemory = sessionState?.conversationMemory ?? null

  // 4. Classify memory items
  const { resolvedFacts, activeFilters, tentativeReferences } =
    classifyMemoryItems(conversationMemory, sessionState)

  // 5. Map relation
  const relationToLatestQuestion = mapRelation(recentFrame.relation)

  // 6. Detect current mode
  const currentMode = detectMode(sessionState)

  // 7. Build recent turns from messages
  const allTurns = messagesToTurns(messages, sessionState?.turnCount ?? 0)

  // 8. Compress older turns if needed
  const { recentTurns, episodicSummaries } = compressOlderTurns(
    allTurns,
    conversationMemory,
    sessionState
  )

  // 9. Detect user state
  const userState = detectUserStateFromFrame(recentFrame)

  // 10. Extract referenced and displayed products
  const referencedProducts = recentFrame.referencedProducts
  const currentDisplayedProducts = (candidates ?? []).map(c => c.displayCode)

  // 11. Build revision history from memory highlights
  const revisionHistory = buildRevisionHistory(conversationMemory)

  // 12. Build pending questions
  const pendingQuestions: PendingQuestionInfo[] = []
  if (recentFrame.currentPendingQuestion) {
    pendingQuestions.push(recentFrame.currentPendingQuestion)
  }

  return {
    latestAssistantQuestion: recentFrame.latestAssistantQuestion,
    latestUserMessage,
    relationToLatestQuestion,
    currentMode,
    currentPendingQuestion: recentFrame.currentPendingQuestion,
    resolvedFacts,
    activeFilters,
    tentativeReferences,
    pendingQuestions,
    revisionHistory,
    referencedProducts,
    currentDisplayedProducts,
    recentTurns,
    episodicSummaries,
    uiArtifacts,
    likelyReferencedUIBlock: recentFrame.uiBlock,
    userState,
    recentFrame,
    sessionState,
    resolvedInput,
    intakeForm,
    conversationMemory,
  }
}

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════

function classifyMemoryItems(
  memory: ConversationMemory | null,
  sessionState: ExplorationSessionState | null
): {
  resolvedFacts: MemoryItem[]
  activeFilters: MemoryItem[]
  tentativeReferences: MemoryItem[]
} {
  const resolvedFacts: MemoryItem[] = []
  const activeFilters: MemoryItem[] = []
  const tentativeReferences: MemoryItem[] = []

  // First, classify from memory items if available
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
        // stale and replaced items are not included
      }
    }
  }

  // Supplement from session state for any facts/filters not already covered by memory
  if (sessionState?.resolvedInput) {
    const ri = sessionState.resolvedInput
    const coveredFields = new Set([...resolvedFacts, ...activeFilters].map(i => i.field))
    if (ri.material && !coveredFields.has("material"))
      resolvedFacts.push(makeMemoryItem("material", ri.material, "intake", "resolved"))
    if (ri.operationType && !coveredFields.has("operationType"))
      resolvedFacts.push(makeMemoryItem("operationType", ri.operationType, "intake", "resolved"))
    if (ri.toolType && !coveredFields.has("toolType"))
      resolvedFacts.push(makeMemoryItem("toolType", ri.toolType, "intake", "resolved"))
    if (ri.diameterMm && !coveredFields.has("diameterMm"))
      resolvedFacts.push(makeMemoryItem("diameterMm", String(ri.diameterMm), "intake", "resolved"))
  }

  if (sessionState?.appliedFilters) {
    const coveredFields = new Set([...resolvedFacts, ...activeFilters].map(i => i.field))
    for (const f of sessionState.appliedFilters) {
      if (f.op === "skip") continue
      if (!coveredFields.has(f.field)) {
        activeFilters.push(makeMemoryItem(f.field, f.value, "narrowing", "active"))
      }
    }
  }

  return { resolvedFacts, activeFilters, tentativeReferences }
}

function makeMemoryItem(
  field: string,
  value: string,
  source: MemoryItem["source"],
  status: MemoryItem["status"]
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
    case "direct_answer": return "direct_answer"
    case "confusion": return "confusion"
    case "challenge": return "challenge"
    case "revise": return "revise"
    case "followup_on_result": return "followup_on_result"
    case "compare_request": return "followup_on_result"
    case "detail_request": return "detail_request"
    case "meta_feedback": return "meta_feedback"
    case "restart": return "restart"
    default: return "direct_answer"
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

  return "narrowing"
}

function messagesToTurns(messages: ChatMessage[], currentTurn: number): ConversationTurn[] {
  return messages.map((m, i) => ({
    role: m.role as "user" | "assistant",
    text: m.text,
    turn: Math.max(0, currentTurn - (messages.length - 1 - i)),
  }))
}

function detectUserStateFromFrame(frame: RecentInteractionFrame): UserState {
  switch (frame.relation) {
    case "confusion": return "confused"
    case "challenge": return "uncertain"
    case "meta_feedback": return "uncertain"
    default: return "clear"
  }
}

function buildRevisionHistory(memory: ConversationMemory | null): RevisionEvent[] {
  if (!memory) return []
  return memory.highlights
    .filter(h => h.type === "rejection" || h.type === "intent_shift")
    .map(h => ({
      turn: h.turn,
      field: h.field ?? "unknown",
      oldValue: null,
      newValue: null,
      reason: h.summary,
    }))
}
