/**
 * Conversation Memory — Structured selective memory for recommendation continuity.
 *
 * Not raw transcript. Selective structured state for:
 * - resolved intake facts
 * - active narrowing filters
 * - soft preferences
 * - recommended product context
 * - follow-up state
 * - memory quality flags
 *
 * Serializable, deterministic, carried in session state.
 */

// ── Memory Item ──────────────────────────────────────────────
export type MemorySource = "intake" | "narrowing" | "repair" | "user_followup" | "system_inference"
export type MemoryStatus = "resolved" | "active" | "tentative" | "stale" | "replaced"

export interface MemoryItem {
  key: string
  field: string
  value: string
  source: MemorySource
  status: MemoryStatus
  priority: number        // 0-10, higher = more important
  turnCreated: number     // turn when this was created
  turnUpdated: number     // last turn this was updated
  replacedBy?: string     // key of the item that replaced this
}

// ── Recommendation Context Memory ────────────────────────────
export interface RecommendationContextMemory {
  primaryProductCode: string | null
  primarySeriesName: string | null
  alternativeCount: number
  lastComparedProducts: string[]
  matchStatus: string | null
}

// ── Follow-up State ──────────────────────────────────────────
export interface FollowUpState {
  lastAskedField: string | null
  pendingDecisionType: "narrowing" | "repair" | "comparison" | "explanation" | null
  currentOptionFamily: string | null
  turnsSinceRecommendation: number
}

// ── Conversation Highlight (notable moments worth remembering) ──
export interface ConversationHighlight {
  turn: number
  type: "confusion" | "preference" | "rejection" | "satisfaction" | "question" | "intent_shift"
  summary: string
  field?: string
}

// ── User Behavioral Signal ───────────────────────────────────
export interface UserBehavioralSignal {
  /** Fields the user struggled with or asked for explanation */
  confusedFields: string[]
  /** Fields the user skipped */
  skippedFields: string[]
  /** Fields the user changed their mind on */
  revisedFields: string[]
  /** Whether user tends to delegate ("추천으로 골라줘") */
  prefersDelegate: boolean
  /** Whether user tends to ask for explanations */
  prefersExplanation: boolean
  /** Number of times user expressed frustration */
  frustrationCount: number
}

// ── Full Conversation Memory ─────────────────────────────────
export interface ConversationMemory {
  items: MemoryItem[]
  recommendationContext: RecommendationContextMemory
  followUp: FollowUpState
  softPreferences: Array<{ key: string; description: string }>
  /** Notable conversation moments — persists across turns */
  highlights: ConversationHighlight[]
  /** Accumulated behavioral signals */
  userSignals: UserBehavioralSignal
  /** Recent assistant questions and user answers for context continuity */
  recentQA: Array<{ question: string; answer: string; field: string | null; turn: number }>
}

// ── Factory ──────────────────────────────────────────────────
export function createEmptyMemory(): ConversationMemory {
  return {
    items: [],
    recommendationContext: {
      primaryProductCode: null,
      primarySeriesName: null,
      alternativeCount: 0,
      lastComparedProducts: [],
      matchStatus: null,
    },
    followUp: {
      lastAskedField: null,
      pendingDecisionType: null,
      currentOptionFamily: null,
      turnsSinceRecommendation: 0,
    },
    softPreferences: [],
    highlights: [],
    userSignals: {
      confusedFields: [],
      skippedFields: [],
      revisedFields: [],
      prefersDelegate: false,
      prefersExplanation: false,
      frustrationCount: 0,
    },
    recentQA: [],
  }
}

/**
 * Build conversation memory from existing session state.
 * If session already has persisted memory, MERGE into it (don't rebuild from scratch).
 */
export function buildMemoryFromSession(
  form: { material: { status: string; value?: unknown }; operationType: { status: string; value?: unknown }; diameterInfo: { status: string; value?: unknown }; toolTypeOrCurrentProduct: { status: string; value?: unknown } },
  sessionState: {
    appliedFilters?: Array<{ field: string; op: string; value: string; rawValue: string | number; appliedAt: number }>
    narrowingHistory?: Array<{ extractedFilters: Array<{ field: string }> }>
    turnCount?: number
    lastAskedField?: string
    lastAction?: string
    resolutionStatus?: string
    displayedCandidates?: Array<{ displayCode: string; seriesName: string | null; matchStatus: string }>
    lastComparisonArtifact?: { comparedProductCodes: string[] } | null
    conversationMemory?: ConversationMemory
  } | null,
  turnCount: number
): ConversationMemory {
  // If session already has persisted memory, use it as base (accumulate, don't rebuild)
  const memory: ConversationMemory = sessionState?.conversationMemory
    ? JSON.parse(JSON.stringify(sessionState.conversationMemory)) // deep clone
    : createEmptyMemory()

  // Intake facts
  const intakeFields: Array<{ field: string; state: { status: string; value?: unknown } }> = [
    { field: "material", state: form.material },
    { field: "operationType", state: form.operationType },
    { field: "diameterMm", state: form.diameterInfo },
    { field: "machiningCategory", state: form.toolTypeOrCurrentProduct },
  ]

  for (const { field, state } of intakeFields) {
    if (state.status === "known" && state.value != null) {
      // Don't duplicate if already exists in persisted memory
      const existing = memory.items.find(i => i.key === `intake_${field}`)
      if (!existing) {
        memory.items.push({
          key: `intake_${field}`,
          field,
          value: String(state.value),
          source: "intake",
          status: "resolved",
          priority: 8,
          turnCreated: 0,
          turnUpdated: 0,
        })
      }
    }
  }

  if (!sessionState) return memory

  // Applied filters → memory items (only add new ones)
  if (sessionState.appliedFilters) {
    for (const filter of sessionState.appliedFilters) {
      if (filter.op === "skip") continue
      const filterKey = `filter_${filter.field}_${filter.appliedAt}`
      // Don't duplicate existing items
      const existingItem = memory.items.find(i => i.key === filterKey || (i.field === filter.field && i.source === "intake"))
      if (existingItem) continue

      memory.items.push({
        key: `filter_${filter.field}_${filter.appliedAt}`,
        field: filter.field,
        value: filter.value,
        source: "narrowing",
        status: "active",
        priority: 5,
        turnCreated: filter.appliedAt,
        turnUpdated: filter.appliedAt,
      })
    }
  }

  // Recommendation context
  if (sessionState.resolutionStatus?.startsWith("resolved") && sessionState.displayedCandidates?.length) {
    const top = sessionState.displayedCandidates[0]
    memory.recommendationContext = {
      primaryProductCode: top.displayCode,
      primarySeriesName: top.seriesName,
      alternativeCount: Math.max(0, sessionState.displayedCandidates.length - 1),
      lastComparedProducts: sessionState.lastComparisonArtifact?.comparedProductCodes ?? [],
      matchStatus: top.matchStatus,
    }
  }

  // Follow-up state
  memory.followUp = {
    lastAskedField: sessionState.lastAskedField ?? null,
    pendingDecisionType: sessionState.resolutionStatus?.startsWith("resolved")
      ? null
      : "narrowing",
    currentOptionFamily: null,
    turnsSinceRecommendation: sessionState.resolutionStatus?.startsWith("resolved")
      ? turnCount - (sessionState.turnCount ?? 0)
      : 0,
  }

  return memory
}

// ════════════════════════════════════════════════════════════════
// MEMORY RECORDING — Call these to accumulate signals across turns
// ════════════════════════════════════════════════════════════════

/** Record a conversation highlight (notable moment) */
export function recordHighlight(
  memory: ConversationMemory,
  turn: number,
  type: ConversationHighlight["type"],
  summary: string,
  field?: string
): void {
  // Keep last 20 highlights to avoid unbounded growth
  if (memory.highlights.length >= 20) {
    memory.highlights.shift()
  }
  memory.highlights.push({ turn, type, summary, field })
}

/** Record a Q&A pair for context continuity */
export function recordQA(
  memory: ConversationMemory,
  question: string,
  answer: string,
  field: string | null,
  turn: number
): void {
  // Keep last 10 Q&A pairs
  if (memory.recentQA.length >= 10) {
    memory.recentQA.shift()
  }
  memory.recentQA.push({ question, answer, field, turn })
}

/** Record user confusion about a field */
export function recordConfusion(memory: ConversationMemory, field: string): void {
  if (!memory.userSignals.confusedFields.includes(field)) {
    memory.userSignals.confusedFields.push(field)
  }
}

/** Record field skip */
export function recordSkip(memory: ConversationMemory, field: string): void {
  if (!memory.userSignals.skippedFields.includes(field)) {
    memory.userSignals.skippedFields.push(field)
  }
}

/** Record field revision (user changed their mind) */
export function recordRevision(memory: ConversationMemory, field: string): void {
  if (!memory.userSignals.revisedFields.includes(field)) {
    memory.userSignals.revisedFields.push(field)
  }
}

/** Record user preference for delegation */
export function recordDelegation(memory: ConversationMemory): void {
  memory.userSignals.prefersDelegate = true
}

/** Record user preference for explanations */
export function recordExplanationPreference(memory: ConversationMemory): void {
  memory.userSignals.prefersExplanation = true
}

/** Record user frustration */
export function recordFrustration(memory: ConversationMemory): void {
  memory.userSignals.frustrationCount++
}

/** Add a soft preference */
export function recordSoftPreference(memory: ConversationMemory, key: string, description: string): void {
  const existing = memory.softPreferences.find(p => p.key === key)
  if (existing) {
    existing.description = description
  } else {
    // Keep last 10 preferences
    if (memory.softPreferences.length >= 10) {
      memory.softPreferences.shift()
    }
    memory.softPreferences.push({ key, description })
  }
}
