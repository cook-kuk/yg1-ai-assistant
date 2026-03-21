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
export type MemoryStatus = "resolved" | "tentative" | "stale" | "replaced"

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

// ── Full Conversation Memory ─────────────────────────────────
export interface ConversationMemory {
  items: MemoryItem[]
  recommendationContext: RecommendationContextMemory
  followUp: FollowUpState
  softPreferences: Array<{ key: string; description: string }>
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
  }
}

/**
 * Build conversation memory from existing session state.
 * Hydrates memory from intake form, applied filters, and recommendation artifacts.
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
  } | null,
  turnCount: number
): ConversationMemory {
  const memory = createEmptyMemory()

  // Intake facts
  const intakeFields: Array<{ field: string; state: { status: string; value?: unknown } }> = [
    { field: "material", state: form.material },
    { field: "operationType", state: form.operationType },
    { field: "diameterMm", state: form.diameterInfo },
    { field: "toolType", state: form.toolTypeOrCurrentProduct },
  ]

  for (const { field, state } of intakeFields) {
    if (state.status === "known" && state.value != null) {
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

  if (!sessionState) return memory

  // Applied filters → memory items
  if (sessionState.appliedFilters) {
    for (const filter of sessionState.appliedFilters) {
      if (filter.op === "skip") continue
      // Don't duplicate intake facts
      const existingIntake = memory.items.find(i => i.field === filter.field && i.source === "intake")
      if (existingIntake) continue

      memory.items.push({
        key: `filter_${filter.field}_${filter.appliedAt}`,
        field: filter.field,
        value: filter.value,
        source: "narrowing",
        status: "tentative",
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
