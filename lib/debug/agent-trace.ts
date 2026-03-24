/**
 * Agent Debug Trace — Rich structured decision trace for developer observability.
 *
 * Enabled by default (DEV_AGENT_DEBUG !== "false").
 * Zero overhead when disabled — all set/add calls are no-ops.
 *
 * RULE: Never expose raw hidden chain-of-thought.
 * Expose structured operational reasoning, decision summaries, and state snapshots.
 */

// ── Types ────────────────────────────────────────────────────

export type TraceCategory =
  | "router"
  | "context"
  | "memory"
  | "search"
  | "ui"
  | "options"
  | "answer"
  | "validator"
  | "prompt"

export interface AgentTraceEvent {
  step: string
  category: TraceCategory
  inputSummary: Record<string, unknown>
  outputSummary: Record<string, unknown>
  reasonSummary?: string
  latencyMs?: number
  fallbackUsed?: boolean
  alternativesConsidered?: Array<{ name: string; rejectedReason?: string }>
}

export interface PromptMetaTrace {
  templateId: string
  templateName?: string
  purpose?: string
  model?: string
  majorSlots: Array<{ name: string; size?: number; preview?: string }>
}

// ── Memory ────────────────────────────────────────────────────

export interface MemorySnapshot {
  resolvedFacts: Array<{ field: string; value: string; source: string }>
  activeFilters: Array<{ field: string; value: string; op: string }>
  tentativeReferences: Array<{ field: string; value: string }>
  pendingQuestions: Array<{ field: string; kind: string }>
  pendingAction: { label: string; type: string } | null
  recentQACount: number
  highlightCount: number
  userSignals: Record<string, unknown>
}

export interface MemoryDiff {
  added: Array<{ field: string; value: string }>
  updated: Array<{ field: string; oldValue: string; newValue: string }>
  dropped: Array<{ field: string; value: string; reason: string }>
  promotions: Array<{ field: string; from: string; to: string }>
  demotions: Array<{ field: string; from: string; to: string }>
}

// ── Search ────────────────────────────────────────────────────

export interface SearchDetail {
  requiresSearch: boolean
  searchScope: string
  targetEntities: string[]
  preFilterCount: number
  postFilterCount: number
  appliedConstraints: Array<{ field: string; value: string }>
  skippedReason?: string
}

// ── UI ────────────────────────────────────────────────────────

export interface UIArtifactSnapshot {
  artifacts: Array<{ kind: string; summary: string; productCodes: string[]; isPrimaryFocus: boolean }>
  likelyReferencedBlock: string | null
}

// ── Options ───────────────────────────────────────────────────

export interface OptionSnapshot {
  generated: Array<{
    id: string
    family: string
    label: string
    field?: string
    score: number
    projectedCount: number | null
    selected: boolean
    dropReason?: string
  }>
  finalChips: string[]
  finalDisplayedOptionsCount: number
}

// ── Validator ─────────────────────────────────────────────────

export interface ValidatorResult {
  answerTopic: string | null
  unauthorizedPhrases: string[]
  rewritesMade: string[]
  chipConsistency: "aligned" | "orphans_found" | "unchecked"
  wrongTopicDetected: boolean
}

// ── Route Alternatives ────────────────────────────────────────

export interface RouteDecision {
  chosen: string
  reason: string
  alternatives: Array<{ name: string; rejectedReason: string }>
}

// ── Reasoning Summary ─────────────────────────────────────────

export interface ReasoningSummary {
  /** One-line human-readable explanation of what the system decided */
  oneLiner: string
  /** Detailed bullet points */
  bullets: string[]
}

// ── Full Trace ────────────────────────────────────────────────

export interface SessionStateSnapshot {
  sessionId: string
  candidateCount: number
  resolutionStatus: string | null
  currentMode: string | null
  lastAskedField: string | null
  lastAction: string | null
  turnCount: number
  appliedFilters: Array<{ field: string; value: string; op: string }>
  displayedChips: string[]
  displayedOptionsCount: number
  displayedCandidateCount: number
  hasRecommendation: boolean
  hasComparison: boolean
  pendingAction: { label: string; type: string } | null
}

export interface TurnDebugTrace {
  turnId: string
  timestamp: string
  // Overview
  latestUserMessage: string
  latestAssistantQuestion?: string | null
  currentMode?: string | null
  queryTarget?: string | null
  routeAction?: string | null
  pendingField?: string | null
  candidateCount?: number | null
  filterCount?: number | null
  summary?: string
  reasoning?: ReasoningSummary | null
  // Timeline
  events: AgentTraceEvent[]
  // Rich snapshots
  sessionState?: SessionStateSnapshot | null
  memorySnapshot?: MemorySnapshot | null
  memoryDiff?: MemoryDiff | null
  searchDetail?: SearchDetail | null
  uiArtifacts?: UIArtifactSnapshot | null
  options?: OptionSnapshot | null
  routeDecision?: RouteDecision | null
  validatorResult?: ValidatorResult | null
  promptMeta?: PromptMetaTrace[]
  // Recent conversation
  recentTurns?: Array<{ role: string; text: string; chips?: string[]; mode?: string }>
}

// ── Debug Mode Check ─────────────────────────────────────────

export function isDebugEnabled(): boolean {
  return process.env.DEV_AGENT_DEBUG !== "false"
}

// ── Trace Collector ──────────────────────────────────────────

export class TraceCollector {
  private events: AgentTraceEvent[] = []
  private turnId: string
  private startTime: number
  private enabled: boolean
  private _memorySnapshot: MemorySnapshot | null = null
  private _memoryDiff: MemoryDiff | null = null
  private _searchDetail: SearchDetail | null = null
  private _uiArtifacts: UIArtifactSnapshot | null = null
  private _options: OptionSnapshot | null = null
  private _routeDecision: RouteDecision | null = null
  private _validatorResult: ValidatorResult | null = null
  private _promptMeta: PromptMetaTrace[] = []
  private _recentTurns: TurnDebugTrace["recentTurns"] = []
  private _reasoning: ReasoningSummary | null = null
  private _sessionState: SessionStateSnapshot | null = null

  constructor(turnId?: string) {
    this.enabled = isDebugEnabled()
    this.turnId = turnId ?? `turn-${Date.now()}`
    this.startTime = Date.now()
  }

  add(step: string, category: TraceCategory, input: Record<string, unknown>, output: Record<string, unknown>, reason?: string, extras?: { fallbackUsed?: boolean; alternativesConsidered?: AgentTraceEvent["alternativesConsidered"] }): void {
    if (!this.enabled) return
    this.events.push({ step, category, inputSummary: input, outputSummary: output, reasonSummary: reason, latencyMs: Date.now() - this.startTime, fallbackUsed: extras?.fallbackUsed, alternativesConsidered: extras?.alternativesConsidered })
  }

  setSessionState(state: SessionStateSnapshot): void { if (this.enabled) this._sessionState = state }
  setMemory(snapshot: MemorySnapshot, diff?: MemoryDiff): void { if (this.enabled) { this._memorySnapshot = snapshot; this._memoryDiff = diff ?? null } }
  setSearchDetail(detail: SearchDetail): void { if (this.enabled) this._searchDetail = detail }
  setUIArtifacts(artifacts: UIArtifactSnapshot): void { if (this.enabled) this._uiArtifacts = artifacts }
  setOptions(options: OptionSnapshot): void { if (this.enabled) this._options = options }
  setRouteDecision(decision: RouteDecision): void { if (this.enabled) this._routeDecision = decision }
  setValidatorResult(result: ValidatorResult): void { if (this.enabled) this._validatorResult = result }
  addPromptMeta(meta: PromptMetaTrace): void { if (this.enabled) this._promptMeta.push(meta) }
  setRecentTurns(turns: TurnDebugTrace["recentTurns"]): void { if (this.enabled) this._recentTurns = turns }
  setReasoning(reasoning: ReasoningSummary): void { if (this.enabled) this._reasoning = reasoning }

  build(context: {
    latestUserMessage: string
    latestAssistantQuestion?: string | null
    queryTarget?: string | null
    currentMode?: string | null
    routeAction?: string | null
    pendingField?: string | null
    candidateCount?: number | null
    filterCount?: number | null
    summary?: string
  }): TurnDebugTrace | null {
    if (!this.enabled) return null
    return {
      turnId: this.turnId,
      timestamp: new Date().toISOString(),
      ...context,
      reasoning: this._reasoning,
      events: this.events,
      sessionState: this._sessionState,
      memorySnapshot: this._memorySnapshot,
      memoryDiff: this._memoryDiff,
      searchDetail: this._searchDetail,
      uiArtifacts: this._uiArtifacts,
      options: this._options,
      routeDecision: this._routeDecision,
      validatorResult: this._validatorResult,
      promptMeta: this._promptMeta.length > 0 ? this._promptMeta : undefined,
      recentTurns: this._recentTurns?.length ? this._recentTurns : undefined,
    }
  }
}
