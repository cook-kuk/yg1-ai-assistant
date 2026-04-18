/**
 * Tool Use Classifier — routes user intent via Claude's native tool_use feature
 * instead of JSON-based prompt engineering.
 *
 * Feature-flagged behind ENABLE_TOOL_USE_CLASSIFIER (default false).
 * Does NOT modify existing routing — standalone module for evaluation.
 */

import type { LLMProvider, LLMTool, LLMToolResult } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"
import { buildAppliedFilterFromValue } from "@/lib/recommendation/shared/filter-field-registry"
import { LLM_FREE_INTERPRETATION } from "@/lib/feature-flags"
import { buildCanonicalDomainKnowledgeSnippet } from "@/lib/recommendation/shared/canonical-values"

// ── Feature flag ─────────────────────────────────────────────

export const ENABLE_TOOL_USE_CLASSIFIER = process.env.ENABLE_TOOL_USE_CLASSIFIER === "true"

// ── Types ────────────────────────────────────────────────────

export type ToolUseActionType =
  | "apply_filter"
  | "replace_filter"
  | "remove_filter"
  | "answer_question"
  | "skip_field"
  | "compare_products"
  | "show_recommendation"

export interface ToolUseClassification {
  actionType: ToolUseActionType
  toolName: string
  params: Record<string, unknown>
  /** Raw text response from Claude (if any alongside tool use) */
  textResponse: string | null
  /** Whether a tool was actually invoked (false = text-only fallback) */
  toolInvoked: boolean
}

// ── Tool definitions ─────────────────────────────────────────

const FILTER_FIELDS_ENUM = [
  "toolSubtype",
  "fluteCount",
  "coating",
  "diameterMm",
  "workPieceName",
  "material",
] as const

export const TOOL_DEFINITIONS: LLMTool[] = [
  {
    name: "apply_filter",
    description: "Apply a filter to narrow down product candidates. Use when the user specifies a constraint like tool type, coating, diameter, flute count, or material.",
    input_schema: {
      type: "object",
      properties: {
        field: {
          type: "string",
          enum: [...FILTER_FIELDS_ENUM],
          description: "The filter field to apply",
        },
        value: {
          type: "string",
          description: "The canonical value to filter by. Use English for toolSubtype (Square, Ball, Radius, Roughing, Taper, Chamfer, High-Feed). Use numbers for fluteCount (2,3,4,5,6) and diameterMm.",
        },
        op: {
          type: "string",
          enum: ["eq", "neq"],
          description: "eq = include only this value, neq = exclude this value. Default eq. Use neq for '빼고', '제외', '아닌것'.",
        },
      },
      required: ["field", "value"],
    },
  },
  {
    name: "replace_filter",
    description: "Replace an existing filter value with a new one. Use when the user says '바꿔', '변경', '대신', '말고 X로'.",
    input_schema: {
      type: "object",
      properties: {
        field: {
          type: "string",
          enum: [...FILTER_FIELDS_ENUM],
          description: "The filter field to replace",
        },
        from: {
          type: "string",
          description: "The current filter value to replace (optional, inferred from session if omitted)",
        },
        to: {
          type: "string",
          description: "The new filter value",
        },
      },
      required: ["field", "to"],
    },
  },
  {
    name: "remove_filter",
    description: "Remove an existing filter entirely. Use when the user wants to undo a specific filter constraint.",
    input_schema: {
      type: "object",
      properties: {
        field: {
          type: "string",
          enum: [...FILTER_FIELDS_ENUM],
          description: "The filter field to remove",
        },
      },
      required: ["field"],
    },
  },
  {
    name: "answer_question",
    description: "Answer a general question without changing filters. Use when the user asks 'what is X?', asks about product properties, or has a question ending with ?",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "Restate the user's question concisely",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "skip_field",
    description: "Skip the current question (user doesn't care about this filter). Use for '상관없음', '아무거나', '패스', '다 괜찮아'.",
    input_schema: {
      type: "object",
      properties: {
        field: {
          type: "string",
          description: "The field being skipped (optional, defaults to the last-asked field)",
        },
      },
      required: [],
    },
  },
  {
    name: "compare_products",
    description: "Compare specific products side by side. Use when the user mentions product names/codes and asks to compare them.",
    input_schema: {
      type: "object",
      properties: {
        targets: {
          type: "array",
          items: { type: "string" },
          description: "Product names or codes to compare",
        },
      },
      required: ["targets"],
    },
  },
  {
    name: "show_recommendation",
    description: "Show or refresh product recommendations. Use when the user says '추천해줘', '보여줘', 'show results', or wants to see the current recommendation list.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
]

// ── System prompt builder ────────────────────────────────────

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
  if (state.resolutionStatus) parts.push(`Resolution: ${state.resolutionStatus}`)
  return parts.join("\n")
}

const SYSTEM_PROMPT_TEMPLATE_FULL = `You are a routing engine for a cutting tool recommendation chatbot (YG-1).
The user speaks Korean. Given their message and the current session state, choose the right tool to call.

## Session State
{{SESSION_STATE}}

## Value canonicalization rules
- toolSubtype: always English — Square, Ball, Radius, Roughing, Taper, Chamfer, High-Feed
- fluteCount: number only — 2, 3, 4, 5, 6
- coating: TiAlN, AlCrN, DLC, TiCN, Bright Finish, Blue-Coating, X-Coating, Y-Coating, Uncoated
- diameterMm: number only (e.g., 10, 8, 6.35)

## Korean intent hints
- "빼고/제외/아닌것" with no existing filter → apply_filter with op:"neq"
- "빼고/제외" when that filter already exists → remove_filter
- "바꿔/변경/대신" → replace_filter
- "상관없음/아무거나/패스" → skip_field
- Question ending with ? → answer_question`

const SYSTEM_PROMPT_TEMPLATE_FREE = `You are a routing engine for a cutting tool recommendation chatbot (YG-1).
The user speaks Korean. Choose the right tool based on their message and session state.

## Session State
{{SESSION_STATE}}

Use your judgment to interpret the user's intent and canonicalize values appropriately.

${buildCanonicalDomainKnowledgeSnippet()}`

export function buildSystemPrompt(state: ExplorationSessionState | null): string {
  const template = LLM_FREE_INTERPRETATION ? SYSTEM_PROMPT_TEMPLATE_FREE : SYSTEM_PROMPT_TEMPLATE_FULL
  return template.replace("{{SESSION_STATE}}", buildSessionSummary(state))
}

// ── Tool-use result mapping ──────────────────────────────────

const TOOL_NAME_TO_ACTION: Record<string, ToolUseActionType> = {
  apply_filter: "apply_filter",
  replace_filter: "replace_filter",
  remove_filter: "remove_filter",
  answer_question: "answer_question",
  skip_field: "skip_field",
  compare_products: "compare_products",
  show_recommendation: "show_recommendation",
}

export function mapToolResult(toolResult: LLMToolResult): ToolUseClassification {
  const actionType = TOOL_NAME_TO_ACTION[toolResult.toolName]
  if (!actionType) {
    return {
      actionType: "answer_question",
      toolName: toolResult.toolName,
      params: toolResult.input,
      textResponse: null,
      toolInvoked: true,
    }
  }
  return {
    actionType,
    toolName: toolResult.toolName,
    params: toolResult.input,
    textResponse: null,
    toolInvoked: true,
  }
}

export function buildTextFallback(text: string | null): ToolUseClassification {
  return {
    actionType: "answer_question",
    toolName: "answer_question",
    params: { question: text ?? "" },
    textResponse: text,
    toolInvoked: false,
  }
}

// ── Canonicalization ─────────────────────────────────────────

export function canonicalizeParams(
  classification: ToolUseClassification
): ToolUseClassification {
  const { actionType, params } = classification
  const out = { ...classification, params: { ...params } }

  if (actionType === "apply_filter" && params.field && params.value != null) {
    const filter = buildAppliedFilterFromValue(
      String(params.field),
      params.value as string | number
    )
    if (filter) {
      out.params.field = filter.field
      out.params.value = filter.rawValue
    }
  }

  if (actionType === "replace_filter" && params.field && params.to != null) {
    const filter = buildAppliedFilterFromValue(
      String(params.field),
      params.to as string | number
    )
    if (filter) {
      out.params.field = filter.field
      out.params.to = filter.rawValue
    }
  }

  return out
}

// ── Main function ────────────────────────────────────────────

const TOOL_USE_MODEL = "haiku" as const

export async function classifyWithToolUse(
  userMessage: string,
  sessionState: ExplorationSessionState | null,
  provider: LLMProvider
): Promise<ToolUseClassification> {
  const systemPrompt = buildSystemPrompt(sessionState)

  try {
    const { text, toolUse } = await provider.completeWithTools(
      systemPrompt,
      [{ role: "user", content: userMessage }],
      TOOL_DEFINITIONS,
      1024,
      TOOL_USE_MODEL,
      "tool-use-router"
    )

    if (toolUse) {
      const raw = mapToolResult(toolUse)
      return canonicalizeParams(raw)
    }

    // Claude chose to respond with text only (no tool call)
    return buildTextFallback(text)
  } catch (err) {
    console.error(`[tool-use-classifier] ERROR: ${err instanceof Error ? err.message : String(err)}`)
    return buildTextFallback(null)
  }
}
