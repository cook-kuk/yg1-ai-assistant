/**
 * Query Resolver Configuration (SSOT)
 *
 * multi-stage-query-resolver + semantic-turn-extractor 파라미터.
 * ENV 변수로 오버라이드 가능 → 코드 변경 없이 A/B 테스트.
 *
 * ENV naming convention:
 *   RESOLVER_STAGE*_*   — 3단계 resolver 파이프라인
 *   SEMANTIC_*          — semantic turn extractor
 */

function envNum(name: string, defaultValue: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return defaultValue
  const n = Number(raw)
  return Number.isFinite(n) ? n : defaultValue
}

// ── Multi-Stage Query Resolver ──────────────────────────────
export const RESOLVER_CONFIG = {
  /** Stage2 LLM timeout (ms). */
  stage2TimeoutMs:                  envNum("RESOLVER_STAGE2_TIMEOUT_MS", 3000),
  /** Stage3 LLM timeout (ms). */
  stage3TimeoutMs:                  envNum("RESOLVER_STAGE3_TIMEOUT_MS", 12000),
  /** Stage2 결과를 채택할 최소 confidence. */
  stage2ConfidenceThreshold:        envNum("RESOLVER_STAGE2_CONFIDENCE", 0.7),
  /** Schema hint phonetic 유사도 최소치 (오타 허용 한계). */
  schemaHintPhoneticThreshold:      envNum("RESOLVER_PHONETIC_THRESHOLD", 0.88),
  /** Stage1 CoT 진입 허용 broad candidate 수 상한. */
  stage1CotBroadCandidateThreshold: envNum("RESOLVER_COT_BROAD_LIMIT", 5000),
  /** Stage1 CoT token 한도. */
  stage1CotTokenLimit:              envNum("RESOLVER_COT_TOKEN_LIMIT", 8),
} as const

// ── Semantic Turn Extractor ─────────────────────────────────
export const SEMANTIC_CONFIG = {
  /** Semantic turn 결과를 채택할 최소 confidence. */
  minConfidence:       envNum("SEMANTIC_MIN_CONFIDENCE", 0.55),
  /** 재시도 최대 횟수. */
  maxSemanticAttempts: envNum("SEMANTIC_MAX_ATTEMPTS", 3),
} as const
