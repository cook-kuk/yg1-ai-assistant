/**
 * Agent Debug Trace — Structured decision trace for developer observability.
 *
 * OFF by default. Enabled via DEV_AGENT_DEBUG=true env var.
 * Zero overhead when disabled.
 *
 * RULE: Never expose raw hidden chain-of-thought.
 * Instead, expose structured decision summaries.
 */

// ── Types ────────────────────────────────────────────────────

export type TraceCategory =
  | "router"
  | "context"
  | "memory"
  | "search"
  | "options"
  | "answer"
  | "validator"

export interface AgentTraceEvent {
  step: string
  category: TraceCategory
  inputSummary: Record<string, unknown>
  outputSummary: Record<string, unknown>
  reasonSummary?: string
  latencyMs?: number
}

export interface TurnDebugTrace {
  turnId: string
  timestamp: string
  latestUserMessage: string
  latestAssistantQuestion?: string | null
  queryTarget?: string | null
  currentMode?: string | null
  routeAction?: string | null
  events: AgentTraceEvent[]
}

// ── Debug Mode Check ─────────────────────────────────────────

export function isDebugEnabled(): boolean {
  // Always enabled for now — disable later via DEV_AGENT_DEBUG=false
  return process.env.DEV_AGENT_DEBUG !== "false"
}

// ── Trace Collector ──────────────────────────────────────────

export class TraceCollector {
  private events: AgentTraceEvent[] = []
  private turnId: string
  private startTime: number
  private enabled: boolean

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
    reason?: string
  ): void {
    if (!this.enabled) return
    this.events.push({
      step,
      category,
      inputSummary: input,
      outputSummary: output,
      reasonSummary: reason,
      latencyMs: Date.now() - this.startTime,
    })
  }

  /** Build the final trace object. Returns null if disabled. */
  build(context: {
    latestUserMessage: string
    latestAssistantQuestion?: string | null
    queryTarget?: string | null
    currentMode?: string | null
    routeAction?: string | null
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
      events: this.events,
    }
  }
}
