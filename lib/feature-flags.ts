/**
 * Feature Flags — Runtime toggles for multi-agent features.
 *
 * All flags default to safe behavior (enabled).
 * Set env vars to "false" to disable.
 */

function envFlag(name: string, defaultValue: boolean = true): boolean {
  const val = process.env[name]
  if (val === undefined) return defaultValue
  return val !== "false" && val !== "0"
}

/** Use multi-agent orchestrator instead of legacy inquiry analyzer gates */
export const ENABLE_MULTI_AGENT_ORCHESTRATOR = envFlag("ENABLE_MULTI_AGENT_ORCHESTRATOR", true)

/** Allow Opus escalation for ambiguous references */
export const ENABLE_OPUS_AMBIGUITY = envFlag("ENABLE_OPUS_AMBIGUITY", true)

/** Enable Sonnet-powered comparison agent */
export const ENABLE_COMPARISON_AGENT = envFlag("ENABLE_COMPARISON_AGENT", true)

/** Enable validation gate (response checking) */
export const ENABLE_VALIDATION_GATE = envFlag("ENABLE_VALIDATION_GATE", true)

/** Use tool-use routing (Claude chooses tools) instead of legacy intent classification */
export const ENABLE_TOOL_USE_ROUTING = envFlag("ENABLE_TOOL_USE_ROUTING", true)

/** Enable series-based grouping of candidates in CandidatePanel */
export const ENABLE_SERIES_GROUPING = envFlag("ENABLE_SERIES_GROUPING", true)

/** Enable task system (multi-task + checkpoint restoration) */
export const ENABLE_TASK_SYSTEM = envFlag("ENABLE_TASK_SYSTEM", true)

/** Apply extra in-memory heuristics after SQL fetch. Conversation narrowing filters stay enabled. */
export const ENABLE_POST_SQL_CANDIDATE_FILTERS = envFlag("ENABLE_POST_SQL_CANDIDATE_FILTERS", true)

/** Use single Sonnet call for routing instead of multiple parallel Haiku calls. */
export function isSingleCallRouterEnabled(): boolean {
  return process.env.USE_SINGLE_CALL_ROUTER !== "false"
}
export const USE_SINGLE_CALL_ROUTER = true

/**
 * LLM Free Interpretation — deterministic regex 게이트를 끄고 LLM이 자유 해석.
 * ON이면:
 *   1) intent-classifier: deterministic 패턴 스킵 → LLM 직행
 *   2) single-call router: filterHints 조건 스킵 → 항상 Sonnet 라우팅
 *   3) simple-chat: 무조건 LLM 해석 우선
 * 개떡같이 말해도 찰떡같이 알아먹게.
 * Set LLM_FREE_INTERPRETATION=true to enable.
 */
export const LLM_FREE_INTERPRETATION = envFlag("LLM_FREE_INTERPRETATION", true)

/** Use planner decision layer for single-constraint override. Defaults to true. Set ENABLE_PLANNER_DECISION=false to disable. */
export const ENABLE_PLANNER_DECISION = envFlag("ENABLE_PLANNER_DECISION", true)

/** Use V2 turn orchestrator (new recommendation pipeline). Defaults to true — V2 is the primary pipeline. Set USE_NEW_ORCHESTRATOR=false to revert to legacy. */
/** Let an advisory LLM decide whether an ambiguous stateful turn should ask or reuse current UI options. */
export const ENABLE_STATEFUL_CLARIFICATION_ARBITER = envFlag("ENABLE_STATEFUL_CLARIFICATION_ARBITER", true)

export const USE_NEW_ORCHESTRATOR = process.env.USE_NEW_ORCHESTRATOR !== "false"

/** Comma-separated list of phases where V2 is enabled. "all" = everything. Useful for gradual rollout. */
export const V2_ENABLED_PHASES = (process.env.V2_ENABLED_PHASES ?? "all").split(",").map(s => s.trim()).filter(Boolean)

/** Check if V2 should be used for a given phase */
export function shouldUseV2ForPhase(currentPhase: string): boolean {
  if (!USE_NEW_ORCHESTRATOR) return false
  if (V2_ENABLED_PHASES.includes("all")) return true
  return V2_ENABLED_PHASES.includes(currentPhase)
}
