/**
 * Runtime Configuration (SSOT)
 *
 * DB pool + tool forge/registry + chat-service LLM token limit.
 * ENV 변수로 오버라이드 가능 → 운영 튜닝 시 코드 변경 불필요.
 *
 * ENV naming convention:
 *   DB_POOL_*        — PostgreSQL 커넥션 풀
 *   TOOL_FORGE_*     — SQL forge-and-execute loop
 *   TOOL_REGISTRY_*  — 승격된 tool SSOT (data/runtime/tool-registry.json)
 *   CHAT_*_MAX_TOKENS — chat-service LLM max_tokens
 */

function envNum(name: string, defaultValue: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return defaultValue
  const n = Number(raw)
  return Number.isFinite(n) ? n : defaultValue
}

// ── DB Pool ─────────────────────────────────────────────────
export const DB_POOL_CONFIG = {
  max:                  envNum("DB_POOL_MAX", 8),
  idleTimeoutMs:        envNum("DB_POOL_IDLE_TIMEOUT_MS", 30_000),
  connectionTimeoutMs:  envNum("DB_POOL_CONNECTION_TIMEOUT_MS", 10_000),
} as const

// ── Tool Forge (SQL generation loop) ────────────────────────
export const TOOL_FORGE_CONFIG = {
  maxRetries:    envNum("TOOL_FORGE_MAX_RETRIES", 3),
  maxRelaxSteps: envNum("TOOL_FORGE_MAX_RELAX_STEPS", 5),
  maxLimit:      envNum("TOOL_FORGE_MAX_LIMIT", 50),
} as const

// ── Tool Registry (SSOT for promoted tools) ─────────────────
export const TOOL_REGISTRY_CONFIG = {
  ttlDays:          envNum("TOOL_REGISTRY_TTL_DAYS", 7),
  minUseForPermanent: envNum("TOOL_REGISTRY_MIN_USE", 3),
  maxSize:          envNum("TOOL_REGISTRY_MAX_SIZE", 200),
  minMatchScore:    envNum("TOOL_REGISTRY_MIN_MATCH_SCORE", 0.4),
} as const

// ── Chat Service LLM token budgets ──────────────────────────
export const CHAT_LLM_TOKENS = {
  /** Tool round (결정/단문 추론) max_tokens. */
  toolRound:      envNum("CHAT_TOOL_ROUND_MAX_TOKENS", 1024),
  /** 최종 user-facing 응답 max_tokens. */
  final:          envNum("CHAT_FINAL_MAX_TOKENS", 2048),
  /** Streaming / initial (with tools) max_tokens. */
  streaming:      envNum("CHAT_STREAMING_MAX_TOKENS", 2048),
  /** Haiku 분류 (param extraction) max_tokens. */
  haikuClassify:  envNum("CHAT_HAIKU_CLASSIFY_MAX_TOKENS", 300),
} as const

// ── Runtime clarification templates (ENV-overridable) ───────
function envStr(name: string, defaultValue: string): string {
  const raw = process.env[name]
  return raw === undefined || raw === "" ? defaultValue : raw
}

/** Substitute {key} placeholders in a template with actual data. */
export function renderTemplate(template: string, data: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    k in data ? String(data[k]) : `{${k}}`,
  )
}

export const RUNTIME_MESSAGES = {
  /** Zero-result rollback clarification. Placeholders: {prev} (prev candidate count), {filters} (added filter description). */
  zeroResultRollback: envStr(
    "RUNTIME_MSG_ZERO_RESULT_ROLLBACK",
    "현재 후보 {prev}개가 조건 [{filters}] 적용 시 0건이 됩니다. 기존 조건을 유지할까요?",
  ),
} as const

export const PROMPT_LABELS = {
  displayedCandidateCount: envStr(
    "PROMPT_LABEL_DISPLAYED_CANDIDATE_COUNT",
    "현재 표시 중인 후보",
  ),
} as const
