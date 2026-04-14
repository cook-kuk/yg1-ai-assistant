/**
 * Cache Configuration (SSOT)
 *
 * 세션/스키마/시맨틱/KG 캐시의 TTL·크기·threshold를 한 곳에서 관리.
 * ENV 변수로 오버라이드 가능 → 코드 변경 없이 A/B 테스트.
 *
 * 이 파일은 heartbeat 핫픽스와 무관하게, 이전 리팩터에서 추가된 import
 * ("@/lib/recommendation/infrastructure/config/cache-config")를 채워주기
 * 위한 stub. 값은 리팩터 이전의 하드코딩 디폴트를 보존한다.
 */

function envNum(name: string, defaultValue: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return defaultValue
  const n = Number(raw)
  return Number.isFinite(n) ? n : defaultValue
}

// ── Session Cache (per-request session cache in memory) ─────
export const SESSION_CACHE = {
  ttlMs: envNum("CACHE_SESSION_TTL_MS", 10 * 60 * 1000), // 10 min
} as const

// ── SQL Agent Schema Cache (table/column metadata) ──────────
export const SCHEMA_CACHE = {
  ttlMs: envNum("CACHE_SCHEMA_TTL_MS", 60 * 60 * 1000), // 1 hour
} as const

// ── Knowledge Graph Result Cache ────────────────────────────
export const KG_CACHE = {
  ttlMs:   envNum("CACHE_KG_TTL_MS", 15 * 60 * 1000), // 15 min
  maxSize: envNum("CACHE_KG_MAX_SIZE", 200),
} as const

// ── Semantic Query Cache (jaccard nearest-neighbor on tokens) ─
export const SEMANTIC_CACHE = {
  ttlMs:   envNum("CACHE_SEMANTIC_TTL_MS", 2 * 60 * 60 * 1000), // 2 hours
  maxSize: envNum("CACHE_SEMANTIC_MAX_SIZE", 500),
} as const

/**
 * Semantic cache 정확 히트 threshold (Vanna 2.0 앙상블 정책).
 * 0.95+ 만 early return; 그 외는 ensemble-context 로 모아 LLM 에 위임한다.
 * 짧은 쿼리가 더 자주 흔들리지만 ensemble 안에 cache 단서가 함께 들어가서
 * 정보 손실이 없다 — false-positive replay 차단이 우선.
 */
export function getSemanticThreshold(tokenCount: number): number {
  void tokenCount
  return envNum("CACHE_SEMANTIC_THR", 0.95)
}

// ── Feedback-Driven Few-Shot Pool ────────────────────────────
// 👍/👎 피드백으로 축적되는 learned example의 similarity boost.
// boostPerPositive * netPositive, 최대 maxBoost 까지 Jaccard 점수에 가산.
export const FEEDBACK_POOL = {
  boostPerPositive: envNum("FEEDBACK_BOOST_PER_POSITIVE", 0.03),
  maxBoost:         envNum("FEEDBACK_MAX_BOOST", 0.15),
} as const

// ── Tool Memory (Vanna 2.0 style SQL memory w/ pg_trgm similarity) ──
// searchToolMemory가 질문 similarity를 threshold 로 갈라서 반환.
//   high  ≥ highThreshold → strong hint (few-shot 수준)
//   mid   ≥ midThreshold  → weak hint (reference only)
//   none  < minSearchThreshold → 무시
export const TOOL_MEMORY_CONFIG = {
  highThreshold:       envNum("TOOL_MEMORY_HIGH_THRESHOLD", 0.8),
  midThreshold:        envNum("TOOL_MEMORY_MID_THRESHOLD", 0.5),
  minSearchThreshold:  envNum("TOOL_MEMORY_MIN_SEARCH_THRESHOLD", 0.3),
  maxResults:          envNum("TOOL_MEMORY_MAX_RESULTS", 3),
} as const
