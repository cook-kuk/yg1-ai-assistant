/**
 * Benchmark LLM Call Collector
 *
 * Uses AsyncLocalStorage to collect all LLM calls within a single
 * /api/recommend request scope. Only active when BENCHMARK_TRACE=true.
 *
 * Zero overhead when disabled — isBenchmarkEnabled() short-circuits.
 */

import { AsyncLocalStorage } from "node:async_hooks"

export interface BenchmarkLlmCall {
  agent: string | null
  model: string
  provider?: "anthropic" | "openai-compatible" | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  durationMs: number
}

export interface BenchmarkTurnUsage {
  llmCalls: BenchmarkLlmCall[]
  llmCallCount: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
}

// Pin on globalThis: under Next.js/Turbopack dev, this module can be
// instantiated multiple times across the bundle graph. Without a singleton,
// runWithBenchmark and recordBenchmarkLlmCall end up touching different
// storage instances and the recorded calls vanish.
const GLOBAL_KEY = "__yg1_benchmark_storage__"
type Globals = typeof globalThis & { [GLOBAL_KEY]?: AsyncLocalStorage<BenchmarkLlmCall[]> }
const g = globalThis as Globals
const storage: AsyncLocalStorage<BenchmarkLlmCall[]> =
  g[GLOBAL_KEY] ?? (g[GLOBAL_KEY] = new AsyncLocalStorage<BenchmarkLlmCall[]>())

export function isBenchmarkEnabled(): boolean {
  return process.env.BENCHMARK_TRACE === "true"
}

/**
 * Run a function within a benchmark collection scope.
 * All recordBenchmarkLlmCall() calls inside will be collected.
 */
export function runWithBenchmark<T>(fn: () => Promise<T>): Promise<T> {
  if (!isBenchmarkEnabled()) return fn()
  return storage.run([], fn)
}

/**
 * Record a single LLM call. No-op if not in benchmark scope.
 */
export function recordBenchmarkLlmCall(call: BenchmarkLlmCall): void {
  const store = storage.getStore()
  if (store) store.push(call)
}

/**
 * Get the aggregated turn usage. Returns null if not in benchmark scope.
 */
export function getBenchmarkTurnUsage(): BenchmarkTurnUsage | null {
  const store = storage.getStore()
  if (!store || store.length === 0) return null

  return {
    llmCalls: store,
    llmCallCount: store.length,
    totalInputTokens: store.reduce((s, c) => s + c.inputTokens, 0),
    totalOutputTokens: store.reduce((s, c) => s + c.outputTokens, 0),
    totalCacheReadTokens: store.reduce((s, c) => s + c.cacheReadTokens, 0),
    totalCacheWriteTokens: store.reduce((s, c) => s + c.cacheWriteTokens, 0),
  }
}
