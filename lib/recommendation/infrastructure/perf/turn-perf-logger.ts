/**
 * Turn Performance Logger — Measures and logs per-turn performance metrics.
 * Lightweight, zero-dependency, no external services.
 */

export interface TurnPerfMetrics {
  turnId: string
  totalMs: number
  steps: Record<string, number>
  llmCallCount: number
  dbQueryCount: number
  cacheHitCount: number
  phase: string
}

export class TurnPerfLogger {
  private startTime: number
  private stepTimers: Map<string, number> = new Map()
  private completedSteps: Map<string, number> = new Map()
  private _llmCallCount = 0
  private _dbQueryCount = 0
  private _cacheHitCount = 0
  private _phase = "unknown"

  constructor(private turnId: string = `turn-${Date.now()}`) {
    this.startTime = Date.now()
  }

  /** Start timing a named step */
  startStep(name: string): void {
    this.stepTimers.set(name, Date.now())
  }

  /** End timing a named step */
  endStep(name: string): void {
    const start = this.stepTimers.get(name)
    if (start) {
      this.completedSteps.set(name, Date.now() - start)
      this.stepTimers.delete(name)
    }
  }

  /** Record an LLM call */
  recordLlmCall(): void { this._llmCallCount++ }

  /** Record a DB query */
  recordDbQuery(): void { this._dbQueryCount++ }

  /** Record a cache hit */
  recordCacheHit(): void { this._cacheHitCount++ }

  /** Set current phase */
  setPhase(phase: string): void { this._phase = phase }

  /** Build final metrics and log to console */
  finish(): TurnPerfMetrics {
    const totalMs = Date.now() - this.startTime
    const steps: Record<string, number> = {}
    this.completedSteps.forEach((ms, name) => { steps[name] = ms })

    const metrics: TurnPerfMetrics = {
      turnId: this.turnId,
      totalMs,
      steps,
      llmCallCount: this._llmCallCount,
      dbQueryCount: this._dbQueryCount,
      cacheHitCount: this._cacheHitCount,
      phase: this._phase,
    }

    // Structured performance log
    const stepSummary = Object.entries(steps).map(([k, v]) => `${k}=${v}ms`).join(", ")
    console.log(`[perf] Turn ${this.turnId} completed in ${totalMs}ms | phase=${this._phase} | LLM=${this._llmCallCount} DB=${this._dbQueryCount} cache=${this._cacheHitCount} | ${stepSummary}`)

    return metrics
  }
}

/** Global reference for the current turn's perf logger (set per request) */
let _currentPerfLogger: TurnPerfLogger | null = null

export function getCurrentPerfLogger(): TurnPerfLogger | null { return _currentPerfLogger }
export function setCurrentPerfLogger(logger: TurnPerfLogger | null): void { _currentPerfLogger = logger }
