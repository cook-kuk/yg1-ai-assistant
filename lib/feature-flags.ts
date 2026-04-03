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

/** Use new state reducer instead of carryForwardState. Defaults to false (dry-run comparison only). Set USE_STATE_REDUCER=true to activate. */
export const USE_STATE_REDUCER = envFlag("USE_STATE_REDUCER", false)

/** Use new chip system instead of hardcoded chips. Defaults to false (shadow comparison only). Set USE_CHIP_SYSTEM=true to activate. */
export const USE_CHIP_SYSTEM = envFlag("USE_CHIP_SYSTEM", false)

/** Use single Sonnet call for routing instead of multiple parallel Haiku calls. Defaults to false. Set USE_SINGLE_CALL_ROUTER=true to activate. */
export const USE_SINGLE_CALL_ROUTER = process.env.USE_SINGLE_CALL_ROUTER === "true"

/** Use V2 turn orchestrator (new recommendation pipeline). Defaults to true — V2 is the primary pipeline. Set USE_NEW_ORCHESTRATOR=false to revert to legacy. */
export const USE_NEW_ORCHESTRATOR = process.env.USE_NEW_ORCHESTRATOR !== "false"

/** Comma-separated list of phases where V2 is enabled. "all" = everything. Useful for gradual rollout. */
export const V2_ENABLED_PHASES = (process.env.V2_ENABLED_PHASES ?? "all").split(",").map(s => s.trim()).filter(Boolean)

/** Check if V2 should be used for a given phase */
export function shouldUseV2ForPhase(currentPhase: string): boolean {
  if (!USE_NEW_ORCHESTRATOR) return false
  if (V2_ENABLED_PHASES.includes("all")) return true
  return V2_ENABLED_PHASES.includes(currentPhase)
}
