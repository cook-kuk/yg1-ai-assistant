/**
 * Agent Debug Trace — Rich structured decision trace for developer observability.
 *
 * Enabled by default for now (DEV_AGENT_DEBUG !== "false").
 * Zero overhead when disabled — all add() calls are no-ops.
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
  alternativesConsidered?: Array<{
    name: string
    rejectedReason?: string
  }>
}

export interface PromptMetaTrace {
  templateId: string
  templateName?: string
  purpose?: string
  model?: string
  majorSlots: Array<{
    name: string
    size?: number
    preview?: string
  }>
}

export interface MemorySnapshot {
  resolvedFacts: Array<{ field: string; value: string; source: string }>
  activeFilters: Array<{ field: string; value: string; op: string }>
  tentativeReferences: Array<{ field: string; value: string }>
  pendingQuestions: Array<{ field: string; kind: string }>
  recentQACount: number
  highlightCount: number
  userSignals: Record<string, unknown>
}

export interface MemoryDiff {
  added: Array<{ field: string; value: string }>
  updated: Array<{ field: string; oldValue: string; newValue: string }>
  dropped: Array<{ field: string; value: string; reason: string }>
}

export interface UIArtifactSnapshot {
  artifacts: Array<{
    kind: string
    summary: string
    productCodes: string[]
    isPrimaryFocus: boolean
  }>
  likelyReferencedBlock: string | null
}

export interface OptionSnapshot {
  generated: Array<{
    id: string
    family: string
    label: string
    field?: string
    score: number
    projectedCount: number | null
    selected: boolean
  }>
  finalChips: string[]
  finalDisplayedOptionsCount: number
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
  // Timeline
  events: AgentTraceEvent[]
  // Rich snapshots
  memorySnapshot?: MemorySnapshot | null
  memoryDiff?: MemoryDiff | null
  uiArtifacts?: UIArtifactSnapshot | null
  options?: OptionSnapshot | null
  promptMeta?: PromptMetaTrace[]
  // Recent conversation (last 5 turns summary)
  recentTurns?: Array<{
    role: string
    text: string
    chips?: string[]
    mode?: string
  }>
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
  private memorySnapshot: MemorySnapshot | null = null
  private memoryDiff: MemoryDiff | null = null
  private uiArtifacts: UIArtifactSnapshot | null = null
  private options: OptionSnapshot | null = null
  private promptMeta: PromptMetaTrace[] = []
  private recentTurns: TurnDebugTrace["recentTurns"] = []

  constructor(turnId?: string) {
    this.enabled = isDebugEnabled()
    this.turnId = turnId ?? `turn-${Date.now()}`
    this.startTime = Date.now()
  }

  /** Add a trace event. No-op if debug is disabled. */
  add(
    step: string,
    category: TraceCategory,
    input: Record<string, unknown>,
    output: Record<string, unknown>,
    reason?: string,
    extras?: { fallbackUsed?: boolean; alternativesConsidered?: AgentTraceEvent["alternativesConsidered"] }
  ): void {
    if (!this.enabled) return
    this.events.push({
      step,
      category,
      inputSummary: input,
      outputSummary: output,
      reasonSummary: reason,
      latencyMs: Date.now() - this.startTime,
      fallbackUsed: extras?.fallbackUsed,
      alternativesConsidered: extras?.alternativesConsidered,
    })
  }

  /** Set memory snapshot for this turn. */
  setMemory(snapshot: MemorySnapshot, diff?: MemoryDiff): void {
    if (!this.enabled) return
    this.memorySnapshot = snapshot
    this.memoryDiff = diff ?? null
  }

  /** Set UI artifact snapshot. */
  setUIArtifacts(artifacts: UIArtifactSnapshot): void {
    if (!this.enabled) return
    this.uiArtifacts = artifacts
  }

  /** Set option generation results. */
  setOptions(options: OptionSnapshot): void {
    if (!this.enabled) return
    this.options = options
  }

  /** Add prompt metadata. */
  addPromptMeta(meta: PromptMetaTrace): void {
    if (!this.enabled) return
    this.promptMeta.push(meta)
  }

  /** Set recent conversation turns for context. */
  setRecentTurns(turns: TurnDebugTrace["recentTurns"]): void {
    if (!this.enabled) return
    this.recentTurns = turns
  }

  /** Build the final trace object. Returns null if disabled. */
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
      latestUserMessage: context.latestUserMessage,
      latestAssistantQuestion: context.latestAssistantQuestion,
      queryTarget: context.queryTarget,
      currentMode: context.currentMode,
      routeAction: context.routeAction,
      pendingField: context.pendingField,
      candidateCount: context.candidateCount,
      filterCount: context.filterCount,
      summary: context.summary,
      events: this.events,
      memorySnapshot: this.memorySnapshot,
      memoryDiff: this.memoryDiff,
      uiArtifacts: this.uiArtifacts,
      options: this.options,
      promptMeta: this.promptMeta.length > 0 ? this.promptMeta : undefined,
      recentTurns: this.recentTurns?.length ? this.recentTurns : undefined,
    }
  }
}
