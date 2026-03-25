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

/** Use V2 turn orchestrator (new recommendation pipeline). Defaults to false — existing behavior. */
export const USE_NEW_ORCHESTRATOR = process.env.USE_NEW_ORCHESTRATOR === "true"
