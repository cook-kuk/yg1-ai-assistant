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
 * 시맨틱 캐시 적중 threshold. 짧은 쿼리(토큰 적음)는 한 단어 차이가
 * Jaccard를 크게 흔들기 때문에 관대하게, 긴 쿼리는 엄격하게.
 */
export function getSemanticThreshold(tokenCount: number): number {
  if (tokenCount <= 2) return envNum("CACHE_SEMANTIC_THR_SHORT", 0.9)
  if (tokenCount <= 5) return envNum("CACHE_SEMANTIC_THR_MID", 0.75)
  return envNum("CACHE_SEMANTIC_THR_LONG", 0.6)
}

// ── Feedback-Driven Few-Shot Pool ────────────────────────────
// 👍/👎 피드백으로 축적되는 learned example의 similarity boost.
// boostPerPositive * netPositive, 최대 maxBoost 까지 Jaccard 점수에 가산.
export const FEEDBACK_POOL = {
  boostPerPositive: envNum("FEEDBACK_BOOST_PER_POSITIVE", 0.03),
  maxBoost:         envNum("FEEDBACK_MAX_BOOST", 0.15),
} as const
