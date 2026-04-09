/**
 * Semantic Cache — 의미적으로 동일한 쿼리의 LLM 결과 재사용.
 *
 * 전략: 한국어 형태소 간이 분리 + 영어 lowercase + 동의어 정규화 후
 * Jaccard similarity. 외부 임베딩 API 불필요. 0 latency.
 *
 * 캐시 컨텍스트: 같은 메시지라도 현재 적용된 필터가 다르면 결과가 달라짐
 * → (query, filters) 쌍 기준으로 hit/miss 결정.
 *
 * TTL 30분, LRU 최대 500항목.
 */

import type { AppliedFilter } from "@/lib/recommendation/domain/types"
import { tokenize, jaccardSimilarity } from "./auto-synonym"

// ── Types ────────────────────────────────────────────────────

export interface CachedAction {
  type: string
  field?: string
  value?: unknown
  value2?: unknown
  op?: string
  from?: unknown
  to?: unknown
  targets?: string[]
  message?: string
}

export interface CachedResult {
  source: "scr" | "sql-agent" | "det-scr" | "forge"
  actions: CachedAction[]
  reasoning?: string
  answer?: string
  /** For forge cache: the raw DB rows that the forge agent returned. Replayed
   *  directly into the candidates pipeline on cache hit, skipping the entire
   *  Sonnet+relax+verify forge cycle (~7-15s). */
  rows?: Record<string, unknown>[]
}

interface CacheEntry {
  query: string
  tokens: Set<string>
  filterKey: string
  result: CachedResult
  createdAt: number
  hitCount: number
}

// ── Constants ────────────────────────────────────────────────

const CACHE_MAX_SIZE = 500
const CACHE_TTL_MS = 30 * 60 * 1000 // 30 min
const SIMILARITY_THRESHOLD = 0.75

// ── Cache state ──────────────────────────────────────────────
// Note: 동의어 정규화/토큰화는 auto-synonym.ts로 이전됨 (DB+patterns+KG 자동 구축).

const cache: CacheEntry[] = []

function computeFilterKey(filters: AppliedFilter[]): string {
  return filters
    .map(f => `${f.field}:${typeof f.value === "object" ? JSON.stringify(f.value) : String(f.value)}`)
    .sort()
    .join("|")
}

// ── Public API ───────────────────────────────────────────────

export function lookupCache(query: string, currentFilters: AppliedFilter[]): CachedResult | null {
  pruneExpired()
  const queryTokens = tokenize(query)
  if (queryTokens.size === 0) return null
  const filterKey = computeFilterKey(currentFilters)

  let best: CacheEntry | null = null
  let bestSim = 0
  for (const entry of cache) {
    if (entry.filterKey !== filterKey) continue
    const sim = jaccardSimilarity(queryTokens, entry.tokens)
    if (sim > bestSim) {
      bestSim = sim
      best = entry
    }
  }

  if (best && bestSim >= SIMILARITY_THRESHOLD) {
    best.hitCount++
    console.log(`[semantic-cache:hit] "${query.slice(0, 40)}" ≈ "${best.query.slice(0, 40)}" jaccard=${bestSim.toFixed(3)} hits=${best.hitCount}`)
    return best.result
  }
  return null
}

export function storeCache(query: string, currentFilters: AppliedFilter[], result: CachedResult): void {
  const tokens = tokenize(query)
  if (tokens.size === 0) return
  const filterKey = computeFilterKey(currentFilters)

  // Dedupe: skip if exact same query+filterKey already cached
  const existing = cache.find(e => e.query === query && e.filterKey === filterKey)
  if (existing) {
    existing.result = result
    existing.createdAt = Date.now()
    return
  }

  cache.push({
    query,
    tokens,
    filterKey,
    result,
    createdAt: Date.now(),
    hitCount: 0,
  })

  if (cache.length > CACHE_MAX_SIZE) {
    cache.sort((a, b) => a.hitCount - b.hitCount || a.createdAt - b.createdAt)
    cache.splice(0, cache.length - CACHE_MAX_SIZE)
  }
}

function pruneExpired(): void {
  const cutoff = Date.now() - CACHE_TTL_MS
  for (let i = cache.length - 1; i >= 0; i--) {
    if (cache[i].createdAt < cutoff) cache.splice(i, 1)
  }
}

export function getCacheStats(): { size: number; totalHits: number } {
  return {
    size: cache.length,
    totalHits: cache.reduce((sum, e) => sum + e.hitCount, 0),
  }
}

// Test helper
export function _resetCacheForTest(): void {
  cache.length = 0
}
