/**
 * Single-Call Router — routes user intent via ONE Sonnet call
 * instead of multiple parallel Haiku calls.
 *
 * Feature-flagged behind USE_SINGLE_CALL_ROUTER.
 */

import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"

// ── Types ─────────────────────────────────────────────────────

export interface SingleCallAction {
  type:
    | "apply_filter"
    | "remove_filter"
    | "replace_filter"
    | "show_recommendation"
    | "compare"
    | "answer"
    | "skip"
    | "reset"
    | "go_back"
  field?: string
  value?: string | number
  from?: string
  to?: string
  op?: "eq" | "neq" | "in" | "range"
  targets?: string[]
  message?: string
}

export interface SingleCallResult {
  actions: SingleCallAction[]
  answer: string
  reasoning: string
}

// ── Validation ────────────────────────────────────────────────

const VALID_ACTION_TYPES = new Set([
  "apply_filter",
  "remove_filter",
  "replace_filter",
  "show_recommendation",
  "compare",
  "answer",
  "skip",
  "reset",
  "go_back",
])

const VALID_OPS = new Set(["eq", "neq", "in", "range"])

export function validateAction(action: unknown): action is SingleCallAction {
  if (!action || typeof action !== "object") return false
  const a = action as Record<string, unknown>
  if (!a.type || typeof a.type !== "string") return false
  if (!VALID_ACTION_TYPES.has(a.type)) return false
  if (a.op !== undefined && !VALID_OPS.has(a.op as string)) return false
  return true
}

export function validateAndCleanResult(raw: unknown): SingleCallResult {
  const empty: SingleCallResult = { actions: [], answer: "", reasoning: "" }
  if (!raw || typeof raw !== "object") return empty

  const r = raw as Record<string, unknown>
  const answer = typeof r.answer === "string" ? r.answer : ""
  const reasoning = typeof r.reasoning === "string" ? r.reasoning : ""

  if (!Array.isArray(r.actions)) return { actions: [], answer, reasoning }

  const validActions = r.actions.filter(validateAction) as SingleCallAction[]
  return { actions: validActions, answer, reasoning }
}

// ── JSON extraction ───────────────────────────────────────────

export function extractJsonFromResponse(text: string): unknown | null {
  // Try direct parse first
  try {
    return JSON.parse(text)
  } catch {
    // noop
  }

  // Try extracting from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim())
    } catch {
      // noop
    }
  }

  // Try finding first { ... } block
  const braceStart = text.indexOf("{")
  const braceEnd = text.lastIndexOf("}")
  if (braceStart >= 0 && braceEnd > braceStart) {
    try {
      return JSON.parse(text.slice(braceStart, braceEnd + 1))
    } catch {
      // noop
    }
  }

  return null
}

// ── Prompt builder ────────────────────────────────────────────

function buildSessionSummary(state: ExplorationSessionState | null): string {
  if (!state) return "No session state (first turn)."

  const parts: string[] = []
  const filters = state.appliedFilters ?? []
  if (filters.length > 0) {
    parts.push(`Applied filters: ${filters.map(f => `${f.field}=${f.value}(${f.op})`).join(", ")}`)
  } else {
    parts.push("No filters applied yet.")
  }
  parts.push(`Candidate count: ${state.candidateCount ?? 0}`)
  if (state.lastAskedField) parts.push(`Last asked field: ${state.lastAskedField}`)
  if (state.currentMode) parts.push(`Mode: ${state.currentMode}`)
  if (state.displayedChips?.length) parts.push(`Displayed chips: ${state.displayedChips.join(", ")}`)
  if (state.resolutionStatus) parts.push(`Resolution: ${state.resolutionStatus}`)

  return parts.join("\n")
}

const SYSTEM_PROMPT = `You are a routing engine for a cutting tool recommendation chatbot (YG-1).
Given the user's Korean message and the current session state, determine what actions to take.

## Session State
{{SESSION_STATE}}

## Available Actions (return as JSON array)
- apply_filter: Add a new filter. Requires field, value, op (eq|neq|in|range).
- remove_filter: Remove an existing filter. Requires field.
- replace_filter: Change an existing filter value. Requires field, from, to.
- show_recommendation: User wants to see results now.
- compare: User wants to compare specific products. Requires targets (product name array).
- answer: User asked a general question (no filter change). Set message with the question.
- skip: User wants to skip the current question ("상관없음", "아무거나", "패스"). Optionally set field.
- reset: User wants to start over.
- go_back: User wants to undo the last step.

## Korean Intent Patterns
- "아닌것/빼고/제외" -> op:"neq" or remove_filter
- "바꿔/변경/대신/말고" -> replace_filter
- "상관없음/아무거나/패스" -> skip
- Question ending with ? -> answer (no filter change)
- Multiple conditions in one message -> multiple actions

## Response Format (strict JSON only, no markdown)
{
  "actions": [ { "type": "...", ... } ],
  "answer": "",
  "reasoning": "brief explanation"
}`

function buildSystemPrompt(state: ExplorationSessionState | null): string {
  return SYSTEM_PROMPT.replace("{{SESSION_STATE}}", buildSessionSummary(state))
}

// ── Main function ─────────────────────────────────────────────

const SINGLE_CALL_ROUTER_MODEL = "sonnet" as const

export async function routeSingleCall(
  userMessage: string,
  sessionState: ExplorationSessionState | null,
  provider: LLMProvider
): Promise<SingleCallResult> {
  const systemPrompt = buildSystemPrompt(sessionState)

  try {
    const raw = await provider.complete(
      systemPrompt,
      [{ role: "user", content: userMessage }],
      2000,
      SINGLE_CALL_ROUTER_MODEL,
      "single-call-router"
    )

    const parsed = extractJsonFromResponse(raw)
    if (!parsed) {
      console.warn("[single-call-router] Failed to parse JSON from LLM response")
      return { actions: [], answer: "", reasoning: "parse_failure" }
    }

    return validateAndCleanResult(parsed)
  } catch (err) {
    console.error("[single-call-router] LLM call failed:", err)
    return { actions: [], answer: "", reasoning: "llm_error" }
  }
}
